// Wreckage cordon perimeter builder.
//
// Given a wreckage lat/lon, returns a cordon polygon that follows real
// street geometry around the site (Overpass API) or an 8-point compass
// polygon as fallback when Overpass times out. Also returns ingress
// points where patrol cars park to hold the cordon.
//
// Cache is per-wreckage — a wreckage id resolves once, then the same
// perimeter is reused. Patrol re-route logic reads from this cache.

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CORDON_RADIUS_M = 150;        // ~1-2 city blocks — 4 to 6 patrols cover it
const FETCH_TIMEOUT_MS = 4500;
const COMPASS_POINTS = 6;           // fewer vertices for a tighter ring
const INGRESS_POINTS = 4;           // one car per compass sector (N/E/S/W)

const _cache = new Map();           // wreckageId -> { perimeter, ingress, source }

function _keyOf(wreckageId) {
  return `wreck:${wreckageId}`;
}

// Move a lat/lon by meters along a heading (degrees, 0=N, 90=E).
function _offsetLatLon(lat, lon, distM, headingDeg) {
  const R = 6378137;
  const brng = headingDeg * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const angDist = distM / R;
  const lat2 = Math.asin(
    Math.sin(latRad) * Math.cos(angDist) +
    Math.cos(latRad) * Math.sin(angDist) * Math.cos(brng)
  );
  const lon2 = lonRad + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(latRad),
    Math.cos(angDist) - Math.sin(latRad) * Math.sin(lat2)
  );
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}

// Great-circle distance in meters.
function _distM(a, b) {
  const R = 6378137;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
  const A = s1 * s1 + Math.cos(a.lat * Math.PI / 180) *
    Math.cos(b.lat * Math.PI / 180) * s2 * s2;
  return 2 * R * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
}

// Build the compass fallback perimeter (uniform ring of N points).
function _compassPerimeter(lat, lon) {
  const pts = [];
  for (let i = 0; i < COMPASS_POINTS; i++) {
    const h = (i / COMPASS_POINTS) * 360;
    const p = _offsetLatLon(lat, lon, CORDON_RADIUS_M, h);
    pts.push([p.lat, p.lon]);
  }
  return pts;
}

// N ingress points spread evenly around the perimeter polygon,
// offset by 22.5deg so they don't overlap the polygon vertices.
function _ingressPoints(lat, lon, count) {
  const pts = [];
  const offset = 360 / count / 2;
  for (let i = 0; i < count; i++) {
    const h = (i / count) * 360 + offset;
    const p = _offsetLatLon(lat, lon, CORDON_RADIUS_M * 0.92, h);
    pts.push({ lat: p.lat, lon: p.lon, heading: h });
  }
  return pts;
}

