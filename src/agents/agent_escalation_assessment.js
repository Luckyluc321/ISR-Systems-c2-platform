// ═══════════════════════════════════════════════════════════════════
// The situation section of an escalation brief
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-26, on the Detection Brief an escalation sends: it
// listed the F-35s at Skrydstrup, military helicopters, police units and
// emergency services for every detection, a recon swarm included, under
// a "Recommended Action" that told the recipients to dispatch. Three
// rulings:
//
//   "It should address the situation."
//   "If we're looking at an invasion then yes these options should be
//    rendered, but the agent should decide such. It should never ever
//    happen at a recon swarm."
//   "We are the messenger, not the decision maker."
//
// So this agent writes the brief's situation section from MEASURED facts
// (the same discipline as agent_detection_line.js) and makes one
// judgement: whether the facts show a state attack on Denmark. Only then
// does the brief carry the response asset tables, as reference for the
// authorities. It never recommends anything: the authorities decide.
// ASSESSED tier (docs/agent-panel-provenance.md).
//
// WHEN IT ASKS. When the operator opens the escalate modal, and again
// only if the stored assessment is older than ASSESS_CFG.MAX_AGE_MS. One
// call per escalation, not a loop.
//
// WHEN IT CANNOT. No key, an error, or an answer that does not parse: no
// assessment. The brief carries the measured facts and no asset tables.
// The safe default is the one that never puts fighter jets on a recon
// swarm's brief.
//
// Pure apart from the transport and the writer, both injected.
// ═══════════════════════════════════════════════════════════════════

import { bareType, holdingSensors } from './agent_detection_line.js';

export const ASSESS_CFG = {
  MAX_AGE_MS: 60000,
  MAX_WORDS: 70,
  MAX_CHARS: 480,
  MAX_TOKENS: 240,
};

export const SYSTEM_PROMPT = [
  'You write the situation section of a drone detection brief. A site operator sends the brief to Danish authorities.',
  'ISR Systems is the messenger. The authorities decide the response. You describe the situation. You never decide or advise.',
  'Return strict JSON and nothing else, in this shape: {"situation": "...", "state_attack": false}',
  'situation: two or three sentences, at most 60 words, in English. What is in the air, where it is relative to the site, how it is moving, and how firmly the sensors hold it.',
  'state_attack: true only when the facts show an armed attack on Denmark by a state, such as a missile or several weapon-class aircraft inbound. A reconnaissance flight, a single drone, or a drone swarm observing or crossing a site is never a state attack. When in doubt, false.',
  'Rules for the situation text:',
  '- Use only the facts given. Never invent sensors, places, numbers, origins or causes.',
  '- Do not recommend, advise or suggest any action, unit, tier or authority.',
  '- Do not state intent or purpose. Do not name or guess the airframe beyond the type given.',
  '- No em-dashes, no semicolons, no markdown, no quotation marks inside the text.',
].join('\n');

const _state = new Map();   // eventId -> { inflight }
let _authParked = false;

/** Measured facts only. ctx carries what the event record does not. */
export function assessmentFacts(event, ctx = {}) {
  const p = event?.lastPosition || {};
  const holding = holdingSensors(event);
  const facts = {
    site: ctx.siteName || event?.siteId || null,
    site_kind: ctx.siteKind || null,
    type_reported_by_detector: bareType(event?.droneType),
    classification: event?.classification || null,
    threat_level: event?.threat || null,
    platform: event?.platform || null,
    platform_category: event?.subject?.category || null,
    weapon_class_signature: event?.subject?.threat_profile?.weaponized_signature === true,
    airframes_in_track: typeof event?.droneCount === 'number' ? event.droneCount : 1,
    confidence_now: typeof event?.confidence === 'number' ? +event.confidence.toFixed(2) : null,
    sensors_holding: holding.length,
  };
  if (typeof p.alt === 'number') facts.altitude_m = Math.round(p.alt);
  if (typeof p.speed === 'number') facts.speed_m_s = +p.speed.toFixed(1);
  if (typeof p.heading === 'number') facts.heading_deg = Math.round(p.heading);
  if (typeof p.rangeToPerim === 'number') {
    facts.inside_site_perimeter = p.rangeToPerim <= 0;
    if (p.rangeToPerim > 0) facts.distance_to_perimeter_m = Math.round(p.rangeToPerim);
  }
  if (typeof ctx.heldSeconds === 'number' && ctx.heldSeconds >= 0) facts.seconds_held = ctx.heldSeconds;
  return facts;
}

