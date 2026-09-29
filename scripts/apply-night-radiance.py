#!/usr/bin/env python3
"""
Attach measured night-time radiance to baked night-lighting geometry.

WHY
---
Road class alone gives every neighbourhood the same brightness: a residential
street in the dense inner city renders exactly like one in a village. Real
aerial night photography does the opposite — intensity varies enormously by
district. That variation is measured data, not something to invent, so it is
sampled here from NASA's VIIRS night-lights imagery.

The result is a per-way multiplier. Final brightness becomes:

    class intensity  x  measured radiance multiplier

so VIIRS supplies the ENVELOPE (which districts are bright) while road class
supplies the STRUCTURE inside it (a motorway still outshines the side streets
around it). Neither is fabricated.

CLIPPING, AND WHY TWO LAYERS
----------------------------
The standard Black Marble layer is a display product and clips: its 90th
percentile over Copenhagen is already 255, so the whole inner city saturates
and loses internal variation — one flat bright blob. At-Sensor-Radiance keeps
more top-end range (median 45 / p90 219 vs 28 / 255).

So both are used: Black Marble for a reliable, complete envelope, and where it
saturates, At-Sensor-Radiance recovers the sub-variation inside the bright core.

SOURCE
------
NASA GIBS, which serves these publicly with no account, token or API key.

USAGE
-----
    python3 scripts/apply-night-radiance.py [siteId ...]
Runs over every baked site when given no arguments. Idempotent — safe to re-run.
"""

import json
import sys
import io
import math
import urllib.request
import urllib.parse
from pathlib import Path

from PIL import Image

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "night-lights"
GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"

LAYER_ENVELOPE = "VIIRS_Black_Marble"                      # static composite
LAYER_DETAIL = "VIIRS_SNPP_DayNightBand_At_Sensor_Radiance"  # less clipped
DETAIL_TIME = "2026-01-15"

# Black Marble values at or above this are treated as saturated, and the
# detail layer is used to recover variation within them.
SATURATION = 240

# Multiplier range. The floor is deliberately non-zero: a road tagged as lit
# in an area VIIRS reads as dark is still a lit road, just a faint one.
MULT_MIN = 0.12
MULT_GAMMA = 0.7

ROAD_CLASSES = ["motorway", "primary", "tertiary", "residential", "harbour"]


def fetch_layer(layer, south, west, north, east, width, height, time=None):
    params = {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0",
        "LAYERS": layer, "CRS": "EPSG:4326",
        "BBOX": f"{south},{west},{north},{east}",
        "WIDTH": str(width), "HEIGHT": str(height),
        "FORMAT": "image/png",
    }
    if time:
        params["TIME"] = time
    url = f"{GIBS}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "isr-c2-platform/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = r.read()
    return Image.open(io.BytesIO(data)).convert("L")


def bbox_of(site):
    lats, lons = [], []
    for cls in ROAD_CLASSES + ["runway", "taxiway"]:
        for flat in site.get(cls, []) or []:
            lats.extend(flat[0::2])
            lons.extend(flat[1::2])
    for cls in ("seamark", "obstacle"):
        for p in site.get(cls, []) or []:
            lats.append(p["lat"])
            lons.append(p["lon"])
    if not lats:
        return None
    pad = 0.01
    return (min(lats) - pad, min(lons) - pad, max(lats) + pad, max(lons) + pad)


def sampler(img, south, west, north, east):
    w, h = img.size
    px = img.load()

    def sample(lat, lon):
        fx = (lon - west) / (east - west)
        fy = (north - lat) / (north - south)
        x = min(w - 1, max(0, int(fx * w)))
        y = min(h - 1, max(0, int(fy * h)))
        return px[x, y]

    return sample


def raw_level(envelope_v, detail_v):
    """Combine both layers into a single 0..1 'how bright is this district'."""
    base = envelope_v / 255.0
    if envelope_v >= SATURATION and detail_v is not None:
        # Inside the saturated core the envelope carries no information, so
        # the detail layer supplies the internal variation. Held in the upper
        # part of the range so a saturated district still reads as bright.
        base = 0.80 + 0.20 * (detail_v / 255.0)
    return base


