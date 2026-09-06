#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════
# DHM → quantized-mesh terrain build orchestrator
# ═════════════════════════════════════════════════════════════════════════
#
# Reads DHM GeoTIFF tiles from ./input/, builds quantized-mesh pyramid,
# writes to ./output/. Deploy output to a static tile host (Scaleway
# Object Storage, Azure Blob, etc). See README.md for full walkthrough.
#
# Env:
#   SDFI_TOKEN         (required if input/ is empty — auto-downloads)
#   MIN_ZOOM=0
#   MAX_ZOOM=15
#   DOCKER_IMAGE=tumgis/ctb-quantized-mesh
# ═════════════════════════════════════════════════════════════════════════

set -euo pipefail

MIN_ZOOM=${MIN_ZOOM:-0}
MAX_ZOOM=${MAX_ZOOM:-15}
DOCKER_IMAGE=${DOCKER_IMAGE:-tumgis/ctb-quantized-mesh}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="${HERE}/input"
OUTPUT="${HERE}/output"

mkdir -p "$INPUT" "$OUTPUT"

if [ -z "$(ls -A "$INPUT" 2>/dev/null)" ]; then
  echo "ERROR: input/ is empty."
  echo "Download DHM GeoTIFF tiles from https://dataforsyningen.dk/data/928 into ./input/"
  echo "(Full DK is ~1.5TB uncompressed. Consider a single kommune bbox for a test run.)"
  exit 1
fi

echo "[dhm-pipeline] Input tiles: $(ls "$INPUT" | wc -l | tr -d ' ')"
echo "[dhm-pipeline] Output dir:  $OUTPUT"
echo "[dhm-pipeline] Zoom range:  $MIN_ZOOM–$MAX_ZOOM"
echo ""

echo "[dhm-pipeline] Building quantized-mesh pyramid + layer.json (single pass with -l)..."
docker run --rm \
  -v "$INPUT:/data/input:ro" \
  -v "$OUTPUT:/data/output" \
  "$DOCKER_IMAGE" \
  ctb-tile -f Mesh -C -N -l \
  -o /data/output \
  -s "$MIN_ZOOM" -e "$MAX_ZOOM" \
  /data/input/*.tif

echo ""
echo "[dhm-pipeline] Gzipping tiles in place (Cesium expects gzip-compressed .terrain files)..."
find "$OUTPUT" -name '*.terrain' -not -name '*.gz' \
  -exec gzip {} \; -exec sh -c 'mv "$1.gz" "$1"' _ {} \;

echo ""
echo "[dhm-pipeline] Done. Total size:"
du -sh "$OUTPUT"
echo ""
echo "Next — deploy tiles to Scaleway Object Storage:"
echo ""
echo "  aws s3 sync $OUTPUT s3://isr-dhm-tiles/ \\"
echo "    --endpoint-url=https://s3.fr-par.scw.cloud \\"
echo "    --content-encoding gzip \\"
echo "    --exclude '*' --include '*.terrain'"
echo ""
echo "  aws s3 sync $OUTPUT s3://isr-dhm-tiles/ \\"
echo "    --endpoint-url=https://s3.fr-par.scw.cloud \\"
echo "    --exclude '*.terrain'"
echo ""
echo "  # Two-pass sync: .terrain files get Content-Encoding: gzip header,"
echo "  # layer.json + other non-tile files stay uncompressed."
echo "  # For sovereign customers use SIGNED URLS, not --acl public-read."
