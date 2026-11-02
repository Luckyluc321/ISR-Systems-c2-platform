// ═══════════════════════════════════════════════════════════════════
// Whose units a receiver may dispatch from the Mission Console
// ───────────────────────────────────────────────────────────────────
// The Mission Console decided "your units" by unit TYPE, from a fixed
// table of kinds per role. So on a Copenhagen Airport drone case
// Københavns Politi was offered Rigspolitiet's national drone response as
// its own, with a Dispatch button, and Rigspolitiet was offered Københavns
// Politi's district unit (audit of 2026-10-30).
//
// The answer is ownership, which agency_ownership.js already knows for
// every national-pool unit and which "Send request" already used:
//
//   - admin may dispatch anything (testing and support);
//   - an agency may dispatch the units it owns;
//   - and the units of anything below it in the account tree.
//
// One addition the tree cannot express: Forsvarskommandoen commands
// Forsvaret, but sits beside it in the tree, not above it. The type table
// let it dispatch every defence unit, and it keeps that.
//
// A unit with no known owner is nobody's to dispatch: fail closed. The
// other agencies' units stay on screen, under "other agencies", with a
// request instead of a dispatch.
//
// Pure apart from the two lookups, which tests can replace.
// ═══════════════════════════════════════════════════════════════════

import { ACCOUNTS } from './roles.js';
import { ownerRoleIdForAsset } from './agency_ownership.js';

export const COMMAND_AUTHORITY = Object.freeze({
  // Forsvarskommandoen commands the armed forces (Hæren, Flyvevåbnet,
  // Søværnet, Specialoperationskommandoen), all under 'forsvaret'.
  forsvarskmd: Object.freeze(['forsvaret']),
});

const _byId = new Map(ACCOUNTS.map((r) => [r.id, r]));
const _parentOf = (id) => _byId.get(id)?.parentId || null;

/** Whether this account may dispatch this unit itself. */
export function canDispatchUnit(role, assetId, { ownerOf = ownerRoleIdForAsset, parentOf = _parentOf } = {}) {
  if (!role) return false;
  if (role.kind === 'admin') return true;
  const owner = ownerOf(assetId);
  if (!owner) return false;
  if (owner === role.id) return true;
  const authority = new Set([role.id, ...(COMMAND_AUTHORITY[role.id] || [])]);
  const seen = new Set();
  for (let cur = parentOf(owner); cur && !seen.has(cur); cur = parentOf(cur)) {
    seen.add(cur);
    if (authority.has(cur)) return true;
  }
  return false;
}
