// Agent B Lens — Receiver-shaped narrative reframing
//
// The lens agent takes the finalized Agent B debrief narrative (facts,
// timeline, subject) and rewrites it for a specific receiver archetype
// so the emphasis matches how that receiver actually consumes the
// event: PET reads for attribution + tradecraft, hospitals read for
// casualty risk + capacity, kommuner read for public-safety framing,
// defense reads for engagement + escalation ladders.
//
// Design constraints:
// - Facts stay stable. The lens rewords + reframes; it does not
//   introduce entities absent from the base narrative.
// - Per ARCHETYPE, not per receiver — 8 lenses cover all 386 receivers.
// - Lazy: fires only on case-file panel open for a role in that archetype.
// - Cacheable: keyed by (base narrative hash × archetype).
// - Falls back to the base narrative unchanged on validation failure.
// - Detection-only: reads event data, never dispatches.
//
// Wire contract: docs/agentic-architecture.md §Receiver-lens layer.

import {
  isMistralConfigured,
  streamCompletionValidated,
} from '../mistral_client.js';
import { lruWrite, lruRead, lruRemove } from '../preprocessing.js';

// Human-readable archetype labels — used in the user prompt so the
// model has the receiver's identity in plain language, not the
// underscore-slug internal id. Mirrors ARCHETYPE_LABELS in
// src/archetypes.js but duplicated here to avoid a circular import
// (archetypes.js may import from events.js in the future).
const ARCHETYPE_LABELS = {
  'kinetic-response':               'kinetic-response (defense / police tactical)',
  'coordination-command':           'coordination-command (national HQ / cross-agency dispatch)',
  'intelligence-attribution':       'intelligence-attribution (PET / FE / signals analysis)',
  'forensic-cyber':                 'forensic-cyber (digital forensics / evidence chain)',
  'medical-consequence':            'medical-consequence (regions / hospitals / triage)',
  'regulatory-advisory':            'regulatory-advisory (aviation / maritime / energy authorities)',
  'public-safety-communication':    'public-safety-communication (kommune / municipal crisis staff)',
  'international-liaison':          'international-liaison (NATO / EU / Nordic partners)',
};

// Base writing rules — must match the ISR voice everywhere else in the
// platform. Extended per-archetype in Step 3 (LENS_ARCHETYPE_DIRECTIVES
// carries the archetype-specific system message additions).
const LENS_WRITING_RULES = [
  'Write in ENGLISH. Only use Danish characters (æ ø å) for proper nouns.',
  'Declarative voice. No hedging phrases like "may" or "could indicate".',
  'No em-dashes. No semicolons. No filler words like "furthermore" or "moreover".',
  'Do not use markdown. No bold, italic, headers, or bullets.',
  'You are REFRAMING an existing narrative. Do NOT introduce facts, entities, or claims absent from the base narrative below. If the base does not mention casualties, do not invent them. If the base does not name a suspect, do not name one.',
  'Length must match the base narrative approximately. Do not double it. A reframing is a rewording, not an expansion.',
];

// Placeholder per-archetype directives. Step 3 replaces these with the
// full archetype-tuned system messages (which facts to lead with,
// which vocabulary to prefer, how to signal urgency). For Step 2 the
// placeholders let us ship the module end-to-end.
const LENS_ARCHETYPE_DIRECTIVES = {
  'kinetic-response':               'Reframe for a kinetic-response receiver. Lead with dispatchable-asset relevance and engagement envelope. Keep restraint proportional to actual threat state.',
  'coordination-command':           'Reframe for a coordination-command receiver. Lead with cross-agency routing implications and escalation-ladder state.',
  'intelligence-attribution':       'Reframe for an intelligence-attribution receiver. Lead with actor, tradecraft, tempo, tasking indicators. Signature-attribution vocabulary.',
  'forensic-cyber':                 'Reframe for a forensic-cyber receiver. Lead with evidence chain, digital indicators, post-incident analysis handoff.',
  'medical-consequence':            'Reframe for a medical-consequence receiver. Lead with casualty exposure vector, triage priority, hospital-load impact.',
  'regulatory-advisory':            'Reframe for a regulatory-advisory receiver. Lead with airspace / maritime / energy compliance implications, NOTAM authority, restriction duration.',
  'public-safety-communication':    'Reframe for a public-safety-communication receiver. Lead with affected population, shelter window, message half-life, public-messaging vocabulary.',
  'international-liaison':          'Reframe for an international-liaison receiver. Lead with cross-border implications, information-sharing pathways, allied-notification tempo.',
};

// Validator caps. A lens is a REFRAMING, not an expansion — cap
// slightly tighter than the base narrative so the model can't drift
// into new territory. Reco slot carries a short comma-separated list
// of key_terms (nouns that anchor the archetype's read) rather than
// a full sentence, so its cap is smaller too.
const _LENS_CAPS = { body: 1400, reco: 200 };

