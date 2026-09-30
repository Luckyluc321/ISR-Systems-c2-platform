#!/usr/bin/env bash
# Run OpenDroneMap over a prepared skråfoto project.
#
# ODM is the pragmatic choice here rather than the theoretically ideal
# one. COLMAP's dense stereo is CUDA-only, so it does not run on an
# Apple machine at all. ODM publishes a native arm64 image and does the
# whole chain in one command: matching, dense point cloud, mesh,
# texturing. When this is proven, a GPU box will do it faster; the point
# now is to find out whether it works.
#
# Usage:
#   ./run_odm.sh ./work/billund-terminal/odm            # default settings
#   FAST=1 ./run_odm.sh ./work/billund-terminal/odm     # quick, rough
set -euo pipefail

PROJECT="${1:-}"
[ -z "$PROJECT" ] && { echo "usage: $0 <odm project dir>"; exit 1; }
PROJECT="$(cd "$PROJECT" && pwd)"
[ -d "$PROJECT/images" ] || { echo "no images/ in $PROJECT — run prep_odm.py first"; exit 1; }

N=$(find "$PROJECT/images" -name '*.jpg' | wc -l | tr -d ' ')
echo "project : $PROJECT"
echo "images  : $N"
[ -f "$PROJECT/geo.txt" ] && echo "geo.txt : $(( $(wc -l < "$PROJECT/geo.txt") - 1 )) cameras" \
                          || echo "geo.txt : MISSING — ODM will solve poses itself, much slower"

# ODM wants the project as a subdirectory of a mounted parent, and takes
# the leaf name as the project name.
PARENT="$(dirname "$PROJECT")"
NAME="$(basename "$PROJECT")"

# --- options -------------------------------------------------------
# feature-quality/pc-quality drive cost more than anything else.
# FAST trades detail for a result you can look at today.
if [ "${FAST:-0}" = "1" ]; then
  QUALITY=(--feature-quality medium --pc-quality medium)
  echo "mode    : FAST"
else
  QUALITY=(--feature-quality high --pc-quality high)
  echo "mode    : normal"
fi

OPTS=(
  --project-path /datasets "$NAME"
  "${QUALITY[@]}"
  # Oblique imagery: matching only nearby frames misses the cross-views
  # between cones, and the cross-views are the entire reason facades
  # reconstruct rather than just roofs.
  --matcher-neighbors 0
  # We want the mesh, not the survey products. Skipping these saves a
  # large share of the runtime.
  --skip-orthophoto
  --skip-report
  # 3D Tiles output, which is what the C2 map consumes. ODM can emit it
  # directly, so the separate conversion step may not be needed at all.
  --3d-tiles
  # Texture the mesh from the source imagery. Untextured geometry is
  # just better-shaped grey boxes, which is the thing being replaced.
  --texturing-single-material
  --verbose
)

echo "opts    : ${OPTS[*]}"
echo
echo "Starting. First run pulls a large image."
echo

time docker run --rm \
  -v "$PARENT":/datasets \
  --memory=12g \
  opendronemap/odm:latest \
  "${OPTS[@]}"

echo
echo "outputs under $PROJECT:"
for p in odm_texturing/odm_textured_model_geo.obj odm_meshing/odm_mesh.ply \
         odm_georeferencing/odm_georeferenced_model.laz 3d_tiles; do
  [ -e "$PROJECT/$p" ] && echo "  OK      $p" || echo "  missing $p"
done
echo
echo "Heights are DVR90 (orthometric). See VERTICAL_DATUM.txt before tiling for Cesium."
