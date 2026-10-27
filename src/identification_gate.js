// ═══════════════════════════════════════════════════════════════════
// Nothing is shared about a track until the system knows what it is
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-27: "2 seconds in the system cannot classify what it
// is, and thus we can't share a 'Drone here' before even knowing what it
// is." The escalation log showed "DRONE ALERT ... Five drones" from an
// auto-rule that fired the instant the track appeared.
//
// THE MOMENT. The roster already models it: every airframe reads
// "Classifying" until the analysis has watched it long enough, and the
// lead resolves first, 8 s after the track was first detected
// (_IDENT_SCHEDULE_S[0] in main.js, checked equal by
// check:identification-gate). That is the moment the track counts as
// identified, for a single drone as for a formation's lead.
//
//   event.identified === false   detected, still classifying
//   event.identified === true    identified, identifiedAt stamped
//   undefined                    an event this does not own (history,
//                                live sensor feed): treated as known
//
// WHAT WAITS FOR IT
//   - auto-escalation rules (rules.js) skip an unidentified track and
//     fire on their next evaluation once it is identified
//   - an escalation an operator sends before then says "Unidentified
//     track, classification in progress", never a type or "drones":
//     the default messages, the Detection Brief, the escalate modal's
//     summary and the facts the brief's agent is given
//
// A cooperative aircraft identifies itself on its transponder and starts
// identified. On the sim clock, so a paused scene does not finish its
// classification while frozen.
//
// THE SEAM. With a real classifier in the loop the moment is the net's,
// not a timer: whatever reports a class with enough confidence sets
// identified: true. Nothing downstream reads the timer, only the flag.
//
// Pure. The caller supplies the events, the clock and, where it has one,
// the moment a formation was first detected.
// ═══════════════════════════════════════════════════════════════════

export const IDENT_CFG = {
  // Seconds from first detection to the lead airframe being identified.
  // Must equal _IDENT_SCHEDULE_S[0] in main.js.
  LEAD_IDENTIFIED_S: 8.0,
};

/** True while a track is detected but not yet classified. */
export function isUnidentified(event) {
  return event?.identified === false;
}

/** The value a new event starts with: a cooperative or friendly track
 *  is known at once, anything else is classifying until the clock says
 *  otherwise. */
export function initialIdentified(template) {
  return !!(template?.cooperative || template?.classification === 'friendly');
}

/**
 * One clock for every unidentified event.
 *
 * step(events, nowSimMs, firstDetectedSimMs?) returns the ids that have
 * just become identified. A track's clock starts at its first detection:
 * the formation's own stamp when the caller has one, otherwise the first
 * step that sees it detected.
 */
export function createIdentificationClock(cfg = IDENT_CFG) {
  const started = new Map();   // eventId -> sim ms the clock started
  return {
    step(events, nowSimMs, firstDetectedSimMs = () => null) {
      const done = [];
      const live = new Set();
      for (const e of events || []) {
        if (!e || e.status !== 'active' || e.identified !== false || e.detected === false) continue;
        live.add(e.id);
        let s = firstDetectedSimMs(e.id);
        if (typeof s !== 'number') {
          s = started.get(e.id);
          if (typeof s !== 'number') { s = nowSimMs; started.set(e.id, s); }
        }
        if (nowSimMs - s >= cfg.LEAD_IDENTIFIED_S * 1000) done.push(e.id);
      }
      for (const id of [...started.keys()]) if (!live.has(id) || done.includes(id)) started.delete(id);
      return done;
    },
  };
}
