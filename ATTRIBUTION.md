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

All three are used as map symbols in the Live Map, rendered at close range
where the billboard icon would read as a flat sticker.

### Mi-24 Hind — `public/aircraft/mi-24_hind.glb`

- **Author:** Duane's Mind — https://sketchfab.com/duanesmind
- **Licence:** CC-BY-4.0 — http://creativecommons.org/licenses/by/4.0/
- **Source:** https://sketchfab.com/3d-models/mi-24-hind-004d68143e1a4df88e136dbc0a05f181
- **Used for:** the `helicopter-intercept` dispatch unit

> **This airframe is knowingly wrong and is placeholder.** An Mi-24 Hind is a
> Russian gunship. Denmark operates 14 AW101 Merlin, 9 MH-60R Seahawk and 8
> Fennec, all from Helicopter Wing Karup, and none of them is this. It is in
> the tree because it was the first animated helicopter available and it
> proved the model pipeline works. Replace before this is shown to a customer.
> See `docs/open-questions.md`.

### Shahed 238 Drone — `public/aircraft/shahed_238_drone.glb`

- **Author:** Rudy — https://sketchfab.com/Rudy27
- **Licence:** CC-BY-4.0 — http://creativecommons.org/licenses/by/4.0/
- **Source:** https://sketchfab.com/3d-models/shahed-238-drone-10b7f80a149247748d8912bd0f59d517
- **Used for:** loitering-munition threat tracks

### Assault Drone Concept — `public/aircraft/assault_drone_concept.glb`

- **Author:** Diamonddogkz — https://sketchfab.com/Diamonddogkz
- **Licence:** Sketchfab Standard — https://sketchfab.com/licenses
- **Source:** https://sketchfab.com/3d-models/assault-drone-concept-c3a6f9b644b54de4b02c4599aac632eb
- **Used for:** quadcopter interceptors and quadcopter threat tracks

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
