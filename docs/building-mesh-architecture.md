# Building Mesh Architecture

How a white extruded box becomes a photographed building.

Away from the cities Google's photorealistic tiles cover, every
building in the map is a white box from Cesium's OSM Buildings tileset:
the right outline, roughly the right height, nothing else. At Billund,
Esbjerg and every substation, that is what an operator sees.

`scripts/mesh-pipeline/` builds the replacement from Danish national
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
    C["clip_to_buildings.py<br/>cuts the geometry"]
    E["export_footprints.py<br/>outlines the C2 clips with"]
  end

  subgraph c2["4. Swap them in the map"]
    M["Cesium3DTileset<br/>the reconstruction"]
    B["Cesium OSM Buildings<br/>the white boxes"]
    S["building_footprints.js<br/>applyBuildingSwap"]
  end

  OSM --> PB --> F --> P --> O
  O --> C
  O --> E
  OSM --> E
  OSM --> C
  E --> S
  S -->|"inverse: true<br/>keep inside"| M
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

## Two ways to cut, and both are used

**Geometry**, in `clip_to_buildings.py`. Keeps triangles whose centroid
sits inside a padded footprint and at least 2 m above local ground. The
height test matters because a footprint alone also captures the tarmac
inside a building outline wherever the roof failed to reconstruct,
which would hoist a patch of ground to roof level.

Padding is a true dilation by distance to the nearest edge, not a grown
bounding box. An OSM footprint is the roof outline seen from above
while a reconstructed wall leans outward from it, so without real
padding the wall triangles are shaved off and roofs float with nothing
under them.

**Render time**, in `building_footprints.js`, via Cesium's
`ClippingPolygonCollection`. One outline set, used twice in opposite
directions:

| Layer | `inverse` | Effect |
| --- | --- | --- |
| Reconstruction | `true` | keep only what is inside a footprint |
| OSM white boxes | `false` | remove what is inside a footprint |

That symmetry is why clipping, rather than some other rule for hiding
boxes. Both layers are cut against the same polygon, so they cannot
disagree at the edges.

Render-time clipping hides geometry, it does not stop it downloading.
Fine for one site, wrong for a country, so cutting the geometry stays
the answer when tiling a city.

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
__isr_siteMesh.load('billund')   // load the reconstruction
__isr_siteMesh.height(36.8)      // tune the geoid offset live
__isr_siteMesh.clip(false)       // raw reconstruction, boxes back
__isr_siteMesh.footprints()      // what is being clipped against
__isr_buildings.hide()           // white boxes off entirely
```

`clip(false)` is the diagnostic that separates "the mesh is wrong" from
"the mesh is right and the outlines are cutting it in the wrong place".

## Not loaded on startup

A site with no entry in `SITE_MESHES` is untouched, which is what keeps
this away from the eight sites that already look right. Meshes are
served from a separate origin rather than `public/`, because a tileset
is hundreds of megabytes and Vite copies `public/` into every build.
`scripts/mesh-pipeline/serve_tiles.py` serves them locally with the
CORS headers Cesium needs; production is object storage behind a CDN,
set by `VITE_SITE_MESH_URL`.
