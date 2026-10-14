"""Keep a weekly copy of every project's prices and status, and rebuild data/project_history.json.

Usage: python -I tools/snapshot.py [project_root]

Each Property Finder refresh overwrites data/projects.json. This step saves a compact copy as
data/history/projects-<as_of>.json (one file per listing date; re-running on the same date
replaces it), then rebuilds data/project_history.json from all saved copies. The site uses it for
price-change charts, handover slips (developer scorecard) and the watchlist.
"""
import glob
import json
import os
import sys

ROOT = os.path.abspath(next((a for a in sys.argv[1:] if not a.startswith('--')), os.path.join(os.path.dirname(__file__), '..')))
NOT_APARTMENT = {'villa', 'townhouse'}
FIELDS = ['date', 'from_price_qar', 'ppsqm_qar', 'stock', 'status', 'handover']


def summary(p):
    mix = p.get('unit_mix') or []
    prices = [u['price_from_qar'] for u in mix if u.get('price_from_qar')]
    sized = [u['price_from_qar'] / u['size_sqm_min'] for u in mix
             if u.get('price_from_qar') and u.get('size_sqm_min') and u.get('type') not in NOT_APARTMENT]
    return {
        'id': p['id'],
        'from_price_qar': min(prices) if prices else None,
        'ppsqm_qar': round(sum(sized) / len(sized)) if sized else None,
        'stock': p.get('stock'),
        'status': p.get('status'),
        'handover': p.get('handover'),
        'units': [[u.get('type'), u.get('size_sqm_min'), u.get('price_from_qar')] for u in mix],
    }


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    doc = json.load(open(os.path.join(ROOT, 'data', 'projects.json'), encoding='utf-8'))
    date = doc.get('as_of')
    hist_dir = os.path.join(ROOT, 'data', 'history')
    os.makedirs(hist_dir, exist_ok=True)
    with open(os.path.join(hist_dir, f'projects-{date}.json'), 'w', encoding='utf-8') as f:
        json.dump({'as_of': date, 'records': [summary(p) for p in doc['records']]}, f, ensure_ascii=False, separators=(',', ':'))

    records = {}
    files = sorted(glob.glob(os.path.join(hist_dir, 'projects-*.json')))
    for path in files:
        snap = json.load(open(path, encoding='utf-8'))
        for r in snap['records']:
            records.setdefault(r['id'], []).append([snap['as_of'], r['from_price_qar'], r['ppsqm_qar'], r['stock'], r['status'], r['handover']])
    with open(os.path.join(ROOT, 'data', 'project_history.json'), 'w', encoding='utf-8') as f:
        json.dump({'as_of': date, 'first': os.path.basename(files[0])[9:19] if files else date,
                   'snapshots': len(files), 'fields': FIELDS, 'records': records}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'history: {len(files)} snapshot(s), {len(records)} projects')


if __name__ == '__main__':
    main()
