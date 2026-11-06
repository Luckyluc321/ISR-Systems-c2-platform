// ═══════════════════════════════════════════════════════════════════
// The downloadable incident report: the deepest view of one incident
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-03: the PDF "has a significant value where it dives
// deeper than the reports generated live". So it carries everything the
// live views carry and more, and it never contradicts them: main.js
// builds the data from the same helpers the detail panel and the
// receiver's case file use (incidentExecSummary, respondersOf, the
// agent-B analysis, the signal-tier library), and this module only draws
// it, in the platform's own look (report_theme.js).
//
// Pure: a data object in, an HTML document out. No platform globals, so
// check:incident-report draws a full report without a browser.
//
// Every value is escaped, and every em or en dash in any text that
// reaches it becomes a comma: the platform carries no em dashes, and
// model-written text and older account names still contain them.
// ═══════════════════════════════════════════════════════════════════

import { reportBar, reportCss, severityToken } from './report_theme.js';

export const NOT_RECORDED = 'Not recorded';

const _DASH = /\s*[—–]\s*/g;
/** Text for the page: no em or en dashes, HTML-escaped. */
export function reportText(v) {
  return String(v ?? '').replace(_DASH, ', ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const t = reportText;
const or = (v, fallback = NOT_RECORDED) => (v === null || v === undefined || v === '' ? fallback : v);
const hms = (iso) => (typeof iso === 'string' && iso.length >= 19 ? `${iso.slice(11, 19)}Z` : NOT_RECORDED);
const kv = (k, v) => `<div class="kv"><span class="k">${t(k)}</span><span class="v">${t(or(v))}</span></div>`;
const panel = (title, inner) => `<div class="panel"><h2>${t(title)}</h2>${inner}</div>`;
const table = (heads, rows, empty) => `<table><thead><tr>${heads.map((h) => `<th${h.num ? ' class="num"' : ''}>${t(h.label)}</th>`).join('')}</tr></thead><tbody>${
  rows.length ? rows.join('') : `<tr><td colspan="${heads.length}" class="empty">${t(empty)}</td></tr>`}</tbody></table>`;

/**
 * model: everything the report shows, prepared by main.js. Every field is
 * optional; a missing one reads "Not recorded" or drops its section.
 */
export function renderIncidentReport(model, { doc, logoUrl } = {}) {
  const m = model || {};
  const cls = String(m.classification || 'unclassified');
  const thr = String(m.threat || 'unassessed');

  const exec = `<div class="exec">${t(or(m.exec?.text, 'No summary recorded.'))}${
    m.exec?.reco ? `<div class="reco">${t(m.exec.reco)}</div>` : ''}${
    m.exec?.provenance ? `<div class="prov">${t(m.exec.provenance)}</div>` : ''}</div>`;

  const meta = `<div class="grid">
    ${kv('Event ID', m.id)}
    ${kv('Platform', m.platform)}
    ${kv('Type', m.type)}
    ${kv('Classification', cls.toUpperCase())}
    ${kv('Threat level', thr.toUpperCase())}
    ${kv('Confidence', m.confidence)}
    ${kv('First detected', m.firstDetected)}
    ${kv('Identified', m.identified)}
    ${kv('Closed', m.closed)}
    ${kv('Duration', m.duration)}
    ${kv('Status', m.status)}
    ${kv('Outcome', m.outcome)}
  </div>`;

  const a = m.analysis || {};
  const analysis = (a.pattern || (a.dwell || []).length || (a.flags || []).length) ? panel('Analysis', `
    <div class="exec">${t(or(a.pattern, 'Analysis unavailable for this event.'))}</div>
    <div class="grid" style="margin-top:10px;">
      ${kv('Analysis confidence', a.confidence)}
      ${kv('Dwell zones', (a.dwell || []).length)}
    </div>
    ${(a.dwell || []).length ? table([{ label: 'Dwell zone' }, { label: 'Share of track', num: true }],
      a.dwell.map((d) => `<tr><td>${t(d.name)}</td><td class="num">${t(d.pct)}%</td></tr>`), '') : ''}
    ${(a.flags || []).length ? `<div style="margin-top:10px;">${a.flags.map((f) => `<div class="kv"><span class="k">Pattern flag</span><span class="v">${t(f)}</span></div>`).join('')}</div>` : ''}
  `) : '';

  const rf = m.rf || {};
  const rfRows = [...(rf.rows || []), ...(rf.match ? [{ label: 'Signature match', value: rf.match }] : []), ...(rf.modality ? [{ label: 'Modality', value: rf.modality }] : [])];
  const radio = rfRows.length ? panel('Radio Frequency', `<div class="grid">${rfRows.map((r) => kv(r.label, r.value)).join('')}</div>`) : '';

  const path = panel('Sensor Path (Cross Cueing)', `
    <div class="grid">
      ${kv('Sites crossed', (m.sitesCrossed || []).length)}
      ${kv('Chain', (m.sitesCrossed || []).join(' → '))}
      ${kv('Initial site', m.initialSite)}
      ${kv('Last confirmed', m.lastConfirmed)}
      ${kv('Course change', m.evasion)}
      ${kv('Linked events', (m.linkedEvents || []).length)}
    </div>
    ${(m.linkedEvents || []).length ? `<div style="margin-top:10px;">${table(
      [{ label: 'Linked event' }, { label: 'Site' }, { label: 'Status' }],
      m.linkedEvents.map((l) => `<tr><td class="mono">${t(l.id)}</td><td>${t(l.site)}</td><td class="mono">${t(String(or(l.status)).toUpperCase())}</td></tr>`), '')}${
      m.correlationScore != null ? `<div class="note">Composite signature similarity ${t(m.correlationScore)}%</div>` : ''}</div>` : ''}
  `);

  const sensors = panel('Contributing Sensors', `${table(
    [{ label: 'Sensor' }, { label: 'Site' }, { label: 'Location' }, { label: 'Modalities' }, { label: 'Coverage', num: true }, { label: 'Status' }, { label: 'Peak confidence', num: true }],
    (m.sensors || []).map((s) => `<tr><td class="mono">${t(s.id)}</td><td>${t(or(s.site))}</td><td>${t(or(s.node))}</td><td>${t(or(s.modalities))}</td><td class="num">${t(or(s.coverage))}</td><td class="mono">${t(or(s.status))}</td><td class="num">${t(or(s.peak))}</td></tr>`),
    'No contributing sensors recorded')}
    <div class="note">Peak confidence is the best each sensor reached during the incident.</div>`);

  // THE FORMATION: a roster that links to one section per drone (a PDF
  // cannot expand, but it can link). Only drones this site saw get one.
  const fm = Array.isArray(m.formation) ? m.formation : [];
  const roster = fm.length ? panel('Formation', table(
    [{ label: 'Drone' }, { label: 'Role' }, { label: 'Model' }, { label: 'First seen' }, { label: 'Last seen' }, { label: 'Last status' }],
    fm.map((d) => `<tr><td class="mono">${d.observed ? `<a href="#${t(d.anchor)}" style="color:inherit">${t(d.label)}</a>` : t(d.label)}</td><td>${t(or(d.role))}</td><td>${t(or(d.model))}</td><td class="mono">${t(d.observed ? or(d.firstAt) : 'Not observed by this site')}</td><td class="mono">${t(d.observed ? or(d.lastAt) : '')}</td><td>${t(or(d.outcome))}</td></tr>`),
    '')) : '';
  const drones = fm.filter((d) => d.observed).map((d) => `<div id="${t(d.anchor)}">${panel(`${d.label} · ${or(d.role, 'drone')}`, `<div class="grid">
    ${kv('Model', d.model)}
    ${kv('Radio carrier', d.radio)}
    ${kv('First seen', d.firstSeen)}
    ${kv('Last seen', d.lastSeen)}
    ${kv('Last status', d.outcome)}
  </div>${table(
    [{ label: 'Top sensors for this drone' }, { label: 'Location' }, { label: 'Detection confidence', num: true }, { label: 'When' }, { label: 'Range', num: true }],
    (d.topSensors || []).map((x) => `<tr><td class="mono">${t(x.id)}</td><td>${t(or(x.node))}</td><td class="num">${t(x.confidence)}</td><td class="mono">${t(x.at)}</td><td class="num">${t(or(x.range))}</td></tr>`),
    'No sensor of this site saw it')}${(d.history || []).length ? table(
    [{ label: 'When' }, { label: 'What happened' }],
    d.history.map((h) => `<tr><td class="mono">${t(h.at)}</td><td>${t(h.what)}</td></tr>`), '') : ''}`)}</div>`).join('');

  const timeline = panel('Timeline', table(
    [{ label: 'Time' }, { label: 'What' }, { label: 'Detail' }],
    (m.timeline || []).map((r) => `<tr><td class="mono">${t(hms(r.ts))}</td><td class="mono">${t(String(r.kind || '').toUpperCase())}</td><td>${t(r.text)}</td></tr>`),
    'No timeline recorded'));

  const escalations = panel('Escalation Log', table(
    [{ label: 'Sent' }, { label: 'Recipient' }, { label: 'Sent by' }, { label: 'Status' }, { label: 'Acknowledged' }, { label: 'Reply' }],
    (m.escalations || []).map((x) => `<tr><td class="mono">${t(hms(x.sentAt))}</td><td>${t(or(x.to))}</td><td>${t(or(x.by))}</td><td class="mono">${t(String(or(x.status)).toUpperCase())}</td><td class="mono">${t(x.ackAt ? hms(x.ackAt) : 'No')}</td><td>${t(x.reply ? `${x.reply.by}: ${x.reply.text}` : 'None')}</td></tr>`),
    'No escalations recorded'));

  const r = m.response || {};
  const response = panel('Response Action', `<div class="grid">
    ${kv('Responder', r.responder)}
    ${r.effector ? kv('Effector', r.effector) : ''}
    ${kv('Neutralised at', r.neutralisedAt)}
    ${kv('Position', r.position)}
    ${kv('Zone', r.zone)}
    ${kv('Airframes downed', r.kills)}
    ${kv('Outcome', r.outcome)}
  </div>`);

  const wreckage = (m.wreckages || []).length ? panel('Wreckage', table(
    [{ label: 'Time' }, { label: 'Position' }, { label: 'How it came down' }, { label: 'Downed by' }],
    m.wreckages.map((w) => `<tr><td class="mono">${t(hms(w.at))}</td><td class="mono">${t(w.position)}</td><td>${t(or(w.mode))}</td><td>${t(or(w.by))}</td></tr>`), '')) : '';

  const assets = m.airDefense ? panel('Available Air Defense Assets', table(
    [{ label: 'Asset' }, { label: 'Operator' }, { label: 'Role' }, { label: 'Distance to impact', num: true }, { label: 'Status' }],
    m.airDefense.map((x) => `<tr><td>${t(x.name)}</td><td>${t(x.operator)}</td><td>${t(x.role)}</td><td class="num">${t(x.distance)}</td><td class="mono">${t(x.status)}</td></tr>`), ''))
    : panel('Dispatched Counter-Drone Assets', table(
      [{ label: 'Asset' }, { label: 'Agency' }, { label: 'Kind' }, { label: 'Sent' }, { label: 'Outcome' }, { label: 'Distance to impact', num: true }],
      (m.dispatches || []).map((d) => `<tr><td>${t(d.asset)}</td><td>${t(or(d.agency))}</td><td>${t(or(d.kind))}</td><td class="mono">${t(hms(d.sentAt))}</td><td>${t(or(d.outcome))}</td><td class="num">${t(or(d.distance))}</td></tr>`),
      'No counter-drone dispatches recorded for this event'));

  const handoffs = panel('Post Incident Dispatch', table(
    [{ label: 'Handoff' }, { label: 'Status' }],
    (m.postIncident || []).map((h) => `<tr><td>${t(h.handoff)}</td><td class="mono">${t(h.status)}</td></tr>`), 'None'));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Incident Report · ${t(m.id)}</title>
<style>${reportCss(doc)}</style>
</head>
<body>
  ${reportBar({ logoUrl, eyebrow: 'Post incident report · Cross-site incident audit', generated: `Generated ${t(m.generatedAt)}` })}
  <div class="rp-page">
    <div class="rp-title">
      <div><div class="id">${t(m.id)}</div><h1>${t(or(m.type, 'Unknown platform'))}</h1></div>
      <div class="chips">
        <span class="chip" style="color:${severityToken(cls)}">${t(cls.toUpperCase())}</span>
        <span class="chip" style="color:${severityToken(thr)}">${t(thr.toUpperCase())} threat</span>
      </div>
    </div>
    ${panel('Executive Summary', exec)}
    ${panel('Track Metadata', meta)}
    ${roster}
    ${analysis}
    ${radio}
    ${path}
    ${sensors}
    ${drones}
    ${timeline}
    ${escalations}
    ${response}
    ${wreckage}
    ${assets}
    ${handoffs}
    <div class="footer"><span>End of report · ISR Systems · Confidential</span><img src="${logoUrl}" alt=""></div>
  </div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };</script>
</body>
</html>`;
}
