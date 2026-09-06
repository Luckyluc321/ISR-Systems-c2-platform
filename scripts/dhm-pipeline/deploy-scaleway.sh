#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════
# Deploy quantized-mesh output to Scaleway Object Storage
# ═════════════════════════════════════════════════════════════════════════
#
# Prerequisites:
#   - Scaleway Object Storage bucket created + IAM access keys
#   - aws-cli installed
#   - ~/.aws/credentials configured with the [isr-scaleway] profile:
#       [isr-scaleway]
#       aws_access_key_id     = SCWXXXXXXXXXXXXXX
#       aws_secret_access_key = <secret>
#
# Env:
#   SCW_BUCKET     default isr-dhm-tiles
#   SCW_REGION     default fr-par
#   SCW_PROFILE    default isr-scaleway
#   PUBLIC         'yes' for --acl public-read (dev only); default no
# ═════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCW_BUCKET=${SCW_BUCKET:-isr-dhm-tiles}
SCW_REGION=${SCW_REGION:-fr-par}
SCW_PROFILE=${SCW_PROFILE:-isr-scaleway}
PUBLIC=${PUBLIC:-no}
ENDPOINT="https://s3.${SCW_REGION}.scw.cloud"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="${HERE}/output"
[ -d "$OUTPUT" ] || { echo "ERROR: no ./output/ dir. Run docker compose run --rm build first."; exit 1; }
[ -z "$(ls -A "$OUTPUT" 2>/dev/null)" ] && { echo "ERROR: ./output/ is empty."; exit 1; }

ACL_FLAG=""
if [ "$PUBLIC" = "yes" ]; then
  ACL_FLAG="--acl public-read"
  echo "WARN: --acl public-read set. Sovereign customers should use signed URLs instead."
fi

echo "[deploy-scaleway] Bucket: s3://${SCW_BUCKET} (${SCW_REGION})"
echo ""

# Pass 1: .terrain files with Content-Encoding: gzip
# (files are gzip-compressed on disk but named .terrain; Cesium expects
# the browser to receive them via Content-Encoding: gzip so it decodes)
echo "[deploy-scaleway] Uploading .terrain tiles with Content-Encoding: gzip..."
aws s3 sync "$OUTPUT" "s3://${SCW_BUCKET}/" \
  --profile "$SCW_PROFILE" \
  --endpoint-url "$ENDPOINT" \
  --content-encoding gzip \
  --content-type "application/vnd.quantized-mesh" \
  --exclude "*" --include "*.terrain" \
  $ACL_FLAG

# Pass 2: layer.json + everything else (uncompressed metadata)
echo "[deploy-scaleway] Uploading layer.json + other files..."
aws s3 sync "$OUTPUT" "s3://${SCW_BUCKET}/" \
  --profile "$SCW_PROFILE" \
  --endpoint-url "$ENDPOINT" \
  --exclude "*.terrain" \
  $ACL_FLAG

# CORS — Cesium needs CORS headers on the bucket for browser fetch
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
echo "Set VITE_DHM_TERRAIN_URL=${ENDPOINT}/${SCW_BUCKET} in .env.local"
echo "(or your custom TLS-terminated domain if bucket sits behind CloudFront-equivalent)"
