#!/usr/bin/env python3
"""Add a door gunner and a pintle-mounted machine gun to a helicopter GLB.

Why build one instead of sourcing one
-------------------------------------
The Seahawk's cabin door is modelled open with nobody in it, and the
tracer fire leaves from the middle of the airframe. A gunner in that
doorway is the single thing that makes the aircraft read as armed.

Sourcing a figure means another licence to check and another file to
shrink. Geometry we generate ourselves has no licence question at all,
and at the scale this draws on a map — a few hundred pixels at closest
zoom, and this model only renders inside 6 km — a clean low-poly
silhouette reads better than a detailed mesh would.

What it builds
--------------
A seated gunner, boxes only, and a 12.7 mm door gun on a pintle:

    helmet, head, torso leaning into the gun
    two arms forward onto the grips
    thighs and shins, seated
    gun: receiver, barrel, pintle post, ammunition can

All of it is one new mesh under one new node, so it inherits the
airframe's position, heading and bank for free, exactly as the rotors
do. Nothing in the existing geometry is touched.

The armament is sourced: Danish MH-60Rs are reported with a 12.7 mm
GAU-21 door gun, per DR's 2016 handover fact box citing FMI. See
src/armament.js.

Usage
-----
  python3 scripts/add_door_gunner.py in.glb out.glb
  python3 scripts/add_door_gunner.py in.glb out.glb --x -140 --y -90 --z 150
  python3 scripts/add_door_gunner.py in.glb out.glb --side right --dry-run

Position is in the model's own units (this file is roughly 111 units per
metre). Defaults put the gunner in the left cabin doorway.
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
    return gltf, bytearray(binary)


def pad4(data, filler=b"\x00"):
    return bytes(data) + filler * (-len(data) % 4)


# ── geometry ────────────────────────────────────────────────────────
# Every part is a box. 24 vertices each, 4 per face, so each face can
# carry its own normal and the silhouette stays crisp instead of
# smearing across shared corners.

FACES = [
    ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
    ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
    ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]),
    ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)]),
    ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]),
    ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
]


def box(parts, centre, size, tilt=0.0):
    """Append one box. `tilt` leans it forward about the X axis, in radians."""
    import math
    cx, cy, cz = centre
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    ct, st = math.cos(tilt), math.sin(tilt)
    for normal, corners in FACES:
        base = len(parts["pos"])
        for sx, sy, sz in corners:
            x, y, z = sx * hx, sy * hy, sz * hz
            # lean about X: y/z rotate together
            ry, rz = y * ct - z * st, y * st + z * ct
            parts["pos"].append((cx + x, cy + ry, cz + rz))
            ny, nz = normal[1] * ct - normal[2] * st, normal[1] * st + normal[2] * ct
            parts["nrm"].append((normal[0], ny, nz))
        parts["idx"].extend([base, base + 1, base + 2, base, base + 2, base + 3])


def build_pilots():
    """Two seated aircrew in the cockpit, facing forward (-Y is the nose)."""
    p = {"pos": [], "nrm": [], "idx": []}
    for sx in (-1, 1):
        x = sx * 46
        box(p, (x, 0, 50), (24, 22, 24), 0.12)       # head
        box(p, (x, -2, 61), (28, 27, 9))             # helmet
        box(p, (x, 4, 22), (32, 22, 42), 0.12)       # torso
        box(p, (x + sx * 13, -14, 26), (9, 30, 10), 0.9)   # arm to the cyclic
        box(p, (x - sx * 11, -12, 26), (9, 28, 10), 0.8)   # arm to the collective
        box(p, (x, -22, 0), (24, 36, 13))            # thighs
        box(p, (x, -38, -18), (22, 12, 30))          # shins
    return p


def build_gunner(side_sign):
    """Gunner + gun, built around the origin. +X is outboard on this side."""
    p = {"pos": [], "nrm": [], "idx": []}
    s = side_sign          # flips the whole rig for the other door
    LEAN = 0.26            # leaning into the weapon

    # ── crew ──
    box(p, (0, -4, 58), (26, 24, 26), LEAN)          # head
    box(p, (0, -6, 70), (30, 30, 10))                # helmet
    box(p, (0, 0, 28), (34, 24, 46), LEAN)           # torso
    box(p, (s * 17, -10, 34), (10, 38, 11), 0.55)    # outboard arm, onto the grip
    box(p, (-s * 15, -8, 34), (10, 34, 11), 0.45)    # inboard arm
    box(p, (s * 9, -26, 4), (13, 40, 14))            # thigh
    box(p, (-s * 9, -26, 4), (13, 40, 14))           # thigh
    box(p, (s * 9, -44, -16), (12, 12, 34))          # shin
    box(p, (-s * 9, -44, -16), (12, 12, 34))         # shin

    # ── 12.7 mm door gun on a pintle ──
    box(p, (s * 20, -34, 40), (12, 46, 12))          # receiver
    box(p, (s * 20, -74, 42), (7, 54, 7))            # barrel, forward
    box(p, (s * 20, -12, 24), (8, 10, 40))           # pintle post
    box(p, (s * 20, -6, 46), (6, 20, 6))             # spade grips
    box(p, (s * 31, -30, 34), (14, 22, 20))          # ammunition can
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--side", choices=["left", "right"], default="left")
    ap.add_argument("--x", type=float, default=None, help="outboard offset, model units")
    ap.add_argument("--y", type=float, default=-90.0, help="along the fuselage; -Y is nose")
    ap.add_argument("--z", type=float, default=150.0, help="height")
    ap.add_argument("--pilots", action="store_true", help="also add two cockpit aircrew")
    ap.add_argument("--pilot-y", type=float, default=-395.0)
    ap.add_argument("--pilot-z", type=float, default=185.0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    gltf, binary = read_glb(args.src)
    sign = -1.0 if args.side == "left" else 1.0
    x = args.x if args.x is not None else sign * 140.0

    parts = build_gunner(sign)
    n = len(parts["pos"])
    tris = len(parts["idx"]) // 3
    lo = [min(v[k] for v in parts["pos"]) for k in range(3)]
    hi = [max(v[k] for v in parts["pos"]) for k in range(3)]
    print(f"  gunner + gun: {tris} triangles, {n} vertices")
    print(f"  extent {hi[0]-lo[0]:.0f} x {hi[1]-lo[1]:.0f} x {hi[2]-lo[2]:.0f} units"
          f"  (~{(hi[2]-lo[2])/111:.2f} m tall at this model's scale)")
    print(f"  placed at ({x:.0f}, {args.y:.0f}, {args.z:.0f}), {args.side} door")
    if args.dry_run:
        return

    def put(raw):
        gltf["bufferViews"].append(
            {"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
        binary.extend(raw)
        binary.extend(b"\x00" * (-len(binary) % 4))
        return len(gltf["bufferViews"]) - 1

    pos_raw = b"".join(struct.pack("<fff", *v) for v in parts["pos"])
    nrm_raw = b"".join(struct.pack("<fff", *v) for v in parts["nrm"])
    idx_raw = b"".join(struct.pack("<I", i) for i in parts["idx"])

    gltf["accessors"].append({"bufferView": put(pos_raw), "componentType": 5126,
                              "count": n, "type": "VEC3", "min": lo, "max": hi})
    a_pos = len(gltf["accessors"]) - 1
    gltf["accessors"].append({"bufferView": put(nrm_raw), "componentType": 5126,
                              "count": n, "type": "VEC3"})
    a_nrm = len(gltf["accessors"]) - 1
    gltf["accessors"].append({"bufferView": put(idx_raw), "componentType": 5125,
                              "count": len(parts["idx"]), "type": "SCALAR"})
    a_idx = len(gltf["accessors"]) - 1

    # Untextured dark material. No TEXCOORD on this primitive, which is
    # valid glTF as long as the material samples no texture.
    gltf.setdefault("materials", []).append({
        "name": "DoorGunner",
        # Deliberately LIGHTER than the airframe. The first attempt used
        # [0.17, 0.18, 0.16], which is almost exactly the Seahawk's own
        # dark olive: the gunner rendered correctly and was completely
        # invisible, a dark figure on a dark aircraft in a shadowed
        # doorway. Everything validated and nothing could be seen.
        # A flight suit and helmet are a different shade from an airframe
        # anyway, so this is both more visible and more truthful.
        "pbrMetallicRoughness": {
            "baseColorFactor": [0.66, 0.60, 0.47, 1.0],
            "metallicFactor": 0.05, "roughnessFactor": 0.9,
        },
        "doubleSided": True,
    })
    mat = len(gltf["materials"]) - 1

    gltf["meshes"].append({"name": "Door_Gunner", "primitives": [
        {"attributes": {"POSITION": a_pos, "NORMAL": a_nrm},
         "indices": a_idx, "material": mat}]})
    gltf["nodes"].append({"name": "Door_Gunner",
                          "mesh": len(gltf["meshes"]) - 1,
                          "translation": [x, args.y, args.z]})
    new_node = len(gltf["nodes"]) - 1

    # Parent alongside the airframe so it inherits position, heading and
    # bank exactly as the rotor nodes do.
    owner = next(i for i, nd in enumerate(gltf["nodes"]) if nd.get("mesh") == 0)
    parent = next((i for i, nd in enumerate(gltf["nodes"])
                   if owner in nd.get("children", [])), None)
    if parent is None:
        sys.exit("could not find the airframe node's parent")
    gltf["nodes"][parent].setdefault("children", []).append(new_node)

    if args.pilots:
        pp = build_pilots()
        pn = len(pp["pos"])
        plo = [min(v[k] for v in pp["pos"]) for k in range(3)]
        phi = [max(v[k] for v in pp["pos"]) for k in range(3)]
        praw = b"".join(struct.pack("<fff", *v) for v in pp["pos"])
        nraw = b"".join(struct.pack("<fff", *v) for v in pp["nrm"])
        iraw = b"".join(struct.pack("<I", i) for i in pp["idx"])
        gltf["accessors"].append({"bufferView": put(praw), "componentType": 5126,
                                  "count": pn, "type": "VEC3", "min": plo, "max": phi})
        ap_ = len(gltf["accessors"]) - 1
        gltf["accessors"].append({"bufferView": put(nraw), "componentType": 5126,
                                  "count": pn, "type": "VEC3"})
        an_ = len(gltf["accessors"]) - 1
        gltf["accessors"].append({"bufferView": put(iraw), "componentType": 5125,
                                  "count": len(pp["idx"]), "type": "SCALAR"})
        ai_ = len(gltf["accessors"]) - 1
        gltf["meshes"].append({"name": "Cockpit_Crew", "primitives": [
            {"attributes": {"POSITION": ap_, "NORMAL": an_},
             "indices": ai_, "material": mat}]})
        gltf["nodes"].append({"name": "Cockpit_Crew",
                              "mesh": len(gltf["meshes"]) - 1,
                              "translation": [0.0, args.pilot_y, args.pilot_z]})
        gltf["nodes"][parent].setdefault("children", []).append(len(gltf["nodes"]) - 1)
        print(f"  cockpit crew: {len(pp['idx'])//3} triangles, 2 aircrew at "
              f"(0, {args.pilot_y:.0f}, {args.pilot_z:.0f})")

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
    print(f"  wrote {args.dst}  ({total/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
