// ═══════════════════════════════════════════════════════════════════
// Chapter composer — assembles a contributor's chapter in the PIR
// ───────────────────────────────────────────────────────────────────
// Phase 3 of the recipient chapter shapes design. Pure function
// (role, event) → HTMLString. One chapter per contributor. Chapter =
// 4 canonical top blocks + 0-8 archetype sub-sections. Empty return
// when the role did not contribute anything to this event so the
// Phase 4 master PIR composer can iterate every RECEIVERS entry and
// only surface the ones that earned a chapter.
//
// Reads only. Never mutates event state. Every string that reaches
// innerHTML passes through esc() so a rogue reply or operator note
// cannot break the render.
//
// See docs/cross-agency-flows.md Section 7 for the composition rule
// and scratchpad/recipient-report-shapes.html for the visual contract.
// ═══════════════════════════════════════════════════════════════════

import { ARCHETYPE_LABELS } from './archetypes.js';
import { subsectionsForContributor, renderAllSubsections } from './report_subsections.js';

// ── Formatting helpers ──────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const _fmtTime = (iso) => iso ? iso.slice(11, 19) + 'Z' : '';
const _fmtDate = (iso) => iso ? iso.slice(0, 10) : '';

// ── Contributor detection ──────────────────────────────────────
//
// A role contributed to this event if ANY of these is true:
// (a) initiated an escalation on this event
// (b) received an escalation as destination and either responded to
//     it, acknowledged it, or fired a downstream dispatch under it
// (c) owns any counter-dispatch on this event
// (d) authored any catalog entry on this event
//
// Membership via any of these paths is enough. Detection stays
// deferred to render-time so a role that got assigned but never
// acted still surfaces its arrival (block 2 Situation received),
// and the composer's own "any populated sub-section" check governs
// whether the chapter has body content beyond the nameplate.

export function roleWasInvolved(role, event) {
  if (!role?.id || !event) return false;
  const rid = role.id;

  if (Array.isArray(event.escalations)) {
    for (const r of event.escalations) {
      if (r.initiatedByRoleId === rid) return true;
      if (r.destinationId === rid) return true;
    }
  }
  if (Array.isArray(event.counterDispatches)) {
    for (const cd of event.counterDispatches) {
      if (cd.ownerRoleId === rid) return true;
    }
  }
  const cat = event.catalog;
  if (cat && typeof cat === 'object') {
    for (const key of Object.keys(cat)) {
      const arr = cat[key];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (entry?.authorRoleId === rid) return true;
      }
    }
  }
  return false;
}

// Iterates a RECEIVERS array and returns the subset that touched
// this event, sorted by first-touch timestamp so the master PIR
// reads chronologically. Used by Phase 4 master PIR composer.

export function contributorsForEvent(event, receivers) {
  if (!event || !Array.isArray(receivers)) return [];
  const out = [];
  for (const role of receivers) {
    if (!roleWasInvolved(role, event)) continue;
    out.push({ role, firstTouchAt: _firstTouchTimestamp(role, event) });
  }
  out.sort((a, b) => {
    const at = a.firstTouchAt || '';
    const bt = b.firstTouchAt || '';
    if (at && bt) return at.localeCompare(bt);
    if (at) return -1;
    if (bt) return 1;
    return a.role.id.localeCompare(b.role.id);
  });
  return out.map(x => x.role);
}

function _firstTouchTimestamp(role, event) {
  const rid = role.id;
  let earliest = null;
  const consider = (ts) => {
    if (!ts) return;
    if (earliest == null || ts.localeCompare(earliest) < 0) earliest = ts;
  };

  if (Array.isArray(event.escalations)) {
    for (const r of event.escalations) {
      if (r.initiatedByRoleId === rid) consider(r.initiatedAt);
      if (r.destinationId === rid) consider(r.initiatedAt);
    }
  }
  if (Array.isArray(event.counterDispatches)) {
    for (const cd of event.counterDispatches) {
      if (cd.ownerRoleId === rid) consider(cd.dispatchedAt || cd.createdAt);
    }
  }
  const cat = event.catalog;
  if (cat && typeof cat === 'object') {
    for (const key of Object.keys(cat)) {
      const arr = cat[key];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (entry?.authorRoleId === rid) consider(entry.createdAt || entry.timestamp);
      }
    }
  }
  return earliest;
}

