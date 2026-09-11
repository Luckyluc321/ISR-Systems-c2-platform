// ═══════════════════════════════════════════════════════════════════
// Cascade picker — archetype-grouped recipient selection
// ───────────────────────────────────────────────────────────────────
// Phase 5 of the recipient chapter shapes design. Pure module.
// Consumers pass an event + the RECEIVERS registry; this module
// returns a view spec the cascade modal can render directly.
//
//   buildPickerGroups(event, receivers, ctx?)
//     → { groups[], onCase[], all[], activeRoleId }
//
//   recommendationsForEvent(event, receivers)
//     → 3-6 role objects, top defaults for this event's shape
//
//   filterByQuery(roles, query)
//     → subset matching case-insensitive substring in name / id / branch
//
// Thick vs thin split follows the docs Section 7 taxonomy. Thick
// branches collapse to category tiles the operator expands on
// click. Thin branches surface individually with the same tile
// shape so the picker reads uniformly.
//
// Detection-only invariant preserved. This module only reads
// event + receivers — no dispatch, no escalation, no state
// mutation. The modal calls escalateEvent() itself when the
// operator submits.
//
// See docs/cross-agency-flows.md Section 7 "Cascade picker grouping"
// for the design contract.
// ═══════════════════════════════════════════════════════════════════

import { ARCHETYPES, ARCHETYPE_LABELS } from './archetypes.js';

// Thick vs thin — the eight archetypes split by expected role
// count in production. "Thick" archetypes collapse to a category
// tile the operator expands on click because rendering 98 kommune
// chips upfront swamps the picker. "Thin" archetypes surface
// individually inside their own group.
export const THICK_ARCHETYPES = new Set([
  ARCHETYPES.KINETIC,   // ~50 kinetic units (Politi districts, Air Force, Army, Navy, BRS)
  ARCHETYPES.MEDICAL,   // ~30 hospitals + regions + emergency medical
  ARCHETYPES.PUBLIC,    // ~102 kommuner + Hjemmeværnet distrikts
]);
export const THIN_ARCHETYPES = new Set([
  ARCHETYPES.COORD,     // ~15 command + coordination centres
  ARCHETYPES.INTEL,     // 4 intel services (PET, FE, CFCS, PET-CTA)
  ARCHETYPES.FORENSIC,  // 4 forensic + cyber (forsvar-cyber, CFCS, PET forensics, NC3)
  ARCHETYPES.REGULATORY,// ~5 regulatory agencies (Trafikstyrelsen, Sofartsstyrelsen, Energistyrelsen, min-sund)
  ARCHETYPES.LIAISON,   // ~10 NATO / Nordic / allied
]);

// Canonical archetype order in the picker. Kinetic first because
// most cascades are kinetic. Coordination next because coord units
// route work everywhere else. Then intel/forensic/regulatory as
// the observer + regulator layer. Medical + public + liaison last.
const ARCHETYPE_ORDER = [
  ARCHETYPES.KINETIC,
  ARCHETYPES.COORD,
  ARCHETYPES.INTEL,
  ARCHETYPES.FORENSIC,
  ARCHETYPES.REGULATORY,
  ARCHETYPES.MEDICAL,
  ARCHETYPES.PUBLIC,
  ARCHETYPES.LIAISON,
];

// ── Public: view spec ──────────────────────────────────────────

// Build the picker view spec for an event + the full RECEIVERS
// registry. Returns groups[] in canonical archetype order, plus
// onCase[] (roles already reached on this event), and all[] (flat
// list for type-ahead search).
//
// ctx = {
//   alreadyOnCaseRoleIds: Set<string>   optional; roles already on the case
//   activeRoleId:         string        optional; role currently viewing
// }
//
// Every role in the returned spec is annotated with:
//   .isOnCase          — true when the role already received a cascade
//   .isRecommended     — true when in recommendationsForEvent(event)
//   .isSelf            — true when role.id === activeRoleId
//
// The modal never lets the operator select a role that's already
// on-case (dedupe policy per docs Section 7). The picker still
// surfaces those roles in an "On case already" group so the
// operator sees them as read-only context.

export function buildPickerGroups(event, receivers, ctx = {}) {
  const {
    alreadyOnCaseRoleIds = new Set(),
    activeRoleId = null,
  } = ctx;
  if (!Array.isArray(receivers)) return { groups: [], onCase: [], all: [], activeRoleId };

  const recSet = new Set(recommendationsForEvent(event, receivers).map(r => r.id));
  const annotate = (role) => ({
    ...role,
    isOnCase:      alreadyOnCaseRoleIds.has(role.id),
    isRecommended: recSet.has(role.id),
    isSelf:        role.id === activeRoleId,
  });

  const annotated = receivers.filter(r => r && r.id).map(annotate);

  const onCase = annotated.filter(r => r.isOnCase);
  const selectable = annotated.filter(r => !r.isOnCase && !r.isSelf);

  const byArchetype = new Map();
  for (const arch of ARCHETYPE_ORDER) byArchetype.set(arch, []);
  for (const role of selectable) {
    const bucket = byArchetype.get(role.archetype);
    if (bucket) bucket.push(role);
  }

  const groups = [];
  for (const arch of ARCHETYPE_ORDER) {
    const roles = byArchetype.get(arch) || [];
    if (!roles.length) continue;
    // Alphabetical inside each group for predictable scan order.
    roles.sort((a, b) => (a.label || a.name || a.id).localeCompare(b.label || b.name || b.id));
    groups.push({
      archetype: arch,
      label:     ARCHETYPE_LABELS[arch] || arch,
      isThick:   THICK_ARCHETYPES.has(arch),
      roles,
    });
  }

  return { groups, onCase, all: selectable, activeRoleId };
}

