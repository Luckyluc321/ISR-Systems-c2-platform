// NN output sources — the single seam between "how detections arrive" and
// the rest of the C2 platform. Every downstream layer (tick loop, event
// lifecycle, correlator, UI, agentic summary) consumes batches from an
// abstract NnOutputSource and cannot tell whether the source is mock
// simulation math or a real field sensor node stream. Per-site routing
// lives in nn_registry.js; this file only knows about the interface
// contract and the two implementations.
//
// See docs/interface-design-document.md IF-1 for the full contract.

import { SITES } from './sites.js';
import { ENERGINET_SITES } from './sites_energinet.js';

// Unified site lookup — sites are declared in two files today. Kept
// internal so the sources don't need to know about the split.
const _ALL_SITES = { ...SITES, ...ENERGINET_SITES };

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

// Confidence math shared with the current inline implementation in
// _updateContributingSensorsForPosition. Extracted here so both the mock
// source and any adapter that maps a customer feed to our schema uses
// the same clamp bounds.
function _sensorConfidenceForDistance(distM, coverageRadiusM) {
  return Math.min(0.98, Math.max(0.55, 1 - distM / coverageRadiusM));
}

// ─────────────────────────────────────────────────────────────────────
// MockNnOutputSource — reads sim state, emits detection batches.
// Drives every simulation, demo, training run, and internal test.
// ─────────────────────────────────────────────────────────────────────
export class MockNnOutputSource {
  constructor(siteId) {
    this.siteId = siteId;
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
            lat: p.lat,
            lon: p.lon,
            alt: p.alt,
            confidence: +_sensorConfidenceForDistance(dist, sensor.coverageRadius).toFixed(2),
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
