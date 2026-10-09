# Building Mesh Architecture

How a white extruded box becomes a photographed building.

Away from the cities Google's photorealistic tiles cover, every
building in the map is a white box from Cesium's OSM Buildings tileset:
the right outline, roughly the right height, nothing else. At Billund,
Esbjerg and every substation, that is what an operator sees.

`city-creation-framework/mesh-pipeline/` builds the replacement from Danish national
oblique photography, and `src/building_footprints.js` puts it in place
of the boxes.

## The chain

```mermaid
flowchart TD
  OSM["OpenStreetMap footprints<br/>Overpass, way[building]"]

  subgraph pick["1. Pick the ground"]
    PB["pick_bbox.py<br/>box by building name,<br/>or densest tiles"]
  end

  subgraph build["2. Reconstruct it"]
    F["fetch.py<br/>skråfoto STAC, 5 obliques + nadir<br/>camera pose comes with the image"]
    P["prep_odm.py<br/>downscale to 3000px<br/>geo.txt, boundary.geojson"]
    O["OpenDroneMap<br/>dense stereo, Poisson mesh, texture"]
  end

  subgraph cut["3. Keep only buildings"]
    C["clip_to_buildings.py<br/>cuts the geometry,<br/>ground never leaves here"]
    T["Obj2Tiles<br/>buildings-only 3D Tiles<br/>7.6 MB, not 96 MB"]
    E["export_footprints.py<br/>outlines for hiding boxes"]
  end

  subgraph c2["4. Swap them in the map"]
    M["Cesium3DTileset<br/>buildings only, drawn as-is"]
    B["Cesium OSM Buildings<br/>the white boxes"]
    S["building_footprints.js<br/>applyBuildingSwap"]
  end

  OSM --> PB --> F --> P --> O
  O --> C --> T --> M
  O --> E
  OSM --> E
  OSM --> C
  E --> S
  S -->|"inverse: false<br/>remove inside"| B
```

## Why the footprints come from OpenStreetMap

The national register is more accurate. OpenStreetMap is used anyway,
because the white boxes **are** OpenStreetMap, drawn from Cesium's OSM
Buildings tileset.

Clipping both layers against the same outline makes them swap exactly.
A more accurate polygon that disagrees with the box is worse, not
better: the disagreement is the thing that shows, as a sliver of white
box beside a real building, or a gap where neither draws.

Correspondence beats accuracy whenever two layers have to line up.

## The box decides everything

Triangle density is the difference between a building and a bump. The
mesh budget spreads over whatever ground gets reconstructed, so the
bounding box is not housekeeping, it is the only thing aiming the
compute at buildings.

Measured on Billund, same imagery, same settings otherwise:

| | No boundary | Boundary, mesh-size 800000 |
| --- | --- | --- |
| Ground covered | 11.4 km2 | 0.67 km2 |
| Triangles on the terminal | 738 | ~50,000 |
| Per building, 654 of them | ~8 | hundreds |

Eight triangles is a box with a photograph on it, which is the thing
being replaced.

**Boxes are derived from footprints, never typed.** `pick_bbox.py`
does it, and `clip_to_buildings.py` refuses a mesh with no building
standing on it. Both exist because a box was once typed from memory,
landed on Billund's runway, and reconstructed half a square kilometre
of tarmac that contained nothing to clip to.

## The mesh is cut in the geometry, not on the screen

`clip_to_buildings.py` keeps triangles whose centroid sits inside a
padded footprint and at least 2 m above local ground, then
`export_footprints.py` exports the outlines and ODM's `Obj2Tiles` turns
the result into 3D Tiles. **What reaches the browser contains buildings
and nothing else.** No runway, no tarmac, no field, no tree.

The height test matters because a footprint alone also captures the
tarmac inside a building outline wherever the roof failed to
reconstruct, which would hoist a patch of ground to roof level.

Padding is a true dilation by distance to the nearest edge, not a grown
bounding box. An OSM footprint is the roof outline seen from above
while a reconstructed wall leans outward from it, so without real
padding the wall triangles are shaved off and roofs float with nothing
under them.

Render-time clipping of the full reconstruction was tried first, using
`ClippingPolygonCollection` with `inverse: true` to keep only what
stood inside a footprint. It was appealing because both layers would be
cut against the same outline and it needed no extra tooling. It was the
wrong call:

- It ships a mesh **full of ground** and relies on a shader to hide it,
  so when the clipping misbehaves the fallback is the worst possible
  output. It did misbehave, and put a lit square of tarmac and car park
  across the map.
- Clipping hides geometry, it does not stop it downloading. 96 MB over
  the wire to display 7.6 MB of buildings.

Cutting the geometry removes that failure mode instead of guarding
against it. A file with no ground in it cannot draw ground.

`SITE_MESHES[site].buildingsOnly` records that a mesh is already cut,
and the loader then skips clipping it.

## Clipping still hides the boxes

The one remaining use of `ClippingPolygonCollection` is the white
boxes, with `inverse: false`, so they are removed exactly where the
reconstruction replaces them.

That direction is safe in a way the other was not: clipping can only
**remove** box geometry, never reveal something that should not be
there. The worst failure is a white box that stays visible, which is
the map as it was.

## Vertical datum

