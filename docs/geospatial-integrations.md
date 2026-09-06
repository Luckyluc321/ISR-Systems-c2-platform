# Danish Geospatial Integrations — Roadmap

Reference architecture for the sovereign render profile. This document is the single source of truth for which Danish geospatial data sources are wired, which are stubbed, and which are pending.

**Related code:**
- [src/render_profile.js](../src/render_profile.js) — profile flag + URL/localStorage override
- [src/sovereign_layers.js](../src/sovereign_layers.js) — declarative layer registry + `SovereignLayerManager`
- [src/main.js](../src/main.js) — init hook (gated on `sovereign` profile)

**Related memory:**
- `project_map_architecture` — Cesium engine, SDFI 2D default, day-mode/night-mode split
- `feedback_never_touch_day_mode`
- `feedback_never_touch_cesium_globals`
- `feedback_api_nn_plugin_ready` — every integration must leave a clean seam for real data

---

## Architecture

Two render profiles, one CesiumJS engine, single flag:

- `photoreal` (default) — Cesium Ion + Google Photorealistic 3D Tiles + Cesium World Terrain. Best fidelity for demos and non-sovereign customers.
- `sovereign` — SDFI-primary imagery, self-hosted Danish terrain (pending), self-hosted BBR+DHM 3D tiles (pending). 100% DK data residency.

Flip via `?profile=sovereign` URL param, `localStorage['isr:render_profile'] = 'sovereign'`, or `window.__isr_setRenderProfile('sovereign')` in DevTools.

**Feature guarantee.** Only the imagery/terrain/3D-tiles data providers change. All entities (sensors, sites, drone tracks, coverage circles, trajectory lines, debrief overlays, replay UI, event escalation) render on top and are identical across profiles.

---

## Extended Integrations (2026-09-02, batch 2)

New services added on top of the sovereign feature set:

| Service | Provider | Status | Notes |
|---|---|---|---|
| **ICAO iSTARS NOTAMs** | ICAO applications.icao.int | corrected 2026-09-02 after live verification | Real endpoint `/notams-realtime-list` (not `/notams-list`). Filter via `states=DNK` OR `locations=EKCH,...` (max 10 ICAO 4-letter codes). `criticality=true` is a BOOLEAN enabler, not a filter — response.criticality is 0-4 scale, filter client-side. Free tier is ~25-100 lifetime calls, not daily. `VITE_ICAO_ISTARS_KEY` + booster packs for volume. |
| **BBR Fortrolig** | (does not exist) | marker entry — throws with guidance | Live-verified 2026-09-02: BBR is Sikkerhedszone 0, no fortrolig tier exists on Datafordeler service catalog. For restricted data use EJF (Ejerfortegnelsen — ejerforhold), VUR (Vurderingsstyrelsen — vurderinger), or CPR. Registry entry kept as a "don't waste time looking here" marker. |
| **Vejdirektoratet cameras** | Vejdirektoratet (via trafikkort.vejdirektoratet.dk) | stub only | NO PUBLIC API. Requires bilateral partnership with Vejdirektoratet. Documented in service `_notes` with 3 possible paths. Parked until first motorway customer asks. |

**Self-hosted pipelines (scaffolded, not built):**

- [scripts/dhm-pipeline/](../scripts/dhm-pipeline/) — DHM/Terræn GeoTIFF → Cesium quantized-mesh terrain. Docker via `tumgis/ctb-quantized-mesh`. Deploy target: Scaleway Object Storage. Env var: `VITE_DHM_TERRAIN_URL`. Trigger: first sovereign customer signature.
- [scripts/city-tiles-pipeline/](../scripts/city-tiles-pipeline/) — SDFI 3D Bygningsmodel CityGML → Cesium 3D Tiles. Docker via `oslandia/py3dtiles`. Deploy target: Scaleway Object Storage. Env var: `VITE_CITY_TILES_URL`. Trigger: sovereign customer requires 3D buildings (Forsvaret briefings, PET protection).

Both pipeline folders have `README.md` + `build.sh` + Docker instructions. Frontend wiring snippets included at the bottom of each README so post-deploy integration is a copy-paste.

---

## DK Sovereign Version — Feature Complete (2026-09-02)

Rendering + UI + geo routing all landed. See per-module tables below.

