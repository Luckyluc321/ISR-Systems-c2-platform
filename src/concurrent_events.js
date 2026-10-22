// ═══════════════════════════════════════════════════════════════════
// Concurrent events — what else is live at this site, right now
// ───────────────────────────────────────────────────────────────────
// Pure module. Reads events, returns a list, writes nothing.
//
// WHY THIS IS NOT A CORRELATOR.
//
// main.js already has one. It scores a new event against recent ones as
// 0.50 x RF match + 0.30 x kinematic continuity + 0.20 x temporal
// proximity, and auto-links above 0.65 with kinematic >= 0.3. That gate
// is deliberate and correct: it answers "is this the SAME OBJECT,
// later?" and the kinematic requirement is what stops two DJI M300s at
// two sites being treated as one drone that teleported.
//
// It has no answer for a different question: "are these DIFFERENT
// objects acting together, NOW?" A recon track at one end of an airport
// while a swarm enters the other is the textbook coordinated probe —
// one draws the response, the other does the work. Those two events
// score near zero on kinematic continuity, correctly, and so never
// link. The operator is left to make that connection themselves, under
// time pressure, which is the worst possible moment.
//
// This module does NOT try to score coordination. There is no data to
// calibrate such a score against, and C2 does not run rule-based
// classifiers: that is the neural net's job, and judgement here is the
// agent's. So this selects, deterministically and auditably, and hands
// the result to the agent to reason about. Same shape as
// precedent_retrieval.js, which selects top-K similar past events with
// zero LLM involvement and lets Agent B read them.
//
// WHAT IT DELIBERATELY DOES NOT DO:
//   - write linkedEventIds. That field records CONFIRMED continuity
//     from the deterministic correlator. An agent's reading is an
//     inference, and mixing the two destroys the one distinction the
//     Post-Incident Report exists to preserve: what the system
//     established versus what a model suggested.
//   - recommend any action. Detection-only. Same guard as precedents.
//   - look across sites. A tenant must never learn that another
//     tenant's site is busy.
// ═══════════════════════════════════════════════════════════════════

const CFG = {
  // Enough for an operator to act on, few enough to bound the prompt.
  MAX_EVENTS: 4,
  // "Right now" means both tracks are live. A track that closed before
  // this one opened is precedent, not concurrency, and precedent
  // retrieval already owns that.
  REQUIRE_BOTH_ACTIVE: true,
};

const R = 111320;

/** Compass bearing of a point from the site centre, 0-360, or null.
 *  The cheapest fact that answers "opposite ends or same side", which
 *  is the question an operator actually asks first. */
export function bearingFromCentre(pos, centre) {
  if (!pos || !centre) return null;
  if (typeof pos.lat !== 'number' || typeof centre.lat !== 'number') return null;
  const dN = (pos.lat - centre.lat) * R;
  const dE = (pos.lon - centre.lon) * R * Math.cos((centre.lat * Math.PI) / 180);
  let b = (Math.atan2(dE, dN) * 180) / Math.PI;
  if (b < 0) b += 360;
  return Math.round(b);
}

/** Smallest angle between two bearings, 0-180. */
export function bearingSeparation(a, b) {
  if (a == null || b == null) return null;
  const d = Math.abs(a - b) % 360;
  return Math.round(d > 180 ? 360 - d : d);
}

/** Metres between two events' last known positions, or null. */
export function separationM(a, b) {
  const pa = a?.lastPosition, pb = b?.lastPosition;
  if (!pa || !pb) return null;
  if (typeof pa.lat !== 'number' || typeof pb.lat !== 'number') return null;
  return Math.round(Math.hypot(
    (pa.lat - pb.lat) * R,
    (pa.lon - pb.lon) * R * Math.cos((pa.lat * Math.PI) / 180),
  ));
}

/**
 * Other live events at the same site as `event`.
 *
 * @param event   the event in focus
 * @param events  every event the CALLER is allowed to see. Pass the
 *                tenant-scoped list; this module does not re-derive
 *                scope and must never widen it.
 * @returns [{ id, droneType, platform, classification, threat,
 *             separationM, ageSec, detected }] nearest first
 */
