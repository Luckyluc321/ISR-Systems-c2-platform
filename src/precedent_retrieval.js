// ═══════════════════════════════════════════════════════════════════
// Precedent Retrieval — deterministic top-K similar past events
// ───────────────────────────────────────────────────────────────────
// Consumes precedent_index. Given a new event, returns the top-K
// most-similar closed events, filtered by spatial tier + weighted by
// temporal decay + gated by combined-score threshold. Zero LLM
// involvement. Auditable — every retrieved event carries its score.
//
// The formatted prompt block explicitly forbids Agent B from
// extrapolating action-recommendations from precedents. Precedents
// exist for the OPERATOR's judgment, not the agent's. See
// docs/agentic-precedent-retrieval-architecture.md + memory
// feedback-detection-only-positioning.
// ═══════════════════════════════════════════════════════════════════

import { allRecords, computeFeatureVector, extractFeatureFields } from './precedent_index.js';

// ── Config (versioned constants; move to conf/ yaml later) ───────
// TODO: load from conf/precedent_retrieval.yaml at boot when the
// Azure config plane lands. Keep shape stable so the loader can drop
// in without touching retrieval logic. Per-site overrides expected
// (high-traffic sites tighten MIN_SIMILARITY to reduce noise).
const CFG = {
  MAX_PRECEDENTS:       5,
  MIN_SIMILARITY:       0.72,
  MAX_TOTAL_TOKENS:     1800,
  TOKENS_PER_PRECEDENT: 220,       // rough envelope for scoring cutoff

  RECENCY_WEIGHTS: [
    { maxDays: 30,  weight: 1.0 },
    { maxDays: 180, weight: 0.7 },
    { maxDays: 365, weight: 0.4 },
    { maxDays: Infinity, weight: 0.15 },
  ],

  // Spatial tier assignment (lower number = higher relevance).
  // Tier 1 requires same-site + same-asset. Tier 2 same-site any-asset.
  // Tier 3 same-tenant. Tier 4 cross-tenant same-platform-family
  // (fallback only when tiers 1-3 yield fewer than 2 results).
};

// ── Similarity: cosine on integer/one-hot vectors ────────────────
function _cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Recency weight ───────────────────────────────────────────────
// RECENCY_WEIGHTS ends with maxDays: Infinity so the for-loop always
// resolves. The parse-guard is the only real fallback.
function _recencyWeight(closedAt) {
  const ts = new Date(closedAt).getTime();
  if (!Number.isFinite(ts)) return CFG.RECENCY_WEIGHTS[CFG.RECENCY_WEIGHTS.length - 1].weight;
  const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  for (const bucket of CFG.RECENCY_WEIGHTS) {
    if (ageDays <= bucket.maxDays) return bucket.weight;
  }
  // Unreachable — final bucket is Infinity. Kept as defence-in-depth
  // in case the constants ever change and someone drops the Infinity.
  return CFG.RECENCY_WEIGHTS[CFG.RECENCY_WEIGHTS.length - 1].weight;
}

// ── Spatial tier assignment ──────────────────────────────────────
function _spatialTier(newEvent, newFields, record) {
  const sameSite = record.siteId === newEvent.siteId;
  const sameTenant = record.tenantId && newEvent.tenantId && record.tenantId === newEvent.tenantId;
  if (sameSite && record.featureFields.asset_targeted && record.featureFields.asset_targeted === newFields.asset_targeted) return 1;
  if (sameSite) return 2;
  if (sameTenant) return 3;
  if (record.featureFields.platform_family === newFields.platform_family) return 4;
  return 5;   // beyond scope — dropped
}

// ── Public API ───────────────────────────────────────────────────
export function retrievePrecedents(newEvent) {
  if (!newEvent) return { precedents: [], config: CFG };
  const { vec: newVec, fields: newFields } = computeFeatureVector(newEvent);
  const records = allRecords().filter(r => r.eventId !== newEvent.id);

  // Score every candidate, drop tier-5 (beyond scope).
  const scored = [];
  for (const r of records) {
    const tier = _spatialTier(newEvent, newFields, r);
    if (tier > 4) continue;
    const cosine = _cosine(newVec, r.featureVector);
    const recency = _recencyWeight(r.closedAt);
    const weighted = cosine * recency;
    scored.push({
      record: r,
      tier,
      cosine: Number(cosine.toFixed(3)),
      recency,
      weighted: Number(weighted.toFixed(3)),
    });
  }

  // Sort by weighted score descending, tier ascending as tiebreaker
  // (lower tier = more relevant when weighted scores tie).
  scored.sort((a, b) => (b.weighted - a.weighted) || (a.tier - b.tier));

  // Apply threshold + top-K + token budget in order.
  const above = scored.filter(s => s.weighted >= CFG.MIN_SIMILARITY);
  const trimmed = above.slice(0, CFG.MAX_PRECEDENTS);
  const withinBudget = [];
  let tokenBudget = CFG.MAX_TOTAL_TOKENS;
  for (const s of trimmed) {
    if (tokenBudget < CFG.TOKENS_PER_PRECEDENT) break;
    withinBudget.push(s);
    tokenBudget -= CFG.TOKENS_PER_PRECEDENT;
  }

  return {
    precedents: withinBudget,
    considered: scored.length,
    aboveThreshold: above.length,
    config: CFG,
  };
}

// ── Prompt-block formatter ───────────────────────────────────────
// Detection-only stance is enforced in the trailing sentences. Agent
// B must NOT extrapolate action from precedent outcomes.
export function formatPrecedentBlock(result) {
  if (!result || !Array.isArray(result.precedents) || result.precedents.length === 0) {
    return null;
  }
  const lines = ['PRIOR SIMILAR EVENTS AT THIS SITE', '─────────────────────────────────'];
  result.precedents.forEach((p, i) => {
    const daysAgo = Math.round((Date.now() - new Date(p.record.closedAt).getTime()) / (1000 * 60 * 60 * 24));
    const tierNote = p.tier === 1 ? ' [same site + same asset targeted]'
                   : p.tier === 2 ? ' [same site]'
                   : p.tier === 3 ? ' [same operator, different site]'
                   : ' [different tenant, same platform family]';
    lines.push(`${i + 1}. ${p.record.eventId} — ${daysAgo} days ago — similarity ${p.weighted.toFixed(2)}${tierNote}`);
    lines.push(`   ${p.record.summary}`);
  });
  lines.push('');
  lines.push('Use these as contextual reference only. Do NOT extrapolate or recommend action based on prior outcomes. Highlight pattern similarity only if it clearly exists in the current event\'s signals.');
  return lines.join('\n');
}

// ── Convenience: retrieve + format in one call ───────────────────
export function buildPrecedentBlock(newEvent) {
  const result = retrievePrecedents(newEvent);
  return {
    ...result,
    formatted_block: formatPrecedentBlock(result),
  };
}
