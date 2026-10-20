#!/usr/bin/env python3
"""Give a GLB whose blades are already separate nodes the Rotor_N nodes Cesium needs.

Why
---
Cesium can only transform a NODE, and main.js spins the quadcopter's
propellers by name, Rotor_1..Rotor_4, each about its own local Z.
scripts/split_quad_rotors.py makes those nodes for a model whose blades
are connected components inside ONE merged mesh. The DJI Air 3 (polyman,
Sketchfab) is the other case: 341 meshes, every blade already its own
node, named in Chinese part numbers and buried four levels deep in a
hierarchy of hinge matrices (folding arms), under a 0.01 scale and two
Y-up/Z-up swaps. Nothing to split; the job is to re-parent.

scripts/group_nodes.py re-parents too, but it only rewrites TRANSLATIONS,
which is right for the door gunner (siblings under one plain parent) and
wrong here, where every ancestor carries a rotation. This composes the
full 4x4 chain.

What it does
------------
For each rotor: a new node Rotor_N, a pure translation to the hub (the
centre of the union bounding box of its blades), placed under the node
whose frame has the propeller disc thin in Z, so rotating about local Z
spins the disc. Each blade node moves under it with
matrix = T(hub)^-1 . P_global^-1 . B_global, so its world placement is
unchanged. Geometry, materials, textures, buffers: untouched.

Verifies by point cloud: every vertex of every mesh, transformed by its
global matrix, must be the same set before and after.

Usage
-----
  python3 scripts/group_rotor_nodes.py in.glb out.glb \\
      --parent root \\
      --rotor Object_15,Object_19 --rotor Object_55,Object_59 \\
      --rotor Object_164,Object_168 --rotor Object_194,Object_198

Rotors are numbered in the order given. Front-right, rear-right, rear-left,
front-left or whatever; main.js only needs 1 and 4 on one diagonal and 2
and 3 on the other, and the script prints each hub's position so you can
check that. The blade node names come from the flight demo's log
(scripts/blender_drone_flight_demo.py prints them).
"""

import argparse
import json
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


def write_glb(path, gltf, binary):
    def pad4(data, filler):
        return bytes(data) + filler * (-len(data) % 4)
    js = pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    bn = pad4(binary, b"\x00")
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
        fh.write(struct.pack("<I4s", len(js), JSON_CHUNK))
        fh.write(js)
        fh.write(struct.pack("<I4s", len(bn), BIN_CHUNK))
        fh.write(bn)
    return total


def accessor_values(gltf, binary, index):
    acc = gltf["accessors"][index]
    bv = gltf["bufferViews"][acc["bufferView"]]
    fmt, size = COMPONENT[acc["componentType"]]
    n = COUNT[acc["type"]]
    stride = bv.get("byteStride") or size * n
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    out = []
    for i in range(acc["count"]):
        off = base + i * stride
        out.append(struct.unpack_from("<" + fmt * n, binary, off))
    return out


# --- 4x4 maths on column-major glTF lists -----------------------------------
def identity():
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def node_matrix(n):
    if "matrix" in n:
        return list(n["matrix"])
    t = n.get("translation", [0, 0, 0])
    q = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    x, y, z, w = q
    r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]
    return [r[0] * s[0], r[1] * s[0], r[2] * s[0], 0,
            r[3] * s[1], r[4] * s[1], r[5] * s[1], 0,
            r[6] * s[2], r[7] * s[2], r[8] * s[2], 0,
            t[0], t[1], t[2], 1]


def mul(a, b):
    """a . b, column-major: (a.b)[col][row] = sum_k a[k][row] * b[col][k]."""
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            out[col * 4 + row] = sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
    return out


