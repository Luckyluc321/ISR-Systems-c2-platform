// Event data model — unified schema for live + historical events.
// One event = one full drone detection lifecycle (entry → track → exit or lost).
// Same shape for currently-active and closed events; `status` distinguishes them.
//
// CANONICAL SHAPE: every event carries `event.subject`, a DetectionSubject
// (see detection_subject.js) that is the fused NN output and the single
// source of truth for every downstream agent (Correlation, Narrative,
// Recommendation, Debrief). Flat fields (event.platform, event.classification,
// event.confidence, event.threat) remain as UI-facing backward-compat
// surfaces populated in parallel — swap consumers to event.subject at your
// own pace. New agents MUST read event.subject.
import { syncEventSubject, applyNnTickToSubject } from './detection_subject.js';

export const EVENTS = [
  // ── Recently closed hostile (was live, exited 10 min ago) ──
  {
    id: 'DET-20260724-0341',
    siteId: 'cph',
    classification: 'hostile',
    threat: 'high',
    droneType: 'DJI Matrice 300',
    platform: 'quadcopter',
    confidence: 0.87,
    confidenceTrend: 'Peaked 0.87, exited perimeter',
    status: 'closed',
    startTime: '2026-07-24T14:22:07Z',
    endTime: '2026-07-24T14:23:44Z',
    duration: 97,
    entry: { lat: 55.6010, lon: 12.6698, timestamp: '2026-07-24T14:22:07Z', heading: 285, sensorIds: ['N15', 'N18'] },
    exit:  { lat: 55.5995, lon: 12.6735, timestamp: '2026-07-24T14:23:44Z', heading: 90 },
    lastPosition: null,
    contributingSensors: [
      { id: 'N16', confidence: 0.91 },
      { id: 'N17', confidence: 0.82 },
      { id: 'N20', confidence: 0.74 },
      { id: 'N09', confidence: 0.68 },
      { id: 'N11', confidence: 0.00, offline: true },
    ],
    evidence: { rfCarrier: '2.412 GHz', rfBandwidth: '20 MHz OFDM', rfMatch: 'OcuSync 91%', modality: 'RF + acoustic', evidenceSize: '24.7 MB', note: 'Full loiter over central airside, exited same vector. Evidence pack ready for handoff to CPH security.' },
  },

  // ── RECENT (last hour) ──
  {
    id: 'DET-20260724-0338',
    siteId: 'cph',
    classification: 'friendly',
    threat: null,
    droneType: 'Skydio X10D, CPH-INSP-04',
    platform: 'quadcopter',
    confidence: 0.92,
    confidenceTrend: 'Stable',
    status: 'closed',
    startTime: '2026-07-24T13:47:12Z',
    endTime: '2026-07-24T13:59:44Z',
    duration: 752,
    entry: { lat: 55.6285, lon: 12.6470, timestamp: '2026-07-24T13:47:12Z', heading: 180, sensorIds: ['N02', 'N01'] },
    exit:  { lat: 55.6288, lon: 12.6466, timestamp: '2026-07-24T13:59:44Z', heading: 0 },
    lastPosition: { lat: 55.6288, lon: 12.6466, alt: 45, speed: 3.1, heading: 0 },
    contributingSensors: [
      { id: 'N02', confidence: 0.94 },
      { id: 'N01', confidence: 0.89 },
      { id: 'N06', confidence: 0.87 },
    ],
    evidence: { rfCarrier: '5.180 GHz', rfBandwidth: '40 MHz OFDM', rfMatch: 'Skydio SDK 96%', modality: 'RF + visual', evidenceSize: '188.2 MB', note: 'Registered inspection flight, scheduled 13:45 to 14:00Z' },
  },
  {
    id: 'DET-20260724-0329',
    siteId: 'esbjerg',
    classification: 'resolved',
    threat: null,
    droneType: 'False positive, bird flock',
    platform: null,
    confidence: 0.52,
    confidenceTrend: 'Rejected, insufficient corroboration',
    status: 'closed',
    startTime: '2026-07-24T12:14:03Z',
    endTime: '2026-07-24T12:14:41Z',
    duration: 38,
    entry: null,
    exit: null,
    lastPosition: null,
    contributingSensors: [
      { id: 'N02', confidence: 0.52 },
    ],
    evidence: { modality: 'Acoustic only', note: 'Single sensor detection, no RF signature, classifier flagged as biological (birds)' },
  },
  {
    id: 'DET-20260724-0311',
    siteId: 'cph',
    classification: 'hostile',
    threat: 'medium',
    droneType: 'Autel Evo Max 4T',
    platform: 'quadcopter',
    confidence: 0.79,
    confidenceTrend: 'Sustained 0.78-0.81',
    status: 'closed',
    startTime: '2026-07-24T09:22:41Z',
    endTime: '2026-07-24T09:25:53Z',
    duration: 192,
    entry: { lat: 55.5988, lon: 12.6742, timestamp: '2026-07-24T09:22:41Z', heading: 315, sensorIds: ['N18', 'N15'] },
    exit:  { lat: 55.5990, lon: 12.6750, timestamp: '2026-07-24T09:25:53Z', heading: 135 },
    lastPosition: null,
    contributingSensors: [
      { id: 'N18', confidence: 0.79 },
      { id: 'N15', confidence: 0.71 },
      { id: 'N22', confidence: 0.68 },
    ],
    evidence: { rfCarrier: '2.400 GHz', rfBandwidth: '10 MHz', rfMatch: 'Autel proprietary 84%', modality: 'RF + acoustic', evidenceSize: '52.4 MB', note: 'Entered from Øresund side, loitered 3 min, exited same vector. Evidence pack escalated to CPH security.' },
  },

  // ── YESTERDAY ──
  {
    id: 'DET-20260723-0417',
    siteId: 'esbjerg',
    classification: 'hostile',
    threat: 'high',
    droneType: 'DJI Mavic 3 Pro',
    platform: 'quadcopter',
    confidence: 0.91,
    confidenceTrend: 'Steady climb 0.72→0.91',
    status: 'closed',
    startTime: '2026-07-23T22:14:07Z',
    endTime: '2026-07-23T22:15:37Z',
    duration: 90,
    entry: { lat: 55.4720, lon: 8.4256, timestamp: '2026-07-23T22:14:07Z', heading: 200, sensorIds: ['N01', 'N02'] },
    exit:  { lat: 55.4632, lon: 8.4489, timestamp: '2026-07-23T22:15:37Z', heading: 20 },
    lastPosition: null,
    contributingSensors: [
      { id: 'N01', confidence: 0.88 },
      { id: 'N02', confidence: 0.91 },
      { id: 'N03', confidence: 0.85 },
    ],
    evidence: { rfCarrier: '2.412 GHz', rfBandwidth: '20 MHz OFDM', rfMatch: 'OcuSync 3 94%', modality: 'RF + acoustic + visual', evidenceSize: '412.8 MB', note: 'Confirmed hostile. Evidence handed to Port Authority and Politi Sydvestjylland.' },
  },
  {
    id: 'DET-20260723-0402',
    siteId: 'cph',
    classification: 'friendly',
    threat: null,
    droneType: 'Skydio X10D, CPH-INSP-02',
    platform: 'quadcopter',
    confidence: 0.94,
    confidenceTrend: 'Stable',
    status: 'closed',
    startTime: '2026-07-23T14:12:00Z',
    endTime: '2026-07-23T14:47:22Z',
    duration: 2122,
    entry: { lat: 55.6288, lon: 12.6466, timestamp: '2026-07-23T14:12:00Z', heading: 180, sensorIds: ['N02'] },
    exit:  { lat: 55.6288, lon: 12.6466, timestamp: '2026-07-23T14:47:22Z', heading: 0 },
    lastPosition: null,
    contributingSensors: [
      { id: 'N02', confidence: 0.95 },
      { id: 'N01', confidence: 0.92 },
      { id: 'N06', confidence: 0.88 },
      { id: 'N05', confidence: 0.87 },
    ],
    evidence: { rfCarrier: '5.180 GHz', rfMatch: 'Skydio SDK 98%', modality: 'RF + visual', evidenceSize: '2.1 GB', note: 'Scheduled perimeter inspection. Full runway sweep.' },
  },
  {
    id: 'DET-20260723-0389',
    siteId: 'cph',
    classification: 'resolved',
    threat: null,
    droneType: 'False positive, kite string RF harmonic',
    platform: null,
    confidence: 0.44,
    confidenceTrend: 'Rejected, no kinematic consistency',
    status: 'closed',
    startTime: '2026-07-23T11:03:28Z',
    endTime: '2026-07-23T11:04:15Z',
    duration: 47,
    entry: null,
    exit: null,
    lastPosition: null,
    contributingSensors: [
      { id: 'N08', confidence: 0.44 },
    ],
    evidence: { modality: 'RF only', note: 'Weak stationary RF harmonic near E perimeter, no acoustic corroboration, static position, flagged as non drone.' },
  },
];

