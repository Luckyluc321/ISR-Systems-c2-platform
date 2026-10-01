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
import collections
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


# OSM `building` values that are NOT a walled building.
#
# This matters because walls are generated. `building=roof` means a roof
# on posts with nothing under it: a covered walkway, a drop-off shelter,
# a fuel canopy. Reconstruct its roof, drop walls from the perimeter to
# the ground, and an open shelter becomes a solid block standing in open
# tarmac. Billund's forecourt has eight of them.
#
# The same values are also the ones whose extruded white box is wrong in
# the map to begin with, since a canopy is not a solid volume either.
NOT_A_BUILDING = {
    "roof", "carport", "canopy", "shelter", "bridge",
    "no", "entrance", "tent", "construction", "ruins",
}

# Below this, an OSM way is a bin store, a substation cabinet or a
# mapping artifact. Extruded it is a pillar; reconstructed it is noise.
# Billund has an 11 m2 and a 14 m2 one, both drawn as pillars.
MIN_FOOTPRINT_M2 = 25.0


def ring_area(ring):
    """Shoelace, in square metres. The ring is already projected."""
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def is_solid_building(tags, area_m2):
    """Whether this outline describes a walled building.

    Deliberately a TAG test, not a geographic one. The offenders at
    Billund sit 98 to 322 m from the terminal, interleaved with real
    buildings at 155, 162, 182 and 294 m, so no radius or bounding box
    separates them: a cut tight enough to catch the nearest canopy also
    deletes P4 and three other real buildings. A tag test is exact,
    needs no tuning, and travels to the next site unchanged.

    `amenity=parking` is NOT tested. At Billund it appears only on P2 and
    P4, which are genuine multi-storey decks and among the largest
    buildings on the site. A surface car park carries no `building` tag
    at all, so the Overpass query never returns one.
    """
    b = (tags or {}).get("building")
    if not b or b in NOT_A_BUILDING:
        return False
    if (tags or {}).get("building:part") == "yes":
        return False
    return area_m2 >= MIN_FOOTPRINT_M2


def load_footprints(osm_path):
    """OSM ways tagged building, projected into the mesh's CRS.

    Returns every way, including the ones that are not solid buildings,
    with enough information to decide. Filtering here would break
    export_footprints.py, which zips this list against the raw ways and
    checks the two lengths agree.
    """
    data = json.loads(Path(osm_path).read_text())
    polys = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if el.get("type") != "way" or not geom or len(geom) < 4:
            continue
        ring = [utm32n(p["lon"], p["lat"]) for p in geom]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        tags = el.get("tags") or {}
        area = ring_area(ring)
        polys.append({
            "ring": ring,
            "bbox": (min(xs), min(ys), max(xs), max(ys)),
            "tags": tags,
            "area": area,
            "solid": is_solid_building(tags, area),
        })
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


