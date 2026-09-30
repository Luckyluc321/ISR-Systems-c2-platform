#!/usr/bin/env python3
"""
Serve reconstructed 3D Tiles to the C2 app during development.

Deliberately NOT served out of the app's public/ directory. A tileset is
hundreds of megabytes, Vite copies public/ wholesale into every build,
and the app would carry the tiles around forever. In production these
live on object storage behind a CDN, so serving them from a separate
origin in development matches how they will actually be fetched.

Which means CORS, since the app is on one origin and the tiles on
another. Python's stock http.server sends no CORS headers and Cesium
fails with an opaque network error rather than anything that points
here.

    python3 serve_tiles.py            # port 8778
    python3 serve_tiles.py 9000
"""
import http.server, socketserver, sys
from pathlib import Path

ROOT = Path(__file__).parent / "work" / "billund-terminal" / "odm" / "3d_tiles" / "model"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8778


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def guess_type(self, path):
        # b3dm is binary; without this it is served as text/html and the
        # tile parser rejects it.
        if str(path).endswith(".b3dm"):
            return "application/octet-stream"
        return super().guess_type(path)

    def log_message(self, *a):
        pass  # one line per tile is thousands of lines


if not (ROOT / "tileset.json").exists():
    sys.exit(f"No tileset at {ROOT}. Run the pipeline first (see RECIPE.md).")

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"serving {ROOT}")
    print(f"  http://localhost:{PORT}/tileset.json")
    httpd.serve_forever()
