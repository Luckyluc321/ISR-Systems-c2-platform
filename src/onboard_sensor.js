// ═══════════════════════════════════════════════════════════════════
// Onboard sensors — a dispatched aircraft observes too
// ───────────────────────────────────────────────────────────────────
// The sensors-observe-only rule says an object is rendered only while
// some sensor sees it. The visibility test implemented exactly two
// sensors: the ground mesh, and a friendly missile's seeker. A
// dispatched aircraft's own turret was not one of them.
//
// So an MH-60R could hold a Geran on its EO/IR at 800 m, lay the door
// gun onto it, and the operator sitting in that aircraft's own view saw
// nothing at all, because Billund's ground rings do not reach 40 km up
// the Jutland spine. The gun swung at an empty sky. The comment on
// _gunTargetOf already recorded that as a known oddity.
//
// This is not an exception to the rule, it is the rule applied
// honestly. The turret is a real sensor with a published range, it is
// ours, and when it holds a contact the platform genuinely observes
// it. Leaving it out did not make the map more truthful, it made it
// less: it hid something we could in fact see.
//
// SCOPE. This governs RENDERING only. Detection state, the detection
// report and the event lifecycle are untouched and still keyed on the
// ground mesh via coverageGatedTrack. An onboard hold is not a
// detection event and must never open or close one.
// ═══════════════════════════════════════════════════════════════════

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** States in which a unit is airborne and actually looking. */
const LOOKING = new Set(['en_route', 'engaging']);

/**
 * Is any unit dispatched to this event holding the given point on its
 * own sensor?
 *
 * `dispatches` is an iterable of counter-dispatch records. Only units
 * assigned to `eventId`, airborne, in a looking state, and carrying an
 * `onboardSensorRangeM` are considered. A unit whose own position is
 * unknown cannot be looking at anything.
 *
 * Returns the holding unit's range in metres, or null.
 */
export function onboardSensorHold({ dispatches, eventId, lat, lon }) {
  if (lat == null || lon == null) return null;
  let best = null;
  for (const d of dispatches || []) {
    if (!d || d.eventId !== eventId) continue;
    if (!d.profile?.airborne) continue;
    if (!LOOKING.has(d.state)) continue;
    const range = d.profile?.onboardSensorRangeM;
    if (!range || d.curLat == null || d.curLon == null) continue;
    const dist = haversineM(d.curLat, d.curLon, lat, lon);
    if (dist <= range && (best == null || dist < best)) best = dist;
  }
  return best;
}
