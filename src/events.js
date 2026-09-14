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
import { SITES } from './sites_registry.js';

// Schema version stamps. Every escalation record + assessment package
// gets its version stamped at write time so future consumers can gate
// rehydration / adapter transforms / migrations on shape drift. Bump
// these when any field is added, removed, or renamed. Prior records
// carry their original version; consumers must handle any historical
// version they intend to read.
export const ESCALATION_SCHEMA_VERSION = 1;
export const ASSESSMENT_PACKAGE_SCHEMA_VERSION = 1;

// Shared data catalog schema version. Bumped when catalog sub-array
// shape changes (new type added, entry shape changes). Consumers gate
// migrations on this.
export const CATALOG_SCHEMA_VERSION = 1;

// Empty catalog factory. Exported so consumers can build a fresh one
// for rehydration paths. All 13 sub-arrays initialised so downstream
// code can push without checking existence.
export function _makeEmptyCatalog() {
  return {
    _schemaVersion:   CATALOG_SCHEMA_VERSION,
    subject:          null,   // CAT-SUBJECT: single object, one per event
    recording:        null,   // CAT-RECORDING: single object, one per event
    respHistory:      [],     // CAT-RESP-HISTORY: dispatch entries mirrored from event.counterDispatches
    attribution:      [],     // CAT-ATTR: attribution notes (contributor-tagged)
    patterns:         [],     // CAT-PATTERN: pattern additions from intel
    xlinks:           [],     // CAT-XLINK: cross-event links (symmetric)
    roe:              [],     // CAT-ROE: rules-of-engagement notes
    evidence:         [],     // CAT-EVIDENCE: physical evidence chain of custody
    coordDecisions:   [],     // CAT-COORD-DECISIONS: coordination command decisions
    casualties:       [],     // CAT-CASUALTIES: medical casualty records
    advisories:       [],     // CAT-ADVISORY: regulatory advisories issued
    publicAlerts:     [],     // CAT-PUBLIC-ALERT: public-safety broadcasts
    liaison:          [],     // CAT-LIAISON: international information-sharing records
  };
}

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
  // Phase 3 tenant stamp — immutable once written. Every downstream
  // read function filters visibility against this field. Derived from
  // the site manifest's tenant field via tenantForSite(). If the site
  // is unknown or has no tenant, tenantId is null and the event stays
  // invisible to any operator actor (default-deny).
  if (event.tenantId === undefined) {
    event.tenantId = tenantForSite(event.siteId);
  }
  event.notes = event.notes || [];
  event.escalations = event.escalations || [];
  // Phase 1 receiver contract fields (additive, defaults to empty).
  // event.participants: Map<role_id, {mode, addedAt, addedBy, addReason, promotedFromObserver, ackedAt, ackedBy}>
  //   Who is in the loop on this event and in what mode (actor/observer).
  // event.interactions: Array<{id, timestamp, flow, from_role_id, to_role_id, payload, ackStatus, ackedAt, ackedBy}>
  //   Every role-to-role interaction on this event. Audit trail for compliance.
  // event.routingHistory: Array<{role_id, notification_kind, deliveredAt, seenAt, ackedAt}>
  //   Per-recipient delivery journal. Populated by pushNotification.
  if (!(event.participants instanceof Map)) event.participants = new Map();
  event.interactions = event.interactions || [];
  event.routingHistory = event.routingHistory || [];
  // Agentic preprocessing fields (FIX-2 per architecture review 2026-08-30).
  // narrativeCache: Agent B output (body + recommendation + model_version
  //   + at + signalHash). Written by mistral.js onDone. Persisted to
  //   localStorage per FIX-1. Reads through main.js rehydrate helper.
  // _preprocessed: Trajectory Signal Extractor output (signals +
  //   signalHash + computedAt). Written by preprocessing.js on debrief
  //   open. Persisted to localStorage per FIX-3.
  // Explicit null (not undefined) so downstream readers can differentiate
  // "no narrative yet" from "field missing entirely."
  event.narrativeCache = event.narrativeCache || null;
  event._preprocessed = event._preprocessed || null;
  // Phase 1 · Shared data catalog for the contributor-chapter model.
  // 13 typed sub-arrays hold single-copy facts that overlap across
  // chapters (subject bundle, detection recording, response history,
  // attribution notes, patterns, cross-links, ROE, evidence chain,
  // coordination decisions, casualties, advisories, public alerts,
  // international liaison records). Chapters cite by ID; sub-sections
  // read + write via IDs. Consumers land in Phases 2-4.
  // See src/archetypes.js + docs/cross-agency-flows.md Section 7.
  if (!event.catalog || typeof event.catalog !== 'object') {
    event.catalog = _makeEmptyCatalog();
  } else {
    // Backfill any missing sub-arrays (rehydrated events from earlier
    // schema versions might have a partial catalog).
    const base = _makeEmptyCatalog();
    for (const k of Object.keys(base)) {
      if (event.catalog[k] === undefined) event.catalog[k] = base[k];
    }
  }
  // Geo-context enrichment (opt-in). Only populated if the sovereign geo
  // routing module has been primed. Coord resolution priority:
  //   1. event.entry.{lat,lon}         (from threat template spawn)
  //   2. event.lastPosition.{lat,lon}  (updated by tick loop)
  //   3. SITES[event.siteId].coordinates.{lat,lon} (site centroid fallback)
  // Never blocks event creation. Additive metadata that debrief/narrative
  // /UI can display: "This incident is in Billund Kommune, Sydøstjyllands
  // Politikreds, Region Syddanmark". Non-authoritative — hand-configured
  // destinationsForSite() remains the source of truth for actual routing.
  if (event.geoContext === undefined) event.geoContext = null;
  // Domain scope (Phase A of the event-transmission-relevance work).
  // Every event carries the set of operational domains it's relevant to.
  // Destinations declare which domains they care about; destinationsForEvent
  // (destinations.js) applies the intersection so inland events don't
  // route to Kystvagten but a drone that crosses the coastline does.
  if (!Array.isArray(event.domainScope) || !event.domainScope.length) {
    event.domainScope = _computeInitialDomainScope(event);
  }
  try {
    const resolver = (typeof window !== 'undefined' && window.__isr_geo_routing) ? window.__isr_geo_routing : null;
    const stats = resolver?.stats?.();
    if (resolver && stats?.primed) {
      const siteCoords = SITES[event.siteId]?.coordinates;
      const lat = event.entry?.lat ?? event.lastPosition?.lat ?? siteCoords?.lat;
      const lon = event.entry?.lon ?? event.lastPosition?.lon ?? siteCoords?.lon;
      if (lat != null && lon != null) {
        const geo = resolver.forPoint(lat, lon);
        if (geo?.admins) event.geoContext = { ...geo.admins, receiverIds: geo.ids || [], resolvedAt: new Date().toISOString(), resolvedFrom: event.entry?.lat != null ? 'entry' : event.lastPosition?.lat != null ? 'lastPosition' : 'site-centroid' };
      }
    }
  } catch (err) { console.warn('[events] geoContext enrichment failed:', err.message); }
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
  // Post-Incident Report generation. Fires per-event at close so that
  // cross-linked shadow events each get their own site-scoped PIR the
  // moment their portion of the incident concludes. Receivers on that
  // site see the report inline; a persistent archive is exposed via
  // the receiver profile library. See docs/user-flows.md Flow 7 and
  // src/post_incident_report.js for the assembly logic. Detection-only:
  // pure state, no dispatch action triggered here.
  try {
    if (!e.postIncidentReport) {
      // getDestination is optionally injected by consumers that already
      // have destinations loaded. events.js can't import it directly
      // without creating a cycle, so we route through a window-scoped
      // resolver that main.js populates at boot. Absent resolver falls
      // back to raw destination IDs in the report, which is safe but
      // less readable.
      const resolver = (typeof window !== 'undefined' && window.__isr_getDestination) || null;
      const report = _pirGenerator ? _pirGenerator(e, { getDestination: resolver }) : null;
      if (report) e.postIncidentReport = report;
    }
  } catch (err) {
    console.warn('[pir] generation failed at close:', err.message);
  }
  _listeners.forEach(fn => fn(id));
}

