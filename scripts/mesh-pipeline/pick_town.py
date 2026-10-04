#!/usr/bin/env python3
"""
Derive a town's build box from where its buildings actually are.

The box is the first decision and the one that has gone wrong most. It
was typed from memory three times: once onto Billund's runway, which
holds zero buildings and burned a full reconstruction over half a square
kilometre of tarmac, and twice onto boxes that missed the part of town
that mattered. The last of those reached east into farmland and stopped
870 m short of the industrial estate someone was actually looking at.

So the box is computed, never typed.

HOW IT DECIDES

Grid the footprints, keep only cells above a density floor, and flood
fill outward from the densest cell. The bounding box of that fill is the
town.

The density floor is the whole trick. At a floor of one building per
cell, Danish rural building density connects every village to every other
and the fill runs to the edge of whatever you sampled — tried, and it
reported a 12.8 km box that was mostly farmland. At five per cell the
fill stops where the town stops.

WHY IT ALSO SPLITS INTO BLOCKS

Imagery cost does not scale with area. A frame covers a strip of ground
along a flight line, so a wide block shares frames between its rows while
a narrow strip pays for every line it crosses and shares nothing.
Measured on Billund: a 27 km2 block cost 7.5 frames per km2, an 8 km2
strip 1.8 km wide cost 17.5. More than twice the imagery for the same
ground.

So this emits compact blocks rather than one box or a ring of strips,
and reports what each will cost before anything is downloaded.

Usage:
    python3 pick_town.py --osm work/osm_billund_wide.json
    python3 pick_town.py --osm work/osm_billund_wide.json --max-km2 30
    python3 pick_town.py --osm work/osm_billund_wide.json --json
"""

import argparse
import collections
import json
import math

# Degrees per grid cell. 0.005 is about 310 x 555 m in Denmark: small
# enough that a cell is either town or not, large enough that one
# detached house does not make a cell.
CELL = 0.005

# Buildings per cell to count as town. Five is where the Danish
# countryside stops connecting every village to every other.
FLOOR = 5

# Measured on the five Billund builds. Used only to report cost.
MB_PER_FRAME = 351
FRAMES_PER_KM2_BLOCK = 7.5
DHM_TILES_PER_KM2 = 3.0
SECONDS_PER_FRAME = 45


def km_wide(lon0, lon1, lat):
    return (lon1 - lon0) * 111.32 * math.cos(math.radians(lat))


def km_tall(lat0, lat1):
    return (lat1 - lat0) * 111.32


