#!/usr/bin/env python3
"""
Sample Danmarks Højdemodel at a world coordinate.

Two products, and the difference between them is the building:

    dhm_overflade   surface, includes roofs, trees, everything
    dhm_terraen     bare earth
    overflade - terraen = how far above the ground a thing stands

That removes the last guessed numbers from this pipeline. Ground was
being estimated from the very mesh being clipped, which is
self-referential and failed three different ways, and roof height was a
constant typed from an OpenStreetMap level count.

Georeferencing comes from the FILENAME, not from the GeoTIFF tags:
`dhm_overflade_6176000_509000.tif` is the 1 km tile whose south-west
corner is N 6176000, E 509000, at 0.4 m. That is the national tiling
convention, it is what the WCS fetcher writes, and it means this needs
only Pillow rather than GDAL or rasterio, which neither the pipeline nor
the machine currently carries.

Heights are DVR90, the same vertical datum as the skraafoto camera
centres, so the projection needs no conversion. The geoid separation
only matters when the result is placed in Cesium.
"""

import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required:  python3 -m pip install Pillow")

Image.MAX_IMAGE_PIXELS = None

TILE_RE = re.compile(r"(dhm_\w+?)_(\d+)_(\d+)\.tif$", re.I)
NODATA = -9999.0


class DHM:
    """One coverage, read lazily, one tile at a time."""

    def __init__(self, directory, coverage="dhm_overflade", tile_m=1000.0, res_m=0.4):
        self.dir = Path(directory)
        self.coverage = coverage
        self.tile_m = tile_m
        self.res_m = res_m
        self._open = {}
        self.tiles = {}
        for p in sorted(self.dir.glob(f"{coverage}_*.tif")):
            m = TILE_RE.search(p.name)
            if m:
                self.tiles[(int(m.group(3)), int(m.group(2)))] = p   # (E, N)
        if not self.tiles:
            raise SystemExit(f"No {coverage} tiles under {self.dir}")

    def _tile_for(self, x, y):
        key = (int(x // self.tile_m) * int(self.tile_m),
               int(y // self.tile_m) * int(self.tile_m))
        if key not in self.tiles:
            return None, None
        if key not in self._open:
            im = Image.open(self.tiles[key])
            self._open[key] = (im, im.load(), im.size)
        return key, self._open[key]

    def at(self, x, y):
        """Height in metres (DVR90) at an easting and northing, or None.

        None means outside the tiles on disk, or a nodata cell. A caller
        must handle it rather than substituting zero, which would put a
        building 95 m underground.
        """
        key, entry = self._tile_for(x, y)
        if entry is None:
            return None
        _, px, (w, h) = entry
        e0, n0 = key
        col = int((x - e0) / self.res_m)
        # Raster rows run north to south.
        row = int((n0 + self.tile_m - y) / self.res_m)
        if not (0 <= col < w and 0 <= row < h):
            return None
        v = px[col, row]
        if isinstance(v, tuple):
            v = v[0]
        if v is None or v <= NODATA + 1 or v != v:   # nodata or NaN
            return None
        return float(v)

    def stats_over(self, points):
        """Heights at many points, with the misses counted."""
        vals, miss = [], 0
        for x, y in points:
            v = self.at(x, y)
            if v is None:
                miss += 1
            else:
                vals.append(v)
        return vals, miss

    def extent(self):
        es = [k[0] for k in self.tiles]
        ns = [k[1] for k in self.tiles]
        return (min(es), min(ns),
                max(es) + self.tile_m, max(ns) + self.tile_m)


def roof_height(surface, terrain, ring, percentile=0.80, step=1.0):
    """Height above ground for a footprint, and its ground level.

    Sampled on a grid inside the outline rather than at the centroid,
    because a centroid can land on a courtyard, a lower wing or a gap in
    the roof. A high percentile rather than the maximum, so one mast, one
    aerial or one tree leaning over the parapet does not raise the whole
    building.
    """
    from clip_to_buildings import inside

    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    tops, grounds = [], []
    y = min(ys)
    while y <= max(ys):
        x = min(xs)
        while x <= max(xs):
            if inside(x, y, ring):
                s = surface.at(x, y)
                t = terrain.at(x, y)
                if s is not None:
                    tops.append(s)
                if t is not None:
                    grounds.append(t)
            x += step
        y += step
    if not tops or not grounds:
        return None, None, 0
    tops.sort()
    grounds.sort()
    g = grounds[len(grounds) // 2]
    top = tops[min(len(tops) - 1, int(len(tops) * percentile))]
    return top, g, len(tops)


if __name__ == "__main__":
    import json
    sys.path.insert(0, str(Path(__file__).parent))
    from clip_to_buildings import utm32n

    d = sys.argv[1] if len(sys.argv) > 1 else "work/dhm"
    surf = DHM(d, "dhm_overflade")
    terr = DHM(d, "dhm_terraen")
    print(f"surface tiles {len(surf.tiles)}, terrain tiles {len(terr.tiles)}")
    print(f"extent {surf.extent()}")

    osm = json.loads(Path("/tmp/osm_buildings.json").read_text())
    term = next(e for e in osm["elements"] if e.get("id") == 96215030)
    ring = [utm32n(p["lon"], p["lat"]) for p in term["geometry"]]
    top, g, n = roof_height(surf, terr, ring)
    if top is None:
        print("no DHM coverage over the terminal yet")
    else:
        print(f"\nBillund Lufthavn, {n:,} samples")
        print(f"  ground  {g:.2f} m DVR90   (the pipeline was guessing 94.6)")
        print(f"  roof    {top:.2f} m DVR90")
        print(f"  height  {top - g:.2f} m   (the drape was told 18.0)")
