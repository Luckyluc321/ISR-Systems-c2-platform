#!/usr/bin/env python3
"""
Export the ground each site's mesh covers, for the C2 to clip boxes with.

This replaces per-building outlines for the draped pipeline, and the
reason is worth stating because the two approaches look interchangeable
and are not.

export_footprints.py exists for the ORIGINAL photogrammetry mesh, which
reconstructed everything the cameras saw: roads, grass, parked cars, the
lot. That mesh had to be clipped to building outlines, because only the
buildings were wanted, and the same outlines conveniently cut the white
OSM boxes away underneath them. One set of polygons, two jobs, and the
symmetry was the point.

drape_site.py does not work that way. It builds ONLY buildings: a roof
polygon per footprint and walls extruded down to the ground, about
twenty faces each and not one triangle of terrain. So:

    the mesh needs no clipping at all.  Clipping it to footprints can
    only remove buildings that should be drawn.

    the boxes still need clipping, but to the AREA the mesh covers,
    not to each outline inside it. Inside that area the mesh draws
    every building there is, so every box in it is redundant.

That difference is what this script is for, and it is not academic.
Billund was left with the terminal-only outline set from the very first
photogrammetry run: 15 buildings over an 835 m box. Those 15 outlines
were clipping a 3,743-building mesh down to 15, and the other 3,728
buildings were showing as white OSM boxes. Everything looked broken in
exactly the way "the mesh did not load" looks, and the mesh had loaded
fine.

Rectangles also keep the polygon budget sane. The C2 warns past about
200 clipping polygons because the distance texture gets expensive;
3,743 outlines is eighteen times that. Three rectangles is three.

Extents are read from the meshes themselves rather than from the --bbox
that built them, so the file cannot drift from what was actually built.

Usage:
    python3 export_coverage.py --site billund \
        --build work/billund-airport/drape \
        --build work/billund-city/drape \
        --build work/billund-outer/drape \
        --out ../../src/data/building_footprints.json
"""

import argparse
import json
import math
from pathlib import Path


def _inv_utm32n(x, y):
    """ETRS89 / UTM32N back to lon/lat. Mirrors drape_site.py."""
    k0, a, f = 0.9996, 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    x -= 500000.0
    m = y / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    p1 = mu + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu) \
         + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu) \
         + (151 * e1**3 / 96) * math.sin(6 * mu)
    ep2 = e2 / (1 - e2)
    c1 = ep2 * math.cos(p1) ** 2
    t1 = math.tan(p1) ** 2
    n1 = a / math.sqrt(1 - e2 * math.sin(p1) ** 2)
    r1 = a * (1 - e2) / (1 - e2 * math.sin(p1) ** 2) ** 1.5
    d = x / (n1 * k0)
    lat = p1 - (n1 * math.tan(p1) / r1) * (
        d**2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * ep2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * ep2 - 3 * c1**2) * d**6 / 720)
    lon = (d - (1 + 2 * t1 + c1) * d**3 / 6
           + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * ep2 + 24 * t1**2) * d**5 / 120) \
        / math.cos(p1)
    return math.degrees(lon) + 9.0, math.degrees(lat)


