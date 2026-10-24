// ═══════════════════════════════════════════════════════════════════
// The detection line — the sentence beside a detection's confidence
// ───────────────────────────────────────────────────────────────────
// "0.64 · Detected low over the bay, held by the container terminal
// sensors." That sentence used to be written into each scenario as
// `confidenceTrend`, 38 templates plus the historical events and the live
// sensor path. It was an interpretation of the detection, and an
// interpretation is the model's job (Lucas, 2026-10-24: "this needs to
// come from Mistral ALWAYS"). A canned one also went stale: the Aarhus
// line still said "low" after the route moved to 800 m.
//
// So the line comes only from Mistral, and confidenceTrend is no longer
// shown anywhere. The model is given MEASURED facts only (confidence and
// how it has moved, the sensors holding the track, altitude, speed, time
// held) and asked for one short descriptive sentence: no intent, no
// identity beyond the type it was given, no recommendation. ASSESSED tier
// (docs/agent-panel-provenance.md).
//
// WHEN IT ASKS. The first time a track is held, then again only when the
// picture changes (a sensor gained or lost, or the confidence on screen
// moved by LINE_CFG.CONF_STEP), and never more often than MIN_INTERVAL_MS
// per event. Confidence now moves with the sensors, so a held single
// drone costs about three calls a minute; a static one, one call.
//
// WHEN IT CANNOT. No key, an error, or no answer yet: no line. The panel
// shows the number alone. Never a canned sentence standing in for the
// model, which is the thing this replaces.
//
// Pure apart from the transport and the writer, both injected, so the
// gate can drive it without a network or the event store.
// ═══════════════════════════════════════════════════════════════════

export const LINE_CFG = {
  MIN_INTERVAL_MS: 20000,
  CONF_STEP: 0.05,
  MAX_WORDS: 16,
  MAX_CHARS: 120,
  MAX_TOKENS: 60,
};

export const SYSTEM_PROMPT = [
  'You write the one-line status shown beside a drone detection\'s confidence score in a command and control panel.',
  'Describe what the measured data shows about the detection right now: how firmly it is held, by how many sensors, and how that is changing.',
  'Rules:',
  '- One sentence, at most 14 words, in English.',
  '- Use only the facts given. Never invent sensors, places, numbers or causes.',
  '- Do not state intent or purpose, and do not name or guess the airframe beyond the type given.',
  '- Do not recommend any action.',
  '- Do not repeat the confidence number. It is already shown beside your sentence.',
  '- No em-dashes, no semicolons, no quotation marks, no markdown.',
].join('\n');

const _state = new Map();   // eventId -> { first, samples, lastAt, lastKey, inflight, answered, errored }
// A 401 or 403 does not fix itself between two ticks. Parked for the
// session, as the debrief does, so a bad key costs one call, not one per
// event every 20 s. A reload clears it.
let _authParked = false;

function _s(eventId) {
  let s = _state.get(eventId);
  if (!s) { s = { first: null, samples: [], lastAt: 0, lastKey: null, inflight: false, answered: false, errored: false }; _state.set(eventId, s); }
  return s;
}

/** Sensors actually holding the track: online, with a score above zero. */
export function holdingSensors(event) {
  return (event?.contributingSensors || [])
    .filter(c => c && !c.offline && (c.confidence || 0) > 0)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

/** The detector's type without the scenario's own commentary. Some
 *  templates carry judgements in the type string ("(port surveillance
 *  suspected)", "→ Copenhagen approach vector"), which are not detector
 *  output and must not reach the model as if they were. */
export function bareType(t) {
  if (typeof t !== 'string') return null;
  const b = t.replace(/\s*\([^)]*\)/g, '').replace(/\s*→.*$/, '').trim();
  return b || null;
}

/** Measured facts for the prompt. Only what the event record holds.
 *  confidenceShown: the number on screen when it is not event.confidence
 *  (a swarm shows its lead's fused value). heldSeconds: time held since
 *  first detection on the sim clock, when the caller knows it. */
export function detectionFacts(event, { siteName = null, nowMs = Date.now(), first = null, history = [], confidenceShown = null, heldSeconds = null } = {}) {
  const holding = holdingSensors(event);
  const p = event?.lastPosition || {};
  const conf = typeof confidenceShown === 'number' ? confidenceShown
    : (typeof event?.confidence === 'number' ? event.confidence : null);
  const facts = {
    site: siteName || event?.siteId || null,
    type_reported_by_detector: bareType(event?.droneType),
    classification: event?.classification || null,
    confidence_now: conf == null ? null : +conf.toFixed(2),
    sensors_holding: holding.length,
    strongest_sensors: holding.slice(0, 3).map(c => ({ id: c.id, score: +(c.confidence || 0).toFixed(2) })),
  };
  const firstC = first?.c ?? history[0]?.c;
  if (typeof firstC === 'number' && conf != null && (first || history.length >= 2)) {
    facts.confidence_first_seen = +firstC.toFixed(2);
    facts.confidence_change_since_first = +(conf - firstC).toFixed(2);
  }
  if (typeof p.alt === 'number') facts.altitude_m = Math.round(p.alt);
  if (typeof p.speed === 'number') facts.speed_m_s = +p.speed.toFixed(1);
  if (typeof p.heading === 'number') facts.heading_deg = Math.round(p.heading);
  if (typeof heldSeconds === 'number' && heldSeconds >= 0) facts.seconds_held = heldSeconds;
  return facts;
}