// ── Block 1 · Contributor nameplate ─────────────────────────────
// Role name, tier, branch, primary archetype badge, secondary
// archetype badges. Rendered as the chapter header row.

function _blockIdentifier(role) {
  const name = esc(role.name || role.id);
  const tier = esc(role.tier || '');
  const branch = esc(role.branch || role.parent || '');
  const primaryLabel = ARCHETYPE_LABELS[role.archetype] || esc(role.archetype || '');
  const secondaries = Array.isArray(role.secondaryArchetypes) ? role.secondaryArchetypes : [];

  const secondaryBadges = secondaries.map(a => `
    <span class="chapter-arch-badge chapter-arch-badge-secondary chapter-arch-badge-${esc(a)}">${esc(ARCHETYPE_LABELS[a] || a)}</span>
  `).join('');

  return `
    <header class="chapter-identifier">
      <div class="chapter-identifier-row">
        <div class="chapter-identifier-name">${name}</div>
        ${tier ? `<div class="chapter-identifier-tier">${tier.toUpperCase()}</div>` : ''}
      </div>
      ${branch ? `<div class="chapter-identifier-branch">${branch}</div>` : ''}
      <div class="chapter-identifier-badges">
        <span class="chapter-arch-badge chapter-arch-badge-primary chapter-arch-badge-${esc(role.archetype || '')}">${esc(primaryLabel)}</span>
        ${secondaryBadges}
      </div>
    </header>`;
}

// ── Block 2 · Situation received ────────────────────────────────
// How this contributor became involved. Escalation-in (from whom,
// at what timestamp, under what cascade parent) OR self-initiated
// (this role initiated the first escalation of the event) OR
// dispatch-only (fired an asset without receiving an escalation,
// e.g. operator responding on their own site).

function _blockSituationReceived(role, event) {
  const rid = role.id;
  const inbound = (event.escalations || []).filter(r => r.destinationId === rid);
  const outbound = (event.escalations || []).filter(r => r.initiatedByRoleId === rid);
  const dispatchesFired = (event.counterDispatches || []).filter(cd => cd.ownerRoleId === rid);

  const lines = [];

  if (inbound.length) {
    // Cite first inbound as the arrival event; list any additional
    // inbound escalations that stacked on the same case.
    const first = inbound.slice().sort((a, b) => (a.initiatedAt || '').localeCompare(b.initiatedAt || ''))[0];
    const from = esc(first.initiatedBy || first.initiatedByRoleId || 'unknown sender');
    const ts = _fmtTime(first.initiatedAt);
    lines.push(`
      <li class="chapter-situation-line">
        <span class="chapter-situation-ts">${ts}</span>
        <span>Cascade received from <b>${from}</b>${first.assessmentPackage?.priority ? ` at <b>${esc(first.assessmentPackage.priority)}</b> priority` : ''}.</span>
      </li>`);
    if (inbound.length > 1) {
      lines.push(`
        <li class="chapter-situation-line chapter-situation-line-secondary">
          <span class="chapter-situation-ts"></span>
          <span>${inbound.length - 1} follow-up cascade${inbound.length - 1 === 1 ? '' : 's'} stacked on the same case.</span>
        </li>`);
    }
  }

  if (outbound.length) {
    const first = outbound.slice().sort((a, b) => (a.initiatedAt || '').localeCompare(b.initiatedAt || ''))[0];
    const to = esc(first.destinationId || 'unknown destination');
    const ts = _fmtTime(first.initiatedAt);
    lines.push(`
      <li class="chapter-situation-line">
        <span class="chapter-situation-ts">${ts}</span>
        <span>Initiated cascade to <b>${to}</b>${outbound.length > 1 ? ` (plus ${outbound.length - 1} more recipient${outbound.length - 1 === 1 ? '' : 's'})` : ''}.</span>
      </li>`);
  }

  if (!inbound.length && !outbound.length && dispatchesFired.length) {
    // Self-directed involvement — role acted on the case without a
    // cascade in or out (typical for an operator responding on their
    // own site).
    const first = dispatchesFired.slice().sort((a, b) => (a.dispatchedAt || '').localeCompare(b.dispatchedAt || ''))[0];
    const ts = _fmtTime(first.dispatchedAt);
    lines.push(`
      <li class="chapter-situation-line">
        <span class="chapter-situation-ts">${ts}</span>
        <span>Acted on the case directly without a cascade in or out (self-initiated).</span>
      </li>`);
  }

  if (!lines.length) {
    lines.push(`
      <li class="chapter-situation-line chapter-situation-line-empty">
        <span class="chapter-situation-ts"></span>
        <span>Role touched the case but no cascade or dispatch record was written.</span>
      </li>`);
  }

  return `
    <section class="chapter-block chapter-block-situation">
      <div class="chapter-block-hdr">Situation received</div>
      <ul class="chapter-situation-list">
        ${lines.join('')}
      </ul>
    </section>`;
}

