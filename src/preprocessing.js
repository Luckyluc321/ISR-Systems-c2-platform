// Agentic preprocessing pipeline. Sits between raw event data and the
// Mistral agents (Agent A digest, Agent A2 highlights, Agent B debrief)
// so narratives are grounded in structured, ranked signals — not raw
// JSON dumps or hardcoded lists.
//
// Design goals: rich narrative output, low Mistral cost, low latency,
// scalable to new sites, deep nuance without leaking demo-only
// assumptions.
//
// Full architecture spec: docs/agentic-preprocessing-architecture.md.

import { contextForSite } from './site_context.js';
import { sanitizePartnerString, siteVersionStamp, hashContent } from './mistral_client.js';
import { fallbackRankHighlights } from './agents/agent_a2_highlights.js';
import { ensureSiteContextDigest } from './agents/agent_a_digest.js';

// ═══════════════════════════════════════════════════════════════════
// STAGE 1 — Highlight Resolver
//
// PRIMARY PATH: read declared highlights[] from site_context.js.
// Partner-curated at onboarding. Zero-token, deterministic, adapts
// per-site (substation = 2-3, airport = 5-8).
//
// FALLBACK PATH: when highlights[] is absent (early-stage sites,
// demo/trial), the deterministic Highlight Scorer produces ranked
// candidates and Agent A2 picks the top-N. Fallback code lives here;
// the LLM call itself is in src/agents/agent_a2_highlights.js.
//
// FIX-8: asset_id in declared highlights resolves against the site's
// asset pools in an explicit lookup order. aircraft_of_interest is
// deliberately EXCLUDED — those rosters change hourly and would rot.
// ═══════════════════════════════════════════════════════════════════

// Pool lookup order per FIX-8 — first match wins. aircraft_of_interest
// is intentionally missing so a partner can't accidentally hardcode a
// stale aircraft as a highlight.
const HIGHLIGHT_LOOKUP_POOLS = [
  { key: 'critical_areas',           cat: 'area',     posField: 'center' },
  { key: 'high_value_assets',        cat: 'asset',    posField: 'location' },
  { key: 'response_asset_positions', cat: 'response', posField: 'location' },
];

// Return the asset record + which pool it came from, or null if the id
// resolves to nothing (or resolves ONLY to aircraft_of_interest, which
// is excluded).
export function _resolveAssetId(ctx, assetId) {
  if (!ctx || !assetId) return null;
  for (const pool of HIGHLIGHT_LOOKUP_POOLS) {
    const entry = (ctx[pool.key] || []).find(a => a.id === assetId);
    if (entry) return { entry, pool: pool.key, cat: pool.cat, pos: entry[pool.posField] };
  }
  // Explicitly check aircraft_of_interest so we can warn rather than
  // silent-drop — helps partners diagnose an accidental aircraft ID
  // in their highlights[] block.
  const aircraftHit = (ctx.aircraft_of_interest || []).find(a => a.id === assetId);
  if (aircraftHit) {
    console.warn(`[preprocessing] highlight asset_id "${assetId}" resolves to aircraft_of_interest; aircraft are not highlight-eligible (rosters change hourly). Dropping.`);
    return null;
  }
  return null;
}

// Primary path — read declared highlights from site_context.js and
// resolve each asset_id via the pool lookup. Each rationale is
// sanitized against prompt injection before being handed to Agent B.
// Returns [] if the site declares no highlights (caller should then
// route to the fallback scorer + Agent A2 path).
export function resolveDeclaredHighlights(ctx) {
  const declared = ctx?.highlights;
  if (!Array.isArray(declared) || declared.length === 0) return null;
  const resolved = [];
  for (const raw of declared) {
    if (!raw?.asset_id) continue;
    const hit = _resolveAssetId(ctx, raw.asset_id);
    if (!hit) continue;   // _resolveAssetId already warns on aircraft misdirect
    resolved.push({
      asset_id: raw.asset_id,
      name: hit.entry.name || raw.asset_id,
      cat: hit.cat,
      pool: hit.pool,
      pos: hit.pos,
      criticality: hit.entry.criticality || 'medium',
      priority: typeof raw.priority === 'number' ? raw.priority : 999,
      rationale: sanitizePartnerString(raw.rationale || ''),
      source: 'declared',
    });
  }
  // Stable sort by priority ascending (1 = highest), ties by array order
  resolved.sort((a, b) => a.priority - b.priority);
  return resolved;
}

// ─────────────────────────────────────────────────────────────
// Fallback stage 1a — Deterministic Highlight Scorer.
// Fires only when the site has no declared highlights. Emits a
// ranked candidate list; Agent A2 (LLM) picks the final top-N.
// ─────────────────────────────────────────────────────────────

