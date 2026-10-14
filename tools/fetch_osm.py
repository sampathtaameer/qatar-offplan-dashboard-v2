"""Build data/poi.json from OpenStreetMap via the Overpass API.

Usage: python -I tools/fetch_osm.py [project_root]
Covers all of Qatar. Data © OpenStreetMap contributors (ODbL).
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..'))
BBOX = '24.45,50.75,26.20,51.68'  # south, west, north, east (all of Qatar)
ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
             'https://overpass.kumi.systems/api/interpreter']

QUERIES = {
    'metro': (f'nwr["railway"="station"]["station"="subway"]({BBOX});nwr["railway"="station"]["network"~"Metro"]({BBOX});'
              f'nwr["public_transport"="station"]["subway"="yes"]({BBOX});nwr["railway"="station"]["operator"~"Qatar Rail"]["station"!="light_rail"]({BBOX});'),
    'school': f'nwr["amenity"="school"]["name"]({BBOX});',
    'hospital': f'nwr["amenity"="hospital"]["name"]({BBOX});',
    'mall': f'nwr["shop"="mall"]["name"]({BBOX});',
    'beach': f'nwr["natural"="beach"]({BBOX});nwr["leisure"="beach_resort"]({BBOX});',
}


def run(q, attempts=4):
    body = urllib.parse.urlencode({'data': f'[out:json][timeout:90];({q});out center tags;'}).encode()
    for i in range(attempts * len(ENDPOINTS)):
        endpoint = ENDPOINTS[i % len(ENDPOINTS)]
        try:
            req = urllib.request.Request(endpoint, data=body, headers={'User-Agent': 'QatarOffPlanDashboard/0.1'})
            res = json.load(urllib.request.urlopen(req, timeout=120))['elements']
            time.sleep(5)  # be polite to the public Overpass instance
            return res
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as e:
            if i == attempts * len(ENDPOINTS) - 1:
                raise
            print(f'overpass retry ({endpoint}): {e}', file=sys.stderr)
            time.sleep(10 * (i + 1))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    today = dt.date.today().isoformat()
    records, seen = [], set()
    for kind, q in QUERIES.items():
        for el in run(q):
            lat = el.get('lat') or el.get('center', {}).get('lat')
            lng = el.get('lon') or el.get('center', {}).get('lon')
            if lat is None:
                continue
            tags = el.get('tags', {})
            name_en = tags.get('name:en') or tags.get('name') or ''
            name_ar = tags.get('name:ar') or (tags.get('name') if any('؀' <= c <= 'ۿ' for c in tags.get('name', '')) else '')
            if kind == 'beach' and not name_en:
                name_en, name_ar = 'Beach', 'شاطئ'
            if kind == 'metro':
                # Skip unnamed entries and second mappings of a station already listed (within ~200 m).
                if not name_en or any(r['type'] == 'metro' and abs(r['lat'] - lat) < 0.002 and abs(r['lng'] - lng) < 0.002 for r in records):
                    continue
            # A metro station can be mapped as node, way and relation; one per name is enough.
            key = (kind, name_en.lower()) if kind == 'metro' else (kind, name_en.lower(), round(lat, 3), round(lng, 3))
            if key in seen:
                continue
            seen.add(key)
            records.append({
                'id': f'{kind}-{el["type"][0]}{el["id"]}', 'type': kind,
                'name_en': name_en, 'name_ar': name_ar or name_en,
                'lat': round(lat, 5), 'lng': round(lng, 5),
                **({'line': tags.get('colour') or tags.get('line')} if kind == 'metro' and (tags.get('colour') or tags.get('line')) else {}),
            })
        print(kind, sum(1 for r in records if r['type'] == kind))
    out = {
        'as_of': today,
        'source': 'OpenStreetMap contributors (ODbL), via Overpass API',
        'source_url': 'https://www.openstreetmap.org/copyright',
        'records': records,
    }
    with open(os.path.join(ROOT, 'data', 'poi.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