export function concurrentEvents(event, events, opts = {}) {
  const max = opts.maxEvents ?? CFG.MAX_EVENTS;
  // Passed in, not imported: this module stays pure and never reaches
  // for the site registry itself. Without it the bearing fields are
  // null and everything else still works.
  const centre = opts.siteCentre || null;
  if (!event || !event.siteId || !Array.isArray(events)) return [];
  const isLive = e => e.status === 'active';
  if (CFG.REQUIRE_BOTH_ACTIVE && !isLive(event)) return [];

  const now = Date.now();
  return events
    .filter(e => e && e.id !== event.id)
    .filter(e => e.siteId === event.siteId)
    .filter(isLive)
    // An undetected track is not an event. The same rule the ledger and
    // the threat banner follow: if no sensor has heard it, the platform
    // does not get to mention it.
    .filter(e => e.detected !== false)
    // A FILED AIRLINER IS NOT CONCURRENT ACTIVITY, IT IS TUESDAY.
    //
    // CPH handles on the order of a thousand movements a day. A
    // friendly, flight-plan-matched, transponder-tracked aircraft
    // sharing a site with a drone is the normal state of an airport,
    // not a coincidence worth reporting, and listing it invites exactly
    // the failure this module is written to avoid: a model asked what
    // two concurrent tracks might mean will find a meaning. "A
    // commercial airliner is concurrent with the swarm" is one bad
    // inference from a coordination claim that would be nonsense.
    //
    // Same rule the threat banner reached earlier: friendly means
    // non-threat, and the rest of the app already says so in those
    // words. 'unknown' is NOT excluded; an unidentified track at the
    // other end of the site is precisely what an operator needs told.
    .filter(e => e.classification !== 'friendly')
    .map(e => {
      // EVERY FIELD HERE IS ARITHMETIC. No model, no threshold on
      // meaning, nothing that needs inference to be reachable. The more
      // the checklist carries, the less rides on the agent: with the
      // model down an operator still gets two hostile tracks, how far
      // apart, which bearings, and which arrived first, which is most
      // of what a decision needs.
      const bEvent = bearingFromCentre(event.lastPosition, centre);
      const bOther = bearingFromCentre(e.lastPosition, centre);
      const angle = bearingSeparation(bEvent, bOther);
      const tA = event.startTime ? new Date(event.startTime).getTime() : null;
      const tB = e.startTime ? new Date(e.startTime).getTime() : null;
      return {
        id: e.id,
        droneType: e.droneType || e.platform || 'unidentified',
        platform: e.platform || null,
        classification: e.classification || 'unknown',
        threat: e.threat || null,
        // Where this identity came from. 'live' means a detector said
        // so; 'sim' means a scenario file did. An operator reading
        // "Shahed-136 on the other side" needs to know which, and so
        // does the agent, which is why it travels into the block below.
        identitySource: e.source || 'sim',
        separationM: separationM(event, e),
        ageSec: tB == null ? null : Math.round((now - tB) / 1000),
        bearingDeg: bOther,
        // Positive: this track appeared AFTER the one in focus.
        appearedAfterSec: (tA == null || tB == null) ? null : Math.round((tB - tA) / 1000),
        // 90 degrees is the honest cut. Below it the two are broadly on
        // the same side of the site; above it an operator looking at one
        // has the other behind them. Named rather than left as a number
        // because "opposite ends" is the phrase people actually use.
        approach: angle == null ? null
          : angle >= 90 ? 'opposite ends'
            : angle >= 45 ? 'different sides'
              : 'same side',
        bearingSeparationDeg: angle,
      };
    })
    .sort((a, b) => {
      if (a.separationM == null) return 1;
      if (b.separationM == null) return -1;
      return a.separationM - b.separationM;
    })
    .slice(0, max);
}

/**
 * The prompt block handed to the agent. Returns '' when there is
 * nothing concurrent, so the caller can concatenate unconditionally and
 * a quiet site costs no tokens.
 */
