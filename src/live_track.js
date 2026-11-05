// ═══════════════════════════════════════════════════════════════════
// The live track: the engine's object, not a site's record
// ───────────────────────────────────────────────────────────────────
// Where an airframe or group is now, what the sensors see of it, the
// countdown after a loss, its projection and the sites it has crossed.
// The chase, the interceptors, the recording and the sweeper read it.
// Nobody owns it, no account is shown it as evidence, and it is never
// a case's field. A site's case records only what its own sensors saw,
// through src/site_case_scope.js.
//
// Keyed by the track id. In the simulation that is the first case's
// id, so every engine reader that keys on d.eventId keeps working.
// Live, it is the edge's object_id (track_source.js attaches identity;
// position does not travel through that seam, by design).
//
// Before 2026-11-05 all of this was written onto the first site's case
// every tick, also after that case had closed, so the airport case
// ended with Amager's last sighting and a later end time, and the
// airport company's report named another company's sensors. See
// docs/track-and-site-case-architecture.md.
//
// Pure data, no Cesium: render state stays in main.js's droneState.
// ═══════════════════════════════════════════════════════════════════

const TRACKS = new Map();   // trackId -> track

function _blank(trackId, siteId) {
  return {
    trackId,
    originSiteId: siteId || null,
    // The latest position, whoever saw it:
    // { lat, lon, alt, speed, heading, timestamp, inCoverage, siteIds }
    position: null,
    // The latest position ANY sensor saw, with the sites that saw it.
    lastSeen: null,
    // Set after a loss, cleared on re-acquisition:
    // { firstAt, classification, graceMs, reason, distanceM, lastSpeed, lastHeading, graceSeconds }
    temporaryLoss: null,
    // Projection input and output, as the tick computes them.
    projectionSnapshot: null,
    projectedPath: null,
    // Every site that has seen the track, in order of first sighting.
    sitesCrossed: [],
    // Engine bookkeeping that used to live on the case.
    prevCoverageSiteId: null,
    prevInCoverage: null,
    // Per-site aggregates for marker logic (processDroneSiteMarkers):
    // siteId -> { ... }. Maps keyed by drone id for coverage state.
    siteAgg: new Map(),
    droneCovState: new Map(),
    droneInsideState: new Map(),
    transitionLog: [],
    ended: false,
  };
}

/** Start, or return, the live track for an id. */
export function ensureTrack(trackId, siteId = null) {
  let t = TRACKS.get(trackId);
  if (!t) { t = _blank(trackId, siteId); TRACKS.set(trackId, t); }
  return t;
}

export function getTrack(trackId) {
  return TRACKS.get(trackId) || null;
}

export function removeTrack(trackId) {
  return TRACKS.delete(trackId);
}

/**
 * The track moved. `position` is { lat, lon, alt, speed, heading } and
 * `siteIds` the sites whose sensors see it (empty when none). Returns
 * the stored position.
 */
export function observe(trackId, position, siteIds = []) {
  const t = ensureTrack(trackId);
  const seen = Array.isArray(siteIds) ? siteIds.slice() : [];
  const pos = {
    lat: position.lat,
    lon: position.lon,
    alt: typeof position.alt === 'number' ? Math.round(position.alt) : null,
    speed: position.speed ?? null,
    heading: typeof position.heading === 'number' ? Math.round(position.heading) : null,
    timestamp: new Date().toISOString(),
    inCoverage: seen.length > 0,
    siteIds: seen,
  };
  t.position = pos;
  if (seen.length) {
    t.lastSeen = pos;
    for (const sid of seen) if (!t.sitesCrossed.includes(sid)) t.sitesCrossed.push(sid);
  }
  return pos;
}

/** Where the track is, or null. */
export function trackPosition(trackId) {
  return TRACKS.get(trackId)?.position || null;
}

/** The last position any sensor saw, with the sites that saw it. */
export function trackLastSeen(trackId) {
  return TRACKS.get(trackId)?.lastSeen || null;
}

export function setTemporaryLoss(trackId, loss) {
  const t = ensureTrack(trackId);
  t.temporaryLoss = loss || null;
  return t.temporaryLoss;
}

export function setProjection(trackId, snapshot, path) {
  const t = ensureTrack(trackId);
  if (snapshot !== undefined) t.projectionSnapshot = snapshot;
  if (path !== undefined) t.projectedPath = path;
  return t;
}

export function markTrackEnded(trackId) {
  const t = TRACKS.get(trackId);
  if (t) t.ended = true;
  return t || null;
}

export function _resetTracksForTest() {
  TRACKS.clear();
}
