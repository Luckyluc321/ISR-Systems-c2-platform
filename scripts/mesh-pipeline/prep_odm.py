#!/usr/bin/env python3
"""
Turn fetched skråfoto into an OpenDroneMap project.

Two jobs:

  1. Downscale and transcode. The source images are 10560 x 14144
     JPEG-in-TIFF, about 149 megapixels and 44 MB each. Dense stereo
     cost scales with pixel count, so a full-resolution first run on a
     laptop is a day of compute to find out whether the chain works at
     all. Downscaling to a few thousand pixels makes that a coffee
     break. Resolution goes back up once the chain is proven.

  2. Write geo.txt. This is how ODM is told where each camera was and
     which way it pointed, so it does not have to solve that from the
     pictures. Format is one header line naming the CRS, then one line
     per image:

         image_name  x  y  z  omega  phi  kappa

Usage:
    python3 prep_odm.py --work ./work/billund-terminal --max-px 4000
    python3 prep_odm.py --work ./work/billund-terminal --max-px 4000 --limit 20
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required:  python3 -m pip install Pillow")

# The source TIFFs are far beyond PIL's default guard, which exists to
# stop decompression-bomb attacks. These are known national mapping
# products, not untrusted input.
Image.MAX_IMAGE_PIXELS = None


def _write_jpeg(tif: Path, dst: Path, max_px: int, quality: int) -> None:
    """Downscale one source image, reading from an overview level.

    These are Cloud Optimized GeoTIFFs carrying a pyramid: full
    resolution plus successively halved copies. Two reasons to read a
    pyramid level rather than the base image.

    It is much faster. The base image is up to 20544 x 14016, about 288
    megapixels, and the target here is a few thousand pixels. Decoding
    the full frame to throw away 98 per cent of it is wasted work.

    And on this dataset the base image frequently does not decode at
    all. Both Pillow and ImageMagick fail on it with "Not a JPEG file:
    starts with 0x00 0x00" on files that are complete and the right
    size, while every pyramid level in the same file decodes cleanly. So
    the overview is not a fallback here, it is the reliable path.

    Picks the smallest level still at or above the target, so quality is
    preserved without decoding more than necessary.
    """
    with Image.open(tif) as im:
        levels = []
        for page in range(getattr(im, "n_frames", 1)):
            try:
                im.seek(page)
                levels.append((page, max(im.size)))
            except Exception:
                break

        usable = [(pg, w) for pg, w in levels if w >= max_px] or levels
        page = min(usable, key=lambda t: t[1])[0] if usable else 0

        last_err = None
        # Walk downward if the chosen level is one of the broken ones.
        for pg in [page] + [p for p, _ in sorted(levels, key=lambda t: -t[1]) if p != page]:
            try:
                im.seek(pg)
                out = im.convert("RGB")
                out.thumbnail((max_px, max_px), Image.LANCZOS)
                out.save(dst, "JPEG", quality=quality)
                return
            except Exception as e:
                last_err = e
        raise OSError(f"no decodable pyramid level ({last_err})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", required=True, help="directory holding images/ and poses.json")
    ap.add_argument("--max-px", type=int, default=4000, help="longest edge after downscale")
    ap.add_argument("--quality", type=int, default=92)
    ap.add_argument("--limit", type=int, help="only the first N images, for a fast smoke test")
    a = ap.parse_args()

    work = Path(a.work)
    poses_path = work / "poses.json"
    if not poses_path.exists():
        sys.exit(f"No poses.json in {work}. Run fetch.py first.")
    poses = {p["id"]: p for p in json.loads(poses_path.read_text())["images"]}

    src_dir = work / "images"
    out = work / "odm"
    img_out = out / "images"
    img_out.mkdir(parents=True, exist_ok=True)

    tifs = sorted(src_dir.glob("*.tif"))
    if a.limit:
        tifs = tifs[: a.limit]
    if not tifs:
        sys.exit(f"No .tif in {src_dir}")

    print(f"{len(tifs)} images -> {img_out}  (longest edge {a.max_px}px)")

    geo_lines, done, skipped = [], 0, 0
    for n, tif in enumerate(tifs, 1):
        stem = tif.stem
        pose = poses.get(stem)
        if not pose or not pose.get("perspective_center"):
            # An image with no exterior orientation cannot be placed, and
            # feeding it in unplaced would make ODM solve for it and
            # quietly undo the whole reason this pipeline is cheap.
            print(f"  skip {stem}: no exterior orientation")
            skipped += 1
            continue

        dst = img_out / f"{stem}.jpg"
        if not dst.exists():
            try:
                _write_jpeg(tif, dst, a.max_px, a.quality)
            except Exception as e:
                print(f"  skip {stem}: {e}")
                skipped += 1
                continue
        x, y, z = pose["perspective_center"]
        geo_lines.append(
            f"{dst.name} {x:.3f} {y:.3f} {z:.3f} "
            f"{pose['omega']:.6f} {pose['phi']:.6f} {pose['kappa']:.6f}"
        )
        done += 1
        if n % 10 == 0 or n == len(tifs):
            print(f"  [{n}/{len(tifs)}] {done} written, {skipped} skipped")

    # EPSG comes from the poses themselves rather than being hardcoded,
    # so a collection in another zone does not silently land in the wrong
    # place.
    crs = {str(p.get("crs")) for p in poses.values() if p.get("crs")}
    if len(crs) != 1:
        sys.exit(f"Expected one horizontal CRS across the set, found {crs or 'none'}")
    epsg = crs.pop()

    (out / "geo.txt").write_text(f"EPSG:{epsg}\n" + "\n".join(geo_lines) + "\n")
    print(f"\nwrote {out/'geo.txt'}  ({len(geo_lines)} cameras, EPSG:{epsg})")

    # Heights are DVR90, an orthometric system. ODM will keep whatever it
    # is given, so this note follows the data rather than being
    # rediscovered when the mesh loads 40 m underground in Cesium.
    vcrs = {str(p.get("vertical_crs")) for p in poses.values() if p.get("vertical_crs")}
    if vcrs:
        (out / "VERTICAL_DATUM.txt").write_text(
            f"Camera Z values are in vertical CRS EPSG:{'/'.join(sorted(vcrs))} (DVR90, orthometric).\n"
            "Cesium expects ellipsoidal height. Geoid separation over Denmark is roughly 36-40 m.\n"
            "Convert before tiling, or the mesh sits about 40 m underground.\n"
        )
        print(f"wrote {out/'VERTICAL_DATUM.txt'}  (vertical CRS {'/'.join(sorted(vcrs))})")

    print(f"\nODM project ready: {out}")
    print("next:  see run_odm.sh")


if __name__ == "__main__":
    main()