**New modules (2026-09-02):**
- [src/sovereign_renderers.js](../src/sovereign_renderers.js) — Cesium entity managers: `AisShipRenderer` (billboards + heading arrows + type-color), `AirspaceRenderer` (PolygonHierarchy per ICAO class), `TrafficEventRenderer` (color-coded point markers + DATEX II XML parser).
- [src/sovereign_geo_routing.js](../src/sovereign_geo_routing.js) — DAGI point-in-polygon router: 98 kommuner + 12 politikredse + 5 regioner → receiver-id map, ray-casting with polygon-hole support, Promise.allSettled prime. Exposed as `window.__isr_geo_routing`.

**New UI:**
- Header render-profile chip (`.tb-render-profile`) — shows `SOVEREIGN · DK` or `PHOTOREAL`, click to switch (triggers page reload), Escape to close popup.
- Sovereign Live Feeds control-panel section — checkboxes for AIS ships / Airspaces / Traffic events, with rapid-toggle epoch guards.

**Verification-pass fixes (from 4 code-review agents, all applied):**
- Renderers: lazy Cesium resolution, Unicode-safe btoa (`TextEncoder` path), operator-precedence parens on polygon-type check, AIS entity TTL sweep with `_lastTs` stamping, Vejdirektoratet content-type warning.
- Live Feeds/BBR: BBR envelope `meta` sub-field for coord-resolution (envelope shape stability), rapid-toggle epoch guards on airspace + traffic renderers, DAWA-unavailable logging, traffic dead-catch fixed.
- Profile chip: doc-click listener leak fixed, cross-menu collision with operator dropdown resolved, Escape-key dismiss, `aria-haspopup`/`aria-expanded` added.
- Geo routing: **BLOCKER** Vesthimmerlands slug corrected (`kom-vesthimmerland` → `kom-vesthimmerlands`), **BLOCKER** phantom Christiansø entry removed (not a kommune), polygon holes handled correctly (København contains Frederiksberg as enclave), Promise.allSettled prime, misleading `wireIntoRouter` comment removed.

---

## Tier A — In-session wiring (LANDED 2026-09-01, verification sprint 2026-09-01)

Data-driven registry in [sovereign_layers.js](../src/sovereign_layers.js). Every layer defaults to disabled; toggle via DevTools or the Sovereign Layers panel in the Map Controls sidebar (sovereign profile only):

```js
window.__isr_layers.list()                     // all layers, status, verification flag
window.__isr_layers.enable('dagi_kommunegraenser')
window.__isr_layers.disable('dagi_kommunegraenser')
window.__isr_layers.isEnabled('dagi_politikredse')
```

### Imagery

| Layer ID | Source | Type | Status | Notes |
|---|---|---|---|---|
| `sdfi_ortho_spring` | SDFI GeoDanmark | WMTS | **LIVE** (managed by main.js) | Primary sovereign imagery. Blad-på, forår, årligt refresh. |
| `sdfi_ortho_autumn` | SDFI GeoDanmark | WMTS | STUB — LOW CONFIDENCE | Autumn variant name follows SDFI `*_DAF` convention; not doc-cited. Test with live token before promotion. |
| `sdfi_topo_skaermkort` | SDFI | WMTS | STUB — MEDIUM CONFIDENCE | Datafordeler publicerer Klassisk + Dæmpet WMTS. `topo_skaermkort_DAF` er DAF proxy-navn. Verify with live token. |
| `sdfi_skraafoto` | SDFI Skråfoto | external-viewer | STUB | Not a standard WMTS. Needs iframe embed OR custom Cesium primitive. Defer to UI-panel sprint. |

### Vector jurisdictions (feeds geospatial escalation routing)

| Layer ID | Source | Type | Status | Notes |
|---|---|---|---|---|
| `dagi_kommunegraenser` | Dataforsyningen · `DAGI_10MULTIGEOM_GMLSFP_DAF` | GeoJSON via WFS | STUB — MEDIUM-HIGH | Corrected 2026-09-01: was legacy `dagi_gml3_nohist_l1`, now current-gen DAGI multi-geometry SFP. 98 kommunegrænser, ~10MB payload — cache client-side. |
| `dagi_politikredse` | Dataforsyningen · same base | GeoJSON via WFS | STUB — MEDIUM-HIGH | Typename `Politikreds` confirmed in DAGI entity list. |
| `dagi_regionsgraenser` | Dataforsyningen · same base | GeoJSON via WFS | STUB — MEDIUM-HIGH | Typename `Regionsinddeling` confirmed in DAGI entity list. |
| `beredskab_omraader` | Beredskabsstyrelsen | (no canonical served endpoint) | UNAVAILABLE | Verified 2026-09-01: no public GeoJSON/WFS exists. Must be built from DAGI kommunegrænser + §60-beredskab membership (24 §60-beredskaber, mapping fra BRS årsrapport). |

