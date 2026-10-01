#!/usr/bin/env python3
"""
Export the building footprints a site's mesh covers, for the C2 to clip with.

The reconstruction covers everything the cameras saw, and only the
buildings in it are wanted. Rather than cutting the mesh geometry, the
C2 clips it at render time to these polygons: Cesium keeps what is
inside them and discards the rest.

The same polygons do the opposite job on the white extruded boxes.
Cesium's ClippingPolygonCollection takes an `inverse` flag, so one set
of outlines drives both halves of the swap:

    mesh   inverse: true    keep only what is inside a footprint
    boxes  inverse: false   remove what is inside a footprint

That symmetry is the reason to clip rather than to hide the boxes by
some other rule. A box and the mesh that replaces it are cut against
the same outline, so they cannot leave a sliver of box beside a real
building or a gap where neither draws.

Only footprints that actually fall on the mesh are exported. A box
outside the reconstructed area has nothing to replace it and must keep
drawing.

Usage:
    python3 export_footprints.py \
        --osm  /tmp/osm_buildings.json \
        --site billund \
        --obj  work/bt-terminal/odm/odm_texturing/odm_textured_model_geo.obj \
        --out  ../../src/data/building_footprints.json
"""

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from clip_to_buildings import load_footprints, inside  # noqa: E402


