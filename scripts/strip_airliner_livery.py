#!/usr/bin/env python3
"""Strip the Indonesian presidential markings from the A320 texture set.

The only A320 asset the platform loads is public/aircraft/a320_noskin.glb,
and it shipped in Indonesian presidential livery: REPUBLIK INDONESIA
titles down both sides of the fuselage, two Garuda crests, the A-001
registration in four places, a gold star-and-wreath emblem on each side
of the fin, and five Indonesian flag patches on the fuselage and wings.

None of that can appear in customer-facing material. The red and gold
scheme itself is fine and is kept, because a plain white aircraft reads
as a placeholder and the brief was to keep it looking real.

WHAT THIS DOES NOT DO. It does not repaint, recolour or re-letter
anything. Every marking is replaced by the paint that surrounds it, so
the result is an unmarked aircraft in a red and gold scheme rather than
an aircraft wearing somebody else's identity.

HOW THE FILL WORKS, AND WHY IT IS NOT A RECTANGLE OF FLAT COLOUR. The
background colour of each region is the median of a ring around it.
Every row then searches outward for the nearest pixel close to that
colour and interpolates across. Red regions find red, white regions
find white, and windows, gold trim and panel lines are skipped rather
than smeared across the fuselage, which is what the first version did.

HOW IT IS PACKED BACK IN. Each cleaned PNG comes out smaller than the
original, so it is padded to the exact original byte length with a tEXt
chunk and written in place. Every bufferView offset in the GLB therefore
stays valid and the file size does not change. Rebuilding the buffer and
rewriting 1,394 accessor offsets would be the alternative, and it would
be a far better way to break a 26 MB asset.

Usage:  python3 scripts/strip_airliner_livery.py
Restore: git checkout public/aircraft/a320_noskin.glb

Rectangles were read off a coordinate grid rendered over each 4096px
texture. Regenerate one with:
    python3 -c "from PIL import Image,ImageDraw; ..."  (see git history)
"""
import io
import json
import os
import shutil
import struct
import sys
import zlib

import numpy as np
from PIL import Image

GLB = 'public/aircraft/a320_noskin.glb'
# baseColorTexture image indices for the four materials, in GLB order.
LIVERY_IMAGES = (0, 4, 8)

RECTS = {
 0: [(995,0,1255,860),      # REPUBLIK titles, port side
     (1750,0,2010,890),     # INDONESIA titles
     (1030,845,1260,1040),  # Garuda crest, left
     (1740,845,1970,1040),  # Garuda crest, right
     (2090,780,2210,1020),  # A-001 registration
     (3530,190,3690,370),   # gold star emblem, fin
     (3570,1390,3730,1570), # gold star emblem, fin reverse
     (3160,2720,3380,2880), # A-001 on the white
     (0,1800,230,2240),     # flag patch, port
     (0,3500,300,3900),     # flag patch, lower port
     (2890,3950,3210,4096)],# flag patch, belly
 4: [(975,2860,1205,4096),  # INDONESIA titles, starboard
     (1680,2780,1950,4096), # REPUBLIK titles, starboard
     (2860,1740,3140,2120)],# flag patch, starboard
 8: [(2310,190,2850,660),   # flag patch, wing upper
     (1070,1990,1660,2490), # flag patch, wing lower
     (1940,1760,2080,2000), # A-001, engine left
     (3300,1740,3460,1980)],# A-001, engine right
}


