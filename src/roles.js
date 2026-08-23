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

  // ── Politikredse (remaining 10 of Denmark's 12) ─────────────────
  // Publicly stable list from politi.dk. Empty destinationIds until
  // sites explicitly declare these districts in their receivers block.
  {
    id: 'politi-vestegn', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Vestegnens Politi', label: 'Vestegnens Politi', initials: 'VP',
    scope: 'regional', destinationIds: [],
    description: 'Vestegn district. Covers western Copenhagen + Amager. Includes CPH airport jurisdiction.',
  },
  {
    id: 'politi-nordsj', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Nordsjællands Politi', label: 'Nordsjællands Politi', initials: 'NP',
    scope: 'regional', destinationIds: [],
    description: 'North Zealand district. Covers Helsingør, Hillerød, Fredensborg.',
  },
  {
    id: 'politi-midtvestsjaelland', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Midt- og Vestsjællands Politi', label: 'Midt- og Vestsjællands Politi', initials: 'MV',
    scope: 'regional', destinationIds: [],
    description: 'Central + West Zealand district. Covers Roskilde, Holbæk, Kalundborg.',
  },
  {
    id: 'politi-sydsjaelland', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Sydsjællands og Lolland-Falsters Politi', label: 'Sydsjællands og Lolland-Falsters Politi', initials: 'SL',
    scope: 'regional', destinationIds: [],
    description: 'South Zealand + Lolland-Falster district.',
  },
  {
    id: 'politi-fyn', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Fyns Politi', label: 'Fyns Politi', initials: 'FP',
    scope: 'regional', destinationIds: [],
    description: 'Funen district. Covers Odense + Svendborg.',
  },
  {
    id: 'politi-sydsonderjyl', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Syd- og Sønderjyllands Politi', label: 'Syd- og Sønderjyllands Politi', initials: 'SS',
    scope: 'regional', destinationIds: [],
    description: 'South + South Jutland district. Covers Esbjerg, Kolding, Haderslev.',
  },
  {
    id: 'politi-sydostjyl', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Sydøstjyllands Politi', label: 'Sydøstjyllands Politi', initials: 'SØ',
    scope: 'regional', destinationIds: [],
    description: 'Southeast Jutland district. Covers Vejle, Horsens, Fredericia (Landerupgård).',
  },
  {
    id: 'politi-midtvestjyl', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Midt- og Vestjyllands Politi', label: 'Midt- og Vestjyllands Politi', initials: 'MJ',
    scope: 'regional', destinationIds: [],
    description: 'Central + West Jutland district. Covers Herning, Holstebro, Viborg.',
  },
  {
    id: 'politi-ostjyl', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Østjyllands Politi', label: 'Østjyllands Politi', initials: 'ØJ',
    scope: 'regional', destinationIds: [],
    description: 'East Jutland district. Covers Aarhus, Silkeborg, Randers.',
  },
  {
    id: 'politi-nordjyl', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Nordjyllands Politi', label: 'Nordjyllands Politi', initials: 'NJ',
    scope: 'regional', destinationIds: [],
    description: 'North Jutland district. Covers Aalborg, Frederikshavn, Hjørring.',
  },
  {
    id: 'politi-bornholm', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'Bornholms Politi', label: 'Bornholms Politi', initials: 'BP',
    scope: 'regional', destinationIds: [],
    description: 'Bornholm district. Baltic strategic position.',
  },

  // ── Politi specialty units ──────────────────────────────────────
  {
    id: 'politi-nsk', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'NSK', label: 'NSK — Nationalt Særligt Kriminalpoliti', initials: 'NS',
    scope: 'all-sites', destinationIds: [],
    description: 'National organised-crime + state-actor investigative unit.',
  },
  {
    id: 'politi-aks', kind: 'receiver', type: 'leaf', parentId: 'politi',
    org: 'AKS', label: 'AKS — Aktionsstyrken', initials: 'AK',
    scope: 'all-sites', destinationIds: [],
    description: 'Danish police tactical intervention unit. Armed hostage / active shooter response.',
  },

  // ══════════════════════════════════════════════════════════════
  // BEREDSKABSSTYRELSEN — expand from single 'beredskab' node into
  // HQ + 5 beredskabscentre + specialty units. The existing
  // 'beredskab' role is aliased to 'brs-hq' below for backwards-compat.
  // ══════════════════════════════════════════════════════════════
  {
    id: 'brs', kind: 'receiver', type: 'parent',
    org: 'Beredskabsstyrelsen', label: 'Beredskabsstyrelsen — Danish Emergency Mgmt',
    initials: 'BR', scope: 'all-sites',
    childrenIds: ['brs-hedehusene', 'brs-herning', 'brs-haderslev', 'brs-allinge', 'brs-thisted', 'brs-kemisk', 'brs-nukleart'],
    description: 'BRS umbrella. National + 5 centre + specialist units.',
  },
  {
    id: 'brs-hedehusene', kind: 'receiver', type: 'leaf', parentId: 'brs',
    org: 'BRS Hedehusene', label: 'Beredskabscenter Hedehusene', initials: 'BH',
    scope: 'regional', destinationIds: [],
    description: 'BRS national CBRN + rescue centre, Hedehusene (Sjælland).',
  },
  {
    id: 'brs-herning', kind: 'receiver', type: 'leaf', parentId: 'brs',
    org: 'BRS Herning', label: 'Beredskabscenter Herning', initials: 'BE',
    scope: 'regional', destinationIds: [],
    description: 'BRS centre, Herning (Midtjylland).',
  },
  {
    id: 'brs-haderslev', kind: 'receiver', type: 'leaf', parentId: 'brs',
    org: 'BRS Haderslev', label: 'Beredskabscenter Haderslev', initials: 'BD',
    scope: 'regional', destinationIds: [],
    description: 'BRS centre, Haderslev (Sønderjylland).',
  },
  {
    id: 'brs-allinge', kind: 'receiver', type: 'leaf', parentId: 'brs',
    org: 'BRS Allinge', label: 'Beredskabscenter Allinge', initials: 'BA',
    scope: 'regional', destinationIds: [],
    description: 'BRS centre, Allinge (Bornholm).',
  },
  {
    id: 'brs-thisted', kind: 'receiver', type: 'leaf', parentId: 'brs',
    org: 'BRS Thisted', label: 'Beredskabscenter Thisted', initials: 'BT',
    scope: 'regional', destinationIds: [],
    description: 'BRS centre, Thisted (Nordjylland).',
  },
  {
    id: 'brs-kemisk', kind: 'receiver', type: 'leaf', parentId: 'brs',
    org: 'BRS Kemisk Beredskab', label: 'BRS Kemisk Beredskab', initials: 'BK',
    scope: 'all-sites', destinationIds: [],
    description: 'National chemical incident response unit. Auto-observer on CBRN-flagged events.',
  },
  {
    id: 'brs-nukleart', kind: 'receiver', type: 'leaf', parentId: 'brs',
    org: 'BRS Nukleart Beredskab', label: 'BRS Nukleart Beredskab', initials: 'BN',
    scope: 'all-sites', destinationIds: [],
    description: 'National nuclear/radiological response. Auto-observer on nuclear-flagged events.',
  },

  // ══════════════════════════════════════════════════════════════
  // REGIONER (5) — regional health services + ambulance ops
  // ══════════════════════════════════════════════════════════════
  {
    id: 'region-hst', kind: 'receiver', type: 'leaf',
    org: 'Region Hovedstaden', label: 'Region Hovedstaden', initials: 'RH',
    scope: 'regional', destinationIds: [],
    description: 'Capital region. Ambulance + hospital coordination. Auto-observer on casualty-flagged events at CPH.',
  },
  {
    id: 'region-sjl', kind: 'receiver', type: 'leaf',
    org: 'Region Sjælland', label: 'Region Sjælland', initials: 'RS',
    scope: 'regional', destinationIds: [],
    description: 'Zealand region. Ambulance + hospital coordination.',
  },
  {
    id: 'region-syd', kind: 'receiver', type: 'leaf',
    org: 'Region Syddanmark', label: 'Region Syddanmark', initials: 'RY',
    scope: 'regional', destinationIds: [],
    description: 'South Denmark region. Covers Esbjerg.',
  },
  {
    id: 'region-midt', kind: 'receiver', type: 'leaf',
    org: 'Region Midtjylland', label: 'Region Midtjylland', initials: 'RM',
    scope: 'regional', destinationIds: [],
    description: 'Central Jutland region.',
  },
  {
    id: 'region-nord', kind: 'receiver', type: 'leaf',
    org: 'Region Nordjylland', label: 'Region Nordjylland', initials: 'RN',
    scope: 'regional', destinationIds: [],
    description: 'North Jutland region.',
  },

  // ══════════════════════════════════════════════════════════════
  // MINISTRIES (top-level observer nodes for command awareness)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'min-just', kind: 'receiver', type: 'leaf',
    org: 'Justitsministeriet', label: 'Justitsministeriet', initials: 'MJ',
    scope: 'national', destinationIds: [],
    description: 'Ministry of Justice. Observer on tier-3+ hostile events.',
  },
  {
    id: 'min-fors', kind: 'receiver', type: 'leaf',
    org: 'Forsvarsministeriet', label: 'Forsvarsministeriet', initials: 'MF',
    scope: 'national', destinationIds: [],
    description: 'Ministry of Defence. Observer on tier-3+ hostile events + Forsvar-branch actor escalations.',
  },
  {
    id: 'min-klim', kind: 'receiver', type: 'leaf',
    org: 'Klima-, Energi- og Forsyningsministeriet', label: 'Klima-, Energi- og Forsyningsministeriet', initials: 'MK',
    scope: 'national', destinationIds: [],
    description: 'Ministry of Climate + Energy. Observer on substation + grid-critical events.',
  },
  {
    id: 'min-erhverv', kind: 'receiver', type: 'leaf',
    org: 'Erhvervsministeriet', label: 'Erhvervsministeriet', initials: 'ME',
    scope: 'national', destinationIds: [],
    description: 'Ministry of Business. Aviation + maritime regulator umbrella.',
  },
  {
    id: 'min-sund', kind: 'receiver', type: 'leaf',
    org: 'Sundhedsministeriet', label: 'Sundhedsministeriet', initials: 'MS',
    scope: 'national', destinationIds: [],
    description: 'Ministry of Health. Observer on mass-casualty scenarios.',
  },

  // ══════════════════════════════════════════════════════════════
  // AGENCIES (styrelser)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'agency-traf', kind: 'receiver', type: 'leaf',
    org: 'Trafikstyrelsen', label: 'Trafikstyrelsen', initials: 'TS',
    scope: 'aviation', destinationIds: [],
    description: 'Aviation + rail + road regulator. Auto-actor on airport events (airspace-restriction authority).',
  },
  {
    id: 'agency-sof', kind: 'receiver', type: 'leaf',
    org: 'Søfartsstyrelsen', label: 'Søfartsstyrelsen', initials: 'SF',
    scope: 'maritime', destinationIds: [],
    description: 'Maritime regulator. Auto-actor on harbour events.',
  },
  {
    id: 'agency-ener', kind: 'receiver', type: 'leaf',
    org: 'Energistyrelsen', label: 'Energistyrelsen', initials: 'ES',
    scope: 'national', destinationIds: [],
    description: 'National energy regulator. Observer on substation events.',
  },
  {
    id: 'agency-cfcs', kind: 'receiver', type: 'leaf', parentId: 'fe',
    org: 'CFCS', label: 'CFCS — Center for Cybersikkerhed', initials: 'CC',
    scope: 'national', destinationIds: [],
    description: 'Cyber security agency under FE. Observer on all critical infrastructure events.',
  },

  // ══════════════════════════════════════════════════════════════
  // FORSVARET expansion — additional wings + special commands
  // ══════════════════════════════════════════════════════════════
  {
    id: 'flv-aalborg', kind: 'receiver', type: 'leaf', parentId: 'flyvevaabnet',
    org: 'Flyvevåbnet · Aalborg', label: 'Air Transport Wing Aalborg', initials: 'AA',
    scope: 'aviation', destinationIds: [],
    description: 'C-130J + Challenger 604 transport wing. Personnel + equipment lift.',
  },
  {
    id: 'flv-karup-control', kind: 'receiver', type: 'leaf', parentId: 'flyvevaabnet',
    org: 'Flyvevåbnet · Karup ACW', label: 'Air Control Wing Karup', initials: 'AC',
    scope: 'aviation', destinationIds: [],
    description: 'National air surveillance + control. NATO-integrated radar picture.',
  },
  {
    id: 'forsvar-cyber', kind: 'receiver', type: 'leaf', parentId: 'forsvaret',
    org: 'Cyber Kommandoen', label: 'Cyber Kommandoen (CCS)', initials: 'CY',
    scope: 'national', destinationIds: [],
    description: 'Forsvaret cyber operations command. Observer on cyber-cross events.',
  },

  // ══════════════════════════════════════════════════════════════
  // HJEMMEVÆRNET (national volunteer defence)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'hjv', kind: 'receiver', type: 'parent',
    org: 'Hjemmeværnet', label: 'Hjemmeværnet — Danish Home Guard',
    initials: 'HV', scope: 'all-sites',
    childrenIds: ['hjv-vest', 'hjv-ost', 'hjv-marine', 'hjv-flyver'],
    description: 'National volunteer defence umbrella. Guard + patrol reinforcement.',
  },
  {
    id: 'hjv-vest', kind: 'receiver', type: 'leaf', parentId: 'hjv',
    org: 'Hjemmeværnet Vest', label: 'Landsdelsregion Vest', initials: 'HW',
    scope: 'regional', destinationIds: [],
    description: 'Home Guard, western Denmark. Distrikter under this region to be added.',
  },
  {
    id: 'hjv-ost', kind: 'receiver', type: 'leaf', parentId: 'hjv',
    org: 'Hjemmeværnet Øst', label: 'Landsdelsregion Øst', initials: 'HE',
    scope: 'regional', destinationIds: [],
    description: 'Home Guard, eastern Denmark. Distrikter under this region to be added.',
  },
  {
    id: 'hjv-marine', kind: 'receiver', type: 'leaf', parentId: 'hjv',
    org: 'Marinehjemmeværnet', label: 'Marinehjemmeværnet', initials: 'HM',
    scope: 'maritime', destinationIds: [],
    description: 'Naval Home Guard. Harbour + coastal reinforcement.',
  },
  {
    id: 'hjv-flyver', kind: 'receiver', type: 'leaf', parentId: 'hjv',
    org: 'Flyverhjemmeværnet', label: 'Flyverhjemmeværnet', initials: 'HF',
    scope: 'aviation', destinationIds: [],
    description: 'Air Home Guard. Airfield + air ops reinforcement.',
  },
];