def inverse(m):
    # Gauss-Jordan on a 4x4, row-major working copy.
    a = [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    inv = [[float(i == j) for j in range(4)] for i in range(4)]
    for i in range(4):
        p = max(range(i, 4), key=lambda r: abs(a[r][i]))
        a[i], a[p] = a[p], a[i]
        inv[i], inv[p] = inv[p], inv[i]
        d = a[i][i]
        if abs(d) < 1e-12:
            sys.exit("singular node matrix")
        a[i] = [v / d for v in a[i]]
        inv[i] = [v / d for v in inv[i]]
        for r in range(4):
            if r != i and a[r][i]:
                f = a[r][i]
                a[r] = [v - f * w for v, w in zip(a[r], a[i])]
                inv[r] = [v - f * w for v, w in zip(inv[r], inv[i])]
    return [inv[r][c] for c in range(4) for r in range(4)]


def apply(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


G_IDENT = identity()


def translation(t):
    m = identity()
    m[12], m[13], m[14] = t
    return m


# --- scene graph ---------------------------------------------------------------
def globals_of(gltf):
    nodes = gltf["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    cache = {}

    def g(i):
        if i in cache:
            return cache[i]
        local = node_matrix(nodes[i])
        cache[i] = mul(g(parent[i]), local) if i in parent else local
        return cache[i]
    return [g(i) for i in range(len(nodes))], parent


def point_cloud(gltf, binary, gl):
    pts = set()
    for i, n in enumerate(gltf["nodes"]):
        if "mesh" not in n:
            continue
        for prim in gltf["meshes"][n["mesh"]]["primitives"]:
            for p in accessor_values(gltf, binary, prim["attributes"]["POSITION"]):
                pts.add(tuple(round(v, 4) for v in apply(gl[i], p)))
    return pts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--parent", required=True,
                    help="name of the node to put the Rotor_N nodes under. Any ancestor will "
                         "do: each hub node is oriented so its own local Z is the disc normal")
    ap.add_argument("--rotor", action="append", required=True,
                    help="comma-separated blade node names for one rotor; repeat per rotor")
    ap.add_argument("--prefix", default="Rotor_")
    args = ap.parse_args()

    gltf, binary = read_glb(args.src)
    nodes = gltf["nodes"]
    by_name = {}
    for i, n in enumerate(nodes):
        by_name.setdefault(n.get("name"), i)
    if args.parent not in by_name:
        sys.exit(f"no node named {args.parent!r}")
    P = by_name[args.parent]

    gl_before, parent = globals_of(gltf)
    before = point_cloud(gltf, binary, gl_before)
    P_inv = inverse(gl_before[P])

    def in_parent_frame(i):
        return mul(P_inv, gl_before[i])

    for k, spec in enumerate(args.rotor, 1):
        names = spec.split(",")
        idx = []
        for nm in names:
            if nm not in by_name:
                sys.exit(f"no node named {nm!r}")
            idx.append(by_name[nm])

        # Hub: centre of the union bbox of the blades, in the parent frame.
        lo = [float("inf")] * 3
        hi = [float("-inf")] * 3
        for i in idx:
            m = in_parent_frame(i)
            for prim in gltf["meshes"][nodes[i]["mesh"]]["primitives"]:
                for p in accessor_values(gltf, binary, prim["attributes"]["POSITION"]):
                    q = apply(m, p)
                    lo = [min(a, b) for a, b in zip(lo, q)]
                    hi = [max(a, b) for a, b in zip(hi, q)]
        hub = [(a + b) / 2 for a, b in zip(lo, hi)]
        ext = [b - a for a, b in zip(lo, hi)]
        thin = ext.index(min(ext))

        # The hub node's own frame has its Z on the disc normal, whatever
        # the parent's frame does. main.js spins Rotor_N about LOCAL Z, so
        # this is what makes the spin an in-plane one. For a Z-up parent
        # (the Air 3's `root`) that is a pure translation; for an asset
        # authored Y-up all the way down (the Inspire 2) it is a
        # translation and a quarter turn about X, and the blades' local
        # matrices absorb the inverse so nothing moves.
        if thin == 2:
            R = G_IDENT
        elif thin == 1:
            R = [1, 0, 0, 0,  0, 0, 1, 0,  0, -1, 0, 0,  0, 0, 0, 1]   # local Z -> parent +Y
        else:
            R = [0, 0, -1, 0,  0, 1, 0, 0,  1, 0, 0, 0,  0, 0, 0, 1]   # local Z -> parent +X
        hub_m = mul(translation(hub), R)

        # Detach the blades from wherever they were.
        for i in idx:
            old = nodes[parent[i]]
            old["children"] = [c for c in old["children"] if c != i]

        hub_inv = inverse(hub_m)
        for i in idx:
            nodes[i].pop("translation", None)
            nodes[i].pop("rotation", None)
            nodes[i].pop("scale", None)
            nodes[i]["matrix"] = mul(hub_inv, in_parent_frame(i))
        node = {"name": f"{args.prefix}{k}", "children": idx}
        if R is G_IDENT:
            node["translation"] = hub
        else:
            node["matrix"] = hub_m
        nodes.append(node)
        nodes[P].setdefault("children", []).append(len(nodes) - 1)
        print(f"  {args.prefix}{k}: {len(idx)} blade(s) {names} at "
              f"({hub[0]:+.3f}, {hub[1]:+.3f}, {hub[2]:+.3f}) in {args.parent!r}, "
              f"disc {ext[0]:.2f} x {ext[1]:.2f} x {ext[2]:.2f}, normal on parent "
              f"{'XYZ'[thin]}, hub local Z aligned to it")

    gl_after, _ = globals_of(gltf)
    after = point_cloud(gltf, binary, gl_after)
    if before != after:
        sys.exit(f"GEOMETRY MOVED: {len(before)} points before, {len(after)} after, "
                 f"{len(before - after)} lost, {len(after - before)} gained. Not written.")
    total = write_glb(args.dst, gltf, binary)
    print(f"  verified: {len(before)} distinct points before and after, none moved")
    print(f"  wrote {args.dst} ({total / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
