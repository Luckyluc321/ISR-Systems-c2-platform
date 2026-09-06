# ISR Systems · 3D Building Tiles Pipeline

Convert Denmark's BBR + DHM into Cesium 3D Tiles (open standard,
self-hostable). Replaces Google Photorealistic 3D Tiles in the sovereign
render profile.

## Why this exists

The photoreal profile uses Google Photorealistic 3D Tiles via Cesium Ion
(US-hosted, commercial). For sovereign customers we need equivalent 3D
buildings served from our own EU/DK infrastructure. Denmark has all the
raw data — Bygnings- og Boligregistret (BBR) has every building's
footprint + height + type, and DHM/Overflade has the surface model.

## Data sources

- **BBR** — Boligministeriet, via Datafordeler
  - Building footprints (2D polygons) + heights + roof types
  - Free (public part), auth via tjenestebruger
- **DHM/Overflade** — Klimadatastyrelsen, via Dataforsyningen
  - Digital Surface Model (raster) — captures actual observed heights
    incl. rooftop shapes
  - Free, CC BY 4.0
- **SDFI 3D Bygningsmodel (optional shortcut)** — Klimadatastyrelsen
  - Pre-built CityGML per kommune
  - https://dataforsyningen.dk/data/1085
  - Free, CC BY 4.0

**Recommendation:** start with the pre-built **3D Bygningsmodel CityGML**
distribution. Only fall back to raw BBR+DHM if you need custom LOD or
per-building metadata that CityGML doesn't carry.

## Pipeline architecture

```
   ┌───────────────────────┐          ┌──────────────────────────┐          ┌──────────────────┐
   │ SDFI 3D Bygningsmodel │──HTTP───▶│ this pipeline (offline)  │──sync───▶│ tile CDN (S3 /   │
   │ CityGML per kommune   │ ~10-30GB │ - convert CityGML → 3D   │  ~50GB   │  Scaleway Object)│
   │ (annual refresh)      │          │   Tiles via py3dtiles or │          │                  │
   │                       │          │   FME                    │          │                  │
   │                       │          │ - color-code by anvendelse│          │                  │
   │                       │          │ - emit tileset.json      │          │                  │
   └───────────────────────┘          └──────────────────────────┘          └──────────────────┘
                                                                                     │
                                                                                     ▼
                                                                            ┌──────────────────┐
                                                                            │ ISR C2 browser   │
                                                                            │ sovereign profile│
                                                                            │ Cesium3DTileset. │
                                                                            │ fromUrl(...)     │
                                                                            └──────────────────┘
```

## Tooling

**Correct pipeline (verified 2026-09-02):**
- **py3dtilers** by Oslandia: https://github.com/VCityTeam/py3dtilers
  Consumes CityGML via 3DCityDB (PostgreSQL/PostGIS) → outputs 3D Tiles.
  Not a one-command CLI — you first load CityGML into 3DCityDB, then run
  py3dtilers. More setup than the raw py3dtiles suggested earlier.
- Alternative: **3DCityDB Importer/Exporter** (java, GUI + CLI):
  https://www.3dcitydb.org — imports CityGML, exports 3D Tiles directly.
  Actively maintained, well-documented.
- Alternative: **FME Desktop** (commercial, ~€5-8k/yr, mature).

**Note:** `oslandia/py3dtiles` Docker image referenced in earlier drafts
of this README does NOT exist on Docker Hub. `py3dtiles` (the base
library) does NOT convert CityGML directly — only las/laz/xyz/ply point
clouds. The `py3dtilers` fork is the correct tool for CityGML, but it
requires a 3DCityDB backend. Plan on 1-2 extra days for the 3DCityDB
setup vs the earlier estimate.

## Getting CityGML data

There is NO per-kommune single-file REST endpoint. SDFI 3D Bygningsmodel
is distributed as **national 10km-tile packages** via the Datafordeler
order flow, or as **fildownload** from Dataforsyningen.

- Order flow: https://datafordeler.dk/dataoversigt/danmarks-hoejdemodel-dhm/
  (same order flow serves 3D Bygningsmodel — filter dataset)
- Dataforsyningen "Hent data": https://dataforsyningen.dk/data/1085
- Some kommuner publish their OWN CityGML via kommune open-data portals
  (e.g. København at kk.dk/open-data). Coverage varies.

Once you have `.gml` files locally in `./input/`, proceed.

## Local test run

```bash
# After downloading CityGML tiles to ./input/
mkdir -p output

# Set up 3DCityDB locally (Postgres/PostGIS)
docker run -d --name citydb \
  -e POSTGRES_DB=citydb -e POSTGRES_USER=citydb -e POSTGRES_PASSWORD=citydb \
  -p 5432:5432 tumgeoinformatics/3dcitydb-postgis:latest

# Import CityGML into 3DCityDB (use 3DCityDB Importer/Exporter tool)
# See: https://www.3dcitydb.org

# Then export as 3D Tiles via py3dtilers or 3DCityDB Importer/Exporter
# (both paths documented in tool README — py3dtilers takes 3DCityDB conn)
```

**Fastest all-in-one alternative:** use **3DCityDB Importer/Exporter**
GUI or CLI (java) — imports CityGML AND exports 3D Tiles in one tool.
See https://www.3dcitydb.org/3dcitydb/docs/

## Full-DK build cost estimate

- **Compute:** Scaleway Enterprise DEV1-L, ~2 days wall clock for full
  DK CityGML → 3D Tiles. €12 one-off.
- **Storage:** ~50 GB output. €0.50/mo on Scaleway Object Storage.
- **Bandwidth:** browser fetches lazily by camera frustum, ~10-20 MB per
  operator per hour of active use.

## Deploy the tile CDN

Same pattern as `../dhm-pipeline/`. Push to Scaleway Object Storage
bucket with public-read + CORS.

```bash
aws s3 sync ./output s3://isr-city-tiles/ \
  --endpoint-url=https://s3.fr-par.scw.cloud \
  --acl public-read
```

## Frontend wiring (post-deploy)

In `src/main.js`, in the render-profile branch:

```js
const cityUrl = import.meta.env?.VITE_CITY_TILES_URL || '';
if (_renderProfile === 'sovereign' && cityUrl) {
  const sovBuildings = await Cesium.Cesium3DTileset.fromUrl(`${cityUrl}/tileset.json`);
  viewer.scene.primitives.add(sovBuildings);
  // Color per building anvendelse (usage code) — reuse the BBR color palette
  sovBuildings.style = new Cesium.Cesium3DTileStyle({
    color: {
      conditions: [
        ["${byg021BygningensAnvendelse} === '120'", "color('#4dd2ff', 0.9)"],  // enfamiliehus
        ["${byg021BygningensAnvendelse} === '390'", "color('#ffb84d', 0.9)"],  // industri
        ["true", "color('#b4c8dc', 0.85)"],
      ],
    },
  });
}
```

## Status

**SCAFFOLDED, NOT BUILT.** Trigger when a sovereign customer needs 3D
building visualisation (Forsvaret site briefings, PET protection
planning). Google Photorealistic is fine for the photoreal profile until
then.

## Related

- Terrain pipeline: `../dhm-pipeline/` (DHM → quantized-mesh terrain)
- Roadmap: `../../docs/geospatial-integrations.md` Tier C section
