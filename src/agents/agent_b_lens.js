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
// platform. Extended per-archetype below via LENS_ARCHETYPE_DIRECTIVES.
const LENS_WRITING_RULES = [
  'Write in ENGLISH. Only use Danish characters (æ ø å) for proper nouns.',
  'Declarative voice. No hedging phrases like "may" or "could indicate".',
  'No em-dashes. No semicolons. No filler words like "furthermore" or "moreover".',
  'Do not use markdown. No bold, italic, headers, or bullets.',
  'You are REFRAMING an existing narrative. Do NOT introduce facts, entities, or claims absent from the base narrative below. If the base does not mention casualties, do not invent them. If the base does not name a suspect, do not name one.',
  'Length must match the base narrative approximately. Do not double it. A reframing is a rewording, not an expansion.',
  'Never speculate on classified fields. Do not name PET / FE operational methods, base coordinates marked restricted, NATO compartments, or foreign-actor TTPs even if the base narrative alludes to them. If a fact is redacted in the base, leave it redacted.',
];

// Per-archetype directives. Each directive is a short "system message
// tail" that tells the model:
//   (1) LEAD — which facts of the base narrative to open with
//   (2) VOCABULARY — which words + phrasing bucket this receiver
//       expects (e.g. medical uses "triage priority" not "response
//       tier"; kinetic uses "engagement envelope" not "situation")
//   (3) OMIT — which facts of the base to de-emphasise (a hospital
//       doesn't need to hear the RF signature; a police tactical
//       unit doesn't need the compliance ramifications)
//   (4) KEY_TERMS — an example of the anchor-noun list the reco slot
//       should carry (so the composer can render them as a badge row)
//
// Data availability varies. Some archetypes (kinetic, coordination,
// forensic, intel, regulatory) have rich underlying context that
// Agent B's base narrative already surfaces, so their lenses can
// lean confident. Medical + public-safety currently have data gaps
// (no hospital bed capacity, no kommune population/shelter data)
// so their directives stay honestly generic — the "reframing" is
// vocabulary + emphasis, not deep receiver-scoped insight, until
// external data lands. See project_medical_public_safety_data_gap
// in memory for the roadmap on filling those gaps.
const LENS_ARCHETYPE_DIRECTIVES = {

  'kinetic-response': [
    'LEAD with the threat state, dispatchable-asset relevance, and engagement envelope. Frame the incident as a tactical picture: what is airborne, where is it going, what response has been ordered, what remains open.',
    'VOCABULARY: engagement envelope, dispatchable asset, cordon, intercept vector, ROE, standoff, terminal phase, denial, seizure.',
    'OMIT compliance framing, hospital load, public messaging tone — a kinetic-response receiver needs to make a dispatch call, not draft a press release.',
    'KEY_TERMS example: "engagement envelope, cordon, intercept vector, denial"',
  ].join(' '),

  'coordination-command': [
    'LEAD with the cross-agency picture: which contributors are engaged, which are pending, which escalation tier the event sits at, and what national-tier decisions are outstanding.',
    'VOCABULARY: escalation tier, SITREP, precedence, contributor status, resource allocation, briefing threshold, national response.',
    'OMIT tactical-envelope detail (that is for kinetic receivers) and forensic chain-of-custody detail (that is for forensic receivers). Coordination cares about who owns what next, not how the intercept was flown.',
    'KEY_TERMS example: "escalation tier, contributor status, resource allocation, briefing threshold"',
  ].join(' '),

  'intelligence-attribution': [
    'LEAD with the attribution picture: platform class, signature indicators, operator tradecraft cues, temporal pattern relative to prior events at this or adjacent sites, and any state-actor signature the base narrative already noted.',
    'VOCABULARY: attribution, tradecraft, signature, tasking, tempo, pattern-of-life, precedent, operator profile, control-link.',
    'OMIT tactical engagement details and public-safety impact — intelligence cares about who and why, not how the response was executed.',
    'CRITICAL: If the base narrative marked a fact as classified or redacted (state-actor speculation, cleared compartments, foreign methods), keep the redaction. Do NOT infer beyond what the base explicitly asserts.',
    'KEY_TERMS example: "attribution, tradecraft, tasking, pattern-of-life, control-link"',
  ].join(' '),

  'forensic-cyber': [
    'LEAD with the evidence surface: what artifacts exist (recovered airframe, RF captures, sensor logs, control-link intercepts), chain-of-custody state, and the analysis handoff most relevant to a cyber-forensic reader.',
    'VOCABULARY: evidence, artifact, chain of custody, IoC, control-link forensics, RF capture, malware indicator, digital forensics, sandbox, admissibility.',
    'OMIT medical impact and public messaging. Forensic reads for what can be recovered and preserved.',
    'KEY_TERMS example: "artifact, chain of custody, control-link forensics, admissibility"',
  ].join(' '),

  'medical-consequence': [
    'LEAD with casualty exposure risk if the base narrative supports it: proximity to populated areas, altitude and speed profile, payload category if named, blast or debris radius if inferrable from the base without invention.',
    'VOCABULARY: casualty risk, exposure vector, triage priority, hospital-load impact, decontamination window, mass-casualty threshold.',
    'OMIT tactical and forensic detail. Medical readers need to know: is there a triage call to make, when do I make it, what is the likely case load.',
    'DATA GAP: This platform does not yet carry hospital bed capacity or ambulance fleet manifests, so avoid asserting specific facility capacities. Frame in categorical language ("elevated casualty risk", "trauma-relevant profile") rather than numeric.',
    'KEY_TERMS example: "casualty risk, exposure vector, triage priority, mass-casualty threshold"',
  ].join(' '),

  'regulatory-advisory': [
    'LEAD with the compliance and airspace / maritime / energy authority implications: NOTAM necessity and duration, restriction radius, coordination with the operating authority (Trafikstyrelsen for aviation, Søfartsstyrelsen for maritime, Energistyrelsen for energy).',
    'VOCABULARY: NOTAM, airspace restriction, class-D controlled, coordination requirement, compliance threshold, regulator escalation, temporary flight restriction.',
    'OMIT tactical response detail. A regulatory receiver decides on restrictions and compliance framing, not intercepts.',
    'KEY_TERMS example: "NOTAM, airspace restriction, coordination requirement, temporary flight restriction"',
  ].join(' '),

  'public-safety-communication': [
    'LEAD with the affected-population picture: proximity to residential areas, schools, transit hubs, commercial centres named in the base narrative. Message-window language for a kommune crisis staff or 1-1-2 alarm central.',
    'VOCABULARY: affected population, shelter window, evacuation zone, public-messaging tone, incident tempo, community-safety threshold, kommune coordination.',
    'OMIT tactical engagement detail and forensic detail. Public-safety readers need to know what to tell residents and when.',
    'DATA GAP: This platform does not yet carry kommune population totals, shelter capacity, or evacuation route data, so avoid asserting specific numbers or routes. Frame in categorical language ("dense-residential adjacency", "elevated public-safety concern") until that data lands.',
    'KEY_TERMS example: "affected population, shelter window, public-messaging tone, kommune coordination"',
  ].join(' '),

  'international-liaison': [
    'LEAD with cross-border and allied-notification implications: origin-of-flight if traced across border, standing information-sharing pathways (NATO, Nordic, EU, Europol), and any tier-5 destinations the base narrative already implicates.',
    'VOCABULARY: cross-border, allied notification, information-sharing pathway, standing coordination, partner briefing, cooperative response.',
    'OMIT tactical engagement detail. Liaison readers relay and coordinate, they do not intercept.',
    'CRITICAL: Never name NATO compartments, allied classified sharing agreements, or specific bilateral MOUs. If the base narrative did not name them, they stay unnamed.',
    'KEY_TERMS example: "cross-border, allied notification, standing coordination, partner briefing"',
  ].join(' '),
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
