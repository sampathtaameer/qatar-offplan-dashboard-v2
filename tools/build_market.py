"""Build data/transactions.json: weekly registered sales per district and property category.

Usage: python -I tools/build_market.py [project_root]

Inputs:
  data/raw/moj-all/*.csv  MoJ Weekly Real Estate Bulletin (land, villas, buildings, shops...)
  data/raw/moj/*.csv      MoJ Weekly Real Estate Bulletin for residential units
A few all-types files are actually unit-format bulletins (no share columns); they are
skipped because the unit bulletin already covers them.
Value uses Property Value, the basis of MoJ's own weekly totals (checked: 27 Sep-1 Oct 2026
sums to QAR 464,182,516 + 44,086,614 units = 508,269,130, matching the press release).
"""
import csv
import io
import json
import os
import re
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_deals as bd  # noqa: E402
from district_map import area_for, norm_muni as _norm_muni  # noqa: E402

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..'))
SOURCE = 'Ministry of Justice, Weekly Real Estate Bulletin'
SOURCE_URL = 'https://moj.gov.qa/en/opendata'


def category(t):
    t = t.lower()
    if 'land' in t:
        return 'land'
    if 'unit' in t:
        return 'unit'
    if 'shop' in t or 'commercial' in t or 'hotel' in t or 'service' in t or 'administrative' in t:
        return 'commercial'
    if 'building' in t or 'complex' in t:
        return 'building'
    if any(w in t for w in ('villa', 'house', 'residence', 'home', 'palace')):
        return 'villa'
    return 'other'


def col(h, *words, exclude=()):
    for i, name in enumerate(h):
        if all(w in name for w in words) and not any(x in name for x in exclude):
            return i
    return None


def read_all_types(path):
    text = bd.decode(open(path, 'rb').read())
    first = text.splitlines()[0] if text else ''
    delim = ';' if first.count(';') > first.count(',') else ','
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    h = [x.strip().lower() for x in rows[0]]
    if not any('share' in x for x in h):
        return None  # unit-format file
    c = {
        'date': col(h, 'regist') if col(h, 'regist') is not None else col(h, 'register'),
        'muni': col(h, 'municipality name'),
        'zone': col(h, 'district') if col(h, 'district') is not None else col(h, 'zone'),
        'type': col(h, 'type', exclude=('municipality',)) if col(h, 'property type') is not None else col(h, 'real estate type'),
        'sqm': col(h, 'area', exclude=('share',)),
        'share_value': col(h, 'value', 'share'),
        'value': col(h, 'property value') if col(h, 'property value') is not None else col(h, 'real estate value'),
    }
    if c['type'] is None:
        c['type'] = col(h, 'real estate type')
    start, end = bd.week_from_name(os.path.basename(path))
    out = []
    for r in rows[1:]:
        if c['zone'] is None or len(r) <= c['zone'] or not r[c['zone']].strip():
            continue
        v = bd.num(r[c['value']]) if c['value'] is not None and c['value'] < len(r) else None
        v = v or (bd.num(r[c['share_value']]) if c['share_value'] is not None and c['share_value'] < len(r) else None)
        if not v:
            continue
        out.append({
            'week': (start.isoformat() if start else bd.parse_date(r[c['date']], None, None).isoformat()),
            'municipality': r[c['muni']].strip() if c['muni'] is not None else '',
            'district': re.sub(r'\s+', ' ', r[c['zone']]).strip(),
            'category': category(r[c['type']] if c['type'] is not None else ''),
            'sqm': bd.num(r[c['sqm']]) if c['sqm'] is not None and c['sqm'] < len(r) else None,
            'value': v,
        })
    return out


def norm_muni(m):
    return _norm_muni(m)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    aliases = json.load(open(os.path.join(ROOT, 'data', 'district_aliases.json'), encoding='utf-8'))
    rows, skipped = [], 0
    for name in sorted(os.listdir(os.path.join(ROOT, 'data', 'raw', 'moj-all'))):
        r = read_all_types(os.path.join(ROOT, 'data', 'raw', 'moj-all', name))
        if r is None:
            skipped += 1
            continue
        rows.extend(r)
    for name in sorted(os.listdir(bd.RAW)):
        for d in bd.read_file(os.path.join(bd.RAW, name)):
            rows.append({'week': d['week'], 'municipality': d['municipality'], 'district': d['district'],
                         'category': 'unit', 'sqm': d['sqm'], 'value': d['value']})

    groups = {}
    for r in rows:
        area = area_for(r['district'], r['municipality'], aliases)
        key = (r['week'], area or '', norm_muni(r['municipality']), r['district'] if not area else '', r['category'])
        groups.setdefault(key, []).append(r)

    records = []
    for (week, area, muni, district, cat), rs in sorted(groups.items()):
        rec = {'week': week, 'area_id': area or None, 'municipality': muni, 'property_type': cat,
               'count': len(rs), 'value_qar': round(sum(x['value'] for x in rs))}
        if not area:
            rec['district'] = district
        ppsqm = [x['value'] / x['sqm'] for x in rs if x['sqm']]
        if ppsqm and cat in ('unit', 'land', 'villa'):
            rec['ppsqm_median_qar'] = round(statistics.median(ppsqm))
        records.append(rec)

    weeks = sorted({r['week'] for r in records})
    out = {'as_of': weeks[-1] if weeks else None, 'source': SOURCE, 'source_url': SOURCE_URL,
           'notes': 'One record per week x area (or unmapped district) x property category.',
           'records': records}
    with open(os.path.join(ROOT, 'data', 'transactions.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    tot = sum(r['value_qar'] for r in records if r['week'] == weeks[-1])
    print(f'{len(rows)} deals -> {len(records)} weekly records, {len(weeks)} weeks; skipped {skipped} unit-format files')
    print(f'latest week {weeks[-1]}: QAR {tot:,.0f}')


if __name__ == '__main__':
    main()
