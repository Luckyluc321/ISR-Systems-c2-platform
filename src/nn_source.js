// NN output sources — the single seam between "how detections arrive" and
// the rest of the C2 platform. Every downstream layer (tick loop, event
// lifecycle, correlator, UI, agentic summary) consumes batches from an
// abstract NnOutputSource and cannot tell whether the source is mock
// simulation math or a real field sensor node stream. Per-site routing
// lives in nn_registry.js; this file only knows about the interface
// contract and the two implementations.
//
// See docs/interface-design-document.md IF-1 for the full contract.
//
// PROVENANCE. Every batch and every detection inside it carries
// `source: 'sim' | 'live'`. It is not decoration. A site can be mixed,
// with real sensors watching real airspace while a training scenario
// runs alongside, and once those two streams touch there is no way to
// tell them apart after the fact. An operator reading a case file, and
// the agentic layer writing one, both have to know which observations
// were real. Tagging is cheap now and impossible to retrofit later.

import { SITES } from './sites_registry.js';

// Site lookup for source implementations. sites_registry.js loads every
// sites/*.yaml manifest so the source doesn't need to know about site
// definitions being sharded across files.
const _ALL_SITES = SITES;

// Haversine distance in metres. Duplicated locally so this module stays
// dependency-free from main.js (main.js's own helper is not exported).
function _haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─────────────────────────────────────────────────────────────────────
// NnOutputSource — abstract contract
// ─────────────────────────────────────────────────────────────────────
//
// Every source implements:
//   siteId              — string, matches a key in SITES/SITES_ENERGINET
//   start()             — idempotent lifecycle up
//   stop()              — idempotent lifecycle down
//   onDetection(cb)     — register a batch listener
//   ingestPositions(ps) — mock-only path; real sources ignore this
//
// The mock source is push-driven from the sim tick (ingestPositions),
// so start()/stop() are no-ops for it. The WebSocket source manages its
// own reconnection lifecycle inside start()/stop().
// ─────────────────────────────────────────────────────────────────────

// Confidence math shared with any adapter that maps a customer feed to
// our schema, so a real source and the mock agree on what the number
// means.
//
// THE OLD CLAMP WAS THE WHOLE PROBLEM:
//
//   Math.min(0.98, Math.max(0.55, 1 - distM / coverageRadiusM))
//
// The lower bound meant every sensor past 45 per cent of its radius
// returned EXACTLY 0.55. Not approximately. The same float, from every
// sensor, every tick. Downstream they then decayed in lockstep from the
// same starting value, so four or five sensors showed 0.25, then 0.32,
// then whatever, perfectly in step for the whole early phase.
//
// Two wobbles were added downstream trying to fix this and neither could
// work, because the merge that consumes this only ever RAISES a sensor's
// value. Once every sensor is pinned at the same ceiling there is no tie
// left to break. The fix has to be here, at the reading.
//
// Now it falls off properly with range: 0.98 overhead down to 0.12 at
// the edge of the radius, so distance actually separates sensors.
//
// PER-SENSOR VARIATION, PHASED OFF THE SENSOR ID. A real receiver's
// confidence moves with multipath, antenna orientation and noise, and no
// two units move together. Deterministic, so a replay of the same second
// reproduces the same reading.
const _CONF_EDGE = 0.12, _CONF_PEAK = 0.98, _CONF_WANDER = 0.05;
function _idPhase(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) % 997;
  return (h / 997) * Math.PI * 2;
}
function _sensorConfidenceForDistance(distM, coverageRadiusM, sensorId, tSec) {
  const q = Math.max(0, Math.min(1, 1 - distM / coverageRadiusM));
  const base = _CONF_EDGE + (_CONF_PEAK - _CONF_EDGE) * q;
  if (sensorId == null || tSec == null) return base;
  const ph = _idPhase(sensorId);
  const w = _CONF_WANDER * (0.6 * Math.sin(tSec * 0.51 + ph) + 0.4 * Math.sin(tSec * 0.21 + ph * 1.7));
  return Math.max(0.08, Math.min(_CONF_PEAK, base + w));
}