// Lazy binding for the PIR generator so events.js doesn't have to
// import post_incident_report.js directly (keeps the module free of
// downstream consumer coupling). main.js wires it at boot.
let _pirGenerator = null;
export function registerPostIncidentReportGenerator(fn) { _pirGenerator = fn; }

// Ensure every event has an escalations array + canonical subject.
// Boot-time sync guarantees the invariant "every event in EVENTS has
// event.subject populated" from the very first render, so downstream
// agents never see a subject-less event.
EVENTS.forEach(e => {
  e.escalations = e.escalations || [];
  syncEventSubject(e);
});
// domainScope for seed events is populated by refreshSeedDomainScopes()
// in main.js, called immediately after registerSiteDomains has been
// invoked for every site. Doing the backfill HERE would crash on
// TDZ (_computeInitialDomainScope reads _SITE_DEFAULT_DOMAINS which
// is declared further down in this file). Any downstream reader that
// hits a seed event before main.js boot completes falls through the
// null-domainScope guard in destinations.js:destinationsForEvent
// (returns the full unfiltered site list rather than throwing).

// ── Escalation (mock UX, real dispatchers replace later) ──
let _escalationCounter = 0;
export function escalateEvent(id, { destinationIds, payload, message, operator = 'L. Flindt', operatorRoleId = null, assessmentPackage = null }) {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !destinationIds || !destinationIds.length) return [];
  const now = new Date();
  // Dedupe destinations: skip any destinationId that already has a record
  // on this event (auto-rules + manual escalation could otherwise both
  // fire for the same agency). Also dedupe within the incoming batch.
  //
  // EXCEPTION: cross-agency cascades (assessmentPackage present) are
  // always allowed to create a fresh record even when the destination
  // is already targeted by a prior operator escalation. Reason: the
  // cascade carries its own "why we called you" context; folding it
  // into an existing operator record would drop that provenance and
  // the recipient would never see the sender's assessment. Each cascade
  // is a distinct comms event.
  const existingDestIds = new Set((e.escalations || []).map(r => r.destinationId));
  const seen = new Set();
  const uniqueDests = destinationIds.filter(d => {
    if (seen.has(d)) return false;
    if (existingDestIds.has(d) && !assessmentPackage) return false;
    seen.add(d);
    return true;
  });
  if (uniqueDests.length === 0) return [];
  const records = uniqueDests.map(destId => {
    _escalationCounter++;
    const rec = {
      // Schema version stamp on every escalation record so future
      // consumers (Azure blob rehydration, backend migrations, external
      // adapters) can detect + branch on shape drift. Bump this when
      // any field is added/removed/renamed on the record; leave prior
      // records untouched — they carry their original version.
      _schemaVersion: ESCALATION_SCHEMA_VERSION,
      id: `ESC-${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}-${String(_escalationCounter).padStart(4,'0')}`,
      destinationId: destId,
      initiatedBy: operator,
      // Structured role id alongside freeform display string. Reports
      // needing per-agency aggregation (Politi Kbh cascaded N times,
      // avg time-to-ack, etc) can filter/group by initiatedByRoleId
      // without parsing a display string. Freeform initiatedBy kept
      // for UI continuity.
      initiatedByRoleId: operatorRoleId,
      initiatedAt: now.toISOString(),
      payload, // 'summary' | 'full' | 'live-link'
      message: (message || '').trim(),
      status: 'sent',
      statusHistory: [{ timestamp: now.toISOString(), status: 'sent' }],
      response: null,
      // Delivery-axis vs. progress-axis are orthogonal. `status` above tracks
      // sent → delivered → read → acknowledged (arrival). `progressStatus`
      // tracks what the receiver is DOING with the case after acknowledgement:
      // in-progress | resolved | blocked. Both persist independently.
      progressStatus: null,
      blockedReason: null,
      progressHistory: [],
      // SLA overdue flag. Flipped by rules.js sla sweep when the record has
      // not reached 'acknowledged' within the tier's SLA window. Detection-only:
      // never triggers an auto-cascade — surfaces a visual badge + operator toast.
      overdue: false,
      overdueAt: null,
      // Reverse pointer from a request escalation to the dispatches
      // the recipient fired in response. Populated by the
      // receiver-dispatch handler when a receiver dispatches an asset
      // while their escalation carries an assessmentPackage.requesterRoleId
      // (i.e. they were cascaded to by someone). Reports asking
      // "requests I made that led to a dispatch" read this array
      // instead of reverse-scanning every event's counterDispatches.
      dispatchesTriggered: [],
      // Assessment package. Optional, attached when the escalation is a
      // cross-agency cascade or request-out. Frozen at cascade time and
      // preserved even if downstream event state changes, so recipient
      // profiles always see the exact "why we called you" record. See
      // scratchpad/receiver-data-flows.html for the shape rationale.
      //   operatorAssessment       freeform text from requester
      //   agenticAssessment        Mistral narrative + recommendation snapshot
      //   responseHistoryAtCascade snapshot of dispatches at cascade time
      //   cascadeReason            'tactical-urgency'|'attribution'|
      //                            'forensic-handoff'|'coordination'|'observer-loop'
      //   priority                 'critical' | 'urgent' | 'standard'
      //   requesterRoleId          the role id that initiated the cascade
      //   cascadedAt               ISO timestamp when the package was frozen
      assessmentPackage: assessmentPackage
        ? {
            // Schema version stamp on every frozen assessment package.
            // A package written today under v1 must still render if a
            // future v2 adds new fields; bump this when the shape
            // changes and gate consumers on _schemaVersion.
            _schemaVersion:           ASSESSMENT_PACKAGE_SCHEMA_VERSION,
            operatorAssessment:       (assessmentPackage.operatorAssessment || '').trim(),
            agenticAssessment:        assessmentPackage.agenticAssessment || null,
            responseHistoryAtCascade: assessmentPackage.responseHistoryAtCascade || [],
            cascadeReason:            assessmentPackage.cascadeReason || 'coordination',
            priority:                 assessmentPackage.priority || 'standard',
            requesterRoleId:          assessmentPackage.requesterRoleId || null,
            cascadedAt:               now.toISOString(),
          }
        : null,
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

// Withdraw a cascade after the fact. Situation changed (drone shot
// down before recipient acknowledged, requester decided assistance
// no longer needed). Sets status='withdrawn' and appends to
// statusHistory with a reason. Recipient's case-file renders the
// escalation with a WITHDRAWN chip so they know not to act on it.
// Detection-only stance preserved: original escalation record + all
// prior state is retained for the audit trail; withdrawal is an
// append, not a delete.
export function withdrawEscalation(eventId, escalationId, { by = 'unknown', reason = null } = {}) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !e.escalations) return null;
  const rec = e.escalations.find(r => r.id === escalationId);
  if (!rec) return null;
  if (rec.status === 'withdrawn') return rec;   // idempotent
  const now = new Date().toISOString();
  rec.status = 'withdrawn';
  rec.statusHistory.push({ timestamp: now, status: 'withdrawn', by, reason: reason || null });
  rec.withdrawnAt = now;
  rec.withdrawnBy = by;
  rec.withdrawReason = (reason || '').trim() || null;
  e.notes = e.notes || [];
  e.notes.push({
    timestamp: now,
    author: by,
    text: `Withdrew escalation to ${rec.destinationId}${reason ? '. Reason: "' + reason.trim() + '"' : '.'}`,
    type: 'escalation-withdraw',
  });
  _listeners.forEach(fn => fn(eventId));
  return rec;
}

// Reject a cascade from the RECEIVER side. Different from
// withdrawEscalation (which is sender-side revocation before the
// recipient acts). Reject is what a recipient does when they can't
// or won't act on the cascade — wrong jurisdiction, no capacity,
// out-of-scope for their role, etc. Reason is mandatory.
//
// Optional backupRoleIds carries the receiver's suggestion for where
// to route instead ("we can't take this, try X"). Doesn't itself
// re-cascade; sender sees the suggestion in their case-file and can
// choose to cascade to the backup manually.
//
// Idempotent: repeat calls with the same escalationId are no-ops.
// Append-only: statusHistory records the rejection; original
// assessment + response history preserved for audit.
//
// Detection-only invariant preserved. No new escalation is created
// automatically from a rejection; sender always chooses whether to
// route to a backup.
export function rejectEscalation(eventId, escalationId, { by = 'unknown', byRoleId = null, reason, backupRoleIds = [] } = {}) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !e.escalations) return null;
  const rec = e.escalations.find(r => r.id === escalationId);
  if (!rec) return null;
  if (rec.status === 'rejected') return rec;   // idempotent
  const trimmed = (reason || '').trim();
  if (!trimmed) return null;                    // reason required
  const now = new Date().toISOString();
  rec.status = 'rejected';
  rec.statusHistory.push({
    timestamp: now,
    status: 'rejected',
    by,
    byRoleId: byRoleId || null,
    reason: trimmed,
    backupRoleIds: Array.isArray(backupRoleIds) ? backupRoleIds.slice() : [],
  });
  rec.rejectedAt = now;
  rec.rejectedBy = by;
  rec.rejectedByRoleId = byRoleId || null;
  rec.rejectedReason = trimmed;
  rec.rejectedBackupSuggestions = Array.isArray(backupRoleIds) ? backupRoleIds.slice() : [];
  e.notes = e.notes || [];
  const backupNote = rec.rejectedBackupSuggestions.length
    ? ` Suggested backup: ${rec.rejectedBackupSuggestions.join(', ')}.`
    : '';
  e.notes.push({
    timestamp: now,
    author: by,
    text: `Rejected escalation to ${rec.destinationId}. Reason: "${trimmed}".${backupNote}`,
    type: 'escalation-reject',
  });
  _listeners.forEach(fn => fn(eventId));
  return rec;
}

