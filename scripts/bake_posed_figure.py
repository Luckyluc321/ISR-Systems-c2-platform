#!/usr/bin/env python3
"""Bake one frame of a skinned glTF figure into a static mesh.

Why bake instead of merging the rig
-----------------------------------
The soldier is a skinned model: 50 joints, 21 meshes, a skin with
inverse bind matrices, and 23 animation clips. Merging that into the
helicopter would mean carrying the whole skeleton across, keeping the
joint indices consistent with the host file, and paying skinning cost
every frame for a figure that never moves.

We want one pose, held. So this evaluates the skin once, at a chosen
time in a chosen clip, and writes the result as plain POSITION/NORMAL
triangles with the joints already applied. The output has no skin, no
joints and no animation, and merges exactly like the door gun did.

What it does
------------
  - samples every animation channel of the chosen clip at --time
  - composes each joint's global matrix down the node hierarchy
  - skinMatrix[j] = globalJoint[j] * inverseBindMatrix[j]
  - for each vertex, sums the weighted joint matrices and applies them
    to position, and the inverse-transpose to the normal
  - merges all primitives into ONE mesh with one material

Usage
-----
  python3 scripts/bake_posed_figure.py soldier.glb posed.glb --list
  python3 scripts/bake_posed_figure.py soldier.glb posed.glb \\
      --clip "crouch idle" --time 0 --scale 111 --colour 0.30,0.32,0.26
"""

import argparse
import json
import math
import struct
import sys

GLB_MAGIC, JSON_CHUNK, BIN_CHUNK = b"glTF", b"JSON", b"BIN\x00"
COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


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


def accessor(gltf, binary, index):
    acc = gltf["accessors"][index]
    fmt, size = COMPONENT[acc["componentType"]]
    n = COUNT[acc["type"]]
    if "bufferView" not in acc:
        return [tuple([0] * n)] * acc["count"]
    view = gltf["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or size * n
    out = [struct.unpack_from("<" + fmt * n, binary, base + i * stride)
           for i in range(acc["count"])]
    # Normalised integer attributes (weights are often unsigned bytes).
    if acc.get("normalized"):
        denom = {5121: 255.0, 5123: 65535.0, 5120: 127.0, 5122: 32767.0}[acc["componentType"]]
        out = [tuple(v / denom for v in t) for t in out]
    return out


# ── 4x4 matrices, row-major lists of 4 lists ────────────────────────
IDENT = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def from_column_major(m):
    return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]],
            [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]]


