#!/usr/bin/env python3
"""
Mark a tileset's materials unlit, so it is not lit twice.

A photogrammetry texture already contains the sunlight and shadows of
the morning the aircraft flew. Cesium then lights it again with the
scene's sun, and a concrete roof that was already bright in the
photograph blows out to flat white. The surrounding orthophoto is
draped on the globe and is not shaded the same way, so the two read as
different scenes stitched together.

Google's photorealistic tiles do not have this problem, and main.js
already records why, in the day-mode branch:

    "its materials are commonly unlit, so scene.light, lightColor and
     imageBasedLighting are all ignored"

That is the difference. Our materials come out of Obj2Tiles as ordinary
PBR, so every lighting value main.js sets on the tileset is applied
rather than ignored, and `_matchPhotorealLighting` cannot help: it
mirrors the treatment Google's tiles get, which only works because
those tiles are unlit in the first place.

KHR_materials_unlit says "render baseColor as-is". It is a ratified
glTF extension, Cesium supports it, and it makes our mesh behave
exactly like the asset main.js was already written around.

Done here rather than in the app because it is a property of the data,
not of the view, and because it then holds in every imagery mode
without touching the known-good day configuration.

Usage:
    python3 unlit_tiles.py --tiles work/bt-dense/odm/3d_tiles_buildings
"""

import argparse
import json
import struct
from pathlib import Path

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def _pad(buf, fill):
    """GLB chunks are padded to a four byte boundary."""
    extra = (4 - len(buf) % 4) % 4
    return buf + fill * extra


def patch_glb(glb: bytes):
    magic, version, glen = struct.unpack("<III", glb[:12])
    if magic != GLB_MAGIC:
        raise ValueError("not a GLB")

    # Bounded by the GLB's OWN declared length, not by the slice.
    # A b3dm pads its total size, so the bytes after the header can run
    # past the end of the GLB, and walking to the end of the slice then
    # tries to read a chunk header out of the padding.
    p, chunks = 12, []
    glen = min(glen, len(glb))
    while p + 8 <= glen:
        clen, ctype = struct.unpack("<II", glb[p:p + 8])
        if p + 8 + clen > glen:
            break
        chunks.append((ctype, glb[p + 8:p + 8 + clen]))
        p += 8 + clen

    out, changed = [], 0
    for ctype, data in chunks:
        if ctype != CHUNK_JSON:
            out.append((ctype, data))
            continue
        doc = json.loads(data.decode("utf-8").rstrip("\x00 "))
        for mat in doc.get("materials", []):
            ext = mat.setdefault("extensions", {})
            if "KHR_materials_unlit" not in ext:
                ext["KHR_materials_unlit"] = {}
                changed += 1
            # An unlit material ignores metallic and roughness, but
            # leaving a metallic factor set makes some validators
            # complain about a contradiction.
            pbr = mat.get("pbrMetallicRoughness")
            if pbr is not None:
                pbr["metallicFactor"] = 0.0
        if changed:
            used = doc.setdefault("extensionsUsed", [])
            if "KHR_materials_unlit" not in used:
                used.append("KHR_materials_unlit")
        data = _pad(json.dumps(doc, separators=(",", ":")).encode("utf-8"), b" ")
        out.append((ctype, data))

    if not changed:
        return None

    body = b"".join(
        struct.pack("<II", len(d), t) + d for t, d in out
    )
    return struct.pack("<III", GLB_MAGIC, version, 12 + len(body)) + body


def patch_b3dm(path: Path) -> bool:
    raw = path.read_bytes()
    if raw[:4] != b"b3dm":
        return False
    (magic, version, _blen, ftj, ftb, btj, btb) = struct.unpack("<4sIIIIII", raw[:28])
    head_len = 28 + ftj + ftb + btj + btb
    header, glb = raw[:head_len], raw[head_len:]

    new_glb = patch_glb(glb)
    if new_glb is None:
        return False
    # The b3dm's own byteLength covers the whole file and must be
    # rewritten, otherwise the parser reads past or stops short.
    body = header[28:] + new_glb
    out = struct.pack("<4sIIIIII", magic, version, 28 + len(body), ftj, ftb, btj, btb) + body
    path.write_bytes(out)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles", required=True, help="the 3D Tiles directory")
    a = ap.parse_args()

    root = Path(a.tiles)
    if not (root / "tileset.json").exists():
        raise SystemExit(f"No tileset.json under {root}")

    done = skipped = 0
    for f in sorted(root.rglob("*.b3dm")):
        if patch_b3dm(f):
            done += 1
        else:
            skipped += 1
    print(f"{done:,} tiles marked unlit, {skipped:,} unchanged")
    if not done:
        print("Nothing changed. Either already unlit, or these are not b3dm.")


if __name__ == "__main__":
    main()
