// Account model: three strictly isolated tenant types.
//   ADMIN     — ISR internal. Full platform, provisions everything, assigns
//               sites/flows to operator and receiver accounts. This is us.
//   OPERATOR  — Site owner (utility, port, grid, data centre, hospital).
//               SaaS + HaaS. Owns 1..n sites, sees only their sites.
//   RECEIVER  — Government agency (Politi, PET, Forsvaret, Beredskab).
//               SaaS only. Sees only briefs escalated to them.
//
// Isolation is enforced at the query layer, never the UI. In prod this is
// wired to auth + tenant scoping. In demo it lives here for flow testing.

export const ADMIN = {
  id: 'admin-isr',
  kind: 'admin',
  org: 'ISR Systems',
  label: 'Admin — ISR Systems',
  person: 'L. Flindt',
  initials: 'IS',
  logo: '/isr-logo.png',
  scope: 'all-sites',
  destinationIds: [],
  description: 'Full platform. Provision sites, sensors, receivers, rules. Assign to Operator and Receiver accounts.',
};

// ── Operator accounts (site owners) ────────────────────────────
// Each operator owns a subset of sites in SITES (src/sites.js).
// Multi-site operators own 2+ site IDs. Single-site operators own 1.

export const OPERATORS = [
  {
    id: 'op-cph-airports',
    kind: 'operator',
    org: 'CPH Airports A/S',
    label: 'CPH Airports A/S',
    person: 'M. Sørensen',
    initials: 'CA',
    logo: '/logos/cph.svg',
    scope: 'assigned-sites',
    destinationIds: [],
    siteIds: ['cph'],
    sensorCount: 22,
    isMultiSite: false,
    sector: 'Aviation',
    description: 'Copenhagen Airport. National aviation gateway.',
    brandTint: '#4dd2ff',
  },
  {
    id: 'op-esbjerg-port',
    kind: 'operator',
    org: 'Port of Esbjerg',
    label: 'Port of Esbjerg',
    person: 'A. Jensen',
    initials: 'PE',
    logo: '/logos/esbjerg.svg',
    scope: 'assigned-sites',
    destinationIds: [],
    siteIds: ['esbjerg'],
    sensorCount: 18,
    isMultiSite: false,
    sector: 'Maritime',
    description: 'Esbjerg Harbour. Offshore wind logistics + military port.',
    brandTint: '#ffb84d',
  },
  {
    id: 'op-energinet',
    kind: 'operator',
    org: 'Energinet',
    label: 'Energinet',
    person: 'K. Andersen',
    initials: 'EN',
    logo: '/logos/energinet.svg',
    scope: 'assigned-sites',
    destinationIds: [],
    siteIds: ['energinet_hovegaard', 'energinet_bjaeverskov', 'energinet_landerupgaard', 'energinet_kassoe', 'energinet_ferslev'],
    sensorCount: 35,
    isMultiSite: true,
    sector: 'Energy (TSO)',
    description: 'National transmission system operator. 5 substations under sensor coverage, HVDC interconnectors + 400 kV backbone.',
    brandTint: '#4dff9c',
  },
];

// ── Receiver accounts (government agencies) ────────────────────
// Real Danish agencies. Filtered by destinationIds — see only briefs
// escalated to their configured destinations.

// P92: Hierarchical receiver structure.
//   type = 'parent' → landing page shows tiles of children, no direct inbox
//   type = 'leaf'   → normal receiver inbox with escalations + dispatch
// A parent aggregates its children's destinationIds for a roll-up "all
// under my command" view when the operator wants it, but the primary flow
// is: login as parent → pick child to drill into.
// Existing flat leaf receivers keep the same id + destinationIds so nothing
// in destinations.js or event routing changes. New sub-base leaves get their
// own ids + inherit their parent's destinations (Slagelse sees all military
// t4 escalations; Slagelse-specific dispatch scope kicks in per P90 mapping).

