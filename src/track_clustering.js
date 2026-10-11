// ═══════════════════════════════════════════════════════════════════
// Track clustering — who counts as flying together, right now
// ───────────────────────────────────────────────────────────────────
// NOT WIRED INTO ANYTHING YET. Nothing imports this file. It is stage
// one of three and exists so the grouping rule can be seen and tested
// on its own before any marker code changes.
//
// THE PROBLEM IT EXISTS FOR
//
// Today the decision "are these drones a swarm" is made inline, in the
// middle of the code that draws markers, at six separate call sites.
// Because the two are tangled, a swarm only produces an OUT OF RANGE
// marker when the LAST member leaves. A drone that falls behind and
// escapes is silent, which is exactly the case an operator most needs
// to see.
//
// Separating the two makes the escaping drone fall out for free: it is
// no longer near the others, so it is no longer in their cluster, so it
// is its own cluster, and its own cluster leaving coverage is an
// ordinary transition. No breakaway flag, no special case.
//
// TYPE FIRST, THEN DISTANCE
//
// Clustering is per platform type. A Shahed and a quadcopter a hundred
// metres apart are two threats, not one, and must never be merged into
// a single marker. An operator reading "2 of 5 out of range" needs
// those five to be the same kind of thing.
//
// SINGLE LINKAGE, DELIBERATELY
//
// Two drones are in the same cluster if a chain of neighbours connects
// them, each hop under the threshold. A line-astern formation strung
// out over 2 km is one group, which matches how it reads on a map,
// where a centroid test would split it arbitrarily.
//
// Pure functions, no Cesium, no state. That is the point: this can be
// tested with a list of coordinates and no browser.
// ═══════════════════════════════════════════════════════════════════

/**
 * How close two tracks of the same type must be to count as flying
 * together. Matches the existing SWARM_PROXIMITY_M so behaviour starts
 * identical to today; it is wide for "same formation" and is worth
 * revisiting now that it is a visible knob rather than a condition
 * buried in a marker branch.
 */
export const SWARM_PROXIMITY_M = 1000;

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function distanceM(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Group tracks that are flying together.
 *
 * `tracks` is [{ key, type, lat, lon, ... }]. Anything else on a track
 * is carried through untouched, so callers can hang their own state on
 * it. A track missing a position is dropped rather than guessed at.
 *
 * Returns [{ id, type, keys, members, lat, lon, size }] where id is
 * stable for the same membership, so a caller can tell "the same group
 * as last tick" from "a group that split".
 */
export function clusterTracks(tracks, { proximityM = SWARM_PROXIMITY_M } = {}) {
  const usable = (tracks || []).filter(
    (t) => t && t.key != null && Number.isFinite(t.lat) && Number.isFinite(t.lon),
  );

  const byType = new Map();
  for (const t of usable) {
    const type = t.type || 'unknown';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(t);
  }

  const clusters = [];
  for (const [type, group] of byType) {
    // Union-find over the proximity graph. Single linkage, so a strung
    // out formation stays one group.
    const parent = group.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; };

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (distanceM(group[i].lat, group[i].lon, group[j].lat, group[j].lon) <= proximityM) {
          union(i, j);
        }
      }
    }

    const buckets = new Map();
    group.forEach((t, i) => {
      const root = find(i);
      if (!buckets.has(root)) buckets.set(root, []);
      buckets.get(root).push(t);
    });

    for (const members of buckets.values()) {
      const keys = members.map((m) => m.key).sort();
      clusters.push({
        // Stable for the same membership, so the next stage can tell a
        // continuing group from one that split or merged.
        id: `${type}::${keys.join('+')}`,
        type,
        keys,
        members,
        size: members.length,
        lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
        lon: members.reduce((s, m) => s + m.lon, 0) / members.length,
      });
    }
  }
  // Largest first, then by id, so output order never depends on input
  // order. A test that depends on iteration order is a test that will
  // fail for the wrong reason later.
  clusters.sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));
  return clusters;
}

/**
 * How a departure should be worded, from the cluster it left and how
 * many of it went.
 *
 * Kept here rather than in the marker code because it is the same
 * question for every boundary — coverage, perimeter, entry, exit — and
 * having one answer is the point of the whole exercise.
 */
export function departureCardinality({ leaving, clusterSize }) {
  const n = Array.isArray(leaving) ? leaving.length : 0;
  if (n === 0) return { kind: 'none', count: 0 };
  if (n === 1) return { kind: 'single', count: 1, key: leaving[0] };
  if (n >= clusterSize) return { kind: 'whole', count: n };
  return { kind: 'partial', count: n, of: clusterSize };
}
