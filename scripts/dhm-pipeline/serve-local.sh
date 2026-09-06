#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════
# Serve DHM quantized-mesh output from localhost with CORS + gzip headers
# ═════════════════════════════════════════════════════════════════════════
#
# For LOCAL testing before deploying to Scaleway. Serves ./output/ over
# HTTP with the exact headers Cesium expects:
#   - Content-Encoding: gzip on .terrain files
#   - CORS: *
#
# Uses python3's http.server with a small subclass. No dependencies.
#
# Usage:
#   bash serve-local.sh              # listens on :8081
#   PORT=8090 bash serve-local.sh    # custom port
#
# Then in .env.local:
#   VITE_DHM_TERRAIN_URL=http://localhost:8081
# ═════════════════════════════════════════════════════════════════════════

set -euo pipefail

PORT=${PORT:-8081}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="${HERE}/output"

[ -d "$OUTPUT" ] || { echo "ERROR: no ./output/ dir. Run 'docker compose run --rm build' first."; exit 1; }
[ -z "$(ls -A "$OUTPUT" 2>/dev/null)" ] && { echo "ERROR: ./output/ is empty."; exit 1; }

echo "[serve-local] Serving $OUTPUT on http://localhost:${PORT}"
echo "[serve-local] Set VITE_DHM_TERRAIN_URL=http://localhost:${PORT} in .env.local and reload the app."
echo "[serve-local] Ctrl-C to stop."
echo ""

cd "$OUTPUT"

python3 - <<PY
import http.server, socketserver, os

PORT = ${PORT}

class TerrainHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # CORS for browser Cesium fetch
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        # Cesium quantized-mesh: .terrain files are gzip-compressed on disk,
        # served with the header so the browser decodes
        if self.path.endswith('.terrain'):
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Type', 'application/vnd.quantized-mesh')
        elif self.path.endswith('.json'):
            self.send_header('Content-Type', 'application/json')
        super().end_headers()
    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

with socketserver.TCPServer(("", PORT), TerrainHandler) as httpd:
    print(f"[serve-local] Ready. Serving on :{PORT}")
    httpd.serve_forever()
PY