// ─────────────────────────────────────────────────────────────────────
// MockNnOutputSource — reads sim state, emits detection batches.
// Drives every simulation, demo, training run, and internal test.
// ─────────────────────────────────────────────────────────────────────
export class MockNnOutputSource {
  constructor(siteId) {
    this.siteId = siteId;
    this.source = 'sim';
    this._listeners = new Set();
    this._started = false;
  }
  start() { this._started = true; }
  stop()  { this._started = false; }
  onDetection(cb) {
    if (typeof cb === 'function') this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
  // Sim-driven push path. Called by the tick loop with the current drone
  // positions for this site. Positions are shaped
  //   [{ lat, lon, alt?, droneKey?, modalityMix? }]
  // and can contain drones from multiple events — the source doesn't
  // filter by event, only by whether the position falls inside any of
  // this site's sensor coverage circles.
  ingestPositions(positions) {
    if (!this._started || !this._listeners.size) return;
    const site = _ALL_SITES[this.siteId];
    if (!site?.sensors?.length) return;
    const batch = {
      siteId: this.siteId,
      source: 'sim',
      tickTs: new Date().toISOString(),
      sensors: [],
    };
    for (const sensor of site.sensors) {
      const sensorEntry = {
        sensorId: sensor.id,
        status: sensor.status === 'offline' ? 'offline' : 'online',
        detections: [],
      };
      if (sensor.status !== 'offline') {
        for (const p of positions) {
          if (p?.lat == null || p?.lon == null) continue;
          const dist = _haversineM(p.lat, p.lon, sensor.lat, sensor.lon);
          if (dist > sensor.coverageRadius) continue;
          sensorEntry.detections.push({
            source: 'sim',
            lat: p.lat,
            lon: p.lon,
            alt: p.alt,
            confidence: +_sensorConfidenceForDistance(dist, sensor.coverageRadius, sensor.id, Date.now() / 1000).toFixed(2),
            droneKey: p.droneKey,
            modalityMix: p.modalityMix || sensor.modalities,
          });
        }
      }
      batch.sensors.push(sensorEntry);
    }
    for (const cb of this._listeners) {
      try { cb(batch); } catch (_) { /* one listener error must not kill the tick */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// WebSocketNnOutputSource — real field node stream.
// Not wired to real hardware yet; the class exists so the seam is
// visible in the code and so nn_registry.js can construct it once a
// site is switched from 'mock' to 'websocket'. Reconnect + auth
// behaviour is fully specified in IDD IF-1.3.
// ─────────────────────────────────────────────────────────────────────
export class WebSocketNnOutputSource {
  constructor(siteId, url, opts = {}) {
    this.siteId = siteId;
    this.source = 'live';
    this.url = url;
    this.auth = opts.auth || null;
    this._listeners = new Set();
    this._ws = null;
    this._backoffMs = 1000;
    this._maxBackoffMs = 30_000;
    this._closedByUser = false;
  }
  start() {
    this._closedByUser = false;
    this._connect();
  }
  stop() {
    this._closedByUser = true;
    if (this._ws) {
      try { this._ws.close(); } catch (_) { /* swallow */ }
      this._ws = null;
    }
  }
  onDetection(cb) {
    if (typeof cb === 'function') this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
  // Real hardware doesn't need sim positions. Kept as a no-op so the
  // tick loop can call the same method on every source without
  // discriminating on type.
  ingestPositions(_positions) { /* no-op */ }

  _connect() {
    if (this._closedByUser) return;
    const url = this.auth ? `${this.url}?token=${encodeURIComponent(this.auth)}` : this.url;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (_) {
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;
    ws.onopen = () => {
      this._backoffMs = 1000;   // reset backoff on successful connect
    };
    ws.onmessage = (evt) => {
      let batch;
      try { batch = JSON.parse(evt.data); } catch (_) { return; }
      // Site-scoped delivery: reject batches whose siteId doesn't match
      // this source's site. Prevents a compromised node from injecting
      // detections into another site's stream.
      if (!batch || batch.siteId !== this.siteId) return;
      // Provenance is stamped HERE, by the source that received it, and
      // never taken from the wire. A field node cannot declare its own
      // data simulated, and a mislabelled batch would put fabricated
      // observations into a real case file.
      batch.source = 'live';
      for (const se of (batch.sensors || [])) {
        for (const det of (se.detections || [])) det.source = 'live';
      }
      for (const cb of this._listeners) {
        try { cb(batch); } catch (_) { /* isolate listener errors */ }
      }
    };
    const _onClose = () => {
      this._ws = null;
      this._emitOfflineBatch();
      this._scheduleReconnect();
    };
    ws.onerror = _onClose;
    ws.onclose = _onClose;
  }
  _scheduleReconnect() {
    if (this._closedByUser) return;
    const delay = this._backoffMs;
    this._backoffMs = Math.min(this._maxBackoffMs, this._backoffMs * 2);
    setTimeout(() => this._connect(), delay);
  }
  // On disconnect, emit a batch that marks every sensor at this site as
  // offline, so downstream degradation logic is uniform whether the
  // signal loss is per-sensor (from a real batch) or connection-wide.
  _emitOfflineBatch() {
    const site = _ALL_SITES[this.siteId];
    if (!site?.sensors?.length || !this._listeners.size) return;
    const batch = {
      siteId: this.siteId,
      tickTs: new Date().toISOString(),
      sensors: site.sensors.map(s => ({
        sensorId: s.id,
        status: 'offline',
        detections: [],
      })),
    };
    for (const cb of this._listeners) {
      try { cb(batch); } catch (_) { /* isolate listener errors */ }
    }
  }
}