def build_stretch(levels):
    """
    Map the sampled distribution across the full multiplier range.

    Normalising against the absolute 0-255 scale does not work: roads only
    ever occupy the bright end of it, so nearly every way lands at maximum
    and the output has no spread at all — the exact flat look this is meant
    to fix. What matters is where a road sits RELATIVE TO OTHER ROADS, so the
    stretch is anchored to percentiles of the values actually sampled.

    Relative ordering is untouched; only the output range is expanded.
    """
    s = sorted(levels)
    if not s:
        return lambda v: 1.0
    lo = s[int(len(s) * 0.05)]
    hi = s[int(len(s) * 0.95)] if len(s) > 20 else s[-1]
    span = max(1e-6, hi - lo)

    def stretch(v):
        t = min(1.0, max(0.0, (v - lo) / span))
        return MULT_MIN + (1.0 - MULT_MIN) * (t ** MULT_GAMMA)

    return stretch


def process(site_id):
    path = OUT_DIR / f"{site_id}.json"
    if not path.exists():
        print(f"  {site_id}: no baked file, skipping")
        return
    site = json.loads(path.read_text())
    box = bbox_of(site)
    if not box:
        print(f"  {site_id}: no geometry, skipping")
        return
    south, west, north, east = box

    # VIIRS is ~460 m native (15 arcsec). Requesting a bit above native avoids
    # resampling loss without pretending to a resolution the data lacks.
    width = max(64, min(1024, int((east - west) * 111320 * math.cos(math.radians((north + south) / 2)) / 300)))
    height = max(64, min(1024, int((north - south) * 111320 / 300)))

    try:
        env = fetch_layer(LAYER_ENVELOPE, south, west, north, east, width, height)
    except Exception as e:
        print(f"  {site_id}: envelope fetch failed ({e}), skipping")
        return
    try:
        det = fetch_layer(LAYER_DETAIL, south, west, north, east, width, height, DETAIL_TIME)
        if det.getbbox() is None:   # all-black = no data for that date
            det = None
    except Exception:
        det = None

    s_env = sampler(env, south, west, north, east)
    s_det = sampler(det, south, west, north, east) if det else None

    # Pass 1: sample a raw level per way.
    raw = {}
    for cls in ROAD_CLASSES:
        ways = site.get(cls) or []
        vals = []
        for flat in ways:
            # Mean across a few vertices rather than one point, so a long way
            # crossing districts gets a representative level.
            n = len(flat) // 2
            idxs = {0, n // 2, n - 1} if n >= 3 else {0}
            e_acc, d_acc, c = 0, 0, 0
            for i in idxs:
                lat, lon = flat[i * 2], flat[i * 2 + 1]
                e_acc += s_env(lat, lon)
                if s_det:
                    d_acc += s_det(lat, lon)
                c += 1
            vals.append(raw_level(e_acc / c, (d_acc / c) if s_det else None))
        if vals:
            raw[cls] = vals

    # Pass 2: stretch against the distribution of everything sampled, so the
    # output uses its full range instead of piling up at the top.
    stretch = build_stretch([v for vals in raw.values() for v in vals])
    radiance = {cls: [round(stretch(v), 3) for v in vals] for cls, vals in raw.items()}
    stats = [m for vals in radiance.values() for m in vals]

    site["radiance"] = radiance
    path.write_text(json.dumps(site))

    if stats:
        stats.sort()
        k = len(stats)
        print(f"  {site_id}: {k} ways  min {stats[0]:.2f}  median {stats[k//2]:.2f}  "
              f"p90 {stats[int(k*0.9)]:.2f}  max {stats[-1]:.2f}"
              f"{'' if det else '  (no detail layer, envelope only)'}")


def main():
    args = sys.argv[1:]
    if args:
        sites = args
    else:
        sites = [p.stem for p in OUT_DIR.glob("*.json") if not p.stem.startswith("_")]
    print("Applying measured night radiance")
    for s in sites:
        process(s)
    print("Done.")


if __name__ == "__main__":
    main()
