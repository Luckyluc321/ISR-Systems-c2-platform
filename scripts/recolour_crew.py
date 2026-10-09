#!/usr/bin/env python3
"""Repaint the door gunner's uniform and his gun, in place.

Both are solid-colour materials added by add_door_gunner.py, so this is
a JSON edit: no geometry, no textures, no accessors touched. The binary
chunk is copied through byte for byte.
"""
import json, struct, sys

src, dst = sys.argv[1], sys.argv[2]

# Uniform: Danish flight-crew olive drab. Was 0.30/0.32/0.26, a pale
# grey-olive that read as civilian workwear against the airframe.
UNIFORM = [0.165, 0.190, 0.110, 1.0]

# Gun: near-black with a green cast, the way a parkerised 12.7 mm looks.
# Was 0.14/0.17/0.12 at metallic 0.25, and that quarter-metallic was
# what made it catch the sun and read as shiny plastic. Barely metallic
# and very rough is what a matte military finish actually is.
GUN        = [0.050, 0.058, 0.045, 1.0]
GUN_METAL  = 0.06
GUN_ROUGH  = 0.93

blob = open(src, "rb").read()
total = struct.unpack("<I", blob[8:12])[0]
off, gltf, binary = 12, None, b""
while off < total:
    ln, kind = struct.unpack("<I4s", blob[off:off + 8])
    payload = blob[off + 8:off + 8 + ln]
    if kind == b"JSON": gltf = json.loads(payload)
    elif kind == b"BIN\x00": binary = payload
    off += 8 + ln

changed = 0
for m in gltf.get("materials", []):
    pbr = m.setdefault("pbrMetallicRoughness", {})
    if m.get("name") == "Door_Gunner_Figure":
        print(f"  uniform  {[round(x,3) for x in pbr.get('baseColorFactor',[])]} -> {UNIFORM[:3]}")
        pbr["baseColorFactor"] = UNIFORM
        pbr["metallicFactor"], pbr["roughnessFactor"] = 0.0, 0.96
        changed += 1
    elif m.get("name") == "DoorGun":
        print(f"  gun      {[round(x,3) for x in pbr.get('baseColorFactor',[])]} -> {GUN[:3]}")
        print(f"  gun      metallic {pbr.get('metallicFactor')} -> {GUN_METAL}   roughness {pbr.get('roughnessFactor')} -> {GUN_ROUGH}")
        pbr["baseColorFactor"] = GUN
        pbr["metallicFactor"], pbr["roughnessFactor"] = GUN_METAL, GUN_ROUGH
        changed += 1
if changed != 2:
    sys.exit(f"expected 2 materials, repainted {changed}")

pad = lambda d, f=b"\x00": bytes(d) + f * (-len(d) % 4)
js, bn = pad(json.dumps(gltf, separators=(",", ":")).encode(), b" "), pad(binary)
out = 12 + 8 + len(js) + 8 + len(bn)
with open(dst, "wb") as fh:
    fh.write(struct.pack("<4sII", b"glTF", 2, out))
    fh.write(struct.pack("<I4s", len(js), b"JSON")); fh.write(js)
    fh.write(struct.pack("<I4s", len(bn), b"BIN\x00")); fh.write(bn)
print(f"  wrote {dst}  ({out/1e6:.2f} MB, geometry byte-identical)")
