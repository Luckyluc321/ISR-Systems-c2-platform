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
| `work/osm_*.json` | yes, locally | 3 MB of footprints, and Overpass is rate limited and occasionally hostile. Cheap to keep, annoying to refetch |
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
#    Widen the bbox to whatever the site needs. Note the bbox order is
#    south,west,north,east — the opposite of every other tool here.
#
#    THE USER AGENT IS LOAD BEARING. Overpass answers curl's default
#    agent with 406 Not Acceptable and an HTML body, which `curl -s`
#    writes to the output file without complaint. You then get
#    "Expecting value: line 1 column 1" from json.load one step later and
#    go looking for a parser bug. Send an agent, and check the body is
#    really JSON before trusting it.
curl -sS -H 'User-Agent: ISR-Labs mesh-pipeline (contact: you@example.com)' \
  -H 'Accept: application/json' \
  https://overpass-api.de/api/interpreter --data-urlencode 'data=
  [out:json][timeout:180];
  way["building"](55.7196,9.0989,55.7596,9.2004);
  out geom;' -o work/osm_billund_town.json
python3 -c "import json;print(len(json.load(open('work/osm_billund_town.json'))['elements']),'footprints')"

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

## Billund today: three builds, one tileset

Billund is not one build. Three runs share the same imagery and height
tiles and are composed by `combine_tilesets.py`, which the app loads as a
single URL.

| build | buildings | texture | tiles | what it is |
| --- | --- | --- | --- | --- |
| `billund-airport` | 232 | 0.12 m/px, roofs **and walls** | 16 MB | the terminal and airside. All five camera directions were fetched, so walls are photographic |
| `billund-city` | 2,367 | 0.20 m/px, roofs only | 68 MB | the town core: Lalandia, the centre, the housing around it |
| `billund-outer` | 1,144 | 0.20 m/px, roofs only | 16 MB | everything else inside the town box: the eastern wedge, the western edge, the outlying scatter |

Separate runs rather than one, because each keeps its own atlas, texture
resolution and local origin, and rebuilding one does not rebuild the
others. A terminal and a holiday cottage do not belong in one atlas.

`billund-outer` is built from the **whole** town box with the other two
boxes excluded, so no building is drawn twice:

```bash
python3 drape_site.py \
  --poses work/billund-city/poses.json \
  --osm work/osm_billund_town.json --dhm work/dhm \
  --bbox 9.0989,55.7196,9.2004,55.7596 \
  --exclude-bbox 9.1228,55.7329,9.1718,55.7479 \
  --exclude-bbox 9.10441,55.71595,9.14589,55.73931 \
  --out work/billund-outer/drape --gsd 0.20
```

Cost scales with building count, not box area, so one big box with holes
beats ten small boxes. Then the usual `to_yup.py` → Obj2Tiles →
`unlit_tiles.py`, and recompose:

```bash
python3 combine_tilesets.py --out work/billund-combined \
  --child billund-airport:work/billund-airport/tiles:9.1228,55.7329,9.1718,55.7479 \
  --child billund-city:work/billund-city/tiles:9.10441,55.71595,9.14589,55.73931 \
  --child billund-outer:work/billund-outer/tiles:9.0989,55.7196,9.2004,55.7596
```

Children overlap on purpose: the outer box contains the other two. The
parent uses `refine: ADD`, so children are additive and the exclusions,
not the regions, are what prevent double-drawing.

**Walls are only photographic at the airport.** The town fetch was nadir
only, so `billund-city` and `billund-outer` report "0 walls have an
oblique that sees them" and fall back to flat colour. Roofs land
correctly either way, which is what you see from any realistic camera
angle. Fixing it means fetching the four oblique directions for the town,
another ~9 GB.

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
