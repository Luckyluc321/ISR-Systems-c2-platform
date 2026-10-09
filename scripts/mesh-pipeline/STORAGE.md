# What to keep, what to delete, how to get it back

This pipeline downloads tens of gigabytes per site. Almost none of it is
precious, and knowing which part is precious is the whole point of this
file.

**Nothing under `work/` is in git, and nothing under `work/` should be.**
The imagery is free public data from Klimadatastyrelsen, individual
files are 60 to 140 MB against GitHub's 100 MB limit, and storing it in
Git LFS would cost money to hold a copy of something the Danish state
already hosts. Push the scripts; refetch the data.

## The rule

| | keep | why |
| --- | --- | --- |
| `scripts/mesh-pipeline/*.py` | **yes, in git** | the only thing that is not reproducible |
| `src/data/building_footprints.json` | **yes, in git** | small, and the app reads it |
| `work/<site>/tiles/` | yes, locally | the output. ~16 MB. Deploys to object storage |
| `work/<site>/drape/` | yes, locally | atlas and OBJ, ~6 MB, rebuild takes minutes |
| `work/dhm/` | yes, locally | slow to refetch, the service is rate limited |
| `work/<site>/images/` | **delete when done** | 20-30 GB per site, refetches in under an hour |
| `work/<site>/odm/` | **delete** | photogrammetry reconstruction, no longer used at all |

## Regenerating a site from nothing

Everything below is reproducible from the scripts plus a Dataforsyningen
token in `.env.local`. Timings are from the Billund Airport run,
5.1 km² and 232 buildings.

```bash
cd scripts/mesh-pipeline

# 1. Footprints. Overpass, no token needed. Seconds.
#    Widen the bbox to whatever the site needs.
curl -s https://overpass-api.de/api/interpreter --data-urlencode 'data=
  [out:json][timeout:120];
  way["building"](55.7196,9.0989,55.7596,9.2004);
  out geom;' > /tmp/osm_buildings.json

# 2. Imagery. Nadir only for roofs; one nadir frame covers about 2 km.
#    54 frames, 19 GB, about 40 minutes.
python3 fetch.py --site billund --direction nadir --out ./work/billund-airport
#    Walls additionally need the obliques: 176 frames, another 9 GB.
python3 fetch.py --site billund --direction north --direction south \
                 --direction east --direction west --out ./work/billund-airport

# 3. Heights. 24 tiles, 573 MB, about 25 minutes. Rate limited, retries
#    built in. THIS IS THE SLOW ONE, keep it if you can.
python3 fetch_dhm.py --site billund --out work/dhm

# 4. Build. Minutes.
python3 drape_site.py --poses work/billund-airport/poses.json \
  --osm /tmp/osm_buildings.json --dhm work/dhm \
  --bbox 9.1228,55.7329,9.1718,55.7479 \
  --out work/billund-airport/drape --gsd 0.12 --wall-gsd 0.20

# 5. Tile. Seconds. BOTH steps are load bearing, see RECIPE.md.
python3 to_yup.py --in  work/billund-airport/drape/site.obj \
                  --out work/billund-airport/drape/site_yup.obj
rm -rf work/billund-airport/tiles
PARENT=$(cd work/billund-airport && pwd)
docker run --rm --entrypoint /code/SuperBuild/install/bin/Obj2Tiles \
  -v "$PARENT":/datasets opendronemap/odm:latest \
  /datasets/drape/site_yup.obj /datasets/tiles \
  --divisions 3 --lat 55.740374285 --lon 9.146054746 --alt 0.0
python3 unlit_tiles.py --tiles work/billund-airport/tiles

# 6. Serve.
python3 serve_tiles.py 8778 work/billund-airport/tiles
```

The `--lat/--lon` for step 5 come from `drape/origin.json`, which step 4
writes.

## Reclaiming space

Once a site's `tiles/` and `drape/` exist and look right, its imagery has
done its job:

```bash
du -sh work/*/images          # see the cost
rm -rf work/<site>/images     # 20-30 GB back, refetchable in under an hour
```

Keep `work/dhm/`. It is small and the slowest thing to replace.

## What was deleted on 2026-10-01, and why

52 GB down to 28 GB, with no loss of anything reproducible:

- `work/billund-terminal`, 11 GB. The bounding box was typed from memory
  and landed on the **runway**, which contains zero buildings. Dead on
  arrival, see RECIPE.md.
- `work/bt-terminal`, 9.8 GB. Terminal-only fetch, made redundant once
  `billund-airport` covered the same ground in all five directions.
- `work/bt-dense`, 2.6 GB. Dense photogrammetric reconstruction,
  superseded when the method changed from reconstructing geometry out of
  the photographs to draping the photographs onto geometry.
- `work/_KNOWN_GOOD`, 450 MB. Write-protected copy of that same
  photogrammetry output, kept against losing a good result. The approach
  it protected is no longer used.
