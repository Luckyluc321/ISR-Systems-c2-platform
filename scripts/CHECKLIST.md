# ISR Systems · Sovereign Stack Checklist

What Lucas needs to register and install for the full sovereign platform.

Current state: **Docker installed + daemon running. First DHM tiles fetched. Tile build in progress.**

---

## Tier 1 · Accounts to create (free, immediate)

Ordered by time-to-value.

### 1. openAIP — free API key (3 min)
- **URL:** https://www.openaip.net
- **Steps:** Sign up → verify email → Settings → API Keys → generate
- **Paste in `.env.local`:** `VITE_OPENAIP_KEY=<key>`
- **Unlocks:** live Danish airspace polygons rendered on the map (TMA / CTR / restricted zones color-coded by ICAO class)

### 2. Vejdirektoratet Dataudveksleren — free API key (5 min)
- **URL:** https://du-portal-ui.dataudveksler.app.vd.dk
- **Steps:** Register → Themes → generate API subscription key
- **Paste in `.env.local`:** `VITE_VEJDIREKTORATET_KEY=<key>`
- **Unlocks:** live road-traffic incident markers on the map (accidents, roadworks, congestion)

### 3. ICAO iSTARS NOTAMs — CUT 2026-09-02
- ICAO retired the NOTAM endpoint from API 2.0 free tier (21 endpoints
  scanned live, none NOTAM-related).
