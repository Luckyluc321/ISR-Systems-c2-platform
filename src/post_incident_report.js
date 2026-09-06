// Post-Incident Report (PIR) generator.
//
// Assembles the full audit-grade record of a closed event into one
// structured object. Reuses whatever Agent B narrative was cached on
// the event; falls back to a deterministic template when the model
// output was never produced. Domain-shaped emphasis at the top so
// PET reads it as intel, Politi reads it as ground evidence, aviation
// regulators read it as airspace impact.
//
// Detection-only invariant: the PIR is a READ artifact. It never
// triggers any action. Nothing in this file calls escalateEvent,
// dispatch adapters, or agents. Pure state assembly from event data
// that already exists at close.
//
// Placement: Phase B of the event-transmission-relevance work.
// Fires per-event at closeEvent. For cross-linked shadow events each
// site's event record closes independently, so each site's receivers
// see their own PIR panel the moment their site portion is done.

// Public: build the report structure for an event. Pass the event
// object directly (not the id) so this module stays free of a
// circular import to events.js. Returns a plain object attached by
// the caller as event.postIncidentReport.
export function buildPostIncidentReport(event, { getDestination = null } = {}) {
  if (!event) return null;
  const generatedAt = new Date().toISOString();

  // Reuse cached narrative when present; otherwise render a
  // deterministic summary from the subject so the PIR is always
  // populated even when the model never fired.
  const narrative = event.narrativeCache?.body?.trim();
  const recommendation = event.narrativeCache?.recommendation?.trim();
  const summary = narrative || _defaultSummary(event);

  // Timeline stitched from every load-bearing event on the record.
  const timeline = _buildTimeline(event);

  // Escalations flattened into a stable audit shape.
  const escalations = _mapEscalations(event, getDestination);

  // Counter-dispatches (what was ordered, by whom, with what outcome).
  const dispatches = Array.isArray(event.counterDispatches)
    ? event.counterDispatches.map(cd => ({
        id: cd.dispatchId || cd.id,
        kind: cd.kind || null,
        assetName: cd.assetName || cd.asset?.name || null,
        dispatchedAt: cd.dispatchedAt || null,
        state: cd.state || null,
        outcomeLabel: event.dispatchOutcomes?.[cd.dispatchId]?.outcomeLabel || null,
        notes: event.dispatchOutcomes?.[cd.dispatchId]?.notes || null,
      }))
    : [];

  // Post-incident handoff chain (from Phase 3 of the escalation
  // extensions work). Each entry gets its display name resolved when
  // getDestination is available.
  const handoffChain = Array.isArray(event.postIncidentChain)
    ? event.postIncidentChain.map(c => ({
        id: c.id,
        destId: c.destId,
        destName: getDestination?.(c.destId)?.name || c.destId,
        chainParentId: c.chainParentId,
        status: c.status,
        dispatchedBy: c.dispatchedBy,
        dispatchedAt: c.dispatchedAt,
        resolvedAt: c.resolvedAt,
        resolvedBy: c.resolvedBy,
      }))
    : [];

  // Acknowledgment log — every receiver that replied.
  const acknowledgments = Array.isArray(event.escalations)
    ? event.escalations
        .filter(r => r.response)
        .map(r => ({
          destinationId: r.destinationId,
          destinationName: getDestination?.(r.destinationId)?.name || r.destinationId,
          respondedBy: r.response.respondedBy,
          receivedAt: r.response.receivedAt,
          text: r.response.text,
        }))
    : [];

  return {
    id: `PIR-${event.id}`,
    version: 1,
    generatedAt,
    generatedBy: 'system',
    event_snapshot: {
      id: event.id,
      siteId: event.siteId,
      classification: event.classification,
      threat: event.threat,
      droneType: event.droneType,
      platform: event.platform,
      confidence: event.confidence,
      startTime: event.startTime,
      endTime: event.endTime || event.closedAt,
      duration: event.duration,
      outcome: event.outcome,
      domainScope: Array.isArray(event.domainScope) ? [...event.domainScope] : [],
      linkedEventIds: Array.isArray(event.linkedEventIds) ? [...event.linkedEventIds] : [],
    },
    summary,
    recommendation: recommendation || null,
    detection: {
      subject: event.subject || null,
      sensors: Array.isArray(event.contributingSensors) ? [...event.contributingSensors] : [],
      evidence: event.evidence || null,
      entry: event.entry || null,
      exit: event.exit || null,
    },
    timeline,
    escalations,
    dispatches,
    handoff_chain: handoffChain,
    acknowledgments,
  };
}