export function formatConcurrentBlock(list, event, opts = {}) {
  if (!Array.isArray(list) || !list.length) return '';
  // Every line here is MEASURED: arithmetic over the event record, true
  // whether or not the model is reachable. The agent is asked for one
  // thing only, at the end, and it is the one thing arithmetic cannot
  // answer.
  const lines = list.map(c => {
    const bits = [`${c.droneType}`, c.classification];
    if (c.threat) bits.push(`threat ${c.threat}`);
    if (c.separationM != null) bits.push(`${c.separationM} m away`);
    if (c.bearingDeg != null) bits.push(`bearing ${c.bearingDeg} deg from site centre`);
    if (c.approach) bits.push(`${c.approach} (${c.bearingSeparationDeg} deg apart)`);
    if (c.appearedAfterSec != null) {
      bits.push(c.appearedAfterSec === 0 ? 'appeared at the same time as this track'
        : c.appearedAfterSec > 0
          ? `appeared ${c.appearedAfterSec}s AFTER this track`
          : `appeared ${Math.abs(c.appearedAfterSec)}s BEFORE this track`);
    }
    if (c.ageSec != null) bits.push(`active ${c.ageSec}s`);
    bits.push(c.identitySource === 'live'
      ? 'identity from a live detector'
      : 'identity from a simulation, not a detector');
    return `- ${c.id}: ${bits.join(', ')}`;
  });
  const focal = event.lastPosition && opts.siteCentre
    ? bearingFromCentre(event.lastPosition, opts.siteCentre) : null;
  return [
    'CONCURRENT ACTIVITY AT THIS SITE',
    `The following tracks are live at the same site as ${event.id} at this moment.`
      + (focal == null ? '' : ` ${event.id} bears ${focal} deg from the site centre.`),
    'Commercial and other friendly traffic is excluded: a filed airliner sharing an',
    'airport with a drone is the normal state of an airport, not a coincidence.',
    'They are listed because they are concurrent, NOT because any link has been',
    'established. The deterministic correlator has not connected them.',
    '',
    ...lines,
    '',
    'Every figure above is measured. Say whether their timing and placement suggest',
    'coordinated activity, and say plainly if it does not. Concurrency at a busy site',
    'is often coincidence. Do NOT restate the figures back: the operator can already',
    'see them. Do NOT recommend an action and do NOT assert a link as fact.',
  ].join('\n');
}

/**
 * One line per concurrent track for the detail panel's Mission Console.
 * Plain text: the caller escapes it. Every figure is MEASURED, so the
 * lines carry no confidence; a distance is or is not 2.7 km.
 */
export function concurrentPanelLines(list) {
  if (!Array.isArray(list)) return [];
  return list.map(c => {
    const bits = [c.droneType, c.classification];
    if (c.separationM != null) {
      bits.push(c.separationM >= 1000 ? `${(c.separationM / 1000).toFixed(1)} km away` : `${c.separationM} m away`);
    }
    if (c.approach) bits.push(c.approach);
    if (c.appearedAfterSec != null) {
      const s = Math.abs(c.appearedAfterSec);
      bits.push(s === 0 ? 'appeared at the same time'
        : c.appearedAfterSec > 0 ? `appeared ${s} s after this track` : `appeared ${s} s before this track`);
    }
    // Where the identity came from, said on the line itself. The agent
    // block already carries it; an operator reading "Shahed-136" needs
    // to know whether a detector or a scenario file said so.
    bits.push(c.identitySource === 'live' ? 'live detection' : 'simulated');
    return bits.join(' · ');
  });
}

/**
 * The coordination reading, as the panel shows it. ASSESSED tier.
 *
 * THE SEAM. A live inference path calls events.js
 *     setCoordinationReading(eventId, { text, confidence, modelVersion })
 * with confidence one of 'low' | 'medium' | 'high'. Nothing calls it
 * today: the analysis debrief already hands the model the concurrent
 * block and asks this question, but its answer is free narrative, not a
 * field. Until a structured answer exists the panel says so, every
 * time concurrent tracks exist, rather than going quiet. Lucas,
 * 2026-10-22: every time. A silent row cannot be told apart from a
 * system that never looked.
 *
 * Never derived here. A rule that turned bearings and timings into a
 * coordination verdict would be a classifier, and C2 does not classify.
 *
 * @returns { assessed: boolean, text, confidence?, modelVersion? }
 */
export function coordinationReadingFor(event) {
  const r = event && event.coordinationReading;
  const ok = r && typeof r.text === 'string' && r.text.trim()
    && ['low', 'medium', 'high'].includes(r.confidence);
  if (!ok) {
    return { assessed: false, text: 'Not assessed. Inference not connected.' };
  }
  return {
    assessed: true,
    text: r.text.trim(),
    confidence: r.confidence,
    modelVersion: typeof r.modelVersion === 'string' && r.modelVersion ? r.modelVersion : 'unknown model',
  };
}

/** Convenience: select and format in one call. */
export function buildConcurrentBlock(event, events, opts = {}) {
  return formatConcurrentBlock(concurrentEvents(event, events, opts), event, opts);
}
