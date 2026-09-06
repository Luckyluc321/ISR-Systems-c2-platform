// ═══════════════════════════════════════════════════════════════════
// OpenSky Network cooperative-traffic adapter
// ───────────────────────────────────────────────────────────────────
// Free EU-friendly ADS-B feed. Dev + demo + first customer. Naviair
// adapter takes over as trusted production source once the partnership
// lands (contract stays identical — swap the registered adapter name).
//
// Rate limits (as of 2026):
//   Anonymous:    100 states/all requests per day per IP (bbox = 1 request)
//   Free account: 4000/day
//   Contributors: much higher
// Caching + on-demand polling (not continuous) keep us within limits.
//
// Endpoint: https://opensky-network.org/api/states/all
// Format:   { time, states: [ [icao24, callsign, origin_country, ...] ] }
// See: https://openskynetwork.github.io/opensky-api/rest.html
// ═══════════════════════════════════════════════════════════════════

import { registerCooperativeAdapter } from '../cooperative_traffic_source.js';

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';

// Poll-result cache — dedup rapid re-checks (Agent B + Agent 3 might
// both trigger within seconds). Key: bbox string. TTL: 60s so multiple
// events at the same site within a minute share one HTTP call.
const _cache = new Map();
const CACHE_TTL_MS = 60_000;

function _bboxKey(bbox) {
  return `${bbox.minLat.toFixed(3)},${bbox.minLon.toFixed(3)},${bbox.maxLat.toFixed(3)},${bbox.maxLon.toFixed(3)}`;
}

// OpenSky returns a fixed positional array per state — this is the
// documented index map. Kept as constants so the parse is auditable.
const IDX = {
  icao24: 0, callsign: 1, origin_country: 2, time_position: 3,
  last_contact: 4, lon: 5, lat: 6, baro_alt_m: 7, on_ground: 8,
  velocity_ms: 9, true_track_deg: 10, vertical_rate_ms: 11,
  sensors: 12, geo_alt_m: 13, squawk: 14, spi: 15, position_source: 16,
  category: 17,
};

// OpenSky category (index 17) mapping to our klass taxonomy. Absent
// or 0/1 = 'unknown' — most commercial airliners come through as
// 'unknown' unfortunately. Fall back to altitude+speed heuristics.
function _klassFromCategory(cat) {
  if (cat === 8) return 'helicopter_civilian';
  if (cat >= 2 && cat <= 6) return 'fixed_wing_commercial';   // Light through Heavy
  if (cat === 7) return 'fixed_wing_military';                // High Performance
  if (cat === 14) return 'uav';
  return 'unknown';
}

// Cheap heuristic when category is missing/unknown.
function _klassHeuristic(altM, speedMs) {
  if (altM == null && speedMs == null) return 'unknown';
  if (altM != null && altM < 300 && speedMs != null && speedMs < 80) return 'helicopter_civilian';
  if (altM != null && altM > 3000) return 'fixed_wing_commercial';
  return 'unknown';
}

function _parseState(state) {
  // OpenSky arrays are 17 or 18 elements — index 17 (category) is
  // optional in older responses. Require at least 17 for lat/lon/etc
  // (the fields we depend on); category defaults to undefined which
  // _klassFromCategory maps to 'unknown', triggering the altitude/
  // speed heuristic. Payloads under 17 elements are malformed.
  if (!Array.isArray(state) || state.length < 17) return null;
  const lat = state[IDX.lat];
  const lon = state[IDX.lon];
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const altM = state[IDX.geo_alt_m] ?? state[IDX.baro_alt_m] ?? null;
  const speedMs = state[IDX.velocity_ms] ?? null;
  const catKlass = _klassFromCategory(state[IDX.category]);
  const klass = catKlass !== 'unknown' ? catKlass : _klassHeuristic(altM, speedMs);
  const timePosition = state[IDX.time_position];
  const timestamp = timePosition ? new Date(timePosition * 1000).toISOString() : new Date().toISOString();
  return {
    callsign: state[IDX.callsign] ? String(state[IDX.callsign]).trim() : null,
    icao24: state[IDX.icao24] ? String(state[IDX.icao24]).trim() : null,
    lat, lon,
    alt_m: altM,
    heading_deg: state[IDX.true_track_deg] ?? null,
    speed_ms: speedMs,
    klass,
    timestamp,
    source: 'opensky',
    on_ground: !!state[IDX.on_ground],
  };
}

const openskyAdapter = {
  name: 'opensky',
  async getActiveTracks(bbox, _timeWindowSec) {
    const key = _bboxKey(bbox);
    const cached = _cache.get(key);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      return cached.tracks;
    }
    // OpenSky expects lamin, lomin, lamax, lomax
    const url = new URL(OPENSKY_URL);
    url.searchParams.set('lamin', bbox.minLat.toFixed(4));
    url.searchParams.set('lomin', bbox.minLon.toFixed(4));
    url.searchParams.set('lamax', bbox.maxLat.toFixed(4));
    url.searchParams.set('lomax', bbox.maxLon.toFixed(4));
    let res, json;
    try {
      res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
      if (!res.ok) {
        // 429 = rate-limited; 5xx = OpenSky degraded. Return empty +
        // annotate cache with error so caller can distinguish "0 tracks
        // in area" from "feed offline".
        const emptyErr = { ts: Date.now(), tracks: [], error: `HTTP ${res.status}` };
        _cache.set(key, emptyErr);
        return [];
      }
      json = await res.json();
    } catch (err) {
      const emptyErr = { ts: Date.now(), tracks: [], error: err.message };
      _cache.set(key, emptyErr);
      return [];
    }
    const states = Array.isArray(json?.states) ? json.states : [];
    const tracks = states.map(_parseState).filter(Boolean);
    _cache.set(key, { ts: Date.now(), tracks });
    return tracks;
  },
};

registerCooperativeAdapter('opensky', openskyAdapter);

export default openskyAdapter;
