# Agent runbook: a Danish town to 3D

Procedural. Every command is literal, every step has a gate that must
pass before the next one, and every stop condition is explicit.

[PLAYBOOK.md](PLAYBOOK.md) explains why each step is what it is. Read it
if a gate fails and the fix here does not work. Do not improvise around a
failed gate: every failure mode in this pipeline is silent, so a step
that "looked fine" and was skipped is the most likely cause of whatever
you are debugging.

**Set once, used throughout.** Replace `TOWN` and nothing else.

```bash
cd scripts/mesh-pipeline
TOWN=billund           # lowercase, no spaces; used in paths and --site
```

---

## STOP AND ASK before any of these

Do not decide these yourself. They cost hours or gigabytes, or they are
irreversible.

| situation | why it is not yours to decide |
|---|---|
| total imagery over ~50 GB, or over 2 h of downloading | real time and real disk; the human may want a smaller box |
| free disk under `peak disk needed` from step 1 | filling a disk is worse than not starting |
| deleting anything outside `work/<site>/images/` | `tiles/` and `drape/` are the product and cost 200x their size to regenerate |
| a town that is not the one you were asked for | a wrong box has burned a full day before |
| fetching obliques (walls) | five times the imagery; justified for a terminal, not for housing |

Report the numbers from step 1 and wait.

---

## 1. Derive the box. Never type one.

```bash
# Generous area, WIDER than the town you expect.
# NOTE: Overpass bbox order is south,west,north,east. Opposite of
# everything else here. The User-Agent is required: without it Overpass
# returns 406 with an HTML body that curl writes to the file, and the
# failure surfaces as a JSON parse error one step later.
curl -sS -H 'User-Agent: ISR-Labs mesh-pipeline (contact: you@example.com)' \
  -H 'Accept: application/json' \
  https://overpass-api.de/api/interpreter --data-urlencode 'data=
  [out:json][timeout:240];
  way["building"](SOUTH,WEST,NORTH,EAST);
  out geom;' -o work/osm_${TOWN}_wide.json

python3 pick_town.py --osm work/osm_${TOWN}_wide.json
```

**GATE 1** — all must hold:
- the file parses as JSON and holds > 0 footprints
- `pick_town.py` prints a town box, not an error
- the box is **smaller** than the area you queried. If it reaches your
  query edges, the fill ran away: widen the query and re-run, or raise
  `--floor`.

**ON FAILURE**
- `Expecting value: line 1 column 1` → Overpass returned HTML. Check the
  User-Agent, then `head -c 300` the file.
- `No cell holds N buildings` → wrong area, or lower `--floor`.
- Box reaches the query edges → widen the query box and re-run.

**THEN STOP.** Report the block table and `peak disk needed` to the
human. Wait for go.

## 2. Heights, for the whole town at once

```bash
python3 fetch_dhm.py --bbox <TOWN_BBOX> --out work/dhm
echo "exit=$?"
```

**GATE 2**: exit code is **0**, and the log's last line says `0 failed`.

**ON FAILURE** (non-zero exit, or any `FAILED` line): re-run the exact
same command. It skips what is already on disk. The service 504s under
load and recovers; six tiles once failed and cost 736 buildings with no
other symptom. **Do not proceed with a non-zero exit.**

## 3. One block at a time, from here down

Repeat steps 3 to 7 for each block from step 1. Do not fetch a second
block's imagery before the first is built and its frames deleted.

```bash
BLOCK=1                      # increments per block
BBOX=<this block's bbox>      # from step 1, W,S,E,N
SITE=${TOWN}-b${BLOCK}

python3 fetch.py --bbox $BBOX --direction nadir --out work/$SITE
```

**GATE 3**: the log's last line reads `done. N fetched, M already
present, 0 failed`.

**ON FAILURE** (`failed` > 0): re-run the same command once. Frames that
stay failed cost only their own buildings' textures; if fewer than 5
failed, note it and continue. If more, stop and report.

## 4. Build

```bash
python3 drape_site.py \
  --poses work/$SITE/poses.json \
  --osm   work/osm_${TOWN}_wide.json \
  --dhm   work/dhm \
  --bbox  $BBOX \
  --exclude-bbox <every bbox already built, repeat the flag> \
  --out   work/$SITE/drape \
  --gsd 0.20
```

`--gsd 0.20` for housing. `0.12` only where detail must be readable, such
as a terminal; it roughly triples the atlas.

**GATE 4** — all must appear in the output:
- `roof triangulation: every footprint covered exactly once`
- `N buildings to draw` where N > 0
- **zero** `NO TIFF` lines
- `work/$SITE/drape/origin.json` exists

**ON FAILURE**
- triangulation line missing or an area-ratio error → a real winding bug,
  stop and report. Do not work around it.
- `NO TIFF` lines → those frames failed in step 3. Re-run step 3, then
  step 4.
- `0 buildings to draw` → the bbox holds no footprints, or
  `--exclude-bbox` covered them all. Check the box.

## 5. Tile

```bash
python3 to_yup.py --in work/$SITE/drape/site.obj \
                  --out work/$SITE/drape/site_yup.obj
