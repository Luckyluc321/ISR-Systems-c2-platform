# Any Danish town to photographic 3D, from nothing

The repeatable version of what was done to Billund. Ten steps, no Google,
no Cesium ion, no licence that can be withdrawn. Everything comes from
Klimadatastyrelsen and OpenStreetMap, both free, and the output is a 3D
Tiles set the C2 loads from one URL.

**Billund, measured, not estimated:** 6,309 buildings over 33 km², five
builds, 146 MB of tiles, from 212 GB of imagery downloaded and deleted
along the way. About a day of wall-clock, almost all of it waiting on
downloads.

`RECIPE.md` describes the earlier photogrammetry approach, which
reconstructed geometry out of the photographs. That was abandoned: five
oblique frames per point is not enough to reconstruct from, and it is
plenty to texture with. The war stories in it are still true and still
worth reading; the commands are not. **This file is the current method.**

---

## What you need first

- A free Dataforsyningen token in `.env.local` as `DATAFORSYNINGEN_TOKEN`.
  Register at dataforsyningen.dk, Min side, Token.
- Python 3 with Pillow. No pyproj, no GDAL; the one projection this needs
  is written out in the scripts.
- Docker, for Obj2Tiles only.
- Disk. See the cost table at the bottom before starting.

---

> **Running this as an agent? Use [AGENT_RUNBOOK.md](AGENT_RUNBOOK.md)** —
> the same steps as literal commands, each with a gate that must pass
> before the next, and explicit stop-and-ask conditions. This file is
> the reasoning behind them.

## A. Choose the area from the buildings, never by typing a box

**This step exists because a box was typed from memory three times and
landed wrong every time.** Once on a runway, which contains zero
buildings; a full reconstruction ran over half a square kilometre of
tarmac. Twice more on the town, each time missing the part that mattered.

Pull footprints over a generous area first, then let the density decide:

```bash
curl -sS -H 'User-Agent: your-project (contact: you@example.com)' \
  -H 'Accept: application/json' \
  https://overpass-api.de/api/interpreter --data-urlencode 'data=
  [out:json][timeout:240];
  way["building"](55.68,9.05,55.78,9.25);
  out geom;' -o work/osm_<town>_wide.json
python3 -c "import json;print(len(json.load(open('work/osm_<town>_wide.json'))['elements']),'footprints')"
```

**Overpass bbox order is south,west,north,east** — the opposite of every
other tool here. And **the User-Agent is load bearing**: Overpass answers
curl's default agent with 406 and an HTML body, `curl -s` writes it to
the file, and `json.load` then fails with "Expecting value: line 1 column
1" one step later, which reads as a parser bug. Always check the body is
really JSON.

Then let the buildings decide where the town is:

```bash
python3 pick_town.py --osm work/osm_<town>_wide.json
```

It grids the footprints, keeps cells above a density floor, floods
outward from the densest one, and splits the result into compact blocks.
It prints the imagery cost and peak disk for each block **before**
anything is downloaded.

A density floor of **5 buildings per 0.005° cell** is what separates a
town from countryside. At a floor of 1, Danish rural building density
connects every village to every other and the fill runs to the edge of
whatever you sampled — that happened, and reported a 12.8 km box that was
mostly farmland.

**Build compact blocks, not strips**, which is why the script splits the
way it does. A frame covers a strip of ground along a flight line, so a
wide block shares frames between its rows while a narrow strip pays for
every line it crosses and shares nothing. Measured: a 27 km² block cost
7.5 frames/km², an 8 km² strip 1.8 km wide cost 17.5.

`pick_bbox.py` is the older tool. It ranks 700 m tiles by roof area,
which is right for finding one named building such as a terminal, and
wrong for scoping a town.

**Worth knowing before you copy Billund's numbers:** run against the same
data, `pick_town.py` returns lon 9.0750..9.1750, lat 55.7050..55.7500 —
31 km² and 5,599 footprints in two blocks, about 81 GB. Billund was
actually built as five builds over 212 GB, because the boxes were chosen
by hand and reached east into farmland. The script would have produced
the same town for roughly a third of the downloading.

## B. Heights

```bash
python3 fetch_dhm.py --bbox <W,S,E,N> --out work/dhm
```

