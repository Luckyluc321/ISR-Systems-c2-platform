#!/usr/bin/env python3
"""
Pick a reconstruction box from building footprints.

The mesh is only ever wanted for buildings. Everything else the cameras
saw is ground the C2 map already draws correctly, so any square metre of
a box that holds no building is triangle budget and runtime thrown away.
That makes the footprints, not a guess at where a place is, the right
thing to define the box from.

This exists because a box WAS typed by hand. "billund-terminal" was
entered as 9.150,55.739,9.160,55.744, which is Billund's runway and
apron and contains zero buildings. A full-density reconstruction ran
over half a square kilometre of tarmac and grass, and clipping it to
footprints then kept nothing. That looked exactly like a
coordinate-system bug in the clip and was chased as one. The terminal
was 500 m northwest the whole time.

Two ways to use it:

    # the box around a named building, which is the airport case
    python3 pick_bbox.py --osm /tmp/osm_buildings.json --name "Billund Lufthavn"

    # the densest boxes in the set, which is how a city gets tiled
    python3 pick_bbox.py --osm /tmp/osm_buildings.json --rank 20

Footprints come from Overpass, the same source the C2 map draws its
white boxes from:

    [out:json][timeout:60];
    way["building"](55.7196,9.0989,55.7596,9.2004);
    out geom;
"""

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

M_PER_DEG_LAT = 111_320.0


def _scale(lat):
    """Metres per degree at this latitude. Good enough over a city; the
    box only has to be the right patch of ground, not survey-accurate."""
    return M_PER_DEG_LAT * math.cos(math.radians(lat)), M_PER_DEG_LAT


def load(osm_path):
    data = json.loads(Path(osm_path).read_text())
    out = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if el.get("type") != "way" or not geom or len(geom) < 4:
            continue
        lons = [p["lon"] for p in geom]
        lats = [p["lat"] for p in geom]
        out.append({
            "id": el.get("id"),
            "tags": el.get("tags") or {},
            "lon": sum(lons) / len(lons),
            "lat": sum(lats) / len(lats),
            "area": _area(geom),
        })
    return out


def _area(geom):
    """Shoelace on a local metric plane."""
    sx, sy = _scale(geom[0]["lat"])
    pts = [((p["lon"] - geom[0]["lon"]) * sx, (p["lat"] - geom[0]["lat"]) * sy)
           for p in geom]
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def box_around(lon, lat, size_m):
    sx, sy = _scale(lat)
    dlon, dlat = size_m / sx / 2, size_m / sy / 2
    return (round(lon - dlon, 5), round(lat - dlat, 5),
            round(lon + dlon, 5), round(lat + dlat, 5))


def contents(buildings, box):
    return [b for b in buildings
            if box[0] <= b["lon"] <= box[2] and box[1] <= b["lat"] <= box[3]]


def report(box, buildings, label=""):
    inside = contents(buildings, box)
    roof = sum(b["area"] for b in inside)
    sx, sy = _scale((box[1] + box[3]) / 2)
    w, h = (box[2] - box[0]) * sx, (box[3] - box[1]) * sy
    if label:
        print(f"\n{label}")
    print(f"  bbox     {box[0]},{box[1]},{box[2]},{box[3]}")
    print(f"  size     {w:.0f} x {h:.0f} m  ({w*h/1e6:.2f} km2)")
    print(f"  holds    {len(inside)} buildings, {roof/1000:.1f}k m2 of roof")
    for b in sorted(inside, key=lambda b: -b["area"])[:6]:
        name = b["tags"].get("name") or ""
        print(f"     {b['area']:8.0f} m2  {b['tags'].get('building', ''):<10} {name}")
    if not inside:
        # The failure this script was written to stop.
        print("  EMPTY. Do not reconstruct this box; there is nothing in it "
              "the mesh is wanted for.")
    return len(inside), roof


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--osm", required=True)
    ap.add_argument("--size", type=float, default=700.0,
                    help="box edge in metres; 700 is the proven area per run")
    ap.add_argument("--name", help="centre the box on the building matching this name")
    ap.add_argument("--rank", type=int, metavar="N",
                    help="instead, print the N densest boxes, for tiling a city")
    ap.add_argument("--check", help="report on an existing box: minLon,minLat,maxLon,maxLat")
    a = ap.parse_args()

    buildings = load(a.osm)
    if not buildings:
        sys.exit(f"No building ways in {a.osm}")
    print(f"{len(buildings)} footprints in {a.osm}")

    if a.check:
        box = tuple(float(v) for v in a.check.split(","))
        n, _ = report(box, buildings, "given box")
        sys.exit(0 if n else 1)

    if a.name:
        q = a.name.lower()
        hits = [b for b in buildings if q in (b["tags"].get("name") or "").lower()]
        if not hits:
            sys.exit(f"No building name contains {a.name!r}")
        b = max(hits, key=lambda b: b["area"])
        report(box_around(b["lon"], b["lat"], a.size), buildings,
               f"centred on {b['tags'].get('name')} (way {b['id']}, "
               f"{b['area']:.0f} m2)")
        return

    n = a.rank or 6
    # Half-tile stagger on both axes, so a cluster sitting on a seam is
    # not split into two mediocre boxes instead of one good one.
    dlat = a.size / M_PER_DEG_LAT
    dlon = a.size / _scale(sum(b["lat"] for b in buildings) / len(buildings))[0]
    tiles = defaultdict(lambda: [0, 0.0])
    for b in buildings:
        for oi in (0.0, 0.5):
            for oj in (0.0, 0.5):
                k = (round(b["lon"] / dlon - oi) + oi, round(b["lat"] / dlat - oj) + oj)
                tiles[k][0] += 1
                tiles[k][1] += b["area"]

    # Ranked by roof area, not building count: a hundred garden sheds are
    # not worth a run, one terminal is.
    ranked = sorted(tiles.items(), key=lambda kv: -kv[1][1])
    chosen, taken = [], []
    for (i, j), _ in ranked:
        lon, lat = i * dlon, j * dlat
        # Skip boxes that mostly repeat one already taken, which the
        # stagger guarantees will otherwise happen.
        if any(abs(lon - p[0]) < dlon * 0.75 and abs(lat - p[1]) < dlat * 0.75
               for p in taken):
            continue
        taken.append((lon, lat))
        chosen.append(box_around(lon, lat, a.size))
        if len(chosen) >= n:
            break

    print(f"\n{len(chosen)} boxes of {a.size:.0f} m, densest first. "
          f"One ODM run each.")
    for k, box in enumerate(chosen, 1):
        report(box, buildings, f"[{k}]")
    print("\nfetch them with:")
    for box in chosen:
        print(f"  python3 fetch.py --bbox {','.join(str(v) for v in box)} "
              f"--out ./work/tile-XX")


if __name__ == "__main__":
    main()