- openAIP already gives us the static Danish airspace surface.
- Dynamic temporary-restriction NOTAMs would require paid Notamify /
  RocketRoute or a signed Eurocontrol EAD agreement (Naviair's route).
- Revisit only when a customer explicitly requires TFR/restriction awareness.

### 4. Datafordeler HentCVRData access request (5 min to send, 1-7 days approval)
- **Email:** cvrselvbetjening@erst.dk
- **Body:** already drafted, parked in memory (sending Sept 15)
- **Unlocks:** company lookups on click (CVR-nr → firma navn, branche, ansatte)

---

## Tier 2 · Accounts for full production hosting (needed when sovereign customer signs)

### 5. Scaleway account + Object Storage bucket (30 min)
- **URL:** https://console.scaleway.com/register
- **Steps:**
  - Register with company email + payment card (Object Storage is <€10/mo for our tile volumes)
  - Console → Object Storage → Create bucket `isr-dhm-tiles` in `fr-par` region
  - Create second bucket `isr-city-tiles` in same region
  - Console → IAM → Create IAM user "isr-c2-deploy" → generate API key (Access Key + Secret)
- **Configure locally:**
  ```
  aws configure --profile isr-scaleway
  # Access Key: <from IAM>
  # Secret: <from IAM>
  # Region: fr-par
  # Output: json
  ```
- **Unlocks:** production hosting for DHM terrain tiles + 3D building tiles served to browsers

### 6. AWS CLI installed (2 min)
- **Homebrew:** `brew install awscli`
- **Or:** https://aws.amazon.com/cli/
- **Used for:** Scaleway Object Storage uploads (Scaleway supports S3-compatible API)

### 7. Datafordeler FTP order — full DK CityGML packages (~10-30GB, arrival in days)
- **URL:** https://datafordeler.dk/dataoversigt/danmarks-hoejdemodel-dhm/
- **Order:** SDFI 3D Bygningsmodel · national 10km-tile packages, delivered via FTP
- **Datafordeler tjenestebruger creds:** already have (`GDGLPLSARK:Luckyluc98!`)
- **Unlocks:** input for full-DK 3D building tiles pipeline

### 8. Datafordeler FTP order — full DK DHM/Terræn tiles (~1.5TB, arrival in days)
- Same order flow as #7
- **Only needed for full-country coverage.** Per-site testing already works via the SDFI WCS script that just ran successfully.

---

## Tier 3 · Downloads (mostly automated by scripts)

| What | How | Size | Automated? |
|---|---|---|---|
| Docker Desktop | ✅ **installed** (v29.6.1 running) | ~700 MB | ✅ done |
| DHM GeoTIFFs (Billund test area) | ✅ **fetched** via `scripts/dhm-pipeline/fetch-dhm-wcs.sh` | ~169 MB (7 tiles) | ✅ done |
| `tumgis/ctb-quantized-mesh` Docker image | ✅ **pulled** | ~200 MB | ✅ done |
| `3dcitydb/*` Docker images | manual: `docker pull 3dcitydb/3dcitydb-pg` when you start the 3D tiles pipeline | ~500 MB | on demand |
| Full DK DHM (production) | Datafordeler FTP order (Tier 2 #8) | ~1.5 TB | on demand |
| Full DK CityGML (production) | Datafordeler FTP order (Tier 2 #7) | ~10-30 GB | on demand |

---

## What's live-verified working today

- ✅ SDFI GeoDanmark Ortofoto (base imagery, sovereign profile)
- ✅ DAWA reverse-geocode (Passagerterminalen 30, 7190 Billund verified)
- ✅ DMI weather / ocean / lightning / radar (5 APIs, no auth)
- ✅ DAGI kommuner + politikredse + regioner (all 12 + 5 verified)
- ✅ BBRPublic building lookups (350 buildings around Billund verified)
- ✅ **GeoDanmark Vektor 6.0 gdk60:Bygning real polygon footprints** (live-verified 2026-09-02, joined to BBR via BBRUUID → id_lokalId)
- ✅ BBR + GeoDanmark extruded buildings on-map (real polygons where GDK has them, square fallback for the rest)
- ✅ **GeoDanmark Vektor features** — 23 layers grouped in 5 categories: basemap (roads, coastline, forest, heath), water (lakes, waterways, basins, wetlands), infrastructure (runways, railways, train stations, harbours, bridges, powerlines, technical facility areas + points, wind turbines, chimneys, masts, telecom masts), urban (low/high settlement, town centres, commerce), perimeter (fences). Per-layer UI toggles under "GeoDanmark · ..." grouped panels. Live-verified 2026-09-02.
- ✅ **Scaleway deployments (LANDED 2026-09-02)** — Container Registry `rg.fr-par.scw.cloud/isr-c2` + Serverless Containers namespace `isr-c2` (fr-par).
  - `vd-amqp-proxy` LIVE: `wss://isrc2fb19f431-vd-amqp-proxy.functions.fnc.fr-par.scw.cloud/traffic` — receiving real DATEX II Situations from Vejdirektoratet.
  - `ais-proxy` container up + WSS healthy: `wss://isrc2fb19f431-ais-proxy.functions.fnc.fr-par.scw.cloud/ships` — **awaiting current DMA endpoint** (ais2.dma.dk DNS gone; frontend stays on mock provider until swapped).
  - DHM terrain tiles on Object Storage: `https://isr-dhm-tiles.s3.fr-par.scw.cloud/` (public-read, CORS wildcard, `.terrain` served with `Content-Encoding: gzip` + `application/vnd.quantized-mesh` — Billund coverage only until full-DK order arrives).
- ✅ SDFI DHM Skyggekort hillshade (layer registered, needs live-check)
- ✅ SDFI DHM/Terræn GeoTIFF download (7 tiles around Billund on disk)
- ✅ Docker + `tumgis/ctb-quantized-mesh` (installed + pulled)

## What needs your action to activate

| Feature | Blocker | Effort |
|---|---|---|
| openAIP airspaces | register key | 3 min |
| Vejdirektoratet traffic | register key | 5 min |
| ICAO NOTAMs | register key | 5 min |
| CVR company lookup | Sept 15 email + approval | wait |
| Full DK DHM terrain | Scaleway account + FTP order | 1-2 weeks |
| Full DK 3D buildings | Scaleway account + FTP order | 1-2 weeks |
| AIS real ships | Scaleway account + deploy `scripts/ais-proxy/` | 1 day |

---

## Local end-to-end demo path (no Scaleway needed)

Once Docker build completes:

```bash
# 1. Serve locally
cd scripts/dhm-pipeline
bash serve-local.sh
# → serving on http://localhost:8081

# 2. Add to .env.local
echo "VITE_DHM_TERRAIN_URL=http://localhost:8081" >> .env.local

# 3. Reload the app with ?profile=sovereign
# → real Danish LiDAR terrain around Billund visible in Cesium
```