def near_edge(x, y, ring, pad):
    """True if the point is within pad metres of the outline.

    This is what grows a footprint, and it has to be done here rather
    than by moving the polygon's corners. An OSM footprint is the roof
    outline seen from above, while a reconstructed wall leans outward
    from it: render slightly bulged, eaves overhang, and the wall's
    lower triangles sit a metre or two beyond the line. Testing only
    inside() shaves those off and leaves roofs hanging with no walls
    under them, which is the facade geometry this whole pipeline exists
    to produce.

    Distance to the nearest edge is exact dilation of the polygon by a
    disc, and unlike pushing corners outward it behaves correctly on the
    concave outlines and inner courtyards real buildings have.

    An earlier version grew only the bounding box. The bbox is just the
    grid pre-filter, so that had no effect on the result at all: --pad 0
    and --pad 50 kept an identical face count. Found by changing the
    value and watching nothing happen.
    """
    p2 = pad * pad
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        dx, dy = xj - xi, yj - yi
        d2 = dx * dx + dy * dy
        if d2 < 1e-12:
            t = 0.0
        else:
            t = ((x - xi) * dx + (y - yi) * dy) / d2
            t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
        ex, ey = x - (xi + t * dx), y - (yi + t * dy)
        if ex * ex + ey * ey <= p2:
            return True
        j = i
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--obj", required=True)
    ap.add_argument("--osm", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-height", type=float, default=2.0,
                    help="metres above local ground a triangle must sit to be kept")
    ap.add_argument("--pad", type=float, default=1.5,
                    help="metres to grow each footprint, to keep eaves and wall thickness")
    ap.add_argument("--walls", action="store_true", default=True,
                    help="build vertical walls from the roofline down to ground")
    ap.add_argument("--no-walls", dest="walls", action="store_false",
                    help="roofs only; they will float, photogrammetry puts "
                         "nothing under a roof")
    ap.add_argument("--wall-sink", type=float, default=0.5,
                    help="metres to sink the wall base below local ground")
    ap.add_argument("--wall-reach", type=float, default=4.0,
                    help="metres from a footprint outline within which a "
                         "boundary edge counts as a real perimeter rather "
                         "than the rim of a hole in the roof")
    ap.add_argument("--ground-tolerance", type=float, default=2.5,
                    help="metres a ground cell may differ from its neighbours "
                         "before it is replaced by them")
    ap.add_argument("--min-faces", type=int, default=40,
                    help="drop connected pieces smaller than this; they are "
                         "reconstruction specks, not buildings")
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
    # Only walled buildings get reconstructed. A canopy given generated
    # walls becomes a solid block standing in the open, and a 12 m2 way
    # becomes a pillar.
    dropped_kind = sum(1 for p in polys if not p["solid"])
    polys = [p for p in polys if p["solid"]]
    if not polys:
        sys.exit("No outline in this set is a walled building.")
    if dropped_kind:
        print(f"{dropped_kind} outlines are not walled buildings "
              f"(roof/canopy/shelter, or under {MIN_FOOTPRINT_M2:.0f} m2) and are skipped")
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

    # Ground height per 20 m cell, built ONLY from vertices that are not
    # standing on a building.
    #
    # This is the bug that made every previous attempt look like
    # floating blocks, and it is worth stating plainly.
    #
    # The first version took a low percentile of every vertex in a cell,
    # on the reasoning that a building occupies the top of the
    # distribution and the ground sits underneath it. That holds for a
    # house in a garden. It fails completely in the middle of a large
    # roof: a 20 m cell well inside a 383 m terminal contains NOTHING
    # BUT ROOF, so the percentile returns the roof height, the roof is
    # then not 2 m above its own "ground", and the whole roof is
    # discarded as terrain.
    #
    # What survived was a narrow strip around each building, where a
    # cell happened to span both roof and real ground. 77,355 faces were
    # being thrown away this way, which is why the plan view of the
    # result was building outlines with empty middles, and why the
    # fragments that remained had nothing under them.
    #
    # Ground is terrain, and terrain is by definition where the
    # buildings are not. The footprints already say where that is, so
    # the estimate is built from vertices outside them and then spread
    # across the gaps the buildings leave.
    CELL = 20.0

    # A vertex may speak for the ground only if the KEEP TEST would not
    # have claimed it for a building. Same predicate, pad included.
    #
    # Using bare inside() here while keeping on inside() OR near_edge()
    # let every roof vertex in the 1.5 m pad band count as both. An
    # OpenStreetMap outline is simplified, so it routinely cuts across a
    # real roof, and the sliver left outside the line became "terrain"
    # at roof height. Measured worst cell at Billund: 92 samples, every
    # one of them roof at 111.2-113.0 m and all within 2.2 m of the
    # outline, giving a ground of 111.80 m where the truth is 94.63 m.
    # Everything under that was then deleted for not clearing it by 2 m.
    def on_building(ax, ay):
        hits = idx.get((int(ax // cell), int(ay // cell)), ())
        return any(
            inside(ax, ay, polys[i]["ring"])
            or (a.pad and near_edge(ax, ay, polys[i]["ring"], a.pad))
            for i in hits
        )

    off = [(x + off_x, y + off_y, z) for x, y, z in verts
           if not on_building(x + off_x, y + off_y)]
    if not off:
        sys.exit("No vertex outside a footprint, so ground cannot be estimated. "
                 "The box is almost certainly wrong.")

    # Drop the underside of the shell.
    #
    # The reconstruction is a closed Poisson surface, so it wraps
    # underneath and carries vertices far below the terrain: 5,350 below
    # 80 m here, down to -128 m. A low percentile per cell lands on that
    # underside rather than on the ground, pulling cells to 78 m and
    # then letting the underside itself pass the height test. One such
    # slab rendered 16 m below ground.
    zs_all = sorted(p[2] for p in off)
    floor = zs_all[int(len(zs_all) * 0.01)] - 1.0
    off = [p for p in off if p[2] >= floor]

    ground_src = {}
    for ax, ay, z in off:
        ground_src.setdefault((int(ax // CELL), int(ay // CELL)), []).append(z)
    ground = {}
    for k, zs in ground_src.items():
        zs.sort()
        ground[k] = zs[int(len(zs) * 0.15)]

    # Reject cells that disagree with their neighbours.
    #
    # Terrain is continuous. A cell sitting metres above the ground
    # around it is not a hill, it is a surviving piece of building, and
    # it is better replaced by what its neighbours say than trusted.
    med = {}
    for k in ground:
        near = [ground[(k[0] + i, k[1] + j)]
                for i in (-1, 0, 1) for j in (-1, 0, 1)
                if (i or j) and (k[0] + i, k[1] + j) in ground]
        if near:
            near.sort()
            med[k] = near[len(near) // 2]
    fixed = 0
    for k, m in med.items():
        if abs(ground[k] - m) > a.ground_tolerance:
            ground[k] = m
            fixed += 1

    # Spread outward into the cells the buildings cover. Nearest
    # measured cell wins, which over a building means its surroundings.
    filled, frontier = dict(ground), list(ground)
    for _ in range(40):                   # 40 cells = 800 m, ample
        nxt = []
        for (cx_, cy_) in frontier:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    k = (cx_ + dx, cy_ + dy)
                    if k not in filled:
                        filled[k] = filled[(cx_, cy_)]
                        nxt.append(k)
        if not nxt:
            break
        frontier = nxt
    ground = filled
    gz = sorted(ground_src)
    print(f"ground model: {len(ground_src)} cells measured off-building "
          f"(floor {floor:.1f} m), {fixed} rejected against neighbours, "
          f"{len(ground) - len(ground_src)} filled across buildings")
    vals = sorted(ground[k] for k in gz)
    print(f"  measured ground spans {vals[0]:.1f} .. {vals[-1]:.1f} m, "
          f"median {vals[len(vals) // 2]:.1f} m")

    def ground_at(x, y):
        """Bilinear between cell centres.

        A per-cell lookup is a step function, and across neighbouring
        20 m cells the step reached 16 m. Every building was then cut at
        a different arbitrary height cell by cell, which punched
        rectangular holes through roofs and hung a short wall curtain
        from each hole rim. Those rims are the blocks in the air.
        """
        fx = x / CELL - 0.5
        fy = y / CELL - 0.5
        i, j = math.floor(fx), math.floor(fy)
        tx, ty = fx - i, fy - j
        acc = w = 0.0
        for di, dj, wt in ((0, 0, (1 - tx) * (1 - ty)), (1, 0, tx * (1 - ty)),
                           (0, 1, (1 - tx) * ty), (1, 1, tx * ty)):
            v = ground.get((i + di, j + dj))
            if v is not None and wt > 0:
                acc += v * wt
                w += wt
        return acc / w if w else None

    # Pass 2: keep faces whose centroid is in a footprint and high enough.
    kept, dropped_out, dropped_low = [], 0, 0
    kept_ids = []          # vertex indices per kept face, for the island pass
    vt_of = {}             # vertex index -> a texture index seen with it
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
                    and (inside(cx, cy, polys[i]["ring"])
                         or (a.pad and near_edge(cx, cy, polys[i]["ring"], a.pad)))
                    for i in hits
                ):
                    dropped_out += 1
                    continue

                g = ground_at(cx, cy)
                if g is not None and (cz - g) < a.min_height:
                    dropped_low += 1
                    continue

                kept.append(line)
                kept_ids.append(ids)
                # Remember one texture coordinate per vertex, so a wall
                # built off a roof edge can borrow the roof's own colour
                # there instead of needing a second material.
                for p, vi in zip(parts, ids):
                    bits = p.split("/")
                    if len(bits) > 1 and bits[1] and vi not in vt_of:
                        vt_of[vi] = int(bits[1]) - 1
            elif not line.startswith(("v ", "vt ", "f ")):
                other.append(line)

    total = len(kept) + dropped_out + dropped_low
    if not kept:
        # Footprints were confirmed standing on this mesh further up, so
        # this is not the empty-box case and definitely not a coordinate
        # one. Both remaining causes are tuning, and the two tallies say
        # which.
        sys.exit(
            f"\nNothing kept out of {total:,} triangles.\n"
            f"  {dropped_out:,} fell outside every footprint\n"
            f"  {dropped_low:,} were inside one but under {a.min_height} m\n\n"
            # Deliberately NOT guessing which filter is at fault.
            #
            # The counts cannot tell them apart. "Outside" outnumbers
            # "too low" in every mesh, because most of any reconstruction
            # is open ground, so comparing the two always blames
            # position. And a non-zero "too low" does not prove height
            # is the problem either: ground inside a footprint lands
            # there legitimately while the actual roof was rejected on
            # position a step earlier.
            #
            # Every heuristic tried here was wrong on one of the two
            # real cases. A confident wrong diagnosis is what made the
            # original failure expensive, so this prints both remedies
            # and leaves the choice to whoever can look at the mesh.
            + ("Both filters are candidates and the counts cannot separate "
               "them:\n\n"
               f"  If the roofs reconstructed but sit low, raise nothing and "
               f"loosen height:\n      --min-height 1.0   (now {a.min_height})\n"
               "      Check VERTICAL_DATUM.txt first; DVR90 against ellipsoidal "
               "is ~37 m.\n\n"
               f"  If the geometry is slightly offset from the footprints, "
               f"widen the pad:\n      --pad 5   (now {a.pad})\n\n"
               "  Open the mesh in preview.html and look. That settles it in "
               "seconds\n  and neither number will.\n"))

    # ── Pass 3: throw away islands ──────────────────────────────────
    #
    # Everything above decides one triangle at a time, and a triangle
    # has no way of knowing it is part of a building rather than a
    # fragment of noise sitting over a car park. Two things get through:
    #
    #   Specks. Photogrammetry leaves small blobs of geometry in open
    #   air. 44 of them survived at Billund, averaging four triangles
    #   each. On screen they are stones scattered over nothing.
    #
    #   Whole islands living in the --pad ring. Padding exists so that a
    #   wall leaning out past the roof outline is kept, and that is right
    #   when the wall belongs to the building. It is wrong when a patch
    #   of ground just outside a footprint is kept purely because it fell
    #   within the pad. One such patch at Billund was 17 x 65 m of tarmac
    #   at ground level, outside every outline.
    #
    # Both are answered by looking at a connected surface rather than a
    # triangle. A building is one connected thing whose body is inside
    # its outline; a speck is too small to be a building, and an island
    # whose own centre is outside every footprint is not a wall of
    # anything.
    #
    # Deliberately NOT a height test. The obvious rule, drop whatever
    # does not reach down near the ground, is wrong here: the height
    # filter already removed the bottom two metres of every building, so
    # the terminal's own kept geometry starts about nine metres up and a
    # base-height rule would delete the building it is meant to protect.
    parent = list(range(len(verts)))

    def _find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for ids in kept_ids:
        r0 = _find(ids[0])
        for i in ids[1:]:
            ri = _find(i)
            if ri != r0:
                parent[ri] = r0

    members = {}
    for n, ids in enumerate(kept_ids):
        members.setdefault(_find(ids[0]), []).append(n)

    drop = set()
    dropped_small = dropped_island = 0
    comp_vt = {}        # component root -> one texture coordinate from its roof
    for root, face_ns in members.items():
        for n in face_ns:
            t = next((vt_of[v] for v in kept_ids[n] if v in vt_of), None)
            if t is not None:
                comp_vt[root] = t
                break
    for face_ns in members.values():
        if len(face_ns) < a.min_faces:
            drop.update(face_ns)
            dropped_small += len(face_ns)
            continue
        # The island's own centre, tested strictly: no pad. A real
        # building's centre is well inside its outline, so this only
        # bites on something that exists because of the pad.
        pts = [verts[i] for n in face_ns for i in kept_ids[n]]
        cx = sum(p[0] for p in pts) / len(pts) + off_x
        cy = sum(p[1] for p in pts) / len(pts) + off_y
        hits = idx.get((int(cx // cell), int(cy // cell)), ())
        if not any(inside(cx, cy, polys[i]["ring"]) for i in hits):
            drop.update(face_ns)
            dropped_island += len(face_ns)

    if drop:
        kept = [l for n, l in enumerate(kept) if n not in drop]
        kept_ids = [ids for n, ids in enumerate(kept_ids) if n not in drop]
    print(f"  islands: dropped {dropped_small:,} faces in specks under "
          f"{a.min_faces} faces, {dropped_island:,} faces in patches whose "
          f"centre is outside every footprint")
    if not kept:
        sys.exit("Island filtering removed everything. --min-faces is probably "
                 "too high for this mesh's density.")

    # ── Pass 4: build the walls ─────────────────────────────────────
    #
    # Without this every building is a roof with nothing holding it up.
    #
    # Photogrammetry only reconstructs what a camera can see, and nobody
    # can see inside a building, so there is no geometry under a roof at
    # all. The sides do get reconstructed, but as a skirt that flares
    # OUTWARD from the roof edge down to the ground. Measured on the
    # Billund terminal, by height above ground against distance from the
    # outline:
    #
    #            inside>3m  edge -3..0  pad 0..1.5  ring 1.5..5  outside>5
    #     9-15m      7,365       3,190       1,480        2,139      2,608
    #      5-9m        210         349         503        2,490     10,642
    #      2-5m         47         118          85          515     55,568
    #
    # Inside the footprint there is NOTHING between the ground and 9 m.
    # Everything connecting roof to ground is more than 5 m outside the
    # outline, mixed in with the tarmac, so clipping to the footprint
    # correctly discards it and correctly leaves a slab in the air.
    #
    # Widening the pad to catch the skirt is not the answer: at 2-5 m up
    # the ring beyond 5 m is 55,568 vertices, nearly all of it ground.
    # That trades floating roofs for a collar of tarmac around every
    # building.
    #
    # So the wall is generated. Every edge on the boundary of the kept
    # surface gets a vertical quad down to local ground, which is exactly
    # the outline the white box was extruding anyway, except now it is
    # the real roofline carrying real roof imagery.
    #
    # The wall borrows the texture coordinate of the roof edge above it,
    # stretched down. That is an approximation, not a facade: these are
    # near-vertical surfaces photographed from above, so there is no
    # facade imagery in the atlas to use. It reads as the building's own
    # colour rather than as a grey block, and it needs no second
    # material.
    walls_added = 0
    if a.walls:
        edge_count = collections.Counter()
        for ids in kept_ids:
            n = len(ids)
            for i in range(n):
                v1, v2 = ids[i], ids[(i + 1) % n]
                edge_count[(v1, v2) if v1 < v2 else (v2, v1)] += 1

        # An edge shared by two triangles is interior. An edge used once
        # is where the surface stops.
        #
        # But "where the surface stops" is two different things, and
        # only one of them is a wall. The outer roofline is a wall. The
        # rim of a HOLE in the middle of a roof, left where the
        # reconstruction failed, is not: a curtain dropped from it hangs
        # inside the building and shows through the gap as a flat
        # coloured smear lying across the roof.
        #
        # 545 of 3,397 boundary edges at Billund were hole rims, giving
        # 2,180 wall faces, 16 per cent of all walls, every one of them
        # an artifact on top of a building rather than a side of one.
        #
        # A real perimeter follows the footprint outline, so that is the
        # test. A hole in the middle of a roof is nowhere near it.
        all_boundary = [e for e, c in edge_count.items() if c == 1]
        boundary, holes = [], 0
        for e in all_boundary:
            mx = (verts[e[0]][0] + verts[e[1]][0]) / 2 + off_x
            my = (verts[e[0]][1] + verts[e[1]][1]) / 2 + off_y
            hits = idx.get((int(mx // cell), int(my // cell)), ())
            if any(near_edge(mx, my, polys[i]["ring"], a.wall_reach) for i in hits):
                boundary.append(e)
            else:
                holes += 1

        for v1, v2 in boundary:
            x1, y1, z1 = verts[v1]
            x2, y2, z2 = verts[v2]
            g1 = ground_at(x1 + off_x, y1 + off_y)
            g2 = ground_at(x2 + off_x, y2 + off_y)
            if g1 is None or g2 is None:
                continue
            # Sink it slightly so the wall meets terrain instead of
            # hovering a few centimetres over it.
            b1 = g1 - a.wall_sink
            b2 = g2 - a.wall_sink
            if z1 - b1 < 0.5 and z2 - b2 < 0.5:
                continue
            i1 = len(verts); verts.append((x1, y1, b1))
            i2 = len(verts); verts.append((x2, y2, b2))

            # ONE texture coordinate for the whole wall, shared by all
            # four corners, taken from this building's own roof.
            #
            # The obvious thing is to give each wall corner the texture
            # coordinate of the roof vertex above it, stretched down.
            # That produced a 2.6 GB tileset from a 7.6 MB one.
            #
            # A texture atlas is not laid out spatially: two vertices
            # that are neighbours along a roofline can sit at opposite
            # ends of it. A wall triangle spanning that distance covers
            # an enormous area of the atlas, and Obj2Tiles crops the
            # texture to the area its tile's faces touch, so nearly
            # every tile ended up cropping nearly the whole atlas.
            #
            # Collapsing the wall to a single texel makes it one flat
            # colour, sampled from the roof it hangs under, so each
            # building's walls match that building. There is no facade
            # imagery to use anyway: these surfaces were photographed
            # from above.
            # `or` would reject texture index 0, which is legitimate.
            t = comp_vt.get(_find(v1))
            if t is None:
                t = vt_of.get(v1)
            if t is None:
                t = vt_of.get(v2)
            if t is None:
                continue
            vt_of[i1] = t
            vt_of[i2] = t

            def tok(v, _t=t):
                return f"{v + 1}/{_t + 1}"

            # Both windings.
            #
            # Which way a wall faces depends on the winding of the roof
            # triangle its edge came from, and a clipped surface has no
            # guarantee of consistent winding. Emitting both is two
            # triangles where one would do, on a part of the mesh that is
            # a few per cent of it, and removes the possibility of a
            # building whose walls are invisible from outside because
            # they were all culled.
            for tri in ((v1, v2, i2), (v1, i2, i1), (v2, v1, i1), (v2, i1, i2)):
                kept.append("f " + " ".join(tok(v) for v in tri) + "\n")
                kept_ids.append(list(tri))
                walls_added += 1
        print(f"  walls: {len(boundary):,} perimeter edges -> {walls_added:,} faces "
              f"({holes:,} hole rims left open)")

    # Keep only the vertices and texture coordinates the surviving faces
    # actually reference, and renumber them.
    #
    # Writing all of them was simpler and kept every face index valid,
    # but it means a file of 42,450 triangles carrying 798,779 vertices,
    # 95 per cent of which nothing points at. That is 72 MB where 4 MB
    # would do, and the tiler then walks all of it.
    #
    # UV VALUES ARE UNTOUCHED, only renumbered, so the existing texture
    # atlas still applies with no retexturing and no resampling.
    #
    # ODM writes faces as v/vt/vn while emitting no vn lines at all, so
    # the third index refers to nothing. It is dropped rather than
    # carried forward.
    v_new, vt_new, faces_out = {}, {}, []
    for line in kept:
        toks = []
        for part in line.split()[1:]:
            bits = part.split("/")
            vi = int(bits[0]) - 1
            if vi not in v_new:
                v_new[vi] = len(v_new) + 1
            if len(bits) > 1 and bits[1]:
                ti = int(bits[1]) - 1
                if ti not in vt_new:
                    vt_new[ti] = len(vt_new) + 1
                toks.append(f"{v_new[vi]}/{vt_new[ti]}")
            else:
                toks.append(str(v_new[vi]))
        faces_out.append("f " + " ".join(toks) + "\n")

    out = Path(a.out)
    with open(out, "w") as f:
        for line in other:
            if line.startswith(("mtllib", "usemtl", "o ", "g ", "s ")):
                f.write(line)
        # Insertion order is the new numbering, so these two loops must
        # stay in the order the faces first referenced them.
        for old in v_new:
            x, y, z = verts[old]
            f.write(f"v {x} {y} {z}\n")
        for old in vt_new:
            f.write(vts[old])
        f.writelines(faces_out)

    print(f"\n{total:,} triangles in")
    print(f"  kept            {len(kept):,} ({100*len(kept)/total:.1f}%)")
    print(f"  outside a building {dropped_out:,}")
    print(f"  below {a.min_height} m      {dropped_low:,}")
    print(f"\nwrote {out}  ({out.stat().st_size/1e6:.1f} MB)")
    print("Texture atlas is unchanged; the .mtl beside the source still applies.")


if __name__ == "__main__":
    main()
