// ═══════════════════════════════════════════════════════════════════
// Report sub-section renderers — one per action archetype
// ───────────────────────────────────────────────────────────────────
// Phase 2 of the recipient chapter shapes design. Each function is
// pure: (role, event) → HTMLString. Returns empty string when the
// role has no data for that archetype so the chapter composer
// (Phase 3) can only include populated sub-sections.
//
// Every contributor chapter in the Post-Incident Report is composed
// of 0-8 archetype sub-sections. A role's chapter renders only the
// sub-sections that role actually populated on this event.
//
// Data sources:
// - event.counterDispatches  (filtered by ownerRoleId + archetype)
// - event.escalations        (filtered by initiatedByRoleId)
// - event.catalog.*          (filtered by authorRoleId per entry)
//
// Reads only. Never mutates event state. Writers (that push into
// catalog.attribution, catalog.publicAlerts, etc) land in later
// phases when concrete actions get wired to catalog appends.
//
// See docs/cross-agency-flows.md Section 7 and scratchpad
// recipient-report-shapes.html for the full contract.
// ═══════════════════════════════════════════════════════════════════

import { ARCHETYPES, ARCHETYPE_LABELS } from './archetypes.js';

// ── Formatting helpers ──────────────────────────────────────────

// Escape HTML entities in freeform strings so a rogue reply or
// operator note can never break the render. Every user-authored
// string passes through here before landing in innerHTML.
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

