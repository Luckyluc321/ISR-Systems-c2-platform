#!/usr/bin/env python3
"""
Cut a reconstructed mesh down to buildings only.

Photogrammetry reconstructs the whole SURFACE the cameras saw: runway,
taxiways, fields, car parks, trees, everything. Laid over the C2 map
that replaces terrain and imagery which are already correct, and the
only thing it is wanted for is the buildings.

So this keeps the triangles that sit inside a building footprint and
discards the rest.

FOOTPRINTS COME FROM OSM, deliberately, even though GeoDanmark is more
accurate. OSM is what draws the white boxes in the map today, so
clipping to an OSM footprint and hiding the OSM box in that same
footprint makes them swap exactly. Accuracy matters less here than
correspondence: a more accurate polygon that disagrees with the box
leaves slivers of box sticking out beside the real building.

A height filter runs as well. A footprint alone also captures the
tarmac inside a building outline wherever the roof did not reconstruct,
which would drop a patch of ground into the sky at roof level.

Texture is untouched. The output references the same atlas with the
same UVs, so no retexturing is needed and nothing is resampled.

Usage:
    python3 clip_to_buildings.py \
        --obj  work/billund-terminal/odm/odm_texturing/odm_textured_model_geo.obj \
        --osm  /tmp/osm_buildings.json \
        --out  work/billund-terminal/odm/odm_texturing/buildings_only.obj
"""

import argparse
import json
import math
import sys
from pathlib import Path


def utm32n(lon, lat):
    """WGS84 lon/lat to EPSG:25832, which is what the mesh is in.

    Written out rather than pulled from pyproj: this is the only
    projection the pipeline needs, an earlier dependency on pyproj was
    added for a conversion that turned out not to be needed at all, and
    a transverse Mercator forward is short enough to read.
    """
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    k0, E0, lon0 = 0.9996, 500000.0, math.radians(9.0)   # zone 32

    la, lo = math.radians(lat), math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
    T = math.tan(la) ** 2
    C = ep2 * math.cos(la) ** 2
    A = (lo - lon0) * math.cos(la)
    M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * la
             - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * math.sin(2*la)
             + (15*e2**2/256 + 45*e2**3/1024) * math.sin(4*la)
             - (35*e2**3/3072) * math.sin(6*la))
    x = E0 + k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T*T+72*C-58*ep2)*A**5/120)
    y = k0 * (M + N*math.tan(la) * (A*A/2 + (5-T+9*C+4*C*C)*A**4/24
              + (61-58*T+T*T+600*C-330*ep2)*A**6/720))
    return x, y


def load_footprints(osm_path):
    """OSM ways tagged building, projected into the mesh's CRS."""
    data = json.loads(Path(osm_path).read_text())
    polys = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if el.get("type") != "way" or not geom or len(geom) < 4:
            continue
        ring = [utm32n(p["lon"], p["lat"]) for p in geom]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        polys.append({"ring": ring, "bbox": (min(xs), min(ys), max(xs), max(ys))})
    return polys