// ── CANONICAL POPULATION TODO ──────────────────────────────────────
// These branches are structurally defined above but need canonical
// population from official DK government sources before shipping to
// customers. Populate before external release:
//
//   - Kommuner (98 total). Source: kl.dk registry.
//   - Kommunale beredskaber (~20 shared services). Source: brs.dk.
//   - Akuthospitaler per region (~30 total). Source: regioner.dk /
//     sundhed.dk.
//   - Hjemmeværnet distrikter under hjv-vest / hjv-ost (~40 total).
//     Source: hjv.dk.
//   - Additional Forsvaret named units (regiments under Hærkommandoen,
//     naval squadrons). Source: forsvaret.dk.
//
// Do NOT populate from memory — per no-hallucination protocol,
// misnaming a district or unit is an external-facing embarrassment.
// Dispatch a sourcing pass against the .dk registries above.

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

// ══════════════════════════════════════════════════════════════════
// RECEIVER-ROLE INTERACTION CONTRACT (Phase 0 · additive)
//
// Nothing in main.js reads these yet. Contract is populated for
// downstream integration (Phase 1+). Safe to import + read without
// affecting the current platform's behaviour.
// ══════════════════════════════════════════════════════════════════

// Top-level branches — used for cross-branch vs same-branch classification.
// A role's agencyBranch is the id of its highest ancestor. Roles with no
// parent are their own branch. Ministries are their own branch (siblings
// to each other but not to their portfolio agencies unless explicitly
// modelled — kept flat here to avoid over-nesting).
export const AGENCY_BRANCHES = {
  POLITI:      'politi',        // Rigspolitiet + 12 districts + PET, NSK, AKS
  FORSVARET:   'forsvaret',     // Flyvevåbnet, Hæren, Søværnet, SOK, FE, CFCS, Cyber
  BRS:         'brs',           // BRS national + centre + specialty
  HJV:         'hjv',           // Hjemmeværnet regions + branches
  REGION:      'region',        // 5 regioner (each own branch really — grouped for tree convenience)
  MINISTRY:    'ministry',
  AGENCY:      'agency',        // styrelser under any ministry
  STANDALONE:  'standalone',    // beredskab (legacy), forsvarskmd (legacy)
};

