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
 * Course over ground AND speed between two positions, or null when the
 * aircraft has barely moved.
 *
 * Speed comes back with the course because the bank below needs both:
 * the real relation is bank = atan(v*omega/g), and a turn rate alone
 * says nothing about how steeply it has to be flown.
 *
 * The movement threshold matters: at a standstill the delta is
 * numerical noise and the derived course spins wildly, which would bank
 * a hovering aircraft at random.
 */
export function courseAndSpeedFromDelta({ fromLat, fromLon, toLat, toLon, dt, minMoveM = 0.5 }) {
  const mLat = 111_132;
  const mLon = 111_320 * Math.cos((toLat * Math.PI) / 180);
  const dN = (toLat - fromLat) * mLat;
  const dE = (toLon - fromLon) * mLon;
  const moved = Math.hypot(dN, dE);
  if (moved < minMoveM || !(dt > 0)) return null;
  return { courseRad: Math.atan2(dE, dN), speedMs: moved / dt };
}

const G = 9.81;

/**
 * Next bank angle, eased toward the one a COORDINATED TURN at this
 * speed and turn rate actually requires:
 *
 *     tan(bank) = v * omega / g
 *
 * The previous version took the turn rate as a fraction of the
 * airframe's maximum and scaled the maximum bank by it. That is not
 * physics and it fails in both directions. A 400 m orbit at 129 km/h
 * turns at only 5.1 deg/s, which is 8 per cent of a 60 deg/s maximum,
 * so it banked the aircraft 1.5 degrees for a turn that genuinely needs
 * 18. Flown fast and gently it would have over-banked instead.
 *
 * Clamped to maxBankRad, because an airframe has a limit even where the
 * arithmetic asks for more, and that clamp is the honest signal that a
 * turn is being asked for which cannot be flown.
 *
 * Returns `prevBank` unchanged when there is nothing trustworthy to
 * measure, which keeps a hover level.
 */
export function bankForCoordinatedTurn({
  prevBank = 0,
  prevCourseRad,
  courseRad,
  speedMs,
  dt,
  maxBankRad,
  easing = 3,
}) {
  if (prevCourseRad == null || courseRad == null || !(speedMs > 0)) return prevBank;
  // dt <= 0 is a frozen clock. dt >= 1 is a backgrounded tab, where the
  // delta spans seconds and the implied turn rate is meaningless.
  if (!(dt > 0) || dt >= 1) return prevBank;
  const omega = norm(courseRad - prevCourseRad) / dt;
  const want = Math.sign(omega) * Math.min(maxBankRad, Math.atan((speedMs * Math.abs(omega)) / G));
  return prevBank + (want - prevBank) * Math.min(1, dt * easing);
}
