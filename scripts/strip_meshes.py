#!/usr/bin/env python3
"""Detach the mesh from every node whose name matches, keeping the node.

Why
---
The Baykar Sivrisinek display model carries its bolts as geometry: twelve
CIVATA (Turkish: bolt) nodes of about 56,000 triangles each, 680k of the
file's 802k. Each bolt is its own closed island, and a simplifier cannot
collapse an island below a few dozen triangles, so meshoptimizer floors
at a quarter of them, 170k, whatever the error bound: measured at 0.004,
0.01 and 0.025, all 220k total. On a map that draws this airframe 1.2 m
long from hundreds of metres, a bolt head is smaller than a pixel.

So the bolt nodes keep their place in the tree and lose their mesh. Node
count, names, animations and the other meshes are untouched; run
`gltf-transform prune` afterwards to drop the orphaned mesh data.

Usage:  python3 scripts/strip_meshes.py in.glb out.glb 'CIVATA'
"""
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import group_rotor_nodes as G  # noqa: E402


def main():
    src, dst, pattern = sys.argv[1], sys.argv[2], re.compile(sys.argv[3], re.I)
    gltf, binary = G.read_glb(src)
    stripped = []
    for n in gltf["nodes"]:
        if "mesh" in n and pattern.search(n.get("name", "")):
            m = gltf["meshes"][n["mesh"]]
            tris = sum(gltf["accessors"][p["indices"]]["count"] // 3 for p in m["primitives"] if "indices" in p)
            stripped.append((n["name"], tris))
            del n["mesh"]
    for name, tris in stripped:
        print(f"  stripped {name}: {tris:,} triangles")
    print(f"  {len(stripped)} node(s) kept, mesh detached; {sum(t for _, t in stripped):,} triangles gone")
    G.write_glb(dst, gltf, binary)


if __name__ == "__main__":
    main()
