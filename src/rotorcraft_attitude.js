// ═══════════════════════════════════════════════════════════════════
// Rotorcraft attitude — bank comes from the flight path, not the nose
// ───────────────────────────────────────────────────────────────────
// A helicopter is not an aeroplane and this is where the difference
// shows.
//
// An aeroplane can only change direction by banking, so nose heading
// and flight path are the same thing and either can drive the roll. A
// helicopter decouples them. It can pedal-turn on the spot with the
// disc level, and it can crab — fly one way while pointing another —
// which is exactly what a door-gun firing pass IS: hold the course,
// yaw the nose 90 degrees so the gunner can bear.
//
// Deriving bank from nose heading therefore rolls the aircraft 18
// degrees for a pedal turn that should be dead level, and rolls it the
// wrong way through a crabbing pass. Bank belongs to the COURSE: the
// direction the airframe is actually travelling, measured from
// successive positions. Turn the flight path and it banks into the
// turn; swing the nose alone and the disc stays level, which is what a
// pedal turn looks like from outside.
//
// Course is measured from position rather than taken from any heading
// field on purpose. Position is the one thing that cannot disagree with
// what the operator sees on the map.
// ═══════════════════════════════════════════════════════════════════

const TAU = Math.PI * 2;
const norm = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

/**
 * Course over ground between two positions, in radians clockwise from
 * north, or null when the aircraft has barely moved.
 *
 * The threshold matters: at a standstill the delta is numerical noise
 * and the derived course spins wildly, which would bank a hovering
 * aircraft at random.
 */
export function courseFromDelta({ fromLat, fromLon, toLat, toLon, minMoveM = 0.5 }) {
  const mLat = 111_132;
  const mLon = 111_320 * Math.cos((toLat * Math.PI) / 180);
  const dN = (toLat - fromLat) * mLat;
  const dE = (toLon - fromLon) * mLon;
  if (Math.hypot(dN, dE) < minMoveM) return null;
  return Math.atan2(dE, dN);
}

/**
 * Next bank angle, eased toward the one this rate of COURSE change
 * calls for.
 *
 * `turnRateRadS` is the airframe's maximum, so a hard turn banks fully
 * and a gentle one barely tips. Returns `prevBank` unchanged when there
 * is nothing trustworthy to measure, which keeps a hover level.
 */
export function bankForCourseChange({
  prevBank = 0,
  prevCourseRad,
  courseRad,
  dt,
  maxBankRad,
  turnRateRadS,
  easing = 3,
}) {
  if (prevCourseRad == null || courseRad == null) return prevBank;
  // dt <= 0 is a frozen clock. dt >= 1 is a backgrounded tab, where the
  // delta spans seconds and the implied turn rate is meaningless.
  if (!(dt > 0) || dt >= 1) return prevBank;
  const dc = norm(courseRad - prevCourseRad);
  const frac = Math.max(-1, Math.min(1, dc / dt / turnRateRadS));
  return prevBank + (frac * maxBankRad - prevBank) * Math.min(1, dt * easing);
}
