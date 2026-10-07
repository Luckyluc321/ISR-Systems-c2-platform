#!/usr/bin/env python3
"""Shrink a GLB by resampling its textures, leaving geometry and animation alone.

Why this exists
---------------
Sketchfab exports ship studio-resolution texture sets. The DJI Inspire 2 we
pulled is 279.8 MB, of which 275.3 MB is 38 images and only 4.3 MB is the
actual mesh and animation. At the size these models draw on a map, a few
hundred pixels at most, 4K albedo maps are invisible detail that every
viewer still has to download.

So this touches ONLY the image bufferViews. Nodes, meshes, accessors,
skins, animations and materials pass through byte for byte, which matters
here: the whole reason we want this model is its MOTOR1..MOTOR4 rotor
animation, and a converter that re-authored the scene graph could lose it.

What it does
------------
  - decodes every image, resamples anything above --max-size with Lanczos
  - re-encodes opaque images as JPEG, keeps PNG only where real alpha exists
  - rebuilds the binary chunk, re-pointing every bufferView offset
  - leaves the glTF JSON otherwise untouched

Usage
-----
  uv run python scripts/shrink_glb_textures.py in.glb out.glb
  uv run python scripts/shrink_glb_textures.py in.glb out.glb --max-size 1024 --quality 82

Verify afterwards with --verify, which re-parses the output and asserts the
node, mesh, animation and channel counts match the input.
"""

import argparse
import io
import json
import struct
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  uv pip install Pillow")

GLB_MAGIC = b"glTF"
JSON_CHUNK = b"JSON"
BIN_CHUNK = b"BIN\x00"


def read_glb(path):
    with open(path, "rb") as fh:
        blob = fh.read()
    magic, version, total = struct.unpack("<4sII", blob[:12])
    if magic != GLB_MAGIC:
        sys.exit(f"{path} is not a GLB (magic {magic!r})")
    gltf, binary, off = None, b"", 12
    while off < total:
        length, kind = struct.unpack("<I4s", blob[off:off + 8])
        payload = blob[off + 8:off + 8 + length]
        if kind == JSON_CHUNK:
            gltf = json.loads(payload)
        elif kind == BIN_CHUNK:
            binary = payload
        off += 8 + length
    if gltf is None:
        sys.exit(f"{path} has no JSON chunk")
    return gltf, binary, total


def pad4(data, filler=b"\x00"):
    return data + filler * (-len(data) % 4)


def resample(raw, max_size, quality):
    """Return (bytes, mime, note) for one image."""
    img = Image.open(io.BytesIO(raw))
    img.load()
    before = img.size

    # Real alpha, not merely an alpha channel that is fully opaque. A great
    # many exported PNGs carry a channel that is 255 everywhere, and keeping
    # those as PNG is most of the file for none of the benefit.
    has_alpha = False
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        alpha = img.convert("RGBA").getchannel("A")
        has_alpha = alpha.getextrema()[0] < 255

    if max(img.size) > max_size:
        ratio = max_size / max(img.size)
        img = img.resize(
            (max(1, round(img.width * ratio)), max(1, round(img.height * ratio))),
            Image.LANCZOS,
        )

    out = io.BytesIO()
    if has_alpha:
        img.convert("RGBA").save(out, format="PNG", optimize=True)
        mime = "image/png"
    else:
        img.convert("RGB").save(out, format="JPEG", quality=quality, optimize=True)
        mime = "image/jpeg"
    return out.getvalue(), mime, f"{before[0]}x{before[1]} -> {img.width}x{img.height}"


