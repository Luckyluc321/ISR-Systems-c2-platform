#!/usr/bin/env python3
"""Cut a quadcopter's propeller blades out into their own nodes, so they can spin.

Why
---
assault_drone_concept.glb has no animation and its propellers were written
off as unspinnable because the mesh is "merged". It is merged by MATERIAL,
not welded: every blade is its own connected component, it just shares a
primitive with the airframe. Cesium can only transform a NODE, so the blades
need to be nodes.

What the geometry actually looks like, found by union-find over shared
vertices on mesh 0 (18,238 triangles, 60 components):

    4 identical 862-tri motor housings at (+-1.52, +-1.33)
    8 identical 152-tri blades, two per corner, each a thin plank
      0.93 x 0.18 x 0.09 -- long in X/Y, thin in Z, so the disc lies in
      the XY plane and the spin axis is Z

This lifts those 8 components into 4 new nodes, one per rotor, each holding
its two blades, positioned at the propeller's own centre so that rotating
the node spins the blades about their hub rather than swinging them around
the airframe.

Everything else is left alone. The airframe keeps its vertices; only the
blade triangles are removed from its index buffer.

Usage
-----
  python3 scripts/split_quad_rotors.py in.glb out.glb
  python3 scripts/split_quad_rotors.py in.glb out.glb --dry-run
"""

import argparse
import json
import struct
import sys
from collections import defaultdict

GLB_MAGIC = b"glTF"
JSON_CHUNK = b"JSON"
BIN_CHUNK = b"BIN\x00"
COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

# A blade, as measured. Tolerances are wide enough to survive a different
# export of the same model and tight enough to exclude everything else at
# that corner, which took one correction: at 4.0 this also caught the four
# ARMS joining body to motor, which are long and thin too. They differ in
# thickness, and only in thickness:
#
#     blade  span(0.93, 0.18, 0.09)   flatness 10.5
#     arm    span(0.18, 0.93, 0.18)   flatness  5.1
#
# A propeller blade is a sheet; an arm is a strut. 8.0 sits between them
# with room either side. The housings (862 tris, flatness 1.2) and hub caps
# (110 tris, taller than wide) were never close.
BLADE_TRIS = (100, 260)
BLADE_MIN_FLATNESS = 8.0      # max(x,y) span over z span
BLADE_MIN_LENGTH = 0.5


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