const _CRITICALITY_WEIGHT = { critical: 1.0, high: 0.7, medium: 0.4, low: 0.15 };
const _POOL_SIZE_MULTIPLIER = { area: 1.2, asset: 1.0, response: 0.7 };

// Distance in metres between two lat/lon points (haversine). Kept
// local so preprocessing has no dependency on main.js.
function _haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function highlightScorerCandidates(ctx) {
  if (!ctx) return [];
  // Collect all assets from the three eligible pools (aircraft excluded).
  const assets = [];
  for (const pool of HIGHLIGHT_LOOKUP_POOLS) {
    const entries = ctx[pool.key] || [];
    for (const a of entries) {
      const pos = a[pool.posField];
      if (a.status === 'inactive') continue;
      if (!pos?.lat || !pos?.lon) continue;
      assets.push({
        asset_id: a.id,
        name: a.name,
        cat: pool.cat,
        pool: pool.key,
        pos,
        criticality: a.criticality || 'medium',
        reason: a.reason || '',
      });
    }
  }
  if (!assets.length) return [];

  // Response asset positions for the proximity bonus.
  const responsePositions = (ctx.response_asset_positions || [])
    .map(r => r.location)
    .filter(p => p?.lat && p?.lon);

  // Score every asset.
  const scored = assets.map(a => {
    const criticalityW = _CRITICALITY_WEIGHT[a.criticality] ?? 0.4;
    const sizeMul = _POOL_SIZE_MULTIPLIER[a.cat] ?? 1.0;
    // Response proximity bonus: closer to a response asset = harder to
    // hit unnoticed = higher rank. Scored on nearest response asset
    // distance, capped at 1000m (beyond that no bonus).
    let respProxBonus = 1.0;
    if (responsePositions.length) {
      let minDist = Infinity;
      for (const rp of responsePositions) {
        const d = _haversineM(a.pos.lat, a.pos.lon, rp.lat, rp.lon);
        if (d < minDist) minDist = d;
      }
      // 1.0 at 1000m+, up to 1.25 at 0m. Linear.
      respProxBonus = 1.0 + Math.max(0, (1000 - minDist) / 1000) * 0.25;
    }
    const base_score = criticalityW * sizeMul * respProxBonus;
    return { ...a, base_score };
  });

  scored.sort((a, b) => b.base_score - a.base_score);

  // Threshold: return all above the median score, capped at max(3,
  // sqrt(assetCount)). Site-adaptive count.
  const scores = scored.map(x => x.base_score).sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)] || 0;
  const cap = Math.max(3, Math.ceil(Math.sqrt(scored.length)));
  const candidates = scored.filter(x => x.base_score >= median).slice(0, cap);
  return candidates;
}

// Public sync path: returns declared highlights immediately when
// present, otherwise returns the raw scorer candidates (no Agent A2
// run). Fast path used by any consumer that wants immediate structure
// and can't await.
export function resolveHighlights(siteId, ctx) {
  if (!ctx) ctx = contextForSite(siteId);
  if (!ctx) return { highlights: [], source: 'none' };
  const declared = resolveDeclaredHighlights(ctx);
  if (declared && declared.length) {
    return { highlights: declared, source: 'declared' };
  }
  const candidates = highlightScorerCandidates(ctx);
  return {
    highlights: candidates.map(c => ({
      asset_id: c.asset_id,
      name: c.name,
      cat: c.cat,
      pool: c.pool,
      pos: c.pos,
      criticality: c.criticality,
      priority: 999,   // priority unresolved until Agent A2 ranks these
      rationale: '',   // Agent A2 will fill in async
      source: 'fallback-scorer',
    })),
    source: 'fallback-scorer-pending-a2',
  };
}

