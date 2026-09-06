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
OUTPUT="${HERE}/output"
[ -d "$OUTPUT" ] || { echo "ERROR: no ./output/ dir. Run docker compose run --rm exporter first."; exit 1; }
[ -z "$(ls -A "$OUTPUT" 2>/dev/null)" ] && { echo "ERROR: ./output/ is empty."; exit 1; }

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
  --content-type "application/json" \
  --exclude "*" --include "*.json" \
  $ACL_FLAG

echo "[deploy-scaleway] Uploading .b3dm binary tiles..."
aws s3 sync "$OUTPUT" "s3://${SCW_BUCKET}/" \
  --profile "$SCW_PROFILE" \
  --endpoint-url "$ENDPOINT" \
  --content-type "application/octet-stream" \
  --exclude "*" --include "*.b3dm" \
  $ACL_FLAG

echo "[deploy-scaleway] Uploading remaining assets..."
aws s3 sync "$OUTPUT" "s3://${SCW_BUCKET}/" \
  --profile "$SCW_PROFILE" \
  --endpoint-url "$ENDPOINT" \
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

echo ""
echo "[deploy-scaleway] Done."
echo "Set VITE_CITY_TILES_URL=${ENDPOINT}/${SCW_BUCKET} in .env.local"
