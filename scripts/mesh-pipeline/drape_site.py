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
def signed_area(ring):
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def triangulate(ring):
    """Ear clipping.

    A fan from the centroid is wrong here: real footprints are concave,
    an L-shaped terminal most of all, and a fan puts triangles outside
    the building. Ear clipping handles any simple polygon and these are
    small enough that its cost does not matter.
    """
    pts = list(ring)
    if signed_area(pts) < 0:
        pts.reverse()
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
            out.append((i0, i1, i2))
            idx.pop(k)
            clipped = True
            break
        if not clipped:
            break
    if len(idx) == 3:
        out.append(tuple(idx))
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
    ap.add_argument("--images", default=None)
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--gsd", type=float, default=0.12, help="texture metres per pixel")
    ap.add_argument("--min-height", type=float, default=2.0,
                    help="skip anything standing lower than this")
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
        ring = [utm32n(p["lon"], p["lat"]) for p in g]
        if ring[0] == ring[-1]:
            ring.pop()
        if len(ring) < 3:
            continue
        tags = el.get("tags") or {}
        cands.append({"id": el.get("id"), "tags": tags, "ring": ring,
                      "area": ring_area(ring)})
    print(f"{len(cands)} footprints in the box")

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

    # ── atlas layout: shelf packing, tallest first ──────────────────
    for b in builds:
        xs = [p[0] for p in b["ring"]]
        ys = [p[1] for p in b["ring"]]
        b["bx"] = (min(xs), min(ys), max(xs), max(ys))
        b["tw"] = max(1, int((b["bx"][2] - b["bx"][0]) / a.gsd) + 1)
        b["th"] = max(1, int((b["bx"][3] - b["bx"][1]) / a.gsd) + 1)
    order = sorted(builds, key=lambda b: -b["th"])
    PAD = 2
    x = y = shelf = 0
    W = a.atlas_max
    for b in order:
        if x + b["tw"] + PAD > W:
            x = 0
            y += shelf + PAD
            shelf = 0
        b["ax"], b["ay"] = x, y
        x += b["tw"] + PAD
        shelf = max(shelf, b["th"])
    H = y + shelf + PAD
    if H > a.atlas_max:
        print(f"NOTE: atlas is {W} x {H}, taller than {a.atlas_max}. "
              f"Raise --gsd to shrink it.")
    print(f"atlas {W} x {H} px at {a.gsd} m/px")

    atlas = Image.new("RGB", (W, H), (0, 0, 0))
    ap_px = atlas.load()

    # ── paint each roof ────────────────────────────────────────────
    by_frame = {}
    for b in builds:
        by_frame.setdefault(b["frame"].id, []).append(b)
    print(f"{len(by_frame)} frames needed")

    painted = 0
    for n, (fid, group) in enumerate(sorted(by_frame.items()), 1):
        tif = next(img_dir.glob(f"{fid}*.tif"), None)
        if not tif:
            print(f"  [{n}/{len(by_frame)}] {fid}: NO TIFF, skipping {len(group)}")
            continue
        frame = group[0]["frame"]
        src, lw = open_level(tif, frame.size[0])
        scale = lw / frame.size[0]
        sp = src.load()
        sw, sh = src.size
        for b in group:
            x0, y0, x1, y1 = b["bx"]
            z = b["top"]
            for j in range(b["th"]):
                wy = y1 - j * a.gsd
                for i in range(b["tw"]):
                    wx = x0 + i * a.gsd
                    if not inside(wx, wy, b["ring"]):
                        continue
                    q = frame.project((wx, wy, z))
                    if q is None:
                        continue
                    ic, ir = int(q[0] * scale), int(q[1] * scale)
                    if 0 <= ic < sw and 0 <= ir < sh:
                        ap_px[b["ax"] + i, b["ay"] + j] = sp[ic, ir]
            painted += 1
        src.close()
        print(f"  [{n}/{len(by_frame)}] {tif.name}: {len(group)} roofs")

    atlas_name = "site_atlas.jpg"
    atlas.save(out / atlas_name, quality=92)
    print(f"\nwrote {out/atlas_name}  ({painted} roofs painted)")

    # ── OBJ ────────────────────────────────────────────────────────
    V, VT, F = [], [], []
    for b in builds:
        x0, y0, x1, y1 = b["bx"]
        base = len(V)
        for (px, py) in b["ring"]:
            V.append((px, py, b["top"]))
            u = (b["ax"] + (px - x0) / a.gsd) / W
            v = 1.0 - (b["ay"] + (y1 - py) / a.gsd) / H
            VT.append((u, v))
        for (i0, i1, i2) in triangulate(b["ring"]):
            F.append(((base+i0+1, base+i0+1), (base+i1+1, base+i1+1),
                      (base+i2+1, base+i2+1)))
        # Walls: one flat colour per building, from the middle of its own
        # roof patch, until the oblique pass paints them properly.
        wu = (b["ax"] + b["tw"] / 2) / W
        wv = 1.0 - (b["ay"] + b["th"] / 2) / H
        VT.append((wu, wv))
        wt = len(VT)
        bot = len(V)
        for (px, py) in b["ring"]:
            V.append((px, py, b["ground"] - 0.5))
        n = len(b["ring"])
        for i in range(n):
            j = (i + 1) % n
            t0, t1 = base + i + 1, base + j + 1
            b0, b1 = bot + i + 1, bot + j + 1
            F.append(((t0, wt), (t1, wt), (b1, wt)))
            F.append(((t0, wt), (b1, wt), (b0, wt)))

    obj = out / "site.obj"
    with open(obj, "w") as f:
        f.write("mtllib site.mtl\nusemtl site\n")
        for (px, py, pz) in V:
            f.write(f"v {px:.3f} {py:.3f} {pz:.3f}\n")
        for (u, v) in VT:
            f.write(f"vt {u:.6f} {v:.6f}\n")
        for tri in F:
            f.write("f " + " ".join(f"{a_}/{b_}" for a_, b_ in tri) + "\n")
    (out / "site.mtl").write_text(
        f"newmtl site\nKa 1 1 1\nKd 1 1 1\nd 1\nillum 1\nmap_Kd {atlas_name}\n")

    print(f"wrote {obj}  ({len(V):,} verts, {len(F):,} faces)")
    print(f"\nnext:\n  python3 to_yup.py --in {obj} --out {out/'site_yup.obj'}")


if __name__ == "__main__":
    main()