### Overlays

| Layer ID | Source | Type | Status | Notes |
|---|---|---|---|---|
| `droneluftrum_no_fly` | Trafikstyrelsen | GeoJSON | UNAVAILABLE | Verified 2026-09-01: droneluftrum.dk retired 2026-07-01. Replacement dronezoner.dk har ingen offentligt dokumenteret API. Kræver Trafikstyrelsen-partnership eller manual scrape. |
| `dmi_radar` | DMI Open Data | external-processing-required | UNAVAILABLE as WMS | Verified 2026-09-01: DMI radar er STAC API - Features (HDF5-filer), ikke WMS. In-map render kræver server-side HDF5→PNG tiler — ingen drop-in Cesium provider. |

**Verification workflow.** Every STUB entry carries `_needsVerification: true` and a `_notes` field. Before enabling in a customer demo:

1. Register a token at the relevant provider (dataforsyningen.dk / opendataapi.dmi.dk / datafordeler.dk)
2. In DevTools: `__isr_layers.enable(id)` (or check the box in the Sovereign Layers panel)
3. Confirm tiles/features render
4. Remove `_needsVerification` flag in `sovereign_layers.js`
5. Set `enabledByDefault: true` if it should auto-load on sovereign profile

---

## Tier B — REST API integrations (SCAFFOLDING LANDED 2026-09-01, tokens pending)

Click-driven REST lookups, not tile providers. Live in [src/sovereign_services.js](../src/sovereign_services.js). Always-available (not profile-gated); gated only by token presence. Each service throws a clear "not configured" error if its token is missing.

```js
window.__isr_services.list()                            // all services, provider, token status
window.__isr_services.setToken('datafordeler', '<key>') // configure a token at runtime
window.__isr_services.bbr(55.7405, 9.1580)              // BBR lookup at Billund
window.__isr_services.dar(55.7405, 9.1580)              // reverse-geocode
window.__isr_services.dmi(55.7405, 9.1580, 20)          // nearest weather stations within 20km
window.__isr_services.cvr('12345678')                   // CVR company lookup
```

| Service ID | Source | Endpoint pattern | Status |
|---|---|---|---|
| `bbr` | Datafordeler | `/BBR/BBRPublic/1/rest/bygning?Nord=&Syd=&Oest=&Vest=` (EPSG:25832 bbox) | Corrected 2026-09-01. Requires WGS84→EPSG:25832 coord transform (`wgs84ToEtrs89Utm32` stub — throws until proj4js or inline formula wired). Auth = "user:pass" in token slot. |
| `geodanmark_bygning` | Datafordeler | `wfs.datafordeler.dk/GeoDanmarkVektor/GeoDanmark60_NOHIST_GML3/1.0.0/WFS?typeNames=gdk60:Bygning&BBOX=...` (EPSG:25832) | **LIVE-VERIFIED 2026-09-02**. Real polygon footprints for extruded buildings. Same tjenestebruger auth as BBR. Joined to BBR via `id_lokalId` ↔ `gdk60:BBRUUID` (~48% match rate; unmatched BBR entries fall back to square approximation). |
| `geodanmark_features` (23 layers) | Datafordeler | Same host, per-layer `typeNames=gdk60:{Vejmidte,Kyst,Skov,Hede,Soe,Vandloebsmidte,Bassin,Vaadomraade,Startbane,Jernbane,Togstation,Havn,Bygvaerk,Hoejspaendingsledning,TekniskAnlaegFlade,TekniskAnlaegPunkt,Vindmoelle,Skorsten,Mast,Telemast,LavBebyggelse,HoejBebyggelse,Bykerne,Erhverv,Hegn}` | **LIVE-VERIFIED 2026-09-02**. Generic renderer in `sovereign_geodanmark_features.js`; layers organised by `category` (basemap / water / infrastructure / urban / perimeter) and rendered as grouped toggles. Zero-code extension: append entry to `GDK_FEATURE_LAYERS`, appears in UI on next build. Coverage counts around Billund 5km bbox 2026-09-02: roads 4550, lakes 107, coastline 0 (inland), forest 141, heath varies, runways 15, railways 0, harbours 0, bridges 497, powerlines 2, technical-facility polygons 45, wind turbines 2, chimneys 16, masts 3974, telecom-masts 22, low-settlement 317, high-settlement 4, town-centres 0, commerce 13, wetlands 38, waterways 1331, basins 45, fences 11427 (dense — user opt-in only). Empty-at-Billund layers non-empty at CPH/Aarhus/Copenhagen/Esbjerg. |
| `dar` | **DAWA** (`api.dataforsyningen.dk/adgangsadresser/reverse`) | `?x=lon&y=lat&srid=4326` | **VERIFIED** 2026-09-01. Swapped from Datafordeler DAR (no reverse-geocode REST) to DAWA (public, no token, documented). |
| `dmi_weather` | **opendataapi.dmi.dk** (migrated from dmigw.govcloud.dk) | `/v2/metObs/collections/observation/items?bbox=...` | **VERIFIED** 2026-09-01. Host migrated (govcloud endpoint retired 2026-06-30). Needs api-key registration at opendataapi.dmi.dk. |
| `cvr` | Datafordeler | `/CVR/HentCVRData/1/rest/hentVirksomhedMedCVRNummer?ppno=X` | Corrected 2026-09-01. Was wrong path (`HentCVRDataNyeste`) + wrong method + wrong param name. Auth = "user:pass" in token slot. Param `ppno` needs verify with live account. |

