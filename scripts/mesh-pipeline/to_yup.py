#!/usr/bin/env python3
"""
Rotate a Z-up OBJ into the Y-up convention 3D Tiles expects.

THIS IS THE STEP WHOSE ABSENCE MADE EVERY BUILDING FLOAT.

ODM writes `odm_textured_model_geo.obj` Z-up: x east, y north, z height
in metres. glTF, and therefore 3D Tiles, is Y-up. Obj2Tiles does not
convert, and it writes each tile's `boundingVolume.box` already rotated
as though the input had been Y-up. Cesium then reads a tileset with no
`asset.gltfUpAxis` and applies its default, Y, rotating the content the
same way:

    glTF (x, y, z)  ->  world (x, -z, y)

Box and content agree with each other, so nothing anywhere reports an
error, and both are wrong by ninety degrees about the east axis. Height
lands in the north axis and north becomes height.

Measured at Billund, the mesh rendered as an 802 x 36 x 301 m vertical
slab, pushed about 96 m south, reaching 170 m above terrain. With world
terrain on, the lower part is buried and the rest sticks out, which is
why it read as blocks floating in the middle of nowhere rather than as
a wall. Every reconstruction produced exactly the same artifact,
because it belongs to the tiler and not to the mesh, which is why five
different meshes looked identical.

The fix is one transform applied before tiling:

    y_out =  z_in        height becomes glTF up
    z_out = -y_in        north becomes glTF -forward

Cesium's default rotation then puts it back exactly:
(x, z, -y) -> (x, --y, z) -> (x, y, z). Box, content and Cesium all
agree, and the tileset needs no post-processing.

The alternative is to set `asset.gltfUpAxis = "Z"` AND rewrite every
bounding box, since they currently match the rotated content and
changing one alone breaks culling. One transform here is less to get
wrong.

Vertices only. Texture coordinates, materials and face indices pass
through untouched, so the atlas still applies.

Usage:
    python3 to_yup.py --in buildings_only.obj --out buildings_only_yup.obj
"""

import argparse
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    a = ap.parse_args()

    src, dst = Path(a.src), Path(a.dst)
    if not src.exists():
        raise SystemExit(f"No such file: {src}")

    n_v = n_vn = 0
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    with open(src) as fin, open(dst, "w") as fout:
        for line in fin:
            if line.startswith("v "):
                p = line.split()
                x, y, z = float(p[1]), float(p[2]), float(p[3])
                for i, v in enumerate((x, y, z)):
                    lo[i] = min(lo[i], v)
                    hi[i] = max(hi[i], v)
                fout.write(f"v {x} {z} {-y}\n")
                n_v += 1
            elif line.startswith("vn "):
                # Normals are directions and rotate the same way. ODM
                # emits none today, so this is here so that a mesh which
                # does carry them is not silently left inconsistent with
                # its own geometry.
                p = line.split()
                x, y, z = float(p[1]), float(p[2]), float(p[3])
                fout.write(f"vn {x} {z} {-y}\n")
                n_vn += 1
            else:
                # mtllib, usemtl, vt, f, o, g, s all pass through. Face
                # indices are unchanged because vertex order is unchanged.
                fout.write(line)

    print(f"{n_v:,} vertices rotated Z-up -> Y-up" +
          (f", {n_vn:,} normals" if n_vn else ""))
    print(f"  in   east {lo[0]:.1f}..{hi[0]:.1f}  north {lo[1]:.1f}..{hi[1]:.1f}  "
          f"up {lo[2]:.1f}..{hi[2]:.1f}")
    print(f"  out  x {lo[0]:.1f}..{hi[0]:.1f}  y(up) {lo[2]:.1f}..{hi[2]:.1f}  "
          f"z {-hi[1]:.1f}..{-lo[1]:.1f}")
    print(f"wrote {dst}  ({dst.stat().st_size / 1e6:.1f} MB)")
    print("Tile THIS file, not the Z-up one.")


if __name__ == "__main__":
    main()
