// ═══════════════════════════════════════════════════════════════════
// Who signs a note, an escalation, a reclassification or a reply
// ───────────────────────────────────────────────────────────────────
// The audit trail is the record an agency reads after an incident.
// Until 2026-11-02 it was signed wrong in two directions (audit of
// 2026-10-30):
//
//   - every manual escalation, operator note and reclassification fell
//     back to a fixed "L. Flindt", whoever was signed in, and every
//     reclassification was stamped 2026-07-24 14:32:41Z;
//   - a receiver's reply was signed `${person} (${org})`, and 369 of the
//     386 receiver profiles carry no person, so it read
//     "undefined (Sydøstjyllands Politi)".
//
// One rule now: the signed-in account signs. A named person signs as
// "Name (Organisation)"; an account with no person signs as its own
// name, which for an agency account is the agency. Nothing invents a
// person. With real sign-in the person comes from the session and this
// is still the one place that formats it.
//
// Pure, so check:signatures holds it without a browser.
// ═══════════════════════════════════════════════════════════════════

export const UNKNOWN_SIGNER = 'Unknown account';

/** The signature for this account. */
export function signatureFor(role) {
  if (!role) return UNKNOWN_SIGNER;
  const org = role.org || role.label || role.id || '';
  if (role.person) return org ? `${role.person} (${org})` : role.person;
  return role.label || org || UNKNOWN_SIGNER;
}

/** The short name for the account chip: the person, or the account. */
export function displayNameFor(role) {
  return role?.person || role?.label || role?.org || role?.id || UNKNOWN_SIGNER;
}
