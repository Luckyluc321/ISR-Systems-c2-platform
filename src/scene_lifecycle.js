// ═══════════════════════════════════════════════════════════════════
// Scene lifecycle — when a cordon releases, and when a scene is over
// ───────────────────────────────────────────────────────────────────
// Pure decision logic. No Cesium, no event mutation, no imports, and
// nothing Vite-only, so this module loads and runs under plain Node and
// can actually be tested. Callers pass plain data in and get decisions
// out; every side effect (removing an entity, writing event state,
// moving a unit) stays at the call seam in main.js.
//
// Two questions live here.
//
// 1. WHEN DOES A CORDON RELEASE? Ground units pinned to wreckage enter
//    'holding-cordon' and, before this module, nothing ever moved them
//    out. No timer, no action, no path. Every scenario with a downed
//    airframe parked police on the map permanently, and the downed
//    symbol never cleared.
//
// 2. WHEN IS A SCENE OVER? A closed event's model was never removed.
//    The teardown lived inside the per-position loop of the simulation
//    tick, but closing a track stops it emitting positions, so the loop
//    never visited it again and the check never ran. Unreachable on
//    every natural close. Only Cancel and a selection change cleared
//    anything, which is why a threat that leaves coverage sails on
//    forever.
//
// Both answers are LEVEL-TRIGGERED: they are questions you can ask at
// any moment about current state, not events you have to catch. That is
// deliberate. The previous generation of this logic was edge-triggered
// and the AMK phantom-live bug came from a condition that only became
// true after its last chance to be tested.
// ═══════════════════════════════════════════════════════════════════

// How long a unit holds a wreckage cordon before standing down, by
// dispatch kind, in seconds of wall-clock.
//
// These are a PRODUCT PACING DECISION, not a doctrine figure. There is
// no simulated clock in this platform: a scenario second is a real
// second. A real Danish cordon at a munition scene runs hours, and the
// sourced anchors are roughly 4 hours for an assessed-inert drone and 6
// to 12 hours where a warhead is present. That cannot be represented
// literally, so it is compressed, and the compression is admitted here
// rather than dressed up as realism.
//
// The ceiling matches the slowest existing on-scene task in CD_PROFILE
// (a 900 second rescue-team deployment), so this sits inside the
// pacing the rest of the simulation already uses.
export const CORDON_HOLD_SEC = {
  'receiver-cordon-squad': 900,
  'receiver-forensic-van': 900,
  'receiver-patrol-car': 600,
  'receiver-k9-unit': 420,
};
export const CORDON_HOLD_SEC_DEFAULT = 600;

export function cordonHoldSecFor(kind, overrideSec) {
  if (typeof overrideSec === 'number' && overrideSec >= 0) return overrideSec;
  return CORDON_HOLD_SEC[kind] ?? CORDON_HOLD_SEC_DEFAULT;
}

// Terminal dispatch states: a unit here will not move again on its own.
const TERMINAL_DISPATCH_STATES = new Set(['complete']);

export function isDispatchTerminal(d) {
  if (!d) return true;
  if (d.rtbCompleted) return true;
  return TERMINAL_DISPATCH_STATES.has(d.state);
}

