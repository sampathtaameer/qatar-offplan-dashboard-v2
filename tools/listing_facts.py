"""Read facts out of broker listing descriptions, and agree them per building.

Used by tools/build_broker_projects.py. Input: data/raw/pf_offplan_details.json (one entry per
listing id: title, description, broker, direct-from-developer flag), written by
tools/fetch_propertyfinder.py --details or by the in-browser collection.

Per listing it extracts: developer (dictionary in data/developer_aliases.json, or "developed by X"),
handover (quarter/month/year), floors, total units, payment terms (down %, % on handover, years,
post-handover), and project names it mentions.

Per building a value is ACCEPTED only when at least MIN_BROKERS different brokers state the same
value, or one listing marked direct-from-developer states it. Otherwise the leading value is kept as
a 'candidate' for review, never shown as fact.
"""
import json
import os
import re
from collections import defaultdict

MIN_BROKERS = 3
MONTHS = {m: i for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}
QEND = {'1': 3, '2': 6, '3': 9, '4': 12}
YR = r'(20[2-3]\d)'


def load_aliases(root):
    path = os.path.join(root, 'data', 'developer_aliases.json')
    recs = json.load(open(path, encoding='utf-8'))['records'] if os.path.exists(path) else []
    return [(r['name'], r.get('group') or r['name'], [re.compile(p, re.I) for p in r['patterns']]) for r in recs]


DEV_BY = re.compile(r"\b(?:developed|built|delivered)\s+by\s+(?:the\s+)?([A-Z][A-Za-z0-9&.'\- ]{2,45}?)(?=[,.;:!\n|)(]|\s+(?:in|at|on|with|and|is|located|offers?|for|featuring|this|the)\b|$)")
DEV_LABEL = re.compile(r"\bdeveloper\s*[:\-–]\s*([A-Z][A-Za-z0-9&.'\- ]{2,45}?)(?=[,.;\n|]|\s{2}|$)")
BAD_DEV = re.compile(r'^(?:a|an|the|one|our|qatar|trusted|leading|renowned|reputable|well|top|premium|award)\b|\d|\bQAR\b|\bQR\b', re.I)

HANDOVER = [
    re.compile(r'(?:handover|hand over|completion|delivery|ready|possession)[^.;\n]{0,25}?\bQ([1-4])\s*[-/ ]?\s*' + YR, re.I),
    re.compile(r'\bQ([1-4])\s*[-/ ]?\s*' + YR + r'[^.;\n]{0,20}?(?:handover|hand over|completion|delivery)', re.I),
    re.compile(r'(?:handover|hand over|completion|delivery|ready)[^.;\n]{0,25}?\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*' + YR, re.I),
    re.compile(r'(?:handover|hand over|completion|delivery)[^.;\n]{0,20}?(?:in|by|on|:|-)\s*' + YR + r'\b', re.I),
]
FLOORS = re.compile(r'\b(\d{1,3})\s*[- ]?(?:floors|storeys|stories|story|storey)\b|\bG\s*\+\s*(\d{1,3})\b', re.I)
UNITS = re.compile(r'(?:comprises|comprising|consists of|features|accommodates|offers|total of|with|includes|including)\s+(?:only\s+|just\s+|a total of\s+)?(\d{2,4})\s+(?:luxury\s+|exclusive\s+|residential\s+|premium\s+|modern\s+)?(?:units|apartments|residences|villas|townhouses|homes)\b', re.I)
DOWN = re.compile(r'(\d{1,2}(?:\.\d)?)\s*%\s*(?:down\s*-?\s*payment|dp\b|down\b|booking|deposit|advance)', re.I)
DOWN2 = re.compile(r'(?:down\s*-?\s*payment|\bdp\b)\s*(?:of|:)?\s*(?:only\s*)?(\d{1,2}(?:\.\d)?)\s*%', re.I)
ON_HO = re.compile(r'(\d{1,2})\s*%\s*(?:on|upon|at|after|before)?\s*(?:the\s*)?(?:handover|hand over|completion)', re.I)
YEARS = re.compile(r'(\d{1,2})\s*[- ]?(?:years?|yrs?)\s*(?:of\s*)?(?:easy\s*|flexible\s*|interest[- ]free\s*)?(?:payment|instal+ments?|plan|pp\b|post)', re.I)
POST = re.compile(r'post[- ]?handover', re.I)


