# External dependencies, and which of them can take the map away

Every third-party service the platform reaches at runtime or build time,
what breaks when it goes, and what is already known to be going.

This exists because a dependency that is fine in a walkthrough is not
automatically fine under a customer. Three of the entries below have a
**published end date or a published restriction**, and none of them
announce themselves at the moment they bite: the symptom is a map that
renders less than it did yesterday, with no error anyone connects to a
contract or a billing address.

Ordered by what it costs when it fails, not by likelihood.

---

## 1. Cesium ion — commercially fine, answer it if asked

`Cesium.Ion.defaultAccessToken` from `VITE_CESIUM_ION_TOKEN`, used for:

| asset | what it provides |
|---|---|
| 2275207 | Google Photorealistic 3D Tiles — the only 3D buildings in Copenhagen, Aarhus, Odense, Aalborg, Esbjerg and Vejle |
| 96188 | Cesium OSM Buildings — the extruded white boxes everywhere else |
| Bing | the base imagery under all of it |

**Not a risk we are carrying.** An enterprise contract covers uptime and
tier, which is what the failure modes here actually are. This is a paid
dependency like any other and it is treated as one.

The only reason it is in this document at all is so the answer exists
when a customer asks where the imagery comes from. The answer is that
the platform renders anywhere today on commercial imagery, and renders
entirely on Danish state data at any site we have built through the
mesh pipeline. Billund is the worked example.

Nobody needs to do anything about this unless a customer raises it.

## 2. Google Photorealistic 3D Tiles — a published EEA restriction

Google blocks photorealistic 3D tiles for Google Maps Platform projects
on a **European Economic Area billing address, created after 8 July
2025**. The Map Tiles API returns 403. Documented by Google at
`developers.google.com/maps/comms/eea/map-tiles`.

**It does not affect us today**, and the reason matters: we reach the
tiles through Cesium ion under Cesium's agreement with Google, not
through an ISR Google Cloud project. (Since October 2026 that is only
true for a server with no key: with `VITE_GOOGLE_MAP_TILES_KEY` set,
main.js reaches the tiles directly through our own Google Cloud project.
See 2a.)

**What is unverified** is whether that route stays open. If Google ever
applies the restriction to end users rather than to billing accounts,
every Danish deployment loses the six-city building view at once, and we
would find out from a customer rather than from a changelog.

Google publishes **no coverage map, no polygon, no city list and no
availability endpoint** for this product — only a country-level table.
So we also cannot answer "is site X covered" without flying there and
looking.

### 2a. Google is billed per load, so it is opt-in during development (2026-10-28)

With a key set, the platform reaches Google's Map Tiles API directly:
2D satellite as the base map and the photorealistic 3D tileset. Google
bills a 3D session each time the tileset's root is requested and the 2D
layer per tile, and both were created at every page load, so every
development reload and every automated test run was billed whether or
not anyone looked at 3D.

`src/google_tiles_guard.js` makes Google opt-in during development:

| Load | Google |
|---|---|
| production build | loads, exactly as before |
| development, no `?google=1` in the address | not touched: no 3D tileset, and the base map is Cesium's bundled offline imagery (Natural Earth II), never ion, whose free allowance is spent |
| development, `?google=1` in the address | loads, exactly as before |
| any server without a key (1573) | the ion path it always had |

The switch survives a reload because a reload keeps the address, so a
recording or demo session opens `localhost:1574/?google=1` once. Without
it the 3D city is simply absent and the OSM building boxes draw
unclipped in its place; every reader of the tileset already handles it
being absent. Gated by `check:google-guard`.

### 2b. Over Denmark, the ground is the Danish orthophoto, not Google's 2D (2026-10-28)

Google's billing report for October, by SKU, settled where the money
went:

| SKU | Usage | Cost |
|---|---|---|
| Map Tiles API: 2D Map Tiles | 175,742 tiles | 298.94 kr |
| Map Tiles API: Photorealistic 3D Tiles | 588 root requests | 0.00 kr (under the 1,000 free a month) |

The 3D city was free. The whole bill was the flat 2D satellite layer
under it, metered per tile (100,000 free a month, then USD 0.60 per
1,000), which every pan, zoom and camera follow pulls.

`src/basemap_denmark.js` draws the Danish state orthophoto (GeoDanmark
Ortofoto forår, Dataforsyningen WMS) over Denmark and switches Google's
2D layer off there, so it requests no tiles:

| Camera | Ground |
|---|---|
| over Denmark, below 60 km | Danish orthophoto on top |
| ... below 30 km, and the orthophoto on for 1.5 s | Google's 2D switched off, no tiles requested |
| anywhere else, or higher | Google's 2D, as before |
| night mode | untouched, as before |

Google's 3D city, OSM buildings and terrain are untouched. Where the
orthophoto has no picture (open sea, Swedish and German land inside its
rectangle) the service paints a key colour, `bgcolor=0x4075A8`, which
the layer makes see-through (`colorToAlpha`). Underneath is a free
backdrop: Cesium's bundled Natural Earth, added under Google's 2D. The
key is the backdrop's own sea blue, so JPEG's soft edge around it reads
as water. A transparent PNG does the same without a key, but measured
145 KB a tile against 11 KB, about 10 MB per site view against 0.8 MB.

