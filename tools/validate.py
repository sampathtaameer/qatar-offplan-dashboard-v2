"""Validate every data/*.json file the site loads. Exit code 1 on any error.

Usage: python -I tools/validate.py [project_root]
Run after every refresh and before committing; the weekly routine refuses to commit on failure.
"""
import datetime as dt
import json
import os
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..'))
QATAR = (24.4, 26.3, 50.7, 51.8)  # lat min/max, lng min/max
REGIMES = {'freehold', 'usufruct', 'qatari_only'}
STATUSES = {'off_plan', 'under_construction', 'launched', 'completed'}
CONF = {None, 'high', 'medium', 'low'}
UTYPES = {'studio', '1br', '2br', '3br', '4br', '5br', 'villa', 'townhouse', 'penthouse', 'duplex', 'office', 'shop', 'warehouse', 'building', 'hotel_apartment'}
PTYPES = {'unit', 'villa', 'land', 'building', 'commercial', 'other'}

errors, warnings = [], []


def err(f, msg):
    errors.append(f'{f}: {msg}')


def warn(f, msg):
    warnings.append(f'{f}: {msg}')


def load(name):
    path = os.path.join(ROOT, 'data', f'{name}.json')
    try:
        return json.load(open(path, encoding='utf-8'))
    except Exception as e:  # noqa: BLE001
        err(name, f'cannot parse: {e}')
        return None


def is_date(s):
    try:
        dt.date.fromisoformat(s)
        return True
    except (TypeError, ValueError):
        return False