// Post an update to an existing cascade. Situation evolved (new
// intel, new dispatch, priority changed) and the requester wants
// the recipient to see the update without creating a fresh
// escalation record. Appends to assessmentPackage.updates[] so the
// recipient's case-file can render the update below the original
// assessment. Timeline of updates is preserved append-only.
export function updateEscalationAssessment(eventId, escalationId, { text, by = 'unknown', priority = null } = {}) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !e.escalations) return null;
  const rec = e.escalations.find(r => r.id === escalationId);
  if (!rec) return null;
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  if (!rec.assessmentPackage) rec.assessmentPackage = {};
  if (!Array.isArray(rec.assessmentPackage.updates)) rec.assessmentPackage.updates = [];
  const now = new Date().toISOString();
  rec.assessmentPackage.updates.push({
    text: trimmed,
    priority: priority || rec.assessmentPackage.priority || null,
    by,
    at: now,
  });
  e.notes = e.notes || [];
  e.notes.push({
    timestamp: now,
    author: by,
    text: `Updated escalation to ${rec.destinationId}: "${trimmed}"`,
    type: 'escalation-update',
  });
  _listeners.forEach(fn => fn(eventId));
  return rec;
}

// Structured status extension (post-ack progress axis).
// Values: 'in-progress' | 'resolved' | 'blocked'. blockedReason required when
// progressStatus is 'blocked' (freeform string). Auto-advanced when a receiver
// dispatches a physical response CTA; also settable via explicit "Update status"
// action for freeform state changes. Detection-only: nothing here feeds back
// into agent prompts or triggers auto-cascade.
export function updateEscalationProgress(eventId, escalationId, progressStatus, { reason = null, by = 'unknown' } = {}) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !e.escalations) return null;
  const rec = e.escalations.find(r => r.id === escalationId);
  if (!rec) return null;
  const allowed = ['in-progress', 'resolved', 'blocked'];
  if (!allowed.includes(progressStatus)) return null;
  rec.progressStatus = progressStatus;
  rec.blockedReason = progressStatus === 'blocked' ? (reason || '').trim() || 'no reason given' : null;
  if (!Array.isArray(rec.progressHistory)) rec.progressHistory = [];
  rec.progressHistory.push({
    timestamp: new Date().toISOString(),
    progressStatus,
    reason: rec.blockedReason,
    by,
  });
  _listeners.forEach(fn => fn(eventId));
  return rec;
}

