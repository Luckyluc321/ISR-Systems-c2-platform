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
    roles.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
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
  const siteId = event.siteId || null;
  const outEnv = event.outEnv || null;

  const desiredArchetypes = [];
  const desiredRoleIds = [];

  // Rule 1 · Any hostile detection gets intel eyes on it.
  if (classification === 'hostile') {
    desiredRoleIds.push('pet', 'fe');
  }

  // Rule 2 · High-threat hostile pulls in national command +
  // kinetic response. Otherwise coordinate to the local Politi
  // district as the ground authority.
  if (classification === 'hostile' && threat === 'high') {
    desiredArchetypes.push(ARCHETYPES.KINETIC);
    desiredRoleIds.push('forsvarskmd', 'rigspoliti');
  }

  // Rule 3 · Cruise-missile signature or explosive-carry hint
  // pulls medical + public safety to standby.
  if (/cruise|missile|shahed|swarm/.test(platform)) {
    desiredArchetypes.push(ARCHETYPES.MEDICAL, ARCHETYPES.PUBLIC);
  }

  // Rule 4 · Domain-shaped tie-ins. Aviation domain → Trafikstyrelsen
  // for NOTAM; maritime → Sofartsstyrelsen for AIS advisory;
  // energy → Energistyrelsen when grid site is affected.
  if (domainScope.includes('aviation')) desiredRoleIds.push('agency-traf');
  if (domainScope.includes('maritime')) desiredRoleIds.push('agency-sof');
  if (domainScope.includes('energy'))   desiredRoleIds.push('agency-ener');

  // Rule 5 · CBRN / hazmat outenv triggers specialist units.
  if (outEnv === 'chemical' || outEnv === 'biological') desiredRoleIds.push('brs-kemisk');
  if (outEnv === 'nuclear'  || outEnv === 'radiological') desiredRoleIds.push('brs-nukleart');

  // Assemble: explicit role ids first, then one representative per
  // desired archetype (the lowest-id alphabetical stand-in). Cap at
  // 6 to keep the recommendation row scannable.
  const picked = new Map();
  for (const rid of desiredRoleIds) {
    const role = receivers.find(r => r.id === rid);
    if (role && !picked.has(rid)) picked.set(rid, role);
    if (picked.size >= 6) break;
  }
  if (picked.size < 6) {
    for (const arch of desiredArchetypes) {
      const rep = receivers.find(r => r.archetype === arch && !picked.has(r.id));
      if (rep) picked.set(rep.id, rep);
      if (picked.size >= 6) break;
    }
  }

  return Array.from(picked.values());
}

// ── Public: type-ahead ─────────────────────────────────────────

// Case-insensitive substring match across role.name, role.id,
// role.branch, role.org. Returns a NEW array — never mutates the
// input. Empty query returns the input unchanged.

export function filterByQuery(roles, query) {
  if (!Array.isArray(roles)) return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return roles;
  return roles.filter(r => {
    const hay = [
      r.name || '',
      r.id || '',
      r.branch || '',
      r.parent || '',
      r.org || '',
      ARCHETYPE_LABELS[r.archetype] || '',
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}