def fill(path, rects, out):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    H, W, _ = a.shape
    for (x0, y0, x1, y1) in rects:
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, W), min(y1, H)

        # THE SOURCE HAS TO BE PAINT, NOT WHATEVER HAPPENS TO SIT THERE.
        #
        # Taking the single column either side of the rectangle smeared
        # a window across the fuselage wherever a row happened to end on
        # one. So the background colour is the median of a ring around
        # the rectangle, and each row then searches OUTWARD for the
        # nearest pixel close to it. Red regions find red, white regions
        # find white, and windows, text and trim are skipped.
        pad = 24
        rx0, ry0 = max(x0 - pad, 0), max(y0 - pad, 0)
        rx1, ry1 = min(x1 + pad, W), min(y1 + pad, H)
        ring = np.concatenate([
            a[ry0:ry1, rx0:x0].reshape(-1, 3), a[ry0:ry1, x1:rx1].reshape(-1, 3),
            a[ry0:y0, rx0:rx1].reshape(-1, 3), a[y1:ry1, rx0:rx1].reshape(-1, 3),
        ]) if (rx1 > rx0 and ry1 > ry0) else np.zeros((1, 3), np.float32)
        if not len(ring):
            continue
        bg = np.median(ring, axis=0)
        TOL, REACH = 38.0, 400

        for y in range(y0, y1):
            row = a[y]
            src = [None, None]
            for k, (start, step) in enumerate(((x0 - 1, -1), (x1, 1))):
                x = start
                while 0 <= x < W and abs(x - start) < REACH:
                    if np.abs(row[x] - bg).max() <= TOL:
                        src[k] = row[x].copy(); break
                    x += step
            L, R = src
            if L is None and R is None:
                a[y, x0:x1] = bg; continue
            if L is None: L = R
            if R is None: R = L
            t = np.linspace(0, 1, x1 - x0, dtype=np.float32)[:, None]
            a[y, x0:x1] = L[None, :] * (1 - t) + R[None, :] * t
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(out, optimize=True)
    return out


def pad_png(data, target):
    """Pad a PNG to an exact byte length with a tEXt chunk before IEND."""
    need = target - len(data)
    if need < 0:
        raise SystemExit(f'cleaned PNG is LARGER by {-need} bytes')
    if need == 0:
        return data
    if need < 12:
        raise SystemExit(f'cannot pad by {need} bytes, chunk overhead is 12')
    key = b'Comment\x00'
    body = key + b'A' * (need - 12 - len(key))
    chunk = struct.pack('>I', len(body)) + b'tEXt' + body
    chunk += struct.pack('>I', zlib.crc32(b'tEXt' + body) & 0xffffffff)
    i = data.rindex(b'IEND') - 4
    out = data[:i] + chunk + data[i:]
    assert len(out) == target, (len(out), target)
    return out


def chunks_of(raw):
    _, _, total = struct.unpack('<III', raw[:12])
    pos, out = 12, []
    while pos < total:
        ln, ty = struct.unpack('<II', raw[pos:pos + 8])
        pos += 8
        out.append((ty, pos, ln))
        pos += ln
    return out, total


def main():
    if not os.path.exists(GLB):
        raise SystemExit(f'{GLB} not found. Run from the repo root.')
    raw = bytearray(open(GLB, 'rb').read())
    chunks, total = chunks_of(raw)
    jo, jl = next((o, l) for t, o, l in chunks if t == 0x4E4F534A)
    bo = next(o for t, o, l in chunks if t == 0x004E4942)
    j = json.loads(bytes(raw[jo:jo + jl]))

    work = os.path.join(os.path.dirname(GLB), '.livery_work')
    os.makedirs(work, exist_ok=True)
    shutil.copy2(GLB, GLB + '.orig')
    for idx in LIVERY_IMAGES:
        bv = j['bufferViews'][j['images'][idx]['bufferView']]
        off, ln = bo + bv.get('byteOffset', 0), bv['byteLength']
        src = os.path.join(work, f'img{idx}.png')
        open(src, 'wb').write(bytes(raw[off:off + ln]))
        dst = os.path.join(work, f'clean{idx}.png')
        fill(src, RECTS[idx], dst)
        new = pad_png(open(dst, 'rb').read(), ln)
        raw[off:off + ln] = new
        print(f'image {idx}: {len(RECTS[idx])} regions cleaned, {ln} bytes replaced in place')

    open(GLB, 'wb').write(raw)
    # Decode every image back out, so a corrupt write cannot ship quietly.
    chunks, total = chunks_of(raw)
    jo, jl = next((o, l) for t, o, l in chunks if t == 0x4E4F534A)
    bo = next(o for t, o, l in chunks if t == 0x004E4942)
    j = json.loads(bytes(raw[jo:jo + jl]))
    for im in j['images']:
        bv = j['bufferViews'][im['bufferView']]
        o = bo + bv.get('byteOffset', 0)
        Image.open(io.BytesIO(bytes(raw[o:o + bv['byteLength']]))).load()
    print(f'{len(j["images"])}/{len(j["images"])} images decode, '
          f'size {len(raw)} bytes, header agrees: {total == len(raw)}')
    shutil.rmtree(work, ignore_errors=True)
    os.remove(GLB + '.orig')


if __name__ == '__main__':
    main()
