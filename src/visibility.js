// ═══════════════════════════════════════════════════════════════════
// Visibility scoping — cross-tenant redaction for contributor chapters
// ───────────────────────────────────────────────────────────────────
// Phase 6 of the recipient chapter shapes design. Pure module.
// One entry point:
//
//   chapterVisibilityFor(viewer, chapterRole, event)
//     → 'full' | 'summary' | 'hidden'
//
// FULL     — every block + every sub-section rendered as authored.
// SUMMARY  — nameplate + counts only. No timeline slice, no
//            sub-section bodies, no situation-received attribution.
//            The row still surfaces so the viewer knows the role
//            was on the case, but internal notes stay inside the
//            authoring tenant.
// HIDDEN   — the chapter card does not render at all. The viewer
//            has no need-to-know that this contributor was ever
//            involved (e.g. covert intel role on a civil event).
//
// Policy rationale — critical infrastructure customers do coordinate
// through this platform, and blanket redaction would defeat the
// purpose. Only intelligence + forensic material stays inside its
// authoring branch by default. Everything else defaults to FULL
// because operators, coordination cells, medical, regulatory, and
// public safety benefit from transparent visibility across the case.
//
// Detection-only invariant preserved. This module returns policy
// levels only — no writes, no logging, no dispatch triggers.
//
// See docs/cross-agency-flows.md Section 7 "Visibility scoping" for
// the policy contract and matrix.
// ═══════════════════════════════════════════════════════════════════

import { ARCHETYPES } from './archetypes.js';

export const VISIBILITY = {
  FULL:    'full',
  SUMMARY: 'summary',
  HIDDEN:  'hidden',
};

// Roles that always see every chapter fully regardless of archetype.
// Populated at runtime by the admin console when an Admin tenant is
// active. Empty by default (production admin bypass happens on the
// server side; this local override is for admin-tenant preview only).
const _adminBypassRoleIds = new Set();
export function registerAdminBypass(roleId) {
  if (!roleId) return;
  _adminBypassRoleIds.add(roleId);
}
export function clearAdminBypass(roleId) {
  if (!roleId) { _adminBypassRoleIds.clear(); return; }
  _adminBypassRoleIds.delete(roleId);
}

// Chapters whose PRIMARY archetype is one of these are considered
// authored inside a compartmented branch. Non-compartment viewers
// see them as SUMMARY only. Intel + Forensic are the two compart-
// ments today — they protect pattern-of-life / attribution notes
// and chain-of-custody artifacts respectively.
const COMPARTMENTED_ARCHETYPES = new Set([
  ARCHETYPES.INTEL,
  ARCHETYPES.FORENSIC,
]);

// Archetypes whose viewers are cleared to read compartmented material.
// Intel and forensic viewers see each other's chapters as FULL because
// they cross-consume pattern signatures + evidence context routinely.
const COMPARTMENT_CLEARED_ARCHETYPES = new Set([
  ARCHETYPES.INTEL,
  ARCHETYPES.FORENSIC,
]);

// ── Policy ─────────────────────────────────────────────────────

// Returns the redaction level a viewer applies to a chapter. Pure
// function of (viewer, chapterRole, event); safe to call from any
// render path. All three arguments are RECEIVERS-shape role objects
// (or null for viewer when no active role — e.g. admin console).
//
// Rule order matters — first rule that hits wins.

export function chapterVisibilityFor(viewer, chapterRole, event) {
  // `event` is reserved for future per-event overrides (event-level
  // sensitivity tags, incident-specific compartment flags). No current
  // rule reads it — signature preserved so callers don't need to
  // refactor when per-event policy lands.
  void event;
  if (!chapterRole) return VISIBILITY.HIDDEN;

  // Rule 0 · No active viewer (dev handle, admin console, seed
  // backfill) → FULL. Server-side auth is expected to enforce the
  // real gate; client-side visibility is defence in depth.
  if (!viewer) return VISIBILITY.FULL;

  // Rule 1 · Admin bypass — explicit opt-in via registerAdminBypass.
  if (_adminBypassRoleIds.has(viewer.id)) return VISIBILITY.FULL;

  // Rule 2 · Viewer is the chapter author → FULL (own chapter).
  if (viewer.id === chapterRole.id) return VISIBILITY.FULL;

  // Rule 3 · Same parent / branch → FULL. Siblings inside the same
  // agency branch (all Politi districts, all hospitals in a region,
  // all Air Force wings) share operational context by definition.
  const viewerParent  = viewer.parent  || viewer.parentId  || null;
  const chapterParent = chapterRole.parent || chapterRole.parentId || null;
  if (viewerParent && chapterParent && viewerParent === chapterParent) {
    return VISIBILITY.FULL;
  }

  // Rule 4 · Compartmented archetype (INTEL or FORENSIC) viewed by
  // a non-cleared viewer → SUMMARY. Compartment members see each
  // other's chapters fully; everyone else gets nameplate + counts.
  if (COMPARTMENTED_ARCHETYPES.has(chapterRole.archetype)
      && !COMPARTMENT_CLEARED_ARCHETYPES.has(viewer.archetype)) {
    return VISIBILITY.SUMMARY;
  }

  // Rule 5 · Default → FULL. Cross-agency civil coordination
  // benefits from transparent visibility; blanket redaction would
  // defeat the coordination purpose of the platform.
  return VISIBILITY.FULL;
}

// Convenience predicate for callers that only care about the boolean.
export function shouldHideChapter(viewer, chapterRole, event) {
  return chapterVisibilityFor(viewer, chapterRole, event) === VISIBILITY.HIDDEN;
}

// Convenience for callers that want to know if the chapter is at
// least partially readable.
export function isVisible(viewer, chapterRole, event) {
  return chapterVisibilityFor(viewer, chapterRole, event) !== VISIBILITY.HIDDEN;
}