// Resolve a role's top branch by walking parentId. Cached lazily.
const _branchCache = new Map();
export function agencyBranchOf(roleId) {
  if (_branchCache.has(roleId)) return _branchCache.get(roleId);
  let cur = RECEIVERS.find(r => r.id === roleId);
  if (!cur) { _branchCache.set(roleId, null); return null; }
  let branch = null;
  // Walk to root
  let cursor = cur;
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (!cursor.parentId) { branch = cursor.id; break; }
    cursor = RECEIVERS.find(r => r.id === cursor.parentId);
  }
  // Bucket branch roots into AGENCY_BRANCHES
  const rootId = branch || cur.id;
  let bucket = AGENCY_BRANCHES.STANDALONE;
  if (rootId === 'politi') bucket = AGENCY_BRANCHES.POLITI;
  else if (rootId === 'forsvaret') bucket = AGENCY_BRANCHES.FORSVARET;
  else if (rootId === 'brs') bucket = AGENCY_BRANCHES.BRS;
  else if (rootId === 'hjv') bucket = AGENCY_BRANCHES.HJV;
  else if (rootId.startsWith('region-')) bucket = AGENCY_BRANCHES.REGION;
  else if (rootId.startsWith('min-')) bucket = AGENCY_BRANCHES.MINISTRY;
  else if (rootId.startsWith('agency-')) bucket = AGENCY_BRANCHES.AGENCY;
  _branchCache.set(roleId, bucket);
  return bucket;
}

