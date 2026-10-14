"""Local dev server with caching disabled, so edits to JS modules and data show on reload.

Usage: python -I tools/serve.py [port]   (serves the project root on 127.0.0.1; default 8766 so v1 on 8765 can run alongside)
"""
import functools
import http.server
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    handler = functools.partial(NoCache, directory=ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler) as httpd:
        print(f'Serving {ROOT} at http://127.0.0.1:{PORT}')
        httpd.serve_forever()
