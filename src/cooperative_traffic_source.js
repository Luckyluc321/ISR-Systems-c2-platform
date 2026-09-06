// ═══════════════════════════════════════════════════════════════════
// Cooperative Traffic Source — abstract seam + registry
// ───────────────────────────────────────────────────────────────────
// Pluggable per-site adapter for cooperative-aircraft feeds (ADS-B via
// OpenSky, Naviair partner feed when it lands, mock for sim + eval).
// Consumed by cooperative_traffic_reconciler.js.
//
// Same architectural pattern as nn_source.js — one interface, per-site
// adapter selection driven by site_context.cooperative_traffic.source.
//
// Full design: docs/agentic-cooperative-traffic-fusion-architecture.md
// ═══════════════════════════════════════════════════════════════════

// Registry populated at boot by importing adapter modules. Adapter
// modules self-register via registerCooperativeAdapter('name', instance).
const _adapters = new Map();

export function registerCooperativeAdapter(name, adapter) {
  if (!name || typeof name !== 'string') throw new Error('adapter name required');
  if (!adapter || typeof adapter.getActiveTracks !== 'function') {
    throw new Error(`adapter ${name} missing getActiveTracks(bbox, timeWindow)`);
  }
  _adapters.set(name, adapter);
}

export function getCooperativeAdapter(name) {
  return _adapters.get(name) || null;
}

export function listCooperativeAdapters() {
  return [..._adapters.keys()];
}

// ── CoopTrack shape (returned by every adapter) ─────────────────────
// {
//   callsign:     string | null,         // "SAS1234", trimmed
//   icao24:       string | null,         // 24-bit hex ICAO transponder id
//   lat:          number,
//   lon:          number,
//   alt_m:        number | null,         // barometric or geometric altitude
//   heading_deg:  number | null,
//   speed_ms:     number | null,         // ground speed
//   klass:        string,                // 'fixed_wing_commercial' | 'helicopter_civilian' | 'fixed_wing_military' | 'unknown'
//   timestamp:    string,                // ISO
//   source:       string,                // adapter name that produced this track
// }
// ── bbox shape ──────────────────────────────────────────────────────
// { minLat, minLon, maxLat, maxLon }
