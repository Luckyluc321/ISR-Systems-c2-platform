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
    .map(e => ({
      id: e.id,
      droneType: e.droneType || e.platform || 'unidentified',
      platform: e.platform || null,
      classification: e.classification || 'unknown',
      threat: e.threat || null,
      separationM: separationM(event, e),
      ageSec: e.startTime ? Math.round((now - new Date(e.startTime).getTime()) / 1000) : null,
    }))
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
export function formatConcurrentBlock(list, event) {
  if (!Array.isArray(list) || !list.length) return '';
  const lines = list.map(c => {
    const sep = c.separationM == null ? 'separation unknown' : `${c.separationM} m away`;
    const age = c.ageSec == null ? '' : `, active ${c.ageSec}s`;
    const thr = c.threat ? `, threat ${c.threat}` : '';
    return `- ${c.id}: ${c.droneType}, ${c.classification}${thr}, ${sep}${age}`;
  });
  return [
    'CONCURRENT ACTIVITY AT THIS SITE',
    `The following tracks are live at the same site as ${event.id} at this moment.`,
    'They are listed because they are concurrent, NOT because any link has been',
    'established. The deterministic correlator has not connected them.',
    '',
    ...lines,
    '',
    'Say whether their timing and placement suggest coordinated activity, and say',
    'plainly if it does not. Concurrency at a busy site is often coincidence.',
    'Do NOT recommend an action and do NOT assert a link as fact: this is context',
    'for the operator to judge.',
  ].join('\n');
}

/** Convenience: select and format in one call. */
export function buildConcurrentBlock(event, events, opts = {}) {
  return formatConcurrentBlock(concurrentEvents(event, events, opts), event);
}
