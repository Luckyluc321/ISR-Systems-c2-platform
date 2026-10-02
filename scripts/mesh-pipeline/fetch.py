#!/usr/bin/env python3
"""
Fetch Skråfoto imagery and camera poses for a bounding box.

Denmark publishes nationwide oblique aerial photography as open data,
and publishes the camera orientation with every image. That second part
is why this pipeline is tractable: normal photogrammetry has to solve
where the cameras were, from the pictures alone, before it can do
anything else. Here the national mapping agency has already solved it.

So this script does two things: pull the images, and write the poses out
in a form a dense-stereo stage can consume without re-deriving anything.

Usage:
    python3 fetch.py --bbox 9.145,55.735,9.172,55.746 --out ./work/billund
    python3 fetch.py --site billund --out ./work/billund
    python3 fetch.py --site billund --dry-run          # count, download nothing

The token is read from VITE_SDFI_TOKEN in the repo's .env.local, so
there is no second place to keep a credential.
"""

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.dataforsyningen.dk/rest/skraafoto_api/v2"
DEFAULT_COLLECTION = "skraafotos2025"

# Convenience boxes so a run does not start with someone hand-typing
# coordinates. Deliberately tight: dense stereo scales badly, and a
# small area that reconstructs is worth more than a large one that runs
# for six hours and fails.
#
# EVERY BOX MUST BE DERIVED FROM BUILDING FOOTPRINTS, NOT TYPED BY HAND.
# `python3 pick_bbox.py --osm <file> --name <substring>` prints one.
#
# The first "billund-terminal" box was typed from memory as
# 9.150,55.739,9.160,55.744. It is the runway and apron: it contains
# ZERO buildings. Half a square kilometre of tarmac and grass was
# reconstructed at full density, and the clip to footprints then kept
# nothing, which read as a coordinate-system bug and was chased as one
# for hours. The terminal is 500 m northwest of that box.
#
# The mesh is only ever wanted for buildings, so the area worth
# reconstructing is defined by where the buildings are. Anything else
# spends the whole triangle budget on ground the map already draws.
SITE_BBOX = {
    # Billund Airport. Derived from the extent of every aeroway-tagged
    # building plus 150 m, NOT typed.
    #
    # The previous box, 9.145,55.735,9.172,55.746, was typed and started
    # 1.4 km too far east: it missed five of the ten hangars, including
    # the two largest. Same mistake as the terminal box, found the same
    # way, by asking the footprints where the buildings are.
    # 5.13 km2, 232 buildings, 10 hangars, the terminal and the tower.
    "billund": (9.1228, 55.7329, 9.1718, 55.7479),
    # The terminal itself, plus the P2 and P4 decks.
    # 14 footprints, 43k m2 of roof, terminal alone 21k m2.
    "billund-terminal": (9.14189, 55.74272, 9.15307, 55.74900),
}


# Both names are accepted. The app reads VITE_SDFI_TOKEN because Vite
# only exposes VITE_-prefixed variables to the browser; a token used by
# these scripts has no such constraint and DATAFORSYNINGEN_TOKEN says
# plainly whose token it is.
TOKEN_KEYS = ("DATAFORSYNINGEN_TOKEN", "VITE_SDFI_TOKEN")


def load_token() -> str:
    """Read the Dataforsyningen token from the environment or .env.local.

    Never printed, never written to the output tree.
    """
    for key in TOKEN_KEYS:
        env = os.environ.get(key)
        if env:
            return env.strip()
    env_path = Path(__file__).resolve().parents[2] / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            for key in TOKEN_KEYS:
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(
        "No Dataforsyningen token. Set " + " or ".join(TOKEN_KEYS)
        + " in the environment or in .env.local at the repo root."
    )


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=90) as r:
        return json.load(r)


def search(bbox, collection: str, token: str, limit: int = 500) -> list:
    """All items covering the bbox. Paged, because a busy area exceeds
    one page and a silently truncated image set produces a mesh with
    holes in it that nobody traces back to here."""
    items, url = [], (
        f"{API}/collections/{collection}/items?"
        + urllib.parse.urlencode(
            {"bbox": ",".join(str(v) for v in bbox), "limit": limit, "token": token}
        )
    )
    while url:
        page = get_json(url)
        items.extend(page.get("features", []))
        nxt = next(
            (l for l in page.get("links", []) if l.get("rel") == "next"), None
        )
        url = nxt.get("href") if nxt else None
        if url and "token=" not in url:
            url += ("&" if "?" in url else "?") + f"token={token}"
    return items


# The trailing "100mm" in an image id is a CDN PRODUCT TIER, not a
# focal length. Every image over Billund ends in `_100mm` while the real
# focal lengths are 79.6 mm (nadir) and 123.38 mm (oblique).
#
# An earlier version of this file parsed that suffix as focal length and
# was wrong on 100% of images, by -19% on obliques and +26% on nadir.
# Kept only as a cross-check that shouts if anyone reintroduces it.
_TIER_RE = re.compile(r"_(\d+)mm$")