def mesh_extent(obj_path, offset_path=None):
    """Easting/northing extent of an ODM mesh, in the footprints' CRS."""
    obj = Path(obj_path)
    off = Path(offset_path) if offset_path else (
        obj.parent.parent / "odm_georeferencing" / "odm_georeferencing_model_geo.txt")
    off_x = off_y = 0.0
    if off.exists():
        for line in off.read_text().splitlines():
            parts = line.split()
            if len(parts) == 2:
                try:
                    off_x, off_y = float(parts[0]), float(parts[1])
                    break
                except ValueError:
                    continue
    if not off_x:
        sys.exit(f"No georeferencing offset at {off}")

    xs, ys = [], []
    with open(obj) as f:
        for line in f:
            if line.startswith("v "):
                p = line.split()
                xs.append(float(p[1]) + off_x)
                ys.append(float(p[2]) + off_y)
    if not xs:
        sys.exit(f"No vertices in {obj}")
    return (min(xs), min(ys), max(xs), max(ys)), (off_x, off_y)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--osm", required=True)
    ap.add_argument("--site", required=True)
    ap.add_argument("--obj", required=True, help="the mesh whose extent decides the set")
    ap.add_argument("--offset")
    ap.add_argument("--out", required=True)
    ap.add_argument("--pad", type=float, default=1.5,
                    help="metres to grow each outline, matching clip_to_buildings")
    ap.add_argument("--clipped",
                    help="the buildings-only mesh. Given this, only footprints "
                         "that actually carry geometry are exported")
    ap.add_argument("--min-faces", type=int, default=40,
                    help="triangles a footprint needs before its white box is "
                         "taken away")
    a = ap.parse_args()

    box, (off_x, off_y) = mesh_extent(a.obj, a.offset)
    print(f"mesh extent  E {box[0]:.0f}..{box[2]:.0f}  N {box[1]:.0f}..{box[3]:.0f}")

    polys = load_footprints(a.osm)
    print(f"{len(polys)} footprints in {a.osm}")

    raw = json.loads(Path(a.osm).read_text())
    ways = [el for el in raw.get("elements", [])
            if el.get("type") == "way" and len(el.get("geometry") or []) >= 4]
    if len(ways) != len(polys):
        sys.exit("Footprint and way counts disagree; the two loaders are out of step.")

    # Which footprints have geometry actually standing in them.
    #
    # Overlapping the mesh's bounding box is not the same as being
    # replaced by it. At Billund 19 footprints overlapped the box and
    # only 9 carried any reconstruction, so exporting all 19 told the
    # map to delete 10 white boxes and put nothing in their place. A
    # building that simply vanishes is worse than a white one, and it is
    # most of why the surviving fragments read as standing in the middle
    # of nowhere.
    counts = {}
    if a.clipped and Path(a.clipped).exists():
        cverts = []
        with open(a.clipped) as f:
            for line in f:
                if line.startswith("v "):
                    p = line.split()
                    cverts.append((float(p[1]) + off_x, float(p[2]) + off_y))
                elif line.startswith("f "):
                    ids = [int(t.split("/")[0]) - 1 for t in line.split()[1:]]
                    try:
                        pts = [cverts[i] for i in ids]
                    except IndexError:
                        continue
                    cx = sum(p[0] for p in pts) / len(pts)
                    cy = sum(p[1] for p in pts) / len(pts)
                    for n, poly in enumerate(polys):
                        b = poly["bbox"]
                        if b[0] <= cx <= b[2] and b[1] <= cy <= b[3] \
                                and inside(cx, cy, poly["ring"]):
                            counts[n] = counts.get(n, 0) + 1
                            break
        print(f"{len(counts)} footprints carry reconstructed geometry")

    # Projected only to decide which ways are on the mesh. What gets
    # written is the original longitude and latitude, because Cesium
    # wants those and a round trip through the projection would add
    # error for nothing.
    kept, skipped_empty, dropped_kind = [], 0, 0
    for n, (way, poly) in enumerate(zip(ways, polys)):
        x0, y0, x1, y1 = poly["bbox"]
        if x1 < box[0] or x0 > box[2] or y1 < box[1] or y0 > box[3]:
            continue
        # Whether this outline's white box should be taken away, which
        # is NOT the same question as whether the mesh replaces it.
        #
        # Replaced by mesh      -> hide the box, the reconstruction is there
        # Not a walled building -> hide the box, it is wrong either way.
        #                          OSM draws a `building=roof` canopy and a
        #                          12 m2 way as solid extruded volumes, and
        #                          a 4 x 3 m volume at any default height is
        #                          a pillar standing in a car park. Eight of
        #                          those sit 98 to 322 m out at Billund.
        # Real building, no mesh -> KEEP the box. A building that simply
        #                          vanishes is worse than a white one.
        #
        # Exporting only the first case is what put the eight pillars
        # back on the map: they had been hidden, and the fix that stopped
        # deleting unreplaced buildings restored them along with
        # everything else.
        has_mesh = counts.get(n, 0) >= a.min_faces if counts else True
        if poly["solid"] and not has_mesh:
            skipped_empty += 1
            continue
        if not poly["solid"]:
            dropped_kind += 1
        ring = [[round(p["lon"], 7), round(p["lat"], 7)] for p in way["geometry"]]
        # Cesium closes the ring itself, and a duplicated last point
        # makes a zero-length edge in the signed distance field.
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring.pop()
        if len(ring) < 3:
            continue
        tags = way.get("tags") or {}
        kept.append({
            "hasMesh": has_mesh,
            "solid": poly["solid"],
            "id": way.get("id"),
            "name": tags.get("name") or None,
            "ring": ring,
        })

    if skipped_empty:
        print(f"{skipped_empty} real buildings have no reconstruction; "
              "their white boxes are LEFT ALONE")
    if dropped_kind:
        print(f"{dropped_kind} outlines are not walled buildings (roof/canopy "
              "or tiny); their white boxes are HIDDEN with nothing to replace "
              "them, because an extruded canopy is a pillar")
    if not kept:
        sys.exit("No footprint falls on this mesh. Check the box with pick_bbox.py "
                 "before exporting.")

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = json.loads(out.read_text()) if out.exists() else {"sites": {}}
    doc.setdefault("sites", {})[a.site] = {
        # Recorded so the C2 can say which mesh these belong to, and so a
        # re-export against a different reconstruction is visible in the
        # diff rather than silent.
        "mesh_extent_utm32n": [round(v, 1) for v in box],
        "pad_m": a.pad,
        "buildings": kept,
    }
    out.write_text(json.dumps(doc, indent=1) + "\n")

    named = [b["name"] for b in kept if b["name"]]
    print(f"\nwrote {out}")
    print(f"  site {a.site}: {len(kept)} footprints, {sum(len(b['ring']) for b in kept)} vertices")
    if named:
        print(f"  named: {', '.join(sorted(named))}")


if __name__ == "__main__":
    main()