**Response envelope (all services return this shape):**
```json
{
  "provider": "Datafordeler · BBR",
  "authority": "Boligministeriet (via Vurderingsstyrelsen)",
  "retrieved_at": "2026-09-01T14:23:00.000Z",
  "source_url": "https://services.datafordeler.dk/BBR/...",
  "data": { /* provider-specific payload */ }
}
```

Matches the agentic-architecture "data provenance is a first-class artifact" principle — every derived value carries its lineage.

**Access agreements needed for restricted datasets:**
- **BBR-fortrolig** (owner details, private valuation) — signed agreement per customer
- **CPR** (person register) — signed agreement, Politi/skattemyndighed scope only
- **Ejendomsregistret** (property ownership) — signed agreement per customer
- **Motorregistret** (vehicle registration) — Politi only

**Free / public today (once tokens registered):**
- BBR public part (building geometry, type, usage, year)
- DAR (all Danish addresses)
- CVR (company register)
- DMI weather (open data)
- DAGI mirrors

---

## Tier C — Self-hosted tile pipelines (1-2 weeks per pipeline)

Cannot happen in the browser codebase. Requires build infrastructure.

| Pipeline | Input | Output | Tooling | Hosting |
|---|---|---|---|---|
| SDFI DHM → quantized-mesh terrain | DHM raster (WCS from Klimadatastyrelsen) | Cesium quantized-mesh tileset | `cesium-terrain-builder` or `ctb-quantized-mesh` | Azure DK East or Scaleway (FR) |
| BBR+DHM → 3D Tiles buildings | 3D Bygningsmodel CityGML (SDFI) | Cesium 3D Tiles | `py3dtiles` or FME | Same as above |

**Trigger:** first sovereign customer signature. Not before — no point maintaining a tile pipeline with no customer to serve.

---

## Tier D — Live-feed infrastructure (SCAFFOLDED 2026-09-02, keys pending)

### AIS ship tracking

