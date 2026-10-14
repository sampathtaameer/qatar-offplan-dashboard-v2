"""Refresh data/projects.json and data/rents.json from Property Finder Qatar public pages.

Usage: python -I tools/fetch_propertyfinder.py [project_root] [--projects] [--rents] [--offplan] [--details]
(no flag = all four). --details reads the description of each off-plan listing not seen before
(data/raw/pf_offplan_details.json). --offplan reads every for-sale page and keeps listings tagged off-plan
(data/raw/pf_offplan_listings.json); tools/build_broker_projects.py turns them into projects. Low volume: one request every 1.5 s, one results page per area and
bedroom count. Reads the page's embedded __NEXT_DATA__ JSON; no logins, no APIs.

projects.json keeps manual fields (name_ar, default_facade, views, notes, units_total, floors)
from the previous file when the listing does not provide them. Run tools/apply_overrides.py afterwards
(refresh.py does) to re-apply data/project_overrides.csv.
"""
import datetime as dt
import json
import os
import re
import statistics
import sys
import time
import urllib.request

ROOT = os.path.abspath(next((a for a in sys.argv[1:] if not a.startswith('--')), os.path.join(os.path.dirname(__file__), '..')))
BASE = 'https://www.propertyfinder.qa'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'en'}
TODAY = dt.date.today().isoformat()

PROJECT_INDEXES = ['/en/new-projects', '/en/new-projects/lp/lusail', '/en/new-projects/lp/doha',
                   '/en/new-projects/lp/al-wakra', '/en/new-projects/lp/al-khor']


PLAN_LABELS = {
    'down_payment': ('down payment', 'دفعة أولى'),
    'during_construction': ('during construction', 'أثناء البناء'),
    'handover': ('on handover', 'عند التسليم'),
    'after_handover': ('after handover', 'بعد التسليم'),
}
STATUS = {'completed': 'completed', 'under_construction': 'under_construction', 'not_started': 'off_plan'}
GENERIC_COORDS = {(25.4084, 51.5121), (25.4162, 51.518)}  # PF district centroids, not buildings


def next_data(path):
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        html = r.read().decode('utf-8', 'replace')
    time.sleep(1.5)
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise ValueError(f'no __NEXT_DATA__ on {path}')
    return json.loads(m.group(1))['props']['pageProps']