def interior_of(item: dict) -> dict:
    """Interior orientation, published per image by SDFI.

    This is the real camera model and it is on every item: focal length,
    principal point offset, pixel spacing, sensor dimensions, and the
    calibration date. SDFI's own SAUL library reads exactly these six
    fields and applies plain collinearity with no distortion terms, so
    that is the sanctioned model rather than a simplification.

    There are SIX distinct cameras over Billund, not one. Nadir is a
    different head from the obliques, and the left/right cones carry a
    6.68 mm principal point offset that the forward/backward cones do
    not. Binding every image to one shared intrinsic would corrupt the
    nadir images against the obliques, so this is emitted per image.
    """
    p = item.get("properties", {})
    io = p.get("pers:interior_orientation") or {}
    if not io:
        return {}
    return {
        "camera_id": io.get("camera_id"),
        "focal_length_mm": io.get("focal_length"),
        "principal_point_offset_mm": io.get("principal_point_offset"),
        "pixel_spacing_mm": io.get("pixel_spacing"),
        "sensor_array_dimensions_px": io.get("sensor_array_dimensions"),
        "calibration_date": io.get("calibration_date"),
    }


def pose_of(item: dict) -> dict:
    """Exterior orientation, flattened into something a stereo stage can
    read without knowing anything about STAC."""
    p = item.get("properties", {})
    return {
        "id": item.get("id"),
        "direction": p.get("direction"),
        "datetime": p.get("datetime"),
        "gsd": p.get("gsd"),
        "interior": interior_of(item),
        "omega": p.get("pers:omega"),
        "phi": p.get("pers:phi"),
        "kappa": p.get("pers:kappa"),
        "perspective_center": p.get("pers:perspective_center"),
        "rotation_matrix": p.get("pers:rotation_matrix"),
        "crs": p.get("pers:crs"),
        "vertical_crs": p.get("pers:vertical_crs"),
    }


