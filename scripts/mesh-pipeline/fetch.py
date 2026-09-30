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
SITE_BBOX = {
    # Billund Airport, aerodrome and terminal.
    "billund": (9.145, 55.735, 9.172, 55.746),
    # Just the terminal and apron. Start here.
    "billund-terminal": (9.150, 55.739, 9.160, 55.744),
}


def load_token() -> str:
    """Read VITE_SDFI_TOKEN from the repo .env.local.

    Falls back to the environment so CI or a workstation can supply it
    without a file. Never printed, never written to the output tree.
    """
    env = os.environ.get("VITE_SDFI_TOKEN")
    if env:
        return env.strip()
    env_path = Path(__file__).resolve().parents[2] / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("VITE_SDFI_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(
        "No Dataforsyningen token. Set VITE_SDFI_TOKEN in the environment "
        "or in .env.local at the repo root."
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


def focal_mm_from_id(item_id: str):
    """Focal length is encoded in the image id, e.g. `..._100mm`.

    Interior orientation is the one genuinely open question in this
    pipeline, and this recovers only part of it. Principal point and
    lens distortion still need confirming against SDFI's own SAUL
    library before dense stereo can be trusted. Recorded per image so
    that work has something to check against.
    """
    m = re.search(r"_(\d+)mm$", item_id)
    return int(m.group(1)) if m else None


def pose_of(item: dict) -> dict:
    """Exterior orientation, flattened into something a stereo stage can
    read without knowing anything about STAC."""
    p = item.get("properties", {})
    return {
        "id": item.get("id"),
        "direction": p.get("direction"),
        "datetime": p.get("datetime"),
        "gsd": p.get("gsd"),
        "focal_mm": focal_mm_from_id(item.get("id", "")),
        "omega": p.get("pers:omega"),
        "phi": p.get("pers:phi"),
        "kappa": p.get("pers:kappa"),
        "perspective_center": p.get("pers:perspective_center"),
        "rotation_matrix": p.get("pers:rotation_matrix"),
        "crs": p.get("pers:crs"),
        "vertical_crs": p.get("pers:vertical_crs"),
    }


def download(url: str, dest: Path, token: str) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return False  # resumable: a part-finished run continues
    if "token=" not in url:
        url += ("&" if "?" in url else "?") + f"token={token}"
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=300) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(dest)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bbox", help="minLon,minLat,maxLon,maxLat")
    ap.add_argument("--site", choices=sorted(SITE_BBOX), help="a known site box")
    ap.add_argument("--collection", default=DEFAULT_COLLECTION)
    ap.add_argument("--out", default="./work/out")
    ap.add_argument("--dry-run", action="store_true", help="count only")
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

    # Five directions is what reconstructs facades rather than only
    # roofs. Fewer is not fatal but it is worth knowing before a long run.
    missing = {"nadir", "north", "south", "east", "west"} - set(by_dir)
    if missing:
        print(f"WARNING: no imagery from {', '.join(sorted(missing))}. Facades on those sides will be poor.")

    poses = [pose_of(i) for i in items]
    no_pose = [p["id"] for p in poses if not p["perspective_center"]]
    if no_pose:
        print(f"WARNING: {len(no_pose)} image(s) carry no exterior orientation and are unusable.")
    no_focal = [p["id"] for p in poses if not p["focal_mm"]]
    if no_focal:
        print(f"WARNING: {len(no_focal)} image(s) have no focal length in their id.")

    if a.dry_run:
        print("dry run, nothing downloaded")
        return

    out = Path(a.out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "poses.json").write_text(
        json.dumps({"collection": a.collection, "bbox": bbox, "images": poses}, indent=2)
    )
    print(f"wrote {out/'poses.json'}")

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