def centroid(el):
    g = [p for p in el.get("geometry") or [] if p]
    if not g:
        return None
    return (sum(p["lon"] for p in g) / len(g),
            sum(p["lat"] for p in g) / len(g))


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--osm", required=True,
                    help="Overpass output over a GENEROUS area, wider than "
                         "the town you expect")
    ap.add_argument("--floor", type=int, default=FLOOR,
                    help=f"buildings per {CELL} deg cell to count as town "
                         f"(default {FLOOR})")
    ap.add_argument("--max-km2", type=float, default=30.0,
                    help="split the town into blocks no larger than this "
                         "(default 30, which is about one night of imagery)")
    ap.add_argument("--centre", help="lon,lat to grow from; default is the "
                                     "densest cell in the set")
    ap.add_argument("--json", action="store_true",
                    help="machine-readable output, for an agent")
    a = ap.parse_args()

    doc = json.loads(open(a.osm).read())
    pts = [c for c in (centroid(e) for e in doc.get("elements", [])) if c]
    if not pts:
        raise SystemExit("No footprints with geometry in that file.")

    cells = collections.Counter((int(lo / CELL), int(la / CELL)) for lo, la in pts)
    dense = {c for c, n in cells.items() if n >= a.floor}
    if not dense:
        raise SystemExit(
            f"No cell holds {a.floor} buildings. Either the area has no town "
            f"in it, or lower --floor. Densest cell holds {max(cells.values())}.")

    if a.centre:
        lo, la = (float(v) for v in a.centre.split(","))
        start = (int(lo / CELL), int(la / CELL))
        if start not in dense:
            raise SystemExit(
                f"--centre {a.centre} lands in a cell holding "
                f"{cells.get(start, 0)} buildings, under the floor of {a.floor}. "
                "Point it at the town, or lower --floor.")
    else:
        start = max(dense, key=lambda c: cells[c])

    seen, stack = {start}, [start]
    while stack:
        cx, cy = stack.pop()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                n = (cx + dx, cy + dy)
                if n in dense and n not in seen:
                    seen.add(n)
                    stack.append(n)

    lo0 = min(c[0] for c in seen) * CELL
    lo1 = (max(c[0] for c in seen) + 1) * CELL
    la0 = min(c[1] for c in seen) * CELL
    la1 = (max(c[1] for c in seen) + 1) * CELL
    held = sum(cells[c] for c in seen)
    mid = (la0 + la1) / 2
    w, h = km_wide(lo0, lo1, mid), km_tall(la0, la1)

    # Split into blocks under the cap, keeping each as square as the town
    # allows. Square matters: frames are shared between rows of a block
    # and not between strips.
    nx = max(1, math.ceil(math.sqrt(w * h / a.max_km2) * (w / max(h, 1e-6)) ** 0.5))
    ny = max(1, math.ceil((w * h / a.max_km2) / nx))
    blocks = []
    for i in range(nx):
        for j in range(ny):
            b = (lo0 + (lo1 - lo0) * i / nx, la0 + (la1 - la0) * j / ny,
                 lo0 + (lo1 - lo0) * (i + 1) / nx, la0 + (la1 - la0) * (j + 1) / ny)
            n = sum(1 for lo, la in pts if b[0] <= lo <= b[2] and b[1] <= la <= b[3])
            if n:
                blocks.append((b, n))
    blocks.sort(key=lambda t: -t[1])

    if a.json:
        print(json.dumps({
            "town_bbox": [round(v, 4) for v in (lo0, la0, lo1, la1)],
            "footprints": held,
            "km2": round(w * h, 1),
            "blocks": [{"bbox": [round(v, 4) for v in b],
                        "footprints": n,
                        "km2": round(km_wide(b[0], b[2], (b[1] + b[3]) / 2)
                                     * km_tall(b[1], b[3]), 1)}
                       for b, n in blocks],
        }, indent=1))
        return

    print(f"town        lon {lo0:.4f}..{lo1:.4f}  lat {la0:.4f}..{la1:.4f}")
    print(f"            {w:.1f} x {h:.1f} km, {w*h:.1f} km2, {held:,} footprints")
    print(f"            (density floor {a.floor} per {CELL} deg cell, "
          f"{len(seen)} cells)")
    print(f"\nbuild as {len(blocks)} block(s), largest first:\n")
    print(f'  {"bbox":42s} {"bldgs":>6} {"km2":>6} {"frames":>7} {"GB":>6} {"hours":>6}')
    tf = 0.0
    for b, n in blocks:
        k = km_wide(b[0], b[2], (b[1] + b[3]) / 2) * km_tall(b[1], b[3])
        f = k * FRAMES_PER_KM2_BLOCK
        tf += f
        bb = f"{b[0]:.4f},{b[1]:.4f},{b[2]:.4f},{b[3]:.4f}"
        print(f"  {bb:42s} {n:6,} {k:6.1f} {f:7.0f} {f*MB_PER_FRAME/1024:6.1f} "
              f"{f*SECONDS_PER_FRAME/3600:6.1f}")
    print(f"\n  total imagery      {tf*MB_PER_FRAME/1024:.0f} GB across "
          f"{len(blocks)} block(s), {tf*SECONDS_PER_FRAME/3600:.1f} h of downloading")
    print(f"  peak disk needed   {max(km_wide(b[0],b[2],(b[1]+b[3])/2)*km_tall(b[1],b[3]) for b,_ in blocks)*FRAMES_PER_KM2_BLOCK*MB_PER_FRAME/1024:.0f} GB"
          f"  (one block at a time, delete its frames after each build)")
    print(f"  height tiles       {w*h*DHM_TILES_PER_KM2:.0f}, fetched once for the whole town")
    print("\nnext: fetch_dhm.py for the WHOLE town box, then one block at a time.")


if __name__ == "__main__":
    main()
