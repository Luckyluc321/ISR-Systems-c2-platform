# Sovereign tile hosting — short-term plan

**Status:** Decided 2026-10-18 · **Owner:** Lucas (accounts), Gowri (upload + env), agent (code gate on 1574)
**Goal:** serve the map from our own cloud so simulations and customer use cost nothing per load,
with no US-hosted map calls in the customer-facing profile.

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

Result: customer-facing and simulation use streams only from our bucket. No ion sessions, no Google
sessions, no quota walls. Opex is storage plus egress, flat, independent of operators and screens.

## What stays as-is

- The photoreal profile (ion + Google) remains in the code for internal side-by-side comparison,
  behind its existing switch. It is not used for customers while ion is on the free tier, because
  that tier is non-commercial and quota-capped.
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
