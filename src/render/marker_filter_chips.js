// ═══════════════════════════════════════════════════════════════════
// Marker filter chips — per-event visibility toggles rendered in the
// detail panel + Palantir closed panel. First render surface extracted
// from main.js as part of the Phase 2 rendering carve-out.
// ───────────────────────────────────────────────────────────────────
// Two variants:
//   renderMarkerFilterChips(event)       — full section (used in the
//                                          debrief modal / detail panel)
//   renderMarkerFilterChipsBody(event)   — body-only (used inside a
//                                          Palantir-style collapsible
//                                          section that provides its
//                                          own wrapper)
// Plus:
//   defaultMarkerFilters()               — factory for the default
//                                          per-event filter state
//                                          ({kills, entryExit, oorReacq,
//                                           detected, showIcons, showLabels}
//                                          all true)
//
// State lives on `event._markerFilters` (stamped lazily on first render).
// The mutator seam owns the stamp so the Phase 1 policy holds.
// Click handling stays in main.js (it needs access to _eventChain +
// _refreshEventMarkerVisibility + selection state). This module is
// pure HTML string generation — no listeners, no side effects except
// the lazy _markerFilters stamp via mutateEvent.
// ═══════════════════════════════════════════════════════════════════

import { mutateEvent } from '../events.js';

export function defaultMarkerFilters() {
  return { kills: true, entryExit: true, oorReacq: true, detected: true, showIcons: true, showLabels: true };
}

const _chipStyle = (on, color) =>
  `padding: 4px 10px; border-radius: 12px; font-family: var(--font-mono); font-size: var(--fs-2xs); letter-spacing: 0.10em; text-transform: uppercase; cursor: pointer; user-select: none; ${on
    ? `background: rgba(${color}, 0.14); border: 1px solid rgba(${color}, 0.55); color: rgb(${color});`
    : 'background: transparent; border: 1px solid #1e2530; color: var(--text-dim);'}`;

const _chip = (label, key, color, eventId, f) =>
  `<span class="dp-mflt-chip" data-mflt="${key}" data-id="${eventId}" style="${_chipStyle(f[key], color)}">${label}</span>`;

const _chipMaster = (label, active, eventId) =>
  `<span class="dp-mflt-chip" data-mflt="all" data-id="${eventId}" style="${_chipStyle(active, '160, 200, 220')}">${label}</span>`;

export function renderMarkerFilterChips(event) {
  if (!event) return '';
  if (!event._markerFilters) mutateEvent(event.id, { _markerFilters: defaultMarkerFilters() });
  const f = event._markerFilters;
  const allOn = f.kills && f.entryExit && f.oorReacq && f.detected;
  return `
      <div class="dp-section dp-mflt" style="padding: var(--space-2) var(--space-3); border-bottom: 1px solid #131820;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
          <span style="font-size: var(--fs-2xs); color: var(--text-dim); font-family: var(--font-mono); letter-spacing: 0.10em; text-transform: uppercase; margin-right: 4px;">Subevents:</span>
          ${_chipMaster(allOn ? 'All ✓' : 'All', allOn, event.id)}
          ${_chip(`Kills ${f.kills ? '✓' : ''}`,           'kills',     '255, 90, 90',   event.id, f)}
          ${_chip(`Entry/Exit ${f.entryExit ? '✓' : ''}`,   'entryExit', '77, 210, 255',  event.id, f)}
          ${_chip(`Reacquired ${f.oorReacq ? '✓' : ''}`,    'oorReacq',  '77, 255, 156',  event.id, f)}
          ${_chip(`Detected ${f.detected ? '✓' : ''}`,      'detected',  '77, 210, 255',  event.id, f)}
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: var(--fs-2xs); color: var(--text-dim); font-family: var(--font-mono); letter-spacing: 0.10em; text-transform: uppercase; margin-right: 4px;">Display:</span>
          ${_chip(`Icons ${f.showIcons ? '✓' : ''}`,       'showIcons', '160, 200, 220', event.id, f)}
          ${_chip(`Labels ${f.showLabels ? '✓' : ''}`,     'showLabels','160, 200, 220', event.id, f)}
        </div>
      </div>`;
}

export function renderMarkerFilterChipsBody(event) {
  if (!event) return '';
  if (!event._markerFilters) mutateEvent(event.id, { _markerFilters: defaultMarkerFilters() });
  const f = event._markerFilters;
  const allOn = f.kills && f.entryExit && f.oorReacq && f.detected;
  return `
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
        <span style="font-size: var(--fs-2xs); color: var(--text-dim); font-family: var(--font-mono); letter-spacing: 0.10em; text-transform: uppercase; margin-right: 4px;">Categories:</span>
        ${_chipMaster(allOn ? 'All ✓' : 'All', allOn, event.id)}
        ${_chip(`Kills ${f.kills ? '✓' : ''}`,           'kills',     '255, 90, 90',   event.id, f)}
        ${_chip(`Entry/Exit ${f.entryExit ? '✓' : ''}`,   'entryExit', '77, 210, 255',  event.id, f)}
        ${_chip(`Reacquired ${f.oorReacq ? '✓' : ''}`,    'oorReacq',  '77, 255, 156',  event.id, f)}
        ${_chip(`Detected ${f.detected ? '✓' : ''}`,      'detected',  '77, 210, 255',  event.id, f)}
      </div>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <span style="font-size: var(--fs-2xs); color: var(--text-dim); font-family: var(--font-mono); letter-spacing: 0.10em; text-transform: uppercase; margin-right: 4px;">Display:</span>
        ${_chip(`Icons ${f.showIcons ? '✓' : ''}`,       'showIcons', '160, 200, 220', event.id, f)}
        ${_chip(`Labels ${f.showLabels ? '✓' : ''}`,     'showLabels','160, 200, 220', event.id, f)}
      </div>`;
}