// Public async path: same result shape, but for un-configured sites
// also runs Agent A2 to rank the scorer candidates with rationale.
// Cache-first — no Mistral hit for repeated calls at the same site.
// Preferred entry point for the debrief flow (Agent B needs rationales).
export async function resolveHighlightsAsync(siteId, ctx) {
  if (!ctx) ctx = contextForSite(siteId);
  if (!ctx) return { highlights: [], source: 'none' };

  const declared = resolveDeclaredHighlights(ctx);
  if (declared && declared.length) {
    return { highlights: declared, source: 'declared' };
  }

  const candidates = highlightScorerCandidates(ctx);
  if (!candidates.length) return { highlights: [], source: 'none' };

  // Agent A2 needs Agent A's digest as context. Cache-hit is
  // synchronous; miss triggers one Mistral call, populates for reuse.
  const digest = await ensureSiteContextDigest(siteId, ctx);
  const ranked = await fallbackRankHighlights(siteId, ctx, candidates, digest);
  return { highlights: ranked, source: 'fallback-a2' };
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 4 — Baseline Stats Extractor
//
// Per-site norms used by the Trajectory Signal Extractor to compute
// z-scores (this event vs typical site activity). No LLM. Recomputed
// only when the site context changes.
//
// Current implementation derives baselines from geographic constants
// (sensor coverage radius as altitude proxy, etc.) since we don't yet
// have a historical event archive. When one lands, this function can
// swap to real percentile computation from prior recordings without
// downstream changes.
// ═══════════════════════════════════════════════════════════════════

const _BASELINE_CACHE = new Map();

export function baselineStatsFor(siteId, ctx) {
  if (!ctx) ctx = contextForSite(siteId);
  if (!ctx) return null;
  const stamp = siteVersionStamp(siteId, ctx);
  const cached = _BASELINE_CACHE.get(siteId);
  if (cached && cached.stamp === stamp) return cached.stats;

  // Derive constants per site type. Airports have higher typical
  // altitudes; substations expect none. Ports sit between. Values
  // are conservative demo defaults — will be replaced by real
  // percentile data from historical recordings when available.
  const siteType = ctx.site_type || 'unknown';
  const isAirport = /airport/i.test(siteType);
  const isSubstation = /substation|switching/i.test(siteType);
  const isPort = /port|harbor|harbour/i.test(siteType);

  const stats = {
    typical_transit_altitude_m: isAirport
      ? { p25: 40, p50: 90, p75: 150, p95: 250 }
      : isSubstation
        ? { p25: 5, p50: 15, p75: 40, p95: 80 }
        : isPort
          ? { p25: 20, p50: 60, p75: 120, p95: 200 }
          : { p25: 15, p50: 50, p75: 110, p95: 200 },
    typical_transit_speed_ms: isAirport
      ? { p25: 8, p50: 15, p75: 22, p95: 30 }
      : { p25: 5, p50: 10, p75: 15, p95: 22 },
    // Dwell thresholds — dwell over this many seconds is "meaningful"
    // per zone type. Runways get longer thresholds because taxi-adjacent
    // hover is normal; fuel storage tighter because any dwell is a flag.
    dwell_thresholds_by_zone_type_sec: {
      runway: 15, apron: 20, terminal: 15, pier: 20, cargo: 25,
      atc_control_tower: 8, ils_ground_installation: 8, nav_broadcast: 8,
      fuel_storage: 5, fuel_infrastructure: 8, ground_power: 10,
      emergency_response: 10, vip_state_terminal: 8, restricted_facility: 8,
      cuas_staging: 15, cuas_fixed: 15, overwatch: 15, qra_relay: 15,
      autotransformer: 5, hv_bus: 5,
      default: 15,
    },
    formation_baseline_cohesion_m: 40,   // typical swarm scatter radius
    site_type: siteType,
  };
  _BASELINE_CACHE.set(siteId, { stamp, stats });
  return stats;
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 5 — Trajectory Signal Extractor + Ranking
//
// Takes a completed event's recording samples + baseline stats +
// resolved highlights. Emits a compact ranked signal set. No LLM.
//
// Signals extracted:
//   - approach_vectors     (per asset — closest approach + bearing)
//   - speed_profile        (segmented + trend)
//   - altitude_profile     (segmented + trend)
//   - dwell_hotspots       (top-3 by cumulative dwell)
//   - formation_cohesion   (swarm scatter over time)
//
// Each signal tagged with:
//   - outlier_score (z-score vs site baseline)
//   - trend_score   (R^2 of monotonic trend)
//   - criticality_multiplier
//   - narrative_worthiness rank
// ═══════════════════════════════════════════════════════════════════

// ── Small numerical helpers ───────────────────────────────────
function _mean(xs) { if (!xs.length) return 0; return xs.reduce((a, b) => a + b, 0) / xs.length; }
function _zScoreVsPercentiles(value, percentiles) {
  // Convert p25/p50/p75/p95 to an approximate mean+std, then z.
  const mean = percentiles.p50;
  // p25 → p75 spans roughly ±0.675 sigma → derive sigma from IQR
  const iqr = Math.max(1e-6, percentiles.p75 - percentiles.p25);
  const sigma = iqr / 1.349;
  return (value - mean) / sigma;
}
function _linearRegressionR2(xs, ys) {
  // Returns { slope, r2 } for the least-squares line y = a*x + b.
  if (xs.length < 3) return { slope: 0, r2: 0 };
  const mx = _mean(xs);
  const my = _mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const r2 = (sxx > 0 && syy > 0) ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, r2 };
}

// ── Signal extractors ─────────────────────────────────────────

function _extractApproachVectors(samples, highlights) {
  const out = [];
  for (const h of highlights) {
    if (!h?.pos?.lat) continue;
    let minDist = Infinity;
    let momentIdx = -1;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s?.lat == null || s?.lon == null) continue;
      const d = _haversineM(h.pos.lat, h.pos.lon, s.lat, s.lon);
      if (d < minDist) { minDist = d; momentIdx = i; }
    }
    if (momentIdx < 0) continue;
    const moment = samples[momentIdx];
    out.push({
      signal: 'approach_vector',
      asset_id: h.asset_id,
      asset_name: h.name,
      closest_dist_m: Math.round(minDist),
      moment_t_sec: moment.t_sec_from_event,
      moment_alt_m: moment.alt,
      moment_heading_deg: moment.heading,
      criticality: h.criticality,
    });
  }
  return out;
}