// ── Block 3 · Involvement summary ───────────────────────────────
// Compact stats: how many actions across which archetypes, plus
// terminal state of this role's contribution (all responses in? any
// dispatches still open? catalog authored?). Numeric snapshot the
// reader scans before drilling into sub-sections.

function _blockInvolvementSummary(role, event) {
  const rid = role.id;

  const dispatchesOwned = (event.counterDispatches || []).filter(cd => cd.ownerRoleId === rid);
  const dispatchesOpen = dispatchesOwned.filter(cd => cd.state && cd.state !== 'complete' && cd.state !== 'rtb-complete');
  const escInitiated = (event.escalations || []).filter(r => r.initiatedByRoleId === rid);
  const escReceived = (event.escalations || []).filter(r => r.destinationId === rid);
  const escResponded = escReceived.filter(r => r.response || (Array.isArray(r.responses) && r.responses.length));

  let catalogAuthored = 0;
  const cat = event.catalog;
  if (cat && typeof cat === 'object') {
    for (const key of Object.keys(cat)) {
      const arr = cat[key];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (entry?.authorRoleId === rid) catalogAuthored++;
      }
    }
  }

  const populated = subsectionsForContributor(role, event);
  const populatedLabels = populated.map(a => ARCHETYPE_LABELS[a] || a);

  const stats = [
    { label: 'Cascades in',      value: escReceived.length },
    { label: 'Cascades out',     value: escInitiated.length },
    { label: 'Responses sent',   value: escResponded.length },
    { label: 'Dispatches owned', value: dispatchesOwned.length },
    { label: 'Dispatches open',  value: dispatchesOpen.length },
    { label: 'Catalog entries',  value: catalogAuthored },
  ];

  return `
    <section class="chapter-block chapter-block-involvement">
      <div class="chapter-block-hdr">Involvement summary</div>
      <div class="chapter-involvement-grid">
        ${stats.map(s => `
          <div class="chapter-involvement-stat">
            <div class="chapter-involvement-stat-label">${esc(s.label)}</div>
            <div class="chapter-involvement-stat-value">${s.value}</div>
          </div>`).join('')}
      </div>
      <div class="chapter-involvement-archetypes">
        <span class="chapter-involvement-archetypes-hdr">Populated archetypes</span>
        ${populatedLabels.length
          ? populatedLabels.map(l => `<span class="chapter-involvement-arch-chip">${esc(l)}</span>`).join('')
          : `<span class="chapter-involvement-arch-empty">none — the role touched the case but did not populate any archetype sub-section</span>`
        }
      </div>
    </section>`;
}

// ── Block 4 · Timeline slice ────────────────────────────────────
// This contributor's chronological log filtered from the master
// event timeline. Only entries where THIS role is the actor or
// primary recipient. Same ISO timestamps as the master PIR so a
// reader can cross-reference.

