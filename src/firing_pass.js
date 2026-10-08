// ═══════════════════════════════════════════════════════════════════
// Firing pass — pointing the aircraft so a side gun can bear
// ───────────────────────────────────────────────────────────────────
// During an engagement the dispatch tick steers the aircraft's NOSE at
// the target. For a nose-mounted weapon that is right. For a door gun
// it is the one heading that cannot work.
//
// _gunStationAim rests the gun on the PORT BEAM and traverses 45
// degrees either side of it, so its arc is a relative bearing of -135
// to -45 degrees. Nose-on puts the target at relative bearing 0, which
// is 45 degrees outside the near stop. The gun swings as far as it can
// and holds there, which reads exactly as what Lucas saw: the gunner
// adjusts toward the contact and never fires.
//
// A real door-gun pass is flown, not pointed. The aircraft turns to put
// the target off the firing side and holds that heading through the
// burst. That is all this does: given where the target is, return the
// heading that lands it in the middle of the gun's arc.
//
//   gun points at:  heading + gunRest
//   want that to equal the bearing to the target
//   so:             heading = bearing - gunRest
//
// With a port rest of -90 degrees that is bearing + 90: to put a
// contact due north on your left, face east.
// ═══════════════════════════════════════════════════════════════════

/** Where the gun rests, as a relative bearing in radians. Port beam. */
export const GUN_REST_PORT_RAD = -Math.PI / 2;

const norm = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

/**
 * Heading that puts the target in the centre of the gun's arc.
 */
export function firingPassHeadingRad({
  bearingToTargetRad,
  gunRestRelativeRad = GUN_REST_PORT_RAD,
}) {
  return norm(bearingToTargetRad - gunRestRelativeRad);
}

/**
 * Can the gun actually bear on the target from this heading?
 *
 * Mirrors the clamp in _gunStationAim: the arc is `traverseLimitRad`
 * either side of the rest bearing. Exported so the caller can tell
 * "holding fire because it cannot bear" from "holding fire because it
 * is out of range", which are different problems with the same symptom.
 */
export function gunBears({
  headingRad,
  bearingToTargetRad,
  gunRestRelativeRad = GUN_REST_PORT_RAD,
  traverseLimitRad = (45 * Math.PI) / 180,
}) {
  const theta = norm(bearingToTargetRad - headingRad);
  return theta >= gunRestRelativeRad - traverseLimitRad
    && theta <= gunRestRelativeRad + traverseLimitRad;
}