/** The situation text, cleaned of what the rules forbid. */
export function cleanSituation(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.replace(/[\r\n]+/g, ' ').replace(/[*_`#>"“”]/g, '')
    .replace(/\s*[—–]\s*/g, ', ').replace(/;/g, ',').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const words = t.split(' ');
  if (words.length > ASSESS_CFG.MAX_WORDS) t = words.slice(0, ASSESS_CFG.MAX_WORDS).join(' ');
  if (t.length > ASSESS_CFG.MAX_CHARS) t = t.slice(0, ASSESS_CFG.MAX_CHARS);
  // End on a whole sentence when one fits, otherwise close the fragment.
  if (!/[.!?]$/.test(t)) {
    const cut = t.search(/[.!?][^.!?]*$/);
    t = cut > 20 ? t.slice(0, cut + 1) : t.replace(/[,\s]+$/, '') + '.';
  }
  return t.length >= 12 ? t : null;
}

/** { situation, stateAttack } from the model's reply, or null. Only an
 *  explicit true counts as a state attack. */
export function parseAssessment(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch (_) { return null; }
  const situation = cleanSituation(o?.situation);
  if (!situation) return null;
  return { situation, stateAttack: o.state_attack === true };
}

/** Whether the brief carries the response asset tables. */
export function showResponseAssets(event) {
  return event?.escalationAssessment?.stateAttack === true;
}

/** For a tooltip or a provenance line: a model reading, which model, when. */
export function assessmentTitle(event) {
  const a = event?.escalationAssessment;
  if (!a?.situation) return '';
  const at = typeof a.at === 'string' ? a.at.slice(11, 19) + 'Z' : '';
  return `Model reading · ${a.model || 'unknown model'}${at ? ` · ${at}` : ''}`;
}

/**
 * Ask for an assessment if there is none, or it is stale. Fire and forget.
 *
 * @param ctx.write      (eventId, assessment|null) => void
 * @param ctx.transport  { configured(), stream(messages, cb, opts), model() }
 * @param ctx.siteName, ctx.siteKind, ctx.heldSeconds  for the facts
 * @param ctx.nowMs      injected clock, default Date.now()
 * @returns true if a request went out
 */
export function maybeRequestEscalationAssessment(event, ctx) {
  if (_authParked || !event?.id || !ctx?.transport || !ctx.transport.configured()) return false;
  const nowMs = ctx.nowMs ?? Date.now();
  let st = _state.get(event.id);
  if (!st) { st = { inflight: false }; _state.set(event.id, st); }
  if (st.inflight) return false;
  const have = event.escalationAssessment;
  if (have?.at && nowMs - Date.parse(have.at) < ASSESS_CFG.MAX_AGE_MS) return false;
  st.inflight = true;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Measured facts:\n${JSON.stringify(assessmentFacts(event, ctx), null, 2)}` },
  ];
  ctx.transport.stream(messages, {
    onDone: (full) => {
      st.inflight = false;
      const a = parseAssessment(full);
      if (!a) console.warn(`[escalation_assessment] ${event.id}: reply did not parse, brief goes out with facts only`);
      ctx.write(event.id, a ? { ...a, at: new Date(nowMs).toISOString(), model: ctx.transport.model() } : null);
    },
    onError: (err) => {
      st.inflight = false;
      // Absent, never stale (agent-panel-provenance.md).
      ctx.write(event.id, null);
      if (/HTTP 40[13]/.test(err?.message || '')) {
        _authParked = true;
        console.warn('[escalation_assessment] inference not authorised, parked for this session. Run await __isr_inferenceCheck() for the cause.');
        return;
      }
      console.warn(`[escalation_assessment] ${event.id}: no assessment from the model (${err?.message || err})`);
    },
  }, { temperature: 0.1, maxTokens: ASSESS_CFG.MAX_TOKENS, timeoutMs: 20000 });
  return true;
}

/** Test seam. */
export function _resetEscalationAssessmentState() { _state.clear(); _authParked = false; }
