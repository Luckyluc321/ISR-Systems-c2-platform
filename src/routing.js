// Driving-route lookup for ground-based counter-response dispatches
// (police-c-uas, army-ground). Uses the free public OSRM instance to
// compute a real street-network path between base and threat.
//
// Rate limit: OSRM public demo caps at ~1 req/sec. We cache aggressively
// keyed by rounded lat/lon so repeat dispatches to nearby points reuse
// prior lookups.
//
// SOVEREIGNTY NOTE: this is an external, third-party endpoint. Fine for
// demo. Migrate to a self-hosted OSRM container on Denmark OSM extract
// before any production deployment. Interface is stable — swap the
// endpoint URL and cache behaviour is unchanged.

const ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';
const CACHE = new Map();
const CACHE_KEY_PRECISION = 3;   // ~110m rounding, aggressive dedup

function _cacheKey(from, to) {
  const p = CACHE_KEY_PRECISION;
  return `${from.lat.toFixed(p)},${from.lon.toFixed(p)}|${to.lat.toFixed(p)},${to.lon.toFixed(p)}`;
}

// Returns [{lat, lon}, ...] following actual streets from origin to
// destination. Null on any failure — caller should fall back to a
// straight-line path in that case.
export async function fetchDrivingRoute(from, to, opts = {}) {
  const { timeoutMs = 4000 } = opts;
  const key = _cacheKey(from, to);
  if (CACHE.has(key)) return CACHE.get(key);

  const url = `${ENDPOINT}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('OSRM no route');
    // GeoJSON coordinates are [lon, lat]. Convert to {lat, lon}.
    const positions = data.routes[0].geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
    CACHE.set(key, positions);
    return positions;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('[routing] driving route fetch failed:', err.message);
    return null;
  }
}

// Great-circle metres between two {lat, lon} points. Duplicated here so
// this module has zero dependencies on the main app; the caller may
// have its own haversine but we keep this self-contained.
export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sa = Math.sin(dLat / 2) ** 2 +
             Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
             Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

// Precompute segment lengths (metres) along a polyline. Enables
// distance-based advance without recomputing per tick.
export function computeSegmentLengths(positions) {
  const lengths = [];
  for (let i = 1; i < positions.length; i++) {
    lengths.push(haversineMeters(positions[i - 1], positions[i]));
  }
  return lengths;
}

// Advance a "cursor" along a polyline by stepMeters. Returns the new
// {lat, lon, segIdx, segProgress, headingRad, isEnd}. segProgress is
// a fraction 0..1 within the current segment. isEnd is true when we
// reached (or passed) the final vertex.
export function advanceAlongPolyline(positions, segmentLengths, segIdx, segProgress, stepMeters) {
  let idx = segIdx;
  let prog = segProgress;
  let remaining = stepMeters;

  while (idx < positions.length - 1 && remaining > 0) {
    const segLen = segmentLengths[idx];
    const distLeftInSeg = segLen * (1 - prog);
    if (remaining < distLeftInSeg) {
      prog += remaining / segLen;
      remaining = 0;
    } else {
      remaining -= distLeftInSeg;
      idx++;
      prog = 0;
    }
  }

  // If we passed the end, clamp to final vertex
  if (idx >= positions.length - 1) {
    const last = positions[positions.length - 1];
    const prev = positions[positions.length - 2] || last;
    const bearing = Math.atan2(last.lon - prev.lon, last.lat - prev.lat);
    return { lat: last.lat, lon: last.lon, segIdx: positions.length - 1, segProgress: 1, headingRad: bearing, isEnd: true };
  }

  const a = positions[idx];
  const b = positions[idx + 1];
  const lat = a.lat + (b.lat - a.lat) * prog;
  const lon = a.lon + (b.lon - a.lon) * prog;
  const bearing = Math.atan2(b.lon - a.lon, b.lat - a.lat);
  return { lat, lon, segIdx: idx, segProgress: prog, headingRad: bearing, isEnd: false };
}