// ── Public: recommender ────────────────────────────────────────

// Surface 3-6 top defaults for this event based on shape:
//   - classification × threat combinations map to archetype defaults
//   - platform hints (cruise, quadcopter, fixed-wing) shift priority
//   - siteId domainScope narrows medical / regulatory tie-ins
//
// Detection-only stance preserved. Recommender output is UI
// guidance, never an auto-dispatch trigger. Operator always
// confirms.

export function recommendationsForEvent(event, receivers) {
  if (!event || !Array.isArray(receivers)) return [];

  const classification = event.classification || 'unknown';
  const threat = event.threat || 'unknown';
  const platform = (event.platform || event.droneType || '').toLowerCase();
  const domainScope = Array.isArray(event.domainScope) ? event.domainScope : [];

  // Ordered pick-list architecture. Each rule appends items to `picks`
  // in the order they should compete for slots. Items are either
  // { id } (specific role) or { arch } (best RECEIVERS candidate for
  // that archetype). The cap trims from the tail so life-safety picks
  // interleaved with intel/command always survive at the expense of
  // domain regulators.
  //
  // Pre-audit ordering pushed all IDs first, then ran the archetype
  // fallback pass — a triple-domain hostile filled the cap with
  // regulator IDs and dropped every stand-in. Fixed 2026-09-11 pass 2.
  const picks = [];

  // Rule 1 · Any hostile detection gets intel eyes on it.
  if (classification === 'hostile') {
    picks.push({ id: 'pet' }, { id: 'fe' });
  }

  // Rule 2 · High-threat hostile pulls in national command +
  // kinetic response. The KINETIC stand-in sits BETWEEN the two
  // command IDs so it can't be trimmed by regulators later.
  if (classification === 'hostile' && threat === 'high') {
    picks.push({ id: 'forsvarskmd' });
    picks.push({ arch: ARCHETYPES.KINETIC });
    picks.push({ id: 'rigspoliti' });
  }

  // Rule 3 · Cruise-missile signature or explosive-carry hint
  // pulls medical + public safety to standby, plus fire and rescue.
  // MEDICAL stand-in first (life-safety priority), then PUBLIC,
  // then beredskab as the fire/rescue anchor.
  if (/cruise|missile|shahed|swarm/.test(platform)) {
    picks.push({ arch: ARCHETYPES.MEDICAL });
    picks.push({ arch: ARCHETYPES.PUBLIC });
    picks.push({ id: 'beredskab' });
  }

  // Rule 4 · Domain-shaped tie-ins. Aviation → Trafikstyrelsen for
  // NOTAM; maritime → Sofartsstyrelsen for AIS advisory; energy →
  // Energistyrelsen. Regulators come LAST so cap-at-6 trims them
  // first when life-safety picks are competing for the same slots.
  if (domainScope.includes('aviation')) picks.push({ id: 'agency-traf' });
  if (domainScope.includes('maritime')) picks.push({ id: 'agency-sof' });
  if (domainScope.includes('energy'))   picks.push({ id: 'agency-ener' });

  // Rule 5 · CBRN specialists (brs-kemisk / brs-nukleart) are
  // REMOVED pending a real hazmat field on the event record. Pre-audit
  // (2026-09-11) this rule gated on event.outEnv which no code path
  // ever populated — dead branch. Wire it back the moment a real
  // classification like `event.hazmatKind` or `event.threatTags`
  // lands. Until then the operator adds them manually through the
  // full picker so we don't hide a specialist behind an unset field.

  const CAP = 6;
  const picked = new Map();
  const _addId = (rid) => {
    if (picked.size >= CAP || picked.has(rid)) return;
    const role = receivers.find(r => r.id === rid);
    if (role) picked.set(rid, role);
  };
  const _addArch = (arch) => {
    if (picked.size >= CAP) return;
    const rep = receivers
      .filter(r => r.archetype === arch && !picked.has(r.id))
      .sort((a, b) => (a.id || '').localeCompare(b.id || ''))[0];
    if (rep) picked.set(rep.id, rep);
  };

  for (const p of picks) {
    if (p.id) _addId(p.id);
    else if (p.arch) _addArch(p.arch);
    if (picked.size >= CAP) break;
  }

  return Array.from(picked.values());
}

// ── Public: type-ahead ─────────────────────────────────────────

// Case-insensitive substring match across role.label, role.id,
// role.branch, role.org. Returns a NEW array — never mutates the
// input. Empty query returns the input unchanged.

export function filterByQuery(roles, query) {
  if (!Array.isArray(roles)) return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return roles;
  return roles.filter(r => {
    // Defensive null-guard matches buildPickerGroups' contract:
    // exported pure functions can't throw on a caller's stray null.
    // Added 2026-09-11 audit pass 2.
    if (!r) return false;
    const hay = [
      r.label || '',
      r.name || '',
      r.id || '',
      r.branch || '',
      r.parent || '',
      r.parentId || '',
      r.org || '',
      ARCHETYPE_LABELS[r.archetype] || '',
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}
