// What an agency can be asked to do, by what kind of agency it is.
//
// Replaces a hand-written ladder on org-chart branch plus exact-id tests.
// The rule is reviewed in docs/receiver-capability-draft.md.
//
// KEYED ON ARCHETYPE AND BRANCH, NOT ARCHETYPE ALONE
//
// This is the finding that shaped the file. 145 roles carry the
// kinetic-response archetype and they are not alike:
//
//     81  Hjemmeværnet districts
//     16  Søværnet
//     14  Flyvevåbnet
//     14  Politi districts
//     12  Hæren garrisons
//
// A volunteer home guard district and an F-35 base are the same
// archetype. A rule keyed on archetype alone gives them the same buttons,
// and a modelled rewrite that did exactly that offered a fighter scramble
// to all 81 volunteer districts and an ambulance to 31 hospitals.
//
// So archetype says what KIND OF WORK the agency does, and branch says
// what it actually HOLDS. Both are already in the data.
//
// THREE RULES THAT HOLD EVERYWHERE
//
//   A button that moves people or vehicles requires a declared
//   inventory. Enforced downstream, in receiver_ctas.js, and it is the
//   only thing that stopped that modelled rewrite handing out 310 of
//   them.
//
//   Capability is offered; the SITE decides. Each site declares which
//   responses are possible there, and an Energinet substation allows
//   two. That gate is applied after this table, never instead of it.
//
//   We describe what an agency can be ASKED to do, never what equipment
//   it holds. Specifying a responder's hardware is how the counter-drone
//   jamming copy got written, and it was invented.
//
// MIGRATION
//
// MIGRATED controls which archetypes read from this table. All eight are
// in, and the mechanism is kept because the next change to this table
// should be able to move one archetype at a time.
//
// Each was measured separately against the committed baseline before
// being switched on. The totals:
//
//     coordination-command        2 roles change
//     intelligence-attribution    2
//     forensic-cyber              2
//     regulatory, medical,        0
//     public, kinetic, liaison
//
// Six roles in total, and every one of them loses the same thing: the
// ability to call out the national tactical unit. They are the SIRENE
// office, the police academy, the national criminal centre, the national
// cyber crime centre, the forensic centre and disaster victim
// identification. They hold it today because the old rule keyed on
// having 'politi' as an org-chart parent, which is a fact about the
// organisation chart and not about what the unit does. A police academy
// cannot call out Aktionsstyrken.
//
// Nothing gains anything, which is the direction that matters.

import { ARCHETYPES, archetypeFor } from './archetypes.js';

// NOT agencyBranchOf. That walks the parent chain to a branch root and
// is too coarse here in both directions, which I found by writing the
// table against it and checking:
//
//   Søværnet, Hæren and Flyvevåbnet all resolve to 'forsvaret', so a
//   kinetic rule keyed on it would have given the Navy a fighter
//   scramble. That is the precise bug this file exists to prevent, and
//   it very nearly shipped inside the fix for it.
//
//   Kommuner, municipal fire brigades, hospitals and NATO commands all
//   resolve to 'standalone', which is four unrelated kinds of agency in
//   one bucket.
//
// The id prefix is the honest discriminator: it is how the roles are
// actually organised, and it distinguishes exactly the groups the draft
// distinguishes.
function familyOf(roleId) {
  return String(roleId || '').split('-')[0];
}

// Archetypes currently served by this table. Everything else falls
// through to the ladder. Move one at a time and let the diff be the
// review.
export const MIGRATED = new Set([
  ARCHETYPES.LIAISON,
  ARCHETYPES.COORD,
  ARCHETYPES.INTEL,
  ARCHETYPES.FORENSIC,
  ARCHETYPES.REGULATORY,
  ARCHETYPES.MEDICAL,
  ARCHETYPES.PUBLIC,
  ARCHETYPES.KINETIC,
]);