def build_index(polys, cell=40.0):
    """Grid index over the footprints.

    Without it every triangle is tested against every polygon, which for
    600,000 triangles and a few hundred buildings is hundreds of
    millions of point-in-polygon tests. With it each triangle only tests
    the handful of polygons in its own cell.
    """
    idx = {}
    for i, p in enumerate(polys):
        x0, y0, x1, y1 = p["bbox"]
        for cx in range(int(x0 // cell), int(x1 // cell) + 1):
            for cy in range(int(y0 // cell), int(y1 // cell) + 1):
                idx.setdefault((cx, cy), []).append(i)
    return idx, cell


def inside(x, y, ring):
    """Ray casting. Standard, and correct for the concave outlines real
    buildings have."""
    hit = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
                hit = not hit
        j = i
    return hit


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--obj", required=True)
    ap.add_argument("--osm", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-height", type=float, default=2.0,
                    help="metres above local ground a triangle must sit to be kept")
    ap.add_argument("--pad", type=float, default=1.5,
                    help="metres to grow each footprint, to keep eaves and wall thickness")
    ap.add_argument("--offset", help="path to odm_georeferencing_model_geo.txt")
    a = ap.parse_args()

    # ODM writes the mesh in a LOCAL frame and keeps the absolute origin
    # in a sidecar, so the OBJ's own numbers are metres from an arbitrary
    # point, not eastings and northings. Comparing them to projected
    # footprints without adding this back finds nothing in common and
    # looks exactly like a coordinate-system mismatch, which is what it
    # is: the mesh is a few hundred metres from the origin and the
    # footprints are half a million.
    off_x = off_y = 0.0
    off_path = Path(a.offset) if a.offset else (
        Path(a.obj).parent.parent / "odm_georeferencing" / "odm_georeferencing_model_geo.txt")
    if off_path.exists():
        lines = [l.strip() for l in off_path.read_text().splitlines() if l.strip()]
        for l in lines:
            parts = l.split()
            if len(parts) == 2:
                try:
                    off_x, off_y = float(parts[0]), float(parts[1])
                    break
                except ValueError:
                    continue
    if not off_x:
        sys.exit(f"No georeferencing offset found at {off_path}. Without it the mesh "
                 "cannot be lined up with the footprints.")
    print(f"georeferencing offset: {off_x:.0f} E, {off_y:.0f} N")

    polys = load_footprints(a.osm)
    if not polys:
        sys.exit(f"No building footprints in {a.osm}")
    if a.pad:
        for p in polys:
            x0, y0, x1, y1 = p["bbox"]
            p["bbox"] = (x0 - a.pad, y0 - a.pad, x1 + a.pad, y1 + a.pad)
    idx, cell = build_index(polys)
    print(f"{len(polys)} building footprints")

    # Pass 1: vertices, and a coarse ground surface.
    verts, vts = [], []
    with open(a.obj) as f:
        for line in f:
            if line.startswith("v "):
                p = line.split()
                verts.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("vt "):
                vts.append(line)
    print(f"{len(verts):,} vertices")

    # Does any footprint actually fall on this mesh?
    #
    # Checked here, before an hour of filtering, because the answer
    # "none" has a completely different cause from every other way this
    # script fails and used to be reported as a coordinate-system
    # mismatch. It was not: the reconstructed box was Billund's runway,
    # which contains no buildings at all, so the clip was working
    # perfectly and correctly keeping nothing. The message sent the
    # search into the projection code for hours.
    #
    # Comparing overall extents is not enough. The mesh box sat well
    # inside the footprint set's overall extent, which made an extent
    # test say "overlap: True" while not one individual building was
    # within 500 m. So this counts footprints on the mesh itself.
    mx = [v[0] + off_x for v in verts]
    my = [v[1] + off_y for v in verts]
    mesh_box = (min(mx), min(my), max(mx), max(my))
    on_mesh = [p for p in polys
               if not (p["bbox"][2] < mesh_box[0] or p["bbox"][0] > mesh_box[2]
                       or p["bbox"][3] < mesh_box[1] or p["bbox"][1] > mesh_box[3])]
    print(f"mesh covers E {mesh_box[0]:.0f}..{mesh_box[2]:.0f}  "
          f"N {mesh_box[1]:.0f}..{mesh_box[3]:.0f}")
    print(f"{len(on_mesh)} of those footprints fall on the mesh")
    if not on_mesh:
        near = min(polys, key=lambda p: (
            max(0, p["bbox"][0] - mesh_box[2], mesh_box[0] - p["bbox"][2]) ** 2 +
            max(0, p["bbox"][1] - mesh_box[3], mesh_box[1] - p["bbox"][3]) ** 2))
        d = math.hypot(
            max(0, near["bbox"][0] - mesh_box[2], mesh_box[0] - near["bbox"][2]),
            max(0, near["bbox"][1] - mesh_box[3], mesh_box[1] - near["bbox"][3]))
        sys.exit(
            f"\nNo building stands on this mesh. The nearest is {d:.0f} m away.\n"
            "The reconstruction covered ground with nothing on it, so there is\n"
            "nothing here to clip to. This is not a coordinate problem: the\n"
            "numbers above are in the same system and the mesh is simply\n"
            "somewhere else.\n\n"
            "Pick the box from the footprints and reconstruct that instead:\n"
            f"    python3 pick_bbox.py --osm {a.osm} --rank 5\n"
            f"    python3 pick_bbox.py --osm {a.osm} --name '<building name>'\n")

    # Local ground height per 20 m cell, taken as a low percentile so a
    # building standing in the cell does not raise its own ground.
    ground = {}
    for x, y, z in verts:
        ground.setdefault((int((x + off_x) // 20), int((y + off_y) // 20)), []).append(z)
    for k, zs in ground.items():
        zs.sort()
        ground[k] = zs[int(len(zs) * 0.15)]

    def ground_at(x, y):
        k = (int(x // 20), int(y // 20))
        if k in ground:
            return ground[k]
        near = [ground[(k[0]+i, k[1]+j)] for i in (-1, 0, 1) for j in (-1, 0, 1)
                if (k[0]+i, k[1]+j) in ground]
        return sum(near) / len(near) if near else None

    # Pass 2: keep faces whose centroid is in a footprint and high enough.
    kept, dropped_out, dropped_low = [], 0, 0
    other = []
    with open(a.obj) as f:
        for line in f:
            if line.startswith("f "):
                parts = line.split()[1:]
                ids = [int(p.split("/")[0]) - 1 for p in parts]
                try:
                    pts = [verts[i] for i in ids]
                except IndexError:
                    continue
                # Local metres to absolute easting/northing. Height is
                # already absolute and needs no offset.
                cx = sum(p[0] for p in pts) / len(pts) + off_x
                cy = sum(p[1] for p in pts) / len(pts) + off_y
                cz = sum(p[2] for p in pts) / len(pts)

                # Footprint first, height second.
                #
                # Order matters only for the diagnostics, and those are
                # the whole value when the result is unexpected. With
                # height first, every triangle over open ground was
                # counted as "too low" and the footprint tally was
                # whatever happened to survive it, so the two numbers
                # could not answer which test was rejecting the mesh.
                # This way "outside" means outside, and "too low" means
                # inside a footprint but sitting at ground level, which
                # is the roof-did-not-reconstruct case the filter is
                # actually there for.
                hits = idx.get((int(cx // cell), int(cy // cell)), ())
                if not any(
                    polys[i]["bbox"][0] <= cx <= polys[i]["bbox"][2]
                    and polys[i]["bbox"][1] <= cy <= polys[i]["bbox"][3]
                    and inside(cx, cy, polys[i]["ring"])
                    for i in hits
                ):
                    dropped_out += 1
                    continue

                g = ground_at(cx, cy)
                if g is not None and (cz - g) < a.min_height:
                    dropped_low += 1
                    continue

                kept.append(line)
            elif not line.startswith(("v ", "vt ", "f ")):
                other.append(line)

    total = len(kept) + dropped_out + dropped_low
    if not kept:
        sys.exit("Nothing kept. Footprints and mesh are probably in different "
                 "coordinate systems, or cover different ground.")

    # Vertices and UVs are written unchanged and faces keep their original
    # indices, so the existing texture atlas still applies with no
    # retexturing and no resampling.
    out = Path(a.out)
    with open(out, "w") as f:
        for line in other:
            if line.startswith(("mtllib", "usemtl", "o ", "g ", "s ")):
                f.write(line)
        for x, y, z in verts:
            f.write(f"v {x} {y} {z}\n")
        for line in vts:
            f.write(line)
        f.writelines(kept)

    print(f"\n{total:,} triangles in")
    print(f"  kept            {len(kept):,} ({100*len(kept)/total:.1f}%)")
    print(f"  outside a building {dropped_out:,}")
    print(f"  below {a.min_height} m      {dropped_low:,}")
    print(f"\nwrote {out}  ({out.stat().st_size/1e6:.1f} MB)")
    print("Texture atlas is unchanged; the .mtl beside the source still applies.")


if __name__ == "__main__":
    main()