def shrink(src, dst, max_size, quality, verbose):
    gltf, binary, total_before = read_glb(src)
    views = gltf.get("bufferViews", [])
    images = gltf.get("images", [])
    if not images:
        sys.exit("no images in this GLB; nothing to shrink")

    # bufferView index -> replacement bytes
    replacement = {}
    saved = 0
    print(f"{'img':<5}{'before':>9}{'after':>9}  {'resample':<24}{'format'}")
    print("-" * 62)
    for idx, image in enumerate(images):
        if "bufferView" not in image:
            continue
        vi = image["bufferView"]
        view = views[vi]
        start = view.get("byteOffset", 0)
        raw = binary[start:start + view["byteLength"]]
        new, mime, note = resample(raw, max_size, quality)
        # Never let a "shrink" make a file larger.
        if len(new) >= len(raw):
            new, mime, note = raw, image.get("mimeType", "image/png"), note + " (kept)"
        replacement[vi] = new
        image["mimeType"] = mime
        saved += len(raw) - len(new)
        if verbose:
            print(f"{idx:<5}{len(raw)/1e6:8.1f}M{len(new)/1e6:8.1f}M  {note:<24}{mime.split('/')[1]}")

    # Rebuild the binary chunk in bufferView order, re-pointing each offset.
    # Everything that is not an image is copied byte for byte, so geometry,
    # animation samplers and inverse bind matrices are untouched.
    rebuilt = bytearray()
    for vi, view in enumerate(views):
        data = replacement.get(vi)
        if data is None:
            start = view.get("byteOffset", 0)
            data = binary[start:start + view["byteLength"]]
        while len(rebuilt) % 4:
            rebuilt.append(0)
        view["byteOffset"] = len(rebuilt)
        view["byteLength"] = len(data)
        rebuilt.extend(data)

    rebuilt = pad4(bytes(rebuilt))
    if gltf.get("buffers"):
        gltf["buffers"][0]["byteLength"] = len(rebuilt)
        gltf["buffers"][0].pop("uri", None)

    json_chunk = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(json_chunk) + 8 + len(rebuilt)
    with open(dst, "wb") as fh:
        fh.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
        fh.write(struct.pack("<I4s", len(json_chunk), JSON_CHUNK))
        fh.write(json_chunk)
        fh.write(struct.pack("<I4s", len(rebuilt), BIN_CHUNK))
        fh.write(rebuilt)

    print("-" * 62)
    print(f"  {total_before/1e6:.1f} MB  ->  {total/1e6:.1f} MB"
          f"   ({100 * (1 - total / total_before):.1f}% smaller)")
    return total_before, total


def verify(src, dst):
    """Assert the scene graph survived. The animation is the point of this model."""
    a, _, _ = read_glb(src)
    b, _, _ = read_glb(dst)
    checks = [
        ("nodes", len(a.get("nodes", [])), len(b.get("nodes", []))),
        ("meshes", len(a.get("meshes", [])), len(b.get("meshes", []))),
        ("accessors", len(a.get("accessors", [])), len(b.get("accessors", []))),
        ("materials", len(a.get("materials", [])), len(b.get("materials", []))),
        ("animations", len(a.get("animations", [])), len(b.get("animations", []))),
        ("anim channels", sum(len(x.get("channels", [])) for x in a.get("animations", [])),
                          sum(len(x.get("channels", [])) for x in b.get("animations", []))),
        ("images", len(a.get("images", [])), len(b.get("images", []))),
    ]
    ok = True
    print()
    for name, before, after in checks:
        good = before == after
        ok &= good
        print(f"  {'PASS' if good else 'FAIL'}  {name:<16}{before} -> {after}")
    names_a = [n.get("name") for n in a.get("nodes", [])]
    names_b = [n.get("name") for n in b.get("nodes", [])]
    same = names_a == names_b
    ok &= same
    print(f"  {'PASS' if same else 'FAIL'}  node names identical")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--max-size", type=int, default=1024,
                    help="longest edge in pixels (default 1024)")
    ap.add_argument("--quality", type=int, default=85, help="JPEG quality (default 85)")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--verify", action="store_true", default=True)
    args = ap.parse_args()

    shrink(args.src, args.dst, args.max_size, args.quality, not args.quiet)
    if args.verify and not verify(args.src, args.dst):
        sys.exit("verification FAILED: the output is not structurally identical")


if __name__ == "__main__":
    main()