function _extractAltitudeProfile(samples, baseline) {
  const altSamples = samples.filter(s => s?.alt != null);
  if (altSamples.length < 3) return null;
  const alts = altSamples.map(s => s.alt);
  const times = altSamples.map(s => s.t_sec_from_event);
  const meanAlt = _mean(alts);
  const minAlt = Math.min(...alts);
  const maxAlt = Math.max(...alts);
  const z = _zScoreVsPercentiles(meanAlt, baseline.typical_transit_altitude_m);
  const { slope, r2 } = _linearRegressionR2(times, alts);
  return {
    signal: 'altitude_profile',
    mean_alt_m: Math.round(meanAlt),
    min_alt_m: Math.round(minAlt),
    max_alt_m: Math.round(maxAlt),
    z_vs_site_baseline: +z.toFixed(2),
    trend_slope_m_per_s: +slope.toFixed(3),
    trend_r2: +r2.toFixed(3),
  };
}

function _extractSpeedProfile(samples, baseline) {
  const speedSamples = samples.filter(s => s?.speed != null);
  if (speedSamples.length < 3) return null;
  const speeds = speedSamples.map(s => s.speed);
  const times = speedSamples.map(s => s.t_sec_from_event);
  const meanSpeed = _mean(speeds);
  const z = _zScoreVsPercentiles(meanSpeed, baseline.typical_transit_speed_ms);
  const { slope, r2 } = _linearRegressionR2(times, speeds);
  return {
    signal: 'speed_profile',
    mean_speed_ms: +meanSpeed.toFixed(2),
    min_speed_ms: +Math.min(...speeds).toFixed(2),
    max_speed_ms: +Math.max(...speeds).toFixed(2),
    z_vs_site_baseline: +z.toFixed(2),
    trend_slope_ms_per_s: +slope.toFixed(3),
    trend_r2: +r2.toFixed(3),
  };
}

function _extractDwellHotspots(samples, highlights, baseline) {
  // For each highlight, count samples within dwell threshold radius.
  // Uses baseline thresholds keyed by asset_type when available.
  const hotspots = [];
  for (const h of highlights) {
    if (!h?.pos?.lat) continue;
    const assetType = h.pool === 'high_value_assets' && h.cat === 'asset'
      ? (h.asset_type || 'default')
      : (h.cat === 'area' ? (h.asset_id?.includes('runway') ? 'runway' : h.asset_id?.includes('pier') ? 'pier' : 'default') : 'default');
    const thresholdSec = baseline.dwell_thresholds_by_zone_type_sec[assetType]
      || baseline.dwell_thresholds_by_zone_type_sec.default;
    // Radius: 250m for areas, 150m for point assets, 100m for aircraft
    const radiusM = h.cat === 'area' ? 250 : 150;
    let hitCount = 0, firstT = null, lastT = null;
    for (const s of samples) {
      if (s?.lat == null) continue;
      const d = _haversineM(h.pos.lat, h.pos.lon, s.lat, s.lon);
      if (d <= radiusM) {
        hitCount++;
        if (firstT == null) firstT = s.t_sec_from_event;
        lastT = s.t_sec_from_event;
      }
    }
    if (hitCount === 0) continue;
    const durationSec = firstT != null ? Math.round(lastT - firstT) : 0;
    hotspots.push({
      signal: 'dwell_hotspot',
      asset_id: h.asset_id,
      asset_name: h.name,
      sample_count: hitCount,
      duration_sec: durationSec,
      threshold_sec: thresholdSec,
      exceeds_threshold: durationSec >= thresholdSec,
      criticality: h.criticality,
    });
  }
  hotspots.sort((a, b) => b.duration_sec - a.duration_sec);
  return hotspots.slice(0, 3);
}