// SLA overdue flag. Idempotent. Called by rules.js sweep when a non-ack'd
// escalation crosses its tier SLA window. Emits a browser CustomEvent so
// main.js can surface a one-shot operator toast without importing rules.
export function setEscalationOverdue(eventId, escalationId) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !e.escalations) return null;
  const rec = e.escalations.find(r => r.id === escalationId);
  if (!rec || rec.overdue) return null;
  rec.overdue = true;
  rec.overdueAt = new Date().toISOString();
  e.notes = e.notes || [];
  e.notes.push({
    timestamp: rec.overdueAt,
    author: 'SLA sweep',
    text: `Escalation ${rec.id} to ${rec.destinationId} passed its SLA window without acknowledgement. No auto-cascade fired — operator judgement required.`,
    type: 'sla-overdue',
  });
  _listeners.forEach(fn => fn(eventId));
  try {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('escalation-overdue', {
        detail: { eventId, escalationId, destinationId: rec.destinationId },
      }));
    }
  } catch (_) { /* non-browser or CSP blocks event dispatch */ }
  return rec;
}

// Observer revoke. Removes a role from event.participants. Caller enforces
// authorization: original operator + admin can revoke anyone; a role can
// revoke observers they added themselves. Returns the removed entry (with
// roleId attached) or null when the participant was not present.
export function revokeParticipant(eventId, roleId, { revokedBy = 'unknown', reason = 'manual-revoke' } = {}) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !(e.participants instanceof Map)) return null;
  const entry = e.participants.get(roleId);
  if (!entry) return null;
  e.participants.delete(roleId);
  e.notes = e.notes || [];
  e.notes.push({
    timestamp: new Date().toISOString(),
    author: revokedBy,
    text: `Removed ${roleId} from event participants (${reason}).`,
    type: 'participant-revoke',
  });
  _listeners.forEach(fn => fn(eventId));
  return { roleId, ...entry };
}

