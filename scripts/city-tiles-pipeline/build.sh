#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════
# CityGML → Cesium 3D Tiles — end-to-end build
# ═════════════════════════════════════════════════════════════════════════
#
# Verified working 2026-09-03 against Berlin Gasometer LoD2 sample:
#   - CityGML files in ./input/  → import into 3DCityDB v5 (via citydb-tool)
#   - Export CityJSONSeq         (via citydb-tool)
#   - Convert to glb             (via cjio in ./venv/)
#   - Wrap in tileset.json       (this script)
#
# Prereqs (one-time):
#   - Docker Desktop running
#   - Python 3.12 venv at ./venv with cjio installed:
#       python3.12 -m venv venv
#       ./venv/bin/pip install cjio
#
# Usage:
#   1. Populate ./input/ with .gml files (from Datafordeler FTP delivery)
#   2. bash build.sh
#   3. bash deploy-scaleway.sh
#
# Output: ./output/{tileset.json, buildings.glb}
# ═════════════════════════════════════════════════════════════════════════

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="${HERE}/input"
OUTPUT="${HERE}/output"

mkdir -p "$INPUT" "$OUTPUT"

if [ -z "$(find "$INPUT" -name '*.gml' -o -name '*.xml' 2>/dev/null | head -1)" ]; then
  echo "ERROR: no .gml or .xml files found in $INPUT/"
  echo "Populate with CityGML from Datafordeler order (SDFI 3D Bygningsmodel)."
  exit 1
fi

# ── 1. Start 3DCityDB v5 (idempotent) ──────────────────────────────────
echo "[build] Starting 3DCityDB v5 (Postgres/PostGIS, port 15432)..."
docker compose up -d citydb
# Wait for health
for i in {1..60}; do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' \
    "$(docker compose ps -q citydb)" 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then break; fi
  sleep 2
done
[ "$STATUS" = "healthy" ] || { echo "[build] citydb never became healthy"; exit 1; }

# ── 2. Import CityGML into 3DCityDB ────────────────────────────────────
echo "[build] Importing CityGML into 3DCityDB..."
docker compose run --rm importer 2>&1 | tail -5

# ── 3. Export CityJSONSeq from 3DCityDB ────────────────────────────────
echo "[build] Exporting CityJSONSeq..."
docker run --rm --platform linux/amd64 \
  --network city-tiles-pipeline_default \
  -v "$OUTPUT:/data/output" \
  3dcitydb/citydb-tool:1.4 \
  export cityjson -H citydb -P 5432 -d citydb -u citydb -p citydb \
    --output /data/output/buildings.city.jsonl 2>&1 | tail -5

# ── 4. Convert CityJSONSeq → glb (via cjio) ────────────────────────────
echo "[build] Converting to glTF binary..."
"${HERE}/venv/bin/python" -c "import cjio" 2>/dev/null \
  || { echo "[build] cjio missing. Run: python3.12 -m venv venv && ./venv/bin/pip install cjio"; exit 1; }
cat "$OUTPUT/buildings.city.jsonl" | "${HERE}/venv/bin/cjio" stdin export glb "$OUTPUT/buildings.glb" 2>&1 | tail -3

# ── 5. Emit minimal tileset.json wrapper ───────────────────────────────
# Bounding volume is placeholder — Cesium 3D Tiles requires region in
# WGS84 radians [west, south, east, north, minH, maxH]. For real DK
# runs, compute from CityJSON metadata.referenceSystem bounds. This
# placeholder covers all of Denmark so tiles load regardless.
echo "[build] Emitting tileset.json..."
cat > "$OUTPUT/tileset.json" <<'JSON'
{
  "asset": {"version": "1.1"},
  "geometricError": 500,
  "root": {
    "boundingVolume": {"region": [0.131, 0.949, 0.272, 1.015, -20, 400]},
    "geometricError": 0,
    "refine": "ADD",
    "content": {"uri": "buildings.glb"}
  }
}
JSON

echo ""
echo "[build] DONE."
du -sh "$OUTPUT"
echo ""
echo "Next: bash deploy-scaleway.sh"