def obj_extent(obj_path):
    """Local-frame x/y bounds of an OBJ, in metres."""
    xs0 = ys0 = float("inf")
    xs1 = ys1 = float("-inf")
    n = 0
    with open(obj_path) as fh:
        for line in fh:
            if not line.startswith("v "):
                continue
            _, x, y, _z = line.split()[:4]
            x, y = float(x), float(y)
            xs0, xs1 = min(xs0, x), max(xs1, x)
            ys0, ys1 = min(ys0, y), max(ys1, y)
            n += 1
    if not n:
        raise SystemExit(f"No vertices in {obj_path}")
    return xs0, ys0, xs1, ys1, n


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True)
    ap.add_argument("--build", action="append", required=True,
                    help="a drape output directory holding origin.json and "
                         "site.obj; repeatable, one per build")
    ap.add_argument("--out", required=True)
    ap.add_argument("--pad", type=float, default=2.0,
                    help="metres to grow each rectangle, so a box on the very "
                         "edge of a build is still cut")
    a = ap.parse_args()

    rects, total_v = [], 0
    for d in a.build:
        d = Path(d)
        origin = json.loads((d / "origin.json").read_text())
        x0, y0, x1, y1, n = obj_extent(d / "site.obj")
        total_v += n
        e, nr = origin["easting"], origin["northing"]
        lo0, la0 = _inv_utm32n(e + x0 - a.pad, nr + y0 - a.pad)
        lo1, la1 = _inv_utm32n(e + x1 + a.pad, nr + y1 + a.pad)
        rects.append({
            "build": d.parent.name,
            "ring": [[lo0, la0], [lo1, la0], [lo1, la1], [lo0, la1]],
        })
        print(f"  {d.parent.name:18s} {x1-x0:7.0f} x {y1-y0:6.0f} m   "
              f"lon {lo0:.4f}..{lo1:.4f}  lat {la0:.4f}..{la1:.4f}   {n:,} verts")

    # Drop any rectangle another one already contains.
    #
    # Cesium builds one signed distance field for the whole collection,
    # and nested or overlapping polygons are a known source of artifacts
    # in it: regions inside two polygons at once get a distance neither
    # polygon would have given alone, and the clip leaves patches
    # standing. Billund hit this exactly — the outer build's rectangle
    # contains both the airport's and the city's, because the outer
    # build IS the whole town box with those two excluded.
    #
    # Containment is also the normal case rather than an edge case. A
    # site is usually built as one wide pass plus denser inner passes,
    # so the wide one swallows the rest and the right answer is one
    # rectangle.
    def bounds(r):
        xs = [p[0] for p in r["ring"]]
        ys = [p[1] for p in r["ring"]]
        return min(xs), min(ys), max(xs), max(ys)

    keep = []
    for r in rects:
        bx = bounds(r)
        inside = next((o for o in rects if o is not r
                       and bounds(o)[0] <= bx[0] and bounds(o)[1] <= bx[1]
                       and bounds(o)[2] >= bx[2] and bounds(o)[3] >= bx[3]), None)
        if inside:
            print(f"  dropping {r['build']}: already inside {inside['build']}")
        else:
            keep.append(r)
    # A partial overlap is not something this can resolve by dropping,
    # so it is reported rather than silently shipped.
    for i, r in enumerate(keep):
        for o in keep[i + 1:]:
            a0, b0, a1, b1 = bounds(r)
            c0, d0, c1, d1 = bounds(o)
            if a0 < c1 and c0 < a1 and b0 < d1 and d0 < b1:
                print(f"  WARNING: {r['build']} and {o['build']} partially overlap. "
                      "Cesium's clip may leave boxes standing in the overlap.")
    rects = keep

    out = Path(a.out)
    doc = json.loads(out.read_text()) if out.exists() else {}
    doc.setdefault("sites", {})
    site = doc["sites"].setdefault(a.site, {})
    # The old per-building outlines are dropped rather than left beside
    # the rectangles. Two sources for the same decision is how the stale
    # 15-outline set survived three rebuilds without anyone noticing.
    site.pop("buildings", None)
    site.pop("mesh_extent_utm32n", None)
    site["coverage"] = rects
    site["pad_m"] = a.pad
    site["note"] = ("Areas where this site's draped mesh draws every building. "
                    "The mesh is buildings-only so it is never clipped; these "
                    "rectangles cut the extruded OSM boxes away underneath it. "
                    "Generated by export_coverage.py from the built meshes.")
    out.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"\nwrote {out}  ({len(rects)} rectangles, from {total_v:,} mesh vertices)")


if __name__ == "__main__":
    main()
