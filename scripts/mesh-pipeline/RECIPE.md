# The recipe that works

Verified twice on Billund Airport terminal. Do not change any of it
without a copy of the output saved somewhere else first.

## Inputs

| | |
| --- | --- |
| Images | **3000 px longest edge**, from `prep_odm.py --max-px 3000` |
| Count | 67-68 frames over the terminal box |
| Boundary | **none** |
| Docker memory | **12g** on the run command |

## Command

```bash
python3 fetch.py    --site billund-terminal --out ./work/billund-terminal
python3 prep_odm.py --work ./work/billund-terminal --max-px 3000
rm -f ./work/billund-terminal/odm/boundary.geojson

PARENT=$(cd work/billund-terminal && pwd)
docker run --rm -v "$PARENT":/datasets --memory=12g opendronemap/odm:latest \
  --project-path /datasets odm \
  --feature-quality high \
  --pc-quality medium \
  --use-3dmesh \
  --mesh-size 300000 \
  --mesh-octree-depth 11 \
  --skip-orthophoto \
  --skip-report \
  --3d-tiles \
  --texturing-single-material
```

Takes about 11 minutes.

## What a good result looks like

| | |
| --- | --- |
| `odm_textured_model_geo.obj` | ~64 MB |
| texture PNG | ~120 MB |
| mesh faces | ~598,000 |

If the OBJ is under a megabyte, or the mesh reports **0 faces**, it has
failed. Do not try to interpret the output; the numbers above are the
check.

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
