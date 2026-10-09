// ═══════════════════════════════════════════════════════════════════
// Gun run — the left-hand orbit a door gunner actually engages from
// ───────────────────────────────────────────────────────────────────
// My first attempt at this yawed the aircraft 90 degrees and held it
// there while it flew on at cruise. That is a crab, and for a
// helicopter at 250 km/h it is impossible: sideways flight is limited
// to roughly 30-35 knots by tail rotor authority and fuselage
// aerodynamics. Past that you run out of pedal and lose directional
// control. Lucas called it immediately.
//
// A real door-gun engagement is FLOWN, as a left-hand orbit around the
// target. The aircraft circles it, nose on the tangent, banked into the
// turn. The port door faces the inside of the circle the whole way
// round, so the gunner holds the target continuously and the airframe
// never flies sideways at all. Nose is always along the flight path.
//
// THE PHYSICS SETS THE SPEED, NOT THE OTHER WAY ROUND
//
// A coordinated turn ties bank, speed and radius together:
//
//     tan(bank) = v^2 / (g * r)
//
// So a radius is not free. A 400 m orbit at 250 km/h would need 51
// degrees of bank, which this aircraft will not do. Hold the bank at
// something a crew would actually fly and the radius fixes the speed:
//
//     v = sqrt(g * r * tan(bank))
//
// At 400 m and 18 degrees that is 129 km/h, yawing 5.1 deg/s, a full
// circle in 70 seconds. So the aircraft has to SLOW DOWN to set up the
// shot, which is what a gun run looks like, and the turn takes about 18
// seconds to swing through 90 degrees rather than happening in one
// movement.
//
// DIRECTION
//
// Left-hand, because the gun is on the port side. Flying anticlockwise
// seen from above puts the centre of the circle — the target — off the
// left door. A starboard gun would need the opposite sense, which is
// why `direction` is a parameter and not baked in.
// ═══════════════════════════════════════════════════════════════════

const G = 9.81;
const TAU = Math.PI * 2;
const M_PER_DEG_LAT = 111_132;
const mPerDegLon = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);
const norm = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

/** Bank a crew would hold round a target. Not an aerobatic figure. */
export const GUN_RUN_BANK_RAD = (18 * Math.PI) / 180;

/** Left-hand orbit: the port door faces the centre. */
export const ORBIT_LEFT = -1;
export const ORBIT_RIGHT = 1;

/** Speed a coordinated orbit of this radius and bank implies. */
export function orbitSpeedMs(radiusM, bankRad = GUN_RUN_BANK_RAD) {
  return Math.sqrt(G * radiusM * Math.tan(bankRad));
}

/** Rate the aircraft comes round the circle, radians per second. */
export function orbitYawRateRadS(radiusM, bankRad = GUN_RUN_BANK_RAD) {
  return orbitSpeedMs(radiusM, bankRad) / radiusM;
}

/** Bank the real relation gives for a speed and turn rate. */
export function coordinatedBankRad(speedMs, omegaRadS) {
  return Math.atan((speedMs * Math.abs(omegaRadS)) / G);
}

/** Bearing from the target out to the aircraft, radians from north. */
export function bearingFromTarget({ targetLat, targetLon, lat, lon }) {
  const dN = (lat - targetLat) * M_PER_DEG_LAT;
  const dE = (lon - targetLon) * mPerDegLon(targetLat);
  return Math.atan2(dE, dN);
}

/**
 * Advance one tick around the orbit.
 *
 * `theta` is the bearing from the target out to the aircraft. Returns
 * the new theta, the position on the circle, and the tangent heading.
 *
 * For a LEFT-hand orbit theta decreases: standing north of the target
 * and heading west, the target is off your left, and you track round
 * through north-west to west. The tangent heading is theta - 90
 * degrees, which is what puts the centre of the circle abeam to port.
 */
export function advanceOrbit({
  targetLat, targetLon, theta, radiusM, dt,
  bankRad = GUN_RUN_BANK_RAD,
  direction = ORBIT_LEFT,
  currentRadiusM = null,
  closureMs = 40,
}) {
  const v = orbitSpeedMs(radiusM, bankRad);
  const omega = v / radiusM;
  const next = norm(theta + direction * omega * dt);
  const mLon = mPerDegLon(targetLat);
  // SPIRAL IN, do not snap to the circle.
  //
  // Writing the position straight onto the orbit radius teleports the
  // aircraft the instant the engagement starts: it can declare arrival
  // a kilometre out and then appear 220 m from the target on the next
  // frame. That is the same "2 km jump" the standoff chase was written
  // to avoid, reintroduced by me.
  //
  // So the radius closes at a bounded rate and the aircraft spirals
  // onto the circle, which is also how a gun run is actually flown.
  const rNow = currentRadiusM == null
    ? radiusM
    : (currentRadiusM > radiusM
        ? Math.max(radiusM, currentRadiusM - closureMs * dt)
        : Math.min(radiusM, currentRadiusM + closureMs * dt));
  return {
    theta: next,
    radiusM: rNow,
    lat: targetLat + (rNow * Math.cos(next)) / M_PER_DEG_LAT,
    lon: targetLon + (rNow * Math.sin(next)) / mLon,
    // Tangent. Port gun looks at the centre, so the nose leads it by 90
    // degrees in the direction of travel.
    headingRad: norm(next + direction * (Math.PI / 2)),
    speedMs: v,
    omegaRadS: omega,
    bankRad,
    onCircle: Math.abs(rNow - radiusM) < 1,
  };
}
