#!/usr/bin/env python3
"""Report what a simplification did to a GLB, against its source.

Triangles, size, node count and names, animations and their channels,
extensionsUsed, and the COMPOSED bounding extent (every vertex through its
node's full transform chain), which is the only extent that means
anything on a model with hinge matrices. Exits non-zero if a node name,
an animation or an extension went missing.

Usage:  python3 scripts/verify_glb_simplify.py SRC.glb OUT.glb [EXTENT_TOL_M]

EXTENT_TOL_M defaults to 0.001. Raise it only with a measured reason: the
Sivrisinek's bolt heads stood 6 mm proud of the wingtips, so stripping
them shrinks the composed extent by exactly that, and the recipe passes
0.007 and says why.
"""
import sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import group_rotor_nodes as G  # noqa: E402


def stats(path):
    gltf, binary = G.read_glb(path)
    tris = sum(gltf["accessors"][p["indices"]]["count"] // 3
               for m in gltf.get("meshes", []) for p in m["primitives"] if "indices" in p)
    gl, _ = G.globals_of(gltf)
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for i, n in enumerate(gltf["nodes"]):
        if "mesh" not in n:
            continue
        for prim in gltf["meshes"][n["mesh"]]["primitives"]:
            for p in G.accessor_values(gltf, binary, prim["attributes"]["POSITION"]):
                q = G.apply(gl[i], p)
                lo = [min(a, b) for a, b in zip(lo, q)]
                hi = [max(a, b) for a, b in zip(hi, q)]
    import os
    return {
        "size_mb": os.path.getsize(path) / 1e6,
        "tris": tris,
        "nodes": [n.get("name") for n in gltf["nodes"]],
        "anims": [(a.get("name"), len(a.get("channels", []))) for a in gltf.get("animations", [])],
        "ext": sorted(gltf.get("extensionsUsed", [])),
        "lo": lo, "hi": hi,
    }


def main():
    src, out = sys.argv[1], sys.argv[2]
    tol = float(sys.argv[3]) if len(sys.argv) > 3 else 0.001
    a, b = stats(src), stats(out)
    bad = 0
    print(f"triangles  {a['tris']:>9,} -> {b['tris']:>9,}   ratio {b['tris']/a['tris']:.3f}")
    print(f"size       {a['size_mb']:9.2f} -> {b['size_mb']:9.2f} MB")
    print(f"nodes      {len(a['nodes'])} -> {len(b['nodes'])}")
    missing = [n for n in a["nodes"] if n not in b["nodes"]]
    if missing or len(a["nodes"]) != len(b["nodes"]):
        bad += 1
        print(f"  MISSING nodes: {missing}")
    print(f"animations {a['anims']} -> {b['anims']}")
    if a["anims"] != b["anims"]:
        bad += 1
        print("  ANIMATIONS CHANGED")
    print(f"extensions {a['ext']} -> {b['ext']}")
    lost = [e for e in a["ext"] if e not in b["ext"]]
    if lost:
        bad += 1
        print(f"  EXTENSIONS LOST: {lost}")
    d = [max(abs(x - y), abs(u - v)) for x, y, u, v in zip(a["lo"], b["lo"], a["hi"], b["hi"])]
    print(f"extent     {[round(h - l, 4) for l, h in zip(a['lo'], a['hi'])]} -> "
          f"{[round(h - l, 4) for l, h in zip(b['lo'], b['hi'])]}  max corner drift {max(d):.4f}")
    if max(d) > tol:
        bad += 1
        print(f"  EXTENT DRIFTED by more than {tol * 1000:.0f} mm")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