// Fallback shape — base narrative unchanged. Used when Mistral is
// down, two consecutive validations fail, or the caller is offline.
// The model_version suffix '-lens-fallback-<archetype>' surfaces the
// substitution in the audit trail so silent degradation is visible.
function _lensFallback(event, archetype) {
  const base = event?.narrativeCache?.body || 'No base narrative available.';
  return {
    body: base,
    recommendation: '',
  };
}

// Build the message array for the lens call. System prompt = base
// writing rules + archetype directive. User prompt = the base
// narrative + the reframe ask.
function buildLensMessages(event, archetype) {
  const label = ARCHETYPE_LABELS[archetype] || archetype;
  const directive = LENS_ARCHETYPE_DIRECTIVES[archetype] || `Reframe for a ${label} receiver.`;
  const systemPrompt = [
    'You are an ISR platform narrative agent. You reframe existing incident narratives for specific receiver archetypes without changing the facts.',
    '',
    'WRITING RULES:',
    ...LENS_WRITING_RULES.map(r => '- ' + r),
    '',
    'ARCHETYPE DIRECTIVE:',
    '- ' + directive,
    '',
    'OUTPUT FORMAT: reframed narrative body, then a delimiter line "===RECO===", then a short comma-separated list of key_terms (nouns that anchor this archetype\'s read of the incident). Example key_terms: "attribution, tradecraft, signals". Do not exceed the length of the base narrative.',
  ].join('\n');

  const baseBody = event?.narrativeCache?.body || '';
  const userPrompt = [
    'BASE NARRATIVE:',
    baseBody,
    '',
    `Reframe this narrative for a ${label} receiver. Preserve every fact. Change emphasis, vocabulary, and lead only.`,
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];
}

// ─────────────────────────────────────────────────────────────
// Lens cache persistence — keyed by eventId, startTime AND archetype
// so lenses for the same event but different archetypes don't
// collide, and stale eventId reuse (DET-YYYYMMDD-NNNN reset on page
// reload) can't surface a yesterday lens on today's event.
// ─────────────────────────────────────────────────────────────

function _lensKey(eventId, startTime, archetype) {
  return `isr:narrativeLens:${eventId}:${startTime}:${archetype}`;
}

export function writeLens(event, archetype, lensObj) {
  if (!event?.id || !archetype || !lensObj) return;
  try {
    lruWrite(_lensKey(event.id, event.startTime, archetype), JSON.stringify(lensObj));
  } catch (_) { /* localStorage quota — silently skip */ }
}

export function readLens(event, archetype) {
  if (!event?.id || !archetype) return null;
  const raw = lruRead(_lensKey(event.id, event.startTime, archetype));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

export function invalidateLens(event, archetype = null) {
  if (!event?.id) return;
  if (archetype) {
    lruRemove(_lensKey(event.id, event.startTime, archetype));
  } else {
    // Drop every archetype variant for this event. Cheaper than
    // enumerating all 8; LRU handles the sweep.
    Object.keys(LENS_ARCHETYPE_DIRECTIVES).forEach(a => {
      lruRemove(_lensKey(event.id, event.startTime, a));
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Public streamer — the main entry point for the lens agent.
//
// streamNarrativeLens(event, archetype, callbacks, opts)
//   event       — full event record (must have .narrativeCache.body set)
//   archetype   — one of the 8 ARCHETYPES keys
//   callbacks   — { onToken, onDone, onError } same shape as Agent B
//   opts        — { maxTokens, forceRegenerate }
//
// If Mistral isn't configured, fires onError immediately (caller
// should render the fallback). If narrativeCache.body is empty, same.
// Returns nothing — output flows through the callback API.
// ─────────────────────────────────────────────────────────────
export function streamNarrativeLens(event, archetype, callbacks, opts = {}) {
  if (!isMistralConfigured()) {
    callbacks.onError?.(new Error('Mistral not configured'));
    return;
  }
  if (!event?.narrativeCache?.body) {
    callbacks.onError?.(new Error('No base narrative — lens requires a completed Agent B run'));
    return;
  }
  if (!LENS_ARCHETYPE_DIRECTIVES[archetype]) {
    callbacks.onError?.(new Error(`Unknown archetype: ${archetype}`));
    return;
  }

  const messages = buildLensMessages(event, archetype);
  const maxTokens = opts.maxTokens ?? 800;

  streamCompletionValidated(messages, callbacks, {
    maxTokens,
    validationRules: {
      maxBodyChars: _LENS_CAPS.body,
      maxRecoChars: _LENS_CAPS.reco,
      requireDelimiter: true,
      bannedFillerWords: true,
      bannedEmDash: true,
      bannedSemicolon: true,
    },
    fallback: _lensFallback(event, archetype),
  });
}

// Exported for test hooks + downstream consumers that want to enumerate
// the archetype set without importing archetypes.js.
export function knownArchetypes() {
  return Object.keys(LENS_ARCHETYPE_DIRECTIVES);
}