def download(url: str, dest: Path, token: str) -> bool:
    """Fetch one image, and refuse to accept a short one.

    The length check is the whole point. An interrupted read finishes
    without raising: the server simply stops sending, `read()` returns
    empty, and the file is renamed into place looking complete. The
    header survives that, so the file still identifies as a valid TIFF
    of the right dimensions, and the failure only appears much later
    when a decoder reaches the missing pixels and reports "Not a JPEG
    file". Six of the first sixty-eight images arrived this way.

    So the size is compared against Content-Length, and a resumed run
    re-checks files already on disk rather than trusting that a
    non-empty file is a whole one.
    """
    if "token=" not in url:
        url += ("&" if "?" in url else "?") + f"token={token}"

    expected = None
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, method="HEAD"), timeout=60
        ) as h:
            expected = int(h.headers.get("content-length") or 0) or None
    except Exception:
        pass  # no HEAD is not fatal; the post-download check still applies

    if dest.exists() and dest.stat().st_size > 0:
        if expected is None or dest.stat().st_size == expected:
            return False
        print(f"  re-fetching {dest.name}: {dest.stat().st_size} bytes on disk, {expected} expected")
        dest.unlink()

    tmp = dest.with_suffix(dest.suffix + ".part")
    written = 0
    with urllib.request.urlopen(url, timeout=600) as r, open(tmp, "wb") as f:
        declared = int(r.headers.get("content-length") or 0) or expected
        while chunk := r.read(1 << 20):
            f.write(chunk)
            written += len(chunk)

    if declared and written != declared:
        tmp.unlink(missing_ok=True)
        raise IOError(f"truncated: got {written} of {declared} bytes")

    tmp.rename(dest)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bbox", help="minLon,minLat,maxLon,maxLat")
    ap.add_argument("--site", choices=sorted(SITE_BBOX), help="a known site box")
    ap.add_argument("--collection", default=DEFAULT_COLLECTION)
    ap.add_argument("--out", default="./work/out")
    ap.add_argument("--dry-run", action="store_true", help="count only")
    ap.add_argument("--direction", action="append",
                    choices=["nadir", "north", "south", "east", "west"],
                    help="only these look directions; repeatable. Roofs need "
                         "only nadir, and one nadir frame covers about 2 km, "
                         "so this is most of the download saved")
    a = ap.parse_args()

    if a.site:
        bbox = SITE_BBOX[a.site]
    elif a.bbox:
        bbox = tuple(float(v) for v in a.bbox.split(","))
    else:
        ap.error("give --site or --bbox")

    token = load_token()
    items = search(bbox, a.collection, token)
    if not items:
        sys.exit(f"No imagery in {a.collection} for bbox {bbox}.")

    by_dir = {}
    for it in items:
        by_dir.setdefault(it["properties"].get("direction"), []).append(it)

    print(f"{a.collection}  bbox={bbox}")
    print(f"{len(items)} images: " + ", ".join(f"{k} {len(v)}" for k, v in sorted(by_dir.items())))

    if a.direction:
        want = set(a.direction)
        items = [i for i in items if i["properties"].get("direction") in want]
        by_dir = {k: v for k, v in by_dir.items() if k in want}
        print(f"--direction {'/'.join(sorted(want))}: keeping {len(items)} images")
        if not items:
            sys.exit("No image in the requested direction(s).")

    # Five directions is what reconstructs facades rather than only
    # roofs. Fewer is not fatal but it is worth knowing before a long run.
    missing = {"nadir", "north", "south", "east", "west"} - set(by_dir)
    if missing and not a.direction:
        print(f"WARNING: no imagery from {', '.join(sorted(missing))}. Facades on those sides will be poor.")

    poses = [pose_of(i) for i in items]
    no_pose = [p["id"] for p in poses if not p["perspective_center"]]
    if no_pose:
        print(f"WARNING: {len(no_pose)} image(s) carry no exterior orientation and are unusable.")
    no_io = [p["id"] for p in poses if not p.get("interior", {}).get("focal_length_mm")]
    if no_io:
        print(f"WARNING: {len(no_io)} image(s) carry no interior orientation and are unusable.")

    # One camera per distinct calibration. The stereo stage needs this
    # grouping, and seeing it here catches a collection that silently
    # mixes two survey systems.
    cams = {}
    for pz in poses:
        io = pz.get("interior") or {}
        key = (io.get("camera_id"), io.get("focal_length_mm"),
               tuple(io.get("principal_point_offset_mm") or []))
        cams.setdefault(key, 0)
        cams[key] += 1
    print(f"{len(cams)} distinct camera(s):")
    for (cid, fl, pp), n in sorted(cams.items(), key=lambda kv: -kv[1]):
        print(f"  n={n:3d}  focal={fl}mm  principal_point_offset={list(pp)}  {cid}")

    # Loud cross-check. If this ever fires, someone has gone back to
    # reading focal length off the filename.
    tiers = {int(m.group(1)) for pz in poses if (m := _TIER_RE.search(pz["id"]))}
    focals = {io.get("focal_length_mm") for pz in poses if (io := pz.get("interior"))}
    if tiers and focals and not (tiers & {f for f in focals if f}):
        print(f"note: filename tier {sorted(tiers)} is NOT the focal length "
              f"{sorted(f for f in focals if f)}. It is a CDN product tier. Do not parse it.")

    if a.dry_run:
        print("dry run, nothing downloaded")
        return

    out = Path(a.out)
    (out / "images").mkdir(parents=True, exist_ok=True)

    # MERGE with any poses already recorded, never overwrite.
    #
    # A --direction run otherwise throws away the camera models for every
    # image fetched by an earlier run. Fetching the nadirs for roofs and
    # then the obliques for walls left poses.json describing only the
    # obliques, while 54 nadir TIFFs sat on disk with no way to project
    # into them. The images survive that; the camera models do not, and
    # nothing downstream can tell the difference until it finds no frame
    # that sees a roof.
    merged = {}
    existing = out / "poses.json"
    if existing.exists():
        try:
            prev = json.loads(existing.read_text()).get("images", [])
            for p in prev:
                if p.get("id"):
                    merged[p["id"]] = p
        except Exception as err:
            print(f"WARNING: could not read existing poses.json ({err}); starting fresh")
    before = len(merged)
    for p in poses:
        if p.get("id"):
            merged[p["id"]] = p
    allposes = list(merged.values())
    (out / "poses.json").write_text(
        json.dumps({"collection": a.collection, "bbox": bbox,
                    "images": allposes}, indent=2)
    )
    kept = before - (len(merged) - len(poses)) if before else 0
    print(f"wrote {out/'poses.json'}  ({len(allposes)} poses, "
          f"{len(poses)} from this run, {max(0, len(allposes)-len(poses))} kept from earlier)")

    fetched = skipped = failed = 0
    for n, it in enumerate(items, 1):
        asset = (it.get("assets") or {}).get("data") or {}
        href = asset.get("href")
        if not href:
            failed += 1
            continue
        dest = out / "images" / f"{it['id']}.tif"
        try:
            if download(href, dest, token):
                fetched += 1
            else:
                skipped += 1
        except Exception as e:  # keep going: one bad asset must not end the run
            failed += 1
            print(f"  [{n}/{len(items)}] {it['id']} FAILED: {e}")
        if n % 10 == 0 or n == len(items):
            print(f"  [{n}/{len(items)}] fetched {fetched}, already had {skipped}, failed {failed}")

    print(f"\ndone. {fetched} fetched, {skipped} already present, {failed} failed")
    print(f"images: {out/'images'}")
    print("next: resolve interior orientation, then dense stereo on this set. See README.md")


if __name__ == "__main__":
    main()
