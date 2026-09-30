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

# ODM resumes from a named stage, so a failure late in a long run does
# not mean repeating the expensive early stages. Matching and the dense
# point cloud are by far the slowest parts.
RERUN="${RERUN_FROM:-}"

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
  # Feature quality stays high even in FAST mode. The imagery is already
  # downscaled by roughly 20x before ODM sees it, and degrading feature
  # detection on top of that is how matching starts producing the false
  # correspondences described below.
  QUALITY=(--feature-quality high --pc-quality medium)
  echo "mode    : FAST"
else
  QUALITY=(--feature-quality high --pc-quality high)
  echo "mode    : normal"
fi

OPTS=(
  --project-path /datasets "$NAME"
  "${QUALITY[@]}"
  # A 3D mesh, not ODM's default 2.5D one.
  #
  # 2.5D is a height field: one elevation per ground position. It is the
  # right model for nadir survey work and it is what ODM assumes, but it
  # cannot represent a wall, an overhang or anything under a roof. Using
  # it here would discard the exact thing five-direction oblique imagery
  # was flown to capture, which is the facades.
  #
  # It also removes the renderdem stage, which is where the first run
  # ran out of memory.
  --use-3dmesh
  # Mesh complexity. The default targets a survey-grade model and is
  # more than a first look needs, and vertex count drives the memory
  # that killed the first attempt.
  --mesh-size 300000
  --mesh-octree-depth 11
  # Matcher neighbours: let ODM choose, do NOT force all-pairs.
  #
  # The first run set this to 0, meaning match every image against every
  # other. The reasoning was that oblique cones need cross-views, which
  # is true. The effect was the opposite of the intent: with 68 images
  # spread over several kilometres, most pairs share no ground at all,
  # and matching them produces false correspondences that triangulate to
  # arbitrary points in space.
  #
  # The result was a dense cloud spanning 21,000 km with only 9.6 per
  # cent of its points within a kilometre of the median. Poisson then
  # produced a mesh with 10,379 vertices and ZERO faces, and texturing
  # aborted on "Building BVH from 0 faces".
  #
  # ODM's default neighbour selection is driven by camera position, and
  # our positions come from the national mapping agency and are exact.
  # So it can pick genuinely overlapping images, including the
  # cross-cone pairs, far better than forcing all-pairs can.
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
[ -n "$RERUN" ] && OPTS+=(--rerun-from "$RERUN")

echo "opts    : ${OPTS[*]}"
echo
echo "Starting. First run pulls a large image."
echo

time docker run --rm \
  -v "$PARENT":/datasets \
  --memory="${DOCKER_MEM:-7g}" \
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
