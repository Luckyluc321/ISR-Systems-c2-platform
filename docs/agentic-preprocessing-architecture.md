# Agentic Preprocessing Architecture

**Purpose:** define the preprocessing pipeline that sits between raw event data and the Mistral agents (Agent A digest, Agent A2 highlights, Agent B debrief) so narratives are grounded in structured, ranked signals — not raw JSON dumps or hardcoded lists.

**Design goals:**
1. Rich narrative output (analyst-grade, references specific assets + doctrine).
2. Low Mistral cost (compress before calling; cache aggressively).
3. Low latency (deterministic where possible; LLM only where interpretation matters).
4. Scalable to new sites (add a `site_context.js` entry, everything else generalises).
5. Deep nuance without leaking demo-only assumptions into production paths.

---

## End-to-end walkthrough (plain English)

What happens when an operator clicks "Debrief on map" on a closed event. Read this section first; the technical spec below fills in the details.

**Trigger:** operator clicks "Debrief on map" on a closed event.

**Step 0 — Deterministic scaffold renders instantly (0 ms).**
The debrief modal opens with a template narrative already in the DOM. Never blocks. If Mistral goes down, this stays.

**Step 1 — Resolve highlights (~1 ms if declared, ~800 ms first-ever at an un-configured site).**
Reads `site_context.js`, looks for the `highlights[]` block on the event's site. If present, reads them, sanitizes each rationale, done. If missing, runs the deterministic scorer to pick candidates, then Agent A2 (Mistral) ranks them with one-line rationale per pick. Cached per site forever after.

Produces: an ordered list of assets with priority + rationale. Fed to Agent B as "these are what matter here."

**Step 2 — Fetch or generate site context digest (~1 ms if cached, ~1500 ms first-ever at that site).**
Checks localStorage for a cached "site intelligence brief" for the site. If present, reads it (~200-word paragraph about what the site protects, doctrine, red flags). If missing, fires Agent A: full site record → Mistral → 200-word brief. Cached, reused by every future event at that site.

Produces: the Agent A digest paragraph. Fed to Agent B as prompt background.

**Step 3 — Extract trajectory signals (~30 ms, pure math, no Mistral).**
Reads the event's recording — every drone position sample. Runs 5 extractors:
- **Approach vectors** — how close did each drone get to each highlight, at what altitude, when
- **Altitude profile** — climb / descend / hover, trend line slope + R²
- **Speed profile** — accelerating / decelerating / constant, same trend math
- **Dwell hotspots** — top 3 zones by cumulative dwell, flagged if exceeding site doctrine threshold
- **Formation cohesion** — for swarms, tightening (attack posture) or scattering (evasion)

Every signal gets scored: outlier score (z-score vs site baseline) + trend score (R²) + criticality multiplier + 2× boost if it involves a highlight asset.

Produces: top 5 outliers + top 3 trends + interpretedProse (deterministic one-liners like "Track descended from 145m to 18m over 92 seconds"). Cached on the event object AND in localStorage. Cache is invalidated automatically if samples change (post-close replay adds ticks) via a sample-set fingerprint.

**Step 3.5 — Notability classification (deterministic, 0 ms).**
The signal extractor also emits a `notability.tier` — the ceiling on how deep Agent B is allowed to go. Prevents the AI failure mode of manufacturing significance from noise. Four tiers:

- **`identify-only`** — small site (substation/switching station) + duration < 60s + no highlight approach < 200m. Deterministic one-sentence identification. **Skips Mistral entirely.** No paragraphs, no doctrine.
- **`transit`** — any site, no signals above threshold, no highlight approach < 200m, no dwell exceeds threshold, no monotonic trend R² > 0.5. Agent B produces one short paragraph, factual, no doctrine speculation.
- **`marginal`** — some signals present but none definitive. Agent B produces 1-2 paragraphs, restrained.
- **`notable`** — at least one signal above threshold (highlight approach < 100m OR dwell exceeds doctrine threshold OR trend R² > 0.7 OR outlier score > 2.0). Agent B produces full analyst brief with doctrine references.

