#!/usr/bin/env python3
"""Bake one frame of a skinned airliner into a static, textured GLB.

Why
---
The A320 carries a 28 second animation driving its gear, doors, flaps,
ailerons, air brakes and engines. None of it can play: this app pins
viewer.clock.shouldAnimate to false so the sun holds still, and Cesium
advances model animations off that clock.

Driving the joints directly through Cesium's nodeTransformations was
tried and tore the aircraft apart, because this is a SKINNED mesh: the
geometry is deformed by a 142 joint hierarchy rather than drawn beneath
it, so overriding some joints and not others pulls the skin between
joints that disagree.

An aircraft on a five minute final needs ONE configuration anyway, held:
gear down, flaps out. So evaluate the skin once, at a chosen time, and
write the result as plain triangles with the joints already applied.

How this differs from bake_posed_figure.py
------------------------------------------
That one merges every primitive into a single mesh with a single
material, which is right for a soldier in one colour and would destroy a
liveried airliner. This bakes PER PRIMITIVE and carries each one's
material, texture coordinates and tangents across, so the paint survives.

It can also split the engine fans into their own unskinned nodes, so they
remain rotatable after the rest of the airframe is frozen. That is the
point of baking rather than just picking a static model: everything holds
still except the parts that should not.

Usage
-----
  python3 scripts/bake_landing_pose.py in.glb out.glb --list
  python3 scripts/bake_landing_pose.py in.glb out.glb --time 28.17
  python3 scripts/bake_landing_pose.py in.glb out.glb --time 28.17 \\
      --split-nodes Engine.L_082,Engine.R_083
"""

import argparse
import json
import math
import struct
import sys

GLB_MAGIC, JSON_CHUNK, BIN_CHUNK = b"glTF", b"JSON", b"BIN\x00"
COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


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


