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

    # ── crew: deliberately NOT built ──
    #
    # There was a box-built gunner here and it looked like a robot, which
    # on a military aircraft is worse than an empty doorway. Boxes make a
    # convincing machine gun, because a machine gun IS boxes and
    # cylinders. They do not make a convincing human, and adding more of
    # them does not fix that: the problem is the primitive, not the
    # count.
    #
    # So the weapon stays, generated, and the crew figure waits for a
    # real mesh. Pass --crew-mesh once there is a CC-BY or CC0 seated
    # figure to merge, and this is where it goes.

    # ── 12.7 mm on a FLOOR-MOUNTED post ──
    #
    # Bigger than the first pass and standing on the cabin floor rather
    # than floating at window height, which is how a door gun on an H-60
    # is actually rigged: a post bolted to the floor, a pintle head on
    # top, the weapon cradled at about chest height for a kneeling
    # gunner. Z is measured from the floor, so the caller passes the
    # floor height and the post grows up from it.
    # The barrel runs along X, which is OUT OF THE DOOR. It used to run
    # along -Y, which is along the fuselage toward the nose, so the gun
    # was aimed at the back of the pilot's head. The receiver is long in
    # X for the same reason. s is the outboard direction for this side,
    # so the grips land inboard of the post where the gunner's hands are.
    # Vertical layout is set by the GUNNER, not by eye: his hands sit 98
    # units above his feet in the crouch pose, so the grips sit there and
    # the post is sized to reach. Previously the grips were at 70 and he
    # was aiming over the top of the weapon at nothing.
    GRIP_Z = 98

    box(p, (s * 4, 0, 4), (34, 34, 8))                      # floor plate
    box(p, (s * 4, 0, GRIP_Z / 2), (12, 12, GRIP_Z - 14))   # post
    box(p, (s * 4, 0, GRIP_Z - 10), (19, 18, 17))           # pintle head
    box(p, (s * -14, 0, GRIP_Z), (24, 9, 16))               # spade grips, inboard

    # Receiver in TWO blocks with a gap between them. The gap is the feed
    # and ejection opening, and leaving it empty is what makes it read as
    # a weapon rather than a tube: a solid box has no openings anywhere.
    box(p, (s * 14, 0, GRIP_Z + 1), (26, 16, 18))           # rear body
    box(p, (s * 50, 0, GRIP_Z + 1), (30, 15, 16))           # front body
    box(p, (s * 32, 0, GRIP_Z + 9), (14, 13, 4))            # top cover over the gap
    box(p, (s * 32, -9, GRIP_Z - 4), (12, 4, 7))            # ejection chute, below the gap

    box(p, (s * 82, 0, GRIP_Z + 2), (44, 9, 9))             # barrel
    box(p, (s * 92, 0, GRIP_Z + 2), (14, 13, 13))           # flash hider
    box(p, (s * 60, 0, GRIP_Z - 10), (10, 7, 14))           # bipod/front mount

    # Ammunition can, and a belt sagging from it up into the feed gap.
    # Five links on a curve rather than a straight line, because a belt
    # hangs.
    box(p, (s * 6, 30, GRIP_Z - 34), (30, 22, 30))          # ammunition can
    import math as _m
    for i in range(6):
        f = i / 5.0
        bx = s * (10 + f * 20)
        by = 22 - f * 22
        bz = (GRIP_Z - 20) + f * 20 - _m.sin(f * _m.pi) * 9   # sag
        box(p, (bx, by, bz), (7, 6, 5))                      # belt link
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
        "name": "DoorGun",
        # Deliberately LIGHTER than the airframe. The first attempt used
        # [0.17, 0.18, 0.16], which is almost exactly the Seahawk's own
        # dark olive: the gunner rendered correctly and was completely
        # invisible, a dark figure on a dark aircraft in a shadowed
        # doorway. Everything validated and nothing could be seen.
        # A flight suit and helmet are a different shade from an airframe
        # anyway, so this is both more visible and more truthful.
        "pbrMetallicRoughness": {
            "baseColorFactor": [0.14, 0.17, 0.12, 1.0],
            "metallicFactor": 0.25, "roughnessFactor": 0.75,
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
