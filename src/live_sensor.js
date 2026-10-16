// ═══════════════════════════════════════════════════════════════════════════
// LIVE SENSOR — the first real ISR sensor node on the C2 map
// ═══════════════════════════════════════════════════════════════════════════
//
// One HackRF on a Radxa ROCK 4 SE, placed at a lat/lon Lucas supplies, that
// opens a detection when the neural network says DRONE. Everything here is
// ADDITIVE: it registers a sensor record into the site the sensor belongs
// to, draws the same sensor symbol every other sensor uses, and feeds the
// existing detection lifecycle. It does not modify any existing sensor
// infrastructure and it does not own a lifecycle of its own.
//
// How the lifecycle runs for a live event (the sensor plug-in contract):
//
//   open    detect() builds an NnDetectionBatch (IF-1.4) with source 'live',
//           creates the event through addEvent, folds the batch in through
//           the same _applyDetectionBatchToEvent the mock path uses. That
//           stamps _lastDetectionTs, the sweeper's recency clock.
//   hold    every further DRONE frame refreshes _lastDetectionTs and the
//           sensor's confidence. BACKGROUND frames do nothing: they are the
//           network saying nothing is there, and the C2 is not the
//           classifier.
//   close   _sweepUnobservedActiveEvents in main.js closes any detected
//           event that owns no render track and has had no detection for
//           its grace window, with the outcome 'lost contact' and a note.
//           A live event deliberately has NO droneState entry so that
//           sweeper, and only that sweeper, governs its close. The summary
//           report is generated at closeEvent as for every other event.
//
// What a single sensor can honestly say: presence inside its radius, not
// a fix. The detection position is therefore the sensor's own position,
// stamped positionKind: 'sensor-anchor', which is SAPIENT's range_bearing
// without a range. Localisation needs several sensors and is out of scope.
//
// The 1 km coverage radius is the current sensor generation's working
// figure. It is hardcoded on purpose and is not a parameter of anything
// here. See the site manifests under sites/, every sensor carries the same
// figure.
//
// This module imports no Cesium and nothing from main.js, so it loads under
// plain Node and scripts/check-live-sensor.mjs exercises it. Side effects on
// the viewer and on event state happen through dependencies main.js injects
// into createLiveSensorRuntime, at the one call seam.
//
// Console entry points installed by main.js:
//   __isr_liveSensor(lat, lon, { siteId?, id?, nodeId?, label? })
//   __isr_liveDetect({ confidence | probability, label?, nodeId?, sensorId? })
//   __isr_liveSensors.startFeed('ws://<laptop>:8000/ws/detections')
// ═══════════════════════════════════════════════════════════════════════════

import { wallNow } from './sim_clock.js';

export const LIVE_SOURCE = 'live';
export const LIVE_FEED_ID = 'isr_sensor_nodes';
export const LIVE_DETECTION_LABEL = 'DRONE';
export const LIVE_SENSOR_HARDWARE = 'Radxa ROCK 4 SE + HackRF One';

// Deliberately hardcoded, deliberately not exported. See the header.
const COVERAGE_RADIUS_M = 1000;

// Status colours, identical to the sensor dots renderSite draws in
// main.js. Online is day/night dependent and is injected by main.js from
// its own constants; degraded and offline are status and never repainted.
const DEGRADED_COLOUR = '#ff8c3d';
const OFFLINE_COLOUR = '#ff3838';

// ── Site resolution ───────────────────────────────────────────────────

function _haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// The site whose centroid is nearest the sensor. An event belongs to a
// site and is tenant-stamped from it, so a sensor with no site would open
// events no operator can see.
export function nearestSiteId(sites, lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const [sid, site] of Object.entries(sites || {})) {
    const c = site?.coordinates;
    if (typeof c?.lat !== 'number' || typeof c?.lon !== 'number') continue;
    const d = _haversineM(lat, lon, c.lat, c.lon);
    if (d < bestD) { bestD = d; best = sid; }
  }
  return best ? { siteId: best, distanceM: Math.round(bestD) } : null;
}