// Post-incident handoff chain. Each entry represents one ground-handoff
// destination. Root entries (chainParentId === null) come from Step 5
// dispatchPostIncident. Child entries come from a subsequent handoff by
// whoever holds the parent record. Close-event gate: every leaf (an entry
// with no child referencing it as parent) must be status 'resolved'.
let _chainCounter = 0;
function _nextChainId() {
  _chainCounter++;
  const now = new Date();
  return `PIC-${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}-${String(_chainCounter).padStart(4,'0')}`;
}
export function addPostIncidentChainRoot(eventId, destId, dispatchedBy) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !destId) return null;
  if (!Array.isArray(e.postIncidentChain)) e.postIncidentChain = [];
  const now = new Date().toISOString();
  const entry = {
    id: _nextChainId(),
    destId,
    chainParentId: null,
    dispatchedBy,
    dispatchedAt: now,
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
  };
  e.postIncidentChain.push(entry);
  _listeners.forEach(fn => fn(eventId));
  return entry;
}
export function handoffPostIncidentChain(eventId, parentChainId, newDestId, dispatchedBy) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !Array.isArray(e.postIncidentChain) || !newDestId || !parentChainId) return null;
  const parent = e.postIncidentChain.find(c => c.id === parentChainId);
  if (!parent) return null;
  const now = new Date().toISOString();
  const entry = {
    id: _nextChainId(),
    destId: newDestId,
    chainParentId: parentChainId,
    dispatchedBy,
    dispatchedAt: now,
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
  };
  e.postIncidentChain.push(entry);
  _listeners.forEach(fn => fn(eventId));
  return entry;
}
export function resolvePostIncidentChainEntry(eventId, chainId, resolvedBy) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !Array.isArray(e.postIncidentChain)) return null;
  const entry = e.postIncidentChain.find(c => c.id === chainId);
  if (!entry || entry.status === 'resolved') return entry || null;
  entry.status = 'resolved';
  entry.resolvedAt = new Date().toISOString();
  entry.resolvedBy = resolvedBy;
  _listeners.forEach(fn => fn(eventId));
  return entry;
}
export function postIncidentChainLeaves(event) {
  if (!event || !Array.isArray(event.postIncidentChain)) return [];
  const parentIds = new Set(event.postIncidentChain.map(c => c.chainParentId).filter(Boolean));
  return event.postIncidentChain.filter(c => !parentIds.has(c.id));
}
export function postIncidentChainAllLeavesResolved(event) {
  const leaves = postIncidentChainLeaves(event);
  if (!leaves.length) return false;
  return leaves.every(l => l.status === 'resolved');
}

export function respondToEscalation(eventId, escalationId, text, respondedBy, respondedByRoleId = null) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !e.escalations) return;
  const rec = e.escalations.find(r => r.id === escalationId);
  if (!rec || !text || !text.trim()) return;
  // Append to responses[] as the canonical source of truth so multiple
  // replies preserve the full thread. Audit flagged that the prior
  // single-slot rec.response overwrote earlier replies destructively.
  // rec.response is kept as a legacy alias pointing at the LATEST
  // entry so pre-existing consumers keep rendering the newest reply
  // without a coordinated rewrite; new consumers should read
  // rec.responses[] for the full thread.
  //
  // respondedByRoleId is the structured role id alongside the freeform
  // display string. Reports needing per-agency reply metrics filter
  // on the structured field; UI keeps rendering the display string.
  if (!Array.isArray(rec.responses)) rec.responses = [];
  const entry = {
    receivedAt: new Date().toISOString(),
    respondedBy,
    respondedByRoleId,
    text: text.trim(),
  };
  rec.responses.push(entry);
  rec.response = entry;
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

// Phase 3 backfill — seed EVENTS defined inline above predate the
// tenant model. Stamp tenantId on every seed event at module load
// using the same tenantForSite() resolution addEvent() uses for new
// events. Once every event has tenantId, the Phase 3 filter has a
// complete data set to work against. Manifests that don't declare a
// tenant leave the event with tenantId = null (invisible to operator
// actors, visible to admin bypass — same as any future orphan).
EVENTS.forEach(e => {
  if (e.tenantId === undefined) e.tenantId = tenantForSite(e.siteId);
});

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
export function getSelectedEvent() {
  if (!_selectedEventId) return null;
  return getEvent(_selectedEventId);   // routes through actor filter
}
export function selectEvent(id) {
  _selectedEventId = id;
  _listeners.forEach(fn => fn(id));
}
export function clearSelection() { selectEvent(null); }
export function onSelectionChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
export function getEvent(id) {
  const e = EVENTS.find(x => x.id === id);
  if (!e) return null;
  return _visibleToActor(e, _currentActor) ? e : null;
}

// ═══════════════════════════════════════════════════════════════════
// Actor context + tenant scoping (Phase 3 of the state-consolidation
// refactor). See scripts/check-event-mutations.mjs for the Phase 1
// safety net + docs/phase3-tenant-isolation-postmortem.pdf for design.
// ───────────────────────────────────────────────────────────────────
// Every event carries an immutable `tenantId` stamped at creation from
// SITES[siteId].operatorAccountId. Every read function in this module
// filters against the ambient current actor (set from the role
// dropdown via setCurrentActor). Cross-tenant xlink chains surface
// only what the active actor is allowed to see — the operator's view
// of a chain that crossed into another tenant contains only their own
// tenant's events; the linked-out entries are invisible at the data
// layer, not just redacted at render time.
//
// Ambient actor is the same pattern server-side auth uses: JWT →
// middleware sets req.user → downstream handlers read it implicitly.
// Client-side, the dropdown sets it. When Azure auth lands, the boot
// path swaps from getActiveRole() to a session-fetched claim. Every
// read-function signature stays identical.
//
// Default when _currentActor is null: RAW ACCESS (no filter). Used
// during boot bootstrap and inside events.js itself. Once main.js
// finishes boot and calls setCurrentActor(actorFromRole(...)), every
// subsequent read is scoped. In production this default becomes
// default-deny once every callsite provably passes through the actor
// path (dev-mode warning at every unfiltered read will surface any
// bootstrap paths that leaked through).
// ═══════════════════════════════════════════════════════════════════

