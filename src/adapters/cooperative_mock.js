// ═══════════════════════════════════════════════════════════════════
// Mock cooperative-traffic adapter (sim + eval)
// ───────────────────────────────────────────────────────────────────
// Returns deterministic synthetic tracks per site so the reconciler +
// eval fixtures have something to match against without hitting a real
// external endpoint. Site-keyed via bbox lookup — first bbox that
// covers a known site returns that site's synthetic traffic mix.
//
// Extend by adding entries to SITE_MOCK_TRAFFIC below. Keeping this
// intentionally tiny + inspectable — mocks that grow into their own
// simulation engine are a smell.
// ═══════════════════════════════════════════════════════════════════

import { registerCooperativeAdapter } from '../cooperative_traffic_source.js';

// Synthetic traffic keyed by site anchor point + radius. When the
// bbox center falls within radiusKm of a known anchor, return that
// site's synthetic tracks. Otherwise return empty.
const SITE_MOCK_TRAFFIC = [
  {
    siteId: 'cph',
    anchor: { lat: 55.61806, lon: 12.65611 },
    radiusKm: 20,
    tracks: [
      // Commercial airliner on final approach to 04L
      { callsign: 'SAS831',  icao24: '4a5c9e', klass: 'fixed_wing_commercial',
        lat: 55.6350, lon: 12.6280, alt_m: 850, heading_deg: 40, speed_ms: 78 },
      // Cargo departure off 22R
      { callsign: 'DHL7',    icao24: '4bcaa1', klass: 'fixed_wing_commercial',
        lat: 55.5990, lon: 12.6340, alt_m: 1200, heading_deg: 220, speed_ms: 95 },
      // Politi helicopter overflight (transit N perimeter, per site context)
      { callsign: 'DK-POLA', icao24: '3e0011', klass: 'helicopter_civilian',
        lat: 55.6420, lon: 12.6580, alt_m: 250, heading_deg: 90, speed_ms: 45 },
    ],
  },
  {
    siteId: 'billund',
    anchor: { lat: 55.7404, lon: 9.1518 },
    radiusKm: 15,
    tracks: [
      { callsign: 'RYR2A',  icao24: '4ca7e1', klass: 'fixed_wing_commercial',
        lat: 55.7500, lon: 9.1400, alt_m: 900, heading_deg: 100, speed_ms: 80 },
    ],
  },
  {
    siteId: 'esbjerg',
    anchor: { lat: 55.4680, lon: 8.4550 },
    radiusKm: 12,
    tracks: [
      // Offshore wind O&M helicopter (per site context)
      { callsign: 'DK-CHC1', icao24: '3e0210', klass: 'helicopter_civilian',
        lat: 55.4750, lon: 8.4400, alt_m: 200, heading_deg: 270, speed_ms: 50 },
    ],
  },
];

function _distKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
  const A = s1 * s1 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * s2 * s2;
  return 2 * R * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
}

function _bboxCenter(bbox) {
  return { lat: (bbox.minLat + bbox.maxLat) / 2, lon: (bbox.minLon + bbox.maxLon) / 2 };
}

const mockAdapter = {
  name: 'mock',
  async getActiveTracks(bbox, _timeWindowSec) {
    const center = _bboxCenter(bbox);
    const now = new Date().toISOString();
    for (const entry of SITE_MOCK_TRAFFIC) {
      if (_distKm(center, entry.anchor) <= entry.radiusKm) {
        return entry.tracks.map(t => ({
          ...t,
          timestamp: now,
          source: 'mock',
          on_ground: false,
        }));
      }
    }
    return [];
  },
};

registerCooperativeAdapter('mock', mockAdapter);

export default mockAdapter;
