# Sovereign tile hosting — short-term plan

**Status:** Decided 2026-10-18 · **Owner:** Lucas (accounts), Gowri (upload + env), agent (code gate on 1574)
**Goal:** serve imagery and terrain from our own cloud at zero cost per load, kill the ion quota
dependency, and find the sovereign answer for the 3D building layer without lowering its quality.

**Amended 2026-10-18 (same day):** the operator's working view is the site **plus ~10 km in every
direction**, and the current Skråfoto meshes fail Lucas's quality bar for that ring in 3D. So the
customer-facing **3D building layer stays Google Photorealistic tiles short term, via our own
Google key (direct Map Tiles API, never via ion)** — per-session cost at ops-room usage is DKK-level
noise and compatible with flat pricing. US hosting for this one layer is a known, time-boxed
exception. Imagery and terrain go sovereign now (SDFI/DHM are equal or better than Bing/World
Terrain — no quality loss). Two probes decide the sovereign 3D endgame:
1. Re-run one Billund tile at full resolution / max ODM quality on Gowri's GPUs — the current
   tiles were built from 3000 px downscales and heavily decimated, likely a preview-grade run,
   so the quality ceiling is unknown.
2. Research licensed EU/Danish commercial photogrammetry mesh (vendors that fly the national
   programs sell textured mesh with self-hosting licenses) — coverage, terms, per-km² price.

## Step 3a landed 2026-10-19 — the 3D layer can go direct, key pending

`src/main.js` now reads `VITE_GOOGLE_MAP_TILES_KEY`. With it set, the 3D
building layer is created with
`Cesium.createGooglePhotorealistic3DTileset()` against Google's Map Tiles
API on our own key. Without it, it falls through to
`fromIonAssetId(2275207)` exactly as before, so any environment that has
not been given a key is untouched. Identical tiles either way: ion asset
2275207 IS Google Photorealistic 3D Tiles.

**Verified pricing, 2026-10-19** (the plan's earlier "DKK-level noise"
estimate holds, with one correction):

| | |
|---|---|
| free allowance | 1,000 root tile requests per month |
| then | USD 6.00 per 1,000, falling to 5.10 above 100k |
| a root request | opens a window of up to 3 hours of tile fetching |
| daily cap | 10,000 root requests per project |

**A page reload starts a NEW root request.** Development reloading is
what spends this, not operators leaving a map open. Roughly 50 reloads a
day is the free tier; a heavy month of 3,000 is about 85 kr. An ops room
with a few operators is comfortably inside the free allowance.

**Correction to this document's assumptions:** the USD 200 monthly Maps
Platform credit was removed in the March 2025 restructure. Any estimate
resting on it is void; the 1,000-free allowance above replaced it for
this SKU.

Sources: Google Maps Platform core services pricing list; Map Tiles API
usage and billing; the Photorealistic 3D Tiles GA announcement.

**Still outstanding, and it is not code:**
1. A Google Cloud project OF ITS OWN, so this line is visible separately
   on the invoice rather than hidden inside existing API spend.
2. Map Tiles API enabled, key restricted to our origins.
3. A daily quota cap on the API plus a budget alert. A runaway reload
   loop is the only way this becomes expensive, and a cap makes that
   impossible.

**Cesium OSM Buildings (ion asset 96188) still streams from ion** and has
no Google equivalent. Much lighter, but this change alone does not take
ion usage to zero.

## The rule this plan exists to enforce

**We never bulk-download, cache or re-serve Google 3D tiles, Bing imagery, Cesium World Terrain
or any other ion asset.** Their terms prohibit caching beyond a transient session, offline storage
and redistribution. It is also petabytes, and it would put scraped US map data under a product sold
to critical-infrastructure customers. Any "download it all once" idea dies here, permanently.

What we self-host is **our own property**: meshes and tiles produced by our pipelines from Danish
state data (Skråfoto, DHM, SDFI ortho, BBR). Build once, serve forever, zero marginal cost per use.

## What exists already

| Asset | State | Where |
|---|---|---|
| DHM terrain tiles (quantized mesh) | pipeline done | `scripts/dhm-pipeline/` output |
| Billund mesh tiles × 5 (airport, outer, west, city, south) | built | `city-creation-framework/mesh-pipeline/work/*/tiles/` |
| SDFI orthophoto (10 cm) | WMTS, token needed | `basemap_rule.js`, `VITE_SDFI_TOKEN` |
| City buildings (BBR+DHM, wide area) | blocked on Datafordeler FTP order | `scripts/city-tiles-pipeline/` |
| Render profile switch (photoreal / sovereign) | in code | `src/main.js`, `render_profile.js` |

Known quality bound (Lucas, 2026-10-18): Skråfoto meshes are a **context layer** — they replace
white boxes in surroundings and read correctly at distance. They are not close-up photoreal.
Close-up fidelity per site comes later from our own capture at onboarding; out of scope here.

## The three steps

1. **Bucket (Lucas / Gowri).** Scaleway Object Storage bucket (EU), public-read, CORS allowing our
   origins. Upload: DHM terrain tiles, the five Billund tile sets. Register the SDFI token at
   dataforsyningen.dk.