Tier is deterministic — pure code, based on site scale + trajectory geometry. Agent B receives the tier as an explicit prompt directive and length limits are enforced per tier (transit: 500 chars body / 200 chars reco / 400 max_tokens; notable: 2000 chars body / 400 chars reco / 1600 max_tokens).

**Step 4 — Check the narrative cache (0 ms).**
Every extraction produces a `signalHash` — a fingerprint of the ranked signal set. If the event has a previously cached narrative AND the signalHash matches, short-circuit: reuse the cached narrative directly. Zero Mistral cost. Zero latency. Reopening the same debrief is free.

For `identify-only` tier, Step 4 also renders the deterministic identification sentence into `event.narrativeCache` with `model_version: 'deterministic-identify-only'` — Mistral never fires for that event, ever.

**Step 5 — Build the Agent B prompt (0 ms).**
Assembles the final prompt:
- System 1: analyst role + writing rules (up to 4 paragraphs, 2000 chars body, 400-char reco, no em-dashes, ISR voice)
- System 2: Agent A digest (persistent site intelligence brief)
- User: event metadata + platform count + subject digest + PARTNER-DECLARED HIGHLIGHTS (JSON, sanitized) + STRUCTURED SIGNAL BLOCK (top outliers + trends) + INTERPRETED SIGNAL PROSE (deterministic one-liners) + TRAJECTORY ANALYSIS (legacy dwell) + CLASSIFICATION LOG

**Step 6 — Fire Agent B via Scaleway (~2000 ms streaming).**
POST to `https://api.scaleway.ai/v1/chat/completions` with `mistral-medium-3.5-128b`. Streaming SSE: tokens arrive character-by-character, replace the deterministic template as they stream in. Body streams first, then a `===RECO===` delimiter, then the recommendation. Footer flips to `Generated ... Model: ...`. ~800 tokens in, ~1200 tokens out per debrief on Scaleway serverless.

**Step 7 — Persist for reload survival (~5 ms).**
- Narrative caches, Agent A digest, Agent A2 fallback, preprocessed signals → `localStorage` under `isr:` namespace (small metadata, sync access).
- Trajectory recordings → **IndexedDB** (`isr_recordings` DB, `trajectories` object store, keyed on eventId). Async by construction; sync callers read from an in-memory cache populated by `window.__isr_ensureRecording()` on load. Recordings can be tens of MB total without hitting quota.
- **Nothing auto-evicts.** Operator explicitly runs `await window.__isr_clearAllSimData()` from DevTools to free space. Event evidence is preserved as first-class data.

**Regenerate button behaviour.** Invalidates: Agent A digest cache, Agent A2 fallback cache (if applicable), narrative cache (in-memory + localStorage), preprocessed signals cache. Does NOT invalidate declared `highlights[]` (they live in code, not cache). Guarded against rapid re-clicks via `event._regenInFlight`. Re-runs the full pipeline.

**What survives a page reload:** narrativeCache, _preprocessed, Agent A digest per site, Agent A2 fallback ranker output per site.

**What breaks if Scaleway goes down:** Agent A + A2 + B all fail silently. Deterministic template narrative stays visible. Footer shows the fallback reason.

