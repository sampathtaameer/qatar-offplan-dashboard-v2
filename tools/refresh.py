"""Weekly refresh: fetch new data, rebuild, log what changed, validate.

Usage: python -I tools/refresh.py [project_root] [--full] [--no-pf]
Steps: MoJ bulletins -> deals/transactions -> Property Finder -> override sheet -> weekly snapshot
-> "What changed" log -> validation -> email digest (data/digest.html).
  --full   also refresh OpenStreetMap places and noise geometry (monthly is plenty)
  --no-pf  skip Property Finder (projects and rents)
Exit code 0 = data valid and ready to commit; 1 = validation failed (do not commit).
"""
import datetime as dt
import json
import os
import subprocess
import sys

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
ROOT = os.path.abspath(ARGS[0] if ARGS else os.path.join(os.path.dirname(__file__), '..'))
FLAGS = {a for a in sys.argv[1:] if a.startswith('--')}
PY = [sys.executable, '-I']


def run(*args):
    print('>', ' '.join(args))
    r = subprocess.run(PY + [os.path.join(ROOT, 'tools', args[0]), ROOT, *args[1:]], cwd=ROOT)
    return r.returncode


def snapshot():
    def j(n):
        try:
            return json.load(open(os.path.join(ROOT, 'data', f'{n}.json'), encoding='utf-8'))
        except Exception:  # noqa: BLE001
            return {'records': []}
    tx = j('transactions')['records']
    weeks = sorted({r['week'] for r in tx})
    projects = {p['id']: p for p in j('projects')['records']}
    rents = {(r['area_id'], r['unit_type']): r['median_qar_month'] for r in j('rents')['records']}
    return weeks, tx, projects, rents


def describe(before, after):
    (w0, _, p0, r0), (w1, tx1, p1, r1) = before, after
    items = []
    for w in [w for w in w1 if w not in w0]:
        rows = [r for r in tx1 if r['week'] == w]
        total = sum(r['value_qar'] for r in rows)
        units = sum(r['count'] for r in rows if r['property_type'] == 'unit')
        items.append({'type': 'data',
                      'text_en': f'MoJ week of {w}: QAR {total / 1e6:,.1f}m registered, {sum(r["count"] for r in rows)} deals ({units} apartments).',
                      'text_ar': f'أسبوع {w} (وزارة العدل): {total / 1e6:,.1f} مليون ر.ق مسجلة، {sum(r["count"] for r in rows)} صفقة ({units} شقة).'})
    for pid in [p for p in p1 if p not in p0]:
        p = p1[pid]
        items.append({'type': 'project', 'id': pid, 'text_en': f'New project listed: {p["name_en"]} ({p["developer"]}).',
                      'text_ar': f'مشروع جديد: {p["name_en"]} ({p["developer"]}).'})
    for pid in [p for p in p0 if p not in p1]:
        items.append({'type': 'project', 'text_en': f'No longer listed: {p0[pid]["name_en"]}.',
                      'text_ar': f'لم يعد معروضاً: {p0[pid]["name_en"]}.'})
    for pid in [p for p in p1 if p in p0]:
        def start(p):
            v = [u['price_from_qar'] for u in p.get('unit_mix') or [] if u.get('price_from_qar')]
            return min(v) if v else None
        a, b = start(p0[pid]), start(p1[pid])
        if a and b and abs(b / a - 1) >= 0.03:
            items.append({'type': 'price', 'id': pid, 'text_en': f'{p1[pid]["name_en"]}: starting price QAR {a:,.0f} → {b:,.0f}.',
                          'text_ar': f'{p1[pid]["name_en"]}: سعر البداية {a:,.0f} ← {b:,.0f} ر.ق.'})
    for pid in [p for p in p1 if p in p0]:
        a, b = p0[pid], p1[pid]
        if a.get('stock') != b.get('stock') and b.get('stock'):
            items.append({'type': 'stock', 'id': pid, 'text_en': f'{b["name_en"]}: stock {a.get("stock") or "unknown"} → {b["stock"]}.',
                          'text_ar': f'{b["name_en"]}: المخزون {a.get("stock") or "غير معروف"} ← {b["stock"]}.'})
        if a.get('handover') and b.get('handover') and b['handover'] > a['handover']:
            items.append({'type': 'handover', 'id': pid, 'text_en': f'{b["name_en"]}: handover moved {a["handover"]} → {b["handover"]}.',
                          'text_ar': f'{b["name_en"]}: تأجيل التسليم {a["handover"]} ← {b["handover"]}.'})
        if a.get('status') != b.get('status') and b.get('status'):
            items.append({'type': 'status', 'id': pid, 'text_en': f'{b["name_en"]}: status {a.get("status")} → {b["status"]}.',
                          'text_ar': f'{b["name_en"]}: الحالة {a.get("status")} ← {b["status"]}.'})
    for k in r1:
        if k in r0 and r0[k] and abs(r1[k] / r0[k] - 1) >= 0.10:
            items.append({'type': 'rent', 'text_en': f'{k[0]} {k[1]} median asking rent QAR {r0[k]:,} → {r1[k]:,}.',
                          'text_ar': f'{k[0]} {k[1]}: متوسط الإيجار المعروض {r0[k]:,} ← {r1[k]:,} ر.ق.'})
    return items


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    before = snapshot()
    failures = 0
    failures += run('fetch_moj.py', 'tools/moj_urls.txt', 'moj', '--discover') != 0
    failures += run('fetch_moj.py', 'tools/moj_all_urls.txt', 'moj-all', '--discover') != 0
    failures += run('build_deals.py') != 0
    failures += run('build_market.py') != 0
    if '--no-pf' not in FLAGS:
        failures += run('fetch_propertyfinder.py') != 0
    # Off-plan listings from all brokers -> extra projects (uses the last good file if the fetch failed).
    failures += run('build_broker_projects.py') != 0
    # Always re-apply the manual override sheet and save this week's project snapshot.
    failures += run('apply_overrides.py') != 0
    failures += run('snapshot.py') != 0
    if '--full' in FLAGS:
        failures += run('fetch_osm.py') != 0
        failures += run('fetch_noise.py') != 0

    items = describe(before, snapshot())
    path = os.path.join(ROOT, 'data', 'changes.json')
    changes = json.load(open(path, encoding='utf-8'))
    today = dt.date.today().isoformat()
    if items:
        changes['records'] = [c for c in changes['records'] if c['date'] != today]
        changes['records'].insert(0, {'date': today, 'items': items})
        changes['records'] = changes['records'][:52]
    changes['as_of'] = today
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(changes, f, ensure_ascii=False, indent=1)
    print(f'{len(items)} change items logged; {failures} step(s) reported errors')

    code = run('validate.py')
    run('digest.py')
    if failures:
        print('Some fetch steps failed; check output above (data from previous run kept for those sources).')
    sys.exit(code)


if __name__ == '__main__':
    main()