2. **Env (Gowri).** On the serving instance set `VITE_DHM_TERRAIN_URL`, `VITE_CITY_TILES_URL`
   (Billund tiles), `VITE_SDFI_TOKEN`, and run the sovereign profile. Config only.
3. **Code gate (agent, tested on port 1574 only — 1573 is never touched).** Today Bing and the
   Earth-at-Night layer load from ion at boot in every profile. A small guard so the sovereign
   profile skips all ion imagery. This is the single code change in the plan.

Result: imagery and terrain stream only from our bucket; the 3D building layer streams from Google
on our own key. No ion sessions at all, no quota walls, no lock-outs. Opex is storage plus egress
plus DKK-level Google 3D sessions, flat in practice and independent of how hard operators use it.

## What stays as-is

- The 3D building layer for customers and sims: Google Photorealistic tiles via our own Google
  key (direct, not ion). The ion-streamed copy of the same layer is retired, which ends the
  quota-wall and the non-commercial-license problem.
- No UI, UX or data-flow changes. The map controls, profiles and layers behave exactly as today.
- `localhost:1573` is off-limits in all steps. All testing happens on 1574 from an isolated copy.

## Costs

| Item | One-time | Monthly |
|---|---|---|
| Scaleway bucket, ~10–50 GB to start | — | tens of DKK |
| SDFI / Datafordeler tokens | free registration | 0 |
| Mesh builds for new sites | hours on our own GPUs | 0 |

## Open items

- [ ] Scaleway account under ISR Systems (not personal) — Lucas
- [ ] Upload terrain + Billund tiles, set CORS — Gowri
- [ ] SDFI token registered and in env — Gowri
- [ ] Sovereign ion-imagery gate, built and verified on 1574 — agent
- [ ] Datafordeler FTP order placed (unblocks wide-area city buildings) — Lucas

## Probe 1 — exact recipe (max-quality ODM re-run, Billund terminal block)

**Discovery that motivates it:** the tiles Lucas judged were built at the pipeline's FLOOR, not its
ceiling: `run_odm.sh` defaults to `--feature-quality medium --pc-quality medium` (its own comment says
high "was never actually exercised from scratch"), caps the mesh at 300,000 triangles (octree depth 11),
and `prep_odm.py` downscales every image to 3,000 px. The probe runs the same pipeline at its actual
maximum to learn the true quality ceiling.

**Where:** Lucas's MacBook (M4, 16 GB, Docker installed) — acceptable at hours-to-overnight — or
Gowri's RTX box in a fraction of the time. Workdir in a NON-iCloud path (`~/odm-probe`), Docker
Desktop memory raised to ~12 GB, machine plugged in and kept awake.

**Steps**
1. Precondition: SDFI token present (repo `.env.local`); if missing, free registration at
   dataforsyningen.dk. Source obliques are NOT cached in `work/` — the probe re-fetches them.
2. Scope: `pick_bbox.py --name "Billund Lufthavn"` — terminal block only, keeps 16 GB viable.
3. `fetch.py` for that bbox: 5 obliques + nadir + published camera poses.
4. Prep at FULL resolution (bypass the 3,000 px downscale) — change made only in the isolated copy.
5. ODM: `--feature-quality ultra --pc-quality high` (ultra if RAM allows), `--mesh-size 3000000`,
   `--mesh-octree-depth 12`, full-res texturing.
   OOM ladder, in order: pc-quality high→medium-high, image scale 100%→75%, then shrink bbox. Log
   which rung succeeded — that rung is the production setting.
6. Clip to footprints and tile as usual → max-quality tileset of the terminal.
7. Judgment: side-by-side on **1574 only** — floor-quality tile vs max-quality tile vs Google
   screenshots, at the zoom levels operators actually use. Lucas's eyes are the gate. 1573 untouched.
8. Decision: PASS → this becomes the production recipe; batch the ring tiles per site on Gowri's GPUs.
   FAIL → licensed Danish photogrammetry (Probe 2) becomes the sovereign path. Either way Google-via-
   own-key keeps serving customers until a replacement is proven.

**What the probe is not:** it does not restore the currently missing Google 3D layer. That outage is
the ion quota lock-out (heals Nov 1, or permanently via the own-key swap), unrelated to mesh quality.

## Landed 2026-10-18, the flat-Billund regression

Root cause, proven: `combine_tilesets.py` wrote **absolute** symlinks for the combined tileset's five
children. When the pipeline moved from `scripts/mesh-pipeline/` to `city-creation-framework/mesh-pipeline/`,
all five links dangled, the app loaded the root tileset, 404'd every child, settled at zero tiles, and the
coverage swap hid 62.5 km² of OSM boxes with nothing drawn in their place.

Fixed: (1) links repointed relatively on this machine and the combiner now emits relative links;
(2) `src/main.js` settle-path swap is guarded — boxes are only hidden after at least one tile with real
content loads (mirrored to isr-c2-billund); (3) dev serving now uses the pipeline's own
`serve_tiles.py 8778 work/billund-combined`. Still open: bucket hosting (replaces the laptop server),
height-watch re-export for short buildings (terminal), and the ultra-quality probe.
