#!/usr/bin/env python3
"""
Tell us when the national height model gains a building we cannot build yet.

Some footprints inside a site's mesh coverage produce no geometry at all.
They are not bugs and they are not tuning problems: the drape pipeline
places every surface from data, and for these footprints the data says
there is nothing standing. Two ways that happens:

    tag     OpenStreetMap says building=construction or building=ruins,
            so is_solid_building rejects it. That rule is right. A site
            mid-build must not be extruded as a finished solid.

    height  The outline passes the tag gate, but Danmarks Hoejdemodel
            measures it at under --min-height above its own ground, so
            drape_site skips it.

Both resolve the same way and neither resolves on our side. The building
at 9.1281 E 55.7209 N in Billund is the worst case: 17,167 m2, and both
OpenStreetMap and the height model agree it does not exist. The 10 cm
orthophoto shows it finished, landscaped and occupied. The photograph is
simply newer than the other two inputs, so the C2 draws a perfect
picture of a building with no height, lying flat on the terrain.

Nothing we change in the pipeline fixes that. Allow-listing the tag only
gets the footprint as far as the height model, which would then extrude
it to 0.1 m. The fix arrives when the area is flown again.

WHY THIS POLLS THE DATA AND NOT A CALENDAR

Denmark is split into 55 scanning blocks and about 11 are flown a year,
so the country turns over on a five-year cycle, with new blocks landing
in the web service roughly July to October. There is no published plan
saying which block is flown in which year, so a date-based reminder
would be guessing at a schedule that is not public and can slip.

The data answers the question directly and without ambiguity. For each
watched footprint this measures

    stands = p80 of the surface model inside the outline
             minus the median ground just outside it

and compares it against a stored baseline. Today the Billund case reads
0.1 m. When its block is refreshed it reads fifteen or more. That is the
signal, and it means the data is actually usable, which "a flight
happened" does not.

Each footprint is fetched as its own small window at --res metres, not
as a full 1 km tile at the model's native 0.4 m. The question here is
"does fifteen metres of building stand inside this outline", and a metre
per pixel answers it with room to spare. The first version asked for
native-resolution kilometre tiles and took nine minutes and half a
gigabyte for one site, with the service truncating one raster under the
load. Tight windows make the same run about forty small requests.

Usage:
    python3 watch_height_model.py --site billund                 # check
    python3 watch_height_model.py --site billund --save-baseline # adopt

Exit status:
    0  nothing changed
    1  at least one watched footprint now stands; time to rebuild
    2  the check could not run (network, token, missing inputs)
"""

import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Deliberately NOT imported at module level. Deriving a watch list needs
# the pipeline's own geometry helpers, but CHECKING one needs nothing but
# this file, a watch list and the network. The monthly job runs as a
# launchd agent, which cannot read ~/Desktop and so cannot see its
# siblings here; a top-level import would make the job fail on the
# import line for a function it never calls.
def _pipeline_helpers():
    from clip_to_buildings import utm32n, is_solid_building, ring_area
    return utm32n, is_solid_building, ring_area


try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required:  python3 -m pip install Pillow")

Image.MAX_IMAGE_PIXELS = None

WCS = "https://api.dataforsyningen.dk/dhm_wcs_DAF"
COVERAGE = "dhm_overflade"
NODATA = -100.0

# A footprint whose state can change under us. Everything else excluded
# by is_solid_building is excluded on purpose and permanently: a parking
# deck does not reconstruct, a canopy is not a building, and a 14 m2 way
# is a substation cabinet. Those are not waiting on anything.
UNFINISHED = {"construction", "ruins"}


# --------------------------------------------------------------------- io