// Relationship classification between two roles. Feeds canInitiate + UI
// affordance decisions ("show 'request support' button when peer is
// sibling in same branch").
//   self          — same role
//   parent        — a is parent of b
//   child         — a is child of b
//   sibling       — same parentId (both non-null)
//   same-branch   — same agencyBranch but not direct parent/child/sibling
//                   (e.g. Vestegn ↔ PET — both under Politi)
//   cross-branch  — different agencyBranch (Politi ↔ Flyvevåbnet)
export function relationshipBetween(aId, bId) {
  if (aId === bId) return 'self';
  const a = RECEIVERS.find(r => r.id === aId);
  const b = RECEIVERS.find(r => r.id === bId);
  if (!a || !b) return 'unknown';
  if (a.parentId === b.id) return 'child';   // a is child of b
  if (b.parentId === a.id) return 'parent';  // a is parent of b
  if (a.parentId && a.parentId === b.parentId) return 'sibling';
  if (agencyBranchOf(aId) === agencyBranchOf(bId)) return 'same-branch';
  return 'cross-branch';
}

// Flow types (canonical names for role-to-role interactions).
export const FLOW_TYPES = Object.freeze({
  NOTIFICATION:     'notification',     // system-generated push
  ADVISORY:         'advisory',         // human FYI
  CASCADE:          'cascade',          // top-down mandatory
  ESCALATION:       'escalation',       // bottom-up authority request
  HANDOFF:          'handoff',          // ownership transfer
  REQUEST_SUPPORT:  'request-support',  // peer asks peer for help
  COORDINATION:     'coordination',     // joint action, shared ownership
  OBSERVER_ADD:     'observer-add',     // loop someone in
  OBSERVER_PROMOTE: 'observer-promote', // observer asks for actor status
  SIT_REP:          'situation-report', // downstream → upstream status
});

