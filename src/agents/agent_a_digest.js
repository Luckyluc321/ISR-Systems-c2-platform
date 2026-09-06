// Agent A — Site-Context Digest
//
// Offline generator. Reads the full site_context.js record for a site
// (critical areas, high-value assets, response postures, aircraft of
// interest, coordination doctrine) and asks Mistral to compress it into
// a ~200-word intelligence brief that Agent B injects as prompt context
// when debriefing an event at that site.
//
// Cached per (siteId, contextHash) in localStorage so the same digest
// is re-used across every event at that site. Regenerates automatically
// when the underlying site_context payload changes (hash mismatch),
// otherwise never re-runs.
//
// See docs/agentic-preprocessing-architecture.md §2 and memory:
// project_agentic_summary_strategy for the two-agent design.

import {
  streamCompletion,
  isMistralConfigured,
  WRITING_RULES,
  siteVersionStamp,
} from '../mistral_client.js';
import { lruWrite, lruRead, lruRemove } from '../preprocessing.js';

const DIGEST_CACHE_KEY_PREFIX = 'isr:agentA:digest:';
const DIGEST_VERSION = 1;   // bump to force-regenerate every cached digest

function _cacheKey(siteId) {
  return `${DIGEST_CACHE_KEY_PREFIX}${siteId}`;
}

// Route through the FIX-7 central stamp helper. Ensures a config edit
// to site_context.js invalidates the Agent A digest cache on the same
// signal that invalidates every other downstream cache (baseline
// stats, Agent A2 fallback, etc.) — single source of truth.
function _hashCtx(siteId, ctx) {
  return `${DIGEST_VERSION}:${siteVersionStamp(siteId, ctx)}`;
}

export function readCachedSiteDigest(siteId, ctx) {
  const raw = lruRead(_cacheKey(siteId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.hash !== _hashCtx(siteId, ctx)) return null;
    return parsed.digest || null;
  } catch (_) { return null; }
}

function _writeCachedSiteDigest(siteId, ctx, digest) {
  lruWrite(_cacheKey(siteId), JSON.stringify({
    hash: _hashCtx(siteId, ctx),
    generatedAt: new Date().toISOString(),
    digest,
  }));
}

// Public: get-or-generate. Cache hit → returns instantly. Cache miss →
// streams a Mistral call, writes to cache, resolves with the digest.
// Callers should await this once at boot (or on-demand) so subsequent
// Agent B debriefs read the cached string.
export async function ensureSiteContextDigest(siteId, ctx) {
  if (!ctx) return null;
  const cached = readCachedSiteDigest(siteId, ctx);
  if (cached) return cached;
  if (!isMistralConfigured()) return null;

  const systemPrompt = [
    'You are an intelligence analyst producing a persistent SITE INTELLIGENCE BRIEF for a Danish critical-infrastructure site. The brief will be injected as background context into every post-event debrief at this site, so it must generalise across events, not describe any single incident.',
    '',
    'Cover:',
    '- The site type and what it protects (one sentence).',
    '- The 2-4 most critical assets by name, and WHY each matters operationally (not just "important").',
    '- The doctrine that governs response here (who acts, what triggers a dispatch, coordination pattern).',
    '- Behaviours that would read as red flags at this specific site (e.g. "dwell over the fuel farm reads as targeting" vs "dwell over the taxiway reads as reconnaissance").',
    '',
    'Writing rules:',
    '- ' + WRITING_RULES,
    '',
    'Output the brief as plain prose. No headers, no bullets, no delimiters. Under 300 words.',
  ].join('\n');

  const userPrompt = [
    `Site ID: ${siteId}`,
    `Site name: ${ctx.name || siteId}`,
    `Site type: ${ctx.site_type || 'unknown'}`,
    '',
    'FULL SITE CONTEXT RECORD (JSON)',
    '─────────────────────────────────',
    JSON.stringify(ctx, null, 2).slice(0, 12000),
    '',
    'Produce the persistent site intelligence brief using the rules above.',
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  return new Promise((resolve) => {
    let full = '';
    streamCompletion(messages, {
      onDelta: (d) => { full += d; },
      onDone: () => {
        const digest = full.trim();
        if (digest) _writeCachedSiteDigest(siteId, ctx, digest);
        resolve(digest || null);
      },
      onError: () => resolve(null),
    }, { maxTokens: 500 });
  });
}

// Test / demo hook — wipes a specific site's cached digest so the next
// call to ensureSiteContextDigest re-runs Mistral. Useful when a
// site_context record was updated and you want to force a refresh
// without waiting for the hash change to propagate through a page load.
// Also used by the debrief regenerate button.
export function invalidateSiteContextDigest(siteId) {
  lruRemove(_cacheKey(siteId));
}
