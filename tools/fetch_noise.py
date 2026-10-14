"""Build data/noise.json (runways + motorways) from OpenStreetMap via Overpass.

Usage: python -I tools/fetch_noise.py [project_root]
Runway weights reflect traffic: Hamad International (OTHH) = 1.0; Al Udeid Air Base
(military) = 0.5; the old Doha International runway (OTBD, mainly military/VIP since 2014) = 0.35.
"""
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_osm import BBOX, ENDPOINT  # noqa: E402

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..'))
HIA = (25.2731, 51.6081)       # Hamad International reference point
OLD_DOHA = (25.2579, 51.5665)  # old Doha International (OTBD) runway midpoint


def km(a, b):
    return math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 111 * math.cos(math.radians(a[0])))


def geom(q):
    """Overpass query returning full way geometry."""
    body = urllib.parse.urlencode({'data': f'[out:json][timeout:90];({q});out geom tags;'}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={'User-Agent': 'QatarOffPlanDashboard/0.1'})
    res = json.load(urllib.request.urlopen(req, timeout=120))['elements']
    time.sleep(5)
    return res


def simplify(coords, min_km=0.4):
    out = [coords[0]]
    for c in coords[1:-1]:
        if km(out[-1], c) >= min_km:
            out.append(c)
    out.append(coords[-1])
    return out


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    runways = []
    for el in geom(f'way["aeroway"="runway"]({BBOX});'):
        pts = [(p['lat'], p['lon']) for p in el.get('geometry', [])]
        if len(pts) < 2:
            continue
        # Runway ends = the two most distant points.
        a, b = max(((p, q) for p in pts for q in pts), key=lambda pq: km(*pq))
        length = km(a, b)
        if length < 2:  # skip helipads / short strips
            continue
        ref = el.get('tags', {}).get('ref', '')
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if km(mid, HIA) < 4 and ref.startswith('16'):
            name, weight = f'HIA {ref}', 1.0
        elif km(mid, OLD_DOHA) < 4:
            name, weight = f'Old Doha Airport {ref}', 0.35
        else:
            name, weight = f'Al Udeid Air Base {ref}', 0.5
        runways.append({
            'name': name.strip(),
            'end1': [round(a[0], 5), round(a[1], 5)], 'end2': [round(b[0], 5), round(b[1], 5)],
            'length_km': round(length, 2), 'weight': weight,
        })
    roads = {}
    for el in geom(f'way["highway"="motorway"]({BBOX});'):
        name = el.get('tags', {}).get('name:en') or el.get('tags', {}).get('name') or 'Motorway'
        pts = [(p['lat'], p['lon']) for p in el.get('geometry', [])]
        if len(pts) >= 2:
            roads.setdefault(name, []).append(pts)
    road_list = []
    for name, ways in roads.items():
        for w in ways:
            s = simplify(w)
            if len(s) >= 2 and sum(km(s[i], s[i + 1]) for i in range(len(s) - 1)) >= 0.5:
                road_list.append({'name': name, 'coords': [[round(p[0], 4), round(p[1], 4)] for p in s]})
    out = {
        'as_of': dt.date.today().isoformat(),
        'source': 'OpenStreetMap contributors (ODbL), via Overpass API',
        'source_url': 'https://www.openstreetmap.org/copyright',
        'runways': runways,
        'roads': road_list,
    }
    with open(os.path.join(ROOT, 'data', 'noise.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('runways:', [(r['name'], r['length_km']) for r in runways])
    print('road segments:', len(road_list), 'names:', len(roads))


if __name__ == '__main__':
    main()
