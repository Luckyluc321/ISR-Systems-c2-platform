// ═══════════════════════════════════════════════════════════════════
// Action Archetypes — canonical taxonomy for receiver profiles + actions
// ───────────────────────────────────────────────────────────────────
// Every receiver in RECEIVERS gets tagged with a primary archetype
// (and optional secondaries). Every action a receiver takes on an
// event (dispatch, advisory, alert, cascade) gets classified by
// archetype so contributor chapters in the Post-Incident Report can
// render one sub-section per archetype the contributor actually
// populated.
//
// Design contract in scratchpad/recipient-report-shapes.html and
// docs/cross-agency-flows.md Section 7. Foundation memory:
// project_receiver_archetype_taxonomy.md.
//
// Assignment is rule-based (prefix over role id) so all 386 registered
// receivers pick up their archetype at boot without hand-editing each
// entry. New roles auto-inherit via prefix match; hand-overrides
// supported via the OVERRIDES map when the rule doesn't fit.
// ═══════════════════════════════════════════════════════════════════

export const ARCHETYPES = {
  KINETIC:     'kinetic-response',
  COORD:       'coordination-command',
  INTEL:       'intelligence-attribution',
  FORENSIC:    'forensic-cyber',
  MEDICAL:     'medical-consequence',
  REGULATORY:  'regulatory-advisory',
  PUBLIC:      'public-safety-communication',
  LIAISON:     'international-liaison',
};

// Human-facing labels for chapter headers, picker groupings, and
// audit UI. Kept in one place so a rename is atomic.
export const ARCHETYPE_LABELS = {
  [ARCHETYPES.KINETIC]:    'Kinetic response',
  [ARCHETYPES.COORD]:      'Coordination and command',
  [ARCHETYPES.INTEL]:      'Intelligence and attribution',
  [ARCHETYPES.FORENSIC]:   'Forensic and cyber',
  [ARCHETYPES.MEDICAL]:    'Medical and consequence',
  [ARCHETYPES.REGULATORY]: 'Regulatory and advisory',
  [ARCHETYPES.PUBLIC]:     'Public safety and communication',
  [ARCHETYPES.LIAISON]:    'International liaison',
};