- **Client:** [src/sovereign_live_feeds.js](../src/sovereign_live_feeds.js) — provider-abstracted (`mock` default + `websocket`). Manager exposed as `window.__isr_live_feeds`.
- **Backend:** [scripts/ais-proxy/](../scripts/ais-proxy/) — Node.js Docker container. Decodes NMEA via `ggencoder` (`AisDecode`), rebroadcasts JSON ship-updates over WebSocket with per-client bbox filtering.
- **Deployment 2026-09-02:** LIVE on Scaleway Serverless Container `isr-c2/ais-proxy` (fr-par, min-scale=1). WSS URL `wss://isrc2fb19f431-ais-proxy.functions.fnc.fr-par.scw.cloud/ships`. `/health` returns `{status,shipsKnown,clients,dmaConnected}`.
- **BLOCKED:** `ais2.dma.dk:4001` (the old DMA raw feed hostname) no longer resolves in DNS. Container is up and healthy but has no upstream. Frontend continues on mock provider until DMA endpoint updated. Current DMA AIS distribution is on [github.com/dma-ais](https://github.com/dma-ais) — needs research.
- **Data residency:** EU-parented (Scaleway FR). Migrate to Azure DK East when sovereign-mandate customer requires DK-only.
- **Frontend state:** always initialised. `mock` provider active until `VITE_AIS_WS_URL` set. Feeds do NOT auto-start — call `window.__isr_live_feeds.start('ais_ships', [minLon, minLat, maxLon, maxLat])` explicitly.

### Naviair airspace (via openAIP)

- **Reality check:** Naviair does NOT publish AIXM directly — routed via Eurocontrol EAD which needs signed EU agreement. Impractical.
- **Pragmatic path:** community mirror [openAIP.net](https://openaip.net) — Danish airspaces as GeoJSON, free tier + API key.
- **Registered as service:** `openaip_airspaces` in [src/sovereign_services.js](../src/sovereign_services.js). Two fetch modes: `fetchDanishAirspaces()` (bulk pull all DK) + `findAirspacesNear({lat, lon, radiusKm})` (bbox filter after cache).
- **Auth:** `x-openaip-client-id` header. Env: `VITE_OPENAIP_KEY`.
- **Refresh:** 28-day AIRAC cycle. Cache bulk pull, refresh weekly at most.
- **Caveat:** community-curated, fine for visualisation ("is drone in TMA?"). NOT airworthiness-authoritative — no flight planning.
- **NOTAMs:** deferred. Naviair has no public NOTAM feed. Options: ICAO iSTARS (100 free calls then paid), FAA DINS scrape (unofficial), EAD PAMS subscription. Skip until a customer explicitly asks.

### Vejdirektoratet live traffic (via Dataudveksleren)

- **Reality check (verified 2026-09-02):** old `api.vejdirektoratet.dk/trafikinfo/` retired. New system = **Dataudveksleren** (Denmark's official NAP under Ministry of Transport). Distribution is **AMQP-only over Azure Service Bus** — no REST data endpoint. Auth = Azure AD service principal (client_credentials → `https://servicebus.azure.net/.default` scope).
- **Server-side proxy:** [scripts/vd-amqp-proxy/](../scripts/vd-amqp-proxy/) — Node.js container holds the AMQP subscription 24/7, rebroadcasts DATEX II XML to browsers over WebSocket. Message shapes: `{type:'traffic-batch',events:[...]}` on connect, `{type:'traffic-event',event:{...}}` per push.
- **Deployment 2026-09-02:** LIVE on Scaleway Serverless Container `isr-c2/vd-amqp-proxy` (fr-par, min-scale=1). WSS URL `wss://isrc2fb19f431-vd-amqp-proxy.functions.fnc.fr-par.scw.cloud/traffic`. Received 5 real Situations within seconds of first deploy.
- **Servicekonto (Luckyluc123, bound to dataset 222):**
  - Tenant ID `f1044067-8c60-4022-98d8-69306c5f7238`
  - Client ID `400b03a9-3bed-4456-8ce5-c98615930465`
  - Client secret stored as `secret-environment-variable` on the container (argon2id-hashed at rest, plain in `.env.local` as `VD_AAD_CLIENT_SECRET`)
  - Service Bus FQDN `sb-duvproddistribution.servicebus.windows.net`
  - Topic `t-distribution-222`, subscription `a022c9a4-b55f-4c1a-87af-7f4759fac9f4`
- **Frontend consumer:** [sovereign_live_feeds.js](../src/sovereign_live_feeds.js) `VejdirektoratetTrafficProvider` (WebSocket + reconnect backoff). Renderer `TrafficEventRenderer.upsertFromXml` in `sovereign_renderers.js` (id-based dedup, no wipe on push).
- **Env:** `VITE_VD_TRAFFIC_WS_URL` = production WSS URL. Empty falls back to no traffic.
- **Format:** DATEX II XML (EU-mandated per AFIR deadline 14 April 2026). Parsed by `parseDatexIISituations`.
- **Datasets available (registry via DCAT):** traffic events (222), road weather (59), salt/snow ploughs (82), road weather stations (178), speed limits (112), central road register (58). We wire only #222 for now.
- **Caveat:** camera imagery NOT in the NAP catalog. Reserved for later + private GCS integration.

### Registration checklist (owner: Lucas)

| Env var | Where to register | Free? | Time |
|---|---|---|---|
| `VITE_OPENAIP_KEY` | openaip.net → Sign up → Settings → API keys | Yes | 3 min |
| `VITE_VEJDIREKTORATET_KEY` | du-portal-ui.dataudveksler.app.vd.dk → Register → Themes | Yes | 5 min |
| `VITE_AIS_WS_URL` | (deploy scripts/ais-proxy/ to Scaleway first) | Container cost ~€5/mo | ~1 day incl deploy |

---

## Full DK provider registry (reference)

The universe of Danish public geospatial data. Not all wired — pull items into Tier A/B/C/D as they become relevant.

### Terrain / elevation
- **Danmarks Højdemodel (DHM) — Terræn** — Klimadatastyrelsen, WCS, 40cm LiDAR, nationwide
- **DHM/Punktsky** — 10 pts/m² raw LiDAR
- **DHM/Bathymetri** — Søfartsstyrelsen, WCS
- **DHM/Overflade** — DSM incl. buildings + trees (alternative to 3D Tiles)

### Imagery
- **GeoDanmark Ortofoto** — SDFI, WMTS, spring + autumn variants + historical back to 1954
- **Skråfoto** — SDFI, oblique 4-cardinal
- **Kortforsyningen Skærmkort** — SDFI, WMTS, topographic rendered base

### 3D city
- **3D Bygningsmodel** — SDFI, CityGML, derived from BBR+DHM (FTP-order, Tier C)
- **BBR** — Datafordeler REST, per-building lookups (attributes: type, floors, year, use)
- **GeoDanmark Vektor 6.0 gdk60:Bygning** — Datafordeler WFS, real polygon footprints. **LIVE, joined to BBR** for extruded 3D render.

### Vector jurisdictions
- **DAGI** — SDFI, WFS/GeoJSON: Kommuner (98), Regioner (5), Politikredse (12), Sogne, Postnumre
- **Matrikelkortet** — SDFI, cadastre
- **Adresseregisteret (DAR)** — Datafordeler REST
- **Beredskabsområder** — Beredskabsstyrelsen, GeoJSON (endpoint TBD)

### Infrastructure
- **Vejnet** — Vejdirektoratet, WFS + live traffic REST
- **Jernbanenet** — Banedanmark, WFS
- **Elnet backbone (400/150 kV)** — Energinet, WFS (partial)
- **Fjernvarmenet** — kommunal, WFS per kommune
- **Vindmøller** — Energistyrelsen, WFS

### Aviation
- **AIP Danmark** — Naviair, eAIP XML
- **Luftrumsdata** — Naviair, dynamic
- **Droneregler** — Trafikstyrelsen (droneluftrum.dk), GeoJSON

### Maritime
- **Søkort** — SDFI Geodatastyrelsen, WMTS + S-57
- **Havnegrænser** — Søfartsstyrelsen, WFS
- **AIS live** — Søfartsstyrelsen, WebSocket
- **Farvande + sejlrender** — SDFI, WFS

### Weather
- **DMI Radar** — Gov Cloud, WMS + REST
- **DMI vejrobservationer** — Gov Cloud, REST
- **DMI havprognoser** — Gov Cloud, REST
- **DMI luftkvalitet** — Gov Cloud, WMS

### Population / demographics
- **CPR-aggregeret** — Danmarks Statistik, WMS + GeoJSON
- **BBR anvendelse** — Datafordeler REST

### Environmental / hazard
- **Fredninger** — Miljøstyrelsen, WFS
- **Højspændingsledninger** — Energinet, WFS
- **Grundvandsressourcer** — Klimadatastyrelsen, WMS
- **Fortidsminder** — Slots- og Kulturstyrelsen, WFS (some restricted)

### Reference registries
- **CVR** — Datafordeler REST (free)
- **Ejendomsregistret** — Datafordeler REST (restricted, permit needed)
- **Motorregistret** — Datafordeler REST (restricted, Politi only)

---

## Data-residency hosting

For everything that isn't a direct call to a DK provider:

- **Azure Denmark East (Copenhagen region)** — Microsoft cloud, data physically in DK, procurement-friendly for enterprise. First-choice for tile hosting.
- **Scaleway (FR) / OVH (FR)** — EU-parented, GDPR-clean. Second-choice if a customer explicitly refuses US-parented providers.
- **SecNumCloud (via OVH)** — only if a customer explicitly requires it.

**Never:** Google Cloud, AWS US regions, Cesium Ion, or any US-parented service that would fail a "data residency" audit in the sovereign profile.

---

## Add a new layer (procedure)

1. Add an entry to `SOVEREIGN_LAYERS` in [sovereign_layers.js](../src/sovereign_layers.js). Copy the closest existing entry as a template.
2. Set `_needsVerification: true` + `_notes` with what needs confirming.
3. Reload the app with `?profile=sovereign`.
4. In DevTools: `window.__isr_layers.enable('your_new_id')`. Confirm the layer renders.
5. Remove verification flag, decide on `enabledByDefault`.
6. Update this doc's table.

That's the whole flow. No code changes to `main.js` needed — the registry is the single source of truth.