def norm_dev(name):
    name = re.sub(r'\s+', ' ', name).strip(" -–.'")
    name = re.sub(r'\b(?:company|co|w\.?l\.?l|llc|qpsc|q\.p\.s\.c)\.?$', '', name, flags=re.I).strip(' ,.')
    return name


def extract(text, aliases):
    """Facts stated in one listing's title + description."""
    t = text or ''
    out = {}
    devs = {group for name, group, pats in aliases if any(p.search(t) for p in pats)}
    names = {name for name, group, pats in aliases if any(p.search(t) for p in pats)}
    if len(devs) == 1:
        out['developer'] = sorted(names)[0] if len(names) == 1 else next(iter(devs))
    elif not devs:
        m = DEV_BY.search(t) or DEV_LABEL.search(t)
        if m and not BAD_DEV.search(m.group(1)) and len(m.group(1).split()) <= 6:
            out['developer'] = norm_dev(m.group(1))
    for i, rx in enumerate(HANDOVER):
        m = rx.search(t)
        if not m:
            continue
        g = m.groups()
        if i in (0, 1):
            out['handover'] = f'{g[1]}-{QEND[g[0]]:02d}'
        elif i == 2:
            out['handover'] = f'{g[1]}-{MONTHS[g[0][:3].lower()]:02d}'
        else:
            out['handover_year'] = g[0]
        break
    # "35 floors" -> 35; "G+5" -> ground + 5 = 6 floors.
    fl = [int(a) if a else int(b) + 1 for a, b in FLOORS.findall(t)]
    fl = [f for f in fl if 2 <= f <= 110]
    if fl:
        out['floors'] = max(fl)
    un = [int(x) for x in UNITS.findall(t) if 20 <= int(x) <= 5000]
    if un:
        out['units_total'] = max(un)
    m = DOWN.search(t) or DOWN2.search(t)
    if m and 0 < float(m.group(1)) <= 60:
        out['down_pct'] = float(m.group(1))
    m = ON_HO.search(t)
    if m and 0 < int(m.group(1)) <= 90:
        out['handover_pct'] = int(m.group(1))
    yrs = [int(y) for y in YEARS.findall(t) if 1 <= int(y) <= 15]
    if yrs:
        out['plan_years'] = max(yrs)
    if POST.search(t):
        out['post_handover'] = True
    return out


def agree(listings, field, min_brokers=MIN_BROKERS):
    """listings: [(facts, broker, is_direct, listing_id)]. Returns (value, status, support) or None."""
    votes = defaultdict(lambda: {'brokers': set(), 'direct': 0, 'ids': []})
    for f, broker, direct, lid in listings:
        if field in f:
            v = votes[f[field]]
            v['brokers'].add(broker or f'unknown-{lid}')
            v['direct'] += 1 if direct else 0
            v['ids'].append(lid)
    if not votes:
        return None
    best_val, best = max(votes.items(), key=lambda kv: (kv[1]['direct'] > 0, len(kv[1]['brokers']), len(kv[1]['ids'])))
    others = sum(len(v['brokers']) for k, v in votes.items() if k != best_val)
    status = 'accepted' if (best['direct'] > 0 or len(best['brokers']) >= min_brokers) and others < len(best['brokers']) else 'candidate'
    return best_val, status, {'brokers': len(best['brokers']), 'direct': best['direct'], 'listings': len(best['ids']), 'disagreeing_brokers': others,
                              'sample_ids': best['ids'][:3]}


FIELDS = ['developer', 'handover', 'handover_year', 'floors', 'units_total', 'down_pct', 'handover_pct', 'plan_years', 'post_handover']


def building_facts(listings, min_brokers=MIN_BROKERS):
    out = {}
    for f in FIELDS:
        r = agree(listings, f, min_brokers)
        if r:
            out[f] = {'value': r[0], 'status': r[1], **r[2]}
    # A year-only handover only counts if no month-level handover was accepted.
    if out.get('handover', {}).get('status') == 'accepted':
        out.pop('handover_year', None)
    return out