// Section-emphasis header text tailored to receiver branch. Reads the
// domain the receiver's role cares about most and surfaces that first.
// Same PIR data underneath — this is a lens, not a mutation.
export function emphasisForBranch(branch) {
  const map = {
    politi: {
      lead: 'Ground evidence + patrol coordination',
      focus: 'Cordon integrity, witnesses, physical evidence recovered, patrol logs.',
    },
    forsvaret: {
      lead: 'Defence posture + capability engagement',
      focus: 'Assets committed, engagement outcomes, airspace picture, rules of engagement audit.',
    },
    intel: {
      lead: 'Pattern-of-life + attribution picture',
      focus: 'Platform signature match, prior incidents at site, correlated tracks, adversary hypotheses.',
    },
    aviation: {
      lead: 'Airspace impact + regulator response',
      focus: 'NOTAM issued, arrival/departure delays, ATC coordination, altitude/heading profile.',
    },
    maritime: {
      lead: 'Maritime traffic + shipping impact',
      focus: 'AIS advisory, vessels notified, shipping-lane clearance, coast guard actions.',
    },
    brs: {
      lead: 'Consequence-response posture',
      focus: 'Hazmat, casualty triage, evacuation coordination, mutual aid dispatched.',
    },
    hjv: {
      lead: 'Territorial reinforcement',
      focus: 'Volunteer callouts, perimeter reinforcement, checkpoint activation.',
    },
    region: {
      lead: 'Medical readiness',
      focus: 'Ambulance standby, hospital triage prep, casualty count.',
    },
    kommune: {
      lead: 'Municipal impact + public communication',
      focus: 'Shelter-in-place, public advisory, kommune crisis staff activation.',
    },
    agency: {
      lead: 'Regulatory action taken',
      focus: 'Advisories issued, jurisdictional coordination.',
    },
    standalone: {
      lead: 'Full incident record',
      focus: 'Detection, dispatch, and closure audit.',
    },
  };
  return map[branch] || map.standalone;
}

// ── internals ──

function _defaultSummary(event) {
  const drone = event.droneType || event.platform || 'unknown platform';
  const cls = event.classification || 'unknown';
  const site = event.siteId || 'site';
  const conf = event.confidence != null ? Math.round(event.confidence * 100) + '%' : 'unknown confidence';
  const durSec = event.duration || 0;
  const durMin = Math.max(1, Math.round(durSec / 60));
  return `${drone} classified ${cls} at ${site}, ${conf} peak confidence, tracked for ${durMin} minute${durMin === 1 ? '' : 's'}. No cached narrative available; this summary was generated from the raw event record at close.`;
}

function _buildTimeline(event) {
  const t = [];
  if (event.startTime) t.push({ ts: event.startTime, kind: 'detected', detail: `${event.droneType || 'Unknown platform'} classified ${event.classification || 'unknown'}` });
  if (Array.isArray(event.escalations)) {
    event.escalations.forEach(r => {
      if (r.initiatedAt) t.push({ ts: r.initiatedAt, kind: 'escalated', detail: `Dispatched to ${r.destinationId}` });
      if (Array.isArray(r.statusHistory)) {
        r.statusHistory.forEach(h => {
          if (h.status === 'acknowledged') t.push({ ts: h.timestamp, kind: 'acknowledged', detail: `${r.destinationId} acknowledged` });
        });
      }
      if (r.overdueAt) t.push({ ts: r.overdueAt, kind: 'sla-overdue', detail: `SLA overdue on dispatch to ${r.destinationId}` });
      if (Array.isArray(r.progressHistory)) {
        r.progressHistory.forEach(p => {
          t.push({ ts: p.timestamp, kind: `progress-${p.progressStatus}`, detail: `${r.destinationId} status ${p.progressStatus}${p.reason ? ' (' + p.reason + ')' : ''}` });
        });
      }
    });
  }
  if (Array.isArray(event.counterDispatches)) {
    event.counterDispatches.forEach(cd => {
      if (cd.dispatchedAt) t.push({ ts: cd.dispatchedAt, kind: 'counter-dispatched', detail: `${cd.assetName || cd.kind || 'asset'} dispatched` });
    });
  }
  if (Array.isArray(event.postIncidentChain)) {
    event.postIncidentChain.forEach(c => {
      if (c.dispatchedAt) t.push({ ts: c.dispatchedAt, kind: 'ground-dispatched', detail: `Ground handoff to ${c.destId}${c.chainParentId ? ' (chained)' : ' (root)'}` });
      if (c.resolvedAt) t.push({ ts: c.resolvedAt, kind: 'chain-resolved', detail: `${c.destId} marked resolved` });
    });
  }
  if (event.closedAt) t.push({ ts: event.closedAt, kind: 'closed', detail: `Event closed with outcome ${event.outcome || 'unknown'}` });
  if (event.endTime && event.endTime !== event.closedAt) t.push({ ts: event.endTime, kind: 'tracking-ended', detail: 'Tracking ended' });
  // Stable ascending sort so timeline is chronological regardless of source order.
  return t.filter(x => x.ts).sort((a, b) => a.ts.localeCompare(b.ts));
}

function _mapEscalations(event, getDestination) {
  if (!Array.isArray(event.escalations)) return [];
  return event.escalations.map(r => ({
    id: r.id,
    destinationId: r.destinationId,
    destinationName: getDestination?.(r.destinationId)?.name || r.destinationId,
    tier: getDestination?.(r.destinationId)?.tier || null,
    initiatedAt: r.initiatedAt,
    initiatedBy: r.initiatedBy,
    payload: r.payload,
    status: r.status,
    overdue: !!r.overdue,
    overdueAt: r.overdueAt || null,
    progressStatus: r.progressStatus || null,
    blockedReason: r.blockedReason || null,
    responded: !!r.response,
  }));
}
