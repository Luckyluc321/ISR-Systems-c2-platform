#!/usr/bin/env python3
"""Re-parent existing nodes under one new node, so they can be moved together.

Why
---
The door gunner and his gun are two separate nodes. To traverse the gun
onto a target they have to turn as a unit, keeping their stance: the man
swings with the weapon, he does not watch it rotate away from his hands.

Cesium can transform a node, so the two need a shared parent to
transform. This inserts one, at a chosen pivot, and rewrites the
children's translations to be relative to it so nothing moves.

The pivot matters: it should be the axis the thing actually turns about,
which for a pintle-mounted gun is the post, not the centroid of the
group.

Usage
-----
  python3 scripts/group_nodes.py in.glb out.glb \\
      --name Gun_Station --pivot -95,-310,75 --children Door_Gunner,Door_Gunner_Figure
"""

import argparse
import json
import struct
import sys

GLB_MAGIC, JSON_CHUNK, BIN_CHUNK = b"glTF", b"JSON", b"BIN\x00"


def read_glb(path):
    blob = open(path, "rb").read()
    total = struct.unpack("<I", blob[8:12])[0]
    off, gltf, binary = 12, None, b""
    while off < total:
        length, kind = struct.unpack("<I4s", blob[off:off + 8])
        payload = blob[off + 8:off + 8 + length]
        if kind == JSON_CHUNK:
            gltf = json.loads(payload)
        elif kind == BIN_CHUNK:
            binary = payload
        off += 8 + length
    return gltf, binary


def pad4(data, filler=b"\x00"):
    return bytes(data) + filler * (-len(data) % 4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--name", required=True)
    ap.add_argument("--pivot", required=True, help="x,y,z in model units")
    ap.add_argument("--children", required=True, help="comma-separated node names")
    args = ap.parse_args()

    gltf, binary = read_glb(args.src)
    pivot = [float(v) for v in args.pivot.split(",")]
    want = args.children.split(",")

    idx = {}
    for i, n in enumerate(gltf["nodes"]):
        if n.get("name") in want:
            idx[n["name"]] = i
    missing = [w for w in want if w not in idx]
    if missing:
        sys.exit(f"no such node(s): {missing}")

    # Detach from their current parents.
    moved = set(idx.values())
    old_parent = None
    for n in gltf["nodes"]:
        kids = n.get("children")
        if not kids:
            continue
        keep = [c for c in kids if c not in moved]
        if len(keep) != len(kids):
            old_parent = n
            n["children"] = keep

    # Rewrite each child's translation to be relative to the pivot, so
    # the group keeps its exact shape and position.
    for name in want:
        n = gltf["nodes"][idx[name]]
        t = n.get("translation", [0, 0, 0])
        n["translation"] = [t[k] - pivot[k] for k in range(3)]
        print(f"  {name:<22} {[round(v,1) for v in t]} -> {[round(v,1) for v in n['translation']]}")

    gltf["nodes"].append({"name": args.name, "translation": pivot,
                          "children": [idx[w] for w in want]})
    station = len(gltf["nodes"]) - 1
    if old_parent is None:
        sys.exit("could not find the children's original parent")
    old_parent.setdefault("children", []).append(station)
    print(f"\n  created node {station} {args.name!r} at pivot {pivot}")
    print(f"  under {old_parent.get('name','?')[:44]!r}, holding {len(want)} children")

    js = pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    bn = pad4(binary)
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(args.dst, "wb") as fh:
        fh.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
        fh.write(struct.pack("<I4s", len(js), JSON_CHUNK))
        fh.write(js)
        fh.write(struct.pack("<I4s", len(bn), BIN_CHUNK))
        fh.write(bn)
    print(f"  wrote {args.dst}  ({total/1e6:.2f} MB, geometry untouched)")


if __name__ == "__main__":
    main()
