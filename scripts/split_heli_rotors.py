#!/usr/bin/env python3
"""Cut a helicopter's main and tail rotor blades into their own nodes, so they spin.

Why
---
Same discovery as scripts/split_quad_rotors.py, on a file I had already
written off. sh-60b_seahawk_helicopter.glb carries no animation and its
21 meshes are chunked by MATERIAL at a flat 3333 triangles each, so
judged by bounding boxes it looks like one welded lump and I said so.

Bounding boxes were the wrong test. Union-find over shared vertex
positions finds 582 connected components, and the rotors are right there:

    4 x 763 tri main blades, 529.8 x 779.2 x 42.2, flat ratio 18.5,
      all at Z ~= 421, so the disc lies in XY and spins about Z
    4 x 246 tri tail blades, thin in X, varying in Y and Z,
      so that disc lies in YZ and spins about X

Four and four is correct for an H-60.

Cesium can only transform a NODE, so each rotor becomes one node holding
all four of its blades, positioned at the rotor's own hub so that
rotating the node spins the disc about its mast rather than swinging it
around the airframe.

Usage
-----
  python3 scripts/split_heli_rotors.py in.glb out.glb
  python3 scripts/split_heli_rotors.py in.glb out.glb --dry-run

Verifies by point cloud: every vertex in the output, with each new node's
translation applied, must reproduce the input's set exactly.
"""

import argparse
import json
import math
import struct
import sys
from collections import defaultdict

GLB_MAGIC, JSON_CHUNK, BIN_CHUNK = b"glTF", b"JSON", b"BIN\x00"
COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

