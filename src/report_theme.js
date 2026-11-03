// ═══════════════════════════════════════════════════════════════════
// The downloadable incident report wears the platform's own look
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-03: "Our post incident report that can be downloaded is
// ugly as fuck. Completely white, not branded in our UI." It was a white
// print page with its own hex colours, Courier New and no logo.
//
// The report opens in a window of its own, which does not load
// style.css. So the colours, fonts and sizes are READ from the platform
// at the moment the report is made (the :root custom properties in
// style.css) and written into the report's own :root. style.css stays
// the one source: change a token there and the report follows.
//
// Dark on screen and in the saved PDF: print-color-adjust keeps the
// ground and panels when Chrome saves as PDF, and the page margin is
// zero so the dark runs to the edge of the sheet.
//
// The logo is the real isr-logo.png in the platform's 48 px bar, never a
// typed brand name.
// ═══════════════════════════════════════════════════════════════════

// Every token the report's CSS reads. Fallbacks are style.css's values
// on 2026-11-03, used only if a token cannot be read (a test, say).
export const REPORT_TOKENS = Object.freeze({
  '--surface-bg': '#06080b',
  '--surface-panel': '#0a0d10',
  '--surface-elevated': '#0e131a',
  '--surface-raise': 'rgba(255, 255, 255, 0.022)',
  '--surface-recess': 'rgba(0, 0, 0, 0.22)',
  '--text': '#e6ecf0',
  '--text-dim': '#86909e',
  '--text-mute': '#5a6371',
  '--border': 'rgba(180, 200, 220, 0.10)',
  '--border-strong': 'rgba(180, 200, 220, 0.18)',
  '--accent': '#4dd2ff',
  '--accent-soft': 'rgba(77, 210, 255, 0.10)',
  '--sec-accent': '#c0817c',
  '--ok': '#4dff9c',
  '--warn': '#ffb84d',
  '--danger': '#ff5a5a',
  '--font-body': '-apple-system, "SF Pro Display", "Segoe UI", "IBM Plex Sans", Roboto, system-ui, sans-serif',
  '--font-mono': 'ui-monospace, "SF Mono", "IBM Plex Mono", "Cascadia Mono", Menlo, Consolas, monospace',
  '--fs-2xs': '9px',
  '--fs-xs': '10px',
  '--fs-sm': '11px',
  '--fs-base': '12px',
  '--fs-md': '13px',
  '--fs-lg': '15px',
  '--fs-xl': '18px',
  '--fs-2xl': '22px',
  '--ls-label': '0.14em',
  '--ls-label-loose': '0.20em',
});

/** The platform's live values for the report tokens, as a :root block. */
export function reportRootCss(doc = (typeof document !== 'undefined' ? document : null)) {
  let cs = null;
  try { cs = doc ? getComputedStyle(doc.documentElement) : null; } catch (_) { cs = null; }
  const lines = Object.entries(REPORT_TOKENS).map(([k, fallback]) => {
    const v = cs ? cs.getPropertyValue(k).trim() : '';
    return `  ${k}: ${v || fallback};`;
  });
  return `:root {\n${lines.join('\n')}\n}`;
}

/** Severity colour for a classification or threat word, from the tokens. */
export function severityToken(word) {
  const w = String(word || '').toLowerCase();
  if (w === 'hostile' || w === 'high' || w === 'critical') return 'var(--danger)';
  if (w === 'friendly' || w === 'low') return 'var(--ok)';
  if (w === 'medium' || w === 'unknown' || w === 'unclassified' || w === 'unassessed') return 'var(--warn)';
  return 'var(--accent)';
}