function _extractFormationCohesion(samples, baseline) {
  // Group samples by t_sec bin. For each bin, compute mean pairwise
  // distance among drones present at that tick. Trend of that value
  // over time = cohesion signal (tighter = attack posture, looser =
  // scatter).
  const buckets = new Map();
  for (const s of samples) {
    if (s?.droneId == null || s?.lat == null) continue;
    const bin = Math.round(s.t_sec_from_event);
    if (!buckets.has(bin)) buckets.set(bin, []);
    buckets.get(bin).push({ droneId: s.droneId, lat: s.lat, lon: s.lon });
  }
  if (buckets.size < 3) return null;
  const times = [];
  const scatters = [];
  for (const [t, group] of buckets) {
    if (group.length < 2) continue;
    let sum = 0, count = 0;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        sum += _haversineM(group[i].lat, group[i].lon, group[j].lat, group[j].lon);
        count++;
      }
    }
    if (count === 0) continue;
    times.push(t);
    scatters.push(sum / count);
  }
  if (scatters.length < 3) return null;
  const meanScatter = _mean(scatters);
  const { slope, r2 } = _linearRegressionR2(times, scatters);
  return {
    signal: 'formation_cohesion',
    mean_scatter_m: Math.round(meanScatter),
    baseline_scatter_m: baseline.formation_baseline_cohesion_m,
    scatter_z: +((meanScatter - baseline.formation_baseline_cohesion_m) / 30).toFixed(2),
    trend_slope_m_per_s: +slope.toFixed(3),
    trend_r2: +r2.toFixed(3),
  };
}

// ── Ranker ────────────────────────────────────────────────────

const _CRITICALITY_MULT = { critical: 1.5, high: 1.2, medium: 1.0, low: 0.7 };

function _rankScore(outlierScore, trendScore, criticalityMult, isHighlight) {
  const highlightWeight = isHighlight ? 2.0 : 1.0;
  return Math.max(Math.abs(outlierScore), (trendScore || 0) * 0.7) * criticalityMult * highlightWeight;
}

// ── Prose formatter (deterministic phrasing where safe) ──────

function _proseForSignal(sig) {
  switch (sig.signal) {
    case 'approach_vector':
      return `Closest approach to ${sig.asset_name} was ${sig.closest_dist_m}m at altitude ${sig.moment_alt_m ?? '?'}m (t=${Math.round(sig.moment_t_sec ?? 0)}s).`;
    case 'altitude_profile': {
      const trendWord = sig.trend_slope_m_per_s > 0.1 ? 'ascended' : sig.trend_slope_m_per_s < -0.1 ? 'descended' : 'held level';
      return `Track ${trendWord} across the event (mean ${sig.mean_alt_m}m, range ${sig.min_alt_m}-${sig.max_alt_m}m).`;
    }
    case 'speed_profile': {
      const trendWord = sig.trend_slope_ms_per_s > 0.05 ? 'accelerated' : sig.trend_slope_ms_per_s < -0.05 ? 'decelerated' : 'held speed';
      return `Track ${trendWord} across the event (mean ${sig.mean_speed_ms} m/s).`;
    }
    case 'dwell_hotspot': {
      const flagWord = sig.exceeds_threshold ? 'exceeds' : 'below';
      return `Dwell over ${sig.asset_name} for ${sig.duration_sec}s (${flagWord} the ${sig.threshold_sec}s doctrine threshold).`;
    }
    case 'formation_cohesion': {
      const tightWord = sig.mean_scatter_m < sig.baseline_scatter_m * 0.7 ? 'tightened'
        : sig.mean_scatter_m > sig.baseline_scatter_m * 1.5 ? 'scattered' : 'held nominal spread';
      return `Formation ${tightWord} (mean scatter ${sig.mean_scatter_m}m, baseline ${sig.baseline_scatter_m}m).`;
    }
    default:
      return '';
  }
}

// ── Notability classifier ────────────────────────────────────
//
// Four tiers, deterministic. Prevents Agent B from manufacturing
// significance when the trajectory has nothing meaningful to say.
//
//   identify-only  Small site (substation/switching) + short duration
//                  + no highlight approach. Skips Mistral entirely —
//                  deterministic one-sentence identification.
//   transit        Any site, nothing above threshold. Short paragraph.
//   marginal       Some near-threshold signals. 1-2 paragraphs.
//   notable        At least one signal above threshold. Full analyst brief.
// ─────────────────────────────────────────────────────────────

function _isSmallSite(ctx) {
  const t = (ctx?.site_type || '').toLowerCase();
  return /substation|switching|hv_/.test(t);
}

function _eventDurationSec(samples) {
  if (!samples?.length) return 0;
  const first = samples[0]?.t_sec_from_event ?? 0;
  const last = samples[samples.length - 1]?.t_sec_from_event ?? 0;
  return Math.max(0, last - first);
}

