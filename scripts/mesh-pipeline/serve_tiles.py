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

    python3 serve_tiles.py                         # newest tileset, port 8778
    python3 serve_tiles.py 9000
    python3 serve_tiles.py 8778 work/bt-dense      # a specific project
"""
import http.server, socketserver, sys
from pathlib import Path

HERE = Path(__file__).parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8778

# Which tileset, resolved rather than hardcoded.
#
# This used to name one project directory. Every new reconstruction goes
# to a new directory, on purpose, because the rule that cost a working
# day is never to overwrite the only good output with an attempt at a
# better one. A fixed path means the server quietly keeps serving the
# previous run while the C2 is being judged on the new one.
if len(sys.argv) > 2:
    base = Path(sys.argv[2])
    ROOT = base if (base / "tileset.json").exists() else base / "odm" / "3d_tiles" / "model"
else:
    found = sorted(HERE.glob("work/*/odm/3d_tiles/model/tileset.json"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    if not found:
        sys.exit("No tileset under work/. Run the pipeline first (see RECIPE.md).")
    ROOT = found[0].parent
    if len(found) > 1:
        print(f"{len(found)} tilesets found, serving the newest:")
        for p in found:
            mark = "->" if p.parent == ROOT else "  "
            print(f"  {mark} {p.relative_to(HERE)}")


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