Skråfoto heights are DVR90, orthometric. Cesium wants ellipsoidal.
Over Denmark those differ by roughly 37 m, and the tileset carries no
correction, so an uncorrected mesh loads about 37 m underground.

`DK_GEOID_SEPARATION_M = 36.8` in `main.js` is the default and
`__isr_siteMesh.height(n)` tunes it live, because the published
approximation is a starting point and the right value is whatever puts
the building on the ground. The same number applies to every Danish
site.

## Seams

`registerFootprintAdapter(name, adapter)` follows the same shape as the
track, dispatch and telemetry seams. `source` is declared at
registration, not read from the returned data, for the same reason as
everywhere else: provenance belongs to who is speaking, not to a field
the payload can claim for itself.

Outlines are bundled today because there are a few dozen and they
change when a building is built, not when a drone flies. A site with
live outlines, from the national register or a customer's own facility
model, registers a `live` source and nothing else changes.

## Console

```js
await __isr_siteMesh.load('billund')   // load the reconstruction
await __isr_siteMesh.goto()            // put the camera on it
await __isr_siteMesh.debug()           // position, tiles drawn, clip state
await __isr_siteMesh.height(36.8)      // tune the geoid offset live
await __isr_siteMesh.clip(false)       // white boxes back, to compare
__isr_buildings.hide()                 // white boxes off entirely
```

Every handle awaits a load in flight. They did not, and three commands
pasted together all answered "no mesh loaded" about a mesh that was a
second from existing, which reads exactly like a mesh that failed.

`debug()` reports `metresAboveTerrain` and `tiles.selected`, which
separate the ways this looks identical on screen: the mesh never
rendered, it rendered somewhere else, or it rendered and something cut
it away.

On a `buildingsOnly` mesh, `clip(false)` only brings the white boxes
back. It cannot reveal ground, because there is none in the file.

## Not loaded on startup

A site with no entry in `SITE_MESHES` is untouched, which is what keeps
this away from the eight sites that already look right. Meshes are
served from a separate origin rather than `public/`, because a tileset
is hundreds of megabytes and Vite copies `public/` into every build.
`city-creation-framework/mesh-pipeline/serve_tiles.py` serves them locally with the
CORS headers Cesium needs; production is object storage behind a CDN,
set by `VITE_SITE_MESH_URL`.

## Buildings the data cannot place

Some footprints inside a site's coverage produce no geometry at all, and
the result reads as a bug: the orthophoto shows a finished building, the
mesh draws nothing, and the C2 renders a perfect picture lying flat on
the terrain. The worst case at Billund is way `1512060083` at
9.1281 E / 55.7209 N, 17,167 m2, which is the single biggest hole in the
site.

It is not a bug. Three inputs build a building and they do not share a
vintage:

```mermaid
flowchart LR
    OSM["OpenStreetMap footprint<br/>building=construction"] --> GATE{"is_solid_building"}
    DHM["Danmarks Hoejdemodel<br/>0.1 m above its own ground"] --> EXT{"drape_site<br/>--min-height"}
    IMG["SDFI orthophoto, 10 cm<br/>shows it finished"] --> DRAPE["draped texture"]
    GATE -- rejected --> NONE["no geometry"]
    EXT -- too low --> NONE
    DRAPE --> FLAT["a photograph with no height"]
    NONE --> FLAT
```

Both the footprint and the height model say the building does not exist,
and they agree with each other. Only the photograph is current. So
nothing on our side fixes it: allow-listing the tag gets the footprint
as far as the height model, which then extrudes it to 0.1 m.

The fix arrives when the area is flown again. Denmark is split into 55
scanning blocks, about 11 are flown a year, and new blocks land in the
web service roughly July to October. There is no published plan naming
which block is flown in which year.

### The monthly check

`city-creation-framework/mesh-pipeline/watch_height_model.py` polls the data rather than
a calendar, because the calendar is not published. For each watched
footprint it measures the p80 of the surface model inside the outline
minus the median ground just outside, and compares that against a stored
baseline. Billund's worst case reads 0.1 m today and will read fifteen
or more once its block refreshes.

As of 2026-10-06 it watches 39 Billund footprints of 500 m2 or larger.
One of them, way `1443935982` at 682 m2, **already stands at 10.8 m**:
the height model has it and only the stale `building=construction` tag
keeps it out of the mesh. That one is buildable today. The other 38 are
genuinely absent from the height model.

The monthly job is a launchd agent, `com.isrsystems.heightwatch`, and it
runs from `~/Library/Application Support/ISRSystems/heightwatch/` rather
than from this repository. That is not tidiness: a launchd agent does
not inherit the Terminal's permission to read `~/Desktop`, so a job
pointed at the repository fails with `Operation not permitted` before
bash reads the script. The job is therefore self-contained, carrying its
own copy of the checker plus an exported watch list, baseline and token.

**The watch list goes stale if the mesh is rebuilt with different
coverage.** Re-export it as part of any rebuild:

```
python3 watch_height_model.py --site billund \
  --export-watchlist "$HOME/Library/Application Support/ISRSystems/heightwatch/watchlist-billund.json"
```

Exit codes are three-valued on purpose. `0` is checked and unchanged,
`1` is checked and something now stands, `2` is could-not-check. A
monitor that folded `2` into `0` would report "nothing changed" on the
month its own inputs were unreadable, which is the exact wrong answer.
