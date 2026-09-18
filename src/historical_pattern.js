// ═══════════════════════════════════════════════════════════════════
// Historical pattern — "prior activity at this site" intelligence
// ───────────────────────────────────────────────────────────────────
// First feature of the receiver-tier site intelligence layer (see
// docs/receiver-tier-features-roadmap.md §3.4). Answers one question
// on the case-file: has this platform family been detected at this
// site before, and how did those events end?
//
// Data source is the precedent index (src/precedent_index.js), which
// persists one record per closed event to IndexedDB and hydrates at
// boot. This module is a pure read-side consumer: no writes, no new
// persistence, no Cesium entities.
//
// Visibility: intel / forensic / coordination archetypes only.
// Operators never see this surface. Kinetic, medical, regulatory,
// public safety, liaison archetypes do not render it (roadmap §5
// access matrix).
//
// Detection-only stance: renders context about past observations.
// Nothing here recommends or triggers action.
//
// Honest-data note: the count covers events closed since the
// precedent store shipped, on this browser profile. Cross-device
// history arrives with the Azure backend swap behind
// precedent_store.js — this module needs no change for that.
// ═══════════════════════════════════════════════════════════════════

import { allRecords, extractFeatureFields } from './precedent_index.js';
import { ARCHETYPES, archetypeFor } from './archetypes.js';

// Archetypes allowed to see the panel. Primary OR secondary match
// qualifies (e.g. rigspoliti is COORD primary + INTEL secondary).
const _VISIBLE_ARCHETYPES = new Set([
  ARCHETYPES.INTEL,
  ARCHETYPES.FORENSIC,
  ARCHETYPES.COORD,
]);

export function canSeeHistoricalPattern(role) {
  if (!role?.id) return false;
  const spec = archetypeFor(role.id);
  if (!spec) return false;
  if (_VISIBLE_ARCHETYPES.has(spec.primary)) return true;
  return (spec.secondary || []).some(a => _VISIBLE_ARCHETYPES.has(a));
}

// Pure query: prior precedent records at the same site with the same
// platform family, excluding the event being viewed. Newest first.
export function getHistoricalPattern(event) {
  if (!event?.siteId) return { family: null, priors: [] };
  const family = extractFeatureFields(event).platform_family || 'unknown';
  const priors = allRecords()
    .filter(r =>
      r.eventId !== event.id
      && r.siteId === event.siteId
      && r.featureFields?.platform_family === family
    )
    .sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));
  return { family, priors };
}

// ── Rendering ─────────────────────────────────────────────────

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _familyDisplay(family) {
  if (!family || family === 'unknown') return 'unknown platform family';
  return family.replace(/[_-]/g, ' ');
}

function _fmtDate(iso) {
  return iso ? iso.slice(0, 10) : 'unknown date';
}

// renderHistoricalPatternPanel(event, activeRole, opts)
//   opts.hasReportFor(eventId) -> bool — caller supplies the lookup so
//   this module stays free of main.js / events.js imports. A prior
//   event from an earlier session has no in-memory report; the row
//   then renders without a link rather than a dead one.
export function renderHistoricalPatternPanel(event, activeRole, opts = {}) {
  if (!canSeeHistoricalPattern(activeRole)) return '';
  const { family, priors } = getHistoricalPattern(event);
  const familyLabel = _familyDisplay(family);

  let bodyHtml;
  if (!priors.length) {
    bodyHtml = `
      <div class="hist-pattern-empty">First recorded detection of this platform family (${_esc(familyLabel)}) at this site.</div>`;
  } else {
    // Split the count by final classification so friendly inspection
    // flights never read as hostile history. Order: hostile first
    // (the count the reader scans for), then friendly, then dismissed
    // false positives, then genuinely unresolved. NOTE 'resolved' in
    // this codebase means "dismissed as false positive" (see the
    // reclassify dropdown), the most settled state an event can have.
    // It must never be counted as "unresolved".
    const byClass = { hostile: 0, friendly: 0, dismissed: 0, other: 0 };
    for (const r of priors) {
      if (r.classification === 'hostile') byClass.hostile++;
      else if (r.classification === 'friendly') byClass.friendly++;
      else if (r.classification === 'resolved') byClass.dismissed++;
      else byClass.other++;
    }
    const splitParts = [];
    if (byClass.hostile) splitParts.push(`${byClass.hostile} hostile`);
    if (byClass.friendly) splitParts.push(`${byClass.friendly} friendly`);
    if (byClass.dismissed) splitParts.push(`${byClass.dismissed} dismissed false positive${byClass.dismissed === 1 ? '' : 's'}`);
    if (byClass.other) splitParts.push(`${byClass.other} unresolved`);
    // Always show the split when priors exist — an all-friendly or
    // all-hostile history is exactly the signal the reader needs in
    // the lead sentence, not just in the row badges.
    const splitStr = splitParts.length ? ` (${splitParts.join(', ')})` : '';

    const rows = priors.map(r => {
      const linkable = typeof opts.hasReportFor === 'function' && opts.hasReportFor(r.eventId);
      const cls = r.classification || 'unclassified';
      const clsLabel = cls === 'resolved' ? 'dismissed' : cls;
      // The summary's first segment is the platform model: it becomes
      // the card title. The remainder is one dim truncated line; the
      // popup carries the full detail. Outcome only renders when it
      // says something ("unrecorded" is noise at list level).
      const parts = String(r.summary || '').split(/,(.+)/s);
      const title = (parts[0] || r.featureFields?.platform_family || 'Detection').trim();
      const rest = (parts[1] || '').trim().replace(/^\s*/, '');
      return `
        <div class="hist-pattern-row hist-pattern-clickable" data-hist-view="${_esc(r.eventId)}" title="Open incident overview">
          <div class="hist-pattern-row-main">
            <span class="hist-pattern-title">${_esc(title)}</span>
            <span class="hist-pattern-class hist-pattern-class-${_esc(cls)}">${_esc(clsLabel)}</span>
            <span class="hist-pattern-open">›</span>
          </div>
          <div class="hist-pattern-sub">
            <span class="hist-pattern-date">${_esc(_fmtDate(r.closedAt))}</span>
            ${r.outcome ? `<span class="hist-pattern-outcome">${_esc(r.outcome)}</span>` : ''}
            ${rest ? `<span class="hist-pattern-summary">${_esc(rest)}</span>` : ''}
          </div>
          ${linkable ? `<button class="hist-pattern-link" data-rcv="open-report" data-id="${_esc(r.eventId)}">View report</button>` : ''}
        </div>`;
    }).join('');
    bodyHtml = `
      <div class="hist-pattern-lead">This platform family (${_esc(familyLabel)}) has been detected at this site ${priors.length} time${priors.length === 1 ? '' : 's'} before${splitStr}.</div>
      ${rows}`;
  }

  return `
    <div class="c-panel c-panel-collapsible hist-pattern-panel">
      <div class="c-panel-title" style="margin-bottom: var(--space-2);">Prior activity at this site</div>
      <div class="c-panel-body">
        ${bodyHtml}
      </div>
    </div>`;
}
