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
