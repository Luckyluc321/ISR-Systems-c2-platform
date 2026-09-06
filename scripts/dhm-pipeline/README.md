# ISR Systems · DHM Terrain Pipeline

Convert Denmark's official LiDAR terrain (Danmarks Højdemodel, DHM) into
Cesium quantized-mesh terrain tiles, self-hosted on your own EU/DK
infrastructure. Replaces Cesium World Terrain in the sovereign render
profile.

## Why this exists

The photoreal profile uses Cesium World Terrain (Cesium Ion, US-hosted).
For sovereign customers who require Danish data residency + independence
from Cesium's commercial service, we need to serve terrain from our own
infrastructure. DHM is Klimadatastyrelsen's official 40cm LiDAR terrain,
covering all of Denmark, annually refreshed. Free open data.

## Data source

- **Dataset:** Danmarks Højdemodel — Terræn (DHM/Terræn)
- **Publisher:** Klimadatastyrelsen (via Dataforsyningen)
- **Format at source:** GeoTIFF raster tiles, 0.4m resolution, EPSG:25832
- **Coverage:** entire Denmark, ~1.5 TB uncompressed
- **License:** CC BY 4.0
- **Refresh:** annual, published Feb/Mar
- **Download:** https://dataforsyningen.dk/data/928 (needs SDFI token +
  DHM dataset subscription on your account)

## Pipeline architecture

```
   ┌───────────────────────┐          ┌──────────────────────────┐          ┌──────────────────┐
   │ SDFI DHM/Terræn        │──HTTP───▶│ this pipeline (offline)  │──sync───▶│ tile CDN (S3 /   │
   │ GeoTIFF, 40cm, ETRS89 │  ~1.5TB  │ - reproject to WGS84     │  ~500GB  │  Scaleway Object)│
   │ (annual refresh)      │          │ - build quantized-mesh   │          │                  │
   │                       │          │   pyramid (levels 0-15)  │          │                  │
   │                       │          │ - gzip tiles             │          │                  │
   │                       │          │ - emit layer.json        │          │                  │
   └───────────────────────┘          └──────────────────────────┘          └──────────────────┘
                                                                                     │
                                                                                     ▼
                                                                            ┌──────────────────┐
                                                                            │ ISR C2 browser   │
                                                                            │ sovereign profile│
                                                                            │ CesiumTerrain    │
                                                                            │ Provider(url=... │
                                                                            └──────────────────┘
```

## Tooling

- **ctb-quantized-mesh** (recommended): https://github.com/ahuarte47/cesium-terrain-builder
  Modern fork of `cesium-terrain-builder` with Docker support, EPSG:25832
  → WGS84 reprojection built in.
- Alternative: **CesiumGS/cesium-terrain-builder** (original, but older).

## Getting DHM/Terræn raster data

There is NO single-tile REST endpoint like `?tile=1km_6178_509.tif`. DHM/
Terræn is served through three programmatic paths:

**Option 1 — WCS GetCoverage (best for scripted extraction of custom areas):**
```bash
# Get GetCapabilities first to confirm coverage layer name
curl "https://api.dataforsyningen.dk/dhm_wcs_DAF?service=WCS&request=GetCapabilities&token=${SDFI_TOKEN}"

# Then GetCoverage for a bbox (e.g. Billund kommune footprint, EPSG:25832)
curl -o input/billund_dhm.tif \
  "https://api.dataforsyningen.dk/dhm_wcs_DAF?service=WCS&version=2.0.1&request=GetCoverage&coverageId=dhm_terraen&subset=E(505000,520000)&subset=N(6170000,6185000)&format=image/tiff&token=${SDFI_TOKEN}"
```

**Option 2 — WMTS shaded-relief tiles (if you only need pre-rendered hillshade):**
`https://api.dataforsyningen.dk/dhm_terraen_skyggekort_DAF?service=WMTS&token=X`

**Option 3 — Bulk 1km GeoTIFF tiles via Datafordeler FTP (for full-country builds):**
Order via https://datafordeler.dk/dataoversigt/danmarks-hoejdemodel-dhm/terraen-brugerdefineret-geotiff/
using your Datafordeler tjenestebruger creds. Delivers zipped tiles by 1km grid
(naming convention `1km_NNNN_EEE.tif`) to `ftp3.datafordeler.dk`.

## Local test run

```bash
# Use Option 1 above to pull a small area to ./input/
mkdir -p input output

# Then run the tiler
docker run --rm -v $(pwd)/input:/data/input -v $(pwd)/output:/data/output \
  tumgis/ctb-quantized-mesh \
  ctb-tile -f Mesh -C -N -o /data/output -s 0 -e 15 /data/input/*.tif
# Output: /output has layer.json + tile pyramid (0/, 1/, ..., 15/)
```

## Full-DK build cost estimate

- **Compute:** Scaleway Enterprise DEV1-L (8 CPU, 16GB RAM), ~4 days
  wall clock. €25 one-off.
- **Storage:** ~500 GB output on Scaleway Object Storage. €5/mo.
- **Bandwidth:** browser fetches tile-by-tile, ~50 MB per operator per
  hour of active use. Well within Scaleway's free egress tier for
  low-traffic ops.

## Deploy the tile CDN

Two options:

### Option A: Scaleway Object Storage (recommended for MVP)

```bash
# Push tiles to a Scaleway bucket
aws s3 sync ./output s3://isr-dhm-tiles/ \
  --endpoint-url=https://s3.fr-par.scw.cloud \
  --acl public-read

# Enable CORS on the bucket:
#   AllowedOrigins: https://your-c2-domain
#   AllowedMethods: GET, HEAD
```

Then the frontend URL becomes:
```
VITE_DHM_TERRAIN_URL=https://isr-dhm-tiles.s3.fr-par.scw.cloud
```

### Option B: Nginx on a Scaleway container

For customers who need TLS-terminated custom domain + logging.

## Frontend wiring (post-deploy)

In `src/main.js`, replace the Cesium World Terrain load with:

```js
const dhmUrl = import.meta.env?.VITE_DHM_TERRAIN_URL || '';
if (_renderProfile === 'sovereign' && dhmUrl) {
  viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(dhmUrl, {
    requestVertexNormals: true,
    requestWaterMask: false,   // DHM/Terræn is land-only
    credit: 'Terrain © Klimadatastyrelsen · DHM (CC BY 4.0)',
  });
} else {
  viewer.terrainProvider = await Cesium.createWorldTerrainAsync({ ... });
}
```

## Status

**SCAFFOLDED, NOT BUILT.** Run the build when a sovereign customer
signature is imminent. Or wait until the ISR platform ships to
Forsvaret/PET who will require it.

## Related

- Parallel pipeline: `../city-tiles-pipeline/` (BBR + DHM → 3D building
  tiles, replaces Google Photorealistic 3D)
- Roadmap: `../../docs/geospatial-integrations.md` Tier C section