Surface and terrain, 1 km tiles at 0.4 m. Building height is surface
minus terrain. **Do this first** — the service is rate limited, it is the
slowest thing to replace, and it is small enough to keep forever.

**Check the exit code.** The script exits non-zero if any tile failed, and
it matters: six tiles once 504'd during a run and cost 736 buildings,
about 30% of a town, with no other symptom than buildings quietly absent.
They all came down on a retry.

## C. Imagery

```bash
# Roofs only. One nadir frame covers about 2 km.
python3 fetch.py --bbox <W,S,E,N> --direction nadir --out work/<site>

# Walls as well, if the site deserves them. Four more directions.
python3 fetch.py --bbox <W,S,E,N> --direction north --direction south \
                 --direction east --direction west --out work/<site>
```

About **351 MB per frame**. `poses.json` merges across runs, so several
boxes can go into one output directory and the camera models accumulate.

**Walls are a real decision, not a default.** Only the Billund airport
build has them, and it cost five times the imagery for 232 buildings.
Everywhere else reports `0 walls have an oblique that sees them` and falls
back to one flat colour per building, sampled from its own roof. From any
realistic camera angle you are looking at roofs. Spend the obliques on a
terminal, not on bungalows.

## D. Build

```bash
python3 drape_site.py \
  --poses work/<site>/poses.json \
  --osm   work/osm_<town>_wide.json \
  --dhm   work/dhm \
  --bbox  <W,S,E,N> \
  --exclude-bbox <any box already built> \
  --out   work/<site>/drape \
  --gsd 0.20
```

Geometry is taken as given and the photographs are projected onto it.
Roof polygon per footprint at the DHM height, walls extruded to ground,
about twenty faces per building and not one triangle of terrain.

- `--gsd 0.12` for a terminal or anything with detail worth reading.
  `0.20` for housing. Billund's town at 0.20 keeps a whole atlas under
  9 MB.
- `--exclude-bbox` is repeatable. Pass every box already built, so no
  building is drawn twice. Cost scales with **building count, not box
  area**, so one wide box with holes beats ten small boxes.
- `--min-height` defaults to 2.0 m. Anything shorter is skipped, which is
  carports, sheds and bin stores. Expect about 5% of footprints.

Read the output. `roof triangulation: every footprint covered exactly
once` is a permanent gate and it has caught a real winding bug.
`NO TIFF` lines mean frames that failed to download, and each one costs
its buildings their texture.

## E. Tile

```bash
python3 to_yup.py --in work/<site>/drape/site.obj \
                  --out work/<site>/drape/site_yup.obj
rm -rf work/<site>/tiles
PARENT=$(cd work/<site> && pwd)
docker run --rm --entrypoint /code/SuperBuild/install/bin/Obj2Tiles \
  -v "$PARENT":/datasets opendronemap/odm:latest \
  /datasets/drape/site_yup.obj /datasets/tiles \
  --divisions 3 --lat <LAT> --lon <LON> --alt 0.0
python3 unlit_tiles.py --tiles work/<site>/tiles
```

`--lat/--lon` come from `drape/origin.json`, which step D writes.

**Both wrapper steps are load bearing and neither failure reports an
error.** Skip `to_yup.py` and the tileset lands as an 800 m vertical slab
170 m in the air, because Obj2Tiles writes bounding boxes already rotated
to match its own wrong assumption. Skip `unlit_tiles.py` and Cesium lights
a texture that already contains the sun, so every roof blows out to white.

## F. Combine

```bash
python3 combine_tilesets.py --out work/<town>-combined \
  --child <name>:work/<site>/tiles:<W,S,E,N> \
  --child ...
```

One parent, one child per build, `refine: ADD`. Each build keeps its own
atlas, texture resolution and local origin, and rebuilding one does not
rebuild the others. Children may overlap; the `--exclude-bbox` from step D
is what prevents double-drawing, not the regions.

## G. Coverage — the step that costs an afternoon

```bash
python3 export_coverage.py --site <town> \
  --build work/<site-1>/drape \
  --build work/<site-2>/drape \
  --out ../../src/data/building_footprints.json
```

**Skipping this does not fail.** The mesh loads, the tiles serve, every
atlas is textured, and you still see white boxes, because the C2's own
extruded OSM buildings keep drawing on top. It reads exactly like a mesh
that did not load, so that is where you go looking, and it is not.