def accessor(g, binary, index):
    a = g["accessors"][index]
    fmt, size = COMPONENT[a["componentType"]]
    n = NCOMP[a["type"]]
    bv = g["bufferViews"][a["bufferView"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride") or size * n
    return [struct.unpack_from("<" + fmt * n, binary, base + i * stride)
            for i in range(a["count"])]


# ── matrix helpers, column-major like glTF ──────────────────────────
def mat_mul(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
            for c in range(4) for r in range(4)]


def from_trs(t, r, s):
    x, y, z, w = r
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz, wx, wy, wz = x * y, x * z, y * z, w * x, w * y, w * z
    m = [
        (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
        (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
        (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
        t[0], t[1], t[2], 1,
    ]
    return m


def apply_point(m, p):
    return (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14])


def apply_vector(m, v):
    return (m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2])


def normalise(v):
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def slerp(a, b, t):
    d = sum(a[i] * b[i] for i in range(4))
    if d < 0:
        b = tuple(-c for c in b)
        d = -d
    if d > 0.9995:
        return normalise4(tuple(a[i] + (b[i] - a[i]) * t for i in range(4)))
    th0 = math.acos(max(-1.0, min(1.0, d)))
    th = th0 * t
    s0 = math.sin(th0 - th) / math.sin(th0)
    s1 = math.sin(th) / math.sin(th0)
    return tuple(a[i] * s0 + b[i] * s1 for i in range(4))


def normalise4(q):
    n = math.sqrt(sum(c * c for c in q)) or 1.0
    return tuple(c / n for c in q)


def sample(times, values, t, is_quat):
    if t <= times[0]:
        return values[0]
    if t >= times[-1]:
        return values[-1]
    lo, hi = 0, len(times) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if times[mid] <= t:
            lo = mid
        else:
            hi = mid
    span = times[hi] - times[lo]
    f = (t - times[lo]) / span if span else 0.0
    if is_quat:
        return slerp(values[lo], values[hi], f)
    return tuple(values[lo][k] + (values[hi][k] - values[lo][k]) * f
                 for k in range(len(values[lo])))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst", nargs="?")
    ap.add_argument("--time", type=float, default=0.0)
    ap.add_argument("--clip", default=None)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--split-nodes", default="",
                    help="comma-separated joint names whose vertices become "
                         "their own unskinned nodes, so they stay rotatable")
    ap.add_argument("--group", action="append", default=[],
                    help="NAME:SUBSTR|SUBSTR:TIME - emit a node called NAME "
                         "containing only the triangles whose dominant joint "
                         "name contains one of the substrings, baked at TIME. "
                         "Prefix the substrings with ! to invert. Repeatable, "
                         "so one file can carry the same parts at several "
                         "configurations and the renderer picks between them.")
    args = ap.parse_args()

    g, binary = read_glb(args.src)

    if args.list:
        for i, a in enumerate(g.get("animations", [])):
            ts = []
            for ch in a["channels"]:
                s = a["samplers"][ch["sampler"]]
                ts += [x[0] for x in accessor(g, binary, s["input"])]
            print(f"  [{i}] {a.get('name','<unnamed>')}  "
                  f"{len(a['channels'])} channels  {min(ts):.2f}..{max(ts):.2f} s")
        return

    if not args.dst:
        sys.exit("need an output path (or --list)")

    # ── pose every node at the chosen time ──────────────────────────
    anims = g.get("animations", [])
    anim = None
    if anims:
        anim = next((a for a in anims if a.get("name") == args.clip), anims[0])
    posed = {}
    if anim:
        for ch in anim["channels"]:
            s = anim["samplers"][ch["sampler"]]
            node, path = ch["target"]["node"], ch["target"]["path"]
            times = [x[0] for x in accessor(g, binary, s["input"])]
            vals = accessor(g, binary, s["output"])
            posed.setdefault(node, {})[path] = sample(times, vals, args.time,
                                                      path == "rotation")

    def local(i):
        n = g["nodes"][i]
        p = posed.get(i, {})
        if "matrix" in n and not p:
            return list(n["matrix"])
        t = p.get("translation", n.get("translation", (0, 0, 0)))
        r = p.get("rotation", n.get("rotation", (0, 0, 0, 1)))
        s = p.get("scale", n.get("scale", (1, 1, 1)))
        return from_trs(t, r, s)

    parent = {}
    for i, n in enumerate(g["nodes"]):
        for c in n.get("children", []):
            parent[c] = i

    gcache = {}

    def global_of(i):
        if i in gcache:
            return gcache[i]
        m = local(i)
        p = parent.get(i)
        if p is not None:
            m = mat_mul(global_of(p), m)
        gcache[i] = m
        return m

    # ── skin matrices ───────────────────────────────────────────────
    skin = g["skins"][0]
    ibm = accessor(g, binary, skin["inverseBindMatrices"])
    skin_mats = [mat_mul(global_of(j), list(ibm[k]))
                 for k, j in enumerate(skin["joints"])]
    split = [n.strip() for n in args.split_nodes.split(",") if n.strip()]
    names = [n.get("name", "") for n in g["nodes"]]
    split_joint_idx = {k for k, j in enumerate(skin["joints"])
                       if names[j] in split}

    # ── bake every primitive, keeping its material ──────────────────
    out_bin = bytearray()
    out = {
        "asset": {"version": "2.0",
                  "generator": f"bake_landing_pose.py t={args.time}"},
        "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [],
        "accessors": [], "bufferViews": [], "buffers": [],
        "materials": g.get("materials", []), "textures": g.get("textures", []),
        "images": [], "samplers": g.get("samplers", []),
    }

    def put(raw, target=None):
        while len(out_bin) % 4:
            out_bin.append(0)
        bv = {"buffer": 0, "byteOffset": len(out_bin), "byteLength": len(raw)}
        if target:
            bv["target"] = target
        out_bin.extend(raw)
        out["bufferViews"].append(bv)
        return len(out["bufferViews"]) - 1

    def add_accessor(bv, ctype, atype, count, mn=None, mx=None):
        a = {"bufferView": bv, "componentType": ctype, "count": count,
             "type": atype}
        if mn is not None:
            a["min"], a["max"] = mn, mx
        out["accessors"].append(a)
        return len(out["accessors"]) - 1

    # images ride across byte-identical
    for im in g.get("images", []):
        bv = g["bufferViews"][im["bufferView"]]
        o, l = bv.get("byteOffset", 0), bv["byteLength"]
        nbv = put(binary[o:o + l])
        out["images"].append({"bufferView": nbv,
                              "mimeType": im.get("mimeType", "image/png")})

    # --group turns one bake into several, each a node of its own, each
    # at its own time. That is what lets a single file carry an airframe
    # plus its gear both stowed and extended: the renderer scales the one
    # it does not want to zero, and the configuration changes without a
    # second model to download.
    specs = []
    for spec in args.group:
        nm, pats, tm = spec.split(":")
        inv = pats.startswith("!")
        specs.append((nm, [p.lstrip("!") for p in pats.split("|")], inv, float(tm)))
    if not specs:
        specs = [("body", [], False, args.time)]

    groups = {nm: [] for nm, _, _, _ in specs}
    for nm in split:
        groups[nm] = []

    # Each group needs the skin evaluated at ITS time, so the matrices are
    # rebuilt per time rather than once.
    def skin_at(t):
        gcache.clear()
        posed.clear()
        if anim:
            for ch in anim["channels"]:
                s2 = anim["samplers"][ch["sampler"]]
                nd2, path2 = ch["target"]["node"], ch["target"]["path"]
                times2 = [x[0] for x in accessor(g, binary, s2["input"])]
                vals2 = accessor(g, binary, s2["output"])
                posed.setdefault(nd2, {})[path2] = sample(
                    times2, vals2, t, path2 == "rotation")
        return [mat_mul(global_of(j), list(ibm[k]))
                for k, j in enumerate(skin["joints"])]

    joint_name = [names[j] for j in skin["joints"]]

    stats = {"prims": 0, "verts": 0, "tris": 0, "split": 0}
    for gname, pats, inv, gtime in specs:
        mats = skin_at(gtime)
        for ni, node in enumerate(g["nodes"]):
            if node.get("mesh") is None:
                continue
            for prim in g["meshes"][node["mesh"]]["primitives"]:
                at = prim["attributes"]
                pos = accessor(g, binary, at["POSITION"])
                nrm = accessor(g, binary, at["NORMAL"]) if "NORMAL" in at else None
                jnt = accessor(g, binary, at["JOINTS_0"]) if "JOINTS_0" in at else None
                wgt = accessor(g, binary, at["WEIGHTS_0"]) if "WEIGHTS_0" in at else None
                uv = accessor(g, binary, at["TEXCOORD_0"]) if "TEXCOORD_0" in at else None
                idx = [v[0] for v in accessor(g, binary, prim["indices"])]

                def owns(vi):
                    if not (jnt and wgt):
                        return not inv and not pats
                    best_w, best_j = -1.0, -1
                    for k in range(4):
                        if wgt[vi][k] > best_w:
                            best_w, best_j = wgt[vi][k], jnt[vi][k]
                    nm2 = joint_name[best_j] if 0 <= best_j < len(joint_name) else ""
                    hit = any(pt in nm2 for pt in pats) if pats else True
                    return (not hit) if inv else hit

                keep = [t for t in range(0, len(idx), 3)
                        if all(owns(idx[t + k]) for k in range(3))]
                if not keep:
                    continue

                used = sorted({idx[t + k] for t in keep for k in range(3)})
                remap = {v: i for i, v in enumerate(used)}
                bp, bn, buv = [], [], []
                for vi in used:
                    if jnt and wgt:
                        m = [0.0] * 16
                        for k in range(4):
                            w = wgt[vi][k]
                            if w <= 0:
                                continue
                            sm = mats[jnt[vi][k]]
                            for c in range(16):
                                m[c] += sm[c] * w
                    else:
                        m = global_of(ni)
                    bp.append(apply_point(m, pos[vi]))
                    if nrm:
                        bn.append(normalise(apply_vector(m, nrm[vi])))
                    if uv:
                        buv.append(uv[vi])
                nidx = [remap[idx[t + k]] for t in keep for k in range(3)]
                groups[gname].append((bp, bn, buv if uv else None, nidx,
                                      prim.get("material", 0)))
                stats["prims"] += 1
                stats["verts"] += len(bp)
                stats["tris"] += len(nidx) // 3

    for key, prims in groups.items():
        if not prims:
            continue
        mesh_prims = []
        for bp, bn, uv, idx, mat in prims:
            lo = [min(p[k] for p in bp) for k in range(3)]
            hi = [max(p[k] for p in bp) for k in range(3)]
            a_pos = add_accessor(
                put(b"".join(struct.pack("<fff", *p) for p in bp), 34962),
                5126, "VEC3", len(bp), [float(v) for v in lo], [float(v) for v in hi])
            attrs = {"POSITION": a_pos}
            if bn:
                attrs["NORMAL"] = add_accessor(
                    put(b"".join(struct.pack("<fff", *v) for v in bn), 34962),
                    5126, "VEC3", len(bn))
            if uv:
                attrs["TEXCOORD_0"] = add_accessor(
                    put(b"".join(struct.pack("<ff", *v) for v in uv), 34962),
                    5126, "VEC2", len(uv))
            a_idx = add_accessor(
                put(b"".join(struct.pack("<I", i) for i in idx), 34963),
                5125, "SCALAR", len(idx))
            mesh_prims.append({"attributes": attrs, "indices": a_idx,
                               "material": mat})
        out["meshes"].append({"name": key, "primitives": mesh_prims})
        out["nodes"].append({"name": key, "mesh": len(out["meshes"]) - 1})
        out["scenes"][0]["nodes"].append(len(out["nodes"]) - 1)

    out["buffers"] = [{"byteLength": len(out_bin)}]
    js = json.dumps(out, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    bn_pad = bytes(out_bin) + b"\x00" * (-len(out_bin) % 4)
    total = 12 + 8 + len(js) + 8 + len(bn_pad)
    with open(args.dst, "wb") as fh:
        fh.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
        fh.write(struct.pack("<I4s", len(js), JSON_CHUNK))
        fh.write(js)
        fh.write(struct.pack("<I4s", len(bn_pad), BIN_CHUNK))
        fh.write(bn_pad)

    print(f"  baked at t={args.time}s")
    print(f"  {stats['prims']} primitives, {stats['verts']:,} vertices, "
          f"{stats['tris']:,} triangles")
    print(f"  nodes written: {[m['name'] for m in out['meshes']]}")
    print(f"  wrote {args.dst}  ({total/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
