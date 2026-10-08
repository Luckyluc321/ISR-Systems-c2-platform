# Third-party attribution

Assets in this repository that carry a licence requiring credit, and the
credit they require. Read from each file's own embedded metadata rather than
from memory, so this can be re-derived:

```bash
python3 - <<'PY'
import struct, json, glob
for p in sorted(glob.glob("public/aircraft/*.glb")):
    with open(p,"rb") as f:
        _, _, total = struct.unpack("<4sII", f.read(12)); g=None
        while f.tell() < total:
            h=f.read(8)
            if len(h)<8: break
            clen, ctype = struct.unpack("<I4s", h); d=f.read(clen)
            if ctype.strip()==b"JSON": g=json.loads(d)
    print(p, g.get("asset",{}).get("extras",{}))
PY
```

## 3D models

All four are used as map symbols in the Live Map, rendered at close range
where the billboard icon would read as a flat sticker.

### MH-60R Seahawk — `public/aircraft/mh-60r_seahawk.glb`

- **Author:** Muhamad Mirza Arrafi — https://sketchfab.com/nazidefenseforceofficial
- **Licence:** CC-BY-4.0 — http://creativecommons.org/licenses/by/4.0/
- **Source:** Sketchfab, "SH-60B Seahawk Helicopter"
- **Used for:** the `helicopter-intercept` dispatch unit
- **Modified:** rotors cut into `Main_Rotor` and `Tail_Rotor` nodes by
  `scripts/split_heli_rotors.py`, and textures resampled to 1024 by
  `scripts/shrink_glb_textures.py`. Geometry verified unchanged: 34,462
  distinct drawn points before and after, none lost, none gained.

This **replaced an Mi-24 Hind** that had been standing in since
2026-10-07. The Hind is a Russian gunship and Denmark has never flown
one; it was in the tree only because it was the first animated
helicopter to hand. The H-60 is the right airframe: Denmark operates 9
MH-60R Seahawks with Eskadrille 723 at Helicopter Wing Karup.

### Modern Army Soldier — merged into `public/aircraft/mh-60r_seahawk_crewed.glb`

- **Author:** abdlilah ben — https://sketchfab.com/m152027350
- **Licence:** CC-BY-4.0 — http://creativecommons.org/licenses/by/4.0/
- **Source:** https://sketchfab.com/3d-models/modern-army-soldier-with-24-pro-animations-37566d930fa7404f87847b7fca8dca97
- **Used for:** the Seahawk's door gunner
- **Modified:** his `crouch idle` pose baked into static geometry by
  `scripts/bake_posed_figure.py`, then merged into the Seahawk by
  `scripts/merge_static_glb.py`. The skin, its 50 joints and all 23
  animation clips are discarded: we want one pose, held, and carrying a
  skeleton would mean reconciling joint indices between two files and
  paying skinning cost every frame for something that never moves.

### Shahed 238 Drone — `public/aircraft/shahed_238_drone.glb`

- **Author:** Rudy — https://sketchfab.com/Rudy27
- **Licence:** CC-BY-4.0 — http://creativecommons.org/licenses/by/4.0/
- **Source:** https://sketchfab.com/3d-models/shahed-238-drone-10b7f80a149247748d8912bd0f59d517
- **Used for:** loitering-munition threat tracks
- **Modified:** simplified with meshoptimizer from 1,956,897 to 64,548
  triangles, 74.8 MB to 2.6 MB. Bounding box drift 0.049%.

### Assault Drone Concept — `public/aircraft/assault_drone_concept.glb`

- **Author:** Diamonddogkz — https://sketchfab.com/Diamonddogkz
- **Licence:** Sketchfab Standard — https://sketchfab.com/licenses
- **Source:** https://sketchfab.com/3d-models/assault-drone-concept-c3a6f9b644b54de4b02c4599aac632eb
- **Used for:** quadcopter interceptors and quadcopter threat tracks
- **Modified:** eight propeller blades cut into `Rotor_1`..`Rotor_4` by
  `scripts/split_quad_rotors.py`. Geometry verified unchanged.

### F-35A Lightning II — `public/aircraft/f-35a_lightning_ii.glb`

- **Author:** shangus930 — https://sketchfab.com/shangus930
- **Licence:** CC-BY-4.0 — http://creativecommons.org/licenses/by/4.0/
- **Source:** https://sketchfab.com/3d-models/f-35a-lightning-ii-a06d6113cfb44a0aa7b8f17106aca9c4
- **Used for:** the Flyvevåbnet QRA jet, which launches from Skrydstrup
- **Modified:** textures resampled 4096 to 1024 by
  `scripts/shrink_glb_textures.py`, 127.7 MB to 19.5 MB. All 104 nodes,
  19 meshes and 20 animation channels verified identical.

## The rule, for anything added later

**Never add an asset whose licence contains NC.** NonCommercial excludes this
product. This is not a preference: ISR Systems is commercial software shown to
customers and investors, and an NC asset in it does not meet its own licence.

A DJI Inspire 2 model was evaluated for the interceptors on 2026-10-07 and
rejected on exactly this ground. It was otherwise ideal, carrying a proper
`MOTOR1`..`MOTOR4` rotor animation, which is worth knowing if someone is
tempted by the same file again:

```
license = "CC-BY-NC-4.0"
author  = "geoffreycouppey"
source  = https://sketchfab.com/3d-models/dji-inspire-2-with-zenmuse-x5s-3979efe28b3a4221bdd462638582d0a6
```

Acceptable: **CC0**, **CC-BY**, **Sketchfab Standard**, or anything bought
outright. Check before downloading, not after: the licence is in the sidebar
on the model's Sketchfab page, and it is also embedded in the file itself
under `asset.extras.license`, which is what the snippet at the top reads.

## Where this is surfaced

This file is the record. The models are not currently credited inside the
running application. CC-BY asks for attribution reasonable to the medium, and
for a web application a credit line in an About or Legal panel is the usual
reading. That is not built yet and is worth doing when one exists.