/** What has to change before asking again. */
export function changeKey(event, confidenceShown = null) {
  const c = typeof confidenceShown === 'number' ? confidenceShown
    : (typeof event?.confidence === 'number' ? event.confidence : 0);
  return `${holdingSensors(event).length}|${Math.round(c / LINE_CFG.CONF_STEP)}`;
}

/** The decision, separated so the gate can test it without a clock. */
export function shouldAsk(st, key, nowMs) {
  if (st.inflight) return false;
  // Any answer counts, an empty one too: an empty reply used to leave the
  // event unanswered, and it was asked again every 5 s.
  if (!st.answered && !st.errored) return true;
  if (key === st.lastKey) return false;
  return nowMs - st.lastAt >= LINE_CFG.MIN_INTERVAL_MS;
}

/** One clean sentence, or null. Strips what the rules forbid rather than
 *  trusting the model to have followed them. */
export function cleanLine(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.replace(/[\r\n]+/g, ' ').replace(/[*_`#>"“”]/g, '')
    .replace(/\s*[—–]\s*/g, ', ').replace(/;/g, ',').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const words = t.split(' ');
  if (words.length > LINE_CFG.MAX_WORDS) t = words.slice(0, LINE_CFG.MAX_WORDS).join(' ');
  if (t.length > LINE_CFG.MAX_CHARS) t = t.slice(0, LINE_CFG.MAX_CHARS).replace(/\s+\S*$/, '');
  t = t.replace(/[,\s]+$/, '');
  if (!/[.!?]$/.test(t)) t += '.';
  return t.length >= 3 ? t : null;
}

/**
 * Ask for a fresh line if the picture changed. Fire and forget.
 *
 * @param ctx.siteName   for the facts
 * @param ctx.write      (eventId, { text, at, model }) => void, the store
 * @param ctx.transport  { configured(): bool, stream(messages, cb, opts), model() }
 * @param ctx.nowMs      injected clock, default Date.now()
 */
export function maybeRequestDetectionLine(event, ctx) {
  if (_authParked || !event?.id || !ctx?.transport || !ctx.transport.configured()) return false;
  const nowMs = ctx.nowMs ?? Date.now();
  const st = _s(event.id);
  const shown = typeof ctx.confidenceShown === 'number' ? ctx.confidenceShown : event.confidence;
  if (typeof shown === 'number') {
    const sample = { t: nowMs, c: shown };
    if (!st.first) st.first = sample;   // the true first, not the oldest of a window
    st.samples.push(sample);
    if (st.samples.length > 60) st.samples.shift();
  }
  const key = changeKey(event, ctx.confidenceShown);
  if (!shouldAsk(st, key, nowMs)) return false;
  st.inflight = true;
  st.lastAt = nowMs;
  st.lastKey = key;
  const facts = detectionFacts(event, {
    siteName: ctx.siteName, nowMs, first: st.first, history: st.samples,
    confidenceShown: ctx.confidenceShown, heldSeconds: ctx.heldSeconds,
  });
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Measured facts:\n${JSON.stringify(facts, null, 2)}` },
  ];
  ctx.transport.stream(messages, {
    onDone: (full) => {
      st.inflight = false;
      st.answered = true;
      const text = cleanLine(full);
      // An empty answer clears the line rather than leaving an older one
      // beside a picture it no longer describes.
      ctx.write(event.id, text ? { text, at: new Date(nowMs).toISOString(), model: ctx.transport.model() } : null);
    },
    onError: (err) => {
      st.inflight = false;
      // A model reading is absent, never stale (agent-panel-provenance.md).
      ctx.write(event.id, null);
      if (/HTTP 40[13]/.test(err?.message || '')) {
        _authParked = true;
        console.warn('[detection_line] inference not authorised, parked for this session. Run await __isr_inferenceCheck() for the cause.');
        return;
      }
      if (!st.errored) console.warn(`[detection_line] ${event.id}: no line from the model (${err?.message || err})`);
      st.errored = true;
    },
  }, { temperature: 0.2, maxTokens: LINE_CFG.MAX_TOKENS, timeoutMs: 15000 });
  return true;
}

/** For the panel: the model's line with its separator, or nothing. */
export function detectionLineSuffix(event) {
  const t = event?.detectionLine?.text;
  return typeof t === 'string' && t ? ` · ${t}` : '';
}

/** For the panel's tooltip: this is a model reading, and which model. */
export function detectionLineTitle(event) {
  const l = event?.detectionLine;
  if (!l?.text) return '';
  const at = typeof l.at === 'string' ? l.at.slice(11, 19) + 'Z' : '';
  return `Model reading · ${l.model || 'unknown model'}${at ? ` · ${at}` : ''}`;
}

/** True once a 401/403 has parked the line for the session. */
export function isDetectionLineParked() { return _authParked; }

/** Drop per-event state for events no longer active. */
export function pruneDetectionLineState(activeIds) {
  const keep = new Set(activeIds || []);
  for (const id of [..._state.keys()]) if (!keep.has(id)) _state.delete(id);
}

/** Test seam: forget per-event state. */
export function _resetDetectionLineState() { _state.clear(); _authParked = false; }