// Query Overpass for street ways within CORDON_RADIUS_M of the wreckage.
// Returns array of {lat, lon} node coords for all matched ways.
async function _fetchStreetNodes(lat, lon) {
  const q = `
    [out:json][timeout:${Math.floor(FETCH_TIMEOUT_MS / 1000)}];
    (
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service)$"]
        (around:${CORDON_RADIUS_M + 60},${lat},${lon});
    );
    out geom;
  `.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = await res.json();
    const nodes = [];
    for (const el of data.elements || []) {
      if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
      for (const n of el.geometry) nodes.push({ lat: n.lat, lon: n.lon });
    }
    return nodes;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// For each cardinal heading (N,NE,E,SE,S,SW,W,NW), find the nearest
// street node to the ideal cordon point in that direction. Skip
// missing sectors — polygon still closes via remaining vertices.
function _buildStreetCordon(centerLat, centerLon, streetNodes) {
  const perimeter = [];
  for (let i = 0; i < COMPASS_POINTS; i++) {
    const h = (i / COMPASS_POINTS) * 360;
    const ideal = _offsetLatLon(centerLat, centerLon, CORDON_RADIUS_M, h);
    let best = null;
    let bestDist = Infinity;
    for (const n of streetNodes) {
      const d = _distM(ideal, n);
      // Sector tolerance scales with cordon size — never wider than
      // half the cordon radius so the polygon stays snug around the
      // wreckage instead of sprawling into neighbouring blocks.
      if (d > CORDON_RADIUS_M * 0.5) continue;
      if (d < bestDist) { bestDist = d; best = n; }
    }
    if (best) perimeter.push([best.lat, best.lon]);
  }
  // Need at least 4 vertices to form a meaningful polygon
  if (perimeter.length < 4) return null;
  return perimeter;
}

// Build (or return cached) cordon for a wreckage. Never throws —
// falls back to compass polygon on any error.
//
// wreckage: { id, lat, lon }
// returns: { perimeter: [[lat,lon],...], ingress: [{lat,lon,heading},...],
//            source: 'overpass' | 'compass' }
export async function buildCordon(wreckage) {
  const key = _keyOf(wreckage.id);
  if (_cache.has(key)) return _cache.get(key);

  let result;
  try {
    const nodes = await _fetchStreetNodes(wreckage.lat, wreckage.lon);
    const perimeter = _buildStreetCordon(wreckage.lat, wreckage.lon, nodes);
    if (perimeter) {
      result = {
        perimeter,
        ingress: _ingressPoints(wreckage.lat, wreckage.lon, INGRESS_POINTS),
        source: 'overpass',
      };
    } else {
      result = {
        perimeter: _compassPerimeter(wreckage.lat, wreckage.lon),
        ingress: _ingressPoints(wreckage.lat, wreckage.lon, INGRESS_POINTS),
        source: 'compass',
      };
    }
  } catch (err) {
    result = {
      perimeter: _compassPerimeter(wreckage.lat, wreckage.lon),
      ingress: _ingressPoints(wreckage.lat, wreckage.lon, INGRESS_POINTS),
      source: 'compass',
    };
  }
  _cache.set(key, result);
  return result;
}

// Synchronous, cache-only fetch. Returns null if buildCordon has not
// resolved yet for this wreckage. Used by the tick loop and renderer
// which cannot await.
export function getCordonSync(wreckageId) {
  return _cache.get(_keyOf(wreckageId)) || null;
}

// Instant compass ingress ring for a wreckage. Callers get real
// coordinates immediately, no waiting on the async Overpass build.
// The visual polygon (buildCordon) can upgrade to street-following
// later — patrol coords are already correct from the start.
export function ingressForWreckage(wreckage) {
  const cached = _cache.get(_keyOf(wreckage.id));
  if (cached && cached.ingress) return cached.ingress;
  return _ingressPoints(wreckage.lat, wreckage.lon, INGRESS_POINTS);
}

// Split N patrol cars across M wreckages, assigning each car an
// ingress point on the wreckage's cordon ring. Round-robin so each
// wreckage gets its first car before any wreckage gets a second.
// When N > M the extra cars spread around the ring, so 4 cars on 1
// wreckage cover 4 different compass sectors (N/NE/E/SE etc).
//
// wreckages MUST be objects with lat/lon, not just ids — the ingress
// fallback needs coordinates. Passing bare ids previously fell through
// to _ingressPoints(0, 0, ...) which is off the coast of Africa.
//
// patrolIds: string[]
// wreckages: [{ id, lat, lon }, ...]
// returns: Map<patrolId, { wreckageId, ingress: {lat,lon,heading} }>
export function assignPatrols(patrolIds, wreckages) {
  const assignments = new Map();
  if (!patrolIds.length || !wreckages.length) return assignments;

  const perWreckage = new Map();
  wreckages.forEach(w => perWreckage.set(w.id, []));
  patrolIds.forEach((pid, i) => {
    const wid = wreckages[i % wreckages.length].id;
    perWreckage.get(wid).push(pid);
  });

  for (const [wid, pids] of perWreckage.entries()) {
    const wreck = wreckages.find(w => w.id === wid);
    if (!wreck) continue;
    const ingressRing = ingressForWreckage(wreck);
    pids.forEach((pid, idx) => {
      const ingress = ingressRing[idx % ingressRing.length];
      assignments.set(pid, { wreckageId: wid, ingress });
    });
  }
  return assignments;
}

// Clear the cache for a specific wreckage id, or all if omitted.
// Used on scenario reset.
export function clearCordonCache(wreckageId) {
  if (wreckageId === undefined) {
    _cache.clear();
  } else {
    _cache.delete(_keyOf(wreckageId));
  }
}