// ── Event creation (dynamic spawn for demo) ──
let _spawnCounter = 9000;
export function nextEventId() {
  _spawnCounter++;
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}`;
  return `DET-${stamp}-${String(_spawnCounter).padStart(4,'0')}`;
}

export function addEvent(event) {
  event.notes = event.notes || [];
  event.escalations = event.escalations || [];
  syncEventSubject(event);   // canonical DetectionSubject attached here
  EVENTS.push(event);
  _listeners.forEach(fn => fn(event.id));
}

// Per-tick NN detection ingest. This is the integration point that
// Advance B (NN output source adapter) calls as real hardware streams
// detections. Mutates event.subject in-place with fresh kinematics,
// updated per-modality confidence, and records class transitions.
export function ingestNnDetection(eventId, nnTick) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e) return;
  if (!e.subject) syncEventSubject(e);
  applyNnTickToSubject(e.subject, nnTick);
  e.lastUpdated = new Date().toISOString();
  _listeners.forEach(fn => fn(eventId));
}

export function closeEvent(id, exitPoint) {
  const e = EVENTS.find(x => x.id === id);
  if (!e) return;
  e.status = 'closed';
  e.endTime = new Date().toISOString();
  // Compute duration from real start/end times if the tick-loop didn't set it
  // (shadow / linked events have no independent tick loop, so their
  // event.duration stayed 0 = "00:00" in the panel).
  if (!e.duration || e.duration === 0) {
    try {
      const durSec = Math.max(0, Math.round(
        (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 1000
      ));
      e.duration = durSec;
    } catch (_) { /* leave as-is */ }
  }
  if (exitPoint) e.exit = exitPoint;
  _listeners.forEach(fn => fn(id));
}

// Ensure every event has an escalations array + canonical subject.
// Boot-time sync guarantees the invariant "every event in EVENTS has
// event.subject populated" from the very first render, so downstream
// agents never see a subject-less event.
EVENTS.forEach(e => {
  e.escalations = e.escalations || [];
  syncEventSubject(e);
});

// ── Escalation (mock UX, real dispatchers replace later) ──
let _escalationCounter = 0;
export function escalateEvent(id, { destinationIds, payload, message, operator = 'L. Flindt' }) {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !destinationIds || !destinationIds.length) return [];
  const now = new Date();
  // Dedupe destinations: skip any destinationId that already has a record
  // on this event (auto-rules + manual escalation could otherwise both
  // fire for the same agency). Also dedupe within the incoming batch.
  const existingDestIds = new Set((e.escalations || []).map(r => r.destinationId));
  const seen = new Set();
  const uniqueDests = destinationIds.filter(d => {
    if (existingDestIds.has(d) || seen.has(d)) return false;
    seen.add(d);
    return true;
  });
  if (uniqueDests.length === 0) return [];
  const records = uniqueDests.map(destId => {
    _escalationCounter++;
    const rec = {
      id: `ESC-${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}-${String(_escalationCounter).padStart(4,'0')}`,
      destinationId: destId,
      initiatedBy: operator,
      initiatedAt: now.toISOString(),
      payload, // 'summary' | 'full' | 'live-link'
      message: (message || '').trim(),
      status: 'sent',
      statusHistory: [{ timestamp: now.toISOString(), status: 'sent' }],
      response: null,
    };
    return rec;
  });
  e.escalations.push(...records);
  // Log note for chain of custody
  e.notes = e.notes || [];
  e.notes.push({
    timestamp: now.toISOString(),
    author: operator,
    text: `Escalated to ${uniqueDests.length} destination(s). Payload: ${payload}.${message ? ' Message: "' + message.trim() + '"' : ''}`,
    type: 'escalation',
  });
  _listeners.forEach(fn => fn(id));
  return records;
}

export function updateEscalationStatus(eventId, escalationId, status) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !e.escalations) return;
  const rec = e.escalations.find(r => r.id === escalationId);
  if (!rec) return;
  rec.status = status;
  rec.statusHistory.push({ timestamp: new Date().toISOString(), status });
  _listeners.forEach(fn => fn(eventId));
}

export function respondToEscalation(eventId, escalationId, text, respondedBy) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !e.escalations) return;
  const rec = e.escalations.find(r => r.id === escalationId);
  if (!rec || !text || !text.trim()) return;
  rec.response = { receivedAt: new Date().toISOString(), respondedBy, text: text.trim() };
  if (rec.status !== 'acknowledged') {
    rec.status = 'acknowledged';
    rec.statusHistory.push({ timestamp: new Date().toISOString(), status: 'acknowledged' });
  }
  _listeners.forEach(fn => fn(eventId));
}

// Events currently escalated to a given set of destination IDs (for receiver view)
export function eventsForDestinations(destIds) {
  const idSet = new Set(destIds);
  return EVENTS
    .filter(e => e.escalations && e.escalations.some(r => idSet.has(r.destinationId)))
    .sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return b.startTime.localeCompare(a.startTime);
    });
}

// ── Notes / reclassification ──
// Add an empty notes array to every event so the render pipeline can rely on it
EVENTS.forEach(e => { e.notes = e.notes || []; });

// Seed a couple of demo notes so the section renders non-empty for demo events
const _seedNote = (id, ts, author, text) => {
  const e = EVENTS.find(x => x.id === id);
  if (e) e.notes.push({ timestamp: ts, author, text, type: 'note' });
};
_seedNote('DET-20260723-0417', '2026-07-23T22:15:52Z', 'L. Flindt', 'Reviewed camera feed at 22:15:40Z. Positive visual on DJI Mavic 3 Pro overhead Sønderhavn quay. Escalating to Politi.');
_seedNote('DET-20260724-0311', '2026-07-24T09:26:15Z', 'L. Flindt', 'Same loiter pattern as 2026-07-19 event (Autel). Suspected reconnaissance behavior. Filed with CPH security ops.');

// Seed a demo escalation record on the historical hostile so the log section renders
const _seedEscalation = (eventId, records) => {
  const e = EVENTS.find(x => x.id === eventId);
  if (e) e.escalations = records;
};
_seedEscalation('DET-20260723-0417', [
  { id: 'ESC-20260723-0001', destinationId: 'esb-t1-sec-ops', initiatedBy: 'L. Flindt', initiatedAt: '2026-07-23T22:14:50Z',
    payload: 'summary', message: 'Confirmed hostile, requesting internal response.',
    status: 'acknowledged',
    statusHistory: [
      { timestamp: '2026-07-23T22:14:50Z', status: 'sent' },
      { timestamp: '2026-07-23T22:14:52Z', status: 'delivered' },
      { timestamp: '2026-07-23T22:15:04Z', status: 'read' },
      { timestamp: '2026-07-23T22:15:21Z', status: 'acknowledged' },
    ],
    response: { receivedAt: '2026-07-23T22:15:21Z', respondedBy: 'M. Sørensen', text: 'On it, dispatching security patrol to Sønderhavn.' },
  },
  { id: 'ESC-20260723-0002', destinationId: 'esb-t2-politi', initiatedBy: 'L. Flindt', initiatedAt: '2026-07-23T22:16:12Z',
    payload: 'full', message: 'Hostile drone incursion confirmed with visual. Handing full evidence pack.',
    status: 'acknowledged',
    statusHistory: [
      { timestamp: '2026-07-23T22:16:12Z', status: 'sent' },
      { timestamp: '2026-07-23T22:16:14Z', status: 'delivered' },
      { timestamp: '2026-07-23T22:19:03Z', status: 'read' },
      { timestamp: '2026-07-23T22:24:47Z', status: 'acknowledged' },
    ],
    response: { receivedAt: '2026-07-23T22:24:47Z', respondedBy: 'Politi Vagtcentral', text: 'Received. Assigning case 2026-EBJ-1147. Officers en route to port for statement.' },
  },
]);

export function addNote(id, text, author = 'L. Flindt') {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !text || !text.trim()) return;
  e.notes.push({
    timestamp: new Date('2026-07-24T14:32:41Z').toISOString(), // demo reference time
    author, text: text.trim(), type: 'note',
  });
  _listeners.forEach(fn => fn(id));
}

export function reclassifyEvent(id, { classification, threat = null, reason = '' }) {
  const e = EVENTS.find(x => x.id === id);
  if (!e) return;
  const from = classification === e.classification && threat === e.threat
    ? null
    : `${e.classification}${e.threat ? '/' + e.threat : ''} to ${classification}${threat ? '/' + threat : ''}`;
  e.classification = classification;
  e.threat = threat;
  e.lastReclassifyReason = reason || 'operator_reclassify';
  syncEventSubject(e);   // rebuilds subject; class_change_log records the transition
  if (from) {
    e.notes.push({
      timestamp: new Date('2026-07-24T14:32:41Z').toISOString(),
      author: 'L. Flindt',
      text: `Reclassified from ${from}${reason ? '. Reason: ' + reason : ''}`,
      type: 'reclassification',
    });
  }
  _listeners.forEach(fn => fn(id));
}

// ── Selection state ──
let _selectedEventId = null;
const _listeners = new Set();

export function getSelectedEventId() { return _selectedEventId; }
export function getSelectedEvent() { return _selectedEventId ? EVENTS.find(e => e.id === _selectedEventId) : null; }
export function selectEvent(id) {
  _selectedEventId = id;
  _listeners.forEach(fn => fn(id));
}
export function clearSelection() { selectEvent(null); }
export function onSelectionChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
export function getEvent(id) { return EVENTS.find(e => e.id === id); }

// ── Filter state ──
let _filter = 'all'; // all | hostile | friendly | resolved
const _filterListeners = new Set();
export function getFilter() { return _filter; }
export function setFilter(f) {
  _filter = f;
  _filterListeners.forEach(fn => fn(f));
}
export function onFilterChange(fn) {
  _filterListeners.add(fn);
  return () => _filterListeners.delete(fn);
}

// ── Helpers ──
export function filteredEvents() {
  // Only surface events that a real sensor has actually detected. Events
  // in transit but not yet inside any sensor coverage are held back so the
  // alert strip / receiver inbox don't fabricate a detection ahead of the
  // sensor grid. multiSiteTrack events get gated on `detected === true`
  // (flipped in main.js when the missile first enters coverage).
  const base = EVENTS.filter(e => e.detected !== false);
  const evs = _filter === 'all' ? base : base.filter(e => e.classification === _filter);
  return [...evs].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return b.startTime.localeCompare(a.startTime);
  });
}

// Registered per-site display names. Populated by main.js at boot so we
// don't need to import SITES here (would cycle imports). Any site added
// to SITES / SITES_ENERGINET automatically resolves via this map instead
// of leaking the raw siteId key to the UI.
const _SITE_NAMES = { cph: 'CPH Airport', esbjerg: 'Esbjerg Harbour' };
export function registerSiteName(siteId, name) { if (siteId && name) _SITE_NAMES[siteId] = name; }
export function siteName(siteId) {
  return _SITE_NAMES[siteId] || siteId;
}

export function relativeTime(iso) {
  const now = new Date('2026-07-24T14:32:41Z'); // demo reference time
  const then = new Date(iso);
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec/60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec/3600)}h ago`;
  return `${Math.floor(diffSec/86400)}d ago`;
}

export function formatDuration(sec) {
  if (sec == null) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