function _bearingBetween(latA, lonA, latB, lonB) {
  const phi1 = latA * Math.PI / 180;
  const phi2 = latB * Math.PI / 180;
  const dLon = (lonB - lonA) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function _bearingToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function classifyNotability(event, ctx, samples, rankedSignals) {
  const dur = _eventDurationSec(samples);
  const smallSite = _isSmallSite(ctx);
  const outliers = rankedSignals?.topOutliers || [];
  const trends = rankedSignals?.topTrends || [];

  const approachSigs = outliers.filter(s => s.signal === 'approach_vector');
  const minApproachToHighlight = approachSigs.length
    ? Math.min(...approachSigs.map(s => s.closest_dist_m ?? Infinity))
    : Infinity;
  const dwellExceeds = outliers.some(s => s.signal === 'dwell_hotspot' && s.exceeds_threshold);
  const maxTrendR2 = Math.max(0, ...trends.map(s => s.trend_r2 || 0));
  const maxOutlierScore = Math.max(0, ...outliers.map(s => s._outlier || 0));

  // Tier 1: identify-only — small site, short pass-through, no highlight approach.
  if (smallSite && dur > 0 && dur < 60 && minApproachToHighlight > 200) {
    return {
      tier: 'identify-only',
      reason: 'small site + short duration + no highlight approach',
      deterministicBody: _buildIdentifySentence(event, ctx, samples),
      deterministicReco: 'Identify and log per standard protocol.',
    };
  }

  // Tier 4: notable — at least one signal above threshold.
  const isNotable = minApproachToHighlight < 100
    || dwellExceeds
    || maxTrendR2 > 0.7
    || maxOutlierScore > 2.0;
  if (isNotable) {
    return { tier: 'notable', reason: 'signal(s) above threshold' };
  }

  // Tier 3: marginal — some signals present but nothing definitive.
  const isMarginal = minApproachToHighlight < 300
    || maxTrendR2 > 0.4
    || maxOutlierScore > 1.0;
  if (isMarginal) {
    return { tier: 'marginal', reason: 'signals present but below threshold' };
  }

  // Tier 2: transit — nothing meaningful, but not small-site short-pass.
  return { tier: 'transit', reason: 'no significant behavioural signals' };
}

// Deterministic one-sentence identification for identify-only events.
// Skips Mistral entirely. Includes platform, site, direction, altitude.
function _buildIdentifySentence(event, ctx, samples) {
  const platform = event.droneType || event.platform || 'Unknown platform';
  const siteName = ctx?.name || event.siteId || 'the site';
  const parts = [platform, 'transited', `${siteName} sensor coverage`];
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first && last && first.lat != null && last.lat != null) {
    const brng = _bearingBetween(first.lat, first.lon, last.lat, last.lon);
    parts.push(`heading ${_bearingToCompass(brng)}`);
  }
  const alts = samples.filter(s => s.alt != null).map(s => s.alt);
  if (alts.length) {
    const meanAlt = Math.round(alts.reduce((a, b) => a + b, 0) / alts.length);
    parts.push(`at ${meanAlt}m mean altitude`);
  }
  const dur = _eventDurationSec(samples);
  if (dur > 0) parts.push(`over ${Math.round(dur)}s`);
  return parts.join(' ') + '. No dwell, no highlighted-asset approach.';
}

// ── Public: extract + rank in one pass ────────────────────────

