// Agent A2 — Highlight Ranker (FALLBACK path only)
//
// Fires only for sites that have NOT declared highlights[] in
// site_context.js. Consumes the deterministic Highlight Scorer's
// candidates + Agent A's site digest, and picks the final rank order
// with a one-sentence rationale per pick.
//
// Cached in localStorage keyed on (siteId, siteVersionStamp,
// candidateHash) so it never re-fires for the same input. When a site
// eventually declares its own highlights[], this agent becomes dead
// code for that site — always preferred over the fallback path.
//
// See docs/agentic-preprocessing-architecture.md §3.

import {
  streamCompletion,
  isMistralConfigured,
  siteVersionStamp,
  hashContent,
  WRITING_RULES,
} from '../mistral_client.js';
import { lruWrite, lruRead, lruRemove } from '../preprocessing.js';

const CACHE_KEY_PREFIX = 'isr:agentA2:highlights:';
const A2_VERSION = 1;

function _cacheKey(siteId) { return `${CACHE_KEY_PREFIX}${siteId}`; }

function _cacheStamp(siteId, ctx, candidates) {
  return `${A2_VERSION}:${siteVersionStamp(siteId, ctx)}:${hashContent(candidates)}`;
}

function _read(siteId, ctx, candidates) {
  const raw = lruRead(_cacheKey(siteId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.stamp !== _cacheStamp(siteId, ctx, candidates)) return null;
    return parsed.highlights || null;
  } catch (_) { return null; }
}

function _write(siteId, ctx, candidates, highlights) {
  lruWrite(_cacheKey(siteId), JSON.stringify({
    stamp: _cacheStamp(siteId, ctx, candidates),
    generatedAt: new Date().toISOString(),
    highlights,
  }));
}

export function invalidateFallbackHighlights(siteId) {
  lruRemove(_cacheKey(siteId));
}

// Given the deterministic scorer's candidate list + Agent A digest,
// ask Mistral to rank them and produce a one-sentence rationale per
// pick. Returns the merged final highlights[] with rationale filled,
// or the raw candidates unchanged if Mistral is unavailable.
export async function fallbackRankHighlights(siteId, ctx, candidates, digest) {
  if (!candidates?.length) return [];
  const cached = _read(siteId, ctx, candidates);
  if (cached) return cached;
  if (!isMistralConfigured()) return candidates;   // deterministic-only fallback

  const systemPrompt = [
    'You are an intelligence analyst. Given a site context digest and a candidate list of assets ranked by deterministic scoring, produce the final rank-ordered highlight list for post-event narrative focus at this site.',
    '',
    'Rules:',
    '- Rank ALL candidates provided. Do not drop any.',
    '- One sentence of rationale per pick, grounded in the site digest doctrine. No hedging.',
    '- Priority is 1 for highest, increment for each subsequent.',
    '',
    '- ' + WRITING_RULES,
    '',
    'Return STRICT JSON only, no other text. Shape:',
    '{"highlights": [{"asset_id": "...", "priority": 1, "rationale": "..."}]}',
  ].join('\n');

  const userPrompt = [
    `Site ID: ${siteId}`,
    `Site name: ${ctx.name || siteId}`,
    '',
    'SITE INTELLIGENCE DIGEST',
    '─────────────────────────',
    digest || '(no digest available)',
    '',
    'DETERMINISTIC SCORER CANDIDATES (JSON, already sorted by base_score desc)',
    '─────────────────────────────────────────────',
    JSON.stringify(candidates.map(c => ({
      asset_id: c.asset_id, name: c.name, cat: c.cat,
      criticality: c.criticality, reason: c.reason || null,
    })), null, 2),
    '',
    'Produce the final rank + rationale list per the rules above.',
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const raw = await new Promise((resolve) => {
    let full = '';
    streamCompletion(messages, {
      onDelta: (d) => { full += d; },
      onDone:  () => resolve(full),
      onError: () => resolve(''),
    }, { maxTokens: 800, temperature: 0.1 });
  });

  if (!raw?.trim()) return candidates;

  // Extract JSON from the response (models sometimes wrap in prose or
  // ```json fences despite instructions). Regex + JSON.parse with
  // graceful degradation to raw candidates on parse failure.
  let parsed = null;
  try {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = fenceMatch ? fenceMatch[1] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    parsed = JSON.parse(jsonStr);
  } catch (_) { return candidates; }

  const modelPicks = parsed?.highlights;
  if (!Array.isArray(modelPicks) || !modelPicks.length) return candidates;

  // Merge model picks (asset_id + priority + rationale) back into
  // candidate metadata (name, cat, pos, criticality). Any candidate
  // the model dropped is appended at the end with default priority.
  const byId = new Map(candidates.map(c => [c.asset_id, c]));
  const merged = [];
  const seen = new Set();
  for (const pick of modelPicks) {
    const c = byId.get(pick.asset_id);
    if (!c) continue;
    merged.push({
      ...c,
      priority: typeof pick.priority === 'number' ? pick.priority : merged.length + 1,
      rationale: (pick.rationale || '').trim(),
      source: 'fallback-a2-ranked',
    });
    seen.add(pick.asset_id);
  }
  for (const c of candidates) {
    if (!seen.has(c.asset_id)) {
      merged.push({ ...c, priority: 999, rationale: '', source: 'fallback-a2-unranked' });
    }
  }
  merged.sort((a, b) => a.priority - b.priority);

  _write(siteId, ctx, candidates, merged);
  return merged;
}
