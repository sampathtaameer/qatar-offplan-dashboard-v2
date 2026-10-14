"""Turn Property Finder off-plan sale listings into projects, and merge them into data/projects.json.

Usage: python -I tools/build_broker_projects.py [project_root]

Input: data/raw/pf_offplan_listings.json, written by tools/fetch_propertyfinder.py --offplan (weekly)
or by the in-browser collection. One compact row per for-sale listing tagged off-plan.

Property Finder's "New Projects" section only holds projects whose developers pay to list there.
Brokers list many more off-plan units in the ordinary for-sale search, tagged with a completion
status. This step groups those listings by building (Property Finder's sub-community) and:
  - attaches listing statistics to a developer project when the building matches one
    (name match, or within 400 m with a shared name word);
  - otherwise adds a new project with source_kind "broker", priced from first-sale listings only.

Pricing uses completion_status "off_plan_primary" (first sale) only. Listings marked plain
"off_plan" (sale type not stated) count towards discovery and listing totals but not prices.
Resale ("off_plan_secondary") is excluded. Land is excluded.
"""
import datetime as dt
import json
import math
import os
import re
import statistics
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import listing_facts as lf  # noqa: E402

ROOT = os.path.abspath(next((a for a in sys.argv[1:] if not a.startswith('--')), os.path.join(os.path.dirname(__file__), '..')))
SQFT = 10.7639
COMMERCIAL = {'Hotel Apartments': 'hotel_apartment', 'Office Space': 'office', 'Shop': 'shop', 'Retail': 'shop', 'Show Room': 'shop', 'Warehouse': 'warehouse',
              'Whole Building': 'building', 'Bulk Rent Unit': 'building', 'Bulk Sale Unit': 'building', 'Hotel & Hotel Apartment': 'hotel_apartment'}
STOP = {'al', 'bin', 'le', 'la', 'el', 'tower', 'towers', 'residence', 'residences', 'residential', 'building', 'by', 'the', 'and', 'lusail', 'doha', 'qatar', 'at', 'of',
        'project', 'apartments', 'villas', 'villa', 'phase', 'property', 'real', 'estate', 'development', 'group', 'company', 'city', 'island', 'islands'}
GENERIC = {'energy', 'seef', 'erkyah', 'yasmeen', 'entertainment', 'new', 'street', 'road', 'view', 'views', 'gardens', 'garden', 'marina', 'heights', 'bay', 'park', 'hills', 'plaza', 'gate', 'waterfront', 'sea', 'palm', 'village', 'boulevard', 'commercial', 'complex', 'plot', 'south', 'north', 'east', 'west'}
PRIMARY = 'off_plan_primary'
UNSTATED = 'off_plan'

# Property Finder location names (any level of the tree) -> dashboard area ids.
PF_AREAS = [
    (r'qetaifan', 'qetaifan-islands'), (r'fox hills', 'jabal-thuaileb'), (r'gewan', 'gewan-island'), (r'pearl', 'the-pearl'),
    (r'west bay lagoon|legtaifiya', 'legtaifiya'), (r'msheireb', 'msheireb'), (r'sumaysimah|simaisma', 'simaisma'),
    (r'al khor resort', 'al-khor-resort'), (r'wukair|ezdan village', 'al-wukair'), (r'muraikh', 'al-muraikh'), (r'abu hamour', 'abu-hamour'),
    (r'salata', 'al-salata'), (r'mansoura', 'al-mansoura'), (r'fereej bin mahmoud', 'fereej-bin-mahmoud'), (r'najma', 'najma'),
    (r'umm ghuwailina', 'umm-ghuwailina'), (r'old airport', 'old-airport'), (r'al sadd', 'al-sadd'), (r'al waab', 'al-waab'),
    (r'ain khaled', 'ain-khaled'), (r'thumama', 'al-thumama'), (r'duhail', 'duhail'), (r'madinat khalifa', 'madinat-khalifa'),
    (r'gharrafa', 'al-gharrafa'), (r'onaiza', 'onaiza'), (r'west bay|dafna', 'al-dafna'), (r'meshaf', 'al-meshaf'),
    (r'umm al amad', 'umm-al-amad'), (r'sakhama', 'al-sakhama'), (r'rawdat al khail', 'rawdat-al-khail'), (r'al ebb', 'al-ebb'),
    (r'umm ebairiya', 'umm-ebairiya'), (r'doha al jadeeda', 'doha-al-jadeeda'), (r'old al ghanim', 'al-ghanim'), (r'al wakra', 'al-wakra'),
    (r'kheesa|keesa|the grid', 'al-kheesa'), (r'umm salal', 'umm-salal'), (r'izghawa', 'izghawa'), (r'muaither', 'muaither'),
    (r'rawdat al hamama', 'rawdat-al-hamama'), (r'maamoura', 'al-maamoura'), (r'industrial area', 'industrial-area'), (r'al hilal|nuaija|d-ring', 'al-hilal'),
    (r'^al khor\b', 'al-khor'), (r'^al daayen', 'al-daayen-other'),
    (r'lusail', 'lusail'),
]


