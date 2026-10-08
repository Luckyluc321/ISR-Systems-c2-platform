// ═══════════════════════════════════════════════════════════════════
// Trail policy — how long a track's trend line is, and when it draws
// ───────────────────────────────────────────────────────────────────
// The red dashed trend line behind a track answers two different
// questions depending on the environment, so it cannot have one
// setting.
//
// LIVE is operator-grade. The platform only knows what its sensors
// saw, so the trend line stops at the edge of coverage. Drawing it
// past that edge would assert a position no sensor reported, which is
// the whole reason the sensors-observe-only rule exists.
//
// SIM is the authoring and rehearsal environment. The object is still
// hidden outside coverage, because that is the behaviour being
// rehearsed, but the operator has to be able to FIND it: in the
// Billund Geran transit the track is invisible for most of a 268 km
// route, and a chase aircraft has nothing to fly toward. The trend
// line is that handle. It is a simulation aid and never ships as
// operator truth.
//
// WHY THE LINE WAS UNFINDABLE
//
// Both environments shared LIVE's numbers: 180 points appended every
// third animation frame. At 60 fps that is 20 points per second, so
// 180 points is a NINE SECOND tail. Behind a Geran-2 at 185 km/h that
// is about 460 m of line, trailing an invisible aircraft along a
// 268 km route. Nothing was broken and nothing had been removed; the
// line was simply three orders of magnitude shorter than the route.
//
// So SIM trades resolution for reach: append a tenth as often, keep
// far more, same order of memory. One point every ~26 m at Geran-2
// speed, which is far finer than a route line needs.
// ═══════════════════════════════════════════════════════════════════

/** Animation frames between trail appends. */
export const TRAIL_APPEND_EVERY_LIVE = 3;
export const TRAIL_APPEND_EVERY_SIM = 30;

/** Ring-buffer length, in points. */
export const TRAIL_POINTS_LIVE = 180;
export const TRAIL_POINTS_SIM = 6000;

/** Frames between appends for this environment. */
export function trailAppendEvery(isSim) {
  return isSim ? TRAIL_APPEND_EVERY_SIM : TRAIL_APPEND_EVERY_LIVE;
}

/** Ring-buffer length for this environment. */
export function trailMaxPoints(isSim) {
  return isSim ? TRAIL_POINTS_SIM : TRAIL_POINTS_LIVE;
}

/**
 * How much track the trend line covers, in seconds, at a given frame
 * rate. Exists so the span is a derived number nobody has to work out
 * by hand, and so a test can assert it rather than the raw constants.
 */
export function trailSpanSeconds(isSim, fps = 60) {
  return (trailMaxPoints(isSim) * trailAppendEvery(isSim)) / fps;
}

/**
 * Whether the trend line draws this frame.
 *
 * `suppressed` covers the reasons that outrank the environment: the
 * track is down, or the operator is inside it in first-person view and
 * the final segment would render across the camera.
 *
 * Outside coverage, SIM draws and LIVE does not. That asymmetry is the
 * entire point of this module.
 */
export function shouldShowTrail({ isSim, inCoverage, suppressed }) {
  if (suppressed) return false;
  return !!inCoverage || !!isSim;
}