// Rule table. Each rule matches a role id via prefix or exact string
// and yields a primary archetype + optional secondaries. Order
// matters — more specific rules first (e.g. politi-aks before
// politi-*). First match wins.
const RULES = [
  // Politi — specialty units first, then districts
  { match: exact('politi-aks'),      primary: ARCHETYPES.KINETIC,   secondary: [] },
  { match: exact('politi-nsk'),      primary: ARCHETYPES.INTEL,     secondary: [ARCHETYPES.KINETIC] },
  { match: exact('rigspoliti'),      primary: ARCHETYPES.COORD,     secondary: [ARCHETYPES.INTEL] },
  { match: prefix('politi-'),        primary: ARCHETYPES.KINETIC,   secondary: [ARCHETYPES.COORD, ARCHETYPES.PUBLIC] },

  // Forsvaret branches
  { match: exact('forsvar-cyber'),   primary: ARCHETYPES.FORENSIC,  secondary: [ARCHETYPES.INTEL] },
  { match: exact('forsvarskmd'),     primary: ARCHETYPES.COORD,     secondary: [] },
  { match: prefix('flv-'),           primary: ARCHETYPES.KINETIC,   secondary: [] },  // Air Force
  { match: prefix('haer-'),          primary: ARCHETYPES.KINETIC,   secondary: [] },  // Army
  { match: prefix('sov-'),           primary: ARCHETYPES.KINETIC,   secondary: [] },  // Navy
  { match: prefix('sok-'),           primary: ARCHETYPES.KINETIC,   secondary: [ARCHETYPES.INTEL] },  // Special Operations

  // Intelligence services
  { match: exact('pet'),             primary: ARCHETYPES.INTEL,     secondary: [] },
  { match: prefix('pet-'),           primary: ARCHETYPES.INTEL,     secondary: [] },
  { match: exact('fe'),              primary: ARCHETYPES.INTEL,     secondary: [ARCHETYPES.FORENSIC] },
  { match: exact('agency-cfcs'),     primary: ARCHETYPES.INTEL,     secondary: [ARCHETYPES.FORENSIC] },

  // Beredskabsstyrelsen — specialists first, then regional centres
  { match: exact('brs-kemisk'),      primary: ARCHETYPES.KINETIC,   secondary: [ARCHETYPES.REGULATORY] },
  { match: exact('brs-nukleart'),    primary: ARCHETYPES.KINETIC,   secondary: [ARCHETYPES.REGULATORY] },
  { match: exact('beredskab'),       primary: ARCHETYPES.COORD,     secondary: [] },
  { match: prefix('brs-'),           primary: ARCHETYPES.KINETIC,   secondary: [ARCHETYPES.PUBLIC] },

  // Hjemmeværnet
  { match: prefix('hjv-'),           primary: ARCHETYPES.KINETIC,   secondary: [ARCHETYPES.PUBLIC] },
  { match: exact('hjv'),             primary: ARCHETYPES.COORD,     secondary: [] },  // parent tile

  // Medical
  { match: prefix('region-'),        primary: ARCHETYPES.MEDICAL,   secondary: [ARCHETYPES.COORD] },
  { match: prefix('hospital-'),      primary: ARCHETYPES.MEDICAL,   secondary: [] },
  { match: exact('min-sund'),        primary: ARCHETYPES.MEDICAL,   secondary: [ARCHETYPES.REGULATORY] },

  // Ministries (coord role)
  { match: prefix('min-'),           primary: ARCHETYPES.COORD,     secondary: [] },

  // Regulatory agencies
  { match: exact('agency-traf'),     primary: ARCHETYPES.REGULATORY, secondary: [] },
  { match: exact('agency-sof'),      primary: ARCHETYPES.REGULATORY, secondary: [ARCHETYPES.COORD] },
  { match: exact('agency-ener'),     primary: ARCHETYPES.REGULATORY, secondary: [] },
  { match: prefix('agency-'),        primary: ARCHETYPES.COORD,     secondary: [] },  // fallback for unlisted agencies

  // Kommuner (98) — public safety + crisis staff coordination
  { match: prefix('kom-'),           primary: ARCHETYPES.PUBLIC,    secondary: [ARCHETYPES.COORD] },

  // International — NATO / Nordic / allied
  // Specific NATO units get bespoke secondary tags per their function
  { match: exact('nato-marcom'),         primary: ARCHETYPES.LIAISON, secondary: [ARCHETYPES.KINETIC] },
  { match: exact('nato-caoc-uedem'),     primary: ARCHETYPES.LIAISON, secondary: [ARCHETYPES.KINETIC] },
  { match: exact('nato-natinamds'),      primary: ARCHETYPES.LIAISON, secondary: [ARCHETYPES.KINETIC] },
  { match: exact('nato-ccdcoe'),         primary: ARCHETYPES.LIAISON, secondary: [ARCHETYPES.FORENSIC] },
  { match: exact('nato-ncsc'),           primary: ARCHETYPES.LIAISON, secondary: [ARCHETYPES.FORENSIC] },
  { match: prefix('nato-'),              primary: ARCHETYPES.LIAISON, secondary: [ARCHETYPES.COORD] },
  { match: prefix('nordic-'),            primary: ARCHETYPES.LIAISON, secondary: [ARCHETYPES.COORD] },
  { match: prefix('allied-'),            primary: ARCHETYPES.LIAISON, secondary: [] },
  { match: prefix('other-'),             primary: ARCHETYPES.LIAISON, secondary: [] },

  // Parent tile roles (browse pivots, no direct actions of their own)
  // Tagged with COORD so their chapter would show coordination
  // sub-section if they were ever escalated to directly. Concrete
  // sub-branches carry the real archetype.
  { match: exact('forsvaret'),           primary: ARCHETYPES.COORD, secondary: [] },
  { match: exact('flyvevaabnet'),        primary: ARCHETYPES.KINETIC, secondary: [] },
  { match: exact('haeren'),              primary: ARCHETYPES.KINETIC, secondary: [] },
  { match: exact('sovaernet'),           primary: ARCHETYPES.KINETIC, secondary: [] },
  { match: exact('sok'),                 primary: ARCHETYPES.KINETIC, secondary: [ARCHETYPES.INTEL] },
  { match: exact('politi'),              primary: ARCHETYPES.KINETIC, secondary: [ARCHETYPES.COORD] },
  { match: exact('brs'),                 primary: ARCHETYPES.KINETIC, secondary: [ARCHETYPES.PUBLIC] },
];