def in_qatar(r):
    return isinstance(r.get('lat'), (int, float)) and isinstance(r.get('lng'), (int, float)) and \
        QATAR[0] <= r['lat'] <= QATAR[1] and QATAR[2] <= r['lng'] <= QATAR[3]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    d = {n: load(n) for n in ('areas', 'projects', 'transactions', 'deals', 'rents', 'pipeline', 'poi', 'noise', 'rules', 'changes')}
    if errors:
        return finish()

    for n, v in d.items():
        if n != 'noise' and not isinstance(v.get('records', v.get('residency')), list):
            err(n, 'missing records list')
        if not is_date(v.get('as_of')):
            err(n, f'as_of missing or not ISO date: {v.get("as_of")!r}')

    areas = {a['id']: a for a in d['areas']['records']}
    for a in d['areas']['records']:
        for k in ('id', 'name_en', 'name_ar', 'municipality', 'regime'):
            if not a.get(k):
                err('areas', f'{a.get("id")}: missing {k}')
        if a.get('regime') not in REGIMES:
            err('areas', f'{a["id"]}: bad regime {a.get("regime")}')
        if not in_qatar(a):
            err('areas', f'{a["id"]}: coordinates outside Qatar')
        if a.get('comps_area') and a['comps_area'] not in areas:
            err('areas', f'{a["id"]}: comps_area {a["comps_area"]} not found')
        if a.get('confidence') not in CONF:
            err('areas', f'{a["id"]}: bad confidence')

    aliases = json.load(open(os.path.join(ROOT, 'data', 'district_aliases.json'), encoding='utf-8'))
    for k, v in aliases.items():
        if v not in areas:
            err('district_aliases', f'{k} -> unknown area {v}')

    ids = set()
    for p in d['projects']['records']:
        pid = p.get('id')
        if pid in ids:
            err('projects', f'duplicate id {pid}')
        ids.add(pid)
        if p.get('area_id') not in areas:
            (warn if p.get('source_kind') == 'broker' else err)('projects', f'{pid}: unknown area_id {p.get("area_id")}')
        if p.get('status') not in STATUSES:
            err('projects', f'{pid}: bad status {p.get("status")}')
        if not in_qatar(p):
            (warn if p.get('source_kind') == 'broker' else err)('projects', f'{pid}: coordinates outside Qatar')
        for u in p.get('unit_mix') or []:
            if u.get('type') not in UTYPES:
                err('projects', f'{pid}: bad unit type {u.get("type")}')
            price, size = u.get('price_from_qar'), u.get('size_sqm_min')
            if price is not None and not (100_000 <= price <= 100_000_000):
                err('projects', f'{pid}: implausible price {price}')
            if price and size and not (2_000 <= price / size <= 60_000):
                warn('projects', f'{pid}: unusual QAR/sqm {price / size:,.0f} ({u.get("type")})')
        if not p.get('unit_mix'):
            warn('projects', f'{pid}: no unit mix')

    for name, minimum in (('transactions', 1000), ('deals', 1000), ('projects', 10), ('rents', 20), ('areas', 20)):
        if len(d[name]['records']) < minimum:
            err(name, f'only {len(d[name]["records"])} records (expected >= {minimum}); a fetch probably failed')

    weeks = set()
    for r in d['transactions']['records']:
        if not is_date(r.get('week')):
            err('transactions', f'bad week {r.get("week")}')
            continue
        weeks.add(r['week'])
        if r.get('area_id') is not None and r['area_id'] not in areas:
            err('transactions', f'unknown area_id {r["area_id"]}')
        if r.get('property_type') not in PTYPES:
            err('transactions', f'bad property_type {r.get("property_type")}')
        if not isinstance(r.get('count'), int) or r['count'] < 1 or (r.get('value_qar') or 0) <= 0:
            err('transactions', f'bad count/value in {r["week"]} {r.get("area_id") or r.get("district")}')
    if weeks:
        latest = max(weeks)
        total = sum(r['value_qar'] for r in d['transactions']['records'] if r['week'] == latest)
        if not (50e6 <= total <= 5e9):
            err('transactions', f'latest week {latest} total QAR {total:,.0f} outside plausible range')
        age = (dt.date.today() - dt.date.fromisoformat(latest)).days
        if age > 21:
            warn('transactions', f'latest week {latest} is {age} days old')

    for row in d['deals']['records']:
        date, area, sqm, value = row
        if not is_date(date) or not sqm or not value:
            err('deals', f'bad row {row}')
            break
        if not str(area).startswith('?') and area not in areas:
            err('deals', f'unknown area {area}')
            break
    unmapped = sum(1 for r in d['deals']['records'] if str(r[1]).startswith('?'))
    if unmapped:
        warn('deals', f'{unmapped} deals in districts not in district_aliases.json')

    for r in d['rents']['records']:
        if r.get('area_id') not in areas:
            err('rents', f'unknown area {r.get("area_id")}')
        if r.get('unit_type') not in UTYPES:
            err('rents', f'bad unit_type {r.get("unit_type")}')
        if not (500 <= (r.get('median_qar_month') or 0) <= 100_000):
            err('rents', f'{r.get("area_id")} {r.get("unit_type")}: implausible rent {r.get("median_qar_month")}')

    for r in d['pipeline']['records']:
        if r.get('area_id') not in areas or not isinstance(r.get('year'), int) or not isinstance(r.get('units'), int):
            err('pipeline', f'bad record {r}')

    kinds = {}
    for r in d['poi']['records']:
        kinds[r.get('type')] = kinds.get(r.get('type'), 0) + 1
        if not in_qatar(r):
            err('poi', f'{r.get("id")}: outside Qatar')
    for k, minimum in (('metro', 30), ('school', 50), ('hospital', 20), ('mall', 20), ('beach', 10)):
        if kinds.get(k, 0) < minimum:
            err('poi', f'only {kinds.get(k, 0)} {k} records (expected >= {minimum})')

    if len(d['noise'].get('runways') or []) < 2:
        err('noise', 'fewer than 2 runways')

    tiers = d['rules'].get('residency') or []
    if not tiers or any(not isinstance(t.get('threshold_qar'), (int, float)) for t in tiers):
        err('rules', 'residency tiers missing thresholds')
    if {r['id'] for r in d['rules'].get('regimes', [])} != REGIMES:
        err('rules', 'regimes must be exactly freehold, usufruct, qatari_only')
    used = {a['regime'] for a in areas.values()}
    if not used <= REGIMES:
        err('areas', f'unknown regimes {used - REGIMES}')

    # ---- v2 files ----
    import csv
    for p in d['projects']['records']:
        if p.get('location_quality') not in ('building', 'district', 'generic'):
            err('projects', f'{p.get("id")}: location_quality missing; run tools/apply_overrides.py')
        for pl in p.get('payment_plans') or []:
            tot = sum(pl.get(k, 0) for k in ('down', 'during', 'handover', 'after'))
            if abs(tot - 1) > 0.01:
                err('projects', f'{p.get("id")}: payment plan "{pl.get("label")}" sums to {tot:.2f}')
    pids = {p['id'] for p in d['projects']['records']}
    with open(os.path.join(ROOT, 'data', 'project_overrides.csv'), encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            if row.get('id') and row['id'] not in pids:
                warn('project_overrides.csv', f'unknown project id {row["id"]} (project no longer listed?)')
            if row.get('area_id') and row['area_id'] not in areas:
                err('project_overrides.csv', f'{row["id"]}: unknown area_id {row["area_id"]}')
            if row.get('lat') and not in_qatar({'lat': float(row['lat']), 'lng': float(row.get('lng') or 0)}):
                err('project_overrides.csv', f'{row["id"]}: coordinates outside Qatar')
    need = {'project', 'name_en', 'area_id', 'unit_type', 'size_sqm', 'price_qar'}
    with open(os.path.join(ROOT, 'data', 'taameer_projects.csv'), encoding='utf-8-sig', newline='') as f:
        rd = csv.DictReader(f)
        if not need <= set(rd.fieldnames or []):
            err('taameer_projects.csv', f'missing columns {need - set(rd.fieldnames or [])}')
        for row in rd:
            if row.get('area_id') and row['area_id'] not in areas:
                err('taameer_projects.csv', f'{row.get("project")}: unknown area_id {row["area_id"]}')
            if row.get('unit_type') and row['unit_type'] not in UTYPES:
                err('taameer_projects.csv', f'{row.get("project")}: bad unit_type {row["unit_type"]}')
    a = json.load(open(os.path.join(ROOT, 'data', 'assumptions.json'), encoding='utf-8'))
    for k, lo, hi in (('service_charge_qar_sqm_month', 0, 100), ('vacancy', 0, 0.5), ('purchase_fees', 0, 0.2), ('selling_costs', 0, 0.2),
                      ('price_growth_pa', -0.3, 0.3), ('discount_rate', 0, 0.5), ('hold_years_after_handover', 0, 30)):
        if not isinstance(a.get(k), (int, float)) or not (lo <= a[k] <= hi):
            err('assumptions', f'{k} missing or outside {lo}..{hi}')
    h = json.load(open(os.path.join(ROOT, 'data', 'project_history.json'), encoding='utf-8'))
    if not h.get('records'):
        err('project_history', 'empty; run tools/snapshot.py')
    w = json.load(open(os.path.join(ROOT, 'data', 'watchlist.json'), encoding='utf-8'))
    for i in w.get('ids', []):
        if i not in pids:
            warn('watchlist', f'unknown project id {i}')

    for c in d['changes']['records']:
        if not is_date(c.get('date')) or not c.get('items'):
            err('changes', f'bad entry {c.get("date")}')

    return finish()


def finish():
    for w in warnings:
        print('WARN ', w)
    for e in errors:
        print('ERROR', e)
    print(f'{len(errors)} errors, {len(warnings)} warnings')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