export function extractAndRankSignals(event, samples, opts = {}) {
  const siteId = event?.siteId;
  const ctx = opts.ctx || contextForSite(siteId);
  if (!ctx || !samples?.length) {
    return { topOutliers: [], topTrends: [], interpretedProse: [], signalHash: null, source: ctx ? 'no-samples' : 'no-context' };
  }

  const baseline = baselineStatsFor(siteId, ctx);
  const highlightRes = opts.highlights || resolveHighlights(siteId, ctx);
  const highlights = highlightRes.highlights || [];
  const highlightIdSet = new Set(highlights.map(h => h.asset_id));

  const rawSignals = [];
  rawSignals.push(..._extractApproachVectors(samples, highlights));
  const altP = _extractAltitudeProfile(samples, baseline);
  if (altP) rawSignals.push(altP);
  const spdP = _extractSpeedProfile(samples, baseline);
  if (spdP) rawSignals.push(spdP);
  rawSignals.push(..._extractDwellHotspots(samples, highlights, baseline));
  const cohesion = _extractFormationCohesion(samples, baseline);
  if (cohesion) rawSignals.push(cohesion);

  // Compute per-signal scores.
  const scored = rawSignals.map(sig => {
    const outlier = Math.abs(sig.z_vs_site_baseline ?? sig.scatter_z ?? 0);
    const trend = sig.trend_r2 ?? 0;
    // approach_vector doesn't have z/trend directly — derive from distance
    // vs site typical altitude (closer = higher outlier score).
    let outlierAdj = outlier;
    if (sig.signal === 'approach_vector') {
      outlierAdj = Math.max(0, (500 - sig.closest_dist_m) / 100);
    } else if (sig.signal === 'dwell_hotspot') {
      outlierAdj = sig.exceeds_threshold ? (sig.duration_sec / sig.threshold_sec) : 0;
    }
    const critMult = _CRITICALITY_MULT[sig.criticality] || 1.0;
    const isHighlight = sig.asset_id ? highlightIdSet.has(sig.asset_id) : false;
    const score = _rankScore(outlierAdj, trend, critMult, isHighlight);
    return { ...sig, _score: +score.toFixed(3), _outlier: +outlierAdj.toFixed(2), _trend: +trend.toFixed(2), _isHighlight: isHighlight };
  });

  // Sort by score, pick top outliers (score-driven) and top trends
  // (r2-driven). Two lists so Agent B can call them out distinctly.
  const byScore = [...scored].sort((a, b) => b._score - a._score);
  const topOutliers = byScore.slice(0, 5);
  const topTrends = [...scored]
    .filter(s => (s.trend_r2 ?? 0) >= 0.6)
    .sort((a, b) => (b.trend_r2 ?? 0) - (a.trend_r2 ?? 0))
    .slice(0, 3);

  const interpretedProse = [];
  const seen = new Set();
  for (const sig of [...topOutliers, ...topTrends]) {
    const key = `${sig.signal}:${sig.asset_id || ''}`;
    if (seen.has(key)) continue;
    const prose = _proseForSignal(sig);
    if (prose) { interpretedProse.push(prose); seen.add(key); }
  }

  const signalHash = hashContent({
    outliers: topOutliers.map(s => ({ signal: s.signal, asset_id: s.asset_id, score: s._score })),
    trends: topTrends.map(s => ({ signal: s.signal, asset_id: s.asset_id, r2: s.trend_r2 })),
  });

  // Notability classification — deterministic tier that gates how
  // deep Agent B is allowed to go. `identify-only` short-circuits
  // Mistral entirely and uses the deterministic sentence below.
  const notability = classifyNotability(event, ctx, samples, { topOutliers, topTrends });

  return {
    topOutliers,
    topTrends,
    interpretedProse,
    highlightsSource: highlightRes.source,
    signalHash,
    sampleFingerprint: _sampleFingerprint(samples),
    notability,
    computedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Persistence helpers — namespaced `isr:` for read/write/remove.
//
// Per Lucas's rule (2026-08-31): NOTHING here auto-deletes. Event
// evidence, narrative caches, digests, preprocessed signals all
// persist forever unless the operator explicitly calls
// window.__isr_clearAllSimData() from DevTools. On quota exceeded
// we log loudly and return false; caller keeps the value in memory
// for the session.
//
// Sidecar access-timestamp entries under `isr:_meta:lastAccess:`
// are still written on every read/write — they support the manual
// clear helper's optional "oldest first" ordering and future
// analytics, but no code path evicts on their basis.
//
// See memory: replay-always-available. Trajectory recordings + all
// derived agentic outputs are preserved as first-class evidence.
// ═══════════════════════════════════════════════════════════════════
const _LRU_SIDECAR_PREFIX = 'isr:_meta:lastAccess:';

function _lruSidecarKey(key) { return `${_LRU_SIDECAR_PREFIX}${key}`; }

// Public: write with quota-error handling. Per Lucas's rule (2026-08-31)
// nothing auto-evicts — event evidence and agentic outputs are preserved
// unless the operator explicitly runs window.__isr_clearAllSimData().
// If quota is hit, we log loudly and return false; caller keeps the
// value in memory for the session but it won't survive reload until
// the operator clears space.
export function lruWrite(key, value) {
  if (!key || !key.startsWith('isr:')) return false;
  try {
    localStorage.setItem(key, value);
    localStorage.setItem(_lruSidecarKey(key), String(Date.now()));
    return true;
  } catch (err) {
    console.error(`[lruWrite] localStorage quota exceeded for ${key}. Value lives in memory only. Run window.__isr_clearAllSimData() to free space.`, err);
    return false;
  }
}

// Public: read with LRU access-timestamp bump.
export function lruRead(key) {
  if (!key) return null;
  try {
    const v = localStorage.getItem(key);
    if (v != null) localStorage.setItem(_lruSidecarKey(key), String(Date.now()));
    return v;
  } catch (_) { return null; }
}

// Public: remove entry + its sidecar.
export function lruRemove(key) {
  if (!key) return;
  try {
    localStorage.removeItem(key);
    localStorage.removeItem(_lruSidecarKey(key));
  } catch (_) { /* swallow */ }
}

// ═══════════════════════════════════════════════════════════════════
// FIX-3 — event._preprocessed cache + localStorage fallback.
//
// Trajectory Signal Extractor output is expensive to recompute
// (haversine + regressions across every sample), and the input rarely
// changes for a closed event. Persist per-event so PDF export, closed
// panel, and reopen debrief flows survive a page reload without re-
// running the extractor. Cache key includes eventId + startTime for
// cross-session collision safety (matches the narrativeCache pattern).
// ═══════════════════════════════════════════════════════════════════

const PREPROCESSED_KEY_PREFIX = 'isr:preprocessed:';

function _preprocessedKey(eventId, startTime) {
  const st = (startTime || 'no-start').replace(/[:.\s]/g, '_');
  return `${PREPROCESSED_KEY_PREFIX}${eventId}:${st}`;
}

// Concern-A fix (post-verification): fingerprint the sample set so a
// replay adding/removing ticks after the event closed invalidates
// the persisted preprocessed cache. Count + first/last t + first/last
// coords give a cheap, deterministic fingerprint that changes with
// any real recording edit.
function _sampleFingerprint(samples) {
  if (!Array.isArray(samples) || !samples.length) return 'empty';
  const first = samples[0];
  const last = samples[samples.length - 1];
  return `${samples.length}:${(first?.t_sec_from_event ?? 0).toFixed(2)}:${(last?.t_sec_from_event ?? 0).toFixed(2)}:${(first?.lat ?? 0).toFixed(5)}:${(last?.lat ?? 0).toFixed(5)}`;
}

export function writePreprocessed(event, preprocessed) {
  if (!event?.id || !preprocessed) return;
  lruWrite(_preprocessedKey(event.id, event.startTime), JSON.stringify(preprocessed));
}

export function readPreprocessed(event) {
  if (!event?.id) return null;
  const raw = lruRead(_preprocessedKey(event.id, event.startTime));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

export function invalidatePreprocessed(event) {
  if (!event?.id) return;
  lruRemove(_preprocessedKey(event.id, event.startTime));
}

// Rehydrate helper — mirrors _rehydrateNarrativeCache in main.js.
// If event._preprocessed is null and a persisted copy exists, adopts
// it in-memory so downstream readers see it. samples arg is optional
// but required for staleness detection — if provided and the current
// sample fingerprint differs from the persisted one, invalidates and
// returns null so the caller recomputes fresh signals.
export function rehydratePreprocessed(event, samples) {
  if (!event) return null;
  if (event._preprocessed) {
    // In-memory copy may itself be stale if samples changed. Check
    // fingerprint match; drop the stale copy so the caller recomputes.
    if (samples && event._preprocessed.sampleFingerprint
        && event._preprocessed.sampleFingerprint !== _sampleFingerprint(samples)) {
      event._preprocessed = null;
    } else {
      return event._preprocessed;
    }
  }
  const persisted = readPreprocessed(event);
  if (!persisted) return null;
  // Staleness check on persisted copy too.
  if (samples && persisted.sampleFingerprint
      && persisted.sampleFingerprint !== _sampleFingerprint(samples)) {
    invalidatePreprocessed(event);
    return null;
  }
  event._preprocessed = persisted;
  return event._preprocessed;
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 6 — Agent B prompt block formatter.
//
// Compresses the ranked signal set into a compact JSON block + prose
// paragraph that Agent B consumes as prompt context. JSON gives the
// model machine-readable structure; prose block gives it phrasing the
// deterministic layer already verified is safe.
// ═══════════════════════════════════════════════════════════════════

export function buildAgentBPromptBlock(rankedSignals, highlightRes) {
  if (!rankedSignals) return { jsonBlock: '', proseBlock: '', signalHash: null, notability: null };
  const jsonPayload = {
    notability_tier: rankedSignals.notability?.tier || 'unknown',
    notability_reason: rankedSignals.notability?.reason || '',
    highlights: (highlightRes?.highlights || []).map(h => ({
      asset_id: h.asset_id, name: h.name, priority: h.priority,
      rationale: h.rationale,
      source: h.source,
    })),
    top_outliers: rankedSignals.topOutliers.map(({ _score, _outlier, _trend, _isHighlight, ...clean }) => clean),
    top_trends: rankedSignals.topTrends.map(({ _score, _outlier, _trend, _isHighlight, ...clean }) => clean),
  };
  const jsonBlock = [
    'STRUCTURED SIGNAL BLOCK (JSON)',
    '─────────────────────────────',
    '```json',
    JSON.stringify(jsonPayload, null, 2),
    '```',
  ].join('\n');
  const proseBlock = rankedSignals.interpretedProse.length
    ? [
        'INTERPRETED SIGNAL PROSE (deterministic phrasing)',
        '─────────────────────────────────────────────',
        ...rankedSignals.interpretedProse.map(p => `- ${p}`),
      ].join('\n')
    : '';
  return {
    jsonBlock,
    proseBlock,
    signalHash: rankedSignals.signalHash,
    notability: rankedSignals.notability,
  };
}