// Duration between two ISO timestamps, human-readable ("4m 12s").
// Returns empty string if either bound is missing so the render
// falls back to a dash instead of "NaN".
function _dur(fromIso, toIso) {
  if (!fromIso || !toIso) return '';
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (isNaN(from) || isNaN(to) || to < from) return '';
  const secs = Math.round((to - from) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

// Wrap a sub-section in the canonical outer shape. All 8 renderers
// use this so class names + header layout stay consistent.
function _wrap(archetype, summary, body) {
  const label = ARCHETYPE_LABELS[archetype] || archetype;
  return `
    <section class="chapter-subsec chapter-subsec-${archetype}">
      <div class="chapter-subsec-hdr">
        <span class="chapter-subsec-label">${esc(label)}</span>
        ${summary ? `<span class="chapter-subsec-summary">${esc(summary)}</span>` : ''}
      </div>
      <div class="chapter-subsec-body">
        ${body}
      </div>
    </section>`;
}

// ── Sub-section 1 · Kinetic response ────────────────────────────

export function renderKineticSubsection(role, event) {
  if (!role || !event) return '';
  const dispatches = (event.counterDispatches || []).filter(cd =>
    cd.ownerRoleId === role.id && cd.archetype === ARCHETYPES.KINETIC
  );
  if (!dispatches.length) return '';

  const rows = dispatches.map(cd => {
    const timing = [
      cd.dispatchedAt && `dispatched ${_fmtTime(cd.dispatchedAt)}`,
      cd.arrivedAt    && `arrived ${_fmtTime(cd.arrivedAt)}`,
      cd.engagingAt   && `engaging ${_fmtTime(cd.engagingAt)}`,
      cd.completedAt  && `complete ${_fmtTime(cd.completedAt)}`,
      cd.rtbCompletedAt && `RTB ${_fmtTime(cd.rtbCompletedAt)}`,
    ].filter(Boolean).join(' · ');
    const duration = _dur(cd.dispatchedAt, cd.completedAt || cd.rtbCompletedAt);
    return `
      <tr class="ksub-row">
        <td class="ksub-asset">${esc(cd.assetName || cd.kind || 'unknown')}</td>
        <td class="ksub-state" data-state="${esc(cd.state || '')}">${esc((cd.state || 'unknown').replace(/_/g, ' '))}</td>
        <td class="ksub-timing">${esc(timing || '—')}</td>
        <td class="ksub-duration">${esc(duration || '—')}</td>
      </tr>`;
  }).join('');

  const roeNotes = ((event.catalog?.roe || []))
    .filter(r => r.authorRoleId === role.id);
  const roeBlock = roeNotes.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Rules of engagement applied</div>
      <ul class="chapter-subsec-note-list">
        ${roeNotes.map(r => `<li><span class="ksub-cat-id">${esc(r.id)}</span> ${esc(r.body || '')}</li>`).join('')}
      </ul>
    </div>` : '';

  const summary = `${dispatches.length} dispatch${dispatches.length === 1 ? '' : 'es'}`;
  const body = `
    <table class="ksub-table">
      <thead><tr><th>Asset</th><th>State</th><th>Timing</th><th>Duration</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${roeBlock}`;
  return _wrap(ARCHETYPES.KINETIC, summary, body);
}

// ── Sub-section 2 · Coordination & command ──────────────────────

export function renderCoordinationSubsection(role, event) {
  if (!role || !event) return '';
  // Cascades this role sent (escalations they initiated with an
  // assessmentPackage — the marker for cross-agency cascade).
  const sentCascades = (event.escalations || []).filter(esc_ =>
    esc_.initiatedByRoleId === role.id && esc_.assessmentPackage
  );
  const decisions = (event.catalog?.coordDecisions || [])
    .filter(d => d.authorRoleId === role.id);
  if (!sentCascades.length && !decisions.length) return '';

  const cascadeBlock = sentCascades.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Cascades sent · ${sentCascades.length}</div>
      <ul class="chapter-subsec-note-list">
        ${sentCascades.map(e => {
          const status = e.status || 'sent';
          const ackTs = e.statusHistory?.find(h => h.status === 'acknowledged')?.timestamp;
          const ackText = ackTs ? ` · acknowledged ${_fmtTime(ackTs)}` : '';
          const reason = e.assessmentPackage?.cascadeReason || 'coordination';
          return `<li><b>${esc(e.destinationId)}</b> · ${esc(reason)}${esc(ackText)} · status <i>${esc(status)}</i></li>`;
        }).join('')}
      </ul>
    </div>` : '';

  const decisionBlock = decisions.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Coordination decisions logged · ${decisions.length}</div>
      <ul class="chapter-subsec-note-list">
        ${decisions.map(d => `<li><span class="ksub-cat-id">${esc(d.id)}</span> ${esc(d.body || '')} <span class="ksub-ts">${esc(_fmtTime(d.at))}</span></li>`).join('')}
      </ul>
    </div>` : '';

  const summary = [
    sentCascades.length ? `${sentCascades.length} cascade${sentCascades.length === 1 ? '' : 's'}` : '',
    decisions.length ? `${decisions.length} decision${decisions.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');

  return _wrap(ARCHETYPES.COORD, summary, cascadeBlock + decisionBlock);
}

// ── Sub-section 3 · Intelligence & attribution ──────────────────

export function renderIntelSubsection(role, event) {
  if (!role || !event) return '';
  const attributions = (event.catalog?.attribution || []).filter(a => a.authorRoleId === role.id);
  const patterns    = (event.catalog?.patterns    || []).filter(p => p.authorRoleId === role.id);
  const xlinks      = (event.catalog?.xlinks      || []).filter(x => x.authorRoleId === role.id);
  if (!attributions.length && !patterns.length && !xlinks.length) return '';

  const attrBlock = attributions.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Attribution findings · ${attributions.length}</div>
      <ul class="chapter-subsec-note-list">
        ${attributions.map(a => {
          const conf = a.confidence != null ? ` (confidence ${esc(String(a.confidence))})` : '';
          return `<li><span class="ksub-cat-id">${esc(a.id)}</span> ${esc(a.body || '')}${conf}</li>`;
        }).join('')}
      </ul>
    </div>` : '';

  const patternBlock = patterns.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Pattern additions · ${patterns.length}</div>
      <ul class="chapter-subsec-note-list">
        ${patterns.map(p => `<li><span class="ksub-cat-id">${esc(p.id)}</span> ${esc(p.body || '')}</li>`).join('')}
      </ul>
    </div>` : '';

  const xlinkBlock = xlinks.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Cross-linked events · ${xlinks.length}</div>
      <ul class="chapter-subsec-note-list">
        ${xlinks.map(x => {
          const targets = Array.isArray(x.targetEventIds) ? x.targetEventIds.join(', ') : (x.targetEventId || '');
          return `<li><span class="ksub-cat-id">${esc(x.id)}</span> → ${esc(targets)} · ${esc(x.reason || '')}</li>`;
        }).join('')}
      </ul>
    </div>` : '';

  const summary = [
    attributions.length && `${attributions.length} attribution${attributions.length === 1 ? '' : 's'}`,
    patterns.length && `${patterns.length} pattern${patterns.length === 1 ? '' : 's'}`,
    xlinks.length && `${xlinks.length} cross-link${xlinks.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');

  return _wrap(ARCHETYPES.INTEL, summary, attrBlock + patternBlock + xlinkBlock);
}

// ── Sub-section 4 · Forensic & cyber ────────────────────────────

export function renderForensicSubsection(role, event) {
  if (!role || !event) return '';
  const evidence = (event.catalog?.evidence || []).filter(e => e.authorRoleId === role.id);
  const forensicDispatches = (event.counterDispatches || []).filter(cd =>
    cd.ownerRoleId === role.id && cd.archetype === ARCHETYPES.FORENSIC
  );
  if (!evidence.length && !forensicDispatches.length) return '';

  const dispatchBlock = forensicDispatches.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Forensic teams deployed · ${forensicDispatches.length}</div>
      <ul class="chapter-subsec-note-list">
        ${forensicDispatches.map(cd => {
          const timing = [
            cd.dispatchedAt && `dispatched ${_fmtTime(cd.dispatchedAt)}`,
            cd.completedAt && `complete ${_fmtTime(cd.completedAt)}`,
          ].filter(Boolean).join(' · ');
          return `<li><b>${esc(cd.assetName || cd.kind)}</b> · ${esc(cd.state || '')} · ${esc(timing || '—')}</li>`;
        }).join('')}
      </ul>
    </div>` : '';

  const evidenceBlock = evidence.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Evidence chain of custody · ${evidence.length}</div>
      <ul class="chapter-subsec-note-list">
        ${evidence.map(e => {
          const custody = e.custodyChain?.length
            ? ` · custody: ${e.custodyChain.map(c => esc(c.holder || '')).join(' → ')}`
            : '';
          return `<li><span class="ksub-cat-id">${esc(e.id)}</span> ${esc(e.body || '')}${custody}</li>`;
        }).join('')}
      </ul>
    </div>` : '';

  const summary = [
    forensicDispatches.length && `${forensicDispatches.length} team${forensicDispatches.length === 1 ? '' : 's'}`,
    evidence.length && `${evidence.length} evidence record${evidence.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');

  return _wrap(ARCHETYPES.FORENSIC, summary, dispatchBlock + evidenceBlock);
}

// ── Sub-section 5 · Medical & consequence ───────────────────────

export function renderMedicalSubsection(role, event) {
  if (!role || !event) return '';
  const medicalDispatches = (event.counterDispatches || []).filter(cd =>
    cd.ownerRoleId === role.id && cd.archetype === ARCHETYPES.MEDICAL
  );
  const casualties = (event.catalog?.casualties || []).filter(c => c.authorRoleId === role.id);
  if (!medicalDispatches.length && !casualties.length) return '';

  const dispatchBlock = medicalDispatches.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Medical assets deployed · ${medicalDispatches.length}</div>
      <ul class="chapter-subsec-note-list">
        ${medicalDispatches.map(cd => `<li><b>${esc(cd.assetName || cd.kind)}</b> · ${esc(cd.state || '')} · dispatched ${esc(_fmtTime(cd.dispatchedAt))}</li>`).join('')}
      </ul>
    </div>` : '';

  const casualtyBlock = casualties.length ? `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Casualties · ${casualties.length}</div>
      <ul class="chapter-subsec-note-list">
        ${casualties.map(c => {
          const outcome = c.outcome ? ` · ${esc(c.outcome)}` : '';
          const severity = c.severity ? ` (${esc(c.severity)})` : '';
          return `<li><span class="ksub-cat-id">${esc(c.id)}</span> ${esc(c.body || '')}${severity}${outcome}</li>`;
        }).join('')}
      </ul>
    </div>` : '';

  const summary = [
    medicalDispatches.length && `${medicalDispatches.length} asset${medicalDispatches.length === 1 ? '' : 's'}`,
    casualties.length && `${casualties.length} casualt${casualties.length === 1 ? 'y' : 'ies'}`,
  ].filter(Boolean).join(' · ');

  return _wrap(ARCHETYPES.MEDICAL, summary, dispatchBlock + casualtyBlock);
}

// ── Sub-section 6 · Regulatory & advisory ───────────────────────

export function renderRegulatorySubsection(role, event) {
  if (!role || !event) return '';
  const advisories = (event.catalog?.advisories || []).filter(a => a.authorRoleId === role.id);
  if (!advisories.length) return '';

  const body = `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Advisories issued · ${advisories.length}</div>
      <ul class="chapter-subsec-note-list">
        ${advisories.map(a => {
          const kind = a.kind ? `<b>${esc(a.kind)}</b> · ` : '';
          const zone = a.zone ? ` · zone ${esc(a.zone)}` : '';
          const dur = a.durationHours ? ` · ${esc(String(a.durationHours))}h` : '';
          return `<li><span class="ksub-cat-id">${esc(a.id)}</span> ${kind}${esc(a.body || '')}${zone}${dur} · issued ${esc(_fmtTime(a.at))}</li>`;
        }).join('')}
      </ul>
    </div>`;

  return _wrap(ARCHETYPES.REGULATORY, `${advisories.length} advisor${advisories.length === 1 ? 'y' : 'ies'}`, body);
}

// ── Sub-section 7 · Public safety & communication ───────────────

export function renderPublicSafetySubsection(role, event) {
  if (!role || !event) return '';
  const alerts = (event.catalog?.publicAlerts || []).filter(a => a.authorRoleId === role.id);
  if (!alerts.length) return '';

  const body = `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">Public alerts broadcast · ${alerts.length}</div>
      <ul class="chapter-subsec-note-list">
        ${alerts.map(a => {
          const kind = a.kind ? `<b>${esc(a.kind)}</b> · ` : '';
          const reach = a.reachCount != null ? ` · reach ${esc(String(a.reachCount))}` : '';
          const zone = a.affectedZone ? ` · zone ${esc(a.affectedZone)}` : '';
          const cancelled = a.cancelledAt ? ` · cancelled ${esc(_fmtTime(a.cancelledAt))}` : '';
          return `<li><span class="ksub-cat-id">${esc(a.id)}</span> ${kind}${esc(a.body || '')}${zone}${reach}${cancelled} · issued ${esc(_fmtTime(a.at))}</li>`;
        }).join('')}
      </ul>
    </div>`;

  return _wrap(ARCHETYPES.PUBLIC, `${alerts.length} alert${alerts.length === 1 ? '' : 's'}`, body);
}

// ── Sub-section 8 · International liaison ───────────────────────

export function renderLiaisonSubsection(role, event) {
  if (!role || !event) return '';
  const liaison = (event.catalog?.liaison || []).filter(l => l.authorRoleId === role.id);
  if (!liaison.length) return '';

  const body = `
    <div class="chapter-subsec-note">
      <div class="chapter-subsec-note-hdr">International information shared · ${liaison.length}</div>
      <ul class="chapter-subsec-note-list">
        ${liaison.map(l => {
          const cls = l.classification ? ` · classification <b>${esc(l.classification)}</b>` : '';
          const to = l.receivingAgency ? ` · to ${esc(l.receivingAgency)}` : '';
          return `<li><span class="ksub-cat-id">${esc(l.id)}</span> ${esc(l.body || '')}${cls}${to} · shared ${esc(_fmtTime(l.at))}</li>`;
        }).join('')}
      </ul>
    </div>`;

  return _wrap(ARCHETYPES.LIAISON, `${liaison.length} handoff${liaison.length === 1 ? '' : 's'}`, body);
}

// ── Dispatcher + helpers ────────────────────────────────────────

const _RENDERERS = {
  [ARCHETYPES.KINETIC]:    renderKineticSubsection,
  [ARCHETYPES.COORD]:      renderCoordinationSubsection,
  [ARCHETYPES.INTEL]:      renderIntelSubsection,
  [ARCHETYPES.FORENSIC]:   renderForensicSubsection,
  [ARCHETYPES.MEDICAL]:    renderMedicalSubsection,
  [ARCHETYPES.REGULATORY]: renderRegulatorySubsection,
  [ARCHETYPES.PUBLIC]:     renderPublicSafetySubsection,
  [ARCHETYPES.LIAISON]:    renderLiaisonSubsection,
};

// Render a single sub-section for a specific archetype. Returns empty
// string when the role has no data. Used by the chapter composer
// (Phase 3) as a lookup table over the 8 archetypes.
export function renderSubsection(archetype, role, event) {
  const fn = _RENDERERS[archetype];
  if (!fn) return '';
  try { return fn(role, event); }
  catch (err) {
    console.warn(`[chapter subsection] ${archetype} renderer failed:`, err);
    return '';
  }
}

// Which archetypes did this role actually populate on this event?
// Returns an array of archetype constants in canonical order
// (kinetic, coord, intel, forensic, medical, regulatory, public,
// liaison). Chapter composer iterates this and calls renderSubsection
// for each. Skips archetypes with no data — matches the "only
// render sub-sections the contributor populated" rule.
export function subsectionsForContributor(role, event) {
  if (!role || !event) return [];
  const populated = [];
  for (const archetype of Object.values(ARCHETYPES)) {
    const html = renderSubsection(archetype, role, event);
    if (html) populated.push(archetype);
  }
  return populated;
}

// Fully compose all sub-sections for a role on an event. Returns the
// concatenated HTML string of every populated sub-section, in
// canonical archetype order. Empty string when the role populated
// nothing (contributor produced no chapter content on this event).
export function renderAllSubsections(role, event) {
  if (!role || !event) return '';
  return Object.values(ARCHETYPES)
    .map(a => renderSubsection(a, role, event))
    .filter(Boolean)
    .join('');
}
