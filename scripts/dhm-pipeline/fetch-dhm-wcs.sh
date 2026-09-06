#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════
# Fetch DHM/Terræn tiles from SDFI WCS for a bbox
# ═════════════════════════════════════════════════════════════════════════
#
# For a full-country build, use the Datafordeler FTP order flow instead
# (this WCS is rate-limited + tiles must be requested individually).
# This script is for TEST / single-site builds (a few km² around a site).
#
# Usage:
#   export SDFI_TOKEN=your-token
#   BBOX_E_MIN=505000 BBOX_E_MAX=520000 BBOX_N_MIN=6170000 BBOX_N_MAX=6185000 \
#     ./fetch-dhm-wcs.sh
#
# Env:
#   SDFI_TOKEN    (required)
#   BBOX_*        EPSG:25832 metres — extent to fetch
#   TILE_SIZE_M   default 1000 (1km tiles)
#   COVERAGE      default dhm_terraen (also: dhm_overflade, dhm_bathymetri)
# ═════════════════════════════════════════════════════════════════════════

set -euo pipefail

: "${SDFI_TOKEN:?set SDFI_TOKEN (dataforsyningen.dk → Min side → Token)}"
: "${BBOX_E_MIN:?set BBOX_E_MIN (EPSG:25832 east minimum)}"
: "${BBOX_E_MAX:?set BBOX_E_MAX}"
: "${BBOX_N_MIN:?set BBOX_N_MIN}"
: "${BBOX_N_MAX:?set BBOX_N_MAX}"

TILE_SIZE_M=${TILE_SIZE_M:-1000}
COVERAGE=${COVERAGE:-dhm_terraen}
RES_M=${RES_M:-0.4}   # DHM native resolution 0.4m/pixel
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT_DIR="${HERE}/input"
mkdir -p "$INPUT_DIR"

# NOTE: live-verified 2026-09-02 — SDFI dhm_wcs_DAF is WCS 1.0.0, NOT 2.0.1.
# Available coverages: dhm_terraen (DTM), dhm_overflade (DSM).
# GetCoverage uses: bbox=minX,minY,maxX,maxY + crs=EPSG:25832 + width/height.

# Compute pixel dimensions per tile from res
PX=$(( TILE_SIZE_M * 10 / (${RES_M%.*}${RES_M##*.}) ))
[ "$PX" -lt 100 ] && PX=$(( TILE_SIZE_M / 1 ))   # fallback if arithmetic misbehaves

echo "[fetch-dhm-wcs] Bbox: E ${BBOX_E_MIN}-${BBOX_E_MAX}, N ${BBOX_N_MIN}-${BBOX_N_MAX}"
echo "[fetch-dhm-wcs] Tile size: ${TILE_SIZE_M}m at ${RES_M}m/px → ${PX}×${PX}"
echo "[fetch-dhm-wcs] Coverage: ${COVERAGE} (WCS 1.0.0)"

count=0
for ((e = BBOX_E_MIN; e < BBOX_E_MAX; e += TILE_SIZE_M)); do
  for ((n = BBOX_N_MIN; n < BBOX_N_MAX; n += TILE_SIZE_M)); do
    e_end=$((e + TILE_SIZE_M))
    n_end=$((n + TILE_SIZE_M))
    out="${INPUT_DIR}/${COVERAGE}_${n}_${e}.tif"
    if [ -f "$out" ]; then
      echo "  skip (exists): $(basename "$out")"
      continue
    fi
    url="https://api.dataforsyningen.dk/dhm_wcs_DAF?service=WCS&version=1.0.0&request=GetCoverage&coverage=${COVERAGE}&bbox=${e},${n},${e_end},${n_end}&crs=EPSG:25832&format=GTiff&width=${PX}&height=${PX}&token=${SDFI_TOKEN}"
    echo "  fetching: $(basename "$out")"
    curl -sSf -o "$out" "$url" || { echo "    FAILED, removing partial file"; rm -f "$out"; }
    count=$((count + 1))
    sleep 0.2   # be nice to SDFI rate limits
  done
done

echo "[fetch-dhm-wcs] Done. $(ls "$INPUT_DIR" | wc -l | tr -d ' ') files in ${INPUT_DIR}"
du -sh "$INPUT_DIR"