rm -rf work/$SITE/tiles
PARENT=$(cd work/$SITE && pwd)
# --lat/--lon come from work/$SITE/drape/origin.json, field "obj2tiles"
docker run --rm --entrypoint /code/SuperBuild/install/bin/Obj2Tiles \
  -v "$PARENT":/datasets opendronemap/odm:latest \
  /datasets/drape/site_yup.obj /datasets/tiles \
  --divisions 3 --lat <LAT> --lon <LON> --alt 0.0
python3 unlit_tiles.py --tiles work/$SITE/tiles
```

**Both wrappers are mandatory and neither failure reports an error.**
Without `to_yup.py` the tileset is an 800 m vertical slab in the air.
Without `unlit_tiles.py` every roof renders blown-out white.

**GATE 5**:
```bash
test -f work/$SITE/tiles/tileset.json && \
python3 -c "
import glob
f=sorted(glob.glob('work/$SITE/tiles/**/*.b3dm', recursive=True))
assert f, 'no b3dm tiles'
d=open(f[0],'rb').read()
assert d[:4]==b'b3dm', 'bad magic'
assert b'KHR_materials_unlit' in d, 'unlit pass did not run'
print(f'  OK {len(f)} tiles, first is valid b3dm and unlit')"
```

**ON FAILURE**: re-run the failed wrapper. If `unlit` is missing, run
`unlit_tiles.py` again; it is idempotent.

## 6. Reclaim, then next block

```bash
# ONLY after gate 5 passed for this block.
test -f work/$SITE/drape/site.obj && test -f work/$SITE/tiles/tileset.json \
  && rm -rf work/$SITE/images && echo "frames deleted"
df -h . | tail -1
```

Go back to step 3 with the next block. When all blocks are built,
continue to step 7.

## 7. Combine every block

```bash
python3 combine_tilesets.py --out work/${TOWN}-combined \
  --child ${TOWN}-b1:work/${TOWN}-b1/tiles:<bbox 1> \
  --child ${TOWN}-b2:work/${TOWN}-b2/tiles:<bbox 2>
```

**GATE 7**: output says `N children` where N equals the number of blocks.

## 8. Coverage. The step that silently undoes everything above.

```bash
python3 export_coverage.py --site $TOWN \
  --build work/${TOWN}-b1/drape \
  --build work/${TOWN}-b2/drape \
  --out ../../src/data/building_footprints.json
```

Pass **every** block in one call. Skipping this step does not fail: the
mesh loads, tiles serve, atlases are textured, and the app still draws
its own white boxes on top, which reads exactly like a mesh that did not
load.

**GATE 8** — all must hold:
- output ends `wrote ... (N rectangles ...)` with N ≥ 1
- **no** `WARNING: ... partially overlap` line survives. Trims are fine
  and expected (`trimming X off Y: N m ... removed`); a surviving warning
  is not, because an overlap leaves a line of white boxes standing.
- verify no overlap remains:

```bash
python3 -c "
import json
c=json.load(open('../../src/data/building_footprints.json'))['sites']['$TOWN']['coverage']
def b(r):
    xs=[p[0] for p in r['ring']]; ys=[p[1] for p in r['ring']]
    return min(xs),min(ys),max(xs),max(ys)
bad=[(r['build'],o['build']) for i,r in enumerate(c) for o in c[:i]
     if b(r)[0]<b(o)[2] and b(o)[0]<b(r)[2] and b(r)[1]<b(o)[3] and b(o)[1]<b(r)[3]]
assert not bad, f'overlapping: {bad}'
print(f'  OK {len(c)} rectangle(s), no overlaps')"
```

## 9. Serve and verify

```bash
python3 serve_tiles.py 8778 work/${TOWN}-combined &
for ch in <each block name>; do
  curl -s -o /dev/null -w "$ch %{http_code}\n" "http://localhost:8778/$ch/tileset.json"
done
```

**GATE 9**: every child returns **200**.

Then hand to the human with these two console commands, because the rest
is visual and you cannot see it:

```js
__isr_siteMesh.clip()       // names the rectangle count from gate 8
__isr_siteMesh.coverage()   // inside: true/false at the camera
```

Tell them to fly the **seams between blocks**. A straight line of white
boxes along a block boundary is a coverage bug. Scattered white is not.

---

## When the human reports white buildings

Four distinct causes look identical on screen and need opposite fixes.
Ask for one line before doing anything:

```js
__isr_siteMesh.coverage()
```

| result | cause | fix |
|---|---|---|
| `inside: false` | no mesh there, outside every block | a new block: steps 3 to 8 |
| `inside: true`, `clip()` names too few rectangles | step 8 stale or skipped | re-run step 8 |
| `inside: true`, straight line of white along a boundary | overlapping rectangles | re-run step 8, check gate 8 |
| `inside: true`, scattered small structures | under `--min-height 2.0` | expected, about 5%. Not a bug |

That distinction cost three rounds of screenshots before `coverage()`
existed. Use it first, every time.

## Other symptoms

| symptom | cause |
|---|---|
| tileset is a tall thin slab in the air | `to_yup.py` skipped at step 5 |
| roofs blown out white | `unlit_tiles.py` skipped at step 5 |
| roofs half on the building, half in the garden | basemap offset, **not** a mesh fault. Switch the basemap to Danish imagery |
| whole roofs missing in patches | a height tile failed at step 2 |
| a whole area absent | that block was never built |
