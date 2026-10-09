#!/usr/bin/env python3
"""
Build textured building solids for a whole site.

Geometry from OpenStreetMap footprints, height from Danmarks
Højdemodel, roof texture photographed out of skraafoto. No
reconstruction anywhere: every surface is placed from data that already
exists and then painted from a photograph that already exists.

Per building:

    outline     OSM way, projected to EPSG:25832
    ground      DHM/Terraen, median inside the outline
    roof        DHM/Overflade, high percentile inside the outline
    roof faces  the outline triangulated, laid flat at roof height
    roof pixels orthorectified from the nadir frame that looks most
                directly down at it
    wall faces  the outline extruded from roof down to ground

Walls carry one flat colour per building, sampled from that building's
own roof, until the oblique pass textures them properly. That is a
placeholder and it is the weakest part of the output; it is also exactly
what the white box already does, so it is not a regression.

Output is an OBJ plus one texture atlas, which feeds the chain that
already works:

    python3 to_yup.py --in site.obj --out site_yup.obj
    Obj2Tiles ... site_yup.obj
    python3 unlit_tiles.py --tiles ...

Usage:
    python3 drape_site.py --poses work/billund-airport/poses.json \
        --osm /tmp/osm_buildings.json --dhm work/dhm \
        --bbox 9.1228,55.7329,9.1718,55.7479 \
        --out work/billund-airport/drape --gsd 0.12
"""

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from camera import load_frames                                   # noqa: E402
from clip_to_buildings import utm32n, inside, is_solid_building, ring_area  # noqa: E402
from dhm import DHM, roof_height                                 # noqa: E402

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required:  python3 -m pip install Pillow")

Image.MAX_IMAGE_PIXELS = None


# ── geometry ────────────────────────────────────────────────────────
def _inv_utm32n(x, y):
    """EPSG:25832 back to WGS84 lon/lat.

    The inverse of utm32n in clip_to_buildings, needed only to tell
    Obj2Tiles where the local origin sits.
    """
    a, f_ = 6378137.0, 1 / 298.257223563
    e2 = f_ * (2 - f_)
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    k0, E0, lon0 = 0.9996, 500000.0, math.radians(9.0)
    M = y / k0
    mu = M / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256))
    phi1 = (mu + (3*e1/2 - 27*e1**3/32) * math.sin(2*mu)
            + (21*e1**2/16 - 55*e1**4/32) * math.sin(4*mu)
            + (151*e1**3/96) * math.sin(6*mu))
    ep2 = e2 / (1 - e2)
    C1 = ep2 * math.cos(phi1) ** 2
    T1 = math.tan(phi1) ** 2
    N1 = a / math.sqrt(1 - e2 * math.sin(phi1) ** 2)
    R1 = a * (1 - e2) / (1 - e2 * math.sin(phi1) ** 2) ** 1.5
    D = (x - E0) / (N1 * k0)
    lat = phi1 - (N1 * math.tan(phi1) / R1) * (
        D*D/2 - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*ep2) * D**4/24
        + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*ep2 - 3*C1*C1) * D**6/720)
    lon = lon0 + (D - (1 + 2*T1 + C1) * D**3/6
                  + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*ep2 + 24*T1*T1) * D**5/120
                  ) / math.cos(phi1)
    return math.degrees(lon), math.degrees(lat)


