// ═══════════════════════════════════════════════════════════════════
// Which top-bar views an account may open
// ───────────────────────────────────────────────────────────────────
// docs/user-flows.md, the tenant table: an operator gets the live map,
// sensor health, the ledger, config, history and fleet. A receiver gets
// a filtered inbox of what was sent to it, the brief, and its responses.
// Nothing else.
//
// Until 2026-11-02 that was true of the map and not of the top bar. The
// receiver body class hid the map panels, and History, Fleet and Config
// stayed one click away for every receiver: Fleet listed every customer's
// sensors and their outages, and Config opened any site's escalation
// chain and rules for editing (audit of 2026-10-30).
//
// One table, read by the tab bar, by setActiveView and by the editors'
// openers, so a view cannot be reached by a route the bar does not show.
// An account of a kind not listed here gets the live view only: fail
// closed.
//
// Pure, so check:view-access holds it without a browser.
// ═══════════════════════════════════════════════════════════════════

export const VIEWS_BY_KIND = Object.freeze({
  admin: Object.freeze(['live', 'history', 'fleet', 'config']),
  operator: Object.freeze(['live', 'history', 'fleet', 'config']),
  // The receiver's own console (inbox, reports, case file) is what the
  // live view shows for a receiver, so 'live' is all it needs.
  receiver: Object.freeze(['live']),
});

/** The views this account may open. */
export function viewsFor(role) {
  return VIEWS_BY_KIND[role?.kind] || ['live'];
}

/** Whether this account may open this view. */
export function canOpenView(role, view) {
  return viewsFor(role).includes(view);
}