// ── Sensor record ─────────────────────────────────────────────────────

function _finiteCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    && !(lat === 0 && lon === 0);
}

export function liveSensorRejectionReason(sites, { lat, lon, siteId, id }) {
  if (!_finiteCoord(lat, lon)) return 'invalid_coordinate';
  if (siteId && !sites?.[siteId]) return 'unknown_site';
  if (!siteId && !nearestSiteId(sites, lat, lon)) return 'no_site_available';
  const target = siteId || nearestSiteId(sites, lat, lon).siteId;
  if (id && (sites[target].sensors || []).some(s => s.id === id)) return 'duplicate_sensor_id';
  return null;
}

function _nextLiveId(site) {
  const taken = new Set((site.sensors || []).map(s => s.id));
  for (let i = 1; i < 100; i++) {
    const candidate = `LIVE-${String(i).padStart(2, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `LIVE-${Date.now()}`;
}

// The normalised shape site_loader.js produces, so every consumer that
// iterates site.sensors (coverage checks, popup, night tint, contributing
// rings) reads this record exactly as it reads a manifest sensor.
export function buildLiveSensorRecord(site, { lat, lon, id, nodeId, label, hardware } = {}) {
  const sensorId = id || _nextLiveId(site);
  return {
    id: sensorId,
    modality: 'rf',
    modalities: ['RF'],
    // A live node is healthy or it is not registered. Declared so the
    // record carries the same shape as a manifest sensor, which the
    // fusion's health weighting reads on every sensor it folds in.
    degradedModalities: [],
    lat, lon,
    altM: null,
    coverageRadius: COVERAGE_RADIUS_M,
    label: label || `Live node ${nodeId || sensorId}`,
    status: 'online',
    hardware: hardware || LIVE_SENSOR_HARDWARE,
    detectionsLast24h: 0,
    issues: null,
    source: LIVE_SOURCE,
    nodeId: nodeId || null,
    placedAt: new Date().toISOString(),
  };
}

// Registers the sensor into sites[siteId].sensors. Returns a result the
// caller can act on rather than throwing: a demo console should print why.
export function registerLiveSensor(sites, opts = {}) {
  const reason = liveSensorRejectionReason(sites, opts);
  if (reason) return { status: 'rejected', reason };
  const siteId = opts.siteId || nearestSiteId(sites, opts.lat, opts.lon).siteId;
  const site = sites[siteId];
  const sensor = buildLiveSensorRecord(site, opts);
  if (!Array.isArray(site.sensors)) site.sensors = [];
  site.sensors.push(sensor);
  site.sensorsTotal = (site.sensorsTotal || 0) + 1;
  site.sensorsOnline = (site.sensorsOnline || 0) + 1;
  if (site.stats) {
    site.stats.sensorsTotal = (site.stats.sensorsTotal || 0) + 1;
    site.stats.sensorsOnline = (site.stats.sensorsOnline || 0) + 1;
  }
  return { status: 'registered', siteId, sensor };
}

// ── Sensor symbol ─────────────────────────────────────────────────────

export function liveSensorStatusColour(status, { nightNow, onlineDay, onlineNight }) {
  if (status === 'online') return nightNow ? onlineNight : onlineDay;
  if (status === 'degraded') return DEGRADED_COLOUR;
  return OFFLINE_COLOUR;
}

// The entity options for the sensor dot. Mirrors the per-sensor block of
// renderSite in main.js field for field; scripts/check-live-sensor.mjs
// asserts the two stay in step. The symbol is the one every other sensor
// uses, not a special one.
export function liveSensorEntitySpec(siteId, sensor, { Cesium, nightNow, onlineDay, onlineNight }) {
  const css = liveSensorStatusColour(sensor.status, { nightNow, onlineDay, onlineNight });
  const color = Cesium.Color.fromCssColorString(css);
  return {
    id: `sensor-${siteId}-${sensor.id}`,
    position: Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, 0),
    point: {
      pixelSize: sensor.isCore ? 11 : 8,
      color,
      outlineColor: color.withAlpha(0.4),
      outlineWidth: sensor.isCore ? 5 : 3,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: {
      type: 'sensor',
      siteId,
      sensorId: sensor.id,
      online: sensor.status === 'online',
    },
  };
}

// The hidden coverage ring every sensor carries, revealed when the site is
// active. Same id scheme and properties as renderSite, so the site toggle
// and the POV isolation find it the way they find the others.
export function liveSensorCoverageSpec(siteId, sensor, { Cesium }) {
  return {
    id: `sensor-cov-${siteId}-${sensor.id}`,
    show: false,
    position: Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, 0),
    ellipse: {
      semiMajorAxis: sensor.coverageRadius,
      semiMinorAxis: sensor.coverageRadius,
      material: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.06),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.35),
      outlineWidth: 1,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    properties: { type: 'sensor-coverage', siteId },
  };
}

// ── Detection → batch → event ─────────────────────────────────────────

// Normalises what the bridge sends ({label, probability, node_id,
// frame_seq, capture_ts}) and what a hand on the console sends
// ({confidence}) into one shape. Missing label means DRONE: a human
// calling __isr_liveDetect is reporting a detection.
export function normaliseDetection(input = {}) {
  const confidence = Number.isFinite(input.confidence) ? input.confidence
    : Number.isFinite(input.probability) ? input.probability : null;
  return {
    label: String(input.label || LIVE_DETECTION_LABEL).toUpperCase(),
    confidence,
    nodeId: input.nodeId || input.node_id || null,
    sensorId: input.sensorId || null,
    frameSeq: input.frameSeq ?? input.frame_seq ?? null,
    captureTs: input.captureTs ?? input.capture_ts ?? null,
  };
}

export function liveDetectionRejectionReason(det) {
  if (det.label !== LIVE_DETECTION_LABEL) return 'not_a_detection';
  if (!Number.isFinite(det.confidence)) return 'missing_confidence';
  if (det.confidence < 0 || det.confidence > 1) return 'confidence_out_of_range';
  return null;
}

// IF-1.4 NnDetectionBatch, stamped live here and never taken from the
// wire, the same rule WebSocketNnOutputSource applies.
export function buildLiveDetectionBatch(siteId, sensor, det) {
  return {
    siteId,
    source: LIVE_SOURCE,
    tickTs: new Date().toISOString(),
    sensors: [{
      sensorId: sensor.id,
      status: 'online',
      detections: [{
        source: LIVE_SOURCE,
        lat: sensor.lat,
        lon: sensor.lon,
        alt: null,
        positionKind: 'sensor-anchor',
        confidence: +det.confidence.toFixed(2),
        droneKey: det.nodeId || sensor.nodeId || sensor.id,
        modalityMix: ['RF'],
        frameSeq: det.frameSeq,
        captureTs: det.captureTs,
      }],
    }],
  };
}

export function liveLastPosition(sensor, det) {
  return {
    lat: sensor.lat,
    lon: sensor.lon,
    alt: null,
    speed: null,
    heading: null,
    positionKind: 'sensor-anchor',
    sensorId: sensor.id,
    confidence: det.confidence,
    timestamp: new Date().toISOString(),
  };
}

// The event record. Only what the network said is in it: a DRONE label
// and a probability. Threat posture, type and platform are not network
// output today, so they are 'unknown' rather than invented.
export function buildLiveEvent({ eventId, siteId, sensor, det }) {
  const now = new Date().toISOString();
  const p = +det.confidence.toFixed(2);
  return {
    id: eventId,
    siteId,
    source: LIVE_SOURCE,
    classification: 'unknown',
    threat: 'unknown',
    droneType: 'Drone · RF, unclassified',
    platform: 'non-identifiable',
    confidence: p,
    confidenceTrend: 'Live neural-network output, single node',
    status: 'active',
    startTime: now,
    endTime: null,
    duration: 0,
    entry: null, exit: null,
    lastPosition: liveLastPosition(sensor, det),
    contributingSensors: [],
    evidence: {
      source: LIVE_SOURCE,
      rfMatch: `ISR classifier · ${det.label} · p=${p.toFixed(2)}`,
      rf_match_signature: det.label,
      rf_match_confidence: p,
      nodeId: det.nodeId || sensor.nodeId || null,
    },
    notes: [{
      timestamp: now,
      author: 'ISR sensor node',
      text: `Live detection. ${sensor.id} (${sensor.hardware}) reports ${det.label} at p=${p.toFixed(2)}. Single sensor: presence within ${sensor.coverageRadius} m, no position fix.`,
    }],
    templateKey: null,
    multiSiteTrack: false,
    coverageGatedTrack: false,
    detected: true,
    droneCount: 1,
    dynamicClassification: false,
    mockConfidenceRamp: false,
    liveSensorId: sensor.id,
    liveNodeId: det.nodeId || sensor.nodeId || null,
    spawnTs: wallNow(),
  };
}

// ── Runtime ───────────────────────────────────────────────────────────
//
// deps, all injected by main.js at its call seam:
//   sites, viewer, Cesium, events (the EVENTS array), addEvent, getEvent,
//   mutateEvent, addNote, nextEventId, applyDetectionBatch, selectEvent,
//   renderAlertStrip, renderDetailPanel, toast, ringIcon, nightNow(),
//   colours { onlineDay, onlineNight }, liveFeeds (manager, optional),
//   ringHoldMs (default 15000, the sweeper's grace), log (default console)
export function createLiveSensorRuntime(deps) {
  const {
    sites, viewer, Cesium, events, addEvent, getEvent, mutateEvent, addNote,
    nextEventId, applyDetectionBatch, selectEvent, renderAlertStrip,
    renderDetailPanel, toast, ringIcon, nightNow, colours, liveFeeds,
  } = deps;
  const log = deps.log || console;
  const ringHoldMs = deps.ringHoldMs || 15000;
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // sensorId → { siteId, sensor, entity, coverage, ring, lastDetectionMs }
  const registry = new Map();
  const stats = { placed: 0, detections: 0, ignored: 0, rejected: {}, opened: 0, feedMessages: 0 };
  let feedUnsub = null;

  const _reject = (reason, extra = {}) => {
    stats.rejected[reason] = (stats.rejected[reason] || 0) + 1;
    log.warn(`[live_sensor] rejected: ${reason}`, extra);
    return { status: 'rejected', reason, ...extra };
  };

  function activeLiveEvent(siteId) {
    for (const e of events) {
      if (e.status === 'active' && e.source === LIVE_SOURCE && e.siteId === siteId) return e;
    }
    return null;
  }

  function _ringSpec(rec) {
    const { sensor } = rec;
    return {
      id: `live-sensor-ring-${rec.siteId}-${sensor.id}`,
      position: Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, 2),
      billboard: {
        image: ringIcon(),
        width: 26, height: 26,
        show: new Cesium.CallbackProperty(() => ringShouldShow(rec), false),
        scale: new Cesium.CallbackProperty(() => 1.0 + 0.18 * Math.sin(nowMs() / 250), false),
        color: new Cesium.CallbackProperty(() => {
          const pulse = 0.35 + 0.40 * Math.sin(nowMs() / 250);
          // Cyan explicitly. ringIcon() draws in white now so the tint
          // is the only thing that colours it, and a WHITE tint on a
          // white image gave a white ring instead of the cyan every
          // other pulse uses.
          return Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(pulse);
        }, false),
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { type: 'live-sensor-ring', siteId: rec.siteId, sensorId: sensor.id },
    };
  }

  // The pulse means "this sensor has a detection right now": an active
  // live event at the site and a DRONE frame from this sensor inside the
  // hold window. Same condition the simulation's rings answer with
  // geometry, answered here with the network's own recency.
  function ringShouldShow(rec) {
    if (rec.sensor.status !== 'online') return false;
    if (!activeLiveEvent(rec.siteId)) return false;
    return rec.lastDetectionMs != null && (nowMs() - rec.lastDetectionMs) < ringHoldMs;
  }

  function placeSensor(lat, lon, opts = {}) {
    const res = registerLiveSensor(sites, { lat, lon, ...opts });
    if (res.status !== 'registered') return _reject(res.reason, { lat, lon });
    const { siteId, sensor } = res;
    const rec = { siteId, sensor, entity: null, coverage: null, ring: null, lastDetectionMs: null };
    try {
      rec.entity = viewer.entities.add(liveSensorEntitySpec(siteId, sensor, {
        Cesium, nightNow: !!nightNow?.(), onlineDay: colours.onlineDay, onlineNight: colours.onlineNight,
      }));
      rec.coverage = viewer.entities.add(liveSensorCoverageSpec(siteId, sensor, { Cesium }));
      rec.ring = viewer.entities.add(_ringSpec(rec));
    } catch (err) {
      log.warn('[live_sensor] entity add failed:', err?.message || err);
    }
    registry.set(sensor.id, rec);
    stats.placed++;
    const site = sites[siteId];
    toast?.(`Live sensor ${sensor.id} placed at ${site?.name || siteId}`, 'ok');
    log.log(`[live_sensor] ${sensor.id} registered at ${siteId} (${lat}, ${lon}). `
      + `Fire a detection with __isr_liveDetect({ confidence: 0.9 })`);
    return { status: 'placed', siteId, sensor };
  }

  function resolveSensor(det) {
    if (det.sensorId) return registry.get(det.sensorId) || null;
    if (det.nodeId) {
      for (const rec of registry.values()) if (rec.sensor.nodeId === det.nodeId) return rec;
    }
    // One live sensor in the room: route to it, whatever the node calls
    // itself. The demo must not fail on a node id typed differently.
    if (registry.size === 1) return registry.values().next().value;
    return null;
  }

  let _lastPanelMs = 0;
  function detect(input = {}) {
    const det = normaliseDetection(input);
    const reason = liveDetectionRejectionReason(det);
    if (reason === 'not_a_detection') { stats.ignored++; return { status: 'ignored', reason }; }
    if (reason) return _reject(reason, { input });
    const rec = resolveSensor(det);
    if (!rec) return _reject(registry.size ? 'ambiguous_sensor' : 'no_live_sensor', { input });
    const { siteId, sensor } = rec;
    const batch = buildLiveDetectionBatch(siteId, sensor, det);
    rec.lastDetectionMs = nowMs();
    stats.detections++;

    let liveEvent = activeLiveEvent(siteId);
    let opened = false;
    if (!liveEvent) {
      liveEvent = buildLiveEvent({ eventId: nextEventId(), siteId, sensor, det });
      addEvent(liveEvent);
      liveEvent = getEvent(liveEvent.id) || liveEvent;
      opened = true;
      stats.opened++;
    } else {
      mutateEvent(liveEvent.id, {
        confidence: +det.confidence.toFixed(2),
        lastPosition: liveLastPosition(sensor, det),
      });
    }
    // The same fold the mock path uses. Stamps _lastDetectionTs, which
    // the unobserved-event sweeper reads to decide when the detection is
    // over, and MAX-merges the sensor's confidence.
    try { applyDetectionBatch(batch, liveEvent); }
    catch (err) { log.warn('[live_sensor] batch apply failed:', err?.message || err); }

    if (opened) {
      const site = sites[siteId];
      toast?.(`DETECTED · Drone within ${site?.name || siteId} sensor range (${sensor.id}, p=${det.confidence.toFixed(2)})`, 'warn');
      try { selectEvent?.(liveEvent.id); } catch (_) { /* selection is a courtesy */ }
      try { renderAlertStrip?.(); } catch (_) { /* never let a render break ingest */ }
    } else if (nowMs() - _lastPanelMs > 500) {
      _lastPanelMs = nowMs();
      try { renderDetailPanel?.(); } catch (_) { /* same */ }
    }
    return { status: opened ? 'opened' : 'refreshed', eventId: liveEvent.id, sensorId: sensor.id, confidence: det.confidence };
  }

  // Node health from the bridge's heartbeat / status messages. Status is
  // a fact about the node and repaints the dot exactly as a manifest
  // status would have coloured it.
  function setNodeStatus(nodeId, status, issue = null) {
    const s = String(status || '').toLowerCase();
    if (!['online', 'degraded', 'offline'].includes(s)) return { status: 'rejected', reason: 'unknown_status' };
    let touched = 0;
    for (const rec of registry.values()) {
      if (nodeId && rec.sensor.nodeId && rec.sensor.nodeId !== nodeId) continue;
      if (nodeId && !rec.sensor.nodeId && registry.size !== 1) continue;
      if (rec.sensor.status === s && rec.sensor.issues === issue) continue;
      rec.sensor.status = s;
      rec.sensor.issues = issue;
      touched++;
      if (rec.entity?.point) {
        try {
          const css = liveSensorStatusColour(s, {
            nightNow: !!nightNow?.(), onlineDay: colours.onlineDay, onlineNight: colours.onlineNight,
          });
          const color = Cesium.Color.fromCssColorString(css);
          rec.entity.point.color = color;
          rec.entity.point.outlineColor = color.withAlpha(0.4);
          if (rec.entity.properties) rec.entity.properties.online = s === 'online';
        } catch (err) { log.warn('[live_sensor] repaint failed:', err?.message || err); }
      }
      const site = sites[rec.siteId];
      if (site) {
        const online = (site.sensors || []).filter(x => x.status === 'online').length;
        site.sensorsOnline = online;
        if (site.stats) site.stats.sensorsOnline = online;
      }
    }
    return { status: 'applied', touched };
  }

  // Messages from deployment/mqtt_ws_bridge.py, forwarded unchanged by the
  // isr_sensor_nodes feed. Shapes are in deployment/dashboard_protocol.py.
  function handleFeedMessage(msg) {
    stats.feedMessages++;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'detection':
        detect({ label: msg.label, probability: msg.probability, nodeId: msg.node_id,
          frameSeq: msg.frame_seq, captureTs: msg.capture_ts });
        break;
      case 'heartbeat':
        setNodeStatus(msg.node_id, msg.label);
        break;
      case 'status':
        for (const [nodeId, node] of Object.entries(msg.nodes || {})) setNodeStatus(nodeId, node?.status);
        break;
      case 'bridge-closed':
        for (const rec of registry.values()) {
          setNodeStatus(rec.sensor.nodeId, 'degraded', 'Link to the inference bridge lost');
        }
        break;
      default:
        break;
    }
  }

  function attachFeed() {
    if (!liveFeeds || feedUnsub) return feedUnsub != null;
    const rec = liveFeeds.get?.(LIVE_FEED_ID);
    if (!rec?.provider?.onUpdate) return false;
    feedUnsub = rec.provider.onUpdate(handleFeedMessage);
    return true;
  }

  function startFeed(url) {
    if (!liveFeeds) return { status: 'rejected', reason: 'no_feed_manager' };
    if (!registry.size) log.warn('[live_sensor] no live sensor placed yet. Detections will be dropped until __isr_liveSensor(lat, lon) is called.');
    attachFeed();
    liveFeeds.start(LIVE_FEED_ID, url ? { url } : undefined);
    return { status: 'started', feed: LIVE_FEED_ID, url: url || null };
  }

  function stopFeed() {
    if (!liveFeeds) return { status: 'rejected', reason: 'no_feed_manager' };
    liveFeeds.stop(LIVE_FEED_ID);
    return { status: 'stopped', feed: LIVE_FEED_ID };
  }

  attachFeed();

  return {
    placeSensor,
    detect,
    setNodeStatus,
    handleFeedMessage,
    startFeed,
    stopFeed,
    sensors: () => [...registry.values()].map(r => ({ siteId: r.siteId, ...r.sensor, lastDetectionMs: r.lastDetectionMs })),
    events: () => events.filter(e => e.source === LIVE_SOURCE).map(e => ({ id: e.id, siteId: e.siteId, status: e.status, confidence: e.confidence, outcome: e.outcome || null })),
    stats: () => ({ ...stats, rejected: { ...stats.rejected }, sensors: registry.size, feedAttached: feedUnsub != null }),
    _ringShouldShow: ringShouldShow,
  };
}
