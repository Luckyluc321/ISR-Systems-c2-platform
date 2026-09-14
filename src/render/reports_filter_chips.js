// ═══════════════════════════════════════════════════════════════════
// Reports filter chips — receiver Reports tab filter strip.
// Third render surface extracted from main.js as part of Phase 2.
// ───────────────────────────────────────────────────────────────────
// Renders a strip of filter <select> chips (Site / Kommune / Politikreds
// / Region / Class / Domain / Time) on top of the Reports pool. Each
// chip appears only when the pool has 2+ distinct values on that
// dimension — a filter for a dimension with one value is noise.
//
// Pure function: (pool[], currentFilterState) => HTMLString. Click
// handling stays in main.js's Reports render pipeline (needs access
// to _reportsFilter state + re-render trigger).
//
// The default filter state is also exported here so main.js has a
// single source of truth for what "no filter applied" looks like.
// ═══════════════════════════════════════════════════════════════════

import { SITES } from '../sites_registry.js';

export const REPORTS_FILTER_DEFAULTS = {
  site: 'all',
  kommune: 'all',
  politikreds: 'all',
  region: 'all',
  classification: 'all',
  domain: 'all',
  timeRange: 'all',
};

export function renderReportsFilterChips(pool, current) {
  if (!pool?.length) return '';
  const uniqueSorted = (arr) => [...new Set(arr.filter(Boolean))].sort();
  const sites = uniqueSorted(pool.map(e => e.siteId));
  const kommuner = uniqueSorted(pool.map(e => e.geoContext?.kommune));
  const politikredse = uniqueSorted(pool.map(e => e.geoContext?.politikreds));
  const regioner = uniqueSorted(pool.map(e => e.geoContext?.region));
  const classifications = uniqueSorted(pool.map(e => e.classification));
  const domains = uniqueSorted(pool.flatMap(e => Array.isArray(e.domainScope) ? e.domainScope : []));

  const chip = (label, key, options, valueLabelFn = (v) => v) => {
    if (options.length < 2) return '';   // dimension has no variation — omit chip
    const opts = ['<option value="all">All ' + label + '</option>']
      .concat(options.map(v => `<option value="${v}"${current[key] === v ? ' selected' : ''}>${valueLabelFn(v)}</option>`));
    const dirty = current[key] !== 'all';
    return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-2xs);color:${dirty ? '#ffb84d' : 'var(--text-dim)'};font-family:var(--font-mono);letter-spacing:0.08em;text-transform:uppercase;">
        ${label}
        <select data-rcv="reports-filter-change" data-filter-key="${key}" style="background:${dirty ? 'rgba(255,184,77,0.10)' : 'rgba(255,255,255,0.03)'};border:1px solid ${dirty ? 'rgba(255,184,77,0.4)' : 'rgba(255,255,255,0.08)'};color:var(--text);padding:3px 8px;border-radius:2px;font-family:var(--font-body);font-size:var(--fs-xs);cursor:pointer;">
          ${opts.join('')}
        </select>
      </label>`;
  };

  const timeChip = (() => {
    const opts = [
      { v: 'all',  l: 'Any time' },
      { v: '7d',   l: 'Last 7 days' },
      { v: '30d',  l: 'Last 30 days' },
      { v: '90d',  l: 'Last 90 days' },
    ];
    const dirty = current.timeRange !== 'all';
    return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-2xs);color:${dirty ? '#ffb84d' : 'var(--text-dim)'};font-family:var(--font-mono);letter-spacing:0.08em;text-transform:uppercase;">
        Time
        <select data-rcv="reports-filter-change" data-filter-key="timeRange" style="background:${dirty ? 'rgba(255,184,77,0.10)' : 'rgba(255,255,255,0.03)'};border:1px solid ${dirty ? 'rgba(255,184,77,0.4)' : 'rgba(255,255,255,0.08)'};color:var(--text);padding:3px 8px;border-radius:2px;font-family:var(--font-body);font-size:var(--fs-xs);cursor:pointer;">
          ${opts.map(o => `<option value="${o.v}"${current.timeRange === o.v ? ' selected' : ''}>${o.l}</option>`).join('')}
        </select>
      </label>`;
  })();

  const anyDirty = Object.keys(current).some(k => current[k] !== REPORTS_FILTER_DEFAULTS[k]);
  const clearBtn = anyDirty
    ? `<button data-rcv="reports-filter-clear" style="background:transparent;border:1px solid rgba(255,184,77,0.4);color:#ffb84d;padding:3px 10px;border-radius:2px;cursor:pointer;font-family:var(--font-mono);font-size:var(--fs-2xs);letter-spacing:0.12em;text-transform:uppercase;">Clear</button>`
    : '';

  const chips = [
    chip('Site', 'site', sites, (v) => SITES[v]?.name || v),
    chip('Kommune', 'kommune', kommuner),
    chip('Politikreds', 'politikreds', politikredse),
    chip('Region', 'region', regioner),
    chip('Class', 'classification', classifications, (v) => v.charAt(0).toUpperCase() + v.slice(1)),
    chip('Domain', 'domain', domains, (v) => v.charAt(0).toUpperCase() + v.slice(1)),
    timeChip,
  ].filter(Boolean);

  if (!chips.length) return '';
  return `<div class="rcv-reports-filters" style="display:flex;flex-wrap:wrap;gap:8px;padding:var(--space-2) var(--space-3);align-items:center;border-bottom:1px solid var(--border);">${chips.join('')}${clearBtn}</div>`;
}