Billund sat like that through three rebuilds. The clip file still held 15
outlines over an 835 m box from the first photogrammetry run, against a
mesh that had grown to 3,743 buildings over 6.4 km. Fifteen boxes were
being removed and 3,844 were left standing.

The script reads extents from the built meshes, so the file cannot drift
from what was actually built. It drops rectangles another contains and
trims partial overlaps automatically — **an overlap is not cosmetic**,
because Cesium builds one signed distance field per clipping collection
and a point inside two polygons gets a distance neither would have given
alone, which leaves boxes standing. A 54 m overlap along one seam was
enough to leave a line of white through an industrial estate.

Re-run this after **every** build that changes a site's extent, passing
all of that site's builds in one call.

## H. Serve

```bash
python3 serve_tiles.py 8778 work/<town>-combined
```

The app reads `VITE_SITE_MESH_URL`, defaulting to `http://localhost:8778`.
For anything beyond a laptop, put the tiles in object storage and point
that variable at it.

## I. Verify, before believing it

```js
__isr_siteMesh.clip()       // should name the right number of rectangles
__isr_siteMesh.coverage()   // inside: true/false at the camera
```

Then fly the seams between builds. A **straight** line of white boxes
along a build boundary is a coverage bug. Scattered white is not.

| what you see | what it is | how to tell |
|---|---|---|
| white boxes everywhere, mesh loads fine | step G never run, or stale | `clip()` names too few rectangles |
| straight line of white along a boundary | coverage rectangles overlap | `export_coverage.py` says it trimmed, or warns |
| white boxes over a whole area | no build there | `coverage()` → `inside: false` |
| roofs half on the building, half in the garden | basemap offset, **not** a mesh fault | switch the basemap to Danish imagery |
| whole roofs missing in patches | a height tile failed silently | `grep FAILED` the DHM log |
| tileset is a tall thin slab | `to_yup.py` skipped | nothing reports it |
| roofs blown out white | `unlit_tiles.py` skipped | nothing reports it |
| small structures simply absent | under `--min-height` | expected, about 5% |

## J. Reclaim

```bash
rm -rf work/<site>/images     # once tiles/ and drape/ both exist
```

**Keep `tiles/` and `drape/`.** Those are the product and the only way to
re-tile without refetching everything. Keep `work/dhm/` too; it is small
and the slowest to replace. The imagery is the only large thing and it is
free to refetch.

---

## What it costs, from five real builds

| build | buildings | km² | frames | imagery | tiles |
|---|---|---|---|---|---|
| airport, 0.12 m + walls | 232 | 5.0 | 230 | 28 GB | 16 MB |
| city core, 0.20 m roofs | 2,367 | 28.8 | 185 | 63 GB | 68 MB |
| outer, 0.20 m roofs | 1,144 | — | shared | — | 16 MB |
| south, 0.20 m roofs | 1,852 | 27.3 | 204 | 73 GB | 28 MB |
| west, 0.20 m roofs | 714 | 8.0 | 140 | 48 GB | 18 MB |
| **total** | **6,309** | **~33** | | **212 GB** | **146 MB** |

Rules of thumb: **351 MB per frame**, **6 to 8 frames per km²** for a
compact block and up to 18 for a narrow strip, **about 45 s per frame**
to download, and roughly **3 height tiles per km²**.

Peak disk is one build's imagery, not the total, as long as you delete
after each one. Billund never needed more than 75 GB free at once.

---

## Why this exists at all

Google's photorealistic 3D tiles cover six Danish cities and Billund is
not one of them. Beyond those six the map falls back to extruded OSM
footprints: correct heights, blank white surfaces.

Google also blocks photorealistic 3D tiles outright for projects on a
European Economic Area billing address created after 8 July 2025, with a
documented 403. The C2 reaches them through Cesium ion rather than a
Google project, so it works today, and that route has never been
guaranteed to stay open.

This pipeline depends on neither. Danish state orthophotos at 10 cm,
Danish state height models, OpenStreetMap footprints, all free and all
redistributable under CC BY 4.0. It works anywhere in Denmark, including
the six cities, and nobody can turn it off.
