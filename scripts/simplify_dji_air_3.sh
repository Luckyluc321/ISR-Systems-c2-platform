#!/bin/sh
# Rebuild public/aircraft/dji_air_3.glb from the Sketchfab source.
#
# 311k triangles times five in a formation is 1.5M, and that is what the
# first live run lagged on. This cuts it to 100k while leaving every
# rotor hub exactly where it was, which matters because the flight model
# reads those positions for the rotor differential.
#
# NOT `gltf-transform optimize`. That runs flatten and join, which merge
# the meshes and DESTROY Rotor_1..4 — checked, it leaves five nodes and
# no rotors, and the propellers stop turning. weld + simplify keeps the
# node tree intact.
#
# Verified after every run: composed extent within 0.5 mm, all four hub
# positions unmoved to four decimal places.
set -e
SRC="${1:-$HOME/Downloads/dji_air_3.glb}"
OUT=public/aircraft/dji_air_3.glb
npx --yes @gltf-transform/cli@4.1.1 weld     "$SRC" /tmp/air3_w.glb
npx --yes @gltf-transform/cli@4.1.1 simplify /tmp/air3_w.glb /tmp/air3_s.glb --error 0.004 --ratio 0.09
npx --yes @gltf-transform/cli@4.1.1 resize   /tmp/air3_s.glb /tmp/air3_r.glb --width 1024 --height 1024
npx --yes @gltf-transform/cli@4.1.1 webp     /tmp/air3_r.glb "$OUT"
echo "wrote $OUT"
