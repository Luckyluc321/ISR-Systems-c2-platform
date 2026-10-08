// ═══════════════════════════════════════════════════════════════════
// Beam-pass intercept geometry
// ───────────────────────────────────────────────────────────────────
// Where a door-gun helicopter should fly to get a shot at a crossing
// target.
//
// WHY PURE PURSUIT DOES NOT WORK HERE
//
// The dispatch logic re-aims every tick at the threat's CURRENT
// position. Against a slow target that converges, but an MH-60R at
// 250 km/h chasing a Geran-2 at 185 km/h closes at 18 m/s, so a 2 km
// stern chase takes nearly two minutes and the gap only ever shrinks
// from behind. A door gun cannot use that: it fires out the side of
// the aircraft inside a 45 degree traverse, so a target dead astern is
// the one place it can never be engaged.
//
// WHAT IT NEEDS INSTEAD
//
// A beam pass. Fly to a point ABEAM the target's track, offset far
// enough out to stay inside gun range but not so close that the pass
// is over before the gun can lay on it, and arrive BEFORE the target
// reaches that point. The target then crosses the gunner's arc at a
// steady standoff and the engagement is a side shot, which is the only
// shot this aircraft has.
//
// This solves the intercept directly rather than steering at the
// target each frame:
//
//   T(t) = T0 + u·vt·t                 target along its own heading
//   P(t) = T(t) + n·standoff           offset abeam, on the gun side
//   |P(t) - C0| = vc·t                 chaser arrives at the same time
//
// Substituting and collecting gives a quadratic in t:
//
//   (vt² - vc²)·t² + 2(A·u)·vt·t + |A|² = 0,  A = T0 - C0 + n·standoff
//
// With vc > vt the squared coefficient is negative, so there is
// exactly one positive root and it is the earliest arrival. If the
// chaser is slower there may be none, which is reported rather than
// fudged: a helicopter that cannot catch a jet-powered Geran-5 should
// say so, not fly to a point it will reach late.
//
// Geometry is done in local east/north metres about the target. Over
// the few kilometres an intercept spans, that is accurate to well
// under a metre and avoids great-circle work in a per-tick path.
// ═══════════════════════════════════════════════════════════════════

const M_PER_DEG_LAT = 111_132;
const mPerDegLon = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);

/**
 * Standoff for the pass, in metres.
 *
 * Inside the GAU-21's 1100 m effective range with margin, and well
 * inside the 2000 m onboard sensor envelope so the contact is seen and
 * the gun has time to lay on it before the target is abeam.
 */
export const BEAM_PASS_STANDOFF_M = 700;

/**
 * Solve the beam-pass intercept.
 *
 * `trackSide` is +1 to place the chaser to the RIGHT of the target's
 * track, -1 for the left. Right of the track presents the target off
 * the chaser's PORT beam once both are running the same way, so an
 * aircraft whose gun fires to port wants +1. Named for the geometry
 * rather than for the gun, because "gun side" inverts between the two
 * frames and that is exactly the sign nobody gets right twice.
 *
 * Returns null when the chaser cannot get there first.
 */
export function beamPassIntercept({
  chaserLat, chaserLon, chaserSpeedMs,
  targetLat, targetLon, targetHeadingDeg, targetSpeedMs,
  standoffM = BEAM_PASS_STANDOFF_M,
  trackSide = 1,
}) {
  if (!(chaserSpeedMs > 0)) return null;
  const vt = Math.max(0, targetSpeedMs || 0);
  const vc = chaserSpeedMs;

  const mLon = mPerDegLon(targetLat);
  // Chaser relative to the target, in metres, east and north.
  const cx = (chaserLon - targetLon) * mLon;
  const cy = (chaserLat - targetLat) * M_PER_DEG_LAT;

  // Target's unit heading, and the perpendicular on the gun side.
  const hdg = ((targetHeadingDeg || 0) * Math.PI) / 180;
  const ux = Math.sin(hdg);
  const uy = Math.cos(hdg);
  // Heading rotated 90 degrees clockwise is the target's RIGHT, which
  // is trackSide +1.
  const nx = uy * trackSide;
  const ny = -ux * trackSide;

  // A = T0 - C0 + n·standoff, with T0 at the origin.
  const ax = -cx + nx * standoffM;
  const ay = -cy + ny * standoffM;

  const a = vt * vt - vc * vc;
  const b = 2 * (ax * ux + ay * uy) * vt;
  const c = ax * ax + ay * ay;

  let t = null;
  if (Math.abs(a) < 1e-9) {
    // Equal speeds: the quadratic degenerates to a line.
    if (Math.abs(b) > 1e-9) {
      const root = -c / b;
      if (root > 0) t = root;
    }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const roots = [(-b + sq) / (2 * a), (-b - sq) / (2 * a)].filter(r => r > 0);
      if (roots.length) t = Math.min(...roots);
    }
  }
  if (t == null || !Number.isFinite(t)) return null;

  // Aim point, back to degrees.
  const px = ux * vt * t + nx * standoffM;
  const py = uy * vt * t + ny * standoffM;
  return {
    lat: targetLat + py / M_PER_DEG_LAT,
    lon: targetLon + px / mLon,
    timeToInterceptS: t,
    // How far the chaser must fly to get there. Useful for deciding
    // whether the intercept is worth committing to at all.
    chaserRangeM: vc * t,
    standoffM,
  };
}

/**
 * Seconds the target stays within `weaponRangeM` on a pass at this
 * standoff, assuming the chaser is holding station abeam.
 *
 * The chord of the weapon circle at that offset, over the target's
 * speed. Returns 0 when the standoff is already outside the weapon.
 */
export function engagementWindowS({ standoffM, weaponRangeM, targetSpeedMs }) {
  if (!(targetSpeedMs > 0) || standoffM >= weaponRangeM) return 0;
  const chord = 2 * Math.sqrt(weaponRangeM * weaponRangeM - standoffM * standoffM);
  return chord / targetSpeedMs;
}

// ── Offset pursuit ────────────────────────────────────────────────
// The full solve above answers "where do we meet if we both hold
// course", which is the LATEST useful arrival, not the earliest. For a
// chaser that is already faster, aiming at that far-ahead point makes
// the intercept later rather than sooner: measured against the Billund
// Geran transit it moved the closest approach from minute 4 to minute
// 73.
//
// What the door gun actually needs is not an earlier or later meeting
// but a different BEARING. So close on the threat directly, as pursuit
// already did, and simply aim a standoff to one side of it. The chaser
// keeps its full closing speed and arrives abeam instead of astern,
// which is the whole point.
//
// The full solve stays, because deciding whether to commit at all is a
// different question from how to steer, and `timeToInterceptS` answers
// it honestly: no solution means this airframe cannot catch this
// threat.

/**
 * Aim point for a beam pass: the threat's current position, offset
 * `standoffM` perpendicular to its track.
 *
 * `trackSide` +1 is the threat's right, which presents it off a
 * port-gun chaser's firing side.
 */
export function beamPassAimPoint({
  targetLat, targetLon, targetHeadingDeg,
  standoffM = BEAM_PASS_STANDOFF_M,
  trackSide = 1,
}) {
  const hdg = ((targetHeadingDeg || 0) * Math.PI) / 180;
  const ux = Math.sin(hdg);
  const uy = Math.cos(hdg);
  const nx = uy * trackSide;
  const ny = -ux * trackSide;
  const mLon = mPerDegLon(targetLat);
  return {
    lat: targetLat + (ny * standoffM) / M_PER_DEG_LAT,
    lon: targetLon + (nx * standoffM) / mLon,
    standoffM,
  };
}
