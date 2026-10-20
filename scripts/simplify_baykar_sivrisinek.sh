#!/bin/sh
# Rebuild public/aircraft/baykar_sivrisinek.glb from the Sketchfab source.
#
# 802k triangles, 46.8 MB, and 650k of those triangles are bolts: twelve
# CIVATA nodes of ~56k each, every bolt its own closed island. A
# simplifier cannot take an island below a few dozen triangles, so
# meshoptimizer floors at a quarter of them (170k) at ANY error bound;
# measured at 0.004, 0.01 and 0.025, all 220k total. So the bolt nodes
# keep their place in the tree and lose their mesh, then the rest is
# simplified to half. Result 77,780 triangles, 3.1 MB.
#
# NOT `gltf-transform optimize`: flatten and join merge the meshes and
# destroy named nodes, which here would take the propeller node with
# them. prune needs --keep-leaves true or it deletes the now-empty bolt
# nodes and the count drops from 34 to 22.
#
# The composed extent shrinks by 6 mm in X. That is the bolt heads, which
# stood proud of the wingtips (bolts reach |X| 1.911, the wing 1.905),
# so the verifier is told to allow 7 mm; anything beyond that is drift.
set -e
cd "$(dirname "$0")/.."
SRC="${1:-$HOME/Downloads/baykar_bayraktar_sivrisinek_iha_-_tactical_uav.glb}"
OUT=public/aircraft/baykar_sivrisinek.glb
T="${TMPDIR:-/tmp}/syk"
mkdir -p "$T"
npx --yes @gltf-transform/cli@4.1.1 weld     "$SRC" "$T/w.glb"
python3 -I scripts/strip_meshes.py "$T/w.glb" "$T/nb.glb" 'CIVATA'
npx --yes @gltf-transform/cli@4.1.1 prune    --keep-leaves true "$T/nb.glb" "$T/p.glb"
npx --yes @gltf-transform/cli@4.1.1 simplify "$T/p.glb" "$T/s.glb" --error 0.004 --ratio 0.5
npx --yes @gltf-transform/cli@4.1.1 resize   "$T/s.glb" "$T/r.glb" --width 1024 --height 1024
npx --yes @gltf-transform/cli@4.1.1 webp     "$T/r.glb" "$OUT"
python3 -I scripts/verify_glb_simplify.py "$SRC" "$OUT" 0.007
echo "wrote $OUT"