export const RECEIVERS = [
  // ── Intelligence (standalone leaves) ────────────────────────────
  {
    id: 'pet', kind: 'receiver', type: 'leaf',
    org: 'PET', label: 'PET — Politiets Efterretningstjeneste',
    person: 'K. Larsen', initials: 'KL',
    scope: 'all-sites', destinationIds: ['cph-t2-pet', 'esb-t2-pet', 'hvg-t2-pet', 'bjk-t2-pet', 'ldg-t2-pet', 'kas-t2-pet', 'frv-t2-pet'],
    description: 'National security service. Tier 2 escalation, national scope.',
  },
  {
    id: 'fe', kind: 'receiver', type: 'leaf',
    org: 'FE', label: 'Forsvarets Efterretningstjeneste',
    person: 'A. Sørensen', initials: 'AS',
    scope: 'all-sites', destinationIds: ['cph-t3-fe', 'esb-t3-fe', 'hvg-t3-fe', 'bjk-t3-fe', 'ldg-t3-fe', 'kas-t3-fe', 'frv-t3-fe'],
    description: 'Defence intelligence service.',
  },

  // ── Emergency + Command (standalone leaves) ─────────────────────
  {
    id: 'beredskab', kind: 'receiver', type: 'leaf',
    org: 'Beredskabsstyrelsen', label: 'Beredskabsstyrelsen',
    person: 'H. Christensen', initials: 'HC',
    scope: 'all-sites', destinationIds: ['cph-t3-beredskab', 'esb-t3-beredskab', 'hvg-t3-beredskab', 'bjk-t3-beredskab', 'ldg-t3-beredskab', 'kas-t3-beredskab', 'frv-t3-beredskab'],
    description: 'National emergency management.',
  },
  {
    id: 'forsvarskmd', kind: 'receiver', type: 'leaf',
    org: 'Forsvarskommandoen', label: 'Forsvarskommandoen',
    person: 'P. Møller', initials: 'PM',
    scope: 'all-sites', destinationIds: ['cph-t4-forsvar', 'esb-t4-forsvar', 'hvg-t4-forsvar', 'bjk-t4-forsvar', 'ldg-t4-forsvar', 'kas-t4-forsvar', 'frv-t4-forsvar'],
    description: 'Defence command HQ. Tier 4 national coordination.',
  },

  // ══════════════════════════════════════════════════════════════
  // FORSVARET (parent) — Danish Defence
  // ══════════════════════════════════════════════════════════════
  {
    id: 'forsvaret', kind: 'receiver', type: 'parent',
    org: 'Forsvaret', label: 'Forsvaret — Danish Defence',
    initials: 'FO',
    scope: 'all-sites',
    childrenIds: ['flyvevaabnet', 'haeren', 'sovaernet', 'sok'],
    description: 'Danish Defence umbrella. Select a branch to drill in.',
  },

  // ── Flyvevåbnet (branch parent) ─────────────────────────────────
  {
    id: 'flyvevaabnet', kind: 'receiver', type: 'parent',
    parentId: 'forsvaret',
    org: 'Flyvevåbnet', label: 'Flyvevåbnet — Danish Air Force',
    initials: 'FV', scope: 'aviation',
    childrenIds: ['flv-skrydstrup', 'flv-karup'],
    description: 'Danish Air Force branch. Select a base to drill in.',
  },
  {
    id: 'flv-skrydstrup', kind: 'receiver', type: 'leaf',
    parentId: 'flyvevaabnet',
    org: 'Flyvevåbnet · Skrydstrup', label: 'Fighter Wing Skrydstrup (F-35 QRA)',
    person: 'T. Andersen', initials: 'TA',
    scope: 'aviation', destinationIds: ['cph-t4-qra', 'esb-t4-qra', 'hvg-t4-qra', 'bjk-t4-qra', 'ldg-t4-qra', 'kas-t4-qra', 'frv-t4-qra'],
    description: 'Fighter Wing Skrydstrup. F-35 QRA. National airborne intercept.',
  },
  {
    id: 'flv-karup', kind: 'receiver', type: 'leaf',
    parentId: 'flyvevaabnet',
    org: 'Flyvevåbnet · Karup', label: 'Helicopter Wing Karup',
    person: 'B. Rasmussen', initials: 'BR',
    scope: 'all-sites', destinationIds: ['cph-t4-qra', 'esb-t4-qra', 'hvg-t4-qra', 'bjk-t4-qra', 'ldg-t4-qra', 'kas-t4-qra', 'frv-t4-qra'],
    description: 'Helicopter Wing Karup. EH-101 Merlin + AS550 Fennec tactical intercept.',
  },

  // ── Hæren (branch parent) — Danish Army ─────────────────────────
  {
    id: 'haeren', kind: 'receiver', type: 'parent',
    parentId: 'forsvaret',
    org: 'Hæren', label: 'Hæren — Danish Army',
    initials: 'HA', scope: 'all-sites',
    childrenIds: ['haer-slagelse', 'haer-hovelte', 'haer-varde', 'haer-bornholm', 'haer-oksbol'],
    description: 'Danish Army branch. Select a garrison to drill in.',
  },
  {
    id: 'haer-slagelse', kind: 'receiver', type: 'leaf',
    parentId: 'haeren',
    org: 'Hæren · Slagelse', label: 'Gardehusarregimentet (Slagelse)',
    person: 'C. Kristensen', initials: 'CK',
    scope: 'all-sites', destinationIds: ['cph-t4-forsvar', 'esb-t4-forsvar', 'hvg-t4-forsvar', 'bjk-t4-forsvar', 'ldg-t4-forsvar', 'kas-t4-forsvar', 'frv-t4-forsvar'],
    description: 'Gardehusarregimentet garrison, Slagelse. Own ISR drones + C-UAS team.',
  },
  {
    id: 'haer-hovelte', kind: 'receiver', type: 'leaf',
    parentId: 'haeren',
    org: 'Hæren · Høvelte', label: 'Livgarden (Høvelte)',
    person: 'M. Petersen', initials: 'MP',
    scope: 'all-sites', destinationIds: ['cph-t4-forsvar', 'esb-t4-forsvar', 'hvg-t4-forsvar', 'bjk-t4-forsvar', 'ldg-t4-forsvar', 'kas-t4-forsvar', 'frv-t4-forsvar'],
    description: 'Livgarden garrison, Høvelte. Rapid ground reinforcement, north Zealand.',
  },
  {
    id: 'haer-varde', kind: 'receiver', type: 'leaf',
    parentId: 'haeren',
    org: 'Hæren · Varde', label: 'Efterretningsregimentet (Varde)',
    person: 'N. Jørgensen', initials: 'NJ',
    scope: 'all-sites', destinationIds: ['cph-t4-forsvar', 'esb-t4-forsvar', 'hvg-t4-forsvar', 'bjk-t4-forsvar', 'ldg-t4-forsvar', 'kas-t4-forsvar', 'frv-t4-forsvar'],
    description: 'Efterretningsregimentet garrison, Varde. ISR + electronic warfare + RF C-UAS.',
  },
  {
    id: 'haer-bornholm', kind: 'receiver', type: 'leaf',
    parentId: 'haeren',
    org: 'Hæren · Bornholm', label: 'Bornholms Værn (Almegård)',
    person: 'L. Madsen', initials: 'LM',
    scope: 'all-sites', destinationIds: ['cph-t4-forsvar', 'esb-t4-forsvar', 'hvg-t4-forsvar', 'bjk-t4-forsvar', 'ldg-t4-forsvar', 'kas-t4-forsvar', 'frv-t4-forsvar'],
    description: 'Bornholms Værn, Almegård Kaserne. Baltic strategic position, air defence radar.',
  },
  {
    id: 'haer-oksbol', kind: 'receiver', type: 'leaf',
    parentId: 'haeren',
    org: 'Hæren · Oksbøl', label: 'Hærens Kampskole (Oksbøl)',
    person: 'F. Thomsen', initials: 'FT',
    scope: 'all-sites', destinationIds: ['cph-t4-forsvar', 'esb-t4-forsvar', 'hvg-t4-forsvar', 'bjk-t4-forsvar', 'ldg-t4-forsvar', 'kas-t4-forsvar', 'frv-t4-forsvar'],
    description: 'Hærens Kampskole, Oksbøl. Training doctrine + reserve C-UAS instructor cadre.',
  },

  // ── Søværnet (branch parent) — Danish Navy ──────────────────────
  {
    id: 'sovaernet', kind: 'receiver', type: 'parent',
    parentId: 'forsvaret',
    org: 'Søværnet', label: 'Søværnet — Danish Navy',
    initials: 'SO', scope: 'maritime',
    childrenIds: ['sov-frederikshavn', 'sov-korsor'],
    description: 'Danish Navy branch. Select a base to drill in.',
  },
  {
    id: 'sov-frederikshavn', kind: 'receiver', type: 'leaf',
    parentId: 'sovaernet',
    org: 'Søværnet · Frederikshavn', label: 'Søværnet Base Frederikshavn',
    person: 'J. Olsen', initials: 'JO',
    scope: 'maritime', destinationIds: ['esb-t4-navy'],
    description: 'Søværnet operations base, Frederikshavn. Patrol vessels.',
  },
  {
    id: 'sov-korsor', kind: 'receiver', type: 'leaf',
    parentId: 'sovaernet',
    org: 'Søværnet · Korsør', label: 'Søværnet Base Korsør',
    person: 'D. Iversen', initials: 'DI',
    scope: 'maritime', destinationIds: ['esb-t4-navy'],
    description: 'Søværnet base Korsør. Belt-crossing patrol.',
  },

  // ── SOK (branch parent) — Special Operations ────────────────────
  {
    id: 'sok', kind: 'receiver', type: 'parent',
    parentId: 'forsvaret',
    org: 'SOK', label: 'SOK — Special Operations Command',
    initials: 'SK', scope: 'all-sites',
    childrenIds: ['sok-aalborg'],
    description: 'Special Operations Command. Select a unit to drill in.',
  },
  {
    id: 'sok-aalborg', kind: 'receiver', type: 'leaf',
    parentId: 'sok',
    org: 'SOK · Jægerkorpset', label: 'Jægerkorpset (Aalborg)',
    person: 'V. Holm', initials: 'VH',
    scope: 'all-sites', destinationIds: ['cph-t4-forsvar', 'esb-t4-forsvar', 'hvg-t4-forsvar', 'bjk-t4-forsvar', 'ldg-t4-forsvar', 'kas-t4-forsvar', 'frv-t4-forsvar'],
    description: 'Jægerkorpset SOF, Aalborg. Loitering-munition interdiction + tactical response.',
  },

  // ══════════════════════════════════════════════════════════════
  // POLITI (parent) — Danish Police
  // ══════════════════════════════════════════════════════════════
  {
    id: 'politi', kind: 'receiver', type: 'parent',
    org: 'Politi', label: 'Politi — Danish Police',
    initials: 'PO', scope: 'all-sites',
    childrenIds: ['rigspoliti', 'politi-kbh', 'politi-sydvest'],
    description: 'Danish Police umbrella. Select national HQ or a district.',
  },
  {
    id: 'rigspoliti', kind: 'receiver', type: 'leaf',
    parentId: 'politi',
    org: 'Rigspolitiet', label: 'Rigspolitiet — National Police HQ',
    person: 'M. Nielsen', initials: 'MN',
    scope: 'all-sites', destinationIds: ['cph-t3-rigspoliti', 'esb-t3-rigspoliti', 'hvg-t3-rigspoliti', 'bjk-t3-rigspoliti', 'ldg-t3-rigspoliti', 'kas-t3-rigspoliti', 'frv-t3-rigspoliti'],
    description: 'National police coordination + C-UAS response team.',
  },
  {
    id: 'politi-kbh', kind: 'receiver', type: 'leaf',
    parentId: 'politi',
    org: 'Politi København', label: 'Politi København',
    person: 'S. Hansen', initials: 'SH',
    scope: 'cph-only', destinationIds: ['cph-t2-politi'],
    description: 'Copenhagen district. Local C-UAS patrol.',
  },
  {
    id: 'politi-sydvest', kind: 'receiver', type: 'leaf',
    parentId: 'politi',
    org: 'Politi Sydvestjylland', label: 'Politi Sydvestjylland',
    person: 'R. Poulsen', initials: 'RP',
    scope: 'esbjerg-only', destinationIds: ['esb-t2-politi'],
    description: 'Sydvestjylland district. Esbjerg C-UAS patrol.',
  },
];