// Capability actions by archetype, then by agency family where the
// families genuinely differ. `_` is the default for that archetype.
//
// An empty array is a DECISION, not an omission: it says this kind of
// agency informs and coordinates and commands nothing on the ground.
const TABLE = {
  // Inform and coordinate across a border. Commands nothing on Danish
  // soil, so a physical button here would be the same lie the patrol
  // button was.
  [ARCHETYPES.LIAISON]: { _: [] },

  // Splits five ways. See the header.
  [ARCHETYPES.KINETIC]: {
    politi: ['deploy-patrol', 'set-cordon', 'request-aks'],
    rigspoliti: ['deploy-patrol', 'set-cordon', 'request-aks'],
    // Supports, does not lead. Nothing airborne, nothing armed-response.
    hjv: ['hjv-reinforce'],
    // Airborne intercept from the QRA bases only. Transport and support
    // stations are air force and hold no intercept role, so the station
    // list is narrowed at the call site, not here.
    flv: ['qra-dispatch'],
    // Counter-drone and ground reinforcement, from garrisons that have
    // the unit.
    haer: ['army-c-uas', 'army-ground'],
    // Maritime only. The site capability gate keeps it off inland sites;
    // no site declares a naval action today, so this is deliberately
    // empty until one does.
    sov: [],
    sok: [],
    _: [],
  },

  [ARCHETYPES.PUBLIC]: {
    // A municipality commands no vehicles here.
    kom: ['kom-crisis', 'kom-shelter'],
    // Municipal fire and rescue respond from their own station. They
    // have no stub action today and get one only with an inventory.
    kbr: [],
    brs: ['brs-standby', 'brs-deploy'],
    _: [],
  },

  // Convene, coordinate, relay upward. No physical dispatch.
  [ARCHETYPES.COORD]: { _: [] },

  // Hospitals prepare to receive and dispatch nothing: the region holds
  // the ambulance service. That distinction is the one the naive rewrite
  // got most wrong, and it is a branch distinction, not an archetype one.
  [ARCHETYPES.MEDICAL]: {
    region: ['region-ambulance-standby', 'region-triage-prep'],
    // Medical coordination centres dispatch ambulances; that is their
    // function. Hospitals do not, and fall through to the empty default.
    amk: ['region-ambulance-standby', 'region-triage-prep'],
    _: [],
  },

  [ARCHETYPES.INTEL]: { _: ['intel-log'] },
  [ARCHETYPES.FORENSIC]: { _: [] },
  [ARCHETYPES.REGULATORY]: {
    _: ['issue-notam', 'restrict-airspace', 'issue-maritime-advisory'],
  },
};

/**
 * The capability actions this role can be offered, before the site gate
 * and before the physical-inventory filter.
 *
 * Returns null when the role's archetype has not been migrated, which
 * tells the caller to fall through to the ladder.
 */
export function capabilityActionsFor(role) {
  if (!role?.id) return null;
  // archetypeFor(id), NOT role.archetype.
  //
  // role.archetype is STAMPED ONTO the role objects by assignArchetypes()
  // at app boot. Reading the stamp makes this function depend on that
  // mutation having already happened, and it had not in the build gate,
  // which imports the data modules directly. So the whole table was inert
  // under test and live in the browser: the gate passed green while the
  // app did something else, which is the exact failure a gate exists to
  // prevent. Resolving the archetype from the id has no such ordering.
  // .primary, because archetypeFor returns { primary, secondary }. Taking
  // the object itself made every Set lookup miss, so the table was inert
  // for a second reason after the stamping one was fixed, and the "diff
  // of zero" that supposedly proved liaison migrated was measuring
  // nothing at all. Both failures looked identical from outside: a green
  // gate.
  const archetype = archetypeFor(role.id)?.primary;
  if (!archetype || !MIGRATED.has(archetype)) return null;
  const byBranch = TABLE[archetype];
  if (!byBranch) return null;
  const family = familyOf(role.id);
  return byBranch[family] ?? byBranch._ ?? [];
}

/** Whether this role's capability comes from the table rather than the ladder. */
export function isMigrated(role) {
  if (!role?.id) return false;
  const archetype = archetypeFor(role.id)?.primary;
  return !!archetype && MIGRATED.has(archetype);
}
