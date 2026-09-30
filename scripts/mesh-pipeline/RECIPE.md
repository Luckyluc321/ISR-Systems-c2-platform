# The recipe that works

Verified twice on Billund Airport terminal. Do not change any of it
without a copy of the output saved somewhere else first.

## Step 0: get the box from the footprints

**Never type a bounding box by hand.** This is step zero because
skipping it wasted more time than every settings problem below put
together.

```bash
# one named building, which is the airport case
python3 pick_bbox.py --osm /tmp/osm_buildings.json --name "Billund Lufthavn"

# the densest boxes in the set, which is how a city gets tiled
python3 pick_bbox.py --osm /tmp/osm_buildings.json --rank 20

# check a box before spending an hour on it
python3 pick_bbox.py --osm /tmp/osm_buildings.json --check 9.15,55.739,9.16,55.744
```

Footprints come from Overpass, the same source the C2 map draws its
white boxes from, so a clipped mesh and the box it replaces line up:

```
[out:json][timeout:60];
way["building"](55.7196,9.0989,55.7596,9.2004);
out geom;
```

A box holding no buildings is worth nothing. The mesh is only ever
wanted for buildings; every other square metre is ground the map
already draws, and it costs the same to reconstruct.

`--check` exits 1 on an empty box. `clip_to_buildings.py` now refuses
one too, before it spends any time filtering.

## Inputs

| | |
| --- | --- |
| Images | **3000 px longest edge**, from `prep_odm.py --max-px 3000` |
| Count | 60-68 frames over the box |
| Boundary | **keep it** (see below) |
| Docker memory | **12g** on the run command |

## Command

```bash
python3 fetch.py    --site billund-terminal --out ./work/bt-dense
python3 prep_odm.py --work ./work/bt-dense --max-px 3000
# prep writes boundary.geojson from the site bbox. KEEP IT.

PARENT=$(cd work/bt-dense && pwd)
docker run --rm -v "$PARENT":/datasets --memory=12g opendronemap/odm:latest \
  --project-path /datasets odm \
  --feature-quality high \
  --pc-quality medium \
  --use-3dmesh \
  --mesh-size 800000 \
  --mesh-octree-depth 11 \
  --boundary /datasets/odm/boundary.geojson \
  --skip-orthophoto \
  --skip-report \
  --3d-tiles \
  --texturing-single-material
```

About 11 minutes without the boundary, longer with it and a bigger mesh.

## The boundary is the whole game, and it used to say "none" here

**Triangle density decides whether you get a building or a bump.** The
budget is spread over whatever ground gets reconstructed, so the
boundary is not a tidiness setting, it is the only thing pointing the
compute at the buildings.

Measured, same imagery, same everything else:

| | No boundary | Boundary, mesh-size 800000 |
| --- | --- | --- |
| Ground covered | 11.4 km2 | 0.67 km2 |
| Mesh faces | 594,444 | ~1.6M |
| Per square metre | 0.05 | ~2.4 |
| **Triangles on the terminal** | **738** | **~50,000** |
| Per building, 654 of them | ~8 | hundreds |

738 triangles over a 21,000 m2 roof is one per 29 m2, a five-metre
grid. That is a lumpy slab wearing a photograph, and eight triangles a
building is a box with a photo on it, which is the thing this pipeline
exists to replace.

This file said `Boundary: **none**` for a day. It was not wrong about
what completed, it was wrong about what the output was for: the box it
was tuned against was the **runway**, which has no buildings in it, so
nothing about starving the buildings of triangles could show up. A
setting validated against ground that had none of the thing you care
about tells you nothing about that thing.

Ceiling: `--mesh-size 2000000` produced a good mesh (3,989,396 faces)
and then ran out of memory during texturing, which costs roughly with
face count. 800000 survives and is ample.

## What a good result looks like

| | Boundary run | No-boundary run |
| --- | --- | --- |
| `odm_textured_model_geo.obj` | ~180 MB | ~64 MB |
| mesh faces | ~1.6M | ~594,000 |
| triangles per m2 | ~2.4 | 0.05 |

If the OBJ is under a megabyte, or the mesh reports **0 faces**, it has
failed. Do not try to interpret the output; the numbers above are the
check.

And check density, not just completion:

```bash
python3 clip_to_buildings.py --obj <model> --osm /tmp/osm_buildings.json --out /tmp/b.obj
```

Kept triangles divided by buildings on the mesh should be in the
hundreds. Single digits means the boundary is missing or too big, and
the run completed perfectly while producing nothing worth loading.

## Known-good copy

`work/_KNOWN_GOOD/` holds a working textured model, mesh and 3D Tiles,
write-protected on purpose.

**Never delete the only good output to make room for an attempt at a
better one.** That single mistake cost most of a working day: fourteen
runs at twenty minutes each, trying to reproduce something that no
longer existed to compare against.

## What actually broke it, in order

Recorded because every one of these looked like a different problem and
none of them was the real one.

1. **The output was deleted** before a replacement existed. Everything
   below follows from that.
2. **21 of 68 source images were corrupt on disk.** `prep_odm.py` was
   printing every skip; only the tail of its output was being read. Runs
   were quietly using a third fewer images.
3. **`--max-concurrency 1` was needed** on a machine whose Docker had
   7.75 GB, where the original run had passed `--memory=12g` against a
   VM that could not satisfy it and therefore ran uncapped.
4. **Settings drift.** feature quality lowered to medium, matcher
   neighbours added and removed, a boundary file `prep_odm.py` kept
   recreating after it was disabled, a memory cap set *below* what the
   VM had.
5. **The real one, found last.** The images had been re-prepped to
   **2000 px** during an unrelated test and never restored. Every run
   after that, including a verbatim replay of the working command, ran
   on the wrong input. That is why replaying the command did not work
   and sent the search back to the settings.

## The lesson

When something that worked stops working, **diff the inputs before the
settings.** The command was replayed exactly and still failed, because
the data underneath it had changed. Checking the images would have
taken thirty seconds at any point.

## The box was wrong the whole time

Separate from all of the above, and worse.

`billund-terminal` was typed from memory as
`9.150,55.739,9.160,55.744`. That is Billund's **runway and apron**. It
contains **zero buildings**. The real terminal is 500 m northwest.

So every successful run reconstructed half a square kilometre of tarmac
and grass at full density, and `clip_to_buildings.py` then correctly
kept nothing, because there was nothing there. Its error message said
the footprints and the mesh were "probably in different coordinate
systems", which was wrong, and the search went into the projection code.

The projection was never broken. Checked against the camera poses, the
site centre projects to 509731 E / 6177321 N and the mesh centre sits at
509730 / 6177317. Four metres apart. It was right all along.

Two things made this survive so long:

- **An extent test said the coordinates overlapped.** They did. The
  mesh box sat well inside the overall extent of 3,696 footprints
  spread over Billund, while not one individual building was within
  500 m. Overlapping extents is not overlapping ground. The check has
  to count footprints on the mesh, which is what it does now.
- **The name said terminal.** Nothing else was ever asked.

Fixed by `pick_bbox.py`, which derives the box from the footprints, and
by `clip_to_buildings.py` failing fast with the nearest building's
distance instead of blaming the coordinate system.

**Check what is in a box before reconstructing it.** One command, and
the box is either worth an hour of compute or it is not.
