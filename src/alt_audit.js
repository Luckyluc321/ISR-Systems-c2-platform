// ═══════════════════════════════════════════════════════════════════
// Altitude audit — how high does each scenario really fly
// ───────────────────────────────────────────────────────────────────
// A template's `alt` is rendered as height above the WGS84 ellipsoid,
// and Danish ground sits 37 m or more above it (plus the terrain's own
// height). So "alt: 50" can be 8 m over an apron, or under the ground
// at an inland site. The recon swarm flew through Terminal 3 that way.
//
// This measures it rather than estimating it. It samples the SAME
// terrain provider the map renders against, under the waypoints of
// every template (evenly spaced plus the lowest ones), and reports the
// lowest height above bare ground found. Not buildings, not the legs
// between waypoints: the clearance target is the margin for both. Read-only: it writes nothing, spawns nothing, and changes
// no template. The numbers it prints are what a fix is sized from.
//
// Console:   await __isr_altAudit()              clearance target 40 m
//            await __isr_altAudit({ clearM: 60 })
//
// Templates with terrainRelativeAlt already render alt as height above
// ground, so they are reported as such and never flagged.
// ═══════════════════════════════════════════════════════════════════

const MAX_SAMPLES_PER_TEMPLATE = 60;

// The lowest-flying points are what the audit exists to find, so they
// are always kept, whatever the even spacing would have dropped.
const KEEP_LOWEST = 20;

/** Evenly spaced subset, always keeping the first and last point AND
 *  the KEEP_LOWEST lowest-altitude airborne points, in path order. */
export function subsample(points, max = MAX_SAMPLES_PER_TEMPLATE) {
  if (!Array.isArray(points) || points.length <= max) return points || [];
  const idx = new Set();
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) idx.add(Math.round(i * step));
  points
    .map((w, i) => [w?.alt, i])
    .filter(([a]) => typeof a === 'number' && a > 1)
    .sort((x, y) => x[0] - y[0])
    .slice(0, KEEP_LOWEST)
    .forEach(([, i]) => idx.add(i));
  return [...idx].sort((a, b) => a - b).map(i => points[i]);
}

// Swarm members fly with up to this much altitude noise per waypoint on
// top of their formation offset (main.js _generatePerDroneWaypoints).
// Counted against clearance so a wingman cannot sit below what the
// audit reports.
export const MEMBER_ALT_NOISE_M = 5;

/** The lowest a swarm member sits relative to its lead, metres (<= 0). */
export function lowestMemberOffsetM(template) {
  const f = template?.swarm?.formation;
  if (!Array.isArray(f) || !f.length) return 0;
  return Math.min(0, ...f.map(m => m?.offset?.up ?? 0)) - MEMBER_ALT_NOISE_M;
}

/**
 * One audit row from a template and the ground height (ellipsoidal,
 * metres) under each of its sampled waypoints. Pure; the browser
 * wrapper below supplies the ground.
 */
export function auditRow(key, template, sampled, groundM, clearM = 40) {
  const terrainRel = !!template.terrainRelativeAlt;
  const memberDrop = lowestMemberOffsetM(template);
  let min = Infinity, at = null;
  for (let i = 0; i < sampled.length; i++) {
    const w = sampled[i];
    // Surface legs (an airliner on the runway, a boat) are not flight.
    if (!(typeof w.alt === 'number') || w.alt <= 1) continue;
    const g = groundM[i];
    if (typeof g !== 'number' || !isFinite(g)) continue;
    const agl = (terrainRel ? w.alt : w.alt - g) + memberDrop;
    if (agl < min) { min = agl; at = { w, g }; }
  }
  if (!at) return null;
  const short = Math.max(0, clearM - min);
  return {
    key,
    site: template.siteId || '',
    platform: template.platform || '',
    datum: terrainRel ? 'above ground' : 'ellipsoid',
    minAglM: Math.round(min),
    atTSec: Math.round(at.w.tSec ?? 0),
    altThereM: Math.round(at.w.alt),
    groundThereM: Math.round(at.g),
    lowestMemberM: memberDrop,
    // Rounded UP to the next 5 m so a raise taken from this column
    // clears the target rather than landing a metre short of it.
    raiseToClearM: terrainRel ? 0 : Math.ceil(short / 5) * 5,
  };
}

export function createAltAudit({ Cesium, viewer, templates }) {
  return async function altAudit({ clearM = 40 } = {}) {
    const keys = Object.keys(templates || {});
    const jobs = [];
    for (const key of keys) {
      const t = templates[key];
      const wps = Array.isArray(t?.waypoints) ? t.waypoints : null;
      if (!wps || !wps.length) continue;
      jobs.push({ key, t, sampled: subsample(wps) });
    }
    const carts = [];
    for (const j of jobs) {
      for (const w of j.sampled) carts.push(Cesium.Cartographic.fromDegrees(w.lon, w.lat));
    }
    console.log(`[alt_audit] sampling terrain under ${carts.length} points across ${jobs.length} templates...`);
    const sampledCarts = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, carts);
    let k = 0;
    const rows = [];
    for (const j of jobs) {
      const ground = j.sampled.map(() => sampledCarts[k++]?.height);
      const r = auditRow(j.key, j.t, j.sampled, ground, clearM);
      if (r) rows.push(r);
    }
    rows.sort((a, b) => a.minAglM - b.minAglM);
    console.table(rows);
    // Said, not dropped. A template with no airborne waypoint the terrain
    // could answer for is NOT a pass, it is a gap in this audit.
    const missed = jobs.map(j => j.key).filter(k => !rows.some(r => r.key === k));
    if (missed.length) console.warn(`[alt_audit] not measured (no airborne point with terrain under it): ${missed.join(', ')}`);
    console.log('[alt_audit] measured against bare terrain at waypoints, not buildings and not the legs between them. The clearance target is what covers both.');
    const flagged = rows.filter(r => r.raiseToClearM > 0);
    console.log(`[alt_audit] ${flagged.length} of ${rows.length} templates fly lower than ${clearM} m above ground at some point. Paste the line below to Claude.`);
    const compact = JSON.stringify({ clearM, missed, rows: rows.map(r => [r.key, r.minAglM, r.atTSec, r.altThereM, r.groundThereM, r.lowestMemberM, r.datum === 'above ground' ? 'AGL' : 'ELL']) });
    console.log(compact);
    return compact;
  };
}