def quantile(v, q):
    v = sorted(v)
    if not v:
        return None
    i = (len(v) - 1) * q
    lo, hi = int(i), min(int(i) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


# ---------- projects ----------

def area_for(loc, lat):
    if 'Qetaifan' in loc:
        return 'qetaifan-islands'
    if 'Fox Hills' in loc:
        return 'jabal-thuaileb'
    if loc.startswith('Lusail'):
        return 'lusail'
    if 'Al Wukair' in loc:
        return 'al-wukair'
    if 'Ezdan Village' in loc:
        return 'al-wukair' if lat < 25.14 else 'al-wakra'
    if re.search('muraikh', loc, re.I):
        return 'al-muraikh'
    if 'Abu Hamour' in loc:
        return 'abu-hamour'
    if 'Salata' in loc:
        return 'al-salata'
    if re.search('Sumaysimah|Simaisma', loc):
        return 'simaisma'
    if 'Pearl' in loc:
        return 'the-pearl'
    if 'Gewan' in loc:
        return 'gewan-island'
    return None


def unit_type(ptype, beds):
    if ptype in ('villa', 'townhouse', 'duplex', 'penthouse'):
        return ptype
    return 'studio' if not beds else f'{beds}br'


def plan_text(plans, li):
    out = []
    for pl in plans:
        parts = []
        for ph in pl.get('phases') or []:
            label = PLAN_LABELS.get(ph.get('label'), (ph.get('label'), ph.get('label')))[li]
            notes = '; '.join(m['label'].strip() for m in ph.get('miles') or [] if m.get('label', '').strip())
            parts.append(f"{ph.get('value')}% {label}" + (f' ({notes})' if notes else ''))
        if parts:
            out.append(f"{(pl.get('title') or '').strip()}: " + ', '.join(parts))
    return ' · '.join(out)


def views_from_name(name):
    v = []
    if re.search('marina', name, re.I):
        v.append('marina')
    if re.search('waterfront|sea|vagues|horizon|bay', name, re.I):
        v.append('sea')
    if re.search('canal', name, re.I):
        v.append('canal')
    return v


def fetch_projects():
    listings = {}
    for idx in PROJECT_INDEXES:
        for page in range(1, 6):
            try:
                pp = next_data(f'{idx}?page={page}' if page > 1 else idx)
            except Exception as e:  # noqa: BLE001
                print(f'skip {idx} p{page}: {e}', file=sys.stderr)
                break
            sr = pp.get('searchResult') or {}
            for p in (sr.get('data') or {}).get('projects') or []:
                listings[p['id']] = p
            pag = (sr.get('meta') or {}).get('pagination') or {}
            if page >= (pag.get('total') or 1):
                break

    prev_path = os.path.join(ROOT, 'data', 'projects.json')
    prev_doc = json.load(open(prev_path, encoding='utf-8')) if os.path.exists(prev_path) else {'records': []}
    # Broker-listing projects (tools/build_broker_projects.py) are kept aside and re-attached unchanged.
    prev = {r['id']: r for r in prev_doc['records'] if r.get('source_kind', 'developer') == 'developer'}
    keep_broker = [r for r in prev_doc['records'] if r.get('source_kind') == 'broker']
    if len(listings) < max(10, len(prev) // 2):
        # Blocked or site changed: keep the previous file rather than wiping it.
        print(f'projects: only {len(listings)} listings found (had {len(prev)}); keeping previous file', file=sys.stderr)
        return None
    records = []
    for p in listings.values():
        slug = p['shareUrl'].rstrip('/').split('/')[-1]
        try:
            d = next_data(p['shareUrl']).get('detailResult') or {}
        except Exception as e:  # noqa: BLE001
            print(f'detail failed {slug}: {e}', file=sys.stderr)
            d = {}
        coords = (p.get('location') or {}).get('coordinates') or {}
        lat, lng = coords.get('lat'), coords.get('lon')
        loc = (d.get('location') or {}).get('fullName') or (p.get('location') or {}).get('fullName') or ''
        ptypes = p.get('propertyTypes') or []

        mix = []
        for g in d.get('units') or []:
            for u in g.get('units') or []:
                for x in u.get('list') or []:
                    lo, hi, price = x.get('areaFrom') or 0, x.get('areaTo') or 0, x.get('startingPrice') or 0
                    if not (lo or hi or price):
                        continue
                    mix.append({'type': unit_type(u.get('propertyType'), x.get('bedrooms')),
                                'size_sqm_min': (lo or hi) or None, 'size_sqm_max': (hi or lo) or None,
                                'price_from_qar': price or None})
        start = p.get('startingPrice') or 0
        if start and not any(u['price_from_qar'] for u in mix):
            # Listing gives only a project starting price; do not pair it with a unit size,
            # since we cannot tell which unit it belongs to.
            beds = (p.get('bedrooms') or [None])[0]
            is_villa = 'villa' in ptypes or 'townhouse' in ptypes or 'villa' in (p.get('title') or '').lower()
            typ = 'villa' if is_villa else unit_type(None, int(beds) if beds and beds.isdigit() else 1)
            mix.append({'type': typ, 'size_sqm_min': None, 'size_sqm_max': None, 'price_from_qar': start})

        desc = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', d.get('description') or ''))
        floors = re.search(r'(\d{1,3})[\s-]*(?:storey|story|floors?)\b', desc, re.I)
        units = re.search(r'(\d{2,4})\s+(?:residential\s+)?(?:units|apartments|residences)\b', desc, re.I)
        old = prev.get(slug, {})
        base = old.get('listing') or old  # pre-override listing values (see apply_overrides.py)
        generic = lat is not None and (round(lat, 4), round(lng, 4)) in GENERIC_COORDS
        sized = [u for u in mix if u['price_from_qar'] and u['size_sqm_min']]
        plans = d.get('paymentPlans') or []
        rec = {
            'id': slug,
            'name_en': (p.get('title') or '').strip(),
            **({'name_ar': old['name_ar']} if old.get('name_ar') else {}),
            'developer': (p.get('developer') or {}).get('name'),
            'area_id': base.get('area_id') or area_for(loc, lat or 0),
            'lat': round(lat, 5) if lat else None, 'lng': round(lng, 5) if lng else None,
            'status': STATUS.get(p.get('constructionPhase'), 'off_plan'),
            'handover': (p.get('deliveryDate') or '')[:7] or None,
            'units_total': int(units.group(1)) if units else base.get('units_total'),
            'floors': int(floors.group(1)) if floors else base.get('floors'),
            'unit_mix': mix,
            'views': old.get('views') or views_from_name(p.get('title') or ''),
            'stock': p.get('stockAvailability'),
            'source': 'Property Finder Qatar, new projects',
            'source_url': BASE + p['shareUrl'],
            'as_of': TODAY,
            'confidence': 'low' if generic or not sized else 'medium',
        }
        if plans:
            rec['payment_plan_en'] = plan_text(plans, 0)
            rec['payment_plan_ar'] = plan_text(plans, 1)
        if generic:
            rec['coords_note'] = 'generic'
        for k in ('default_facade', 'note_en', 'note_ar'):
            if old.get(k):
                rec[k] = old[k]
        if not rec['area_id']:
            print(f'UNMAPPED project area: {rec["name_en"]} ({loc})', file=sys.stderr)
        records.append(rec)

    records.sort(key=lambda r: (r['area_id'] or '', r['name_en']))
    records += keep_broker
    with open(prev_path, 'w', encoding='utf-8') as f:
        json.dump({'as_of': TODAY, **({'broker_as_of': prev_doc['broker_as_of']} if prev_doc.get('broker_as_of') else {}),
                   'notes': 'Developer listings from Property Finder Qatar new-projects pages. Prices are launch/starting prices; '
                            'unit sizes from published floor plans. coords_note=generic: the listing uses a district centroid, not the building.',
                   'records': records}, f, ensure_ascii=False, indent=1)
    print(f'projects: {len(records)}')
    return records


# ---------- rents ----------

def pf_area(loc_names, lat, amap):
    """Area id for a listing from its Property Finder location tree (most specific match wins)."""
    for n in range(len(loc_names), 0, -1):
        hit = amap.get('>'.join(loc_names[:n]))
        if hit:
            if hit == '@ezdan':  # Ezdan Village straddles Al Wakra and Al Wukair
                return 'al-wukair' if lat and lat < 25.14 else 'al-wakra'
            return hit
    return None


def fetch_rents():
    """Every rental listing in Qatar (about 1,400 pages), grouped by area and unit type."""
    amap = json.load(open(os.path.join(ROOT, 'data', 'pf_area_map.json'), encoding='utf-8'))
    APT = {'Apartment', 'Penthouse', 'Duplex', 'Hotel Apartments'}
    VILLA = {'Villa', 'Townhouse', 'Compound'}
    groups, seen, unmapped, n, total_pages, failures = {}, set(), {}, 1, None, 0
    while True:
        try:
            pp = next_data(f'/en/rent/properties-for-rent.html?page={n}')
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f'rents p{n}: {e}', file=sys.stderr)
            if failures > 10:
                break
            n += 1
            continue
        sr = pp.get('searchResult') or {}
        total_pages = (sr.get('meta') or {}).get('page_count') or total_pages
        props = [x['property'] for x in sr.get('listings') or [] if x.get('property')]
        if not props:
            break
        for p in props:
            if p.get('id') in seen:
                continue
            seen.add(p.get('id'))
            price = p.get('price') or {}
            period = price.get('period')
            rent = price.get('value')
            if not rent:
                continue
            rent = {'monthly': rent, 'yearly': rent / 12, 'weekly': rent * 52 / 12, 'daily': rent * 30}.get(period)
            ptype = p.get('property_type')
            beds = p.get('bedrooms')
            if ptype in APT:
                b = 0 if beds in (None, 'studio') else int(re.sub(r'\D', '', str(beds)) or 0)
                utype = 'studio' if b == 0 else '4br' if b >= 4 else f'{b}br'
                if not 1500 <= rent <= 60000:
                    continue
            elif ptype in VILLA:
                utype = 'villa'
                if not 3000 <= rent <= 150000:
                    continue
            else:
                continue
            names = [t.get('name', '') for t in p.get('location_tree') or []]
            lat = ((p.get('location') or {}).get('coordinates') or {}).get('lat')
            area = pf_area(names, lat, amap)
            if not area:
                key = '>'.join(names[:2])
                unmapped[key] = unmapped.get(key, 0) + 1
                continue
            g = groups.setdefault((area, utype), {'rent': [], 'size': [], 'beds': []})
            g['rent'].append(rent)
            size = p.get('size') or {}
            if size.get('value'):
                sqm = size['value'] / (10.7639 if size.get('unit') == 'sqft' else 1)
                if (utype == 'villa' and 20 <= sqm <= 3000) or (utype != 'villa' and 25 <= sqm <= 800):
                    g['size'].append(sqm)
            if utype == 'villa' and beds not in (None, 'studio'):
                g['beds'].append(int(re.sub(r'\D', '', str(beds)) or 0))
        if total_pages and n >= total_pages:
            break
        n += 1
    order = {'studio': 0, '1br': 1, '2br': 2, '3br': 3, '4br': 4, 'villa': 5}
    recs = []
    for (area, utype), g in sorted(groups.items(), key=lambda x: (x[0][0], order[x[0][1]])):
        k = len(g['rent'])
        if k < 3:
            continue
        rec = {'area_id': area, 'unit_type': utype, 'median_qar_month': round(statistics.median(g['rent'])),
               'min_qar_month': round(quantile(g['rent'], 0.1)), 'max_qar_month': round(quantile(g['rent'], 0.9)),
               'typical_size_sqm': round(statistics.median(g['size'])) if g['size'] else None,
               'sample': k, 'listings_total': k,
               'source': 'Property Finder Qatar asking rents, every rental listing in Qatar (P10-P90 range)',
               'source_url': BASE + '/en/rent/properties-for-rent.html', 'as_of': TODAY,
               'confidence': 'high' if k >= 50 else 'medium' if k >= 15 else 'low'}
        if g['beds']:
            rec['typical_bedrooms'] = statistics.median(g['beds'])
        recs.append(rec)
    if unmapped:
        print('rents: Property Finder locations without an area (add to data/pf_area_map.json):', file=sys.stderr)
        for k, v in sorted(unmapped.items(), key=lambda x: -x[1])[:20]:
            print(f'  {v:5d}  {k}', file=sys.stderr)
    if len(seen) < 10000 or len(recs) < 100:
        print(f'rents: only {len(seen)} listings / {len(recs)} groups; keeping previous file', file=sys.stderr)
        return
    with open(os.path.join(ROOT, 'data', 'rents.json'), 'w', encoding='utf-8') as f:
        json.dump({'as_of': TODAY,
                   'notes': f'Asking rents, not signed leases. Every Property Finder rental listing in Qatar ({len(seen):,} on {TODAY}), '
                            'grouped by area and unit type; min/max are the 10th and 90th percentiles. Apartments include penthouses, '
                            'duplexes and hotel apartments; villas include townhouses and compound villas. Groups with fewer than 3 '
                            'listings are left out.',
                   'records': recs}, f, ensure_ascii=False, indent=1)
    print(f'rents: {len(recs)} groups from {len(seen)} listings')


# ---------- off-plan sale listings (all brokers) ----------
# There is no completion-status filter in the search, so every for-sale page is read and listings
# tagged off-plan are kept. About 460 residential + 15 commercial pages; one request every 1.5 s.

def compact(p):
    loc = p.get('location') or {}
    co = loc.get('coordinates') or {}
    return {'id': p.get('id'), 'cat': p.get('category_id'), 'type': p.get('property_type'), 'ptid': p.get('property_type_id'),
            'price': (p.get('price') or {}).get('value'), 'beds': p.get('bedrooms'), 'size': (p.get('size') or {}).get('value'),
            'unit': (p.get('size') or {}).get('unit'), 'plot': p.get('plot_size'), 'cs': p.get('completion_status'),
            'loc': loc.get('name'), 'loc_type': loc.get('type'), 'loc_full': loc.get('full_name'), 'loc_id': loc.get('id'), 'path': loc.get('path'),
            'lat': co.get('lat'), 'lng': co.get('lon'), 'tree': ' > '.join(t.get('name', '') for t in p.get('location_tree') or []),
            'title': p.get('title'), 'dev': p.get('is_direct_from_developer'), 'newc': p.get('is_new_construction'),
            'proj': p.get('is_broker_project_property'), 'listed': p.get('listed_date'), 'broker': (p.get('broker') or {}).get('name'),
            'url': p.get('share_url'), 'pay': p.get('payment_method')}


def fetch_offplan():
    rows, status, pages_read = {}, {}, 0
    for label, base in (('residential', '/en/buy/properties-for-sale.html?'), ('commercial', '/en/search?c=3&fu=0&ob=mr&')):
        n, total_pages, failures = 1, None, 0
        while True:
            try:
                pp = next_data(f'{base}page={n}')
            except Exception as e:  # noqa: BLE001
                failures += 1
                print(f'offplan {label} p{n}: {e}', file=sys.stderr)
                if failures > 5:
                    break
                n += 1
                continue
            sr = pp.get('searchResult') or {}
            total_pages = (sr.get('meta') or {}).get('page_count') or total_pages
            ls = [x['property'] for x in sr.get('listings') or [] if x.get('property')]
            if not ls:
                break
            for p in ls:
                cs = p.get('completion_status') or ''
                status[cs] = status.get(cs, 0) + 1
                if 'off_plan' in cs:
                    rows[('c' if label == 'commercial' else '') + str(p.get('id'))] = compact(p)
            pages_read += 1
            if total_pages and n >= total_pages:
                break
            n += 1
    out = os.path.join(ROOT, 'data', 'raw', 'pf_offplan_listings.json')
    prev_n = len(json.load(open(out, encoding='utf-8'))['records']) if os.path.exists(out) else 0
    if len(rows) < max(100, prev_n // 2):
        print(f'offplan: only {len(rows)} listings from {pages_read} pages (had {prev_n}); keeping previous file', file=sys.stderr)
        return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'as_of': TODAY, 'pages_read': pages_read, 'status_counts': status, 'records': list(rows.values())}, f, ensure_ascii=False)
    print(f'offplan: {len(rows)} off-plan listings from {pages_read} pages')


