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

  const who = respondersOf(e);
  const by = who ? `by ${who}` : 'by a responder the record does not name';
  const when = _t(e.neutralizedAt);
  const where = opts.position ? `, position ${opts.position}${opts.positionSite ? ` (${opts.positionSite})` : ''}` : '';
  parts.push(`Neutralised ${by}${when ? ` at ${when}` : ''}${where}.`);

  return parts.join(' ');
}
