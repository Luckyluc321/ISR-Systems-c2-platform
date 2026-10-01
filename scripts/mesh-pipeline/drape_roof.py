#!/usr/bin/env python3
"""
Orthorectify a building roof straight out of a skraafoto frame.

The proof that photographic buildings do not need photogrammetry.

Shape is taken as given, from an OpenStreetMap footprint and a height.
For every pixel of the output, the world point on the roof plane is
known, so it is projected into the photograph through that frame's
published camera model and the colour is read back. An inverse map, so
there are no holes and no resampling of a resampled thing.

This is the roof half of the job, and it is the easy half: a roof is
one horizontal plane, nothing in a nadir frame occludes it, and the
nadir camera is looking almost straight at it. Walls need the same
machinery plus occlusion handling and a per-face view choice.

Usage:
    python3 drape_roof.py --poses work/bt-terminal/poses.json \
        --osm /tmp/osm_buildings.json --way 96215030 \
        --height 18 --ground 94.6 --gsd 0.08 --out /tmp/terminal_roof.png
"""

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from camera import load_frames                       # noqa: E402
from clip_to_buildings import utm32n, inside         # noqa: E402

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required:  python3 -m pip install Pillow")

Image.MAX_IMAGE_PIXELS = None


def open_level(path, want_px):
    """Open the smallest pyramid level still at or above want_px wide.

    These are Cloud Optimized GeoTIFFs with an overview pyramid. Reading
    a level near the target is far faster than decoding 288 megapixels to
    sample a strip of it, and on this dataset the base level frequently
    fails to decode at all while every overview opens cleanly. The scale
    factor is returned so pixel coordinates computed against the full
    sensor can be mapped onto whichever level was opened.
    """
    im = Image.open(path)
    levels = []
    for page in range(getattr(im, "n_frames", 1)):
        try:
            im.seek(page)
            levels.append((page, im.size[0]))
        except Exception:
            break
    usable = [(p, w) for p, w in levels if w >= want_px] or levels
    page, width = min(usable, key=lambda t: t[1])
    for pg in [page] + [p for p, _ in sorted(levels, key=lambda t: -t[1])]:
        try:
            im.seek(pg)
            return im.convert("RGB"), im.size[0]
        except Exception:
            continue
    raise OSError(f"no decodable level in {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--poses", required=True)
    ap.add_argument("--osm", required=True)
    ap.add_argument("--way", type=int, required=True)
    ap.add_argument("--images", default=None,
                    help="directory of source TIFFs (default: beside poses.json)")
    ap.add_argument("--height", type=float, required=True, help="metres to the roof")
    ap.add_argument("--ground", type=float, required=True, help="local ground, DVR90")
    ap.add_argument("--gsd", type=float, default=0.08, help="output metres per pixel")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    doc = json.loads(Path(a.osm).read_text())
    way = next((e for e in doc["elements"] if e.get("id") == a.way), None)
    if not way:
        sys.exit(f"way {a.way} not in {a.osm}")
    ring = [utm32n(p["lon"], p["lat"]) for p in way["geometry"]]
    z = a.ground + a.height
    name = (way.get("tags") or {}).get("name") or str(a.way)

    x0 = min(p[0] for p in ring); x1 = max(p[0] for p in ring)
    y0 = min(p[1] for p in ring); y1 = max(p[1] for p in ring)
    W = int((x1 - x0) / a.gsd) + 1
    H = int((y1 - y0) / a.gsd) + 1
    print(f"{name}: {x1-x0:.0f} x {y1-y0:.0f} m at roof height {z:.1f} m")
    print(f"output {W} x {H} px at {a.gsd} m/px")

    frames = load_frames(a.poses)
    corners = [(x, y, z) for x, y in ring]

    # Pick the frame looking most directly down at this roof, from those
    # that see all of it with room to spare.
    up = (0.0, 0.0, 1.0)
    centre = (sum(p[0] for p in ring) / len(ring),
              sum(p[1] for p in ring) / len(ring), z)
    cands = [(f.incidence(centre, up), f) for f in frames
             if all(f.sees(c, margin=50) for c in corners)]
    if not cands:
        sys.exit("No frame sees this whole roof. Widen the fetch box.")
    inc, frame = max(cands, key=lambda t: t[0])
    print(f"{len(cands)} frames see it; using {frame.direction} "
          f"{frame.id} at incidence {inc:.3f}")

    img_dir = Path(a.images) if a.images else Path(a.poses).parent / "images"
    tif = next(img_dir.glob(f"{frame.id}*.tif"), None)
    if not tif:
        sys.exit(f"No TIFF for {frame.id} under {img_dir}")

    # Read a level whose resolution at least matches what is being asked
    # for, judged by how many sensor pixels the roof spans.
    span = max(abs(frame.project(corners[0])[0] - frame.project(corners[len(corners)//2])[0]), 1)
    want = int(frame.size[0] * max(W, H) / max(span, 1))
    src, level_w = open_level(tif, min(want, frame.size[0]))
    scale = level_w / frame.size[0]
    print(f"reading {tif.name} at {src.size[0]} x {src.size[1]} "
          f"(scale {scale:.3f} of full sensor)")

    sp = src.load()
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    op = out.load()
    sw, sh = src.size
    kept = 0
    for j in range(H):
        wy = y1 - j * a.gsd          # north up
        for i in range(W):
            wx = x0 + i * a.gsd
            if not inside(wx, wy, ring):
                continue
            q = frame.project((wx, wy, z))
            if q is None:
                continue
            c = q[0] * scale
            r = q[1] * scale
            ic, ir = int(c), int(r)
            if 0 <= ic < sw and 0 <= ir < sh:
                px = sp[ic, ir]
                op[i, j] = (px[0], px[1], px[2], 255)
                kept += 1
        if H > 20 and j % (H // 10) == 0:
            print(f"  {100*j//H:3d}%")

    out.save(a.out)
    print(f"\nwrote {a.out}  ({kept:,} pixels inside the footprint)")
    print("Every pixel came from the photograph. No reconstruction involved.")


if __name__ == "__main__":
    main()
