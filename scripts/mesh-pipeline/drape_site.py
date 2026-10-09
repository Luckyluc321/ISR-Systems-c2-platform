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
    for b in builds:
        bx0, by0, bx1, by1 = b["bx"]
        rq = next(q for q in patches if q["kind"] == "roof" and q["b"] is b)
        vbase, tbase = len(V), len(VT)
        n = len(b["ring"])
        for (px, py) in b["ring"]:
            V.append((px, py, b["top"]))
            VT.append(((rq["ax"] + (px - bx0) / a.gsd) / W,
                       1.0 - (rq["ay"] + (by1 - py) / a.gsd) / H))
        tris = triangulate(b["ring"])
        ta = sum(abs((b["ring"][jj][0]-b["ring"][ii][0]) * (b["ring"][kk][1]-b["ring"][ii][1])
                     - (b["ring"][jj][1]-b["ring"][ii][1]) * (b["ring"][kk][0]-b["ring"][ii][0])) / 2
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

    print(f"wrote {obj}  ({len(V):,} verts, {len(F):,} faces)")
    print(f"\nnext:")
    print(f"  python3 to_yup.py --in {obj} --out {out/'site_yup.obj'}")
    print(f"  Obj2Tiles ... --divisions 3 --lat {olat:.9f} --lon {olon:.9f} --alt 0.0")


if __name__ == "__main__":
    main()