**Cost + latency at a glance:**
- Cold-cold (first debrief at brand new site): ~3.5 s until narrative visible
- Warm (site's caches populated, event is new): ~2 s
- Hot (same event reopened): ~0 s (signal-hash cache hit)

---

## Full data flow

```
                                                      ┌─────────────────────────┐
                                                      │  site_context.js        │
                                                      │  (per-site raw record   │
                                                      │   + highlights[] block  │
                                                      │   declared at onboard)  │
                                                      └───────────┬─────────────┘
                                                                  │
                          ┌───────────────────────────────────────┼───────────────────────────────────────┐
                          │                                       │                                       │
                          ▼                                       ▼                                       ▼
              ┌───────────────────────┐             ┌───────────────────────────┐             ┌───────────────────────┐
              │  HIGHLIGHT RESOLVER   │             │  AGENT A                  │             │  DETERMINISTIC        │
              │                       │             │  Site Context Digest      │             │  Baseline Stats       │
              │  Primary path:        │             │  (Mistral, 1x per site)   │             │  Extractor            │
              │  Read highlights[]    │             │                           │             │                       │
              │  from site_context.   │             │  Prose intelligence brief │             │  Per-site norms:      │
              │  Zero-token, instant, │             │  (~200 words) explaining  │             │  typical altitudes,   │
              │  partner-declared.    │             │  what the site protects   │             │  common transit       │
              │  Count is site-       │             │  and how doctrine treats  │             │  speeds, dwell        │
              │  specific (3 for a    │             │  the assets.              │             │  thresholds per zone. │
              │  substation, 5-8 for  │             │                           │             │                       │
              │  an airport, etc).    │             │                           │             │                       │
              │                       │             │                           │             │                       │
              │  Fallback path (only  │             │                           │             │                       │
              │  when highlights[] is │             │                           │             │                       │
              │  absent):             │             │                           │             │                       │
              │  Scorer + Agent A2    │             │                           │             │                       │
              │  (see fallback block  │             │                           │             │                       │
              │  below diagram).      │             │                           │             │                       │
              └───────────┬───────────┘             └────────────┬──────────────┘             └───────────┬───────────┘
                          │                                      │                                        │
                          └──────────┐                ┌──────────┘                                        │
                                     ▼                ▼                                                   │
                              ┌─────────────────────────────────┐                                         │
                              │  SITE CACHE (localStorage)      │                                         │
                              │  { digest, highlights,          │                                         │
                              │    scorerOutputs, hash }        │                                         │
                              │  Invalidated on ctx hash change │                                         │
                              └─────────────┬───────────────────┘                                         │
                                            │                                                             │
                                            │           ┌─── event.recording (timeseries) ───┐            │
                                            │           │                                     │            │
                                            │           ▼                                     │            │
                                            │  ┌────────────────────────────────┐             │            │
                                            │  │  DETERMINISTIC                 │◄────────────┘            │
                                            │  │  Trajectory Signal Extractor   │◄─────────────────────────┘
                                            │  │                                │
                                            │  │  Computes structured signals   │
                                            │  │  from raw timeseries against   │
                                            │  │  site's baseline stats.        │
                                            │  │                                │
                                            │  │  Outputs:                      │
                                            │  │  - approach_vectors[]          │
                                            │  │  - speed_profile[]             │
                                            │  │  - altitude_profile[]          │
                                            │  │  - dwell_hotspots[]            │
                                            │  │  - cross_site_transitions[]    │
                                            │  │  - formation_cohesion[]        │
                                            │  │                                │
                                            │  │  Each signal tagged with:      │
                                            │  │  - outlier_score (z-score)     │
                                            │  │  - trend_score (R^2)           │
                                            │  │  - criticality_multiplier      │
                                            │  │  - narrative_worthiness rank   │
                                            │  └───────────────┬────────────────┘
                                            │                  │
                                            │                  ▼
                                            │  ┌────────────────────────────────┐
                                            │  │  RANKED SIGNAL SET             │
                                            │  │  { topOutliers[], topTrends[], │
                                            │  │    interpretedProse[] }        │
                                            │  │  (top-N per type)              │
                                            │  └───────────────┬────────────────┘
                                            │                  │
                                            ▼                  ▼
                                    ┌───────────────────────────────────┐
                                    │  AGENT B — DEBRIEF NARRATIVE      │
                                    │  (Mistral, 1x per event)          │
                                    │                                   │
                                    │  System messages:                 │
                                    │  1. Analyst role + writing rules  │
                                    │  2. Agent A site digest           │
                                    │  3. Agent A2 top-3 highlights     │
                                    │                                   │
                                    │  User message:                    │
                                    │  1. Event metadata                │
                                    │  2. STRUCTURED SIGNAL BLOCK (JSON)│
                                    │  3. INTERPRETED PROSE (optional)  │
                                    │                                   │
                                    │  Output: streamed narrative +     │
                                    │          recommendation.          │
                                    └───────────────┬───────────────────┘
                                                    │
                                                    ▼
                                    ┌───────────────────────────────────┐
                                    │  event.narrativeCache             │
                                    │  { body, recommendation,          │
                                    │    model_version, at,             │
                                    │    signalHash }                   │
                                    └───────────────┬───────────────────┘
                                                    │
                          ┌─────────────────────────┼─────────────────────────┐
                          │                         │                         │
                          ▼                         ▼                         ▼
                    ┌──────────┐            ┌──────────────┐          ┌──────────────┐
                    │ Debrief  │            │ Closed panel │          │ PDF export   │
                    │ modal    │            │ (right rail) │          │ (Full report)│
                    └──────────┘            └──────────────┘          └──────────────┘
```

---

## Stage-by-stage contract

### 1. Highlight Resolver (per site, boot-time) — PRIMARY: hardcoded

**Primary path — hardcoded highlights declared during partner onboarding.**

Every real customer/partner site declares its own `highlights[]` block in `site_context.js` when the site is first mapped. Domain expertise beats agent inference for the specific question "what matters most HERE." Site declares its own count — a substation has 2-3, an airport 5-8, a port 6-10. No cap, no floor.

**Shape:**
```
site_context.js[siteId] = {
  ...existing fields (critical_areas, high_value_assets, etc.),
  highlights: [
    { asset_id: 'pier_e',           rationale: 'SAS long-haul hub since 2019, widebody stands (A350 / 787 / 777).', priority: 1 },
    { asset_id: 'runway_04L_22R',   rationale: 'Primary arrival axis. Closure cascades to full airfield.',          priority: 2 },
    { asset_id: 'atc_control_tower', rationale: 'ATC continuity single point of failure.',                          priority: 3 },
    ...
  ]
}
```

**Contract:**
- `asset_id` must resolve to an entry in the site's `critical_areas`, `high_value_assets`, `response_asset_positions`, or `aircraft_of_interest`.
- `rationale` is one plain sentence, human-authored, captures the operational reason. Fed verbatim to Agent B as prompt context.
- `priority` is an integer for stable ordering (1 = highest). Ties broken by array order.

**Cost:** zero LLM tokens. Pure config read.
**Cache:** no cache needed — reads directly from the imported module. Editing `site_context.js` and reloading picks up changes immediately.

---

**Fallback path — only fires when `highlights[]` is absent** (early-stage sites, quick sales-demo trials, sites still being onboarded):

**Fallback stage 1a — Deterministic Highlight Scorer**
- **Input:** `contextForSite(siteId)`.
- **Output:** ranked candidate list, all assets scoring above the median, capped at `max(3, ceil(sqrt(assetCount)))` — so a 40-asset site surfaces ~6 candidates, a 9-asset site surfaces ~3.
- **Score formula:**
  ```
  base_score = criticalityWeight[criticality]     // critical=1.0, high=0.7, medium=0.4, low=0.15
             * zoneSizeMultiplier                  // area zones weighted vs point assets
             * responseProximityBonus              // closer to a response asset = higher
             * activeStatusMultiplier              // status:'inactive' → 0
  ```
- Zero LLM tokens.

**Fallback stage 1b — Agent A2 (highlight ranker)**
- Runs downstream of the scorer.
- Picks final top-N from scorer output with one-sentence rationale per pick, using Agent A digest as background.
- ~1 Mistral call per fallback site, cached in localStorage.

**Fallback path becomes dead code for production once every real customer site declares its highlights.** Kept for demo/trial paths so new prospects can spin up a site without full onboarding.

---

### 2. Agent A — Site Context Digest (per site, 1x, cached)

Already built in `src/mistral.js` (`ensureSiteContextDigest`).

**Input:** `siteId` + full site context object.
**Output:** ~200-word prose intelligence brief describing what the site protects, doctrine, red-flag behaviours.
**Cost:** ~1 Mistral call per site, ~500 output tokens.
**Cache:** localStorage keyed on `(siteId, contextHash, DIGEST_VERSION)`.
**Invalidation:** automatic on site context change; manual via `invalidateSiteContextDigest(siteId)`.

---

### 3. Agent A2 — Highlight Ranker (FALLBACK ONLY, per un-configured site, 1x, cached)

**Fires only when `site_context.js[siteId].highlights` is absent** (see Stage 1). For every real customer site with declared highlights, this stage is skipped entirely and never costs a token.

**Input (fallback path only):**
- Agent A digest (prose)
- Deterministic scorer's candidates (structured)

**Prompt shape:**
```
You are an intelligence analyst. Given the site brief and the candidate
assets ranked by deterministic scoring, pick the ones that MOST warrant
narrative focus per detection at this site. Return a rank-ordered list
with a one-sentence rationale per pick grounded in the site's doctrine.
Site declares its own count via priority ordering — do not force a
fixed number.
```

**Output:** JSON — `{highlights: [{asset_id, name, rank, rationale}]}` (strict schema, parsed and stored).

**Cost:** ~1 Mistral call per fallback site, ~250 output tokens. Zero cost for configured sites.
**Cache:** localStorage keyed on `(siteId, digestHash + scorerHash)`. Regenerates on either upstream change.

---

### 4. Deterministic Baseline Stats Extractor (per site, precomputed)

**New.** Sits alongside site config. Computes site-wide norms from either:
- Historical event samples (if any exist in evidence store), OR
- Sensor + geography constants (fallback for cold-start sites).

**Output per site:**
```
{
  typical_transit_altitude_m: {p25, p50, p75, p95},
  typical_transit_speed_ms:   {p25, p50, p75, p95},
  dwell_thresholds_by_zone_type: {runway: 15s, terminal: 20s, pier: 25s, ...},
  formation_baseline_cohesion_m: 40,
  ...
}
```

**Cost:** zero LLM tokens.
**Cache:** static per site until config changes.

---

### 5. Deterministic Trajectory Signal Extractor (per event, at debrief-open)

**New.** The core new preprocessing module. Takes a completed event's recording + the site's baseline stats, emits a ranked structured signal set.

**Input:**
- `event.recording.timeseries` (per-tick detection samples)
- Site baseline stats (from stage 4)
- Highlights + digest (from stages 2-3) — used only for criticality multipliers, not for prose

**Signals extracted:**

| Signal | Definition | Outlier score | Trend score |
|---|---|---|---|
| `approach_vectors` | per asset: bearing at closest approach, angle-of-approach vs asset shape | z-score of closest distance vs site's median-to-that-asset-type | R^2 of monotonic descent in distance over time |
| `speed_profile` | binned segments (loiter / transit / accelerating / decelerating) | z-score of segment speed vs site's typical transit speed | R^2 of monotonic speed change over time |
| `altitude_profile` | binned segments (climbing / descending / hovering / terrain-following) | z-score vs site's typical transit altitude percentiles | R^2 of monotonic altitude change over time |
| `dwell_hotspots` | top-3 zones by cumulative dwell, with entry/exit timestamps | dwell duration vs dwell threshold for that zone type | dwell time trend (repeated visits) |
| `cross_site_transitions` | list of site enter/exit moments across chained events | none (categorical) | inter-arrival time consistency |
| `formation_cohesion` | swarm scatter radius over time | z-score of scatter vs baseline cohesion | R^2 of monotonic scatter change |

**Ranking rule:**
```
narrative_worthiness = max(outlier_score, trend_score * 0.7)
                     * criticality_multiplier
                     * asset_highlight_weight   // top-3 highlights get 2.0x, others 1.0x
```

**Output shape (compact JSON, feeds Agent B):**
```
{
  event_id,
  computed_at,
  topOutliers: [
    { signal: "approach_vector", asset: "pier_e", value: {...}, score: 3.2, prose: "Track descended to 12m at closest approach to Pier E, 87% below site's typical transit altitude." },
    ...top 5
  ],
  topTrends: [
    { signal: "altitude_profile", value: {slope: -0.9, r2: 0.94}, score: 2.8, prose: "Monotonic altitude descent from 145m to 18m over 92 seconds." },
    ...top 3
  ],
  interpretedProse: [ ...deterministically-generated prose for the top signals that can be phrased safely ]
}
```

**Cost:** zero LLM tokens. Pure JS.
**Cache:** on `event._preprocessed` — recomputed only when regenerate button clicked.

---

### 6. Agent B — Debrief Narrative (per event, per operator request)

Already built. Enhanced to consume:
- **System messages**: writing rules + Agent A digest + Agent A2 top-3 highlights (as prose bullets)
- **User message**: event metadata + STRUCTURED SIGNAL BLOCK (JSON from stage 5) + INTERPRETED PROSE (concatenated from stage 5's `interpretedProse[]` when present)

**Cost:** ~1 Mistral call per debrief, ~800 output tokens. Loosened from current 500-char limit.
**Cache:** `event.narrativeCache`. Invalidated by regenerate button.

---

## Cost + latency budget

**Cold start at a CONFIGURED site (partner declared highlights[]) — production path:**
- Highlight Resolver: <1ms (config read)
- Agent A digest: ~1500ms + ~1000 tokens
- Deterministic Baseline: <5ms
- Deterministic Trajectory: ~30ms
- Agent B narrative: ~2000ms + ~1200 tokens
- **Total: ~3.5 seconds, ~2200 tokens**

**Cold start at an UN-CONFIGURED site (no highlights[], fallback path) — demo/trial only:**
- Deterministic Scorer: <5ms
- Agent A digest: ~1500ms + ~1000 tokens
- Agent A2 fallback ranker: ~800ms + ~500 tokens
- Deterministic Baseline: <5ms
- Deterministic Trajectory: ~30ms
- Agent B narrative: ~2000ms + ~1200 tokens
- **Total: ~4.3 seconds, ~2700 tokens**

**Warm (subsequent debrief at same site) — both configured + fallback:**
- All site-level caches hit
- Deterministic Trajectory: ~30ms
- Agent B narrative: ~2000ms + ~1200 tokens
- **Total: ~2 seconds, ~1200 tokens**

**Regenerate button:**
- Configured sites: invalidates Agent A digest cache + `event.narrativeCache`. Highlights unchanged (they're config, not agent output).
- Fallback sites: also invalidates Agent A2 ranker cache.

---

## Scalability

- **New site added:** drop a record into `site_context.js`, deterministic stages generalise, Agent A + A2 cache-fill on first debrief. Zero code changes.
- **New signal added:** implement extractor in `src/preprocessing.js`, add to signal registry, no changes elsewhere.
- **Inference provider swap (Scaleway primary → Azure Foundry failover, or new provider):** single seam in `src/mistral.js` (`getInferenceConfig()`), no preprocessing changes. See IDD IF-9.7 for the current hosting matrix.
- **Live NN model change:** signals are computed from post-detection samples, which come through the `NnOutputSource` interface — swap sources without touching preprocessing.

---

## File layout (post-Phase-2 split)

```
src/
  mistral.js              [live] Re-export barrel. Existing importers unchanged.
  mistral_client.js       [live] Transport + config + siteVersionStamp + sanitizePartnerString
  agents/
    agent_a_digest.js     [live] Agent A — site context digest + cache
    agent_b_debrief.js    [live] Agent B — debrief narrative + narrativeCache
    agent_case_file.js    [live] Agent 3 — live-event narrative
    agent_a2_highlights.js [live] Fallback highlight ranker + cache
  nn_source.js            [live] NN adapter layer
  nn_registry.js          [live] Per-site source routing
  site_context.js         [live] Raw site records + highlights[] block per site
  preprocessing.js        [live] Deterministic engine
    - resolveHighlights(siteId, ctx) → sync path: declared or raw scorer candidates
    - resolveHighlightsAsync(siteId, ctx) → async path: declared or Agent A2-ranked
    - highlightScorerCandidates(ctx) → deterministic scorer output
    - _resolveAssetId(ctx, assetId) → asset lookup across pools (aircraft excluded, FIX-8)
    - baselineStatsFor(siteId, ctx) → per-site norms (percentiles + dwell thresholds)
    - extractAndRankSignals(event, samples, opts) → { topOutliers, topTrends, interpretedProse, signalHash }
    - buildAgentBPromptBlock(rankedSignals, highlightRes) → { jsonBlock, proseBlock, signalHash }
```

**Consumption (live post-Phase-4).** `main.js` `_fireMistralDebrief` runs the pipeline:
1. `resolveHighlightsAsync(siteId, ctx)` — declared or Agent A2-ranked.
2. `ensureSiteContextDigest(siteId, ctx)` — Agent A digest (cached).
3. `rehydratePreprocessed(event)` — read persisted signals from localStorage if signals unchanged.
4. If cache miss: `extractAndRankSignals(event, samples, {ctx, highlights})` + `writePreprocessed(event, ranked)`.
5. `buildAgentBPromptBlock(ranked, highlightsRes)` → `{jsonBlock, proseBlock, signalHash}`.
6. `readNarrativeCacheIfSignalMatch(event, signalHash)` — if match, short-circuit, no Mistral call, render cached narrative directly.
7. Otherwise `streamDebriefNarrative(event, samples, analysis, callbacks, {siteDigest, highlightsJson, signalsJsonBlock, signalsProseBlock})` fires Agent B.

`event.narrativeCache` includes `signalHash` on write, keyed by `(eventId, startTime)` in localStorage (cross-session collision safe).

---

## Build order (revised per 2026-08-30 architectural review)

Structural fixes land first, then the module split, then the new engine, then the polish fixes, then verification.

### Phase 1 — Structural fixes to existing code (blockers)

1. **FIX-4** — Declare `highlights[]` for `cph` + `esbjerg` in `site_context.js`. Substation sites get 2-3 entries each or ride the fallback path.
2. **FIX-2** — Initialize `event.narrativeCache = null` and `event._preprocessed = null` in `events.js` `addEvent(...)`.
3. **FIX-1** — Persist `event.narrativeCache` to localStorage on Agent B `onDone`. Rehydrate on read from PDF renderer, closed panel, debrief modal.
4. **FIX-5** — `_sanitizeRationale(str)` helper + move partner rationale to `user` role with unverified-data prefix.
5. **FIX-7** — `_siteVersionStamp(siteId)` helper. Every downstream cache key includes it.
6. **FIX-6** — Regenerate button: track `event._regenInFlight`, ignore rapid re-clicks, clear on `.finally()`.

### Phase 2 — Module split (FIX-10)

7. **FIX-10** — Split `src/mistral.js` into `mistral_client.js` (transport) + `src/agents/{agent_a_digest,agent_a2_highlights,agent_b_debrief,agent_case_file}.js`. Preserve public exports via `mistral.js` re-export barrel.

### Phase 3 — Build the new preprocessing engine

8. `src/preprocessing.js` skeleton + Highlight Resolver (reads declared first, fallback second).
9. **FIX-8** — Asset ID resolution with explicit pool lookup order + exclude `aircraft_of_interest` from highlight-eligibility.
10. Baseline Stats Extractor.
11. Trajectory Signal Extractor + ranking.
12. Agent A2 fallback ranker (in the new `src/agents/agent_a2_highlights.js`).

### Phase 4 — Wire the engine end-to-end

13. **FIX-3** — `event._preprocessed` cache with localStorage fallback, invalidation on regenerate.
14. **FIX-9** — Agent B narrative cache per `(eventId, signalHash)`. Skip Agent B call on cache hit.
15. Agent B prompt overhaul: Agent A digest + resolved highlights + structured JSON signal block + interpreted prose.
16. Loosen Agent B length rules for debrief-specific mode.

### Phase 5 — Polish + defensive plumbing

17. **FIX-12** — LRU eviction helper `_lruWrite(key, value)`. Every writer routes through it.
18. Extend regenerate button: clear `event._preprocessed` + Agent A2 fallback cache (when applicable) + Agent A digest + `event.narrativeCache` (both in-memory + localStorage). Declared highlights are never touched by regenerate.

### Phase 6 — Verification

19. Rebuild, verify CPH swarm scenario end-to-end: narrative references declared highlights, calls out outliers, reload preserves narrative.
20. Dispatch verification agent to confirm every FIX above landed correctly against the actual code.

---

## What this replaces

- Vague 1.5-line narratives → structured multi-paragraph analyst brief grounded in signals.
- Hardcoded flat-count highlight logic → partner-declared highlights per site (site decides its own count), agent-ranked fallback for un-configured sites.
- Raw sample dumps in the prompt → compressed JSON signal block + narrated prose (10x token reduction on the debrief side).
- Deterministic template fallback → primary path is real inference with a fallback that still fires if Scaleway is down.

---

## Architectural review — 2026-08-30

An independent audit surfaced 12 findings. All resolved and verified. Kept as a one-line audit trail; implementation detail lives in the spec sections above.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High   | `event.narrativeCache` persistence to localStorage | LANDED — `agent_b_debrief.js` + rehydrate helper in `main.js` |
| 2 | Medium | Initialize `narrativeCache` + `_preprocessed` in `addEvent` | LANDED — `events.js` |
| 3 | Medium | `event._preprocessed` cache + localStorage fallback | LANDED — `preprocessing.js` (with sample-fingerprint staleness check) |
| 4 | High   | Declare `highlights[]` for `cph` + `esbjerg` | LANDED — `site_context.js` (7 + 5 entries) |
| 5 | High   | Sanitize partner rationale + move to user role | LANDED — `sanitizePartnerString` in `mistral_client.js`, consumed by preprocessing |
| 6 | Medium | Regenerate button race guard | LANDED — `event._regenInFlight` in `main.js` |
| 7 | High   | Central `siteVersionStamp` for cache-key invalidation | LANDED — `mistral_client.js`, consumed by baseline + Agent A + Agent A2 caches |
| 8 | Medium | Asset ID lookup order; aircraft excluded from highlights | LANDED — `_resolveAssetId` in `preprocessing.js` (console warns on aircraft misdirect) |
| 9 | Medium | Agent B narrative cache per `(eventId, signalHash)` | LANDED — `readNarrativeCacheIfSignalMatch` + short-circuit in `main.js` |
| 10 | Low   | Split `mistral.js` into transport + agents | LANDED — `mistral_client.js` + `src/agents/*.js` + `mistral.js` barrel |
| 11 | Low   | Fallback path uses same downstream shape | NO ACTION REQUIRED — already correct, confirmed by audit |
| 12 | Medium | localStorage LRU eviction | LANDED — `lruWrite/lruRead/lruRemove` in `preprocessing.js`, all four cache surfaces route through |

**Bonus (cross-session collision):** flagged during the Phase-1 checkpoint that pre-existing `_spawnCounter` reset on reload could cause a same-day eventId collision to surface yesterday's narrative. Fixed by including `event.startTime` in the narrative + preprocessed cache keys. LANDED, verified.