let _currentActor = null;
const _adminBypassRoleIds = new Set();

export function setCurrentActor(actor) {
  _currentActor = actor;
  // Role change is a re-render trigger — every listener re-runs its
  // filter against the new actor.
  _listeners.forEach(fn => fn(null));
}
export function getCurrentActor() { return _currentActor; }

// Register a role id as admin-bypass. Reads under this role skip the
// tenant filter entirely. Wired at boot in main.js for the ISR admin
// account. Explicitly opt-in — no role.kind === 'admin' auto-bypass.
export function registerActorAdminBypass(roleId) {
  if (roleId) _adminBypassRoleIds.add(roleId);
}

// Look up the tenant id for a site. Primary source: SITES manifest
// `tenant` field (surfaces on the loaded record as operatorAccountId).
// Returns null if the site is unknown or the manifest is silent.
export function tenantForSite(siteId) {
  if (!siteId) return null;
  return SITES[siteId]?.operatorAccountId || null;
}

// Convert a role object (from getActiveRole()) into an actor context
// suitable for tenant-scoped reads. Handles the three tenant kinds:
// admin (bypass), operator (tenant-scoped), receiver (destination-scoped).
export function actorFromRole(role) {
  if (!role) return null;
  const isBypass = _adminBypassRoleIds.has(role.id) || role.kind === 'admin';
  if (isBypass) {
    return { kind: 'admin', roleId: role.id, isAdminBypass: true };
  }
  if (role.kind === 'operator') {
    // Operator tenant = the site.operatorAccountId of any site the role
    // owns. All sites belonging to one operator share the same tenant
    // id by construction (site manifests + OPERATORS registry aligned).
    const siteId = Array.isArray(role.siteIds) ? role.siteIds[0] : null;
    const tenantId = tenantForSite(siteId) || role.id;
    return {
      kind: 'operator',
      roleId: role.id,
      tenantId,
      siteIds: Array.isArray(role.siteIds) ? role.siteIds : [],
    };
  }
  if (role.kind === 'receiver') {
    return {
      kind: 'receiver',
      roleId: role.id,
      destinationIds: Array.isArray(role.destinationIds) ? role.destinationIds : [],
    };
  }
  return null;
}

// Core visibility check. Applied by every read function in this module
// before returning event data. Also exported for internal callers that
// need to check membership without fetching (e.g. xlink graph pruning).
export function _visibleToActor(event, actor) {
  if (!event) return false;
  if (!actor) return true;                                // pre-boot / no filter
  if (actor.isAdminBypass || actor.kind === 'admin') return true;
  if (actor.kind === 'operator') {
    return event.tenantId === actor.tenantId;
  }
  if (actor.kind === 'receiver') {
    // Receivers see events cascaded to any of their destinations. This
    // is the ONE tenant surface that already worked pre-Phase-3 via
    // eventsForDestinations() — preserved verbatim here.
    return (event.escalations || []).some(r => actor.destinationIds.includes(r.destinationId));
  }
  return false;                                           // unknown actor kind = deny
}

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
  const base = EVENTS
    .filter(e => e.detected !== false)
    .filter(e => _visibleToActor(e, _currentActor));   // Phase 3 tenant scope
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

// ── Domain scope (per event) ──
// Every event carries a domainScope array declaring which operational
// domains are relevant to it. Starts from site type + platform when the
// event is created; grows as the trajectory crosses domain boundaries
// or as shadow events are linked at other sites. destinations.js reads
// this to filter who receives escalations for the event.
//
// Site type is registered by main.js at boot via registerSiteDomains()
// so we avoid a SITES import cycle here. Same pattern as _SITE_NAMES.
const _SITE_DEFAULT_DOMAINS = {};
export function registerSiteDomains(siteId, domains) {
  if (!siteId || !Array.isArray(domains) || !domains.length) return;
  _SITE_DEFAULT_DOMAINS[siteId] = [...new Set(domains)];
}
export function defaultDomainsForSite(siteId) {
  return _SITE_DEFAULT_DOMAINS[siteId] ? [..._SITE_DEFAULT_DOMAINS[siteId]] : ['ground'];
}
function _computeInitialDomainScope(event) {
  const scope = new Set(defaultDomainsForSite(event.siteId));
  // Airborne platforms always add aviation regardless of site type.
  if (event.platform === 'missile' || event.platform === 'jet' || event.platform === 'fixed-wing') {
    scope.add('aviation');
  }
  // Quadcopters + rotary craft over harbour sites already carry both
  // scopes from the site default. Nothing extra to add here.
  return [...scope];
}
// Public expander used when trajectory crosses a domain boundary or a
// shadow event is linked. Idempotent: adding a domain already in scope
// no-ops. Emits listener notification so consumers re-render.
export function expandEventDomainScope(eventId, ...domains) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !domains.length) return null;
  if (!Array.isArray(e.domainScope)) e.domainScope = _computeInitialDomainScope(e);
  const before = e.domainScope.length;
  const merged = new Set([...e.domainScope, ...domains.filter(Boolean)]);
  e.domainScope = [...merged];
  if (e.domainScope.length !== before) _listeners.forEach(fn => fn(eventId));
  return e.domainScope;
}
// Recompute domainScope for every seed event. Necessary because seed
// EVENTS backfill runs at events.js module init (before main.js has
// registered site domains via registerSiteDomains), so seed events
// otherwise carry the fallback `['ground']` scope even when their
// site is an airport or harbour. main.js calls this once immediately
// after the register-site-domains loop to close the gap. Idempotent
// for dynamically-spawned events (their addEvent computed the correct
// scope from the already-populated registry).
export function refreshSeedDomainScopes() {
  EVENTS.forEach(e => {
    e.domainScope = _computeInitialDomainScope(e);
  });
  _listeners.forEach(fn => fn(null));
}