def accessor_values(gltf, binary, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    fmt, size = COMPONENT[acc["componentType"]]
    n = COUNT[acc["type"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or size * n
    return [struct.unpack_from("<" + fmt * n, binary, base + i * stride)
            for i in range(acc["count"])]


def components(positions, indices):
    """Union-find over welded vertex positions -> {root: [triangle index]}."""
    welded, rep = {}, []
    for x, y, z in positions:
        key = (round(x, 4), round(y, 4), round(z, 4))
        rep.append(welded.setdefault(key, len(welded)))
    parent = list(range(len(welded)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for t in range(0, len(indices), 3):
        a, b, c = (rep[indices[t + j]] for j in range(3))
        union(a, b)
        union(b, c)

    out = defaultdict(list)
    for t in range(0, len(indices), 3):
        out[find(rep[indices[t]])].append(t)
    return out


def bounds(positions, indices, tris):
    lo = [1e30] * 3
    hi = [-1e30] * 3
    for t in tris:
        for j in range(3):
            for k, v in enumerate(positions[indices[t + j]]):
                lo[k] = min(lo[k], v)
                hi[k] = max(hi[k], v)
    return lo, hi


def pad4(data, filler=b"\x00"):
    return bytes(data) + filler * (-len(data) % 4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--mesh", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    gltf, binary = read_glb(args.src)
    prim = gltf["meshes"][args.mesh]["primitives"][0]
    positions = accessor_values(gltf, binary, prim["attributes"]["POSITION"])
    indices = [v[0] for v in accessor_values(gltf, binary, prim["indices"])]

    # ── find the blades ──
    blades = []
    for tris in components(positions, indices).values():
        if not BLADE_TRIS[0] <= len(tris) <= BLADE_TRIS[1]:
            continue
        lo, hi = bounds(positions, indices, tris)
        span = [hi[k] - lo[k] for k in range(3)]
        flat = max(span[0], span[1]) / span[2] if span[2] > 1e-9 else 1e9
        if flat >= BLADE_MIN_FLATNESS and max(span[0], span[1]) >= BLADE_MIN_LENGTH:
            blades.append((tris, [(lo[k] + hi[k]) / 2 for k in range(3)]))

    if len(blades) != 8:
        sys.exit(f"expected 8 blades, found {len(blades)} — refusing to guess")

    # ── pair them into 4 rotors by sign of x and y ──
    rotors = defaultdict(list)
    for tris, centre in blades:
        rotors[(centre[0] > 0, centre[1] > 0)].append((tris, centre))
    if len(rotors) != 4 or any(len(v) != 2 for v in rotors.values()):
        sys.exit(f"blades did not pair into 4 rotors: "
                 f"{[len(v) for v in rotors.values()]}")

    print(f"{'rotor':<8}{'blades':>7}{'tris':>7}  hub (x, y, z)")
    print("-" * 46)
    plan = []
    for i, ((px, py), members) in enumerate(sorted(rotors.items())):
        tris = [t for m in members for t in m[0]]
        lo, hi = bounds(positions, indices, tris)
        hub = [(lo[k] + hi[k]) / 2 for k in range(3)]
        plan.append((f"Rotor_{i + 1}", tris, hub))
        print(f"Rotor_{i+1:<2}{len(members):>7}{len(tris):>7}  "
              f"({hub[0]:6.2f},{hub[1]:6.2f},{hub[2]:6.2f})")
    if args.dry_run:
        return

    # ── build one new mesh + node per rotor ──
    attrs = {k: v for k, v in prim["attributes"].items()}
    source = {name: accessor_values(gltf, binary, idx) for name, idx in attrs.items()}
    removed = set()
    new_nodes = []

    for name, tris, hub in plan:
        removed.update(tris)
        remap, verts = {}, []
        local_idx = []
        for t in tris:
            for j in range(3):
                vi = indices[t + j]
                if vi not in remap:
                    remap[vi] = len(verts)
                    verts.append(vi)
                local_idx.append(remap[vi])

        new_attrs = {}
        for attr, values in source.items():
            acc = gltf["accessors"][attrs[attr]]
            n = COUNT[acc["type"]]
            fmt, size = COMPONENT[acc["componentType"]]
            raw = bytearray()
            lo = [1e30] * n
            hi = [-1e30] * n
            for vi in verts:
                v = list(values[vi])
                # Re-centre positions on the hub so the node rotates the
                # blades about their own axis, not the airframe origin.
                if attr == "POSITION":
                    v = [v[k] - hub[k] for k in range(3)]
                for k in range(n):
                    lo[k] = min(lo[k], v[k])
                    hi[k] = max(hi[k], v[k])
                raw += struct.pack("<" + fmt * n, *v)
            gltf["bufferViews"].append({
                "buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
            binary += raw
            binary += b"\x00" * (-len(binary) % 4)
            acc_new = {"bufferView": len(gltf["bufferViews"]) - 1,
                       "componentType": acc["componentType"],
                       "count": len(verts), "type": acc["type"]}
            if attr == "POSITION":
                acc_new["min"] = [float(x) for x in lo]
                acc_new["max"] = [float(x) for x in hi]
            gltf["accessors"].append(acc_new)
            new_attrs[attr] = len(gltf["accessors"]) - 1

        raw = b"".join(struct.pack("<I", i) for i in local_idx)
        gltf["bufferViews"].append({
            "buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
        binary += raw
        binary += b"\x00" * (-len(binary) % 4)
        gltf["accessors"].append({
            "bufferView": len(gltf["bufferViews"]) - 1, "componentType": 5125,
            "count": len(local_idx), "type": "SCALAR"})
        gltf["meshes"].append({"name": name, "primitives": [{
            "attributes": new_attrs, "indices": len(gltf["accessors"]) - 1,
            "material": prim.get("material", 0)}]})
        gltf["nodes"].append({
            "name": name, "mesh": len(gltf["meshes"]) - 1,
            "translation": [float(x) for x in hub]})
        new_nodes.append(len(gltf["nodes"]) - 1)

    # ── drop the blade triangles from the airframe ──
    kept = [indices[t + j] for t in range(0, len(indices), 3)
            if t not in removed for j in range(3)]
    raw = b"".join(struct.pack("<I", i) for i in kept)
    gltf["bufferViews"].append({
        "buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
    binary += raw
    binary += b"\x00" * (-len(binary) % 4)
    gltf["accessors"].append({
        "bufferView": len(gltf["bufferViews"]) - 1, "componentType": 5125,
        "count": len(kept), "type": "SCALAR"})
    prim["indices"] = len(gltf["accessors"]) - 1

    # ── parent the rotors to whatever owns the airframe mesh ──
    owner = next(i for i, n in enumerate(gltf["nodes"])
                 if n.get("mesh") == args.mesh)
    parent = next((i for i, n in enumerate(gltf["nodes"])
                   if owner in n.get("children", [])), None)
    if parent is None:
        sys.exit("could not find the airframe node's parent")
    gltf["nodes"][parent].setdefault("children", []).extend(new_nodes)

    gltf["buffers"][0]["byteLength"] = len(binary)
    json_chunk = pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    bin_chunk = pad4(binary)
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    with open(args.dst, "wb") as fh:
        fh.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
        fh.write(struct.pack("<I4s", len(json_chunk), JSON_CHUNK))
        fh.write(json_chunk)
        fh.write(struct.pack("<I4s", len(bin_chunk), BIN_CHUNK))
        fh.write(bin_chunk)

    print(f"\n  airframe {len(indices)//3} -> {len(kept)//3} triangles "
          f"({(len(indices)-len(kept))//3} moved into 4 rotor nodes)")
    print(f"  wrote {args.dst}")


if __name__ == "__main__":
    main()