# ---------- listing descriptions (for developer / handover / units) ----------
# Only listings not seen before are fetched, so after the first run this is a few hundred pages a week.

def fetch_details():
    lp = os.path.join(ROOT, 'data', 'raw', 'pf_offplan_listings.json')
    dp = os.path.join(ROOT, 'data', 'raw', 'pf_offplan_details.json')
    if not os.path.exists(lp):
        return
    ids = [str(r['id']) for r in json.load(open(lp, encoding='utf-8'))['records']]
    old = json.load(open(dp, encoding='utf-8')).get('records', {}) if os.path.exists(dp) else {}
    rows = {i: old[i] for i in ids if i in old}
    todo = [i for i in ids if i not in rows]
    failures = 0
    for i in todo:
        try:
            p = (next_data(f'/to/{i}/en').get('propertyResult') or {}).get('property')
        except Exception as e:  # noqa: BLE001
            failures += 1
            if failures > 25:
                print(f'details: stopping after {failures} failures', file=sys.stderr)
                break
            continue
        if not p:
            continue
        rows[i] = {'t': (p.get('title') or '')[:140], 'd': re.sub(r'\s+', ' ', p.get('description') or '')[:1600],
                   'dev': 1 if p.get('is_direct_from_developer') else 0, 'b': (p.get('broker') or {}).get('name') or '',
                   'loc': (p.get('location') or {}).get('id')}
    with open(dp, 'w', encoding='utf-8') as f:
        json.dump({'as_of': TODAY, 'records': rows}, f, ensure_ascii=False)
    print(f'details: {len(rows)} listings ({len(todo)} new fetched, {failures} failed)')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    if not flags or '--projects' in flags:
        fetch_projects()
    if not flags or '--rents' in flags:
        fetch_rents()
    if not flags or '--offplan' in flags:
        fetch_offplan()
    if not flags or '--details' in flags:
        fetch_details()
