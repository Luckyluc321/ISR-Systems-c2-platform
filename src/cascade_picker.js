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

// One warning per site and archetype, so a recommendation that runs on
// every render does not flood the console. A missing role tag is a
// manifest configuration gap, not a runtime error: the recommendation
// is simply one shorter, and this names exactly what to add.
const _warnedSiteRoles = new Set();
function _warnMissingSiteRole(siteId, arch, tags) {
  const key = `${siteId}:${arch}`;
  if (_warnedSiteRoles.has(key)) return;
  _warnedSiteRoles.add(key);
  console.warn(
    `[cascade] sites/${siteId}.yaml declares no receiver tagged '${tags.join("' or '")}', ` +
    `so the ${arch} slot is left empty rather than recommending a distant agency. ` +
    `Add the local kommune to that manifest's receivers block with role: ${tags[0]}.`
  );
}

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
    // Threaded through to the recommender so the modal's stars agree
    // with the recommended row above them. Without it the row resolved
    // an archetype slot site-locally while the groups resolved it
    // nationally, so one modal showed two different answers for the
    // same event.
    siteReceivers = [],
  } = ctx;
  if (!Array.isArray(receivers)) return { groups: [], onCase: [], all: [], activeRoleId };

  const recSet = new Set(recommendationsForEvent(event, receivers, { siteReceivers }).map(r => r.id));
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

// opts.siteReceivers is the event site's own receivers block from its
// manifest, used to resolve archetype slots to the LOCAL agency rather
// than a national alphabetical winner. Optional and additive: callers
// that omit it fall back to the national defaults below, so existing
// call sites keep working unchanged. Deliberately passed in rather than
// imported, because the sites registry is Vite-only and importing it
// here would make this module unloadable outside a bundler, and so
// untestable.
export function recommendationsForEvent(event, receivers, opts = {}) {
  if (!event || !Array.isArray(receivers)) return [];
  const siteReceivers = Array.isArray(opts.siteReceivers) ? opts.siteReceivers : [];

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
  // kinetic response. forsvarskmd + KINETIC stand-in take the
  // first two command slots; rigspoliti pushed further down so
  // it doesn't crowd out cruise-triggered life-safety picks.
  if (classification === 'hostile' && threat === 'high') {
    picks.push({ id: 'forsvarskmd' });
    picks.push({ arch: ARCHETYPES.KINETIC });
  }

  // Rule 3 · Cruise-missile signature or explosive-carry hint
  // pulls medical + public safety to standby, plus fire and rescue.
  // MEDICAL + PUBLIC come BEFORE rigspoliti (deferred from Rule 2)
  // so on the extreme cruise+high+hostile scenario a mass-casualty
  // evacuation-broadcast pathway is always represented. Prior order
  // shipped a real PUBLIC drop bug caught in audit pass 3.
  if (/cruise|missile|shahed|swarm/.test(platform)) {
    picks.push({ arch: ARCHETYPES.MEDICAL });
    picks.push({ arch: ARCHETYPES.PUBLIC });
  }

  // Rule 2 tail · Second command channel (national police) after
  // life-safety picks so cruise+high+hostile keeps PUBLIC in the
  // cap-6 slot budget. On hostile+high without cruise, rigspoliti
  // still lands (only 4 rules fire, no cap pressure).
  if (classification === 'hostile' && threat === 'high') {
    picks.push({ id: 'rigspoliti' });
  }

  // Rule 3 tail · Fire/rescue anchor after life-safety archetype
  // stand-ins. beredskab is a COORD role for consequence response,
  // not itself kinetic; the kinetic stand-in (usually brs) already
  // covers the operational fire/rescue layer.
  if (/cruise|missile|shahed|swarm/.test(platform)) {
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
  // Resolve an archetype slot to an actual agency.
  //
  // This used to be "the alphabetically lowest role carrying that
  // archetype", which is stable but arbitrary, and it put the choice at
  // the mercy of agency names. Two failures came from that in one
  // session. Reclassifying fire services as public safety let
  // brs-allinge sort ahead of every kommune and silently take the
  // mass-casualty broadcast slot, so a rescue centre on Bornholm
  // displaced the authority that actually warns residents. And the
  // slot's previous winner, kom-aabenraa, was only ever first because
  // of its name: it sits 250 km from Copenhagen and would have been
  // recommended for an incident at the airport.
  //
  // Resolution order now:
  //   1. A role the SITE itself declares for this archetype. Manifests
  //      already name their local responders, so Copenhagen Airport
  //      resolves its broadcast slot to kom-taarnby rather than to
  //      whichever kommune sorts first nationally.
  //   2. A named national default, for events with no site receivers.
  //   3. The old alphabetical sort, as a last resort so a new archetype
  //      can never silently produce an empty slot.
  //
  // Step 1 is what makes reclassification safe: an agency's archetype no
  // longer decides which slot it wins, so moving a role between
  // archetypes cannot reshuffle the recommendation set.
  // Manifest role tags that mark a receiver as serving this archetype
  // at this site, matched against the site's own receivers block.
  //
  // PUBLIC only. There is deliberately no MEDICAL entry: no manifest
  // declares a medical role tag. The complete tag vocabulary in use
  // across all nine sites is site-owner, primary-response,
  // emergency-response, municipal-crisis, air-response, regulator and
  // maritime-response. An earlier draft listed 'medical' and
  // 'ambulance' here, which matched nothing and made a dead branch read
  // as a working feature.
  const _ARCH_SITE_ROLE_TAGS = {
    [ARCHETYPES.PUBLIC]: ['municipal-crisis'],
  };

  // Used ONLY where no site-local answer can exist. MEDICAL has no site
  // tag anywhere, so every site resolves here, which is exactly the
  // behaviour before this change and is left untouched rather than
  // silently altered. Wiring the four regional coordination centres
  // (amk-sjaelland, amk-syddanmark, amk-midtjylland, amk-nordjylland,
  // all registered and all currently unreachable) needs a medical tag
  // added to the manifests and is its own change.
  const _ARCH_NATIONAL_DEFAULT = {
    [ARCHETYPES.MEDICAL]: 'amk-hovedstaden',
  };

  const _addArch = (arch) => {
    if (picked.size >= CAP) return;
    const available = (rid) => !picked.has(rid) && receivers.some(r => r.id === rid);

    const tags = _ARCH_SITE_ROLE_TAGS[arch];
    if (tags) {
      for (const sr of siteReceivers) {
        if (!sr?.id || !tags.includes(sr.role)) continue;
        if (!available(sr.id)) continue;
        picked.set(sr.id, receivers.find(r => r.id === sr.id));
        return;
      }
      // No local answer, and for a slot like this there is no safe
      // national one. The public-safety slot exists to reach the
      // authority that warns residents, and that authority is local by
      // definition. Seating a Copenhagen kommune for a North Jutland
      // substation is the same defect that motivated this whole change,
      // just made deliberate, and an alphabetical fallback is what put a
      // Bornholm rescue centre in the slot in the first place.
      //
      // So: recommend nobody, and say why. The operator can still pick
      // the right kommune by hand, and a missing recommendation is
      // honest where a confident wrong one is not.
      if (event.siteId) _warnMissingSiteRole(event.siteId, arch, tags);
      return;
    }

    const fallbackId = _ARCH_NATIONAL_DEFAULT[arch];
    if (fallbackId && available(fallbackId)) {
      picked.set(fallbackId, receivers.find(r => r.id === fallbackId));
      return;
    }

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
