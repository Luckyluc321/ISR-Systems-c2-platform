// ═══════════════════════════════════════════════════════════════════
// Agency accounts that hold their endpoint at every site
// ───────────────────────────────────────────────────────────────────
// A national agency answers for every site, so its account should hold
// its endpoint at every site. Written out by hand, the lists stopped at
// the eight sites that existed when they were typed: PET, FE,
// Rigspolitiet, Beredskabsstyrelsen, Forsvarskommandoen, the Hæren
// garrisons, Jægerkorpset, Karup and Skrydstrup held nothing at Billund,
// Odense or Amager, so an escalation to them from there reached no inbox
// (audit of 2026-10-30).
//
// An account declares a rule instead, and this adds every destination
// the rule matches to the account's list, once the destination catalogue
// is final:
//
//   autoDestPattern: /-t3-fe$/            matched against the id
//   autoDestMatch:   (d) => boolean       for rules an id cannot express
//
// It only ever adds. Ids already on the list stay, so a hand-held endpoint
// is never lost. Aktionsstyrken has worked this way since P75.
//
// Pure, so main.js and check:national-reach run the same code.
// ═══════════════════════════════════════════════════════════════════

/** Add every destination each account's rule matches to its list. */
export function applyAutoDestinations(receivers, allDestinations) {
  for (const r of receivers || []) {
    const byId = r.autoDestPattern instanceof RegExp ? (d) => r.autoDestPattern.test(d.id) : null;
    const byFn = typeof r.autoDestMatch === 'function' ? r.autoDestMatch : null;
    if (!byId && !byFn) continue;
    const matches = (allDestinations || [])
      .filter((d) => d && d.siteId != null && ((byId && byId(d)) || (byFn && byFn(d))))
      .map((d) => d.id);
    if (matches.length) r.destinationIds = Array.from(new Set([...(r.destinationIds || []), ...matches]));
  }
  return receivers;
}
