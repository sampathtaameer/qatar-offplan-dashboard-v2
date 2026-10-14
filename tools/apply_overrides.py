"""Apply data/project_overrides.csv to data/projects.json and add derived fields the site needs.

Usage: python -I tools/apply_overrides.py [project_root]

Runs after every Property Finder refresh (tools/refresh.py calls it), and on its own after you
edit the CSV. It is safe to run more than once: the original listing values are kept under
`listing` so an override can be removed later.

What it adds to each project:
  - values from the override sheet (units_total, floors, handover, status, area_id, lat, lng)
  - location_quality: building (listing pin), district (placed in the right district, not on
    the building) or generic (Property Finder city centroid; sun/noise/distances unreliable)
  - payment_plans: the published payment-plan text parsed into percentages, so the site can
    build a cash flow. Where the published shares do not add up to 100%, the remainder is
    assumed to be paid in equal instalments over the stated years (flagged remainder_assumed).
  - developer names cleaned of non-breaking spaces.
"""
import csv
import json
import os
import re
import sys

ROOT = os.path.abspath(next((a for a in sys.argv[1:] if not a.startswith('--')), os.path.join(os.path.dirname(__file__), '..')))
FIELDS_INT = ('units_total', 'floors')
FIELDS_STR = ('handover', 'status', 'area_id', 'location_quality', 'developer', 'name_en')
PHASES = {
    'down payment': 'down',
    'during construction': 'during',
    'on handover': 'handover',
    'after handover': 'after',
}
PHASE_RE = re.compile(r'(\d+(?:\.\d+)?)\s*%\s*(down payment|during construction|on handover|after handover)(\s*\(([^)]*)\))?', re.I)
YEARS_RE = re.compile(r'(\d+)\s*(?:up to\s*(\d+)\s*)?years?|years?\s*from\s*(\d+)(?:\s*up to\s*(\d+))?', re.I)
POST_RE = re.compile(r'post[\s-]*handover', re.I)


def clean_name(s):
    return re.sub(r'[   ]', ' ', s or '').strip()


def parse_plans(text):
    """'Standard: 5% down payment, 75% during construction, 20% after handover' -> list of dicts."""
    plans = []
    for option in [o.strip() for o in (text or '').split('·') if o.strip()]:
        label, _, body = option.partition(':')
        if not body:
            label, body = 'Standard', option
        plan = {'label': label.strip() or 'Standard', 'down': 0.0, 'during': 0.0, 'handover': 0.0, 'after': 0.0,
                'years_during': None, 'years_after': None, 'remainder_assumed': False, 'text': option}
        for m in PHASE_RE.finditer(body):
            key = PHASES[m.group(2).lower()]
            plan[key] += float(m.group(1)) / 100
            note = m.group(4) or ''
            years = years_in(note)
            if years:
                if key == 'after' or POST_RE.search(note):
                    plan['years_after'] = years
                elif key in ('during', 'down'):
                    plan['years_during'] = years
        total = plan['down'] + plan['during'] + plan['handover'] + plan['after']
        if total < 0.995:
            # e.g. "10% down payment (5 Years Installment)": the rest is paid in instalments.
            rest = 1 - total
            years = years_in(body)
            if POST_RE.search(body):
                plan['after'] += rest
                plan['years_after'] = plan['years_after'] or years
            else:
                plan['during'] += rest
                plan['years_during'] = plan['years_during'] or years
            plan['remainder_assumed'] = True
        if total > 1.005:
            continue  # unparseable / inconsistent text; leave it to the published text
        for k in ('down', 'during', 'handover', 'after'):
            plan[k] = round(plan[k], 4)
        plans.append(plan)
    return plans


def years_in(text):
    """Longest instalment period mentioned: '5 Years', 'from 3 up to 5 years', 'years from 7 up to 8'."""
    m = YEARS_RE.search(text or '')
    if not m:
        return None
    vals = [int(g) for g in m.groups() if g]
    return max(vals) if vals else None


def num(s, cast=float):
    s = (s or '').strip()
    if not s:
        return None
    try:
        return cast(float(s))
    except ValueError:
        return None


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    path = os.path.join(ROOT, 'data', 'projects.json')
    doc = json.load(open(path, encoding='utf-8'))
    # Two layers: data/developer_research.csv (sourced research, maintained by Claude) first, then
    # data/project_overrides.csv (your corrections) on top. A non-empty cell in the second wins.
    overrides = {}
    for fname, layer in (('developer_research.csv', 'research'), ('project_overrides.csv', 'override')):
        ov_path = os.path.join(ROOT, 'data', fname)
        if not os.path.exists(ov_path):
            continue
        with open(ov_path, encoding='utf-8-sig', newline='') as f:
            for row in csv.DictReader(f):
                pid = (row.get('id') or '').strip()
                if not pid:
                    continue
                merged = overrides.setdefault(pid, {'_layers': []})
                merged['_layers'].append({'layer': layer, 'source': (row.get('source') or '').strip(), 'source_url': (row.get('source_url') or '').strip(),
                                          'note': (row.get('note') or '').strip(), 'confidence': (row.get('confidence') or '').strip()})
                for k, v in row.items():
                    if k and (v or '').strip():
                        merged[k] = v

    ids = {p['id'] for p in doc['records']}
    for pid in overrides:
        if pid not in ids:
            print(f'WARN override for unknown project id: {pid}', file=sys.stderr)

    applied = 0
    for p in doc['records']:
        p['developer'] = clean_name(p.get('developer'))
        listing = p.setdefault('listing', {})
        # Remember the listing's own values once, so overrides can be undone.
        for k in (*FIELDS_INT, 'handover', 'status', 'area_id', 'lat', 'lng', 'developer', 'name_en'):
            listing.setdefault(k, p.get(k))
        # Start from listing values every run, then fill gaps from agreed broker-listing facts
        # (tools/build_broker_projects.py), then apply the sheet.
        for k, v in listing.items():
            p[k] = v
        for k, v in (p.get('facts_fill') or {}).items():
            if p.get(k) in (None, '', 'Not stated (broker listings)'):
                p[k] = v
        if p.get('source_kind') != 'broker':
            p['location_quality'] = 'generic' if p.get('coords_note') == 'generic' else 'building'
        else:
            p['location_quality'] = p.get('listing', {}).get('location_quality') or p.get('location_quality') or 'district'
            listing.setdefault('location_quality', p['location_quality'])
        p.pop('override', None)

        row = overrides.get(p['id'])
        if row:
            changed = []
            for k in FIELDS_INT:
                v = num(row.get(k), int)
                if v is not None:
                    p[k] = v
                    changed.append(k)
            for k in FIELDS_STR:
                v = (row.get(k) or '').strip()
                if v:
                    p[k] = v
                    changed.append(k)
            lat, lng = num(row.get('lat')), num(row.get('lng'))
            if lat is not None and lng is not None:
                p['lat'], p['lng'] = lat, lng
                changed.append('location')
                if not (row.get('location_quality') or '').strip():
                    p['location_quality'] = 'district'
            if changed:
                applied += 1
                last = row['_layers'][-1]
                p['override'] = {'fields': changed, 'source': last['source'], 'source_url': last['source_url'], 'note': last['note'],
                                 'layers': row['_layers']}
        p['payment_plans'] = parse_plans(p.get('payment_plan_en'))

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    q = {}
    for p in doc['records']:
        q[p['location_quality']] = q.get(p['location_quality'], 0) + 1
    plans = sum(1 for p in doc['records'] if p['payment_plans'])
    print(f'overrides applied to {applied} projects; location quality {q}; {plans} projects with a parsed payment plan')


if __name__ == '__main__':
    main()