// Which cordon holders are due to stand down.
//
// Returns the dispatch ids to release. Two triggers, and the difference
// between them matters:
//
//   'scene-released'  a human recorded that the police released the
//                     scene. This is the real-world path.
//   'hold-elapsed'    the compressed hold ran out with nobody acting.
//                     A simulation fallback so an unattended scenario
//                     does not accumulate permanent cordons.
//
// The reason is returned so the caller can record WHICH it was. A
// timer expiring must never be written down as an agency decision: ISR
// observes, agencies decide, and a record saying the police released a
// scene when no police account did would be the platform asserting
// something it has no basis for.
//
// simulationOnly gates the elapsed fallback. In a live event the real
// world supplies the release, through a receiver recording it or an
// agency's own system reporting through the dispatch adapter, and no
// timer may invent one.
export function cordonReleaseDecisions(dispatches, opts = {}) {
  const {
    now = 0,
    sceneReleased = false,
    simulationOnly = true,
    holdSecOverride,
  } = opts;

  const out = [];
  for (const d of dispatches || []) {
    if (!d || d.state !== 'holding-cordon') continue;

    if (sceneReleased) {
      out.push({ id: d.id, reason: 'scene-released' });
      continue;
    }
    if (!simulationOnly) continue;

    const since = d.cordonHoldSinceMs;
    if (typeof since !== 'number') continue;
    const holdMs = cordonHoldSecFor(d.kind, holdSecOverride) * 1000;
    if (now - since >= holdMs) out.push({ id: d.id, reason: 'hold-elapsed' });
  }
  return out;
}

// Wreckage cordons that have fully stood down.
//
// Returns the wreckage ids whose perimeter can now be removed: the
// cordon was actually established, and nobody is attached to it any
// more.
//
// TWO conditions, and both were learned the hard way.
//
// A unit counts as attached while it is EN ROUTE or ENGAGING, not only
// once it reaches 'holding-cordon'. The perimeter is drawn the instant
// an airframe comes down, while every assigned car is still driving to
// it. Counting only arrived units meant nothing held the wreckage at
// the moment it was created, so the next sweep two seconds later
// deleted the polygon before a single unit got there.
//
// And a wreckage nobody ever held is NOT cleared. everHeldIds carries
// the ids that have had a unit on them at some point. Without it, a
// wreck with no cordon dispatched at all, which is the normal case for
// an impact scene, would be drawn and destroyed within two seconds.
// A cordon that never formed has not stood down; it never stood up.
export function clearedWreckageIds(wreckages, dispatches, everHeldIds) {
  const ATTACHED = new Set(['holding-cordon', 'en_route', 'engaging']);
  const held = new Set();
  for (const d of dispatches || []) {
    if (d && d.assignedWreckageId && ATTACHED.has(d.state)) held.add(d.assignedWreckageId);
  }
  const everHeld = everHeldIds instanceof Set ? everHeldIds : new Set(everHeldIds || []);
  return (wreckages || [])
    .map(w => w && (w.id ?? w.wreckageId))
    .filter(id => id != null && everHeld.has(id) && !held.has(id));
}

// Event ids whose scene entities are due for removal.
//
// This is the teardown that was unreachable. It asks a standing
// question over current state rather than relying on a tick that has
// already stopped: which closed tracks have been closed longer than the
// ghost period and still have entities on the map.
//
// droneStates is an iterable of [eventId, state] pairs, matching the
// shape of the live droneState Map, so the caller can pass it directly.
export function expiredGhostEventIds(droneStates, opts = {}) {
  const { now = 0, ghostMs = 15000 } = opts;
  const out = [];
  for (const [eventId, state] of droneStates || []) {
    if (!state || typeof state.closedAt !== 'number') continue;
    if (state._entitiesRemoved) continue;
    if (now - state.closedAt <= ghostMs) continue;
    out.push(eventId);
  }
  return out;
}

// Is this scene over?
//
// Both halves must hold, not either. A threat being gone does not end
// the response, and responders finishing does not mean the threat left.
// Conflating them would also misrepresent how an incident actually
// runs: when a munition detonates and the detection event closes, the
// fire is still burning.
//
// Not yet consumed. The three steps above each answer their own
// question and none needs a whole-scene verdict, but this is the
// predicate a "simulation complete" indicator or an end-of-scenario
// summary would ask, and defining it beside them keeps the definition
// in one place rather than being re-derived at that call site.
export function isSceneFinished({ tracksLive = 0, dispatches = [] } = {}) {
  if (tracksLive > 0) return false;
  return (dispatches || []).every(isDispatchTerminal);
}
