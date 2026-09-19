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
    // Downed airframes: every wreckage on this event with position,
    // time, and what downed it. One of the most operationally
    // important facts of an incident; forensic teams, cordon
    // planning, and evidence chains all key off these coordinates.
    downed_airframes: (event.wreckages || []).map(w => ({
      id: w.id,
      lat: w.lat, lon: w.lon,
      at: w.at,
      downed_by: w.downedBy || null,
      model: w.model || null,
      is_impact_site: !!w.isImpact,
    })),
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

// ═══════════════════════════════════════════════════════════════════
// Chain PIR builder — cross-site combined evidence report
// ───────────────────────────────────────────────────────────────────
// Implements docs/integration-contracts.md Section 4 chain-scope
// export. Bundles every PIR in a multi-event chain into one
// coherent envelope so a receiver / operator / auditor can pull
// the full campaign record instead of one event at a time.
//
// Reads from xlink_graph.chainFor() to enumerate chain members,
// builds per-event PIR via buildPostIncidentReport() (already
// cached on event.postIncidentReport for closed events; live-build
// as fallback for events that closed pre-PIR-generator hookup),
// then aggregates chain-level metadata (narrative, cross-event
// contributor presence, unified timeline).
//
// Consumers:
//   - PIR export endpoint (Section 4) when scope=chain
//   - Cross-site combined evidence UI in PIR panel (planned)
//   - Machine-readable JSON downloads for external audit
//
// Detection-only invariant preserved. Chain bundler is read-only;
// no writes, no dispatch, no state mutation.
export function buildChainPostIncidentReport(events, chainSummary, { getDestination = null } = {}) {
  if (!Array.isArray(events) || !events.length || !chainSummary) return null;

  // Sort events chronologically for a coherent report reading order.
  const orderedEvents = events.slice().sort((a, b) => {
    const ta = a.startTime || '';
    const tb = b.startTime || '';
    return ta.localeCompare(tb);
  });

  // Per-event PIR — use cached postIncidentReport when present
  // (populated by closeEvent hookup); live-build for any event
  // without a cached record.
  const events_pir = orderedEvents.map(ev => {
    if (ev.postIncidentReport) return ev.postIncidentReport;
    return buildPostIncidentReport(ev, { getDestination });
  }).filter(Boolean);

  // Cross-event contributor presence: which role touched which events.
  // Aggregates from every event's escalations + counterDispatches +
  // catalog authorship. Lets the reader see "Politi Kbh was involved
  // in events 1, 2, 4 of this 4-event chain" at a glance.
  const contributorPresence = new Map();
  for (const ev of orderedEvents) {
    const seenThisEvent = new Set();
    const noteRole = (rid) => {
      if (!rid || seenThisEvent.has(rid)) return;
      seenThisEvent.add(rid);
      if (!contributorPresence.has(rid)) contributorPresence.set(rid, []);
      contributorPresence.get(rid).push(ev.id);
    };
    for (const r of (ev.escalations || [])) {
      noteRole(r.initiatedByRoleId);
      // destinationId is a destination id, not a role id — resolver
      // handles the destination → owner-role map if provided
      if (r.destinationId && getDestination) {
        const dest = getDestination(r.destinationId);
        if (dest?.ownerRoleId) noteRole(dest.ownerRoleId);
      }
    }
    for (const cd of (ev.counterDispatches || [])) {
      noteRole(cd.ownerRoleId);
    }
    if (ev.catalog && typeof ev.catalog === 'object') {
      for (const key of Object.keys(ev.catalog)) {
        const arr = ev.catalog[key];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) noteRole(entry?.authorRoleId);
      }
    }
  }

  const contributors = Array.from(contributorPresence.entries()).map(([roleId, eventIds]) => ({
    role_id:       roleId,
    events:        eventIds,
    event_count:   eventIds.length,
    span_percent:  Math.round(100 * eventIds.length / orderedEvents.length),
  }));
  // Sort by event count descending — most-involved contributors first.
  contributors.sort((a, b) => b.event_count - a.event_count);

  // Unified timeline across every event in the chain.
  const unifiedTimeline = [];
  for (const pir of events_pir) {
    for (const t of (pir.timeline || [])) {
      unifiedTimeline.push({
        event_id: pir.event_snapshot?.id || null,
        ts: t.ts,
        kind: t.kind,
        detail: t.detail,
      });
    }
  }
  unifiedTimeline.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));

  // Sites touched across the chain.
  const sites = Array.from(new Set(orderedEvents.map(e => e.siteId).filter(Boolean)));

  return {
    id: `PIR-CHAIN-${chainSummary.id}`,
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: 'system',
    chain: {
      id:            chainSummary.id,
      size:          chainSummary.size,
      first_at:      chainSummary.firstAt,
      last_at:       chainSummary.lastAt,
      span_minutes:  chainSummary.spanMinutes,
      sites,
    },
    events_pir,   // full per-event PIR list, chronological
    contributors, // aggregated cross-event presence
    unified_timeline: unifiedTimeline,
    event_count: orderedEvents.length,
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