def signed_area(ring):
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def triangulate(ring):
    """Ear clipping, returning indices numbered against the ring AS GIVEN.

    A fan from the centroid is wrong here: real footprints are concave,
    an L-shaped terminal most of all, and a fan puts triangles outside
    the building. Ear clipping handles any simple polygon and these are
    small enough that its cost does not matter.

    Ear clipping needs a counter-clockwise polygon, so a clockwise one is
    reversed first. Returning indices into that reversed copy, while the
    caller wrote its vertices in the original order, scrambles every
    triangle. 138 of 232 footprints at Billund are clockwise, so roughly
    sixty per cent of the roofs were built from the wrong three corners:
    triangulated area came out 1.293 times the polygon area, hard
    triangles appeared across open ground, and the gaps let the dark wall
    colour show through the roof.

    `order` carries the mapping back, so the caller never has to know
    which way its ring was wound.
    """
    pts = list(ring)
    order = list(range(len(pts)))
    if signed_area(pts) < 0:
        pts.reverse()
        order.reverse()
    idx = list(range(len(pts)))
    out = []
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        clipped = False
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = pts[i0], pts[i1], pts[i2]
            cross = (b[0]-a[0]) * (c[1]-a[1]) - (b[1]-a[1]) * (c[0]-a[0])
            if cross <= 0:
                continue                      # reflex, not an ear
            if any(_in_tri(pts[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue                      # something inside it
            out.append((order[i0], order[i1], order[i2]))
            idx.pop(k)
            clipped = True
            break
        if not clipped:
            break
    if len(idx) == 3:
        out.append(tuple(order[i] for i in idx))
    return out


def roof_relief(surf, terr, ring, top, ground, inset=2.5, radius=1.5,
                pct=0.90):
    """A height per outline vertex, instead of one height for the roof.

    The flat roof is right for a house and wrong for a terminal. Billund
    Lufthavn is one 379 m polygon holding two buildings: a three-level
    departure hall at 17-20 m and a single-level gate pier at 10-13 m.
    The height model shows them as two clean modes. Laid flat at the
    80th percentile the whole thing becomes one 18.2 m slab, so the
    pier stands six metres too tall and the building has no shape.

    This samples the surface model near each vertex of the outline and
    gives that vertex its own height. The walls need no change at all:
    they already extrude from the roof ring down to ground, so moving a
    roof vertex moves the wall under it.

    Only the outline is sampled, not the interior, so a step inside the
    polygon becomes a ramp across it rather than a wall. For a long thin
    pier that is nearly right, because every interior point is close to
    an edge. For a courtyard block it would not be, which is one reason
    this is opt-in by area rather than on for everything.

    Two guards, both learned the hard way on this data:

    INSET ALONG THE INWARD BISECTOR, NOT TOWARD THE CENTROID. A vertex
    sits ON the outline, where the height model is half roof and half
    the ground beside it, so the sample point has to be pulled inside
    first. The obvious direction is the centroid, and it is wrong: this
    polygon is 379 m long and L-shaped, so its centroid is not inside
    the part most vertices belong to. Pulling a hall corner "toward the
    centroid" walks it off the hall. Measured, that sank 11 of 71
    vertices onto bare ground and left only 9 reaching the hall, against
    a height model that says 38% of the roof is up there. The bisector
    of the two edges meeting at the vertex points into the building
    whatever shape it is.

    REJECT SAMPLES THAT ARE NOT ROOF. A sample below ground plus a floor
    height is the ground beside the building, not a one-metre roof.
    Those are discarded rather than averaged in, and if too few roof
    samples survive, the vertex falls back to the building's own flat
    height. Guessing low is worse than not guessing: a clamped vertex
    drags a wall and a roof triangle down with it.

    A HIGH PERCENTILE OF THE LOCAL DISC, not its median. The sample
    point sits near the roof edge, and on a curved or stepped roof the
    edge is the lowest part of it: Billund's departure hall rises north
    to south, so its eaves read 2-3 m under its ridge. The median of the
    disc picks the falloff, the 90th picks the roof. Swept on this
    building, 0.90 put 16 of 71 vertices into the hall band against 3 at
    the median, with no low outliers either way.

    CLAMP. One tree leaning over a parapet, or a gap in the roof, would
    otherwise spike a corner. Every vertex is held inside the band the
    building already measured, so relief can reshape a roof but never
    invent a height the building does not have.
    """
    # WHAT THE BUILDING ACTUALLY HAS, measured inside it, before
    # touching a single vertex. Two things come out of this and both are
    # guards that were missing:
    #
    #   Is it multi-level at all? Relief is for one polygon holding
    #   buildings of different heights. A single-level hall does not need
    #   it and is actively harmed by it: the edge samples catch parapets,
    #   loading bays and lower adjoining wings, and the roof ends up
    #   warped across its own span. Measured on Billund airport, 2 of 9
    #   relieved footprints were single-level and came out wrong, the
    #   worst running 4.1 to 19.4 m on an 18.9 m building.
    #
    #   How low may a vertex go? The old floor was ground plus a metre,
    #   which is not a bound at all — it let a roof dive almost to the
    #   pavement and took its walls down with it, which is what a hollow
    #   building looks like. The honest bound is the building's own lower
    #   level, so relief can express the steps a building has and cannot
    #   invent one it does not.
    xs_r = [p[0] for p in ring]
    ys_r = [p[1] for p in ring]
    interior = []
    yy = min(ys_r)
    while yy <= max(ys_r):
        xx = min(xs_r)
        while xx <= max(xs_r):
            if inside(xx, yy, ring):
                sv = surf.at(xx, yy)
                if sv is not None:
                    interior.append(sv - ground)
            xx += 2.0
        yy += 2.0
    if len(interior) < 20:
        return [top] * len(ring)
    interior.sort()
    p20 = interior[int(len(interior) * 0.20)]
    p80 = interior[int(len(interior) * 0.80)]
    if p80 - p20 < 3.0:
        # One level. Leave it flat; relief here can only make it worse.
        return [top] * len(ring)

    n = len(ring)
    ccw = signed_area(ring) > 0
    lo, hi = ground + p20, top + 0.5
    floor = ground + max(2.0, p20 * 0.5)   # below this it is not this roof
    out = []
    for i, (px, py) in enumerate(ring):
        ax, ay = ring[i - 1]
        bx, by = ring[(i + 1) % n]
        nx, ny = 0.0, 0.0
        for (x0, y0), (x1, y1) in (((ax, ay), (px, py)), ((px, py), (bx, by))):
            dx, dy = x1 - x0, y1 - y0
            d = math.hypot(dx, dy)
            if not d:
                continue
            # Interior is left of the edge on a counter-clockwise ring.
            nx += (-dy / d) if ccw else (dy / d)
            ny += (dx / d) if ccw else (-dx / d)
        d = math.hypot(nx, ny)
        if not d:
            out.append(top)
            continue
        sx, sy = px + nx / d * inset, py + ny / d * inset
        vals, tried = [], 0
        for ox in (-radius, 0.0, radius):
            for oy in (-radius, 0.0, radius):
                v = surf.at(sx + ox, sy + oy)
                tried += 1
                if v is not None and v >= floor:
                    vals.append(v)
        # Fewer than half the samples look like roof: this vertex is over
        # a gap, a courtyard or the edge. Do not guess it low.
        if len(vals) * 2 < tried:
            out.append(top)
            continue
        vals.sort()
        out.append(min(hi, max(lo, vals[min(len(vals) - 1, int(len(vals) * pct))])))
    return out


def subdivide_roof(ring, tris, surf, ground, top, max_edge=5.0, max_depth=4):
    """Give a roof the shape the height model already knows it has.

    The flat plate is the single biggest thing wrong with the output and
    it is not a data problem. Lalandia Billund renders as one surface at
    13.7 m; the LiDAR across that same footprint runs from 3 m to over
    10 m in clean rectangular blocks, with the dome plainly visible at
    0.4 m resolution. The pipeline measures one number per building and
    throws the rest away.

    This keeps the ear-clipped triangulation and splits each triangle at
    its edge midpoints until no edge is longer than max_edge, giving
    every new vertex its own height from the surface model.

    SUBDIVISION, NOT A GRID. A regular grid clipped to the outline leaves
    ragged gaps along every edge, and filling them means a constrained
    triangulation. Splitting the triangles that already exist keeps the
    footprint covered exactly once — the permanent area gate still holds
    — and leaves the ring vertices untouched, so the walls that hang off
    them need no change at all.

    Midpoints are shared between neighbouring triangles through `mid`,
    so the surface is watertight. Without that cache each triangle gets
    its own copy of a shared edge, the two sides drift apart by whatever
    the height model says, and the roof cracks along every seam.

    Clamped to the building's own measured range for the same reason
    roof_relief is: one tree leaning over a parapet should not spike a
    roof, and a gap in the model should not hole it.
    """
    pts = [(x, y, None) for (x, y) in ring]       # heights filled below
    mid = {}

    lo_hi = []
    for (x, y) in ring:
        v = surf.at(x, y)
        if v is not None:
            lo_hi.append(v - ground)
    # A reading barely above the terrain is not a low roof, it is a
    # courtyard, a light well, or a gap in the model. Clamping it up to a
    # floor still puts a vertex metres below its neighbours and craters
    # the roof. Treating it as no-data and taking the parent midpoint
    # instead leaves the surface continuous, which is the honest answer:
    # we do not know what is there, so do not invent a hole.
    #
    # Measured on Lalandia: 181 of 8,062 vertices read below this, 2.2%,
    # every one of which would have been a dent.
    not_roof = ground + 2.0
    ceil = top + 0.5

    def height(x, y, fallback):
        v = surf.at(x, y)
        if v is None or v < not_roof:
            return fallback
        return min(ceil, v)

    # Ring vertices fall back to the building's flat height. They carry
    # the walls, so a crater here drags a wall down with it.
    for i, (x, y) in enumerate(ring):
        pts[i] = (x, y, height(x, y, top))

    def midpoint(a, b):
        key = (a, b) if a < b else (b, a)
        if key in mid:
            return mid[key]
        ax, ay, az = pts[a]
        bx, by, bz = pts[b]
        mx, my = (ax + bx) / 2.0, (ay + by) / 2.0
        pts.append((mx, my, height(mx, my, (az + bz) / 2.0)))
        mid[key] = len(pts) - 1
        return mid[key]

    def edge_len(a, b):
        return math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])

    out = list(tris)
    for _ in range(max_depth):
        nxt = []
        split_any = False
        for (i0, i1, i2) in out:
            if max(edge_len(i0, i1), edge_len(i1, i2), edge_len(i2, i0)) <= max_edge:
                nxt.append((i0, i1, i2))
                continue
            split_any = True
            m01, m12, m20 = midpoint(i0, i1), midpoint(i1, i2), midpoint(i2, i0)
            nxt += [(i0, m01, m20), (m01, i1, m12),
                    (m20, m12, i2), (m01, m12, m20)]
        out = nxt
        if not split_any:
            break
    return pts, out


def _in_tri(p, a, b, c):
    d1 = (p[0]-b[0])*(a[1]-b[1]) - (a[0]-b[0])*(p[1]-b[1])
    d2 = (p[0]-c[0])*(b[1]-c[1]) - (b[0]-c[0])*(p[1]-c[1])
    d3 = (p[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(p[1]-a[1])
    neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (neg and pos)


# ── texture ─────────────────────────────────────────────────────────
def open_level(path, want_px):
    """Smallest pyramid level still at or above want_px wide."""
    im = Image.open(path)
    levels = []
    for page in range(getattr(im, "n_frames", 1)):
        try:
            im.seek(page)
            levels.append((page, im.size[0]))
        except Exception:
            break
    usable = [(p, w) for p, w in levels if w >= want_px] or levels
    page = min(usable, key=lambda t: t[1])[0]
    for pg in [page] + [p for p, _ in sorted(levels, key=lambda t: -t[1])]:
        try:
            im.seek(pg)
            return im.convert("RGB"), im.size[0]
        except Exception:
            continue
    raise OSError(f"no decodable level in {path}")


def best_frame(frames, ring, z, normal=(0.0, 0.0, 1.0)):
    corners = [(x, y, z) for x, y in ring]
    centre = (sum(p[0] for p in ring) / len(ring),
              sum(p[1] for p in ring) / len(ring), z)
    cands = [(f.incidence(centre, normal), f) for f in frames
             if all(f.sees(c, margin=40) for c in corners)]
    if not cands:
        return None, 0.0
    inc, f = max(cands, key=lambda t: t[0])
    return f, inc


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--poses", required=True)
    ap.add_argument("--osm", required=True)
    ap.add_argument("--dhm", required=True)
    ap.add_argument("--bbox", required=True, help="minLon,minLat,maxLon,maxLat")
    ap.add_argument("--exclude-bbox", action="append", default=[],
                    help="skip footprints whose centre falls in this box; "
                         "repeatable. For ground already covered by another "
                         "build, so the two tilesets do not draw the same "
                         "building twice")
    ap.add_argument("--images", default=None)
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--gsd", type=float, default=0.12, help="texture metres per pixel")
    ap.add_argument("--min-height", type=float, default=2.0,
                    help="skip anything standing lower than this")
    ap.add_argument("--roof-grid", type=float, default=0.0, metavar="M2",
                    help="give every footprint at least this large a roof "
                         "SURFACE sampled from the height model, instead of "
                         "one flat plate. OFF by default (0), and off is "
                         "byte-identical to before it existed. This is what "
                         "makes a complex read as a building rather than a "
                         "slab; it costs triangles, so gate it at the sizes "
                         "people actually zoom into")
    ap.add_argument("--roof-grid-edge", type=float, default=5.0, metavar="M",
                    help="longest roof triangle edge once subdivided "
                         "(default 5 m). Smaller is more faithful and more "
                         "triangles")
    ap.add_argument("--roof-relief", type=float, default=0.0, metavar="M2",
                    help="give every footprint at least this large a height "
                         "per outline vertex instead of one flat roof. OFF by "
                         "default (0), and off means byte-identical output to "
                         "before this existed. 5000 catches terminals, "
                         "factories and anything with wings at different "
                         "heights; below that a flat roof is right and cheaper")
    ap.add_argument("--wall-gsd", type=float, default=0.20,
                    help="wall texture metres per pixel. Coarser than the "
                         "roof on purpose: a wall is always seen at an angle "
                         "and it is most of the atlas area")
    ap.add_argument("--atlas-max", type=int, default=8192)
    a = ap.parse_args()

    bbox = tuple(float(v) for v in a.bbox.split(","))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    surf = DHM(a.dhm, "dhm_overflade")
    terr = DHM(a.dhm, "dhm_terraen")
    frames = load_frames(a.poses)
    img_dir = Path(a.images) if a.images else Path(a.poses).parent / "images"
    print(f"{len(frames)} frames, {len(surf.tiles)} surface tiles, "
          f"{len(terr.tiles)} terrain tiles")

    excl = [tuple(float(v) for v in e.split(",")) for e in a.exclude_bbox]
    n_excluded = 0
    doc = json.loads(Path(a.osm).read_text())
    cands = []
    for el in doc.get("elements", []):
        g = el.get("geometry")
        if el.get("type") != "way" or not g or len(g) < 4:
            continue
        clon = sum(p["lon"] for p in g) / len(g)
        clat = sum(p["lat"] for p in g) / len(g)
        if not (bbox[0] <= clon <= bbox[2] and bbox[1] <= clat <= bbox[3]):
            continue
        if any(x[0] <= clon <= x[2] and x[1] <= clat <= x[3] for x in excl):
            n_excluded += 1
            continue
        ring = [utm32n(p["lon"], p["lat"]) for p in g]
        if ring[0] == ring[-1]:
            ring.pop()
        if len(ring) < 3:
            continue
        tags = el.get("tags") or {}
        # Counter-clockwise, always.
        #
        # Wall normals are derived from edge direction, so the winding
        # decides which way every wall faces. 138 of 232 Billund
        # footprints are clockwise, and on those every outward normal
        # would point into the building, so each wall would be matched
        # with a camera on the far side and painted with the view through
        # the building.
        if signed_area(ring) < 0:
            ring.reverse()
        # `building=roof` is a canopy: a roof on posts with nothing under
        # it. It gets a roof plate and no walls, which is both correct and
        # the cleanest thing this pipeline produces.
        cands.append({"id": el.get("id"), "tags": tags, "ring": ring,
                      "area": ring_area(ring),
                      "no_walls": tags.get("building") in ("roof", "canopy",
                                                           "carport", "shelter")})
    print(f"{len(cands)} footprints in the box"
          + (f", {n_excluded} excluded as already built" if n_excluded else ""))

    # Heights, and the reasons for dropping anything.
    builds, skipped = [], {"no_dhm": 0, "too_low": 0, "no_frame": 0}
    for b in cands:
        top, ground, n = roof_height(surf, terr, b["ring"])
        if top is None:
            skipped["no_dhm"] += 1
            continue
        h = top - ground
        if h < a.min_height:
            skipped["too_low"] += 1
            continue
        b.update(top=top, ground=ground, height=h, samples=n)
        f, inc = best_frame(frames, b["ring"], top)
        if f is None:
            skipped["no_frame"] += 1
            continue
        b.update(frame=f, incidence=inc)
        builds.append(b)
    print(f"{len(builds)} buildings to draw; skipped "
          + ", ".join(f"{k} {v}" for k, v in skipped.items() if v))
    if not builds:
        sys.exit("Nothing to draw. Is the DHM covering this box?")

    hs = sorted(b["height"] for b in builds)
    print(f"heights {hs[0]:.1f} .. {hs[-1]:.1f} m, median {hs[len(hs)//2]:.1f} m")

    # ── wall faces, and which oblique can see each one ─────────────
    #
    # A roof needs the camera looking DOWN at it, so one nadir frame
    # serves dozens. A wall needs a camera looking AT IT, which means the
    # oblique shot from the side the wall faces: a south-facing wall is
    # photographed by the frame flown to its south looking north. That is
    # what `incidence` measures, and it is why five frames per location
    # is plenty to photograph a building even though it is far too few to
    # reconstruct one.
    #
    # Rings are normalised counter-clockwise when the candidates are
    # built, so for edge i to j the outward normal is (dy, -dx).
    # Footprint bounding boxes first: the occlusion grid, the atlas
    # layout and the UV mapping all key off them.
    for b in builds:
        xs = [q[0] for q in b["ring"]]
        ys = [q[1] for q in b["ring"]]
        b["bx"] = (min(xs), min(ys), max(xs), max(ys))

    occ_cells = {}
    for b in builds:
        x0, y0, x1, y1 = b["bx"]
        for cx in range(int(x0 // 50), int(x1 // 50) + 1):
            for cy in range(int(y0 // 50), int(y1 // 50) + 1):
                occ_cells.setdefault((cx, cy), []).append(b)

    def occluded(P, frame, skip):
        """Does anything stand between this point and the camera?

        Walks the segment in 4 m steps and asks whether it passes through
        another building's prism. Without it a wall facing away from the
        apron gets painted with whatever building stands in front of it,
        which is worse than leaving it flat.
        """
        C = frame.C
        n = max(2, int(math.dist((P[0], P[1]), (C[0], C[1])) / 4.0))
        n = min(n, 400)
        for k in range(1, n):
            t = k / n
            qx = P[0] + (C[0] - P[0]) * t
            qy = P[1] + (C[1] - P[1]) * t
            qz = P[2] + (C[2] - P[2]) * t
            for o in occ_cells.get((int(qx // 50), int(qy // 50)), ()):
                if o is skip or qz > o["top"] or qz < o["ground"]:
                    continue
                bx = o["bx"]
                if bx[0] <= qx <= bx[2] and bx[1] <= qy <= bx[3] \
                        and inside(qx, qy, o["ring"]):
                    return True
        return False

    obliques = [f for f in frames if f.direction != "nadir"]
    patches = []          # every rectangle that needs painting
    walls_lit = walls_flat = 0

    for b in builds:
        x0, y0, x1, y1 = b["bx"]
        # roof patch
        b["tw"] = max(1, int((x1 - x0) / a.gsd) + 1)
        b["th"] = max(1, int((y1 - y0) / a.gsd) + 1)
        patches.append({"kind": "roof", "b": b, "frame": b["frame"],
                        "w": b["tw"], "h": b["th"]})
        if b.get("no_walls"):
            continue
        n = len(b["ring"])
        h = b["top"] - b["ground"]
        b["walls"] = []
        for i in range(n):
            j = (i + 1) % n
            A, B = b["ring"][i], b["ring"][j]
            L = math.dist(A, B)
            if L < 0.6:
                b["walls"].append(None)
                continue
            nx, ny = (B[1] - A[1]) / L, -(B[0] - A[0]) / L
            mid = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, b["ground"] + h / 2)
            corners = [(A[0], A[1], b["top"]), (B[0], B[1], b["top"]),
                       (B[0], B[1], b["ground"]), (A[0], A[1], b["ground"])]
            # VISIBILITY FIRST, then angle.
            #
            # Ranking all 176 obliques by incidence and trying the best
            # few fails most of the time: the frames with the finest
            # angle on a wall are usually ones flown somewhere else
            # entirely, which do not contain the building at all. Doing
            # it that way found a view for 535 of 1,751 walls. Keeping
            # only the frames that actually contain the wall, and then
            # picking the best angle among those, is both correct and
            # the same cost.
            seen = [f for f in obliques
                    if all(f.sees(c, margin=30) for c in corners)]
            ranked = sorted(((f.incidence(mid, (nx, ny, 0.0)), f) for f in seen),
                            key=lambda t: -t[0])
            chosen = None
            for inc, f in ranked:
                if inc < 0.20:          # too glancing to carry detail
                    break
                if occluded(mid, f, b):
                    continue
                chosen = f
                break
            pw = max(1, int(L / a.wall_gsd) + 1)
            ph = max(1, int(h / a.wall_gsd) + 1)
            w = {"i": i, "j": j, "A": A, "B": B, "L": L, "frame": chosen,
                 "w": pw, "h": ph}
            b["walls"].append(w)
            if chosen is not None:
                patches.append({"kind": "wall", "b": b, "wall": w,
                                "frame": chosen, "w": pw, "h": ph})
                walls_lit += 1
            else:
                walls_flat += 1

    print(f"{walls_lit:,} walls have an oblique that sees them, "
          f"{walls_flat:,} fall back to flat colour")

    # ── atlas layout: shelf packing, tallest first ──────────────────
    order = sorted(patches, key=lambda q: -q["h"])
    PAD = 2
    x = y = shelf = 0
    W = a.atlas_max
    for q in order:
        if x + q["w"] + PAD > W:
            x = 0
            y += shelf + PAD
            shelf = 0
        q["ax"], q["ay"] = x, y
        x += q["w"] + PAD
        shelf = max(shelf, q["h"])
    H = y + shelf + PAD
    print(f"atlas {W} x {H} px  ({len(patches):,} patches)")
    if H > 16384:
        sys.exit(f"Atlas {W}x{H} is too tall. Raise --gsd or --wall-gsd.")

    atlas = Image.new("RGB", (W, H), (0, 0, 0))
    ap_px = atlas.load()

    # ── paint, grouped by frame so each TIFF opens once ────────────
    by_frame = {}
    for q in patches:
        by_frame.setdefault(q["frame"].id, []).append(q)
    print(f"{len(by_frame)} frames to open")

    for n, (fid, group) in enumerate(sorted(by_frame.items()), 1):
        tif = next(img_dir.glob(f"{fid}*.tif"), None)
        if not tif:
            print(f"  [{n}/{len(by_frame)}] {fid}: NO TIFF, {len(group)} patches skipped")
            continue
        frame = group[0]["frame"]
        src, lw = open_level(tif, frame.size[0])
        scale = lw / frame.size[0]
        sp = src.load()
        sw, sh = src.size
        for q in group:
            b = q["b"]
            if q["kind"] == "roof":
                bx0, by0, bx1, by1 = b["bx"]
                for jj in range(q["h"]):
                    wy = by1 - jj * a.gsd
                    for ii in range(q["w"]):
                        wx = bx0 + ii * a.gsd
                        if not inside(wx, wy, b["ring"]):
                            continue
                        pr = frame.project((wx, wy, b["top"]))
                        if pr is None:
                            continue
                        ic, ir = int(pr[0] * scale), int(pr[1] * scale)
                        if 0 <= ic < sw and 0 <= ir < sh:
                            ap_px[q["ax"] + ii, q["ay"] + jj] = sp[ic, ir]
            else:
                # A wall is a vertical plane, so the mapping from patch
                # pixel to world point is exact: slide along the base,
                # climb by height. No interpolation of an interpolation.
                w = q["wall"]
                A, B = w["A"], w["B"]
                top, grd = b["top"], b["ground"]
                for jj in range(q["h"]):
                    fv = 1.0 - jj / max(1, q["h"] - 1)      # 1 at the top
                    wz = grd + (top - grd) * fv
                    for ii in range(q["w"]):
                        fu = ii / max(1, q["w"] - 1)
                        wx = A[0] + (B[0] - A[0]) * fu
                        wy = A[1] + (B[1] - A[1]) * fu
                        pr = frame.project((wx, wy, wz))
                        if pr is None:
                            continue
                        ic, ir = int(pr[0] * scale), int(pr[1] * scale)
                        if 0 <= ic < sw and 0 <= ir < sh:
                            ap_px[q["ax"] + ii, q["ay"] + jj] = sp[ic, ir]
        src.close()
        print(f"  [{n}/{len(by_frame)}] {tif.name}: {len(group)} patches")

    atlas_name = "site_atlas.jpg"
    atlas.save(out / atlas_name, quality=90)
    print(f"\nwrote {out/atlas_name}")

    # ── OBJ ────────────────────────────────────────────────────────
    V, VT, F = [], [], []
    bad_tri = []
    relieved = []
    gridded_stats = []
    for b in builds:
        bx0, by0, bx1, by1 = b["bx"]
        rq = next(q for q in patches if q["kind"] == "roof" and q["b"] is b)
        vbase, tbase = len(V), len(VT)
        n = len(b["ring"])
        # One height for the whole roof unless this building is big
        # enough to be several buildings, which is what --roof-relief
        # decides. The walls below pick these same vertices up, so a
        # reshaped roof carries its walls with it and no wall code
        # changes.
        if a.roof_relief and b["area"] >= a.roof_relief:
            zs = roof_relief(surf, terr, b["ring"], b["top"], b["ground"])
            relieved.append((b["id"], max(zs) - min(zs)))
        else:
            zs = [b["top"]] * n
        tris = triangulate(b["ring"])
        # A sampled roof surface for the big ones, a flat plate for the
        # rest. The ring vertices keep their indices either way, so the
        # wall code below is untouched by this.
        gridded = a.roof_grid and b["area"] >= a.roof_grid
        if gridded:
            gpts, tris = subdivide_roof(b["ring"], tris, surf, b["ground"],
                                        b["top"], max_edge=a.roof_grid_edge)
            for (px, py, pz) in gpts:
                V.append((px, py, pz))
                VT.append(((rq["ax"] + (px - bx0) / a.gsd) / W,
                           1.0 - (rq["ay"] + (by1 - py) / a.gsd) / H))
            gridded_stats.append((b["id"], len(gpts), len(tris)))
        else:
            for (px, py), pz in zip(b["ring"], zs):
                V.append((px, py, pz))
                VT.append(((rq["ax"] + (px - bx0) / a.gsd) / W,
                           1.0 - (rq["ay"] + (by1 - py) / a.gsd) / H))
        # Area gate. On a subdivided roof the indices point into the
        # subdivided point list, not the ring, so it reads coordinates
        # from whichever set this building actually used. The gate is
        # the only thing that caught the winding bug and it stays live
        # for both paths.
        src = gpts if gridded else [(x, y, 0.0) for (x, y) in b["ring"]]
        ta = sum(abs((src[jj][0]-src[ii][0]) * (src[kk][1]-src[ii][1])
                     - (src[jj][1]-src[ii][1]) * (src[kk][0]-src[ii][0])) / 2
                 for ii, jj, kk in tris)
        if tris and abs(ta / max(b["area"], 1e-6) - 1.0) > 0.02:
            bad_tri.append((b["id"], ta / b["area"]))
        for (i0, i1, i2) in tris:
            F.append(((vbase+i0+1, tbase+i0+1), (vbase+i1+1, tbase+i1+1),
                      (vbase+i2+1, tbase+i2+1)))
        if b.get("no_walls"):
            continue
        # Flat fallback colour for any wall with no view of its own.
        VT.append(((rq["ax"] + rq["w"] / 2) / W,
                   1.0 - (rq["ay"] + rq["h"] / 2) / H))
        flat = len(VT)
        vbot = len(V)
        for (px, py) in b["ring"]:
            V.append((px, py, b["ground"] - 0.5))
        for i in range(n):
            w = b["walls"][i] if b.get("walls") else None
            j = (i + 1) % n
            t0, t1 = vbase + i + 1, vbase + j + 1
            b0, b1 = vbot + i + 1, vbot + j + 1
            if w is None or w["frame"] is None:
                F.append(((t0, flat), (t1, flat), (b1, flat)))
                F.append(((t0, flat), (b1, flat), (b0, flat)))
                continue
            q = next(qq for qq in patches
                     if qq["kind"] == "wall" and qq["wall"] is w)
            u0 = q["ax"] / W
            u1 = (q["ax"] + q["w"]) / W
            v1 = 1.0 - q["ay"] / H                  # top of the patch
            v0 = 1.0 - (q["ay"] + q["h"]) / H       # bottom
            VT.append((u0, v1)); ta0 = len(VT)
            VT.append((u1, v1)); ta1 = len(VT)
            VT.append((u1, v0)); tb1 = len(VT)
            VT.append((u0, v0)); tb0 = len(VT)
            F.append(((t0, ta0), (t1, ta1), (b1, tb1)))
            F.append(((t0, ta0), (b1, tb1), (b0, tb0)))

    # Vertices go out RELATIVE to a local origin, height left absolute.
    # glTF positions are float32, about seven significant digits, so a
    # raw northing of 6177804.5 resolves to half a metre and the whole
    # model would quantise onto a visible grid.
    ox = (min(q[0] for q in V) + max(q[0] for q in V)) / 2.0
    oy = (min(q[1] for q in V) + max(q[1] for q in V)) / 2.0
    olon, olat = _inv_utm32n(ox, oy)
    (out / "origin.json").write_text(json.dumps({
        "easting": ox, "northing": oy, "lon": olon, "lat": olat,
        "epsg": 25832, "vertical": "DVR90 (EPSG:5799), absolute in z",
        "obj2tiles": f"--lat {olat:.9f} --lon {olon:.9f} --alt 0.0",
    }, indent=1) + "\n")
    print(f"origin {ox:.1f} {oy:.1f}  =  {olon:.6f}, {olat:.6f}")

    obj = out / "site.obj"
    with open(obj, "w") as f:
        f.write("mtllib site.mtl\nusemtl site\n")
        for (px, py, pz) in V:
            f.write(f"v {px-ox:.3f} {py-oy:.3f} {pz:.3f}\n")
        for (u, v) in VT:
            f.write(f"vt {u:.6f} {v:.6f}\n")
        for tri in F:
            f.write("f " + " ".join(f"{m}/{n_}" for m, n_ in tri) + "\n")
    (out / "site.mtl").write_text(
        f"newmtl site\nKa 1 1 1\nKd 1 1 1\nd 1\nillum 1\nmap_Kd {atlas_name}\n")

    if bad_tri:
        print(f"\nWARNING: {len(bad_tri)} roofs whose triangles do not cover "
              f"their footprint. Worst ratio {max(r for _, r in bad_tri):.3f}. "
              f"Expect torn roofs.")
        for wid, r in bad_tri[:5]:
            print(f"   way {wid}  ratio {r:.3f}")
    else:
        print("roof triangulation: every footprint covered exactly once")
    if gridded_stats:
        tri = sum(g[2] for g in gridded_stats)
        print(f"roof surface sampled on {len(gridded_stats)} footprint(s) over "
              f"{a.roof_grid:,.0f} m2; {tri:,} roof triangles where a flat "
              f"plate would have been {sum(1 for _ in gridded_stats) * 2:,}")
    if relieved:
        relieved.sort(key=lambda r: -r[1])
        spread = sum(r[1] for r in relieved) / len(relieved)
        print(f"roof relief on {len(relieved)} footprint(s) over "
              f"{a.roof_relief:,.0f} m2; mean height spread {spread:.1f} m, "
              f"largest {relieved[0][1]:.1f} m")

    print(f"wrote {obj}  ({len(V):,} verts, {len(F):,} faces)")
    print(f"\nnext:")
    print(f"  python3 to_yup.py --in {obj} --out {out/'site_yup.obj'}")
    print(f"  Obj2Tiles ... --divisions 3 --lat {olat:.9f} --lon {olon:.9f} --alt 0.0")


if __name__ == "__main__":
    main()