def load_env_token(explicit=None):
    """The Dataforsyningen token, from --token, the environment, or .env.local."""
    if explicit:
        return explicit
    tok = os.environ.get("DATAFORSYNINGEN_API_TOKEN")
    if tok:
        return tok
    env = HERE.parent.parent / ".env.local"
    if env.exists():
        for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("DATAFORSYNINGEN_API_TOKEN"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


class Raster:
    """One fetched window, sampled in EPSG:25832 metres."""

    def __init__(self, im, e0, n0, e1, n1):
        self.im = im
        self.e0, self.n0, self.e1, self.n1 = e0, n0, e1, n1
        self.w, self.h = im.size
        self.px = im.load()

    def at(self, x, y):
        if not (self.e0 <= x < self.e1 and self.n0 <= y < self.n1):
            return None
        col = int((x - self.e0) / (self.e1 - self.e0) * self.w)
        row = int((self.n1 - y) / (self.n1 - self.n0) * self.h)
        if not (0 <= col < self.w and 0 <= row < self.h):
            return None
        v = self.px[col, row]
        if v is None or v != v or v <= NODATA:
            return None
        return float(v)


def fetch_window(e0, n0, e1, n1, res, token, tries=5):
    """One rectangle of the surface model, decoded before it is accepted.

    The service renders the raster on demand and fails in two different
    ways under load: an outright 502 or 504, and a 200 carrying a
    truncated image. The second is the dangerous one, because PIL only
    notices at decode time, so decoding happens INSIDE the retry. A run
    that silently accepted a short raster would report "nothing has
    gained height", which is the exact wrong answer to give.
    """
    import io
    w = max(2, int(round((e1 - e0) / res)))
    h = max(2, int(round((n1 - n0) / res)))
    url = WCS + "?" + urllib.parse.urlencode({
        "service": "WCS", "version": "1.0.0", "request": "GetCoverage",
        "coverage": COVERAGE,
        "bbox": f"{e0},{n0},{e1},{n1}",
        "crs": "EPSG:25832", "width": w, "height": h,
        "format": "GTiff", "token": token,
    })
    req = urllib.request.Request(url, headers={"User-Agent": "isr-mesh-pipeline"})
    last = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
            if len(body) < 512:
                raise RuntimeError(f"service returned {len(body)} bytes, not a raster")
            im = Image.open(io.BytesIO(body))
            im.load()                       # force decode; truncation raises here
            return Raster(im, e0, n0, e1, n1)
        except Exception as err:            # noqa: BLE001 - reported, not swallowed
            last = err
            if attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"window {e0},{n0},{e1},{n1} failed after {tries} tries: {last}")


# ---------------------------------------------------------------- geometry

def point_in_ring(x, y, ring):
    c = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1) + x1):
            c = not c
    return c


