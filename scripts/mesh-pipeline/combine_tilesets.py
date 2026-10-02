#!/usr/bin/env python3
"""
Compose several tilesets into one the app can load with a single URL.

A site is not always one build. Billund is the airport, built at 0.12 m
per pixel because a terminal deserves it, plus the town around it at
0.20 because it is bungalows. Those are separate runs with separate
atlases and separate local origins, and both have to be on screen at
once: the town is the context the airport sits in, not an alternative
to it.

3D Tiles composes natively for exactly this. A tile's content may be
another tileset, so a parent with one child per build is the whole
mechanism. No change to the app, which still loads one URL, and each
build keeps its own origin, atlas and texture resolution.

Deliberately NOT merged into one OBJ before tiling. That would force one
shared atlas and one shared texture resolution across a terminal and a
holiday cottage, and rebuilding either would mean rebuilding both.

Bounding volumes are regions, in radians, which can be written from the
bounding boxes the builds were made with and need no decoding of each
child's transform. Heights are deliberately generous: Cesium uses these
only to decide what to cull, so an over-large region costs a little
culling efficiency and an under-large one makes tiles vanish at certain
angles.

Usage:
    python3 combine_tilesets.py --out work/billund-combined \
        --child billund-airport:work/billund-airport/tiles:9.1228,55.7329,9.1718,55.7479 \
        --child billund-city:work/billund-city/tiles:9.10441,55.71595,9.14589,55.73931
"""

import argparse
import json
import math
import os
from pathlib import Path


def region(bbox, h0, h1):
    return [math.radians(bbox[0]), math.radians(bbox[1]),
            math.radians(bbox[2]), math.radians(bbox[3]), h0, h1]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--child", action="append", required=True,
                    help="name:path:minLon,minLat,maxLon,maxLat")
    ap.add_argument("--min-height", type=float, default=0.0)
    ap.add_argument("--max-height", type=float, default=250.0)
    ap.add_argument("--geometric-error", type=float, default=500.0)
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    children, boxes = [], []
    for spec in a.child:
        name, path, bb = spec.split(":", 2)
        bbox = tuple(float(v) for v in bb.split(","))
        src = Path(path).resolve()
        if not (src / "tileset.json").exists():
            raise SystemExit(f"No tileset.json under {src}")
        # Symlinked, not copied. These are tens of megabytes each and a
        # copy goes stale the moment either build is re-run.
        link = out / name
        if link.is_symlink() or link.exists():
            link.unlink()
        os.symlink(src, link)
        boxes.append(bbox)
        children.append({
            "boundingVolume": {"region": region(bbox, a.min_height, a.max_height)},
            "geometricError": a.geometric_error / 5.0,
            "refine": "REPLACE",
            "content": {"uri": f"{name}/tileset.json"},
        })
        print(f"  {name} -> {src}")

    whole = (min(b[0] for b in boxes), min(b[1] for b in boxes),
             max(b[2] for b in boxes), max(b[3] for b in boxes))
    doc = {
        "asset": {"version": "1.0"},
        "geometricError": a.geometric_error,
        "root": {
            "boundingVolume": {"region": region(whole, a.min_height, a.max_height)},
            "geometricError": a.geometric_error,
            # ADD, because the children are different ground rather than
            # different detail of the same ground. REPLACE here would let
            # one build suppress the other.
            "refine": "ADD",
            "children": children,
        },
    }
    (out / "tileset.json").write_text(json.dumps(doc, indent=1) + "\n")
    print(f"\nwrote {out/'tileset.json'}  ({len(children)} children)")
    print(f"covers lon {whole[0]}..{whole[2]}  lat {whole[1]}..{whole[3]}")
    print(f"\nserve with:\n  python3 serve_tiles.py 8778 {out}")


if __name__ == "__main__":
    main()