def area_for(tree):
    t = tree.lower()
    for pat, aid in PF_AREAS:
        if re.search(pat, t):
            return aid
    return None


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def tokens(s):
    s = re.sub(r'\bby\b.*$', '', (s or '').lower())
    return {w for w in re.findall(r'[a-z0-9]+', s) if w not in STOP and len(w) > 1}


def dist_m(a, b):
    if None in (a.get('lat'), a.get('lng'), b.get('lat'), b.get('lng')):
        return None
    R = 6371000
    p1, p2 = math.radians(a['lat']), math.radians(b['lat'])
    dl = math.radians(b['lng'] - a['lng'])
    dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def unit_type(r):
    t = r.get('type') or ''
    if t in COMMERCIAL:
        return COMMERCIAL[t]
    if t in ('Villa', 'Compound'):
        return 'villa'
    if t == 'Townhouse':
        return 'townhouse'
    if t == 'Penthouse':
        return 'penthouse'
    if t == 'Duplex':
        return 'duplex'
    if t == 'Land':
        return None
    beds = str(r.get('beds') or '').lower()
    if beds in ('studio', '0', ''):
        return 'studio'
    try:
        b = int(beds)
    except ValueError:
        return 'studio'
    return f'{min(b, 5)}br'


def is_place(name):
    """True when the text is just an area name (e.g. 'simaisma', 'al wukair')."""
    bare = re.sub(r'^al\s*', '', name.strip().lower())
    return any(re.fullmatch(f'(?:{pat})', bare) or re.fullmatch(f'(?:{pat})', name.strip().lower()) for pat, _ in PF_AREAS)


def is_building(r):
    """A named building/plot: sub-community or tower whose name is not just its parent district repeated."""
    if r.get('loc_type') not in ('SUBCOMMUNITY', 'TOWER'):
        return False
    parts = [x.strip().lower() for x in (r.get('tree') or '').split('>')]
    name = (r.get('loc') or '').strip().lower()
    if len(parts) >= 2 and parts[-2] == name or name in ('lusail city',):
        return False
    # A bare district name ("Muraikh", "Al Wukair") is not a building.
    bare = re.sub(r'^al\s*', '', name).strip()
    if any(re.fullmatch(f'(?:{pat})', bare) or re.fullmatch(f'(?:{pat})', name) for pat, _ in PF_AREAS):
        return False
    return True


def size_sqm(r):
    v = r.get('size')
    if not v:
        return None
    return v / SQFT if (r.get('unit') or 'sqm') == 'sqft' else v


def match_developer_project(r0, dev_projects):
    """The developer project a Property Finder location group belongs to, or None."""
    name = r0.get('loc') or ''
    tk = tokens(name)
    bldg = is_building(r0)
    if not tk or not (bldg or not is_place(name.lower())):
        return None
    loc = {'lat': r0.get('lat'), 'lng': r0.get('lng')}
    cands = []
    for p in dev_projects:
        pt = tokens(p['name_en'])
        if not pt:
            continue
        d = dist_m(loc, p)
        small = tk if len(tk) <= len(pt) else pt
        distinctive = len(small) >= 2 or any(len(w) >= 4 and w not in GENERIC and not is_place(w) for w in small)
        near = d is None or d < 3000
        if tk == pt and near and (bldg or any(w not in GENERIC for w in tk)):
            cands.append((0, d if d is not None else 9e9, p))
        elif (tk <= pt or pt <= tk) and distinctive and near:
            cands.append((1, d if d is not None else 9e9, p))
        elif bldg and d is not None and d < 400 and len([w for w in tk & pt if w not in GENERIC and not is_place(w)]) >= 2:
            cands.append((2, d, p))
    return sorted(cands, key=lambda c: (c[0], c[1]))[0][2] if cands else None