// Compatibility shim: the old flat 'flv-qra' id no longer exists as a
// direct role. Anywhere that looked up flv-qra should now look up
// flv-skrydstrup. Keep this alias so legacy code paths don't crash.
export const ROLE_ID_ALIAS = { 'flv-qra': 'flv-skrydstrup', 'sov': 'sov-frederikshavn' };

// Helper: get a role's leaf children (recursive for future 3+ level nests).
export function getRoleChildren(roleId) {
  const role = RECEIVERS.find(r => r.id === roleId);
  if (!role || !role.childrenIds) return [];
  return role.childrenIds.map(cid => RECEIVERS.find(r => r.id === cid)).filter(Boolean);
}

// Aggregated destinationIds for a parent role (union across all leaf
// descendants). Used when a parent needs a roll-up "everything under
// my command" view.
export function getRoleDestinationIdsRolledUp(roleId) {
  const role = RECEIVERS.find(r => r.id === roleId);
  if (!role) return [];
  if (role.type === 'leaf' || !role.childrenIds) return role.destinationIds || [];
  const out = new Set();
  role.childrenIds.forEach(cid => {
    getRoleDestinationIdsRolledUp(cid).forEach(d => out.add(d));
  });
  return [...out];
}

// Combined lookup list. Order matters for menu rendering: admin first,
// then operators, then receivers.
export const ACCOUNTS = [ADMIN, ...OPERATORS, ...RECEIVERS];

// Backward-compat alias for older imports that reference ROLES.
export const ROLES = ACCOUNTS;

// ── Active account state ───────────────────────────────────────
// Default = admin (ISR internal), which matches the current
// "see everything" view. Switch via the account switcher UI.

let _activeId = 'admin-isr';
const _listeners = new Set();

export function getActiveRole() {
  return ACCOUNTS.find(a => a.id === _activeId) || ADMIN;
}
export function setActiveRole(id) {
  if (!ACCOUNTS.find(a => a.id === id)) return;
  _activeId = id;
  _listeners.forEach(fn => fn(_activeId));
}
export function onRoleChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
export function receiverRoles() { return RECEIVERS; }
export function operatorRoles() { return OPERATORS; }
