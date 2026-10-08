#!/usr/bin/env python3
"""
Render a clipped mesh to PNG, so it can be judged without loading the C2.

Every problem so far looked the same on screen: blocks in the air. Plan
view, elevation and the numbers each tell a different part of why, and
getting that from a screenshot of the running app costs a round trip
and still does not say whether a thing is floating or just has a hole
under it.

Three views, software rasterised, no GPU and no browser:

  plan        from above, coloured by height above local ground
  elevation   looking north, the silhouette. ANYTHING FLOATING SHOWS
              HERE as geometry with empty space beneath it
  section     a vertical slice, to see inside a building

Usage:
    python3 inspect_mesh.py --obj .../buildings_only.obj --out /tmp/mesh
"""

import argparse
import math
import struct
import sys
import zlib
from pathlib import Path


def load_obj(path, off_x=0.0, off_y=0.0):
    verts, faces = [], []
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                p = line.split()
                verts.append((float(p[1]) + off_x, float(p[2]) + off_y, float(p[3])))
            elif line.startswith("f "):
                ids = [int(t.split("/")[0]) - 1 for t in line.split()[1:]]
                for i in range(1, len(ids) - 1):
                    faces.append((ids[0], ids[i], ids[i + 1]))
    return verts, faces


def write_png(path, w, h, rgb):
    """Minimal PNG writer, so this needs nothing installed."""
    raw = b"".join(b"\x00" + bytes(rgb[y * w * 3:(y + 1) * w * 3]) for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6))
           + chunk(b"IEND", b""))
    Path(path).write_bytes(png)


def ramp(t):
    """Blue to cyan to yellow to red, for height."""
    t = max(0.0, min(1.0, t))
    if t < 0.33:
        u = t / 0.33
        return (int(30 + 20 * u), int(60 + 160 * u), int(160 + 70 * u))
    if t < 0.66:
        u = (t - 0.33) / 0.33
        return (int(50 + 200 * u), int(220 - 10 * u), int(230 - 160 * u))
    u = (t - 0.66) / 0.34
    return (250, int(210 - 150 * u), int(70 - 50 * u))


def render(verts, faces, w, h, ax0, ax1, flip_v, depth_axis, zmin, zmax,
           colour_axis, cmin, cmax, bg=(16, 18, 22)):
    """Painter with a z-buffer, orthographic."""
    img = bytearray()
    for _ in range(w * h):
        img += bytes(bg)
    zbuf = [1e18] * (w * h)

    lo0 = min(v[ax0] for v in verts); hi0 = max(v[ax0] for v in verts)
    lo1 = min(v[ax1] for v in verts); hi1 = max(v[ax1] for v in verts)
    span = max(hi0 - lo0, hi1 - lo1) or 1.0
    pad = 0.04 * span
    lo0 -= pad; lo1 -= pad
    span += 2 * pad

    def project(v):
        x = (v[ax0] - lo0) / span * (w - 1)
        y = (v[ax1] - lo1) / span * (h - 1)
        return x, (h - 1 - y) if flip_v else y

    for tri in faces:
        p = [verts[i] for i in tri]
        pts = [project(v) for v in p]
        d = sum(v[depth_axis] for v in p) / 3.0
        c = sum(v[colour_axis] for v in p) / 3.0
        col = ramp((c - cmin) / (cmax - cmin) if cmax > cmin else 0.5)

        xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
        x0 = max(0, int(min(xs))); x1 = min(w - 1, int(max(xs)) + 1)
        y0 = max(0, int(min(ys))); y1 = min(h - 1, int(max(ys)) + 1)
        if x1 < x0 or y1 < y0:
            continue
        (ax, ay), (bx, by), (cx, cy) = pts
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-12:
            continue
        for py in range(y0, y1 + 1):
            for px in range(x0, x1 + 1):
                l1 = ((by - cy) * (px + .5 - cx) + (cx - bx) * (py + .5 - cy)) / det
                if l1 < -0.002: continue
                l2 = ((cy - ay) * (px + .5 - cx) + (ax - cx) * (py + .5 - cy)) / det
                if l2 < -0.002: continue
                if l1 + l2 > 1.002: continue
                k = py * w + px
                if d < zbuf[k]:
                    zbuf[k] = d
                    img[k * 3:k * 3 + 3] = bytes(col)
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--obj", required=True)
    ap.add_argument("--out", required=True, help="prefix for the PNGs")
    ap.add_argument("--size", type=int, default=900)
    ap.add_argument("--offset", help="odm_georeferencing_model_geo.txt")
    a = ap.parse_args()

    off_x = off_y = 0.0
    off = Path(a.offset) if a.offset else (
        Path(a.obj).parent.parent / "odm_georeferencing" / "odm_georeferencing_model_geo.txt")
    if off.exists():
        for line in off.read_text().splitlines():
            parts = line.split()
            if len(parts) == 2:
                try:
                    off_x, off_y = float(parts[0]), float(parts[1]); break
                except ValueError:
                    pass

    verts, faces = load_obj(a.obj, off_x, off_y)
    if not faces:
        sys.exit(f"No faces in {a.obj}")
    zs = sorted(v[2] for v in verts)
    zmin, zmax = zs[0], zs[-1]
    print(f"{len(verts):,} verts, {len(faces):,} triangles")
    print(f"height {zmin:.1f} .. {zmax:.1f} m")

    s = a.size
    # Plan: looking down. Nearest to the camera is the highest, so depth
    # is negative height.
    neg = [(v[0], v[1], -v[2]) for v in verts]
    img = render(neg, faces, s, s, 0, 1, True, 2, 0, 0, 2, -zmax, -zmin)
    write_png(f"{a.out}_plan.png", s, s, img)
    print(f"wrote {a.out}_plan.png   (from above, colour = height)")

    # Elevation: looking north. Floating geometry is unmistakable here.
    ev = [(v[0], v[2], v[1]) for v in verts]
    img = render(ev, faces, s, s // 2, 0, 1, True, 2, 0, 0, 1, zmin, zmax)
    write_png(f"{a.out}_elev.png", s, s // 2, img)
    print(f"wrote {a.out}_elev.png   (looking north, colour = height)")


if __name__ == "__main__":
    main()
