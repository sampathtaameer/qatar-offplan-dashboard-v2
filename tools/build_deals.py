"""Parse MoJ weekly residential-unit CSVs (data/raw/moj/*.csv) into data/deals.json (one row per unit sale).
Run tools/build_market.py afterwards to rebuild data/transactions.json.

Usage: python -I tools/build_deals.py [project_root]

The MoJ files vary week to week: comma or semicolon delimiters, English or Arabic headers,
m/d/yyyy or d/m/yyyy dates, trailing empty columns. Columns are found by header keywords,
and date order is chosen so the dates fall inside the week in the file name.
District names are mapped to area ids via data/district_aliases.json; unmapped names are
reported so the alias table can be extended.
"""
import csv
import datetime as dt
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from district_map import area_for  # noqa: E402

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..'))
RAW = os.path.join(ROOT, 'data', 'raw', 'moj')
SOURCE = 'Ministry of Justice, Weekly Real Estate Bulletin for residential units'
SOURCE_URL = 'https://moj.gov.qa/en/opendata'

KEYS = {
    'ref': ['reference transaction', 'رقم المعاملة'],
    'date': ['regist', 'register', 'تاريخ'],
    'muni': ['municipality', 'البلدية'],
    'zone': ['district', 'zone', 'اسم المنطقة'],
    'type': ['type', 'نوع'],
    'sqm': ['area', 'المساحة'],
    'ppsqm': ['per square', 'سعر المتر'],
    'value': ['value', 'قيمة'],
}


def decode(raw):
    for enc in ('utf-8-sig', 'cp1256'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('latin-1')


def num(s):
    s = (s or '').replace(',', '').replace('"', '').strip()
    try:
        return float(s)
    except ValueError:
        return None


def week_from_name(name):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})_to_(\d{4})-(\d{2})-(\d{2})', name)
    if not m:
        return None, None
    y1, m1, d1, y2, m2, d2 = map(int, m.groups())
    return dt.date(y1, m1, d1), dt.date(y2, m2, d2)


def parse_date(s, start, end):
    s = s.strip().split(' ')[0]
    parts = re.split(r'[/.-]', s)
    if len(parts) != 3:
        return None
    a, b, c = parts
    cands = []
    for y, mth, d in ((c, a, b), (c, b, a), (a, b, c)):  # m/d/y, d/m/y, y-m-d
        try:
            y = int(y)
            y = y + 2000 if y < 100 else y
            cands.append(dt.date(y, int(mth), int(d)))
        except ValueError:
            pass
    if not cands:
        return None
    if start:
        lo, hi = start - dt.timedelta(days=7), end + dt.timedelta(days=7)
        inside = [x for x in cands if lo <= x <= hi]
        if inside:
            return inside[0]
    return cands[0]


def find_cols(header):
    h = [x.strip().lower() for x in header]
    cols = {}
    for key, words in KEYS.items():
        for i, name in enumerate(h):
            if i in cols.values():
                continue
            if any(w in name for w in words):
                # 'area' also matches nothing else we need, but guard 'per square' vs 'square meters'
                if key == 'sqm' and ('price' in name or 'سعر' in name):
                    continue
                cols[key] = i
                break
    return cols


def read_file(path):
    text = decode(open(path, 'rb').read())
    first = text.splitlines()[0] if text else ''
    delim = ';' if first.count(';') > first.count(',') else ','
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    if not rows:
        return []
    cols = find_cols(rows[0])
    need = {'date', 'zone', 'sqm', 'value'}
    if not need.issubset(cols):
        print(f'SKIP {os.path.basename(path)}: missing columns {need - set(cols)}', file=sys.stderr)
        return []
    start, end = week_from_name(os.path.basename(path))
    out = []
    for r in rows[1:]:
        if len(r) <= max(cols.values()) or not r[cols['zone']].strip():
            continue
        sqm, value = num(r[cols['sqm']]), num(r[cols['value']])
        d = parse_date(r[cols['date']], start, end)
        if not sqm or not value or not d:
            continue
        out.append({
            'ref': r[cols['ref']].strip() if 'ref' in cols else '',
            'date': d.isoformat(),
            'week': (start or d).isoformat(),
            'municipality': r[cols['muni']].strip() if 'muni' in cols else '',
            'district': re.sub(r'\s+', ' ', r[cols['zone']]).strip(),
            'sqm': sqm,
            'value': value,
        })
    return out


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    aliases_path = os.path.join(ROOT, 'data', 'district_aliases.json')
    aliases = json.load(open(aliases_path, encoding='utf-8')) if os.path.exists(aliases_path) else {}

    deals, seen = [], set()
    for name in sorted(os.listdir(RAW)):
        if not name.lower().endswith('.csv'):
            continue
        for d in read_file(os.path.join(RAW, name)):
            key = (d['ref'], d['date'], d['district'], d['sqm'], d['value']) if d['ref'] else None
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            deals.append(d)

    unmapped = {}
    for d in deals:
        area = area_for(d['district'], d['municipality'], aliases)
        d['area_id'] = area
        if not area:
            unmapped[d['district']] = unmapped.get(d['district'], 0) + 1

    deals.sort(key=lambda d: d['date'])
    as_of = deals[-1]['week'] if deals else None

    # Compact per-deal file: [date, area_id, sqm, value]
    with open(os.path.join(ROOT, 'data', 'deals.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'as_of': as_of, 'source': SOURCE, 'source_url': SOURCE_URL,
            'fields': ['date', 'area_id', 'sqm', 'value_qar'],
            'records': [[d['date'], d['area_id'] or ('?' + d['district']), round(d['sqm'], 1), round(d['value'])] for d in deals],
        }, f, ensure_ascii=False, separators=(',', ':'))

    weeks = sorted({d['week'] for d in deals})
    print(f'{len(deals)} deals, {len(weeks)} weeks ({weeks[0] if weeks else "-"} to {weeks[-1] if weeks else "-"})')
    if unmapped:
        print('UNMAPPED districts (add to data/district_aliases.json):')
        for k, v in sorted(unmapped.items(), key=lambda x: -x[1]):
            print(f'  {v:5d}  {k}')


if __name__ == '__main__':
    main()