Measured on a private port with Google's 2D faked as red tiles (nothing
billed): 0 Google 2D tile requests while the camera sits over Copenhagen
Airport or Aarhus harbour, Google's 2D back over Malmö, at night and on
`__isr_basemap.force('bing')`.

**Licence.** The orthophoto is free and allowed for commercial use under
the agency's own terms ("Vilkår for brug af frie geografiske data",
2022), not CC BY 4.0, which the old credit said. The credit on screen is
the one those terms ask for. The terms also ask that customers can see
the terms or a link to them. The agency (renamed Klimadatastyrelsen in
2024) gives no availability guarantee.

**Why it also matters for section 2.** Google lists 2D satellite tiles,
not only the 3D tiles, as unavailable to European Economic Area
projects. Over Denmark the base map no longer depends on them.

The way back: `__isr_basemap.force('bing')` for a session,
`force('auto')` to return. The rule it replaced (orthophoto over meshed
sites only) is kept in `src/basemap_meshed_sites.js`. Gated by
`check:basemap-denmark`.

### 2c. Copenhagen's 3D city is Danish, Google's is the fallback (2026-11-08)

Since 2026-11-07 Google returns 403 for Photorealistic 3D Tiles and
satellite 2D to our own key ("not available for your account and
region"), so Google's city streams through Cesium ion and spends ion
sessions. `src/dk_city_meshes.js` draws Danish high-definition meshes
first, from `src/data/dk_city_meshes.json`:

| mesh | source | where it streams from |
|---|---|---|
| Copenhagen municipality | Hexagon, 2023 imagery, made for Skat | Copenhagen municipality's account on Esri ArcGIS Online, on Amazon's cloud (both US companies), public 3D Tiles |

Inside a mesh's area Google's city and the OSM boxes are clipped out.
If the mesh fails to load or keeps failing, nothing is clipped and
Google's city covers the area: the fallback. **The item states no
licence.** Ask Copenhagen municipality before customer use. Gated by
`check:dk-city-meshes`. Console: `__isr_dkMeshes.status()`.

## 3. BBR REST — retired end of 2026

`services.datafordeler.dk/BBR/BBRPublic/1/rest`, reached with
`VITE_DATAFORDELER_CREDS`.

The service registry in `src/sovereign_services.js` records it directly:
*"REST BBR udfases ultimo 2026 → migrer til BBR GraphQL."* Live-verified
2026-09-01, when a 10 km box around Billund returned 350 buildings with
full attributes.

**This one has a date on it.** The migration target is known (BBR
GraphQL) and the work has not started. It is also the only credentialed
dependency: username and password rather than a token.

## 4. OSRM public demo server — explicitly not for production

`router.project-osrm.org`, in `src/routing.js`, which already carries the
warning in its own header. It is the public demonstration instance of the
OSRM project. It has no SLA, no uptime commitment and a fair-use policy
that a real customer's traffic would breach.

Road routing for dispatched response assets runs through it. When it
rate-limits or goes down, routes stop resolving.

**Fix is known and small:** the interface is stable, so a self-hosted
OSRM or a commercial routing API is an endpoint swap. It has not been
done.

## 5. Overpass — build time only, and flaky

`overpass-api.de`, used by the mesh pipeline to fetch building
footprints. Not reached at runtime, so a customer never depends on it.

It failed twice in one afternoon during the Billund work: once with a
406 on curl's default user agent, once with a dispatcher timeout under
load. Both are documented in `city-creation-framework/mesh-pipeline/PLAYBOOK.md`.
Annoying, never customer-facing.

## 6. Everything else, by credential

| variable | service | what breaks without it |
|---|---|---|
| `VITE_SDFI_TOKEN` | Dataforsyningen orthophotos | Danish imagery over meshed sites; falls back to Bing |
| `VITE_SITE_MESH_URL` | Scaleway object storage | the Billund mesh; falls back to white boxes |
| `VITE_MISTRAL_API_TOKEN` | Mistral, hosted on Scaleway | AI event summaries |
| `VITE_VEJDIREKTORATET_KEY` | road traffic feed | live traffic context |
| `VITE_OPENAIP_KEY` | airspace data | airspace overlays |
| `VITE_AIS_WS_URL` | AIS proxy, Scaleway | live vessel tracking |
| `VITE_VD_TRAFFIC_WS_URL` | traffic proxy, Scaleway | live traffic push |

Each degrades one feature rather than the map. All are single
credentials with no rotation procedure written down.

---

## What actually needs doing

Two things, and neither is this week:

**BBR REST has a date on it: end of 2026.** The migration target is
known and the work has not started. This is the only entry here with a
hard deadline.

**OSRM runs on the project's public demo server.** Known-bad for
production, warned about in its own file, and the fix is an endpoint
swap to a self-hosted or commercial instance. It will bite under a
customer's traffic rather than ours.

Everything else is a watch-item or a paid dependency behaving normally.
The point of the list is that none of these announce themselves — the
symptom is a map that renders less than it did yesterday.
