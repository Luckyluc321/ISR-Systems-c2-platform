// ═══════════════════════════════════════════════════════════════════
// Site case scope: a site's case holds only what its own sensors saw
// ───────────────────────────────────────────────────────────────────
// Lucas's rule (2026-11-05): a site's case keeps only what that site's
// own sensors saw. Its end time is the last sighting at that site.
// Nothing is written to a closed case.
//
// The two questions, pure and testable, so main.js has one answer to
// each rather than seven guards that drift. See
// docs/track-and-site-case-architecture.md.
//
// Pure: no imports, no globals, no Cesium. The sensor test is injected
// as `sees(siteId, lat, lon, altM)`, which in main.js is
// _sensorSeesPoint with the sensor ceiling, the same predicate the
// swarm's site membership and the operator map fence use.
// ═══════════════════════════════════════════════════════════════════

/**
 * Whether a case may receive an observation at all: it is open, and it
 * is the case of the site the observation belongs to.
 */
export function caseAccepts(caseRecord, siteId) {
  if (!caseRecord || !siteId) return false;
  if (caseRecord.status !== 'active') return false;
  return caseRecord.siteId === siteId;
}

/**
 * The observation a site may record from a track position: the
 * position itself, if that site's sensors see it, else null. Never a
 * position another site's sensors saw.
 *
 * sees(siteId, lat, lon, altM) -> boolean
 */
export function observationFor(siteId, position, sees) {
  if (!siteId || !position || typeof sees !== 'function') return null;
  const { lat, lon } = position;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const altM = typeof position.alt === 'number' ? position.alt : 0;
  return sees(siteId, lat, lon, altM) ? position : null;
}

/**
 * The sites whose sensors see a position, among the given site ids.
 * The overlap is honest: a point both sites see is both sites'
 * observation.
 */
export function sitesSeeing(siteIds, position, sees) {
  const out = [];
  for (const sid of siteIds || []) {
    if (observationFor(sid, position, sees)) out.push(sid);
  }
  return out;
}

/**
 * The one gate every tick write to a case goes through. Returns the
 * fields to write, or null when the write is dropped: the case is not
 * open, is not this site's, or the site's sensors did not see the
 * position the fields describe.
 *
 * `fields` describe an observation at `position`. A write with no
 * position (a status or note that is not about where the track is)
 * passes on caseAccepts alone.
 */
export function siteObservationWrite(caseRecord, siteId, position, fields, sees) {
  if (!caseAccepts(caseRecord, siteId)) return null;
  if (position != null && !observationFor(siteId, position, sees)) return null;
  return fields;
}