// Union linked events' scopes into this event's scope (shadow-chain
// merge). Called from main.js when linkedEventIds is populated.
// Phase 3: operator actors only union domains from same-tenant linked
// events — cross-tenant xlink metadata is invisible at the data layer.
// Admin bypass + no-actor bootstrap paths union everything (unchanged).
export function unionLinkedEventDomains(eventId) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !Array.isArray(e.linkedEventIds) || !e.linkedEventIds.length) return null;
  const scope = new Set(Array.isArray(e.domainScope) ? e.domainScope : _computeInitialDomainScope(e));
  const actor = _currentActor;
  e.linkedEventIds.forEach(linkedId => {
    const linked = EVENTS.find(x => x.id === linkedId);
    if (!linked) return;
    // Tenant gate: operator actor only unions same-tenant linked events.
    if (actor?.kind === 'operator' && linked.tenantId !== actor.tenantId) return;
    if (Array.isArray(linked.domainScope)) {
      linked.domainScope.forEach(d => scope.add(d));
    }
  });
  const changed = scope.size !== (Array.isArray(e.domainScope) ? e.domainScope.length : 0);
  e.domainScope = [...scope];
  if (changed) _listeners.forEach(fn => fn(eventId));
  return e.domainScope;
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

// ═══════════════════════════════════════════════════════════════════
// Event mutation API (Phase 1 of the state-consolidation refactor)
// ───────────────────────────────────────────────────────────────────
// POLICY: events.js is the ONLY module that writes to event objects.
// Every other module reads events + calls one of the mutators below.
// The static check at scripts/check-event-mutations.mjs enforces this
// via grep at build time.
//
// Two tiers of mutators:
//
//   Primitives      — generic write helpers (mutateEvent / appendEvent
//                     Array / addToEventSet / setEventMapKey). Use for
//                     scalar or single-field updates.
//
//   Semantic        — named functions that update several fields
//                     together as one lifecycle transition (linkEvents,
//                     markNeutralised, attachPostIncidentReport, etc).
//                     Use these when the update is a meaningful event
//                     rather than a raw field change.
//
// All mutators return the mutated event (or null if id not found) and
// fire the standard _listeners fanout so UI re-renders happen. Callsite
// code stays roughly the same length but every write is now visible in
// events.js grep-history and every write goes through the same seam
// (which is where Azure server-side persistence will attach later).
// ═══════════════════════════════════════════════════════════════════

// ── Primitives ────────────────────────────────────────────────────
//
// Primitives are SILENT by default. Many writes happen in the tick
// loop at 60Hz (lastPosition, _droneCovState, _siteAgg etc). Firing
// _listeners on every one would cause a re-render storm. The tick
// loop already orchestrates its own render at the end of each tick.
// Callers that want a listener fire pass { notify: true }.
//
// Semantic mutators (below) fire listeners by default — they represent
// meaningful lifecycle transitions where a UI update is expected.

// Merge scalar / object fields into an event. Object.assign semantics —
// arrays should use appendEventArray, Sets should use addToEventSet.
export function mutateEvent(id, patch, { notify = false } = {}) {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !patch || typeof patch !== 'object') return null;
  Object.assign(e, patch);
  if (notify) _listeners.forEach(fn => fn(id));
  return e;
}

// Append to an array field on an event. Lazily creates the array if
// missing (so callers don't need an "if (!e.foo) e.foo = []" preamble).
export function appendEventArray(id, field, item, { notify = false } = {}) {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !field) return null;
  if (!Array.isArray(e[field])) e[field] = [];
  e[field].push(item);
  if (notify) _listeners.forEach(fn => fn(id));
  return e;
}

// Add to a Set field on an event. Lazily creates the Set if missing.
// Used for de-duped membership tracking (e.g. _reacquiredSites,
// _interceptorGroupsCompleted).
export function addToEventSet(id, field, item, { notify = false } = {}) {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !field) return null;
  if (!(e[field] instanceof Set)) e[field] = new Set();
  e[field].add(item);
  if (notify) _listeners.forEach(fn => fn(id));
  return e;
}

// Set a key on a Map field on an event. Lazily creates the Map.
// Used for per-drone state maps kept on the event (_droneCovState,
// _droneInsideState, participants).
export function setEventMapKey(id, field, key, value, { notify = false } = {}) {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !field) return null;
  if (!(e[field] instanceof Map)) e[field] = new Map();
  e[field].set(key, value);
  if (notify) _listeners.forEach(fn => fn(id));
  return e;
}

