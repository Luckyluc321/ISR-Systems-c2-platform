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
through an ISR Google Cloud project. There is no Google key anywhere in
the codebase.

**What is unverified** is whether that route stays open. If Google ever
applies the restriction to end users rather than to billing accounts,
every Danish deployment loses the six-city building view at once, and we
would find out from a customer rather than from a changelog.

Google publishes **no coverage map, no polygon, no city list and no
availability endpoint** for this product — only a country-level table.
So we also cannot answer "is site X covered" without flying there and
looking.

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
load. Both are documented in `scripts/mesh-pipeline/PLAYBOOK.md`.
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
