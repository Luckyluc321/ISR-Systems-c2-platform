// ═══════════════════════════════════════════════════════════════════
// The incident report's summary, written from the event itself
// ───────────────────────────────────────────────────────────────────
// The post-incident section of the detail panel printed one story for
// every neutralised event: "Cruise missile signature originated south
// west of Kassø on bearing 62° ... Impact avoided over inner Copenhagen",
// with a fighter response as the responder whenever none was recorded.
// A drone downed over Aarhus harbour read as a missile over Copenhagen
// (audit of 2026-10-30).
//
// Every clause here comes from a field the event carries. A fact the
// event does not have is left out, never filled in: no origin bearing,
// no "impact avoided" target, no default responder.
//
// Pure, so check:incident-summary holds it without a browser.
// ═══════════════════════════════════════════════════════════════════

import { shownClass, shownType } from './identification_gate.js';

// A course change smaller than this is sensor noise, not evasion. The
// same threshold the report's EVASION cell has always used.
export const EVASION_MIN_DEG = 8;

const _t = (iso) => (typeof iso === 'string' && iso.length >= 19 ? `${iso.slice(11, 19)}Z` : null);

/**
 * Who neutralised it, from the record: the responder the event names,
 * else the dispatch the record says made the kill. null when it has neither.
 * The swarm path once set only the outcome, so a report read "a responder
 * the record does not name" with the interceptor's dispatch on the event.
 */
export function respondersOf(e) {
  if (!e) return null;
  if (e.neutralizedBy) return e.neutralizedBy;
  // The dispatch that made the kill, when the record says which. Not every
  // dispatch on the event: a patrol car or an ambulance sent to the same
  // case did not neutralise it (verifier, 2026-11-03).
  const id = e.neutralisedByDispatchId;
  if (id != null) {
    const d = (e.counterDispatches || []).find((x) => x && (x.dispatchId === id || x.groupId === id));
    if (d?.assetName) return d.assetName;
  }
  return null;
}

/**
 * opts:
 *   siteName      (siteId) => display name
 *   sitesTouched  site ids the track was seen at, first detection first
 *   evasionDeg    measured course change in degrees, or 0
 *   position      "55.6180°N 12.6470°E" where it was neutralised, or null
 *   positionSite  display name of the site nearest that position, or null
 */
export function incidentExecSummary(e, opts = {}) {
  if (!e) return '';
  const siteName = typeof opts.siteName === 'function' ? opts.siteName : (id) => id;
  const touched = Array.isArray(opts.sitesTouched) && opts.sitesTouched.length ? opts.sitesTouched : [e.siteId].filter(Boolean);
  const parts = [];

  const what = shownType(e, 'Track');
  const cls = shownClass(e, '');
  const at = _t(e.startTime);
  parts.push(`${what}${cls && cls !== 'unknown' ? ` (${cls})` : ''} first detected${at ? ` at ${at}` : ''} over ${siteName(e.siteId)}.`);

  parts.push(touched.length > 1
    ? `Tracked across ${touched.length} sensor sites: ${touched.map(siteName).join(' → ')}.`
    : `Tracked by the sensors at ${siteName(touched[0] || e.siteId)}.`);

  const ev = Number(opts.evasionDeg) || 0;
  if (ev > EVASION_MIN_DEG) parts.push(`Course changed by ${Math.round(ev)}° during the track.`);

  // Only a neutralised incident says it was neutralised. The sentence was
  // written for the post-incident section, which only exists for those,
  // and the downloadable report also covers incidents that were not
  // (verifier sample, 2026-11-03: a monitored Esbjerg drone read
  // "Neutralised by a responder the record does not name").
  if (e.outcome === 'neutralized' || e.neutralizedAt) {
    const who = respondersOf(e);
    const by = who ? `by ${who}` : 'by a responder the record does not name';
    const when = _t(e.neutralizedAt);
    const where = opts.position ? `, position ${opts.position}${opts.positionSite ? ` (${opts.positionSite})` : ''}` : '';
    parts.push(`Neutralised ${by}${when ? ` at ${when}` : ''}${where}.`);
  } else if (e.status === 'closed') {
    const closedAt = _t(e.endTime);
    parts.push(`Closed${closedAt ? ` at ${closedAt}` : ''}, outcome ${String(e.outcome || 'monitored').replace(/-/g, ' ')}.`);
  } else {
    parts.push('Still active when this was written.');
  }

  return parts.join(' ');
}

// The turn between two compass headings: the smaller angle, 0 to 180
// degrees. Subtracting them raw read a turn from 50 to 283 as 233
// degrees; it is 127 (2026-11-05). Null when either is missing.
export function courseChangeDeg(fromDeg, toDeg) {
  if (fromDeg == null || toDeg == null) return null;
  const a = Number(fromDeg);
  const b = Number(toDeg);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = Math.abs(a - b) % 360;
  return Math.round(d > 180 ? 360 - d : d);
}

// Who made each link. Two paths exist: the platform links the case a
// track opens at another site to the case it came from
// (shadowOfEventId), and the signature correlator links detections it
// matches. No operator link path exists, so no link is ever called
// operator-confirmed. linkedEvents: the linked cases this account may
// open, as objects.
export function linkKinds(event, linkedEvents) {
  const crossing = [];
  const matched = [];
  for (const le of linkedEvents || []) {
    if (!le) continue;
    if (le.shadowOfEventId === event?.id || (event?.shadowOfEventId && event.shadowOfEventId === le.id)) crossing.push(le.id);
    else matched.push(le.id);
  }
  return { crossing, matched };
}

const _count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Pattern flags for the analysis panel and the report.
export function linkFlags({ crossing = [], matched = [] } = {}, correlationScore = null) {
  const out = [];
  if (crossing.length) out.push(`Same track at ${_count(crossing.length, 'other site', 'other sites')}`);
  if (matched.length) {
    out.push(`Signature match with ${_count(matched.length, 'other detection', 'other detections')}`
      + (correlationScore ? ` (${Math.round(correlationScore * 100)}%)` : ''));
  }
  return out;
}

// One sentence for the debrief narrative, or null when there is nothing.
export function linkSentence({ crossing = [], matched = [] } = {}) {
  const parts = [];
  if (crossing.length) parts.push(`the same track was seen at ${_count(crossing.length, 'other site', 'other sites')}`);
  if (matched.length) parts.push(`the signature correlator matched ${_count(matched.length, 'related detection', 'related detections')}`);
  if (!parts.length) return null;
  const s = parts.join(', and ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}
