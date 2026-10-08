#!/usr/bin/env python3
"""Merge a static GLB into a host GLB as one named node.

Companion to bake_posed_figure.py. That turns a rigged figure into plain
triangles; this drops those triangles into another model so they inherit
its position, heading and bank for free, the way the rotor nodes do.

Only handles STATIC sources: POSITION, NORMAL and indices, one material.
That is deliberate rather than a limitation. Anything skinned should be
baked first, because carrying a skeleton across means reconciling joint
indices between two files and paying skinning cost every frame for
something that never moves.

The host is not otherwise touched: existing meshes, accessors and
bufferViews are left byte-identical and the new data is appended.

Usage
-----
  python3 scripts/merge_static_glb.py host.glb addition.glb out.glb \\
      --name Door_Gunner --x -40 --y -75 --z 130
"""

import argparse
import json
import struct
import sys

GLB_MAGIC, JSON_CHUNK, BIN_CHUNK = b"glTF", b"JSON", b"BIN\x00"
COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


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
    return gltf, bytearray(binary)


def accessor(gltf, binary, index):
    acc = gltf["accessors"][index]
    fmt, size = COMPONENT[acc["componentType"]]
    n = COUNT[acc["type"]]
    view = gltf["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or size * n
    return [struct.unpack_from("<" + fmt * n, binary, base + i * stride)
            for i in range(acc["count"])]


def pad4(data, filler=b"\x00"):
    return bytes(data) + filler * (-len(data) % 4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("host")
    ap.add_argument("addition")
    ap.add_argument("dst")
    ap.add_argument("--name", default="Merged")
    ap.add_argument("--x", type=float, default=0.0)
    ap.add_argument("--y", type=float, default=0.0)
    ap.add_argument("--z", type=float, default=0.0)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--parent-of-mesh", type=int, default=0,
                    help="attach beside the node holding this host mesh index")
    args = ap.parse_args()

    host, hbin = read_glb(args.host)
    add, abin = read_glb(args.addition)

    if len(add["meshes"]) != 1 or len(add["meshes"][0]["primitives"]) != 1:
        sys.exit("addition must be a single mesh with a single primitive; bake it first")
    prim = add["meshes"][0]["primitives"][0]
    pos = accessor(add, abin, prim["attributes"]["POSITION"])
    nrm = accessor(add, abin, prim["attributes"]["NORMAL"])
    idx = [v[0] for v in accessor(add, abin, prim["indices"])]
    if args.scale != 1.0:
        pos = [tuple(c * args.scale for c in v) for v in pos]

    def put(raw):
        host["bufferViews"].append(
            {"buffer": 0, "byteOffset": len(hbin), "byteLength": len(raw)})
        hbin.extend(raw)
        hbin.extend(b"\x00" * (-len(hbin) % 4))
        return len(host["bufferViews"]) - 1

    lo = [min(v[k] for v in pos) for k in range(3)]
    hi = [max(v[k] for v in pos) for k in range(3)]
    host["accessors"].append({
        "bufferView": put(b"".join(struct.pack("<fff", *v) for v in pos)),
        "componentType": 5126, "count": len(pos), "type": "VEC3",
        "min": [float(v) for v in lo], "max": [float(v) for v in hi]})
    a_pos = len(host["accessors"]) - 1
    host["accessors"].append({
        "bufferView": put(b"".join(struct.pack("<fff", *v) for v in nrm)),
        "componentType": 5126, "count": len(nrm), "type": "VEC3"})
    a_nrm = len(host["accessors"]) - 1
    host["accessors"].append({
        "bufferView": put(b"".join(struct.pack("<I", i) for i in idx)),
        "componentType": 5125, "count": len(idx), "type": "SCALAR"})
    a_idx = len(host["accessors"]) - 1

    src_mat = add["materials"][prim.get("material", 0)]
    host.setdefault("materials", []).append(dict(src_mat, name=args.name))
    mat = len(host["materials"]) - 1

    host["meshes"].append({"name": args.name, "primitives": [
        {"attributes": {"POSITION": a_pos, "NORMAL": a_nrm},
         "indices": a_idx, "material": mat}]})
    host["nodes"].append({"name": args.name, "mesh": len(host["meshes"]) - 1,
                          "translation": [args.x, args.y, args.z]})
    new_node = len(host["nodes"]) - 1

    owner = next(i for i, n in enumerate(host["nodes"])
                 if n.get("mesh") == args.parent_of_mesh)
    parent = next((i for i, n in enumerate(host["nodes"])
                   if owner in n.get("children", [])), None)
    if parent is None:
        sys.exit("could not find the host mesh node's parent")
    host["nodes"][parent].setdefault("children", []).append(new_node)

    host["buffers"][0]["byteLength"] = len(hbin)
    js = pad4(json.dumps(host, separators=(",", ":")).encode(), b" ")
    bn = pad4(hbin)
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(args.dst, "wb") as fh:
        fh.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
        fh.write(struct.pack("<I4s", len(js), JSON_CHUNK))
        fh.write(js)
        fh.write(struct.pack("<I4s", len(bn), BIN_CHUNK))
        fh.write(bn)
    print(f"  merged {len(idx)//3} triangles as node {new_node} {args.name!r}")
    print(f"  at ({args.x:.0f}, {args.y:.0f}, {args.z:.0f}), parented under "
          f"{host['nodes'][parent].get('name','?')[:40]!r}")
    print(f"  occupies X {lo[0]+args.x:.0f}..{hi[0]+args.x:.0f}  "
          f"Y {lo[1]+args.y:.0f}..{hi[1]+args.y:.0f}  Z {lo[2]+args.z:.0f}..{hi[2]+args.z:.0f}")
    print(f"  wrote {args.dst}  ({total/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