function _blockTimelineSlice(role, event) {
  const rid = role.id;
  const rows = [];

  if (Array.isArray(event.escalations)) {
    for (const r of event.escalations) {
      if (r.initiatedByRoleId === rid && r.initiatedAt) {
        rows.push({
          ts: r.initiatedAt,
          kind: 'cascade-out',
          detail: `Initiated cascade to ${esc(r.destinationId || 'unknown')}`,
        });
      }
      if (r.destinationId === rid) {
        if (r.initiatedAt) rows.push({
          ts: r.initiatedAt,
          kind: 'cascade-in',
          detail: `Cascade received from ${esc(r.initiatedBy || r.initiatedByRoleId || 'unknown')}`,
        });
        if (Array.isArray(r.statusHistory)) {
          for (const h of r.statusHistory) {
            if (h?.timestamp && h.status && h.status !== 'sent') {
              rows.push({
                ts: h.timestamp,
                kind: `status-${h.status}`,
                detail: `Cascade status ${esc(h.status)}`,
              });
            }
          }
        }
        const responses = Array.isArray(r.responses) ? r.responses : (r.response ? [r.response] : []);
        for (const rp of responses) {
          if (rp?.receivedAt || rp?.respondedAt) {
            rows.push({
              ts: rp.receivedAt || rp.respondedAt,
              kind: 'reply-sent',
              detail: `Replied to ${esc(r.initiatedBy || r.initiatedByRoleId || 'sender')}`,
            });
          }
        }
      }
    }
  }

  if (Array.isArray(event.counterDispatches)) {
    for (const cd of event.counterDispatches) {
      if (cd.ownerRoleId !== rid) continue;
      const asset = esc(cd.assetName || cd.asset?.name || cd.kind || 'asset');
      if (cd.dispatchedAt)    rows.push({ ts: cd.dispatchedAt,   kind: 'dispatched',  detail: `Dispatched ${asset}` });
      if (cd.arrivedAt)       rows.push({ ts: cd.arrivedAt,      kind: 'arrived',     detail: `${asset} on scene` });
      if (cd.engagingAt)      rows.push({ ts: cd.engagingAt,     kind: 'engaging',    detail: `${asset} engaging` });
      if (cd.completedAt)     rows.push({ ts: cd.completedAt,    kind: 'complete',    detail: `${asset} action complete` });
      if (cd.rtbStartedAt)    rows.push({ ts: cd.rtbStartedAt,   kind: 'rtb-start',   detail: `${asset} returning to base` });
      if (cd.rtbCompletedAt)  rows.push({ ts: cd.rtbCompletedAt, kind: 'rtb-done',    detail: `${asset} returned to base` });
    }
  }

  const cat = event.catalog;
  if (cat && typeof cat === 'object') {
    for (const key of Object.keys(cat)) {
      const arr = cat[key];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (entry?.authorRoleId !== rid) continue;
        const ts = entry.createdAt || entry.timestamp;
        if (!ts) continue;
        rows.push({
          ts,
          kind: `catalog-${key}`,
          detail: `Authored catalog entry <span class="ksub-cat-id">${esc(entry.id || key.toUpperCase())}</span>`,
        });
      }
    }
  }

  rows.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));

  if (!rows.length) {
    return `
      <section class="chapter-block chapter-block-timeline">
        <div class="chapter-block-hdr">Timeline slice</div>
        <div class="chapter-block-empty">No timestamped actions recorded for this contributor.</div>
      </section>`;
  }

  return `
    <section class="chapter-block chapter-block-timeline">
      <div class="chapter-block-hdr">Timeline slice</div>
      <ol class="chapter-timeline">
        ${rows.map(r => `
          <li class="chapter-timeline-row chapter-timeline-row-${esc(r.kind)}">
            <span class="chapter-timeline-ts">${_fmtTime(r.ts)}</span>
            <span class="chapter-timeline-kind">${esc(r.kind)}</span>
            <span class="chapter-timeline-detail">${r.detail}</span>
          </li>`).join('')}
      </ol>
    </section>`;
}

// ── Public composer ────────────────────────────────────────────

// Compose the full chapter for a single contributor. Returns
// empty string when the role is not involved on this event so the
// Phase 4 master PIR composer can filter mechanically.

export function composeChapter(role, event) {
  if (!role || !event) return '';
  if (!roleWasInvolved(role, event)) return '';

  const identifier = _blockIdentifier(role);
  const situation = _blockSituationReceived(role, event);
  const involvement = _blockInvolvementSummary(role, event);
  const timeline = _blockTimelineSlice(role, event);
  const subsections = renderAllSubsections(role, event);

  return `
    <article class="chapter" data-chapter-role="${esc(role.id)}">
      ${identifier}
      <div class="chapter-canonical">
        ${situation}
        ${involvement}
        ${timeline}
      </div>
      ${subsections ? `<div class="chapter-subsections">${subsections}</div>` : ''}
    </article>`;
}

// Compose all chapters for an event, in chronological first-touch
// order. Feeds the Phase 4 master PIR upgrade. Not wired to any UI
// surface yet.

export function composeAllChapters(event, receivers) {
  const roles = contributorsForEvent(event, receivers);
  return roles.map(role => composeChapter(role, event)).filter(Boolean).join('');
}
