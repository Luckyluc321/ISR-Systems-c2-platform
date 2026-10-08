// ═══════════════════════════════════════════════════════════════════
// Trail policy — how long a track's trend line is, and when it draws
// ───────────────────────────────────────────────────────────────────
// The red dashed trend line behind a track answers a different
// question depending on where the track's position came from, so the
// policy is keyed on the TRACK's provenance, not on any global mode.
//
//   p.telemetrySource === 'live'  real sensor feed. Operator-grade.
//                                 The line stops at the edge of
//                                 coverage, because past that edge no
//                                 sensor reported a position and the
//                                 line would be asserting one. That is
//                                 the sensors-observe-only rule.
//
//   anything else (default 'sim') scenario template. The object is
//                                 still hidden outside coverage,
//                                 because that is the behaviour being
//                                 rehearsed, but the line runs the
//                                 whole route so the track can be
//                                 found and flown toward.
//
// Every threat track in the platform today is template-driven, so the
// line draws for all of them and the coverage gate stays dormant until
// a real feed lands. That is the seam, not a special case.
//
// DO NOT key this on _isSimMode(). That flag is the CINEMATIC toggle
// in the role menu: first-person drone view, jam-static overlay, night
// grading. It defaults to false, it says nothing about where a
// position came from, and gating on it both failed to light the line in
// sim and switched on the coverage gate for every track in the default
// mode, which removed the only trend line there was.
//
// WHY THE LINE WAS UNFINDABLE BEFORE
//
// One setting for everything: 180 points appended every third
// animation frame. At 60 fps that is 20 points per second, so 180
// points is a NINE SECOND tail — about 460 m behind a Geran-2 at
// 185 km/h, on a 268 km route.
//
// Lengthening that by raising the count alone would hand Cesium a
// 10 000-vertex polyline rebuilt twice a second. So a simulated track
// samples by DISTANCE instead of by time: a point every 120 m covers
// the Billund Geran transit in about 2 200 points and, unlike a
// time-based tail, a loitering drone does not bloat it.
// ═══════════════════════════════════════════════════════════════════

/** Real-feed tracks: short tail, time-sampled, stops at coverage. */
export const TRAIL_APPEND_EVERY_LIVE = 3;
export const TRAIL_POINTS_LIVE = 180;

/** Template tracks: whole-route line, distance-sampled. */
export const TRAIL_SIM_SPACING_M = 120;
export const TRAIL_POINTS_SIM = 4000;

/**
 * A track is treated as simulated unless its feed says otherwise.
 * Defaulting to simulated is deliberate: an untagged track is a
 * scenario track, and a missing tag must never silently claim to be a
 * real sensor observation.
 */
export function isSimulatedTrack(p) {
  return (p && p.telemetrySource) !== 'live';
}

/** Ring-buffer length for this track's provenance. */
export function trailMaxPoints(isSimTrack) {
  return isSimTrack ? TRAIL_POINTS_SIM : TRAIL_POINTS_LIVE;
}

/**
 * Whether to add a point this frame.
 *
 * `movedM` is metres since the last appended point, or null when there
 * is no previous point yet, which always appends so a line starts
 * immediately.
 */
export function shouldAppendTrailPoint({ isSimTrack, frameCounter, movedM }) {
  if (isSimTrack) return movedM == null || movedM >= TRAIL_SIM_SPACING_M;
  return frameCounter % TRAIL_APPEND_EVERY_LIVE === 0;
}

/** Route length a full buffer covers, in km, for a simulated track. */
export function trailSpanKm() {
  return (TRAIL_POINTS_SIM * TRAIL_SIM_SPACING_M) / 1000;
}

/**
 * Whether the trend line draws this frame.
 *
 * `suppressed` outranks provenance: the track is down, or the operator
 * is inside it in first-person view where the final segment would
 * render across the camera.
 *
 * Outside coverage a simulated track draws and a real-feed track does
 * not. That asymmetry is the entire point of this module.
 */
export function shouldShowTrail({ isSimTrack, inCoverage, suppressed }) {
  if (suppressed) return false;
  return !!inCoverage || !!isSimTrack;
}

// ── Unobserved breadcrumb ──────────────────────────────────────────
// The red dashed line that marks where a track went while NO sensor
// could see it. The swarm members have had this all along as
// `sw.projLine`; the single-drone path did not, so a track that left
// coverage simply vanished off the map.
//
// Distance-sampled for the same reason the trail is: the swarm appends
// one point per tick and caps at 300, which is 5 s of flight at 60 fps.
// That is fine for a short run out to sea and useless across an
// 87 minute transit.

/** Add a breadcrumb point? `movedM` is null when there is none yet. */
export function shouldAppendBreadcrumb(movedM) {
  return movedM == null || movedM >= TRAIL_SIM_SPACING_M;
}

export const BREADCRUMB_POINTS_MAX = TRAIL_POINTS_SIM;

/**
 * Whether the breadcrumb draws.
 *
 * Needs two points to be a line at all. Suppressed for a real sensor
 * feed: out of coverage nothing observed the track, so nothing is
 * drawn. That is the whole difference between the two environments.
 */
export function shouldShowBreadcrumb({ isSimTrack, pointCount, suppressed }) {
  if (suppressed || !isSimTrack) return false;
  return pointCount >= 2;
}
