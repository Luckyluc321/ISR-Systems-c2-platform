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
  # Medium feature quality. This was raised to high on the theory that
  # weak features caused the false matches seen earlier, but the false
  # matches came from forcing all-pairs matching, which is fixed below.
  #
  # High quality was never actually exercised from scratch: the run it
  # appeared to succeed in reused features already extracted at medium.
  # From a cold start it aborts during extraction with "terminate called
  # without an active exception", a thread dying under memory pressure
  # inside a 7.75 GB container.
  QUALITY=(--feature-quality medium --pc-quality medium)
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
  # Mesh density, sized for the cropped area rather than for everything
  # the cameras saw. Over 0.35 km2 this is roughly 6 triangles per square
  # metre, enough for a wall to be a wall. The earlier 300,000 was chosen
  # to survive a memory crash while covering 14.6 km2, which worked out
  # at one triangle per 26 m2 and could not represent a building at all.
  # 1.5 million over 0.51 km2 is about 3 triangles per square metre,
  # which is ample for a building wall. 2 million produced a good mesh
  # (3,989,396 faces) and then ran out of memory during texturing, and
  # texturing cost scales with face count. Detail nobody can see is not
  # worth a failed run.
  # Back to the values that produced the textured model that was
  # actually approved. Later runs chased more detail over a cropped
  # area, ran out of memory at texturing every time, and ended up
  # delivering nothing at all. A model you can look at beats a denser
  # one that never finishes.
  --mesh-size 300000
  --mesh-octree-depth 11
  # No --max-concurrency. It was added on the theory that thread count
  # was causing the aborts; the run that actually completed did not set
  # it, and setting it did not stop them.
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
# Crop to the area of interest. Without this ODM reconstructs every
# square metre the cameras could see, and the triangle budget is spread
# across ground nobody asked for.
[ -f "$PROJECT/boundary.geojson" ] && OPTS+=(--boundary "/datasets/$NAME/boundary.geojson")
[ -n "$RERUN" ] && OPTS+=(--rerun-from "$RERUN")

echo "opts    : ${OPTS[*]}"
echo
echo "Starting. First run pulls a large image."
echo

# No --memory by default.
#
# The successful run passed --memory=12g against a Docker VM that only
# has 7.75 GB, so the flag could not be satisfied and the container was
# effectively uncapped, taking whatever the VM had. Changing it to a
# deliverable 7g then capped the container BELOW the VM's own limit and
# feature extraction started aborting with "terminate called without an
# active exception".
#
# Omitting it entirely is what that run was doing in practice. Set
# DOCKER_MEM explicitly to cap it on purpose.
time docker run --rm \
  -v "$PARENT":/datasets \
  ${DOCKER_MEM:+--memory=$DOCKER_MEM} \
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
