#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════
# Deploy Cesium 3D Tiles output to Scaleway Object Storage
# ═════════════════════════════════════════════════════════════════════════
#
# Prerequisites:
#   - Scaleway Object Storage bucket created + IAM access keys
#   - aws-cli installed
#   - ~/.aws/credentials configured with [isr-scaleway] profile
#
# Env:
#   SCW_BUCKET     default isr-city-tiles
#   SCW_REGION     default fr-par
#   SCW_PROFILE    default isr-scaleway
#   PUBLIC         'yes' for --acl public-read (dev only); default no
# ═════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCW_BUCKET=${SCW_BUCKET:-isr-city-tiles}
SCW_REGION=${SCW_REGION:-fr-par}
SCW_PROFILE=${SCW_PROFILE:-isr-scaleway}
PUBLIC=${PUBLIC:-no}
ENDPOINT="https://s3.${SCW_REGION}.scw.cloud"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source directory. Defaults to this pipeline's own ./output/, which is
# what the city-tiles exporter writes, but takes a path so the same
# deploy works for the skraafoto mesh pipeline:
#
#   ./deploy-scaleway.sh ../mesh-pipeline/work/billund-combined
#
# SYMLINKS ARE FOLLOWED ON PURPOSE. combine_tilesets.py composes a site
# out of one symlink per build, deliberately, so that re-running one
# build does not require re-running the others and no copy can go stale.
# Without --follow-symlinks the sync walks past every one of them and
# uploads a parent tileset.json pointing at five children that are not
# there: 1.8 kB on the bucket, a tileset that resolves to nothing, and
# no error anywhere.
OUTPUT="${1:-${HERE}/output}"
OUTPUT="$(cd "$OUTPUT" 2>/dev/null && pwd)" || { echo "ERROR: no such directory: ${1:-${HERE}/output}"; exit 1; }
[ -z "$(ls -A "$OUTPUT" 2>/dev/null)" ] && { echo "ERROR: $OUTPUT is empty."; exit 1; }
[ -f "$OUTPUT/tileset.json" ] || { echo "ERROR: no tileset.json in $OUTPUT. That is the entry point the app loads."; exit 1; }
echo "[deploy-scaleway] Source: $OUTPUT"

ACL_FLAG=""
if [ "$PUBLIC" = "yes" ]; then
  ACL_FLAG="--acl public-read"
  echo "WARN: --acl public-read set. Sovereign customers should use signed URLs instead."
fi

echo "[deploy-scaleway] Bucket: s3://${SCW_BUCKET} (${SCW_REGION})"

# 3D Tiles are typically served without compression (b3dm binary already tight).
# JSON metadata could benefit from gzip BUT we need to actually compress
# the bytes on disk before setting the Content-Encoding header — aws-cli
# sets the header but does NOT compress. Skipping gzip on JSON entirely
# for correctness. If you want gzip'd JSON: pre-run `gzip -9 -k *.json`
# then use `--content-encoding gzip`.
echo ""
echo "[deploy-scaleway] Uploading tileset.json + metadata (uncompressed)..."
aws s3 sync "$OUTPUT" "s3://${SCW_BUCKET}/" \
  --profile "$SCW_PROFILE" \
  --endpoint-url "$ENDPOINT" \
  --follow-symlinks \
  --content-type "application/json" \
  --exclude "*" --include "*.json" \
  $ACL_FLAG

echo "[deploy-scaleway] Uploading .b3dm binary tiles..."
aws s3 sync "$OUTPUT" "s3://${SCW_BUCKET}/" \
  --profile "$SCW_PROFILE" \
  --endpoint-url "$ENDPOINT" \
  --follow-symlinks \
  --content-type "application/octet-stream" \
  --exclude "*" --include "*.b3dm" \
  $ACL_FLAG

echo "[deploy-scaleway] Uploading remaining assets..."
aws s3 sync "$OUTPUT" "s3://${SCW_BUCKET}/" \
  --profile "$SCW_PROFILE" \
  --endpoint-url "$ENDPOINT" \
  --follow-symlinks \
  --exclude "*.json" --exclude "*.b3dm" \
  $ACL_FLAG

# CORS — Cesium browser fetches need this
echo "[deploy-scaleway] Setting CORS on bucket..."
cat > /tmp/cors.json <<EOF
{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF
aws s3api put-bucket-cors \
  --profile "$SCW_PROFILE" \
  --endpoint-url "$ENDPOINT" \
  --bucket "$SCW_BUCKET" \
  --cors-configuration file:///tmp/cors.json

# ── Verify, because the sync does not ─────────────────────────────────
#
# `aws s3 sync` reports a per-file failure and still exits 0. Deploying
# Billund, five tiles timed out, one of them printed a RequestTimeout and
# four scrolled past unremarked, and the script carried on and claimed
# success. A tileset short five tiles does not error in Cesium either: it
# renders the holes as nothing.
#
# So count both sides and refuse to claim success unless they match.
# --follow-symlinks on the find, for the same reason as the syncs.
echo ""
echo "[deploy-scaleway] Verifying every local file arrived..."
LOCAL_N=$(find -L "$OUTPUT" -type f ! -name '.*' | wc -l | tr -d ' ')
REMOTE_N=$(aws s3 ls "s3://${SCW_BUCKET}/" --recursive \
  --profile "$SCW_PROFILE" --endpoint-url "$ENDPOINT" | wc -l | tr -d ' ')
echo "[deploy-scaleway]   local ${LOCAL_N}, remote ${REMOTE_N}"
if [ "$LOCAL_N" != "$REMOTE_N" ]; then
  echo "[deploy-scaleway] INCOMPLETE: ${LOCAL_N} local files, ${REMOTE_N} on the bucket."
  echo "[deploy-scaleway] Re-run this script. The sync skips what is already there,"
  echo "[deploy-scaleway] so a second pass costs only the missing files."
  exit 1
fi

echo ""
echo "[deploy-scaleway] Done."
echo "Point the app at it in .env.local:"
echo "  VITE_SITE_MESH_URL=${ENDPOINT}/${SCW_BUCKET}     # skraafoto mesh (billund-combined)"
echo "  VITE_CITY_TILES_URL=${ENDPOINT}/${SCW_BUCKET}    # city-tiles exporter output"