def stands_above_ground(ring, sampler, step=1.5, out_m=8.0):
    """How far the surface rises inside the outline over the ground beside it.

    p80 rather than the maximum, because one tree overhanging a roof
    would otherwise report a building where there is none. The ground
    reading is the median of points pushed out along each vertex's
    outward radius, which is the same trick drape_site uses and is wrong
    in the same places: on a slope, or where the outline is ringed by
    trees, it reads high and this number reads low. That direction is
    the safe one. It delays a rebuild, it never triggers a false one.
    """
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    inside = []
    y = min(ys)
    while y <= max(ys):
        x = min(xs)
        while x <= max(xs):
            if point_in_ring(x, y, ring):
                v = sampler(x, y)
                if v is not None:
                    inside.append(v)
            x += step
        y += step
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    out = []
    for px, py in ring:
        dx, dy = px - cx, py - cy
        L = math.hypot(dx, dy) or 1.0
        v = sampler(px + dx / L * out_m, py + dy / L * out_m)
        if v is not None:
            out.append(v)
    if len(inside) < 10 or not out:
        return None
    inside.sort()
    out.sort()
    p80 = inside[int(0.80 * (len(inside) - 1))]
    return p80 - out[len(out) // 2]


# ------------------------------------------------------------------ inputs

def coverage_boxes(site, footprints_path):
    d = json.loads(Path(footprints_path).read_text())
    site_d = d.get("sites", {}).get(site)
    if not site_d:
        sys.exit(f"no coverage for site '{site}' in {footprints_path}")
    out = []
    for r in site_d.get("coverage", []):
        xs = [p[0] for p in r["ring"]]
        ys = [p[1] for p in r["ring"]]
        out.append((r.get("build", "?"), min(xs), max(xs), min(ys), max(ys)))
    return out


def watch_list(osm_path, boxes, min_area, min_height, local_dhm):
    """Footprints inside coverage that currently produce no geometry.

    Two sets, reported separately because they need different fixes if
    they ever resolve: a tag-excluded one needs the tag re-read, a
    height-excluded one is already allowed through and just needs the
    rebuild.
    """
    utm32n, is_solid_building, ring_area = _pipeline_helpers()
    els = json.loads(Path(osm_path).read_text())["elements"]

    def in_coverage(lon, lat):
        for name, x0, x1, y0, y1 in boxes:
            if x0 <= lon <= x1 and y0 <= lat <= y1:
                return name
        return None

    out = []
    for e in els:
        g = e.get("geometry") or []
        if len(g) < 4:
            continue
        b = e["bounds"]
        lon = (b["minlon"] + b["maxlon"]) / 2
        lat = (b["minlat"] + b["maxlat"]) / 2
        build = in_coverage(lon, lat)
        if not build:
            continue
        ring = [utm32n(p["lon"], p["lat"]) for p in g]
        area = ring_area(ring)
        if area < min_area:
            continue
        tags = e.get("tags") or {}
        bt = tags.get("building")
        if bt in UNFINISHED:
            why = f"building={bt}"
        elif is_solid_building(tags, area):
            h = local_dhm(ring) if local_dhm else None
            if h is None or h >= min_height:
                continue
            why = "no height"
        else:
            continue
        out.append({
            "way": e["id"], "build": build, "area_m2": round(area),
            "reason": why, "lon": round(lon, 5), "lat": round(lat, 5),
            "ring": [[round(x, 2), round(y, 2)] for x, y in ring],
        })
    out.sort(key=lambda r: -r["area_m2"])
    return out


def window_for(ring, margin_m):
    """The bounding box of an outline plus the ground ring around it."""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (math.floor(min(xs) - margin_m), math.floor(min(ys) - margin_m),
            math.ceil(max(xs) + margin_m), math.ceil(max(ys) + margin_m))


# -------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default="billund")
    ap.add_argument("--osm", default=str(HERE / "work/osm_billund_wide.json"),
                    help="the OSM extract the mesh was built from")
    ap.add_argument("--footprints",
                    default=str(HERE.parent.parent / "src/data/building_footprints.json"),
                    help="coverage rectangles, so the watch list cannot drift "
                         "from what was actually built")
    ap.add_argument("--dhm", default=str(HERE / "work/dhm"),
                    help="local height tiles, used only to seed the watch list")
    ap.add_argument("--baseline", default=str(HERE / "work/height_watch_baseline.json"))
    ap.add_argument("--min-area", type=float, default=500.0,
                    help="ignore footprints smaller than this; below it the "
                         "noise in the ground estimate swamps the signal")
    ap.add_argument("--min-height", type=float, default=2.0,
                    help="matches drape_site's own --min-height")
    ap.add_argument("--trigger", type=float, default=3.0,
                    help="metres of new height that counts as 'it got built'")
    ap.add_argument("--res", type=float, default=1.0,
                    help="metres per pixel to request; the model is natively "
                         "0.4 m and this question does not need that")
    ap.add_argument("--margin", type=float, default=15.0,
                    help="ground to fetch around each outline, for the "
                         "reading the roof is compared against")
    ap.add_argument("--token", default=None)
    ap.add_argument("--save-baseline", action="store_true",
                    help="record today's readings as the new normal")
    ap.add_argument("--json", action="store_true", help="machine-readable report")
    ap.add_argument("--export-watchlist", metavar="PATH",
                    help="derive the watch list, write it there, and stop")
    ap.add_argument("--watchlist", metavar="PATH",
                    help="read the watch list from PATH instead of deriving it "
                         "from --osm and --footprints")
    a = ap.parse_args()

    token = load_env_token(a.token)
    if not token:
        print("no DATAFORSYNINGEN_API_TOKEN found (env, --token, or .env.local)",
              file=sys.stderr)
        return 2

    if a.watchlist and not a.export_watchlist:
        # Running from a pre-derived list. This is the mode the monthly
        # job uses, and the reason it exists is access, not speed: a
        # launchd agent does not inherit the Terminal's permission to
        # read ~/Desktop, so it cannot see the repository at all. The
        # watch list is small and only changes when the mesh is rebuilt,
        # so it is exported next to the job and the job needs nothing
        # but that file and the network.
        wl = json.loads(Path(a.watchlist).read_text())
        entries = wl["entries"]
        print(f"{a.site}: watch list from {a.watchlist} "
              f"(derived {wl.get('derived_at', 'unknown')})", file=sys.stderr)
    else:
        boxes = coverage_boxes(a.site, a.footprints)
        local = None
        dhm_dir = Path(a.dhm)
        if dhm_dir.exists():
            from dhm import DHM
            try:
                d = DHM(str(dhm_dir), COVERAGE)
                local = lambda ring: stands_above_ground(ring, d.at)   # noqa: E731
            except SystemExit:
                local = None
        entries = watch_list(a.osm, boxes, a.min_area, a.min_height, local)

    if not entries:
        print(f"{a.site}: nothing to watch")
        return 0

    if a.export_watchlist:
        p = Path(a.export_watchlist)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({
            "site": a.site,
            "derived_at": time.strftime("%Y-%m-%d"),
            "min_area_m2": a.min_area,
            "min_height_m": a.min_height,
            "source_osm": str(Path(a.osm).resolve()),
            "entries": entries,
        }, indent=2))
        print(f"watch list: {len(entries)} footprints -> {p}")
        return 0

    print(f"{a.site}: watching {len(entries)} footprints, "
          f"{len(entries)} windows at {a.res} m", file=sys.stderr)

    base = {}
    bp = Path(a.baseline)
    if bp.exists():
        base = {str(k): v for k, v in json.loads(bp.read_text()).get("readings", {}).items()}

    readings, risen, failed = {}, [], []
    for n, r in enumerate(entries, 1):
        e0, n0, e1, n1 = window_for(r["ring"], a.margin)
        try:
            ras = fetch_window(e0, n0, e1, n1, a.res, token)
        except Exception as err:        # noqa: BLE001
            failed.append((r["way"], str(err)))
            print(f"  [{n}/{len(entries)}] way {r['way']}: {err}", file=sys.stderr)
            continue
        h = stands_above_ground(r["ring"], ras.at, step=max(1.0, a.res))
        if h is None:
            failed.append((r["way"], "too few valid samples"))
            continue
        readings[str(r["way"])] = round(h, 2)
        was = base.get(str(r["way"]))
        if h >= a.trigger and (was is None or was < a.trigger):
            risen.append({**{k: v for k, v in r.items() if k != "ring"},
                          "was_m": was, "now_m": round(h, 2)})

    # A footprint we could not read is not a footprint that has not changed.
    # Saying so is the difference between a monitor and a rubber stamp.
    if failed:
        print(f"\n{len(failed)} of {len(entries)} could not be read:", file=sys.stderr)
        for way, why in failed[:10]:
            print(f"  way {way}: {why}", file=sys.stderr)
        if len(failed) > len(entries) // 2:
            print("more than half the watch list failed; not reporting a result",
                  file=sys.stderr)
            return 2

    report = {"site": a.site, "watched": len(readings), "risen": risen,
              "trigger_m": a.trigger}

    if a.save_baseline:
        bp.parent.mkdir(parents=True, exist_ok=True)
        bp.write_text(json.dumps(
            {"site": a.site, "trigger_m": a.trigger, "readings": readings},
            indent=2))
        print(f"baseline saved: {len(readings)} readings -> {bp}")
        return 0

    if a.json:
        print(json.dumps(report, indent=2))
    elif risen:
        print(f"\nHEIGHT MODEL REFRESHED over {a.site}. "
              f"{len(risen)} footprint(s) now stand:\n")
        for r in risen:
            was = "no baseline" if r["was_m"] is None else f"{r['was_m']} m"
            print(f"  {r['area_m2']:>7} m2  way {r['way']:<12} "
                  f"{r['lon']},{r['lat']}  {was} -> {r['now_m']} m  ({r['reason']})")
        print("\nRebuild:  refetch the height tiles, rebuild the affected build "
              "boxes, re-upload. See PLAYBOOK.md.")
    else:
        print(f"{a.site}: {len(readings)} watched, none has gained height "
              f"(trigger {a.trigger} m). Nothing to do.")

    return 1 if risen else 0


if __name__ == "__main__":
    sys.exit(main())
