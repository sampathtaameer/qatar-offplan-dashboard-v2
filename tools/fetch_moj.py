"""Download MoJ weekly bulletin CSVs.

Usage: python -I tools/fetch_moj.py [project_root] [urls_file] [out_subdir] [--discover]
Defaults: tools/moj_urls.txt -> data/raw/moj (residential units).
All property types: python -I tools/fetch_moj.py . tools/moj_all_urls.txt moj-all
--discover first scans the MoJ open-data folders for this year's CSVs and appends new URLs.
Skips files already present. moj.gov.qa serves an incomplete certificate chain, so if the
default context fails we retry with the bundled DigiCert chain, then certifi (if installed).
"""
import datetime as dt
import html.parser
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
ROOT = os.path.abspath(ARGS[0] if ARGS else os.path.join(os.path.dirname(__file__), '..'))
URLS = os.path.join(ROOT, ARGS[1]) if len(ARGS) > 1 else os.path.join(ROOT, 'tools', 'moj_urls.txt')
OUT = os.path.join(ROOT, 'data', 'raw', ARGS[2] if len(ARGS) > 2 else 'moj')
UA = {'User-Agent': 'Mozilla/5.0 (QatarOffPlanDashboard data refresh)'}


def local_name(url):
    name = urllib.parse.unquote(url.rsplit('/', 1)[-1])
    m = re.search(r'(\d{1,2})-(\d{1,2})-(\d{4})\D+(\d{1,2})-(\d{1,2})-(\d{4})', name)
    if not m:
        return re.sub(r'[^\w.-]+', '_', name)
    d1, m1, y1, d2, m2, y2 = m.groups()
    return f'{y1}-{int(m1):02d}-{int(d1):02d}_to_{y2}-{int(m2):02d}-{int(d2):02d}.csv'


def contexts():
    yield ssl.create_default_context()
    # moj.gov.qa omits its DigiCert intermediate; tools/certs/moj-chain.pem holds the public
    # intermediate + root so verification still happens (never disabled).
    bundled = ssl.create_default_context()
    bundled.load_verify_locations(os.path.join(ROOT, 'tools', 'certs', 'moj-chain.pem'))
    yield bundled
    try:
        import certifi
        yield ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass


def fetch(url):
    last = None
    for ctx in contexts():
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), context=ctx, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
    raise last


LISTING = 'https://moj.gov.qa/en/open-data-real-estate-registration-and-documentation-sector-0?field_parent_folder_target_id_context={fid}&page={page}'
# Parent folders on the MoJ open-data page: year sub-folders, each with EXCEL and EXCEL-CSV.
PARENTS = {'moj': 12149, 'moj-all': 12467}


class _Folders(html.parser.HTMLParser):
    """Collect (data-node-id, text) for folder tiles on a listing page."""

    def __init__(self):
        super().__init__()
        self.items, self._id, self._text = [], None, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if 'data-node-id' in a:
            self._flush()
            self._id = a['data-node-id']

    def handle_data(self, data):
        if self._id and data.strip():
            self._text.append(data.strip())

    def _flush(self):
        if self._id:
            self.items.append((self._id, ' '.join(self._text)))
        self._id, self._text = None, []

    def close(self):
        self._flush()
        super().close()


def folders(fid):
    p = _Folders()
    p.feed(fetch(LISTING.format(fid=fid, page=0)).decode('utf-8', 'replace'))
    p.close()
    return [(i, t) for i, t in p.items if i != str(fid)]


def discover(subdir, year):
    """Return CSV URLs in the <year>/EXCEL-CSV folder under the subdir's parent folder."""
    year_id = next((i for i, t in folders(PARENTS[subdir]) if t.strip() == str(year)), None)
    if not year_id:
        return []
    csv_id = next((i for i, t in folders(year_id) if 'CSV' in t.upper()), None)
    if not csv_id:
        return []
    found = []
    for page in range(0, 10):
        links = re.findall(r'href="([^"]+\.csv)"', fetch(LISTING.format(fid=csv_id, page=page)).decode('utf-8', 'replace'))
        new = [urllib.parse.urljoin('https://moj.gov.qa', u) for u in links if urllib.parse.urljoin('https://moj.gov.qa', u) not in found]
        if not new:
            break
        found += new
    return found


def main():
    os.makedirs(OUT, exist_ok=True)
    urls = [u.strip() for u in open(URLS, encoding='utf-8') if u.strip() and not u.startswith('#')]
    if '--discover' in sys.argv:
        # Add any new CSVs from the current (and, in January, previous) year's folder to the URL list.
        subdir = os.path.basename(OUT)
        year = dt.date.today().year
        found = []
        for y in ([year - 1] if dt.date.today().month == 1 else []) + [year]:
            found += discover(subdir, y)
        new = [u for u in found if u not in urls]
        if new:
            with open(URLS, 'a', encoding='utf-8') as f:
                f.write(''.join(u + '\n' for u in new))
            urls += new
        print(f'discovered {len(found)} listed, {len(new)} new')
    got = skipped = failed = 0
    for url in urls:
        name = local_name(url)
        path = os.path.join(OUT, name)
        if os.path.exists(path):
            skipped += 1
            continue
        try:
            data = fetch(url)
            with open(path, 'wb') as f:
                f.write(data)
            got += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f'FAILED {url}: {e}', file=sys.stderr)
    print(f'downloaded {got}, skipped {skipped}, failed {failed}')


if __name__ == '__main__':
    main()