// Interaction matrix: which flows are allowed for each relationship type.
// Keys are relationship classes returned by relationshipBetween().
// Values are Sets of allowed FLOW_TYPES.
const _rel = (arr) => new Set(arr);
export const FLOW_MATRIX = Object.freeze({
  self:          _rel([FLOW_TYPES.SIT_REP]),   // status update to self (log-only)
  parent:        _rel([   // a is parent of b: can cascade, notify, loop-in
    FLOW_TYPES.NOTIFICATION, FLOW_TYPES.ADVISORY, FLOW_TYPES.CASCADE,
    FLOW_TYPES.HANDOFF, FLOW_TYPES.REQUEST_SUPPORT, FLOW_TYPES.COORDINATION,
    FLOW_TYPES.OBSERVER_ADD,
  ]),
  child:         _rel([   // a is child of b: can escalate up, sit-rep, ask support
    FLOW_TYPES.NOTIFICATION, FLOW_TYPES.ADVISORY, FLOW_TYPES.ESCALATION,
    FLOW_TYPES.HANDOFF, FLOW_TYPES.REQUEST_SUPPORT, FLOW_TYPES.COORDINATION,
    FLOW_TYPES.OBSERVER_ADD, FLOW_TYPES.SIT_REP,
  ]),
  sibling:       _rel([   // same-branch siblings: peer collaboration
    FLOW_TYPES.NOTIFICATION, FLOW_TYPES.ADVISORY, FLOW_TYPES.HANDOFF,
    FLOW_TYPES.REQUEST_SUPPORT, FLOW_TYPES.COORDINATION, FLOW_TYPES.OBSERVER_ADD,
  ]),
  'same-branch': _rel([   // same-branch non-sibling: peer-ish, no cascade
    FLOW_TYPES.NOTIFICATION, FLOW_TYPES.ADVISORY,
    FLOW_TYPES.REQUEST_SUPPORT, FLOW_TYPES.COORDINATION, FLOW_TYPES.OBSERVER_ADD,
  ]),
  'cross-branch': _rel([  // cross-branch: bilateral only, no cascade
    FLOW_TYPES.NOTIFICATION, FLOW_TYPES.ADVISORY, FLOW_TYPES.HANDOFF,
    FLOW_TYPES.REQUEST_SUPPORT, FLOW_TYPES.COORDINATION, FLOW_TYPES.OBSERVER_ADD,
  ]),
  unknown:       _rel([]),
});

