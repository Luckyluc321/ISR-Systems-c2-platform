#!/usr/bin/env python3
"""
Fetch Danmarks Højdemodel tiles over a site, for roof heights.

Roof height per pixel is DHM/Overflade minus DHM/Terræn: the surface
model includes buildings, the terrain model is bare earth, and the
difference is what stands on the ground. That is how Klimadatastyrelsen
builds its own 3D model, and it removes every hand-tuned height constant
from this pipeline at once.

It also removes the guessed ground level. The clip was estimating ground
from the very mesh it was cutting, which is self-referential and failed
in three different ways; and `DK_GEOID_SEPARATION_M = 36.8` in the app is
wrong for Billund, where the real separation is about 40.3 m, and varies
34.5 to 40.8 across the country so no constant can be right nationally.

Both products are 0.4 m grid, Creative Commons Attribution 4.0, free for
commercial use with credit. Heights are DVR90, the same vertical datum
the skraafoto camera centres use, so nothing needs converting before the
projection. The geoid only matters when the result is placed in Cesium.

The service is WCS 1.0.0, not 2.0.1, verified against the live endpoint:
bbox plus crs plus width and height, one request per tile.

Usage:
    python3 fetch_dhm.py --bbox 9.145,55.735,9.172,55.746 --out work/dhm
    python3 fetch_dhm.py --site billund --out work/dhm
"""

import argparse
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fetch import load_token, SITE_BBOX              # noqa: E402
from clip_to_buildings import utm32n                 # noqa: E402

WCS = "https://api.dataforsyningen.dk/dhm_wcs_DAF"
COVERAGES = ("dhm_overflade", "dhm_terraen")
RES_M = 0.4


def fetch_tile(coverage, e0, n0, size_m, token, dest):
    px = int(size_m / RES_M)
    url = WCS + "?" + urllib.parse.urlencode({
        "service": "WCS",
        "version": "1.0.0",
        "request": "GetCoverage",
        "coverage": coverage,
        "bbox": f"{e0},{n0},{e0 + size_m},{n0 + size_m}",
        "crs": "EPSG:25832",
        "width": px,
        "height": px,
        "format": "GTiff",
        "token": token,
    })
    req = urllib.request.Request(url, headers={"User-Agent": "isr-mesh-pipeline"})
    # Retry with backoff. Rendering a 2500x2500 float raster takes the
    # service a while and it answers 502 or 504 under load, which is
    # transient: the same tile succeeds moments later. Without this a
    # four-tile run lost three of them.
    last = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                declared = r.headers.get("Content-Length")
                ctype = (r.headers.get("Content-Type") or "").lower()
                body = r.read()
            break
        except Exception as err:
            last = err
            code = getattr(err, "code", None)
            if code and code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(min(60, 5 * 2 ** attempt))
    else:
        raise RuntimeError(f"gave up after 6 attempts: {last}")
    # The service answers an error with 200 and an XML body, so a
    # content-type check is the only thing between a failed tile and a
    # directory of 2 KB files that look like data.
    if "xml" in ctype or body[:5] == b"<?xml":
        head = body[:400].decode("utf-8", "replace")
        raise RuntimeError(f"service returned XML, not a raster:\n{head}")
    if declared and len(body) != int(declared):
        raise RuntimeError(f"short read: {len(body)} of {declared} bytes")
    dest.write_bytes(body)
    return len(body)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bbox", help="minLon,minLat,maxLon,maxLat")
    ap.add_argument("--site", choices=sorted(SITE_BBOX))
    ap.add_argument("--out", default="./work/dhm")
    ap.add_argument("--tile", type=float, default=1000.0, help="tile size in metres")
    ap.add_argument("--coverage", action="append", choices=list(COVERAGES))
    a = ap.parse_args()

    if a.site:
        bbox = SITE_BBOX[a.site]
    elif a.bbox:
        bbox = tuple(float(v) for v in a.bbox.split(","))
    else:
        ap.error("give --site or --bbox")

    # Project the corners, then round outward to whole tiles so the grid
    # lines up with the national 1 km tiling already on disk.
    c = [utm32n(bbox[0], bbox[1]), utm32n(bbox[2], bbox[1]),
         utm32n(bbox[0], bbox[3]), utm32n(bbox[2], bbox[3])]
    e0 = math.floor(min(p[0] for p in c) / a.tile) * a.tile
    e1 = math.ceil(max(p[0] for p in c) / a.tile) * a.tile
    n0 = math.floor(min(p[1] for p in c) / a.tile) * a.tile
    n1 = math.ceil(max(p[1] for p in c) / a.tile) * a.tile
    es = [e0 + i * a.tile for i in range(int((e1 - e0) / a.tile))]
    ns = [n0 + i * a.tile for i in range(int((n1 - n0) / a.tile))]
    covs = a.coverage or list(COVERAGES)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    token = load_token()
    print(f"E {e0:.0f}..{e1:.0f}  N {n0:.0f}..{n1:.0f}")
    print(f"{len(es)} x {len(ns)} tiles of {a.tile:.0f} m, "
          f"{len(covs)} coverage(s) = {len(es)*len(ns)*len(covs)} requests")

    done = skipped = failed = 0
    for cov in covs:
        for e in es:
            for n in ns:
                dest = out / f"{cov}_{int(n)}_{int(e)}.tif"
                if dest.exists() and dest.stat().st_size > 100_000:
                    skipped += 1
                    continue
                try:
                    size = fetch_tile(cov, e, n, a.tile, token, dest)
                    done += 1
                    print(f"  {dest.name}  {size/1e6:.1f} MB")
                except Exception as err:
                    failed += 1
                    print(f"  FAILED {dest.name}: {err}")
                    dest.unlink(missing_ok=True)
    print(f"\n{done} fetched, {skipped} already present, {failed} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