def phrase(name):
    """Regex for a project name as it would appear in a description, or None if too generic to trust."""
    core = re.sub(r'\s+by\s+.*$', '', name or '', flags=re.I).strip()
    words = [w for w in re.findall(r"[A-Za-z0-9']+", core)]
    meaningful = [w for w in words if w.lower() not in STOP and w.lower() not in GENERIC and not is_place(w)]
    if len(core) < 6 or not meaningful:
        return None
    return re.compile(r'\b' + r'[\s\-]+'.join(re.escape(w) for w in words) + r'\b', re.I)


def load_details():
    path = os.path.join(ROOT, 'data', 'raw', 'pf_offplan_details.json')
    if not os.path.exists(path):
        return {}
    return json.load(open(path, encoding='utf-8')).get('records', {})


def facts_to_fields(facts):
    """Accepted listing facts -> project fields (only status 'accepted' is used)."""
    ok = {k: v['value'] for k, v in facts.items() if v['status'] == 'accepted'}
    out = {}
    if 'developer' in ok:
        out['developer'] = ok['developer']
    if 'handover' in ok:
        out['handover'] = ok['handover']
    elif 'handover_year' in ok:
        out['handover'] = f"{ok['handover_year']}-12"
    for k in ('floors', 'units_total'):
        if k in ok:
            out[k] = ok[k]
    # A plan needs more than a down payment, or the rest of the schedule would be guessed.
    if 'down_pct' in ok and ('plan_years' in ok or 'handover_pct' in ok):
        parts = [f"{ok['down_pct']:g}% down payment"]
        if 'handover_pct' in ok:
            parts.append(f"{ok['handover_pct']}% on handover")
        years = f" ({ok['plan_years']} Years{' Post handover' if ok.get('post_handover') else ''} Installment)" if 'plan_years' in ok else ''
        out['payment_plan_en'] = 'Broker listings: ' + ', '.join(parts) + years
    return out


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    raw_path = os.path.join(ROOT, 'data', 'raw', 'pf_offplan_listings.json')
    if not os.path.exists(raw_path):
        print('no data/raw/pf_offplan_listings.json; nothing to do')
        return
    raw = json.load(open(raw_path, encoding='utf-8'))
    as_of = raw.get('as_of') or dt.date.today().isoformat()
    rows = [r for r in raw['records'] if r.get('cs') in (PRIMARY, UNSTATED)]
    # Drop obvious data-entry errors (price typed without zeros, monthly rents in a sale ad, whole-floor bulk prices).
    def plausible(r):
        sqm = size_sqm(r)
        if not r.get('price') or r['price'] < 150_000 or r['price'] > 300_000_000:
            return False
        if not sqm:
            return True
        lo, hi = (1_000, 80_000) if (r.get('type') in COMMERCIAL or r.get('cat') == 3) else (3_000, 60_000)
        return lo <= r['price'] / sqm <= hi
    dropped = [r for r in rows if not plausible(r)]
    rows = [r for r in rows if plausible(r)]

    path = os.path.join(ROOT, 'data', 'projects.json')
    doc = json.load(open(path, encoding='utf-8'))
    dev_projects = [p for p in doc['records'] if p.get('source_kind', 'developer') == 'developer']

    # Group by the most specific location Property Finder gives (sub-community = building/plot).
    groups = {}
    for r in rows:
        ut = unit_type(r)
        if ut is None:
            continue
        r['ut'], r['sqm'] = ut, size_sqm(r)
        groups.setdefault(r['loc_id'] or r['loc_full'], []).append(r)

    def stats(rs):
        prim = [r for r in rs if r['cs'] == PRIMARY]
        mix = {}
        for r in prim:
            if r.get('price') and r['sqm'] and r['sqm'] >= 15:
                mix.setdefault(r['ut'], []).append(r)
        unit_mix = []
        for ut, xs in sorted(mix.items()):
            ppsqm = sorted(x['price'] / x['sqm'] for x in xs)
            sizes = sorted(x['sqm'] for x in xs)
            prices = sorted(x['price'] for x in xs)
            unit_mix.append({'type': ut, 'size_sqm_min': round(statistics.median(sizes)), 'size_sqm_max': round(sizes[-1]),
                             'price_from_qar': round(statistics.median(prices)), 'price_min_qar': prices[0],
                             'ppsqm_median': round(statistics.median(ppsqm)), 'n': len(xs)})
        return {'listings': len(rs), 'first_sale': len(prim), 'unstated': len(rs) - len(prim),
                'brokers': len({r.get('broker') for r in rs if r.get('broker')}), 'direct_from_developer': sum(1 for r in rs if r.get('dev')),
                'latest_listed': max((r.get('listed') or '')[:10] for r in rs), 'unit_mix': unit_mix,
                'search_url': f'https://www.propertyfinder.qa/en/search?c=1&l={rs[0]["loc_id"]}' if rs[0].get('loc_id') else None,
                'sample_urls': [r['url'] for r in rs[:3]]}

    for p in doc['records']:
        p.pop('broker_listings', None)
        p.pop('listing_facts', None)
        p.pop('facts_fill', None)

    # 1. Decide where each location group belongs: a developer project, or a new broker project.
    target_of, info = {}, {}
    for key, rs in groups.items():
        r0 = rs[0]
        name = r0.get('loc') or ''
        best = match_developer_project(r0, dev_projects)
        target_of[key] = ('dev', best['id']) if best else ('new', key)
        info[key] = {'name': name, 'lat': r0.get('lat'), 'lng': r0.get('lng'), 'building': is_building(r0)}

    # 2. Listings whose description names a different project are moved there (brokers often file
    #    units under the wrong building). Needs data/raw/pf_offplan_details.json.
    details = load_details()
    aliases = lf.load_aliases(ROOT)
    by_target = {}
    name_index = []  # (compiled phrase, target, lat, lng)
    for p in dev_projects:
        ph = phrase(p['name_en'])
        if ph:
            name_index.append((ph, ('dev', p['id']), p.get('lat'), p.get('lng')))
    for key, rs in groups.items():
        if target_of[key][0] == 'new' and info[key]['building'] and len(rs) >= 3:
            ph = phrase(info[key]['name'])
            if ph:
                name_index.append((ph, ('new', key), info[key]['lat'], info[key]['lng']))
    moved = 0
    for key, rs in groups.items():
        own = target_of[key]
        for r in rs:
            tgt = own
            d = details.get(str(r['id']))
            if d:
                text = f"{d.get('t', '')}. {d.get('d', '')}"
                hits = {t for ph, t, la, ln in name_index if ph.search(text) and (la is None or r.get('lat') is None or dist_m({'lat': r['lat'], 'lng': r['lng']}, {'lat': la, 'lng': ln}) < 3000)}
                if hits and own not in hits and len(hits) == 1:
                    tgt = next(iter(hits))
                    moved += 1
                r['facts'] = lf.extract(text, aliases)
                r['direct'] = bool(d.get('dev'))
            by_target.setdefault(tgt, []).append(r)

    # 3. Build projects from each target's listings.
    dev_by_id = {p['id']: p for p in dev_projects}
    new, matched, filled = [], 0, Counter()
    for tgt, rs in by_target.items():
        st = stats(rs)
        facts = lf.building_facts([(r.get('facts') or {}, r.get('broker'), r.get('direct'), r['id']) for r in rs if 'facts' in r])
        st['facts_from'] = sum(1 for r in rs if 'facts' in r)
        fill = facts_to_fields(facts)
        if tgt[0] == 'dev':
            p = dev_by_id[tgt[1]]
            st['building'] = ', '.join(sorted({info[k]['name'] for k, t in target_of.items() if t == tgt})) or None
            p['broker_listings'] = st
            p['listing_facts'] = facts
            # Developer-listed projects keep Property Finder's own developer; only empty fields are filled.
            p['facts_fill'] = {k: v for k, v in fill.items() if k != 'developer' and not p.get(k)}
            filled.update(p['facts_fill'].keys())
            matched += 1
            continue
        key = tgt[1]
        r0 = groups[key][0]
        name = info[key]['name']
        tree = r0.get('tree') or r0.get('loc_full') or ''
        building = info[key]['building']
        types = {r['ut'] for r in rs}
        commercial = types <= {'office', 'shop', 'warehouse', 'building', 'hotel_apartment'}
        rec = {
            'id': f'pf-{slug(name)}-{r0.get("loc_id")}',
            'name_en': name if building else f'{name}: off-plan listings',
            'developer': 'Not stated (broker listings)',
            'area_id': area_for(tree),
            'pf_location': tree,
            'lat': round(r0['lat'], 5) if r0.get('lat') else None, 'lng': round(r0['lng'], 5) if r0.get('lng') else None,
            'status': 'off_plan', 'handover': None, 'units_total': None, 'floors': None,
            'unit_mix': st['unit_mix'], 'views': [], 'stock': 'available',
            'source': 'Property Finder Qatar, broker off-plan listings',
            'source_url': st['search_url'] or r0.get('url'),
            'as_of': as_of,
            'confidence': 'medium' if st['first_sale'] >= 3 and building else 'low',
            'source_kind': 'broker', 'price_basis': 'median_listing',
            'segment': 'commercial' if commercial else 'residential',
            'location_quality': 'building' if building else 'district',
            'broker_listings': st, 'listing_facts': facts,
        }
        # A developer named in the building's own name ("Burj DAMAC ...", "Al Asmakh Lusail 2") counts as stated.
        if 'developer' not in fill:
            hits = sorted({nm for nm, grp, pats in aliases if any(pt.search(name) for pt in pats)})
            if len(hits) == 1:
                fill['developer'] = hits[0]
                rec['listing_facts'] = {**facts, 'developer': {'value': hits[0], 'status': 'accepted', 'brokers': 0, 'direct': 0, 'listings': 0,
                                                               'disagreeing_brokers': 0, 'sample_ids': [], 'from_name': True}}
        for k, v in fill.items():
            rec[k] = v
        rec['facts_fill'] = fill
        filled.update(fill.keys())
        new.append(rec)
    # Items for a person to check: listing text that disagrees with the project's published values,
    # developer names that fell short of the agreement rule, and buildings tagged off-plan with no first-sale prices.
    researched = set()
    rpath = os.path.join(ROOT, 'data', 'developer_research.csv')
    if os.path.exists(rpath):
        import csv
        with open(rpath, encoding='utf-8-sig', newline='') as fh:
            researched = {(r.get('id') or '').strip() for r in csv.DictReader(fh) if (r.get('developer') or '').strip()}
    review = []
    for p in dev_projects + new:
        f = p.get('listing_facts') or {}
        h = f.get('handover')
        if h and h['status'] == 'accepted' and p.get('handover') and h['value'] != p['handover']:
            review.append({'id': p['id'], 'name': p['name_en'], 'kind': 'handover_conflict', 'current': p['handover'], 'listings': h['value'], 'brokers': h['brokers']})
        d = f.get('developer')
        if d and d['status'] == 'candidate' and p.get('source_kind') == 'broker' and p['id'] not in researched and 'developer' not in (p.get('facts_fill') or {}):
            review.append({'id': p['id'], 'name': p['name_en'], 'kind': 'developer_candidate', 'current': p.get('developer'), 'listings': d['value'], 'brokers': d['brokers']})
        bl = p.get('broker_listings') or {}
        if p.get('source_kind') == 'broker' and bl.get('listings', 0) >= 3 and bl.get('first_sale', 0) == 0:
            review.append({'id': p['id'], 'name': p['name_en'], 'kind': 'no_first_sale', 'current': None, 'listings': bl['listings'], 'brokers': bl.get('brokers')})
    with open(os.path.join(ROOT, 'data', 'review.json'), 'w', encoding='utf-8') as f:
        json.dump({'as_of': as_of, 'records': review}, f, ensure_ascii=False, indent=1)
    print(f'review items: {len(review)}')

    unmapped = [p['name_en'] for p in new if not p['area_id']]
    doc['records'] = [p for p in doc['records'] if p.get('source_kind', 'developer') == 'developer'] + sorted(new, key=lambda p: (p['area_id'] or 'zz', p['name_en']))
    doc['broker_as_of'] = as_of
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f'dropped {len(dropped)} listings with implausible price or size')
    print(f'off-plan listings: {len(rows)} in {len(groups)} locations; {moved} moved to the project their text names; '
          f'{matched} developer projects with broker listings; {len(new)} broker projects')
    print(f'details for {len(details)} listings; fields filled from agreed listing text: {dict(filled)}')
    if unmapped:
        print('UNMAPPED locations (add a pattern to PF_AREAS):', '; '.join(unmapped[:20]))


if __name__ == '__main__':
    main()