/** The report's stylesheet, platform tokens first. */
export function reportCss(doc) {
  return `${reportRootCss(doc)}
  * { box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  html, body { background: var(--surface-bg); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: var(--text); font-family: var(--font-body); font-size: var(--fs-base); line-height: 1.55; }
  .rp-bar { height: 48px; display: flex; align-items: center; gap: 18px; padding: 0 28px; background: var(--surface-panel); border-bottom: 1px solid var(--border); }
  .rp-bar .brand { display: flex; align-items: center; height: 100%; padding-right: 18px; border-right: 1px solid var(--border); }
  .rp-bar .brand img { height: 30px; width: auto; display: block; }
  .rp-bar .eyebrow { font-family: var(--font-mono); font-size: var(--fs-xs); letter-spacing: var(--ls-label-loose); text-transform: uppercase; color: var(--text-dim); }
  .rp-bar .spacer { flex: 1; }
  .rp-bar .gen { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-mute); letter-spacing: var(--ls-label); }
  .rp-page { padding: 26px 28px 30px; }
  .rp-title { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
  .rp-title .id { font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--text-dim); letter-spacing: var(--ls-label); }
  .rp-title h1 { margin: 4px 0 0; font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -0.005em; color: var(--text); }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .chip { font-family: var(--font-mono); font-size: var(--fs-2xs); letter-spacing: var(--ls-label-loose); text-transform: uppercase; padding: 4px 10px; border-radius: 999px; border: 1px solid currentColor; background: rgba(255, 255, 255, 0.03); white-space: nowrap; }
  .panel { background: var(--surface-panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px 12px; margin: 0 0 14px; break-inside: avoid; }
  h2 { margin: 0 0 10px; font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: 600; letter-spacing: var(--ls-label-loose); text-transform: uppercase; color: var(--text-dim); display: flex; align-items: center; gap: 8px; break-after: avoid; }
  h2::before { content: ''; width: 3px; height: 11px; border-radius: 2px; background: var(--sec-accent); display: inline-block; }
  .exec { font-size: var(--fs-md); line-height: 1.7; color: var(--text); }
  .exec .reco { margin-top: 10px; padding-left: 10px; border-left: 2px solid var(--accent); color: var(--text); font-weight: 500; }
  .exec .prov { margin-top: 8px; font-family: var(--font-mono); font-size: var(--fs-2xs); color: var(--text-mute); letter-spacing: 0.10em; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 28px; }
  .kv { display: flex; justify-content: space-between; gap: 14px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: var(--fs-base); }
  .kv .k { font-family: var(--font-mono); font-size: var(--fs-2xs); letter-spacing: var(--ls-label); text-transform: uppercase; color: var(--text-dim); padding-top: 2px; white-space: nowrap; }
  .kv .v { text-align: right; color: var(--text); }
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-family: var(--font-mono); font-size: var(--fs-2xs); font-weight: 600; letter-spacing: var(--ls-label); text-transform: uppercase; color: var(--text-dim); background: var(--surface-raise); }
  tr { break-inside: avoid; }
  tbody tr:nth-child(even) td { background: rgba(255, 255, 255, 0.012); }
  td.num, th.num { text-align: right; font-family: var(--font-mono); }
  td.mono { font-family: var(--font-mono); }
  td.empty { text-align: center; color: var(--text-mute); padding: 12px 8px; }
  .note { margin-top: 6px; font-family: var(--font-mono); font-size: var(--fs-2xs); color: var(--text-mute); letter-spacing: 0.10em; }
  .footer { margin-top: 22px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; font-family: var(--font-mono); font-size: var(--fs-2xs); color: var(--text-mute); letter-spacing: var(--ls-label); text-transform: uppercase; }
  .footer img { height: 16px; width: auto; opacity: 0.7; }
  `;
}

/**
 * The real isr-logo.png as a data URL, taken from the logo the platform's
 * own top bar already loaded. The report window is written into a blank
 * page, where the image did not load in time for printing, so the saved
 * PDF had an empty frame where the logo belongs. Embedded, it cannot go
 * missing. Falls back to the file's address if the bar's logo is not
 * there (a test, or the image not loaded yet).
 */
export function reportLogoUrl(doc = (typeof document !== 'undefined' ? document : null)) {
  const fallback = (typeof window !== 'undefined' && window.location) ? `${window.location.origin}/isr-logo.png` : '/isr-logo.png';
  try {
    const img = doc?.querySelector('#top-bar .brand-logo, .brand-logo');
    if (!img || !img.complete || !img.naturalWidth) return fallback;
    const c = doc.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  } catch (_) {
    return fallback;
  }
}

/** The platform's 48 px bar with the real logo, as the report's header. */
export function reportBar({ logoUrl, eyebrow, generated }) {
  return `<div class="rp-bar">
    <div class="brand"><img src="${logoUrl}" alt="ISR Systems"></div>
    <div class="eyebrow">${eyebrow}</div>
    <div class="spacer"></div>
    <div class="gen">${generated}</div>
  </div>`;
}