function exact(id)     { return (roleId) => roleId === id; }
function prefix(pref)  { return (roleId) => roleId.startsWith(pref); }

// Per-role hand overrides. Empty today — every registered role fits
// a rule above. Populate when a role doesn't match cleanly (e.g. a
// customer plugs in a role id that doesn't follow our prefix
// convention).
const OVERRIDES = {
  // 'some-weird-role-id': { primary: ARCHETYPES.KINETIC, secondary: [] },
};

// Return the archetype spec for a role. Overrides first, then rules.
// Falls back to COORD with empty secondaries when no rule matches
// (defensive — every registered role should hit a rule, but a new
// role added later should still get a usable default rather than
// crashing the render).
export function archetypeFor(roleId) {
  if (OVERRIDES[roleId]) return OVERRIDES[roleId];
  for (const rule of RULES) {
    if (rule.match(roleId)) {
      return { primary: rule.primary, secondary: rule.secondary || [] };
    }
  }
  return { primary: ARCHETYPES.COORD, secondary: [] };
}

// Mutates the RECEIVERS array in place, stamping .archetype (primary)
// and .secondaryArchetypes (array) on every entry. Called once at
// boot from main.js after the RECEIVERS import.
export function assignArchetypes(receivers) {
  if (!Array.isArray(receivers)) return 0;
  let tagged = 0;
  for (const role of receivers) {
    if (!role || !role.id) continue;
    const spec = archetypeFor(role.id);
    role.archetype = spec.primary;
    role.secondaryArchetypes = spec.secondary;
    tagged++;
  }
  return tagged;
}

// Map from CD_PROFILE dispatch kind → archetype. Consumed by
// _spawnDispatchInstance to stamp .archetype on every dispatch record
// so contributor chapters can slot dispatches into the right
// sub-section without re-deriving. Kinetic covers nearly everything;
// receiver-cyber-team is the notable exception (Forensic archetype
// even though it's dispatched via the counter-response engine).
export const DISPATCH_KIND_ARCHETYPES = {
  // Operator + national pool
  'helicopter-intercept':    ARCHETYPES.KINETIC,
  'army-c-uas':              ARCHETYPES.KINETIC,
  'police-c-uas':            ARCHETYPES.KINETIC,
  'army-isr-drone':          ARCHETYPES.KINETIC,
  'sof-tactical':            ARCHETYPES.KINETIC,
  'wildlife-response':       ARCHETYPES.KINETIC,
  'counter-drone-swarm':     ARCHETYPES.KINETIC,

  // Receiver assets
  'receiver-patrol-car':     ARCHETYPES.KINETIC,
  'receiver-k9-unit':        ARCHETYPES.KINETIC,
  'receiver-cordon-squad':   ARCHETYPES.KINETIC,
  'receiver-forensic-van':   ARCHETYPES.FORENSIC,
  'receiver-tactical-van':   ARCHETYPES.KINETIC,
  'receiver-strike-team':    ARCHETYPES.KINETIC,
  'receiver-coord-cell':     ARCHETYPES.COORD,
  'receiver-cyber-team':     ARCHETYPES.FORENSIC,
};

export function archetypeForDispatchKind(kind) {
  return DISPATCH_KIND_ARCHETYPES[kind] || ARCHETYPES.KINETIC;
}