// Set a key on a plain-object field on an event. Sibling of
// setEventMapKey for cases where the sub-field is a regular {} rather
// than a real Map (bracket-key writes like event._siteAgg[siteId] = agg,
// event.dispatchOutcomes[dispatchId] = outcome). Lazily creates the
// object if missing.
export function setEventObjectKey(id, field, key, value, { notify = false } = {}) {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !field) return null;
  if (!e[field] || typeof e[field] !== 'object' || Array.isArray(e[field]) || e[field] instanceof Map || e[field] instanceof Set) {
    e[field] = {};
  }
  e[field][key] = value;
  if (notify) _listeners.forEach(fn => fn(id));
  return e;
}

// ── Semantic mutators ────────────────────────────────────────────

// Link two events bidirectionally + record correlation score. Replaces
// the three-line "eventA.linkedEventIds.push(idB); eventB.linkedEventIds
// .push(idA); eventA.correlationScore = s" pattern at every callsite.
export function linkEvents(idA, idB, correlationScore = null) {
  const a = EVENTS.find(x => x.id === idA);
  const b = EVENTS.find(x => x.id === idB);
  if (!a || !b || idA === idB) return null;
  if (!Array.isArray(a.linkedEventIds)) a.linkedEventIds = [];
  if (!Array.isArray(b.linkedEventIds)) b.linkedEventIds = [];
  if (!a.linkedEventIds.includes(idB)) a.linkedEventIds.push(idB);
  if (!b.linkedEventIds.includes(idA)) b.linkedEventIds.push(idA);
  if (correlationScore != null) {
    a.correlationScore = correlationScore;
    b.correlationScore = correlationScore;
  }
  _listeners.forEach(fn => fn(idA));
  _listeners.forEach(fn => fn(idB));
  return { a, b };
}

// Stamp neutralisation lifecycle. Bundles 4-5 fields that were
// previously written on separate lines: outcome, neutralisedAt (also
// legacy neutralizedAt spelling — both preserved for now), the
// dispatch responsible, and the actor that pulled the trigger. Also
// sets the needsPostIncident flag if requested by the caller.
export function markNeutralised(id, { outcome = 'neutralised', at = null, byDispatchId = null, by = null, needsPostIncident = true } = {}) {
  const e = EVENTS.find(x => x.id === id);
  if (!e) return null;
  const stampIso = at || new Date().toISOString();
  e.outcome = outcome;
  e.neutralisedAt = stampIso;
  e.neutralizedAt = stampIso;   // legacy alias, kept until every reader migrates
  if (byDispatchId != null) e.neutralisedByDispatchId = byDispatchId;
  if (by != null) e.neutralizedBy = by;
  if (needsPostIncident) e.needsPostIncident = true;
  e.projectedPath = null;   // projected path no longer meaningful post-neutralisation
  _listeners.forEach(fn => fn(id));
  return e;
}

// Adapter-facing: record an interaction. Used by escalation_mock,
// dispatch_mock, and any real adapter that lands later. Keeps
// interactions[] lifecycle in one place so the Azure Blob WORM swap
// only needs to hook this one function.
export function recordInteraction(id, interaction) {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !interaction) return null;
  if (!Array.isArray(e.interactions)) e.interactions = [];
  e.interactions.push(interaction);
  _listeners.forEach(fn => fn(id));
  return e;
}

// Classification pipeline attaches the fused DetectionSubject.
// Replaces detection_subject.js:243 direct write. Also invalidates the
// narrative cache since the subject changed.
export function updateEventSubject(id, subject) {
  const e = EVENTS.find(x => x.id === id);
  if (!e || !subject) return null;
  e.subject = subject;
  e.narrativeCache = null;
  _listeners.forEach(fn => fn(id));
  return e;
}

// Record a dispatch outcome on an event. Bracket-based write on
// event.dispatchOutcomes[dispatchId] previously escaped the Phase 1
// grep (nested write on an event-owned object). Semantic mutator
// gives it a first-class name and keeps the mutation inside events.js.
export function setDispatchOutcome(eventId, dispatchId, outcome) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!e || !dispatchId || !outcome) return null;
  if (!e.dispatchOutcomes || typeof e.dispatchOutcomes !== 'object') {
    e.dispatchOutcomes = {};
  }
  e.dispatchOutcomes[dispatchId] = outcome;
  _listeners.forEach(fn => fn(eventId));
  return e;
}

// Attach a post-incident report to an event. Replaces the multiple PIR
// write sites (initial creation at closeEvent, live update as linked
// events arrive, chain resolution). Single seam for anything that
// stamps a PIR onto an event.
export function attachPostIncidentReport(id, pir) {
  const e = EVENTS.find(x => x.id === id);
  if (!e) return null;
  e.postIncidentReport = pir;
  _listeners.forEach(fn => fn(id));
  return e;
}

// Narrative + preprocessing cache management. Callers previously wrote
// null directly to invalidate. Named functions make the intent obvious
// at the callsite ("invalidateNarrativeCache(id)" reads better than
// "e.narrativeCache = null").
export function clearNarrativeCache(id) {
  const e = EVENTS.find(x => x.id === id);
  if (!e) return null;
  e.narrativeCache = null;
  _listeners.forEach(fn => fn(id));
  return e;
}
export function setNarrativeCache(id, cache) {
  const e = EVENTS.find(x => x.id === id);
  if (!e) return null;
  e.narrativeCache = cache;
  _listeners.forEach(fn => fn(id));
  return e;
}
export function clearPreprocessedCache(id) {
  const e = EVENTS.find(x => x.id === id);
  if (!e) return null;
  e._preprocessed = null;
  _listeners.forEach(fn => fn(id));
  return e;
}
export function setPreprocessedCache(id, preprocessed) {
  const e = EVENTS.find(x => x.id === id);
  if (!e) return null;
  e._preprocessed = preprocessed;
  _listeners.forEach(fn => fn(id));
  return e;
}