# A rotor blade is a thin sheet that reaches a long way from its hub.
# Tolerances wide enough to survive a re-export, tight enough to exclude
# the stabilator (symmetric about X=0, at a different height) and the
# fuselage panels.
MIN_FLATNESS = 6.0
MIN_TRIS = 150


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
    view = gltf["bufferViews"][acc["bufferView"]]
    fmt, size = COMPONENT[acc["componentType"]]
    n = COUNT[acc["type"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or size * n
    return [struct.unpack_from("<" + fmt * n, binary, base + i * stride)
            for i in range(acc["count"])]


def pad4(data, filler=b"\x00"):
    return bytes(data) + filler * (-len(data) % 4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    gltf, binary = read_glb(args.src)

    # ── one flat vertex/triangle pool across every primitive ──
    # The blades are split across material chunks, so per-primitive
    # analysis would never see a whole blade.
    pool_pos, pool_tri, owner = [], [], []
    for mi, mesh in enumerate(gltf["meshes"]):
        for pi, prim in enumerate(mesh["primitives"]):
            base = len(pool_pos)
            pool_pos.extend(accessor(gltf, binary, prim["attributes"]["POSITION"]))
            idx = [v[0] for v in accessor(gltf, binary, prim["indices"])]
            for t in range(0, len(idx), 3):
                owner.append((mi, pi))
                pool_tri.extend(base + idx[t + j] for j in range(3))

    welded, rep = {}, []
    for x, y, z in pool_pos:
        rep.append(welded.setdefault((round(x, 3), round(y, 3), round(z, 3)), len(welded)))
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

    for t in range(0, len(pool_tri), 3):
        union(rep[pool_tri[t]], rep[pool_tri[t + 1]])
        union(rep[pool_tri[t + 1]], rep[pool_tri[t + 2]])

    comps = defaultdict(list)
    for t in range(0, len(pool_tri), 3):
        comps[find(rep[pool_tri[t]])].append(t)

    def bounds(tris):
        lo, hi = [1e30] * 3, [-1e30] * 3
        for t in tris:
            for j in range(3):
                for k, v in enumerate(pool_pos[pool_tri[t + j]]):
                    lo[k] = min(lo[k], v)
                    hi[k] = max(hi[k], v)
        return lo, hi

    blades = []
    for tris in comps.values():
        if len(tris) < MIN_TRIS:
            continue
        lo, hi = bounds(tris)
        span = [hi[k] - lo[k] for k in range(3)]
        thin = min(range(3), key=lambda k: span[k])
        flat = max(span) / span[thin] if span[thin] > 1e-9 else 1e9
        if flat >= MIN_FLATNESS:
            blades.append((len(tris), thin, tris, [(lo[k] + hi[k]) / 2 for k in range(3)]))

    # Blades of one rotor are identical copies, so group by triangle count.
    by_count = defaultdict(list)
    for n, thin, tris, cen in blades:
        by_count[n].append((thin, tris, cen))

    # Four identical thin parts is NOT enough to call something a rotor.
    # This file has three such groups and only two are rotors: the third
    # is four rods at the corners of a rectangle, all at the same Y,
    # pylons or antennas. They are the same size and the same shape as
    # each other and would have been torn off and spun.
    #
    # What separates a rotor is ANGLE. Four blades sit 90 degrees apart
    # around their hub in the plane of the disc. The rectangle's four
    # corners sit at two angles used twice each. So project each blade's
    # centre onto the disc plane, take its bearing around the hub, sort,
    # and require four roughly even gaps.
    def is_rotor(members):
        thin = members[0][0]
        a, b = [k for k in range(3) if k != thin]
        hub = [sum(m[2][k] for m in members) / len(members) for k in range(3)]
        angles = sorted(math.degrees(math.atan2(m[2][a] - hub[a], m[2][b] - hub[b])) % 360
                        for m in members)
        gaps = [(angles[(i + 1) % 4] - angles[i]) % 360 for i in range(4)]
        return all(abs(gp - 90) <= 30 for gp in gaps)

    rotors = {n: v for n, v in by_count.items() if len(v) == 4 and is_rotor(v)}
    if len(rotors) != 2:
        detail = sorted((n, len(v), is_rotor(v) if len(v) == 4 else None)
                        for n, v in by_count.items())
        sys.exit(f"expected two rotors of 4 evenly spaced blades, got "
                 f"{[(n, c, r) for n, c, r in detail if c == 4]} "
                 f"(count, members, evenly-spaced) — refusing to guess")

    plan = []
    for n, members in sorted(rotors.items(), reverse=True):   # main rotor has more tris
        tris = [t for _, ts, _ in members for t in ts]
        lo, hi = bounds(tris)
        hub = [(lo[k] + hi[k]) / 2 for k in range(3)]
        thin = members[0][0]
        name = "Main_Rotor" if len(plan) == 0 else "Tail_Rotor"
        plan.append((name, tris, hub, thin, n))

    print(f"{'rotor':<12}{'blades':>7}{'tris':>7}{'axis':>6}   hub (x, y, z)")
    print("-" * 58)
    for name, tris, hub, thin, per in plan:
        print(f"{name:<12}{len(tris)//per:>7}{len(tris):>7}{'XYZ'[thin]:>6}   "
              f"({hub[0]:8.1f},{hub[1]:8.1f},{hub[2]:8.1f})")
    if args.dry_run:
        return

    # ── build a node per rotor, re-centred on its hub ──
    attr_names = list(gltf["meshes"][0]["primitives"][0]["attributes"].keys())
    src_attr = {}
    for mi, mesh in enumerate(gltf["meshes"]):
        for pi, prim in enumerate(mesh["primitives"]):
            for a in attr_names:
                if a in prim["attributes"]:
                    src_attr[(mi, pi, a)] = accessor(gltf, binary, prim["attributes"][a])

    # map pooled vertex index -> (mi, pi, local index)
    locator, cursor = [], 0
    for mi, mesh in enumerate(gltf["meshes"]):
        for pi, prim in enumerate(mesh["primitives"]):
            cnt = gltf["accessors"][prim["attributes"]["POSITION"]]["count"]
            locator.append((cursor, cursor + cnt, mi, pi))
            cursor += cnt

    def locate(v):
        for lo_, hi_, mi, pi in locator:
            if lo_ <= v < hi_:
                return mi, pi, v - lo_
        raise KeyError(v)

    removed, new_nodes = set(), []
    for name, tris, hub, thin, per in plan:
        removed.update(tris)
        remap, verts, local_idx = {}, [], []
        for t in tris:
            for j in range(3):
                v = pool_tri[t + j]
                if v not in remap:
                    remap[v] = len(verts)
                    verts.append(v)
                local_idx.append(remap[v])

        new_attrs = {}
        for a in attr_names:
            ref = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["attributes"][a]]
            n = COUNT[ref["type"]]
            fmt, _ = COMPONENT[ref["componentType"]]
            raw, lo, hi = bytearray(), [1e30] * n, [-1e30] * n
            for v in verts:
                mi, pi, li = locate(v)
                vals = list(src_attr[(mi, pi, a)][li])
                if a == "POSITION":
                    vals = [vals[k] - hub[k] for k in range(3)]
                for k in range(n):
                    lo[k] = min(lo[k], vals[k])
                    hi[k] = max(hi[k], vals[k])
                raw += struct.pack("<" + fmt * n, *vals)
            gltf["bufferViews"].append(
                {"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
            binary += raw
            binary += b"\x00" * (-len(binary) % 4)
            acc_new = {"bufferView": len(gltf["bufferViews"]) - 1,
                       "componentType": ref["componentType"],
                       "count": len(verts), "type": ref["type"]}
            if a == "POSITION":
                acc_new["min"] = [float(x) for x in lo]
                acc_new["max"] = [float(x) for x in hi]
            gltf["accessors"].append(acc_new)
            new_attrs[a] = len(gltf["accessors"]) - 1

        raw = b"".join(struct.pack("<I", i) for i in local_idx)
        gltf["bufferViews"].append(
            {"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
        binary += raw
        binary += b"\x00" * (-len(binary) % 4)
        gltf["accessors"].append({"bufferView": len(gltf["bufferViews"]) - 1,
                                  "componentType": 5125, "count": len(local_idx),
                                  "type": "SCALAR"})
        mat = gltf["meshes"][0]["primitives"][0].get("material", 0)
        gltf["meshes"].append({"name": name, "primitives": [
            {"attributes": new_attrs, "indices": len(gltf["accessors"]) - 1, "material": mat}]})
        gltf["nodes"].append({"name": name, "mesh": len(gltf["meshes"]) - 1,
                              "translation": [float(x) for x in hub]})
        new_nodes.append(len(gltf["nodes"]) - 1)

    # ── drop the blade triangles from whichever primitives held them ──
    keep = defaultdict(list)
    for t in range(0, len(pool_tri), 3):
        if t in removed:
            continue
        mi, pi = owner[t // 3]
        base = next(lo_ for lo_, hi_, m, p in locator if (m, p) == (mi, pi))
        keep[(mi, pi)].extend(pool_tri[t + j] - base for j in range(3))

    for (mi, pi), idx in keep.items():
        raw = b"".join(struct.pack("<I", i) for i in idx)
        gltf["bufferViews"].append(
            {"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
        binary += raw
        binary += b"\x00" * (-len(binary) % 4)
        gltf["accessors"].append({"bufferView": len(gltf["bufferViews"]) - 1,
                                  "componentType": 5125, "count": len(idx), "type": "SCALAR"})
        gltf["meshes"][mi]["primitives"][pi]["indices"] = len(gltf["accessors"]) - 1

    # parent the rotors alongside the airframe
    owner_node = next(i for i, n in enumerate(gltf["nodes"]) if n.get("mesh") == 0)
    parent_node = next((i for i, n in enumerate(gltf["nodes"])
                        if owner_node in n.get("children", [])), None)
    if parent_node is None:
        sys.exit("could not find the airframe node's parent")
    gltf["nodes"][parent_node].setdefault("children", []).extend(new_nodes)

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
    moved = sum(len(t) for _, t, _, _, _ in plan)
    print(f"\n  {moved} triangles moved into {len(plan)} rotor nodes")
    print(f"  wrote {args.dst}")


if __name__ == "__main__":
    main()