// Gate: is this initiator allowed to initiate this flow to this target?
// Returns { allowed: bool, reason?: string }. Phase 0 default: permissive —
// Admin bypasses. Operator can push any flow to any receiver. Receiver-to-
// receiver goes through the matrix. We tighten only after existing flows
// are catalogued.
export function canInitiate(fromRoleId, toRoleId, flowType) {
  if (!fromRoleId || !toRoleId || !flowType) {
    return { allowed: false, reason: 'missing-arg' };
  }
  // Admin always allowed
  const fromRole = ACCOUNTS.find(r => r.id === fromRoleId);
  if (fromRole?.kind === 'admin') return { allowed: true };
  // Operator can push anything to any receiver (they own the escalation)
  if (fromRole?.kind === 'operator') {
    const toRole = ACCOUNTS.find(r => r.id === toRoleId);
    if (toRole?.kind === 'receiver' || toRole?.kind === 'operator') return { allowed: true };
  }
  // Receiver-to-receiver via matrix
  const rel = relationshipBetween(fromRoleId, toRoleId);
  const allowed = FLOW_MATRIX[rel]?.has(flowType);
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `flow ${flowType} not allowed for relationship ${rel}` };
}

// Compute the set of roles impacted by an event at a given tick. Phase 0
// returns the direct-scope receivers based on event.siteId. Phase 1+
// extends with cross-site cascade, threat-type routing, observer chain,
// coordination peers.
export function impactedRoles(event, siteReceiversLookup = null) {
  const impacted = [];
  if (!event) return impacted;
  const siteId = event.siteId;
  if (!siteId) return impacted;
  // siteReceiversLookup is expected to be a fn (siteId) => Array<{id,mode,tier,...}>
  // populated by the SITES config (once the receivers block is wired in Phase 1).
  // Falls back to legacy destinationIds scan when lookup not provided.
  if (typeof siteReceiversLookup === 'function') {
    const entries = siteReceiversLookup(siteId) || [];
    for (const entry of entries) {
      const role = ACCOUNTS.find(r => r.id === entry.id);
      if (!role) continue;
      impacted.push({
        role_id: entry.id, mode: entry.mode || 'actor',
        addedBy: 'site-scope', reason: `siteScope:${siteId}`,
        tier: entry.tier || null, condition: entry.condition || null,
      });
    }
  }
  return impacted;
}

// Test hook: expose helpers on window for browser console debugging.
if (typeof window !== 'undefined') {
  window.__isrRoles = {
    ACCOUNTS, RECEIVERS, AGENCY_BRANCHES, FLOW_TYPES, FLOW_MATRIX,
    getRole: (id) => ACCOUNTS.find(r => r.id === id),
    agencyBranchOf, relationshipBetween, canInitiate, impactedRoles,
  };
}