def from_trs(t, r, s):
    x, y, z, w = r
    rot = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return [[rot[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def apply_point(m, p):
    return tuple(sum(m[i][j] * p[j] for j in range(3)) + m[i][3] for i in range(3))


def apply_vector(m, v):
    return tuple(sum(m[i][j] * v[j] for j in range(3)) for i in range(3))


def slerp(a, b, t):
    d = sum(a[i] * b[i] for i in range(4))
    if d < 0:
        b = [-v for v in b]
        d = -d
    if d > 0.9995:
        out = [a[i] + (b[i] - a[i]) * t for i in range(4)]
    else:
        th = math.acos(max(-1.0, min(1.0, d)))
        s = math.sin(th)
        wa, wb = math.sin((1 - t) * th) / s, math.sin(t * th) / s
        out = [a[i] * wa + b[i] * wb for i in range(4)]
    n = math.sqrt(sum(v * v for v in out)) or 1.0
    return [v / n for v in out]


def sample(times, values, t, is_quat):
    """Linear (or spherical) sample of one animation channel at time t."""
    if t <= times[0]:
        return list(values[0])
    if t >= times[-1]:
        return list(values[-1])
    for i in range(len(times) - 1):
        if times[i] <= t <= times[i + 1]:
            span = times[i + 1] - times[i]
            f = 0.0 if span <= 0 else (t - times[i]) / span
            a, b = list(values[i]), list(values[i + 1])
            if is_quat:
                return slerp(a, b, f)
            return [a[k] + (b[k] - a[k]) * f for k in range(len(a))]
    return list(values[-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--clip", default=None, help="animation name to pose from")
    ap.add_argument("--time", type=float, default=0.0)
    ap.add_argument("--scale", type=float, default=1.0,
                    help="uniform scale applied to the baked result")
    ap.add_argument("--colour", default="0.30,0.32,0.26",
                    help="r,g,b base colour for the single output material")
    ap.add_argument("--rot-x", type=float, default=0.0, help="degrees about X, applied first")
    ap.add_argument("--rot-y", type=float, default=0.0, help="degrees about Y, applied second")
    ap.add_argument("--rot-z", type=float, default=0.0, help="degrees about Z, applied last")
    ap.add_argument("--list", action="store_true", help="list clips and exit")
    args = ap.parse_args()

    gltf, binary = read_glb(args.src)
    clips = gltf.get("animations", [])
    if args.list:
        for i, a in enumerate(clips):
            print(f"  [{i:2d}] {a.get('name', '<unnamed>')}")
        return
    if not gltf.get("skins"):
        sys.exit("no skin in this file; nothing to bake")

    clip = None
    if args.clip:
        clip = next((a for a in clips if a.get("name") == args.clip), None)
        if clip is None:
            sys.exit(f"no clip named {args.clip!r}. Use --list.")

    # ── pose every node, from the clip where it has channels ──
    nodes = gltf["nodes"]
    posed = {}
    for i, n in enumerate(nodes):
        posed[i] = {"t": list(n.get("translation", [0, 0, 0])),
                    "r": list(n.get("rotation", [0, 0, 0, 1])),
                    "s": list(n.get("scale", [1, 1, 1])),
                    "m": from_column_major(n["matrix"]) if "matrix" in n else None}
    if clip:
        for ch in clip["channels"]:
            node = ch["target"].get("node")
            path = ch["target"].get("path")
            if node is None or path == "weights":
                continue
            smp = clip["samplers"][ch["sampler"]]
            times = [v[0] for v in accessor(gltf, binary, smp["input"])]
            vals = accessor(gltf, binary, smp["output"])
            if smp.get("interpolation") == "CUBICSPLINE":
                vals = vals[1::3]          # keep the value, drop the tangents
            posed[node][{"translation": "t", "rotation": "r", "scale": "s"}[path]] = \
                sample(times, vals, args.time, path == "rotation")
            posed[node]["m"] = None        # TRS now wins over any baked matrix

    # ── global matrix per node ──
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    cache = {}

    def global_of(i):
        if i in cache:
            return cache[i]
        p = posed[i]
        local = p["m"] if p["m"] else from_trs(p["t"], p["r"], p["s"])
        m = local if i not in parent else mat_mul(global_of(parent[i]), local)
        cache[i] = m
        return m

    skin = gltf["skins"][0]
    joints = skin["joints"]
    ibm = accessor(gltf, binary, skin["inverseBindMatrices"])
    skin_mats = [mat_mul(global_of(j), from_column_major(list(ibm[k])))
                 for k, j in enumerate(joints)]

    # ── skin every vertex ──
    out_pos, out_nrm, out_idx = [], [], []
    for node in nodes:
        mi = node.get("mesh")
        if mi is None:
            continue
        for prim in gltf["meshes"][mi]["primitives"]:
            at = prim["attributes"]
            pos = accessor(gltf, binary, at["POSITION"])
            nrm = accessor(gltf, binary, at["NORMAL"]) if "NORMAL" in at else [(0, 1, 0)] * len(pos)
            jts = accessor(gltf, binary, at["JOINTS_0"])
            wts = accessor(gltf, binary, at["WEIGHTS_0"])
            idx = [v[0] for v in accessor(gltf, binary, prim["indices"])]
            base = len(out_pos)
            for vi, p in enumerate(pos):
                acc_p = [0.0, 0.0, 0.0]
                acc_n = [0.0, 0.0, 0.0]
                total_w = sum(wts[vi]) or 1.0
                for k in range(4):
                    w = wts[vi][k] / total_w
                    if w <= 0:
                        continue
                    m = skin_mats[int(jts[vi][k])]
                    tp = apply_point(m, p)
                    tn = apply_vector(m, nrm[vi])
                    for c in range(3):
                        acc_p[c] += tp[c] * w
                        acc_n[c] += tn[c] * w
                ln = math.sqrt(sum(v * v for v in acc_n)) or 1.0
                out_pos.append(tuple(v * args.scale for v in acc_p))
                out_nrm.append(tuple(v / ln for v in acc_n))
            out_idx.extend(base + i for i in idx)

    # Orient into the host model's axes. Figures are authored Y-up and
    # facing +Z; a host may be Z-up and want them facing anywhere. X then
    # Y then Z, so the order is predictable rather than whatever felt
    # right on the day.
    if args.rot_x or args.rot_y or args.rot_z:
        def rot(axis, deg):
            c, s_ = math.cos(math.radians(deg)), math.sin(math.radians(deg))
            if axis == "x": return [[1,0,0,0],[0,c,-s_,0],[0,s_,c,0],[0,0,0,1]]
            if axis == "y": return [[c,0,s_,0],[0,1,0,0],[-s_,0,c,0],[0,0,0,1]]
            return [[c,-s_,0,0],[s_,c,0,0],[0,0,1,0],[0,0,0,1]]
        m = IDENT
        for axis, deg in (("x", args.rot_x), ("y", args.rot_y), ("z", args.rot_z)):
            if deg:
                m = mat_mul(rot(axis, deg), m)
        out_pos = [apply_point(m, v) for v in out_pos]
        out_nrm = [apply_vector(m, v) for v in out_nrm]

    lo = [min(v[k] for v in out_pos) for k in range(3)]
    hi = [max(v[k] for v in out_pos) for k in range(3)]
    print(f"  baked {len(out_idx)//3} triangles, {len(out_pos)} vertices")
    print(f"  clip {args.clip!r} at t={args.time}s")
    print(f"  extent {hi[0]-lo[0]:.1f} x {hi[1]-lo[1]:.1f} x {hi[2]-lo[2]:.1f} (after scale {args.scale})")
    print(f"  bounds X {lo[0]:.1f}..{hi[0]:.1f}  Y {lo[1]:.1f}..{hi[1]:.1f}  Z {lo[2]:.1f}..{hi[2]:.1f}")

    # ── write a minimal static GLB ──
    bin_out = bytearray()

    def put(raw):
        off = len(bin_out)
        bin_out.extend(raw)
        bin_out.extend(b"\x00" * (-len(bin_out) % 4))
        return off, len(raw)

    po, pl = put(b"".join(struct.pack("<fff", *v) for v in out_pos))
    no, nl = put(b"".join(struct.pack("<fff", *v) for v in out_nrm))
    io, il = put(b"".join(struct.pack("<I", i) for i in out_idx))
    r, g_, b = (float(v) for v in args.colour.split(","))
    doc = {
        "asset": {"version": "2.0", "generator": "bake_posed_figure.py",
                  "extras": dict(gltf.get("asset", {}).get("extras", {}),
                                 baked_from=args.clip, baked_at=args.time)},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "PosedFigure", "mesh": 0}],
        "meshes": [{"name": "PosedFigure", "primitives": [
            {"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
        "materials": [{"name": "Figure", "doubleSided": True, "pbrMetallicRoughness": {
            "baseColorFactor": [r, g_, b, 1.0],
            "metallicFactor": 0.0, "roughnessFactor": 0.95}}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(out_pos),
             "type": "VEC3", "min": lo, "max": hi},
            {"bufferView": 1, "componentType": 5126, "count": len(out_nrm), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5125, "count": len(out_idx), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": po, "byteLength": pl},
            {"buffer": 0, "byteOffset": no, "byteLength": nl},
            {"buffer": 0, "byteOffset": io, "byteLength": il},
        ],
        "buffers": [{"byteLength": len(bin_out)}],
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_out)
    with open(args.dst, "wb") as fh:
        fh.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
        fh.write(struct.pack("<I4s", len(js), JSON_CHUNK))
        fh.write(js)
        fh.write(struct.pack("<I4s", len(bin_out), BIN_CHUNK))
        fh.write(bytes(bin_out))
    print(f"  wrote {args.dst}  ({total/1e6:.2f} MB, no skin, no animation)")


if __name__ == "__main__":
    main()
