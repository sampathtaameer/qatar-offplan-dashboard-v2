"""Write the weekly email digest: data/digest.html (body) and data/digest_subject.txt.

Usage: python -I tools/digest.py [project_root]

Content: market pulse for residential units in foreign-ownership areas, every change logged by the
latest refresh, and the watchlist in data/watchlist.json with price moves since tracking began.
The GitHub workflow emails it when the MAIL_* secrets are set; locally, open data/digest.html.
Inline styles only (email clients drop <style> blocks). Taameer colours.
"""
import datetime as dt
import html
import json
import os
import sys

ROOT = os.path.abspath(next((a for a in sys.argv[1:] if not a.startswith('--')), os.path.join(os.path.dirname(__file__), '..')))
NAVY, BLUE, GREY, TINT = '#0E2841', '#215C98', '#E8E8E8', '#D9E2F3'
RED, GREEN = '#C00000', '#00875A'


def load(name):
    return json.load(open(os.path.join(ROOT, 'data', name), encoding='utf-8'))


def pct(a, b):
    return None if not a or not b else b / a - 1


def fmt_pct(x):
    if x is None:
        return '—'
    color = GREEN if x > 0 else RED if x < 0 else '#4A5668'
    return f'<span style="color:{color}">{x * 100:+.1f}%</span>'


def pulse():
    areas = {a['id']: a for a in load('areas.json')['records']}
    foreign = {k for k, a in areas.items() if a['regime'] in ('freehold', 'usufruct')}
    tx = [r for r in load('transactions.json')['records'] if r['property_type'] == 'unit' and r.get('area_id') in foreign]
    weeks = sorted({r['week'] for r in load('transactions.json')['records']})
    last4, prev4 = set(weeks[-4:]), set(weeks[-8:-4])

    def agg(ws):
        rows = [r for r in tx if r['week'] in ws]
        return sum(r['count'] for r in rows), sum(r['value_qar'] for r in rows)
    return weeks, agg(last4), agg(prev4)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    changes = load('changes.json')['records']
    latest = changes[0] if changes else {'date': dt.date.today().isoformat(), 'items': []}
    projects = {p['id']: p for p in load('projects.json')['records']}
    hist = load('project_history.json')
    watch = [i for i in load('watchlist.json').get('ids', []) if i in projects]
    weeks, (c4, v4), (c8, v8) = pulse()

    cell = 'padding:6px 10px;border-bottom:1px solid #E1E5EB;font:13px Segoe UI,Arial,sans-serif'
    head = f'padding:6px 10px;background:{BLUE};color:#fff;font:bold 13px Segoe UI,Arial,sans-serif;text-align:left'
    out = [f'<div style="max-width:720px;margin:0 auto;font:14px Segoe UI,Arial,sans-serif;color:#14202E">',
           f'<div style="background:{NAVY};color:#fff;padding:16px 20px;font-size:20px;font-weight:bold">Qatar Off-Plan Dashboard · weekly digest</div>',
           f'<p style="padding:0 4px">Refresh of {html.escape(latest["date"])}. Ministry of Justice data to the week of {html.escape(weeks[-1] if weeks else "—")}.</p>',
           f'<h2 style="color:{NAVY};font-size:16px;margin:20px 0 8px">Market pulse: apartments in freehold and usufruct areas</h2>',
           f'<table style="border-collapse:collapse;width:100%"><tr><th style="{head}"></th><th style="{head}">Last 4 weeks</th><th style="{head}">Previous 4 weeks</th><th style="{head}">Change</th></tr>',
           f'<tr><td style="{cell}">Registered sales</td><td style="{cell}">{c4:,}</td><td style="{cell}">{c8:,}</td><td style="{cell}">{fmt_pct(pct(c8, c4))}</td></tr>',
           f'<tr><td style="{cell}">Value (QAR m)</td><td style="{cell}">{v4 / 1e6:,.1f}</td><td style="{cell}">{v8 / 1e6:,.1f}</td><td style="{cell}">{fmt_pct(pct(v8, v4))}</td></tr></table>',
           f'<h2 style="color:{NAVY};font-size:16px;margin:20px 0 8px">What changed</h2>']
    if latest['items']:
        out.append('<ul style="padding-left:20px">' + ''.join(f'<li style="margin:4px 0">{html.escape(i["text_en"])}</li>' for i in latest['items']) + '</ul>')
    else:
        out.append('<p>No changes this week.</p>')

    out.append(f'<h2 style="color:{NAVY};font-size:16px;margin:20px 0 8px">Watchlist</h2>')
    if watch:
        out.append(f'<table style="border-collapse:collapse;width:100%"><tr><th style="{head}">Project</th><th style="{head}">From (QAR)</th>'
                   f'<th style="{head}">Since {html.escape(hist.get("first", ""))}</th><th style="{head}">Stock</th><th style="{head}">Handover</th></tr>')
        for pid in watch:
            p, h = projects[pid], hist['records'].get(pid) or []
            now = h[-1][1] if h else None
            first = next((x[1] for x in h if x[1]), None)
            out.append(f'<tr><td style="{cell}">{html.escape(p["name_en"])}<br><span style="color:#7A8596">{html.escape(p["developer"])}</span></td>'
                       f'<td style="{cell}">{f"{now:,.0f}" if now else "—"}</td><td style="{cell}">{fmt_pct(pct(first, now))}</td>'
                       f'<td style="{cell}">{html.escape(str(p.get("stock") or "—"))}</td><td style="{cell}">{html.escape(p.get("handover") or "—")}</td></tr>')
        out.append('</table>')
    else:
        out.append('<p>No projects on the watchlist. Add ids to data/watchlist.json.</p>')
    out.append(f'<p style="color:#7A8596;font-size:12px;margin-top:24px;border-top:1px solid {GREY};padding-top:8px">'
               'Internal Taameer use. Prices are developer asking prices from Property Finder listings; transactions are '
               'Ministry of Justice registrations. Not investment advice.</p></div>')

    with open(os.path.join(ROOT, 'data', 'digest.html'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    n = len(latest['items'])
    with open(os.path.join(ROOT, 'data', 'digest_subject.txt'), 'w', encoding='utf-8') as f:
        f.write(f'Qatar off-plan digest {latest["date"]}: {n} change{"s" if n != 1 else ""}, apartments {fmt_plain(pct(c8, c4))} vs prior 4 weeks')
    print(f'digest: {n} change items, {len(watch)} watched projects')


def fmt_plain(x):
    return '—' if x is None else f'{x * 100:+.0f}%'


if __name__ == '__main__':
    main()
