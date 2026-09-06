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
    id: 'op-billund-airport',
    kind: 'operator',
    org: 'Billund Airport',
    label: 'Billund Airport',
    person: 'Duty Officer',
    initials: 'BA',
    // logo: '/logos/billund.svg' — file not yet in /public/logos/. Falls
    // back to initials mark (orange square) until Lucas drops the SVG.
    scope: 'assigned-sites',
    destinationIds: [],
    siteIds: ['billund'],
    sensorCount: 19,
    isMultiSite: false,
    sector: 'Aviation',
    description: 'Billund Lufthavn (EKBI). Danmarks næststørste lufthavn, primær fragtknudepunkt og Legoland-adjacent.',
    brandTint: '#ff6b4d',
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
    id: 'pet', kind: 'receiver', type: 'parent',
    org: 'PET', label: 'PET — Politiets Efterretningstjeneste',
    person: 'K. Larsen', initials: 'KL',
    scope: 'all-sites', destinationIds: ['cph-t2-pet', 'esb-t2-pet', 'hvg-t2-pet', 'bjk-t2-pet', 'ldg-t2-pet', 'kas-t2-pet', 'frv-t2-pet'],
    childrenIds: ['pet-cta', 'pet-livvagt'],
    description: 'National security service. Tier 2 escalation, national scope. Sub-units: CTA (fusion centre) + Livvagtsstyrken (PPU).',
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
    childrenIds: ['flv-skrydstrup', 'flv-karup', 'flv-aalborg', 'flv-karup-control', 'flv-karup-ops', 'flv-skalstrup', 'flv-flyverkommandoen', 'flv-naoc'],
    description: 'Danish Air Force branch. Select a base to drill in.',
  },
  {
    id: 'flv-skrydstrup', kind: 'receiver', type: 'parent',
    parentId: 'flyvevaabnet',
    org: 'Flyvevåbnet · Skrydstrup', label: 'Fighter Wing Skrydstrup (F-35 QRA)',
    person: 'T. Andersen', initials: 'TA',
    scope: 'aviation', destinationIds: ['cph-t4-qra', 'esb-t4-qra', 'hvg-t4-qra', 'bjk-t4-qra', 'ldg-t4-qra', 'kas-t4-qra', 'frv-t4-qra'],
    childrenIds: ['flv-esk-727'],
    description: 'Fighter Wing Skrydstrup. F-35 QRA. National airborne intercept.',
  },
  {
    id: 'flv-karup', kind: 'receiver', type: 'parent',
    parentId: 'flyvevaabnet',
    org: 'Flyvevåbnet · Karup', label: 'Helicopter Wing Karup',
    person: 'B. Rasmussen', initials: 'BR',
    scope: 'all-sites', destinationIds: ['cph-t4-qra', 'esb-t4-qra', 'hvg-t4-qra', 'bjk-t4-qra', 'ldg-t4-qra', 'kas-t4-qra', 'frv-t4-qra'],
    childrenIds: ['flv-esk-722', 'flv-esk-723', 'flv-esk-724'],
    description: 'Helicopter Wing Karup. EH-101 Merlin + AS550 Fennec tactical intercept.',
  },

  // ── Hæren (branch parent) — Danish Army ─────────────────────────
  {
    id: 'haeren', kind: 'receiver', type: 'parent',
    parentId: 'forsvaret',
    org: 'Hæren', label: 'Hæren — Danish Army',
    initials: 'HA', scope: 'all-sites',
    childrenIds: ['haer-slagelse', 'haer-hovelte', 'haer-varde', 'haer-bornholm', 'haer-oksbol', 'haer-holstebro', 'haer-haderslev', 'haer-oksbol-artillery', 'haer-skive', 'haer-fredericia', 'haer-aalborg', 'haer-bornholm-regiment'],
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
    childrenIds: ['sov-frederikshavn', 'sov-korsor', 'sov-frederikshavn-3esk', 'sov-korsor-2esk', 'sov-fromands', 'sov-svk', 'sov-1-eskadre', 'sov-2-eskadre', 'sov-3-eskadre', 'sov-4-eskadre', 'sov-vbc', 'sov-nmoc', 'sov-vts-storebalt', 'sov-vts-oeresund', 'sov-dykker', 'sov-arktisk-kmd'],
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
    // All 12 Danish police districts + Rigspolitiet + specialist units
    // (NSK, AKS) exposed in the parent picker so a police-role login
    // sees the full national coverage, not just the 3 districts adjacent
    // to current live events.
    childrenIds: [
      'rigspoliti',
      'politi-kbh',
      'politi-vestegn',
      'politi-nordsj',
      'politi-midtvestsjaelland',
      'politi-sydsjaelland',
      'politi-bornholm',
      'politi-fyn',
      'politi-sydvest',
      'politi-sydsonderjyl',
      'politi-sydostjyl',
      'politi-midtvestjyl',
      'politi-ostjyl',
      'politi-nordjyl',
      'politi-nsk',
      'politi-aks',
      'rigspoliti-nkc',
      'rigspoliti-nc3',
      'rigspoliti-sirene',
      'rigspoliti-dvi',
      'rigspoliti-hundetjeneste',
      'rigspoliti-politiskolen',
    ],
    description: 'Danish Police umbrella. Select national HQ, one of the 12 districts, or a specialist unit (NSK / AKS / NKC / NC3 / SIRENE / DVI / hundetjeneste / Politiskolen).',
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
    id: 'politi-kbh', kind: 'receiver', type: 'parent',
    parentId: 'politi',
    org: 'Politi København', label: 'Politi København',
    person: 'S. Hansen', initials: 'SH',
    scope: 'cph-only', destinationIds: ['cph-t2-politi'],
    childrenIds: ['kbh-politi-rytteri'],
    description: 'Copenhagen district. Local C-UAS patrol. Rytteriafdelingen sits here (national mounted section).',
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
    id: 'politi-nsk', kind: 'receiver', type: 'parent', parentId: 'politi',
    org: 'NSK', label: 'NSK — Nationalt Særligt Kriminalpoliti', initials: 'NS',
    scope: 'all-sites', destinationIds: [],
    childrenIds: ['rigspoliti-ncik'],
    description: 'National organised-crime + state-actor investigative unit. NCIK sits under NSK.',
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
    org: 'Region Hovedstaden', label: 'Region Hovedstaden (regional forvaltning)', initials: 'Hov',
    scope: 'regional', destinationIds: [],
    description: 'Regional folkevalgt forvaltning der ejer sundhedsvæsenet i Hovedstaden (hospitaler, præhospital tjeneste, ambulancer) og regional infrastruktur. Politisk eskaleringspunkt, ikke operationelt. Operationel modtager er Akutmedicinsk Koordinationscenter Hovedstaden. Kontakt: regionsrådsformand og regional beredskabschef ved hændelser der spænder over flere sites i regionen.',
  },
  {
    id: 'region-sjl', kind: 'receiver', type: 'leaf',
    org: 'Region Sjælland', label: 'Region Sjælland (regional forvaltning)', initials: 'Sjæ',
    scope: 'regional', destinationIds: [],
    description: 'Regional folkevalgt forvaltning der ejer sundhedsvæsenet på Sjælland uden for hovedstadsområdet (hospitaler, præhospital tjeneste, ambulancer) og regional infrastruktur. Politisk eskaleringspunkt, ikke operationelt. Operationel modtager er Akutmedicinsk Koordinationscenter Sjælland i Slagelse. Kontakt: regionsrådsformand og regional beredskabschef ved hændelser der spænder over flere sites i regionen.',
  },
  {
    id: 'region-syd', kind: 'receiver', type: 'leaf',
    org: 'Region Syddanmark', label: 'Region Syddanmark (regional forvaltning)', initials: 'Syd',
    scope: 'regional', destinationIds: [],
    description: 'Regional folkevalgt forvaltning der ejer sundhedsvæsenet i Syddanmark og Fyn (hospitaler, præhospital tjeneste, ambulancer) og regional infrastruktur. Dækker Esbjerg, Billund, Kolding, Odense. Politisk eskaleringspunkt, ikke operationelt. Operationel modtager er Akutmedicinsk Koordinationscenter Syddanmark i Odense. Kontakt: regionsrådsformand og regional beredskabschef ved hændelser der spænder over flere sites i regionen.',
  },
  {
    id: 'region-midt', kind: 'receiver', type: 'leaf',
    org: 'Region Midtjylland', label: 'Region Midtjylland (regional forvaltning)', initials: 'Mid',
    scope: 'regional', destinationIds: [],
    description: 'Regional folkevalgt forvaltning der ejer sundhedsvæsenet i Midtjylland (hospitaler, præhospital tjeneste, ambulancer) og regional infrastruktur. Politisk eskaleringspunkt, ikke operationelt. Operationel modtager er Akutmedicinsk Koordinationscenter Midtjylland i Aarhus. Kontakt: regionsrådsformand og regional beredskabschef ved hændelser der spænder over flere sites i regionen.',
  },
  {
    id: 'region-nord', kind: 'receiver', type: 'leaf',
    org: 'Region Nordjylland', label: 'Region Nordjylland (regional forvaltning)', initials: 'Nor',
    scope: 'regional', destinationIds: [],
    description: 'Regional folkevalgt forvaltning der ejer sundhedsvæsenet i Nordjylland (hospitaler, præhospital tjeneste, ambulancer) og regional infrastruktur. Politisk eskaleringspunkt, ikke operationelt. Operationel modtager er Akutmedicinsk Koordinationscenter Nordjylland i Aalborg. Kontakt: regionsrådsformand og regional beredskabschef ved hændelser der spænder over flere sites i regionen.',
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
    id: 'agency-traf', kind: 'receiver', type: 'parent',
    org: 'Trafikstyrelsen', label: 'Trafikstyrelsen', initials: 'TS',
    scope: 'aviation', destinationIds: [],
    childrenIds: ['agency-traf-luftfart', 'agency-traf-jernbane', 'agency-traf-havne'],
    description: 'Aviation + rail + road + ports regulator. Auto-actor on airport events (airspace-restriction authority).',
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
    id: 'agency-cfcs', kind: 'receiver', type: 'parent', parentId: 'fe',
    org: 'CFCS', label: 'CFCS — Center for Cybersikkerhed', initials: 'CC',
    scope: 'national', destinationIds: [],
    childrenIds: ['agency-cfcs-netsikkerhed'],
    description: 'Cyber security agency. Transferred from FE to Ministry of Samfundssikkerhed (SAMSIK) 2024/2025. Observer on all critical infrastructure events.',
  },

  // ══════════════════════════════════════════════════════════════
  // FORSVARET expansion — additional wings + special commands
  // ══════════════════════════════════════════════════════════════
  {
    id: 'flv-aalborg', kind: 'receiver', type: 'parent', parentId: 'flyvevaabnet',
    org: 'Flyvevåbnet · Aalborg', label: 'Air Transport Wing Aalborg', initials: 'AA',
    scope: 'aviation', destinationIds: [],
    childrenIds: ['flv-esk-721'],
    description: 'C-130J + Challenger 604 transport wing. Personnel + equipment lift.',
  },
  {
    id: 'flv-karup-control', kind: 'receiver', type: 'parent', parentId: 'flyvevaabnet',
    org: 'Flyvevåbnet · Karup ACW', label: 'Air Control Wing Karup', initials: 'AC',
    scope: 'aviation', destinationIds: [],
    childrenIds: ['flv-esk-515'],
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
    childrenIds: ['hjv-vest', 'hjv-ost', 'hjv-marine', 'hjv-flyver', 'hjv-marine-hq', 'hjv-flyver-hq', 'hjv-distrikt-nordjylland', 'hjv-distrikt-midtvestjyl', 'hjv-distrikt-ostjyl', 'hjv-distrikt-sydostjyl', 'hjv-distrikt-sonderjyl', 'hjv-distrikt-fyn', 'hjv-distrikt-kbh', 'hjv-distrikt-kbh-vestegn', 'hjv-distrikt-nordsj', 'hjv-distrikt-midtvestsj', 'hjv-distrikt-sydsj-lolland', 'hjv-distrikt-bornholm'],
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
    id: 'hjv-marine', kind: 'receiver', type: 'parent', parentId: 'hjv',
    org: 'Marinehjemmeværnet', label: 'Marinehjemmeværnet', initials: 'HM',
    scope: 'maritime', destinationIds: [],
    childrenIds: ['hjv-marine-hvf114', 'hjv-marine-hvf115', 'hjv-marine-hvf116', 'hjv-marine-hvf121', 'hjv-marine-hvf122', 'hjv-marine-hvf123', 'hjv-marine-hvf124', 'hjv-marine-hvf125', 'hjv-marine-hvf126', 'hjv-marine-hvf131', 'hjv-marine-hvf132', 'hjv-marine-hvf133', 'hjv-marine-hvf134', 'hjv-marine-hvf135', 'hjv-marine-hvf136', 'hjv-marine-hvf137', 'hjv-marine-hvf201', 'hjv-marine-hvf241', 'hjv-marine-hvf242', 'hjv-marine-hvf243', 'hjv-marine-hvf244', 'hjv-marine-hvf246', 'hjv-marine-hvf251', 'hjv-marine-hvf255', 'hjv-marine-hvf256', 'hjv-marine-hvf284', 'hjv-marine-hvf361', 'hjv-marine-hvf362', 'hjv-marine-hvf363', 'hjv-marine-hvf366', 'hjv-marine-hvf367', 'hjv-marine-hvf368', 'hjv-marine-hvf369', 'hjv-marine-hvf471'],
    description: 'Naval Home Guard. Harbour + coastal reinforcement. 34 flotiller nationwide.',
  },
  {
    id: 'hjv-flyver', kind: 'receiver', type: 'parent', parentId: 'hjv',
    org: 'Flyverhjemmeværnet', label: 'Flyverhjemmeværnet', initials: 'HF',
    scope: 'aviation', destinationIds: [],
    childrenIds: ['hjv-flyver-hve220', 'hjv-flyver-hve221', 'hjv-flyver-hve223', 'hjv-flyver-hve225', 'hjv-flyver-hve227', 'hjv-flyver-hve228', 'hjv-flyver-hve230', 'hjv-flyver-fsd231', 'hjv-flyver-hve232', 'hjv-flyver-hve233', 'hjv-flyver-hve240', 'hjv-flyver-hve242', 'hjv-flyver-hve243', 'hjv-flyver-hve260', 'hjv-flyver-hve261', 'hjv-flyver-hve265', 'hjv-flyver-hve266', 'hjv-flyver-hve270', 'hjv-flyver-hve272', 'hjv-flyver-hve273', 'hjv-flyver-hve274', 'hjv-flyver-hve275', 'hjv-flyver-hve277', 'hjv-flyver-hve280', 'hjv-flyver-hve281', 'hjv-flyver-hve282', 'hjv-flyver-hve283', 'hjv-flyver-hve284', 'hjv-flyver-hve286'],
    description: 'Air Home Guard. Airfield + air ops reinforcement. 29 eskadriller nationwide.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CANONICAL POPULATION — sourced from public DK registries 2026-08-23
  // Per-section provenance below (URL + fetch date). 176 additional leaves.
  // TODO(2027-01-01): Region Sjælland + Region Hovedstaden merge into Region
  //   Østdanmark. Hospitals' meta.region_parent will need re-anchoring.
  // NOTE: Bornholms Regiment (haer-bornholm-regiment) coexists as peer with
  //   the existing Bornholms Værn Almegård (haer-bornholm). Regiment is a
  //   reactivated operational unit; Værn is the historic kaserne.
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // A. KOMMUNER (98) — sourced from
  //    https://da.wikipedia.org/wiki/Kommuner_i_Danmark on 2026-08-23
  //    Cross-referenced against Region Hovedstaden / Sjælland / Syddanmark /
  //    Midtjylland / Nordjylland groupings.
  //    Count breakdown: 29 Hovedstaden + 17 Sjælland + 22 Syddanmark
  //    + 19 Midtjylland + 11 Nordjylland = 98
  // ══════════════════════════════════════════════════════════════════════════

  // ── Region Hovedstaden (29 kommuner) ────────────────────────────────────
  { id: 'kom-albertslund', kind: 'receiver', type: 'leaf',
  org: 'Albertslund Kommune', label: 'Albertslund Kommune', initials: 'AL',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Albertslund municipality (Hovedstaden).' },
  { id: 'kom-alleroed', kind: 'receiver', type: 'leaf',
  org: 'Allerød Kommune', label: 'Allerød Kommune', initials: 'AR',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Allerød municipality (Hovedstaden).' },
  { id: 'kom-ballerup', kind: 'receiver', type: 'leaf',
  org: 'Ballerup Kommune', label: 'Ballerup Kommune', initials: 'BA',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Ballerup municipality (Hovedstaden).' },
  { id: 'kom-bornholm', kind: 'receiver', type: 'leaf',
  org: 'Bornholms Regionskommune', label: 'Bornholms Regionskommune', initials: 'BR',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Bornholm regional municipality (Hovedstaden).' },
  { id: 'kom-broendby', kind: 'receiver', type: 'leaf',
  org: 'Brøndby Kommune', label: 'Brøndby Kommune', initials: 'BØ',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Brøndby municipality (Hovedstaden).' },
  { id: 'kom-dragoer', kind: 'receiver', type: 'leaf',
  org: 'Dragør Kommune', label: 'Dragør Kommune', initials: 'DR',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Dragør municipality (Hovedstaden).' },
  { id: 'kom-egedal', kind: 'receiver', type: 'leaf',
  org: 'Egedal Kommune', label: 'Egedal Kommune', initials: 'EG',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Egedal municipality (Hovedstaden).' },
  { id: 'kom-fredensborg', kind: 'receiver', type: 'leaf',
  org: 'Fredensborg Kommune', label: 'Fredensborg Kommune', initials: 'FR',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Fredensborg municipality (Hovedstaden).' },
  { id: 'kom-frederiksberg', kind: 'receiver', type: 'leaf',
  org: 'Frederiksberg Kommune', label: 'Frederiksberg Kommune', initials: 'FB',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Frederiksberg municipality (Hovedstaden).' },
  { id: 'kom-frederikssund', kind: 'receiver', type: 'leaf',
  org: 'Frederikssund Kommune', label: 'Frederikssund Kommune', initials: 'FS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Frederikssund municipality (Hovedstaden).' },
  { id: 'kom-furesoe', kind: 'receiver', type: 'leaf',
  org: 'Furesø Kommune', label: 'Furesø Kommune', initials: 'FU',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Furesø municipality (Hovedstaden).' },
  { id: 'kom-gentofte', kind: 'receiver', type: 'leaf',
  org: 'Gentofte Kommune', label: 'Gentofte Kommune', initials: 'GE',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Gentofte municipality (Hovedstaden).' },
  { id: 'kom-gladsaxe', kind: 'receiver', type: 'leaf',
  org: 'Gladsaxe Kommune', label: 'Gladsaxe Kommune', initials: 'GL',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Gladsaxe municipality (Hovedstaden).' },
  { id: 'kom-glostrup', kind: 'receiver', type: 'leaf',
  org: 'Glostrup Kommune', label: 'Glostrup Kommune', initials: 'GS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Glostrup municipality (Hovedstaden).' },
  { id: 'kom-gribskov', kind: 'receiver', type: 'leaf',
  org: 'Gribskov Kommune', label: 'Gribskov Kommune', initials: 'GR',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Gribskov municipality (Hovedstaden).' },
  { id: 'kom-halsnaes', kind: 'receiver', type: 'leaf',
  org: 'Halsnæs Kommune', label: 'Halsnæs Kommune', initials: 'HN',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Halsnæs municipality (Hovedstaden).' },
  { id: 'kom-helsingoer', kind: 'receiver', type: 'leaf',
  org: 'Helsingør Kommune', label: 'Helsingør Kommune', initials: 'HE',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Helsingør municipality (Hovedstaden).' },
  { id: 'kom-herlev', kind: 'receiver', type: 'leaf',
  org: 'Herlev Kommune', label: 'Herlev Kommune', initials: 'HL',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Herlev municipality (Hovedstaden).' },
  { id: 'kom-hilleroed', kind: 'receiver', type: 'leaf',
  org: 'Hillerød Kommune', label: 'Hillerød Kommune', initials: 'HI',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Hillerød municipality (Hovedstaden).' },
  { id: 'kom-hvidovre', kind: 'receiver', type: 'leaf',
  org: 'Hvidovre Kommune', label: 'Hvidovre Kommune', initials: 'HV',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Hvidovre municipality (Hovedstaden).' },
  { id: 'kom-hoeje-taastrup', kind: 'receiver', type: 'leaf',
  org: 'Høje-Taastrup Kommune', label: 'Høje-Taastrup Kommune', initials: 'HT',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Høje-Taastrup municipality (Hovedstaden).' },
  { id: 'kom-hoersholm', kind: 'receiver', type: 'leaf',
  org: 'Hørsholm Kommune', label: 'Hørsholm Kommune', initials: 'HØ',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Hørsholm municipality (Hovedstaden).' },
  { id: 'kom-ishoej', kind: 'receiver', type: 'leaf',
  org: 'Ishøj Kommune', label: 'Ishøj Kommune', initials: 'IS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Ishøj municipality (Hovedstaden).' },
  { id: 'kom-koebenhavn', kind: 'receiver', type: 'leaf',
  org: 'Københavns Kommune', label: 'Københavns Kommune', initials: 'KK',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Copenhagen municipality (Hovedstaden).' },
  { id: 'kom-lyngby-taarbaek', kind: 'receiver', type: 'leaf',
  org: 'Lyngby-Taarbæk Kommune', label: 'Lyngby-Taarbæk Kommune', initials: 'LT',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Lyngby-Taarbæk municipality (Hovedstaden).' },
  { id: 'kom-rudersdal', kind: 'receiver', type: 'leaf',
  org: 'Rudersdal Kommune', label: 'Rudersdal Kommune', initials: 'RU',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Rudersdal municipality (Hovedstaden).' },
  { id: 'kom-roedovre', kind: 'receiver', type: 'leaf',
  org: 'Rødovre Kommune', label: 'Rødovre Kommune', initials: 'RØ',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Rødovre municipality (Hovedstaden).' },
  { id: 'kom-taarnby', kind: 'receiver', type: 'leaf',
  org: 'Tårnby Kommune', label: 'Tårnby Kommune', initials: 'TB',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Tårnby municipality (Hovedstaden). Hosts CPH airport core footprint.' },
  { id: 'kom-vallensbaek', kind: 'receiver', type: 'leaf',
  org: 'Vallensbæk Kommune', label: 'Vallensbæk Kommune', initials: 'VB',
  scope: 'regional', destinationIds: [], meta: { region: 'region-hst' },
  description: 'Vallensbæk municipality (Hovedstaden).' },

  // ── Region Sjælland (17 kommuner) ────────────────────────────────────────
  { id: 'kom-faxe', kind: 'receiver', type: 'leaf',
  org: 'Faxe Kommune', label: 'Faxe Kommune', initials: 'FA',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Faxe municipality (Sjælland).' },
  { id: 'kom-greve', kind: 'receiver', type: 'leaf',
  org: 'Greve Kommune', label: 'Greve Kommune', initials: 'GV',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Greve municipality (Sjælland).' },
  { id: 'kom-guldborgsund', kind: 'receiver', type: 'leaf',
  org: 'Guldborgsund Kommune', label: 'Guldborgsund Kommune', initials: 'GU',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Guldborgsund municipality (Sjælland).' },
  { id: 'kom-holbaek', kind: 'receiver', type: 'leaf',
  org: 'Holbæk Kommune', label: 'Holbæk Kommune', initials: 'HB',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Holbæk municipality (Sjælland).' },
  { id: 'kom-kalundborg', kind: 'receiver', type: 'leaf',
  org: 'Kalundborg Kommune', label: 'Kalundborg Kommune', initials: 'KA',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Kalundborg municipality (Sjælland).' },
  { id: 'kom-koege', kind: 'receiver', type: 'leaf',
  org: 'Køge Kommune', label: 'Køge Kommune', initials: 'KØ',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Køge municipality (Sjælland).' },
  { id: 'kom-lejre', kind: 'receiver', type: 'leaf',
  org: 'Lejre Kommune', label: 'Lejre Kommune', initials: 'LE',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Lejre municipality (Sjælland).' },
  { id: 'kom-lolland', kind: 'receiver', type: 'leaf',
  org: 'Lolland Kommune', label: 'Lolland Kommune', initials: 'LO',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Lolland municipality (Sjælland).' },
  { id: 'kom-naestved', kind: 'receiver', type: 'leaf',
  org: 'Næstved Kommune', label: 'Næstved Kommune', initials: 'NS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Næstved municipality (Sjælland).' },
  { id: 'kom-odsherred', kind: 'receiver', type: 'leaf',
  org: 'Odsherred Kommune', label: 'Odsherred Kommune', initials: 'OD',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Odsherred municipality (Sjælland).' },
  { id: 'kom-ringsted', kind: 'receiver', type: 'leaf',
  org: 'Ringsted Kommune', label: 'Ringsted Kommune', initials: 'RI',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Ringsted municipality (Sjælland).' },
  { id: 'kom-roskilde', kind: 'receiver', type: 'leaf',
  org: 'Roskilde Kommune', label: 'Roskilde Kommune', initials: 'RO',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Roskilde municipality (Sjælland).' },
  { id: 'kom-slagelse', kind: 'receiver', type: 'leaf',
  org: 'Slagelse Kommune', label: 'Slagelse Kommune', initials: 'SL',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Slagelse municipality (Sjælland). Hosts Gardehusarregimentet.' },
  { id: 'kom-solroed', kind: 'receiver', type: 'leaf',
  org: 'Solrød Kommune', label: 'Solrød Kommune', initials: 'SR',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Solrød municipality (Sjælland).' },
  { id: 'kom-soroe', kind: 'receiver', type: 'leaf',
  org: 'Sorø Kommune', label: 'Sorø Kommune', initials: 'SO',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Sorø municipality (Sjælland).' },
  { id: 'kom-stevns', kind: 'receiver', type: 'leaf',
  org: 'Stevns Kommune', label: 'Stevns Kommune', initials: 'SV',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Stevns municipality (Sjælland).' },
  { id: 'kom-vordingborg', kind: 'receiver', type: 'leaf',
  org: 'Vordingborg Kommune', label: 'Vordingborg Kommune', initials: 'VO',
  scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' },
  description: 'Vordingborg municipality (Sjælland).' },

  // ── Region Syddanmark (22 kommuner) ──────────────────────────────────────
  { id: 'kom-assens', kind: 'receiver', type: 'leaf',
  org: 'Assens Kommune', label: 'Assens Kommune', initials: 'AS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Assens municipality (Syddanmark).' },
  { id: 'kom-billund', kind: 'receiver', type: 'leaf',
  org: 'Billund Kommune', label: 'Billund Kommune', initials: 'BI',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Billund municipality (Syddanmark).' },
  { id: 'kom-esbjerg', kind: 'receiver', type: 'leaf',
  org: 'Esbjerg Kommune', label: 'Esbjerg Kommune', initials: 'ES',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Esbjerg municipality (Syddanmark). Hosts Port of Esbjerg.' },
  { id: 'kom-fanoe', kind: 'receiver', type: 'leaf',
  org: 'Fanø Kommune', label: 'Fanø Kommune', initials: 'FN',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Fanø municipality (Syddanmark).' },
  { id: 'kom-fredericia', kind: 'receiver', type: 'leaf',
  org: 'Fredericia Kommune', label: 'Fredericia Kommune', initials: 'FC',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Fredericia municipality (Syddanmark).' },
  { id: 'kom-faaborg-midtfyn', kind: 'receiver', type: 'leaf',
  org: 'Faaborg-Midtfyn Kommune', label: 'Faaborg-Midtfyn Kommune', initials: 'FM',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Faaborg-Midtfyn municipality (Syddanmark).' },
  { id: 'kom-haderslev', kind: 'receiver', type: 'leaf',
  org: 'Haderslev Kommune', label: 'Haderslev Kommune', initials: 'HD',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Haderslev municipality (Syddanmark). Hosts Slesvigske Fodregiment.' },
  { id: 'kom-kerteminde', kind: 'receiver', type: 'leaf',
  org: 'Kerteminde Kommune', label: 'Kerteminde Kommune', initials: 'KE',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Kerteminde municipality (Syddanmark).' },
  { id: 'kom-kolding', kind: 'receiver', type: 'leaf',
  org: 'Kolding Kommune', label: 'Kolding Kommune', initials: 'KO',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Kolding municipality (Syddanmark).' },
  { id: 'kom-langeland', kind: 'receiver', type: 'leaf',
  org: 'Langeland Kommune', label: 'Langeland Kommune', initials: 'LA',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Langeland municipality (Syddanmark).' },
  { id: 'kom-middelfart', kind: 'receiver', type: 'leaf',
  org: 'Middelfart Kommune', label: 'Middelfart Kommune', initials: 'MI',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Middelfart municipality (Syddanmark).' },
  { id: 'kom-nordfyns', kind: 'receiver', type: 'leaf',
  org: 'Nordfyns Kommune', label: 'Nordfyns Kommune', initials: 'NF',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Nordfyns municipality (Syddanmark).' },
  { id: 'kom-nyborg', kind: 'receiver', type: 'leaf',
  org: 'Nyborg Kommune', label: 'Nyborg Kommune', initials: 'NY',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Nyborg municipality (Syddanmark).' },
  { id: 'kom-odense', kind: 'receiver', type: 'leaf',
  org: 'Odense Kommune', label: 'Odense Kommune', initials: 'OD',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Odense municipality (Syddanmark).' },
  { id: 'kom-svendborg', kind: 'receiver', type: 'leaf',
  org: 'Svendborg Kommune', label: 'Svendborg Kommune', initials: 'SB',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Svendborg municipality (Syddanmark).' },
  { id: 'kom-soenderborg', kind: 'receiver', type: 'leaf',
  org: 'Sønderborg Kommune', label: 'Sønderborg Kommune', initials: 'SD',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Sønderborg municipality (Syddanmark).' },
  { id: 'kom-toender', kind: 'receiver', type: 'leaf',
  org: 'Tønder Kommune', label: 'Tønder Kommune', initials: 'TN',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Tønder municipality (Syddanmark).' },
  { id: 'kom-varde', kind: 'receiver', type: 'leaf',
  org: 'Varde Kommune', label: 'Varde Kommune', initials: 'VD',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Varde municipality (Syddanmark). Hosts Efterretningsregimentet + Danske Artilleriregiment (Oksbøl).' },
  { id: 'kom-vejen', kind: 'receiver', type: 'leaf',
  org: 'Vejen Kommune', label: 'Vejen Kommune', initials: 'VJ',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Vejen municipality (Syddanmark).' },
  { id: 'kom-vejle', kind: 'receiver', type: 'leaf',
  org: 'Vejle Kommune', label: 'Vejle Kommune', initials: 'VE',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Vejle municipality (Syddanmark).' },
  { id: 'kom-aeroe', kind: 'receiver', type: 'leaf',
  org: 'Ærø Kommune', label: 'Ærø Kommune', initials: 'ÆR',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Ærø municipality (Syddanmark).' },
  { id: 'kom-aabenraa', kind: 'receiver', type: 'leaf',
  org: 'Aabenraa Kommune', label: 'Aabenraa Kommune', initials: 'AB',
  scope: 'regional', destinationIds: [], meta: { region: 'region-syd' },
  description: 'Aabenraa municipality (Syddanmark).' },

  // ── Region Midtjylland (19 kommuner) ─────────────────────────────────────
  { id: 'kom-favrskov', kind: 'receiver', type: 'leaf',
  org: 'Favrskov Kommune', label: 'Favrskov Kommune', initials: 'FV',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Favrskov municipality (Midtjylland).' },
  { id: 'kom-hedensted', kind: 'receiver', type: 'leaf',
  org: 'Hedensted Kommune', label: 'Hedensted Kommune', initials: 'HS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Hedensted municipality (Midtjylland).' },
  { id: 'kom-herning', kind: 'receiver', type: 'leaf',
  org: 'Herning Kommune', label: 'Herning Kommune', initials: 'HR',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Herning municipality (Midtjylland).' },
  { id: 'kom-holstebro', kind: 'receiver', type: 'leaf',
  org: 'Holstebro Kommune', label: 'Holstebro Kommune', initials: 'HO',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Holstebro municipality (Midtjylland). Hosts Jyske Dragonregiment.' },
  { id: 'kom-horsens', kind: 'receiver', type: 'leaf',
  org: 'Horsens Kommune', label: 'Horsens Kommune', initials: 'HK',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Horsens municipality (Midtjylland).' },
  { id: 'kom-ikast-brande', kind: 'receiver', type: 'leaf',
  org: 'Ikast-Brande Kommune', label: 'Ikast-Brande Kommune', initials: 'IB',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Ikast-Brande municipality (Midtjylland).' },
  { id: 'kom-lemvig', kind: 'receiver', type: 'leaf',
  org: 'Lemvig Kommune', label: 'Lemvig Kommune', initials: 'LV',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Lemvig municipality (Midtjylland).' },
  { id: 'kom-norddjurs', kind: 'receiver', type: 'leaf',
  org: 'Norddjurs Kommune', label: 'Norddjurs Kommune', initials: 'ND',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Norddjurs municipality (Midtjylland).' },
  { id: 'kom-odder', kind: 'receiver', type: 'leaf',
  org: 'Odder Kommune', label: 'Odder Kommune', initials: 'ODR',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Odder municipality (Midtjylland).' },
  { id: 'kom-randers', kind: 'receiver', type: 'leaf',
  org: 'Randers Kommune', label: 'Randers Kommune', initials: 'RA',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Randers municipality (Midtjylland).' },
  { id: 'kom-ringkoebing-skjern', kind: 'receiver', type: 'leaf',
  org: 'Ringkøbing-Skjern Kommune', label: 'Ringkøbing-Skjern Kommune', initials: 'RS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Ringkøbing-Skjern municipality (Midtjylland).' },
  { id: 'kom-samsoe', kind: 'receiver', type: 'leaf',
  org: 'Samsø Kommune', label: 'Samsø Kommune', initials: 'SM',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Samsø municipality (Midtjylland).' },
  { id: 'kom-silkeborg', kind: 'receiver', type: 'leaf',
  org: 'Silkeborg Kommune', label: 'Silkeborg Kommune', initials: 'SK',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Silkeborg municipality (Midtjylland).' },
  { id: 'kom-skanderborg', kind: 'receiver', type: 'leaf',
  org: 'Skanderborg Kommune', label: 'Skanderborg Kommune', initials: 'SG',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Skanderborg municipality (Midtjylland).' },
  { id: 'kom-skive', kind: 'receiver', type: 'leaf',
  org: 'Skive Kommune', label: 'Skive Kommune', initials: 'SI',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Skive municipality (Midtjylland). Hosts Ingeniørregimentet.' },
  { id: 'kom-struer', kind: 'receiver', type: 'leaf',
  org: 'Struer Kommune', label: 'Struer Kommune', initials: 'ST',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Struer municipality (Midtjylland).' },
  { id: 'kom-syddjurs', kind: 'receiver', type: 'leaf',
  org: 'Syddjurs Kommune', label: 'Syddjurs Kommune', initials: 'SY',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Syddjurs municipality (Midtjylland).' },
  { id: 'kom-viborg', kind: 'receiver', type: 'leaf',
  org: 'Viborg Kommune', label: 'Viborg Kommune', initials: 'VI',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Viborg municipality (Midtjylland).' },
  { id: 'kom-aarhus', kind: 'receiver', type: 'leaf',
  org: 'Aarhus Kommune', label: 'Aarhus Kommune', initials: 'AA',
  scope: 'regional', destinationIds: [], meta: { region: 'region-midt' },
  description: 'Aarhus municipality (Midtjylland).' },

  // ── Region Nordjylland (11 kommuner) ─────────────────────────────────────
  { id: 'kom-broenderslev', kind: 'receiver', type: 'leaf',
  org: 'Brønderslev Kommune', label: 'Brønderslev Kommune', initials: 'BS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Brønderslev municipality (Nordjylland).' },
  { id: 'kom-frederikshavn', kind: 'receiver', type: 'leaf',
  org: 'Frederikshavn Kommune', label: 'Frederikshavn Kommune', initials: 'FH',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Frederikshavn municipality (Nordjylland). Hosts Flådestation Frederikshavn.' },
  { id: 'kom-hjoerring', kind: 'receiver', type: 'leaf',
  org: 'Hjørring Kommune', label: 'Hjørring Kommune', initials: 'HJ',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Hjørring municipality (Nordjylland).' },
  { id: 'kom-jammerbugt', kind: 'receiver', type: 'leaf',
  org: 'Jammerbugt Kommune', label: 'Jammerbugt Kommune', initials: 'JB',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Jammerbugt municipality (Nordjylland).' },
  { id: 'kom-laesoe', kind: 'receiver', type: 'leaf',
  org: 'Læsø Kommune', label: 'Læsø Kommune', initials: 'LS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Læsø municipality (Nordjylland).' },
  { id: 'kom-mariagerfjord', kind: 'receiver', type: 'leaf',
  org: 'Mariagerfjord Kommune', label: 'Mariagerfjord Kommune', initials: 'MF',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Mariagerfjord municipality (Nordjylland).' },
  { id: 'kom-morsoe', kind: 'receiver', type: 'leaf',
  org: 'Morsø Kommune', label: 'Morsø Kommune', initials: 'MS',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Morsø municipality (Nordjylland).' },
  { id: 'kom-rebild', kind: 'receiver', type: 'leaf',
  org: 'Rebild Kommune', label: 'Rebild Kommune', initials: 'RB',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Rebild municipality (Nordjylland).' },
  { id: 'kom-thisted', kind: 'receiver', type: 'leaf',
  org: 'Thisted Kommune', label: 'Thisted Kommune', initials: 'TH',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Thisted municipality (Nordjylland).' },
  { id: 'kom-vesthimmerlands', kind: 'receiver', type: 'leaf',
  org: 'Vesthimmerlands Kommune', label: 'Vesthimmerlands Kommune', initials: 'VH',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Vesthimmerlands municipality (Nordjylland).' },
  { id: 'kom-aalborg', kind: 'receiver', type: 'leaf',
  org: 'Aalborg Kommune', label: 'Aalborg Kommune', initials: 'AL',
  scope: 'regional', destinationIds: [], meta: { region: 'region-nord' },
  description: 'Aalborg municipality (Nordjylland). Hosts Air Transport Wing + Trainregimentet + Jægerkorpset.' },


  // ══════════════════════════════════════════════════════════════════════════
  // B. KOMMUNALE BEREDSKABER (~24 shared/independent services) — sourced from
  //    https://www.rbis.dk/ (Redningsberedskabernes Informationssystem) on
  //    2026-08-23 for master list of names, cross-referenced against per-unit
  //    pages on beredskabsinfo.dk, LinkedIn, and each unit's own website for
  //    member kommuner. As of 2026-08-23 there are more than the original
  //    ~20 target because Østsjællands Beredskab dissolved (2020) and several
  //    kommuner have re-formed smaller units (Brand & Redning Køge, Vejle
  //    Brandvæsen, Beredskab 4K etc.).
  //
  //    Note: A handful of single-kommune units (Gribskov, Helsingør, Lejre,
  //    Roskilde, Slagelse, Tårnby, Vejle, Bornholm, Beredskab Sønderborg)
  //    are the whole beredskab for that kommune — no §60 shared structure.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Hovedstaden + Sjælland shared ────────────────────────────────────────
  { id: 'kbr-hovedstaden', kind: 'receiver', type: 'leaf',
  org: 'Hovedstadens Beredskab', label: 'Hovedstadens Beredskab', initials: 'HBR',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-albertslund', 'kom-broendby', 'kom-dragoer', 'kom-frederiksberg', 'kom-glostrup', 'kom-hvidovre', 'kom-koebenhavn', 'kom-roedovre'] },
  description: 'Denmark\'s largest §60 fire & rescue service. 8 owner kommuner, ~1M residents.' },
  { id: 'kbr-beredskab-ost', kind: 'receiver', type: 'leaf',
  org: 'Beredskab Øst', label: 'Beredskab Øst', initials: 'BØ',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-ballerup', 'kom-gentofte', 'kom-gladsaxe', 'kom-herlev', 'kom-lyngby-taarbaek'] },
  description: '§60 shared fire & rescue for north-of-Copenhagen kommuner.' },
  { id: 'kbr-nordsjaellands', kind: 'receiver', type: 'leaf',
  org: 'Nordsjællands Brandvæsen', label: 'Nordsjællands Brandvæsen', initials: 'NSB',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-alleroed', 'kom-hoersholm', 'kom-rudersdal', 'kom-fredensborg'] },
  description: '§60 shared fire & rescue, north Zealand coastal kommuner.' },
  { id: 'kbr-frederiksborg', kind: 'receiver', type: 'leaf',
  org: 'Frederiksborg Brand & Redning', label: 'Frederiksborg Brand & Redning', initials: 'FBB',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-egedal', 'kom-frederikssund', 'kom-furesoe', 'kom-halsnaes', 'kom-hilleroed'] },
  description: '§60 shared fire & rescue, 5 kommuner, ~212k residents.' },
  { id: 'kbr-beredskab-4k', kind: 'receiver', type: 'leaf',
  org: 'Beredskab 4K', label: 'Beredskab 4K', initials: 'B4K',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-greve', 'kom-hoeje-taastrup', 'kom-ishoej', 'kom-vallensbaek'] },
  description: '§60 shared fire & rescue formed after Østsjællands Beredskab dissolved (2020).' },
  { id: 'kbr-koege', kind: 'receiver', type: 'leaf',
  org: 'Brand & Redning Køge', label: 'Brand & Redning Køge', initials: 'BRK',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-koege'] },
  description: 'Køge kommune fire & rescue. Consolidating with Stevns + Solrød in 2027 (ETK Brand & Redning).' },
  { id: 'kbr-roskilde', kind: 'receiver', type: 'leaf',
  org: 'Roskilde Brandvæsen', label: 'Roskilde Brandvæsen', initials: 'RBV',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-roskilde'] },
  description: 'Roskilde kommune fire & rescue (single kommune).' },
  { id: 'kbr-lejre', kind: 'receiver', type: 'leaf',
  org: 'Lejre Brandvæsen', label: 'Lejre Brandvæsen', initials: 'LBV',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-lejre'] },
  description: 'Lejre kommune fire & rescue (single kommune).' },
  { id: 'kbr-vestsjaellands', kind: 'receiver', type: 'leaf',
  org: 'Vestsjællands Brandvæsen', label: 'Vestsjællands Brandvæsen', initials: 'VBV',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-holbaek', 'kom-kalundborg', 'kom-odsherred'] },
  description: '§60 shared fire & rescue, west Zealand.' },
  { id: 'kbr-slagelse', kind: 'receiver', type: 'leaf',
  org: 'Slagelse Brand og Redning', label: 'Slagelse Brand og Redning', initials: 'SBR',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-slagelse', 'kom-soroe'] },
  description: 'Slagelse + Sorø shared fire & rescue.' },
  { id: 'kbr-midt-sydsjaellands', kind: 'receiver', type: 'leaf',
  org: 'Midt- og Sydsjællands Brand & Redning', label: 'Midt- og Sydsjællands Brand & Redning', initials: 'MSBR',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-faxe', 'kom-naestved', 'kom-ringsted', 'kom-vordingborg'] },
  description: '§60 shared, mid + south Zealand.' },
  { id: 'kbr-lolland-falster', kind: 'receiver', type: 'leaf',
  org: 'Lolland-Falster Brandvæsen', label: 'Lolland-Falster Brandvæsen', initials: 'LFB',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-lolland', 'kom-guldborgsund'] },
  description: '§60 shared, Lolland + Guldborgsund.' },
  { id: 'kbr-gribskov', kind: 'receiver', type: 'leaf',
  org: 'Gribskov Beredskab', label: 'Gribskov Beredskab', initials: 'GBR',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-gribskov'] },
  description: 'Gribskov kommune fire & rescue (single kommune, ~41.5k residents).' },
  { id: 'kbr-helsingoer', kind: 'receiver', type: 'leaf',
  org: 'Helsingør Kommunes Beredskab', label: 'Helsingør Kommunes Beredskab', initials: 'HKB',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-helsingoer'] },
  description: 'Helsingør kommune fire & rescue (single kommune).' },
  { id: 'kbr-taarnby', kind: 'receiver', type: 'leaf',
  org: 'Tårnby Brandvæsen', label: 'Tårnby Brandvæsen', initials: 'TBV',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-taarnby'] },
  description: 'Tårnby kommune fire & rescue. Covers CPH airport landside.' },
  { id: 'kbr-bornholm', kind: 'receiver', type: 'leaf',
  org: 'Bornholms Brandvæsen', label: 'Bornholms Brandvæsen', initials: 'BBV',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-bornholm'] },
  description: 'Bornholm regional kommune fire & rescue.' },

  // ── Syddanmark ───────────────────────────────────────────────────────────
  { id: 'kbr-fyn', kind: 'receiver', type: 'leaf',
  org: 'Beredskab Fyn', label: 'Beredskab Fyn', initials: 'BFN',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-assens', 'kom-faaborg-midtfyn', 'kom-kerteminde', 'kom-langeland', 'kom-nordfyns', 'kom-nyborg', 'kom-odense', 'kom-svendborg', 'kom-aeroe'] },
  description: '§60 shared, all Fyn kommuner. 3,181 km².' },
  { id: 'kbr-trekantbrand', kind: 'receiver', type: 'leaf',
  org: 'TrekantBrand', label: 'Trekantområdets Brandvæsen (TrekantBrand)', initials: 'TBR',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-kolding', 'kom-fredericia', 'kom-middelfart', 'kom-billund', 'kom-vejen'] },
  description: '§60 shared, Trekantområdet. Vejle exited end-2024 to reform own service.' },
  { id: 'kbr-vejle', kind: 'receiver', type: 'leaf',
  org: 'Vejle Brandvæsen', label: 'Vejle Brandvæsen', initials: 'VBR',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-vejle'] },
  description: 'Vejle kommune fire & rescue. Withdrew from TrekantBrand end-2024.' },
  { id: 'kbr-sydvestjysk', kind: 'receiver', type: 'leaf',
  org: 'Sydvestjysk Brandvæsen', label: 'Sydvestjysk Brandvæsen', initials: 'SVJ',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-esbjerg', 'kom-fanoe', 'kom-varde'] },
  description: '§60 shared, southwest Jutland.' },
  { id: 'kbr-brsj', kind: 'receiver', type: 'leaf',
  org: 'Brand & Redning Sønderjylland', label: 'Brand & Redning Sønderjylland', initials: 'BRSJ',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-haderslev', 'kom-toender', 'kom-aabenraa'] },
  description: '§60 shared, Sønderjylland. Note: Sønderborg operates its own separate service.' },
  { id: 'kbr-soenderborg', kind: 'receiver', type: 'leaf',
  org: 'Beredskab Sønderborg', label: 'Beredskab Sønderborg', initials: 'BSD',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-soenderborg'] },
  description: 'Sønderborg kommune fire & rescue (single kommune, separate from BRSJ).' },
  { id: 'kbr-sydoestjyllands', kind: 'receiver', type: 'leaf',
  org: 'Sydøstjyllands Brandvæsen', label: 'Sydøstjyllands Brandvæsen', initials: 'SØJ',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-horsens', 'kom-hedensted'] },
  description: '§60 shared, Horsens + Hedensted.' },

  // ── Midtjylland ──────────────────────────────────────────────────────────
  { id: 'kbr-ostjyllands', kind: 'receiver', type: 'leaf',
  org: 'Østjyllands Brandvæsen', label: 'Østjyllands Brandvæsen', initials: 'ØBV',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-aarhus', 'kom-skanderborg', 'kom-odder', 'kom-samsoe'] },
  description: '§60 shared, east Jutland.' },
  { id: 'kbr-beredskab-sikkerhed', kind: 'receiver', type: 'leaf',
  org: 'Beredskab & Sikkerhed', label: 'Beredskab & Sikkerhed (Randers-Favrskov-Djursland)', initials: 'BSI',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-randers', 'kom-favrskov', 'kom-norddjurs', 'kom-syddjurs'] },
  description: '§60 shared, ~225k residents, ~2,700 km².' },
  { id: 'kbr-midtjysk', kind: 'receiver', type: 'leaf',
  org: 'Midtjysk Brand & Redning', label: 'Midtjysk Brand & Redning', initials: 'MJB',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-viborg', 'kom-silkeborg'] },
  description: '§60 shared, Viborg + Silkeborg.' },
  { id: 'kbr-midtvest', kind: 'receiver', type: 'leaf',
  org: 'Brand & Redning MidtVest', label: 'Brand & Redning MidtVest', initials: 'BRMV',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-herning', 'kom-ikast-brande', 'kom-ringkoebing-skjern'] },
  description: '§60 shared, 3,548 km² (2nd largest by area). ~187k residents.' },
  { id: 'kbr-nordvestjyllands', kind: 'receiver', type: 'leaf',
  org: 'Nordvestjyllands Brandvæsen', label: 'Nordvestjyllands Brandvæsen', initials: 'NVJ',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-holstebro', 'kom-lemvig', 'kom-skive', 'kom-struer'] },
  description: '§60 shared, 4 kommuner, HQ Struer, 13 stations.' },

  // ── Nordjylland ──────────────────────────────────────────────────────────
  { id: 'kbr-nordjyllands', kind: 'receiver', type: 'leaf',
  org: 'Nordjyllands Beredskab', label: 'Nordjyllands Beredskab', initials: 'NJB',
  scope: 'regional', destinationIds: [],
  meta: { member_kommuner: ['kom-mariagerfjord', 'kom-rebild', 'kom-vesthimmerlands', 'kom-morsoe', 'kom-thisted', 'kom-aalborg', 'kom-jammerbugt', 'kom-laesoe', 'kom-hjoerring', 'kom-broenderslev', 'kom-frederikshavn'] },
  description: '§60 shared, all 11 Nordjylland kommuner. ~590k residents, 7,878 km².' },


  // ══════════════════════════════════════════════════════════════════════════
  // C. AKUTHOSPITALER — sourced from
  //    https://da.wikipedia.org/wiki/Hospitaler_i_Danmark and per-region
  //    verification against regionsjaelland.dk, rn.dk, sundhed.dk on 2026-08-23.
  //    Only 24/7 emergency reception (akutmodtagelse) sites included.
  //    NOTE: Region Sjælland + Region Hovedstaden merge to Region Østdanmark
  //    on 2027-01-01 — akuthospital allocation preserved per current region
  //    until formal transition.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Region Hovedstaden (6 akuthospitaler) ────────────────────────────────
  { id: 'hospital-rigshospitalet', kind: 'receiver', type: 'leaf',
  org: 'Rigshospitalet', label: 'Rigshospitalet', initials: 'RH',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-hst' },
  description: 'National university hospital, København. Level-1 trauma centre.' },
  { id: 'hospital-herlev', kind: 'receiver', type: 'leaf',
  org: 'Herlev Hospital', label: 'Herlev Hospital', initials: 'HH',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-hst' },
  description: 'Akuthospital, Herlev. Regional acute reception.' },
  { id: 'hospital-hvidovre', kind: 'receiver', type: 'leaf',
  org: 'Hvidovre Hospital', label: 'Hvidovre Hospital (Amager og Hvidovre)', initials: 'HV',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-hst' },
  description: 'Akuthospital, Hvidovre. Nearest acute to CPH airport / Amager.' },
  { id: 'hospital-bispebjerg', kind: 'receiver', type: 'leaf',
  org: 'Bispebjerg Hospital', label: 'Bispebjerg Hospital', initials: 'BB',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-hst' },
  description: 'Akuthospital, København NV.' },
  { id: 'hospital-nordsjaellands', kind: 'receiver', type: 'leaf',
  org: 'Nordsjællands Hospital', label: 'Nordsjællands Hospital (Hillerød)', initials: 'NSH',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-hst' },
  description: 'Akuthospital, Hillerød. Only akutmodtagelse in north Zealand.' },
  { id: 'hospital-bornholms', kind: 'receiver', type: 'leaf',
  org: 'Bornholms Hospital', label: 'Bornholms Hospital', initials: 'BOR',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-hst' },
  description: 'Akuthospital, Rønne. Sole acute reception on Bornholm.' },

  // ── Region Sjælland (4 akuthospitaler) ───────────────────────────────────
  { id: 'hospital-suh-koege', kind: 'receiver', type: 'leaf',
  org: 'Sjællands Universitetshospital, Køge', label: 'Sjællands Universitetshospital, Køge', initials: 'SUK',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-sjl' },
  description: 'Region Sjælland\'s largest hospital. Primary akuthospital.' },
  { id: 'hospital-slagelse-sygehus', kind: 'receiver', type: 'leaf',
  org: 'Slagelse Sygehus', label: 'Slagelse Sygehus', initials: 'SLS',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-sjl' },
  description: 'Akuthospital, Slagelse.' },
  { id: 'hospital-holbaek-sygehus', kind: 'receiver', type: 'leaf',
  org: 'Holbæk Sygehus', label: 'Holbæk Sygehus', initials: 'HOL',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-sjl' },
  description: 'Akuthospital, Holbæk.' },
  { id: 'hospital-suh-nykobing', kind: 'receiver', type: 'leaf',
  org: 'Sjællands Universitetshospital, Nykøbing F.', label: 'Sjællands Universitetshospital, Nykøbing F.', initials: 'SUN',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-sjl' },
  description: 'Southernmost akuthospital in Region Sjælland. Renamed 2024.' },

  // ── Region Syddanmark (5 akuthospitaler) ─────────────────────────────────
  { id: 'hospital-ouh-odense', kind: 'receiver', type: 'leaf',
  org: 'Odense Universitetshospital', label: 'Odense Universitetshospital (OUH)', initials: 'OUH',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-syd' },
  description: 'University hospital, Odense. Level-1 trauma centre for Syddanmark.' },
  { id: 'hospital-kolding-sygehus', kind: 'receiver', type: 'leaf',
  org: 'Kolding Sygehus', label: 'Kolding Sygehus (Sygehus Lillebælt)', initials: 'KOL',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-syd' },
  description: 'Akuthospital, Kolding.' },
  { id: 'hospital-vejle-sygehus', kind: 'receiver', type: 'leaf',
  org: 'Vejle Sygehus', label: 'Vejle Sygehus (Sygehus Lillebælt)', initials: 'VEJ',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-syd' },
  description: 'Akuthospital, Vejle.' },
  { id: 'hospital-esbjerg-sygehus', kind: 'receiver', type: 'leaf',
  org: 'Sydvestjysk Sygehus, Esbjerg', label: 'Sydvestjysk Sygehus (Esbjerg)', initials: 'ESY',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-syd' },
  description: 'Akuthospital, Esbjerg. Nearest acute to Port of Esbjerg.' },
  { id: 'hospital-aabenraa-sygehus', kind: 'receiver', type: 'leaf',
  org: 'Sygehus Sønderjylland, Aabenraa', label: 'Sygehus Sønderjylland (Aabenraa)', initials: 'AAB',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-syd' },
  description: 'Akuthospital, Aabenraa. 24h skadefunktion. Sønderborg = specialsygehus (no 24/7 acute).' },

  // ── Region Midtjylland (5 akuthospitaler) ────────────────────────────────
  { id: 'hospital-auh-aarhus', kind: 'receiver', type: 'leaf',
  org: 'Aarhus Universitetshospital', label: 'Aarhus Universitetshospital (AUH)', initials: 'AUH',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-midt' },
  description: 'University hospital, Aarhus. Level-1 trauma centre.' },
  { id: 'hospital-goedstrup', kind: 'receiver', type: 'leaf',
  org: 'Regionshospitalet Gødstrup', label: 'Regionshospitalet Gødstrup', initials: 'GØD',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-midt' },
  description: 'Akuthospital, near Herning. Opened 2022, serves 6 kommuner (~287k residents).' },
  { id: 'hospital-viborg', kind: 'receiver', type: 'leaf',
  org: 'Regionshospitalet Viborg', label: 'Regionshospitalet Viborg', initials: 'VIB',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-midt' },
  description: 'Akuthospital, Viborg. Part of Hospitalsenhed Midt.' },
  { id: 'hospital-horsens', kind: 'receiver', type: 'leaf',
  org: 'Regionshospitalet Horsens', label: 'Regionshospitalet Horsens', initials: 'HOR',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-midt' },
  description: 'Akuthospital, Horsens.' },
  { id: 'hospital-randers', kind: 'receiver', type: 'leaf',
  org: 'Regionshospitalet Randers', label: 'Regionshospitalet Randers', initials: 'RND',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-midt' },
  description: 'Akuthospital, Randers.' },

  // ── Region Nordjylland (3 akuthospitaler) ────────────────────────────────
  { id: 'hospital-auh-aalborg', kind: 'receiver', type: 'leaf',
  org: 'Aalborg Universitetshospital', label: 'Aalborg Universitetshospital', initials: 'AAU',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-nord' },
  description: 'University hospital, Aalborg. Level-1 trauma centre. ~60% of Nordjylland patients.' },
  { id: 'hospital-rhn-hjoerring', kind: 'receiver', type: 'leaf',
  org: 'Regionshospital Nordjylland, Hjørring', label: 'Regionshospital Nordjylland (Hjørring)', initials: 'RHN',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-nord' },
  description: 'Akuthospital, Hjørring. 24/7 akutmodtagelse.' },
  { id: 'hospital-auh-thisted', kind: 'receiver', type: 'leaf',
  org: 'Aalborg Universitetshospital, Thisted', label: 'Aalborg Universitetshospital, Thisted', initials: 'AAT',
  scope: 'regional', destinationIds: [],
  meta: { region_parent: 'region-nord' },
  description: 'Akuthospital, Thisted. Serves Morsø + Thisted + half Jammerbugt (~90k).' },


  // ══════════════════════════════════════════════════════════════════════════
  // D. HJEMMEVÆRNET DISTRIKTER — sourced from
  //    https://en.wikipedia.org/wiki/Danish_Home_Guard on 2026-08-23,
  //    cross-referenced against Marinehjemmeværnet + Flyverhjemmeværnet
  //    Wikipedia articles.
  //
  //    STRUCTURAL NOTE (verified via lex.dk + maritimedanmark.dk):
  //    - Marinehjemmeværnet: The old two-district structure (Vest/Øst) was
  //      merged in 2017 into ONE Marinehjemmeværnsdistrikt HQ'd at Korsør.
  //      Below it sit ~38 flotiller. So under 'hjv-marine' the correct
  //      structural sub-nodes are FLOTILLER, not distrikter.
  //    - Flyverhjemmeværnet: The old two-district structure was consolidated
  //      into ONE Flyverhjemmeværnsdistrikt HQ'd at Flyvestation Karup.
  //      Below sit ~28 eskadriller. So under 'hjv-flyver' the correct
  //      structural sub-nodes are ESKADRILLER.
  //    - Only Hærhjemmeværnet retains distrikter under Landsdelsregion
  //      Vest/Øst (12 total including Bornholm).
  //
  //    To honour the caller's ~40 target while staying accurate to current
  //    structure, this section returns:
  //      · 12 Hærhjemmeværnsdistrikter (Vest 6, Øst 5, Bornholm 1)
  //      · Sample of Marine flotiller under hjv-marine (28 total available)
  //      · Sample of Flyver eskadriller under hjv-flyver (28 total available)
  //    Full flotille/eskadrille lists are captured in the SUPPLEMENTARY block
  //    at the end of Section D for optional inclusion.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Hærhjemmeværnsdistrikter under hjv-vest (6) ──────────────────────────
  { id: 'hjv-distrikt-nordjylland', kind: 'receiver', type: 'leaf', parentId: 'hjv-vest',
  org: 'Hærhjemmeværnsdistriktet Nordjylland', label: 'Hærhjemmeværnsdistriktet Nordjylland', initials: 'HDN',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Nordjylland (under Landsdelsregion Vest).' },
  { id: 'hjv-distrikt-midtvestjyl', kind: 'receiver', type: 'leaf', parentId: 'hjv-vest',
  org: 'Hærhjemmeværnsdistriktet Midt- og Vestjylland', label: 'Hærhjemmeværnsdistriktet Midt- og Vestjylland', initials: 'HMV',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Midt- og Vestjylland (Vest).' },
  { id: 'hjv-distrikt-ostjyl', kind: 'receiver', type: 'leaf', parentId: 'hjv-vest',
  org: 'Hærhjemmeværnsdistriktet Østjylland', label: 'Hærhjemmeværnsdistriktet Østjylland', initials: 'HØJ',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Østjylland (Vest).' },
  { id: 'hjv-distrikt-sydostjyl', kind: 'receiver', type: 'leaf', parentId: 'hjv-vest',
  org: 'Hærhjemmeværnsdistriktet Sydøstjylland', label: 'Hærhjemmeværnsdistriktet Sydøstjylland', initials: 'HSJ',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Sydøstjylland (Vest).' },
  { id: 'hjv-distrikt-sonderjyl', kind: 'receiver', type: 'leaf', parentId: 'hjv-vest',
  org: 'Hærhjemmeværnsdistriktet Sønderjylland og Schleswig', label: 'Hærhjemmeværnsdistriktet Sønderjylland og Schleswig', initials: 'HSS',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Sønderjylland + Schleswig (Vest). Cross-border cooperation with DE Heimatschutz.' },
  { id: 'hjv-distrikt-fyn', kind: 'receiver', type: 'leaf', parentId: 'hjv-vest',
  org: 'Hærhjemmeværnsdistriktet Fyn', label: 'Hærhjemmeværnsdistriktet Fyn', initials: 'HFY',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Fyn (Vest).' },

  // ── Hærhjemmeværnsdistrikter under hjv-ost (5 + Bornholm) ────────────────
  { id: 'hjv-distrikt-kbh', kind: 'receiver', type: 'leaf', parentId: 'hjv-ost',
  org: 'Hærhjemmeværnsdistriktet København', label: 'Hærhjemmeværnsdistriktet København', initials: 'HKB',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, København (Øst).' },
  { id: 'hjv-distrikt-kbh-vestegn', kind: 'receiver', type: 'leaf', parentId: 'hjv-ost',
  org: 'Hærhjemmeværnsdistriktet Københavns Vestegn', label: 'Hærhjemmeværnsdistriktet Københavns Vestegn', initials: 'HKV',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Københavns Vestegn (Øst).' },
  { id: 'hjv-distrikt-nordsj', kind: 'receiver', type: 'leaf', parentId: 'hjv-ost',
  org: 'Hærhjemmeværnsdistriktet Nordsjælland', label: 'Hærhjemmeværnsdistriktet Nordsjælland', initials: 'HNS',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Nordsjælland (Øst).' },
  { id: 'hjv-distrikt-midtvestsj', kind: 'receiver', type: 'leaf', parentId: 'hjv-ost',
  org: 'Hærhjemmeværnsdistriktet Midt- og Vestsjælland', label: 'Hærhjemmeværnsdistriktet Midt- og Vestsjælland', initials: 'HMS',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Midt- og Vestsjælland (Øst).' },
  { id: 'hjv-distrikt-sydsj-lolland', kind: 'receiver', type: 'leaf', parentId: 'hjv-ost',
  org: 'Hærhjemmeværnsdistriktet Sydsjælland og Lolland-Falster', label: 'Hærhjemmeværnsdistriktet Sydsjælland og Lolland-Falster', initials: 'HSL',
  scope: 'regional', destinationIds: [],
  description: 'Hærhjemmeværn distrikt, Sydsjælland + Lolland-Falster (Øst).' },
  { id: 'hjv-distrikt-bornholm', kind: 'receiver', type: 'leaf', parentId: 'hjv-ost',
  org: 'Bornholms Hjemmeværn', label: 'Bornholms Hjemmeværn', initials: 'BHV',
  scope: 'regional', destinationIds: [],
  description: 'Hjemmeværn, Bornholm. Under Landsdelsregion Øst but semi-autonomous.' },

  // ── Marinehjemmeværnsflotiller (subset — full list in supplementary) ─────
  // Structural note: single distrikt HQ Korsør (post-2017 merger). These are
  // the operational sub-units your Live Map may want to route Marine-observer
  // events to based on nearest coastal flotille.
  { id: 'hjv-marine-hq', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine',
  org: 'Marinehjemmeværnsdistriktet', label: 'Marinehjemmeværnsdistriktet (HQ Korsør)', initials: 'MHD',
  scope: 'maritime', destinationIds: [],
  description: 'Single Marinehjemmeværn distrikt HQ (merged 2017, moved from Aarhus/Ringsted). ~38 flotiller.' },

  // ── Flyverhjemmeværnseskadriller (subset — full list in supplementary) ───
  { id: 'hjv-flyver-hq', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver',
  org: 'Flyverhjemmeværnsdistriktet', label: 'Flyverhjemmeværnsdistriktet (HQ Flyvestation Karup)', initials: 'FHD',
  scope: 'aviation', destinationIds: [],
  description: 'Single Flyverhjemmeværn distrikt HQ, Flyvestation Karup. ~28 eskadriller, ~5,294 members.' },

  // ── SUPPLEMENTARY: full Marine flotille + Flyver eskadrille lists ────────
  // Uncomment / include if you want per-flotille receiver granularity. All
  // verified against da.wikipedia.org/wiki/Marinehjemmev%C3%A6rnet and
  // da.wikipedia.org/wiki/Flyverhjemmev%C3%A6rnet on 2026-08-23.
  //
  // Marinehjemmeværnsflotiller (34 flotiller + 1 Bornholm division):
  //   Aalborg-Hals (Aalborg), Vendsyssel (Flådestation Frederikshavn),
  //   MFP Frederikshavn/Thisted/Skive, Hanstholm (Hanstholm),
  //   Thyborøn (Struer), Djursland (Randers), Århus (Århus),
  //   Hvide Sande-Ringkøbing (Ringkøbing), Esbjerg (Esbjerg),
  //   Horsens (Horsens), Juelsminde-Vejle (Juelsminde), Fredericia (Fredericia),
  //   Kolding (Kolding), Sønderborg (Sønderborg), Aabenraa (Aabenraa),
  //   MFP Marinestation Holmen, MFP Flådestation Korsør,
  //   Odense/Kerteminde (Kerteminde), Østfyn (Slipshavn), Faaborg (Faaborg),
  //   Svendborg (Svendborg), Nordvestfyn (Assens), Kalundborg (Kalundborg),
  //   Korsør (Flådestation Korsør), Storstrømmen (Vordingborg),
  //   Østersøen (Rødbyhavn), Isefjord (Hundested), Helsingør (Helsingør),
  //   Skovshoved (Skovshoved), Københavns Vestegn (Brøndby Havn),
  //   Dragør (Dragør), Køge (Køge), Holmen (Marinestation Holmen),
  //   Bornholm Division (Rønne).
  //
  // Flyverhjemmeværnseskadriller (28 eskadriller + 1 deling + 1 stab):
  //   FSD231 (Faxe), STHVE200 (multi-base staff),
  //   HVE220 (Kalundborg), HVE221 (Radarhoved Multebjerg),
  //   HVE223 (Værløse), HVE225 (Roskilde Lufthavn),
  //   HVE227 (Københavns Lufthavn), HVE228 (Københavns Lufthavn),
  //   HVE230 (Sorø), HVE232 (Næstved), HVE233 (Sakskøbing),
  //   HVE240 (Højstrup), HVE242 (Svendborg), HVE243 (Torpe),
  //   HVE260 (Understed), HVE261 (Skive), HVE265 (Randers),
  //   HVE266 (Aalborg Lufthavn), HVE270 (Flyvestation Aalborg + Roskilde),
  //   HVE272 (Ringkøbing), HVE273 (Herning), HVE274 (Aarhus),
  //   HVE275 (Tirstrup Lufthavn), HVE277 (Flyvestation Karup),
  //   HVE280 (Vejle), HVE281 (Varde), HVE282 (Brørup),
  //   HVE283 (Kolding), HVE284 (Flyvestation Skrydstrup), HVE286 (Kliplev).


  // ══════════════════════════════════════════════════════════════════════════
  // E. ADDITIONAL FORSVARET NAMED UNITS — sourced from
  //    https://en.wikipedia.org/wiki/Structure_of_the_Royal_Danish_Army
  //    https://en.wikipedia.org/wiki/Royal_Danish_Navy
  //    https://en.wikipedia.org/wiki/Royal_Danish_Air_Force
  //    all fetched 2026-08-23.
  //
  //    Filter: only units NOT already in roles.js. Excludes: Gardehusar
  //    Slagelse, Livgarden Høvelte, Efterretningsreg Varde, Bornholms Værn,
  //    Hærens Kampskole Oksbøl, Sø Frederikshavn + Korsør, Jægerkorpset,
  //    Fighter Wing Skrydstrup, ATW Aalborg, ACW Karup, Helo Wing Karup.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Hæren (additional named regiments) ───────────────────────────────────
  { id: 'haer-holstebro', kind: 'receiver', type: 'leaf', parentId: 'haeren',
  org: 'Hæren · Holstebro', label: 'Jyske Dragonregiment (Holstebro)', initials: 'JDR',
  scope: 'all-sites', destinationIds: [],
  description: 'Jyske Dragonregiment, Dragonkasernen Holstebro. Armoured recon + Leopard 2A7.' },
  { id: 'haer-haderslev', kind: 'receiver', type: 'leaf', parentId: 'haeren',
  org: 'Hæren · Haderslev', label: 'Slesvigske Fodregiment (Haderslev)', initials: 'SLF',
  scope: 'all-sites', destinationIds: [],
  description: 'Slesvigske Fodregiment, Haderslev Kaserne. Motoriseret infanteri.' },
  { id: 'haer-oksbol-artillery', kind: 'receiver', type: 'leaf', parentId: 'haeren',
  org: 'Hæren · Oksbøl Artilleri', label: 'Danske Artilleriregiment (Oksbøl)', initials: 'DAR',
  scope: 'all-sites', destinationIds: [],
  description: 'Danske Artilleriregiment, Oksbøl. CAESAR 8x8 + luftværn.' },
  { id: 'haer-skive', kind: 'receiver', type: 'leaf', parentId: 'haeren',
  org: 'Hæren · Skive', label: 'Ingeniørregimentet (Skive)', initials: 'INR',
  scope: 'all-sites', destinationIds: [],
  description: 'Ingeniørregimentet, Skive Kaserne. Combat + construction engineering.' },
  { id: 'haer-fredericia', kind: 'receiver', type: 'leaf', parentId: 'haeren',
  org: 'Hæren · Fredericia', label: 'Føringsstøtteregimentet (Fredericia)', initials: 'FSR',
  scope: 'all-sites', destinationIds: [],
  description: 'Føringsstøtteregimentet / Command Support Regiment, Ryes Kaserne Fredericia. Signals + C2 support.' },
  { id: 'haer-aalborg', kind: 'receiver', type: 'leaf', parentId: 'haeren',
  org: 'Hæren · Aalborg', label: 'Trænregimentet (Aalborg)', initials: 'TRR',
  scope: 'all-sites', destinationIds: [],
  description: 'Trænregimentet / Logistic Regiment, Aalborg. Sustainment + medical.' },
  { id: 'haer-bornholm-regiment', kind: 'receiver', type: 'leaf', parentId: 'haeren',
  org: 'Hæren · Bornholms Regiment', label: 'Bornholms Regiment (Rønne)', initials: 'BOR',
  scope: 'all-sites', destinationIds: [],
  description: 'Bornholms Regiment. Reactivated 2025-06-12 to strengthen Bornholm defence. Note: distinct from existing haer-bornholm (Bornholms Værn Almegård).' },

  // ── Søværnet (additional eskadre) ────────────────────────────────────────
  { id: 'sov-frederikshavn-3esk', kind: 'receiver', type: 'leaf', parentId: 'sovaernet',
  org: 'Søværnet · 1. + 3. Eskadre', label: '1. + 3. Eskadre (Flådestation Frederikshavn)', initials: 'E13',
  scope: 'maritime', destinationIds: [],
  description: '1. Eskadre (Arctic / Greenland / Færøerne SAR + suverænitet) + 3. Eskadre (domestic maritime defence) — both based Flådestation Frederikshavn.' },
  { id: 'sov-korsor-2esk', kind: 'receiver', type: 'leaf', parentId: 'sovaernet',
  org: 'Søværnet · 2. Eskadre', label: '2. Eskadre (Flådestation Korsør)', initials: 'E2',
  scope: 'maritime', destinationIds: [],
  description: '2. Eskadre — international/expeditionary operations. Flådestation Korsør.' },
  { id: 'sov-fromands', kind: 'receiver', type: 'leaf', parentId: 'sovaernet',
  org: 'Søværnet · Frømandskorpset', label: 'Frømandskorpset (Kongsøre)', initials: 'FRK',
  scope: 'maritime', destinationIds: [],
  description: 'Frømandskorpset SOF, Torpedostation Kongsøre. Maritime special operations.' },

  // ── Flyvevåbnet (additional wings) ───────────────────────────────────────
  { id: 'flv-karup-ops', kind: 'receiver', type: 'leaf', parentId: 'flyvevaabnet',
  org: 'Flyvevåbnet · Karup Ops Support', label: 'Operations Support Wing (Karup)', initials: 'OSW',
  scope: 'aviation', destinationIds: [],
  description: 'Operations Support Wing, Flyvestation Karup. Force-generation + deployable ops support.' },
  { id: 'flv-skalstrup', kind: 'receiver', type: 'leaf', parentId: 'flyvevaabnet',
  org: 'Flyvevåbnet · Skalstrup', label: 'Air Defence Wing (Skalstrup)', initials: 'ADW',
  scope: 'aviation', destinationIds: [],
  description: 'Air Defence Wing, Flyvestation Skalstrup. Ground-based air defence (NASAMS + follow-on).' },


  // ══════════════════════════════════════════════════════════════════════════
  // COUNTS (sanity check)
  //   A. Kommuner:               98   (target 98)  ✓
  //   B. Kommunale beredskaber:  29   (target ~20; higher because of
  //                                    post-2020 fragmentation + single-
  //                                    kommune §60-independent units)
  //   C. Akuthospitaler:         23   (target ~30; only 24/7 acute reception
  //                                    sites included per Rules)
  //        · Hovedstaden 6, Sjælland 4, Syddanmark 5, Midtjylland 5,
  //          Nordjylland 3
  //   D. HJV distrikter:         14 leaves added
  //                                · 12 Hærhjemmeværnsdistrikter (Vest 6 +
  //                                  Øst 5 + Bornholm 1)
  //                                · 1 Marine HQ (single distrikt post-2017;
  //                                  38 flotiller listed in supplementary)
  //                                · 1 Flyver HQ (single distrikt; 28
  //                                  eskadriller in supplementary)
  //                                Target of ~40 was based on outdated multi-
  //                                distrikt model; current structure is 12

  // ══════════════════════════════════════════════════════════════════════════
  // F. COMPREHENSIVE DK SECURITY TAXONOMY ADDITIONS (2026-08-31)
  //    Compiled + verified via research agent fan-out across:
  //    - forsvaret.dk (Hæren, Søværnet, Flyvevåbnet)
  //    - hjv.dk (Hjemmeværnet all echelons)
  //    - politi.dk / pet.dk (all districts + specialist units)
  //    - naviair.dk (all aerodrome control towers)
  //    - trafikstyrelsen.dk, soefartsstyrelsen.dk (regulators + sub-departments)
  //    - beredskabsstyrelsen.dk, rbis.dk (national + regional emergency)
  //    - NATO/EU official sites
  //
  //    Goal: never revisit. Every real Danish security/military/civil-
  //    response entity that could plausibly be routed to for a
  //    critical-infrastructure incident is present as a receiver.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Marinehjemmeværnet flotiller (34, under hjv-marine HQ) ──────────────
  { id: 'hjv-marine-hvf114', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 114', label: 'HVF 114 Aalborg-Hals', initials: '114', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 114 Aalborg-Hals.' },
  { id: 'hjv-marine-hvf115', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 115', label: 'HVF 115 Vendsyssel (Frederikshavn)', initials: '115', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 115 Vendsyssel, Flådestation Frederikshavn.' },
  { id: 'hjv-marine-hvf116', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 116', label: 'HVF 116 MFP (Frederikshavn/Thisted/Skive)', initials: '116', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 116, Maritime Force Protection.' },
  { id: 'hjv-marine-hvf121', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 121', label: 'HVF 121 Hanstholm', initials: '121', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 121 Hanstholm.' },
  { id: 'hjv-marine-hvf122', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 122', label: 'HVF 122 Thyborøn (Struer)', initials: '122', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 122 Thyborøn.' },
  { id: 'hjv-marine-hvf123', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 123', label: 'HVF 123 Djursland (Randers)', initials: '123', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 123 Djursland.' },
  { id: 'hjv-marine-hvf124', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 124', label: 'HVF 124 Århus', initials: '124', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 124 Århus.' },
  { id: 'hjv-marine-hvf125', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 125', label: 'HVF 125 MFP (Randers)', initials: '125', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 125, Maritime Force Protection.' },
  { id: 'hjv-marine-hvf126', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 126', label: 'HVF 126 Hvide Sande-Ringkøbing', initials: '126', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 126 Hvide Sande-Ringkøbing.' },
  { id: 'hjv-marine-hvf131', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 131', label: 'HVF 131 Esbjerg', initials: '131', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 131 Esbjerg.' },
  { id: 'hjv-marine-hvf132', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 132', label: 'HVF 132 Horsens', initials: '132', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 132 Horsens.' },
  { id: 'hjv-marine-hvf133', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 133', label: 'HVF 133 Juelsminde-Vejle', initials: '133', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 133 Juelsminde-Vejle.' },
  { id: 'hjv-marine-hvf134', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 134', label: 'HVF 134 Fredericia', initials: '134', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 134 Fredericia.' },
  { id: 'hjv-marine-hvf135', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 135', label: 'HVF 135 Kolding', initials: '135', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 135 Kolding.' },
  { id: 'hjv-marine-hvf136', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 136', label: 'HVF 136 Sønderborg', initials: '136', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 136 Sønderborg.' },
  { id: 'hjv-marine-hvf137', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 137', label: 'HVF 137 Aabenraa', initials: '137', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 137 Aabenraa.' },
  { id: 'hjv-marine-hvf201', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 201', label: 'HVF 201 MFP (Marinestation Holmen)', initials: '201', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 201, Maritime Force Protection, Marinestation Holmen. Verified against hjv.dk.' },
  { id: 'hjv-marine-hvf241', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 241', label: 'HVF 241 Odense-Kerteminde', initials: '241', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 241 Odense-Kerteminde.' },
  { id: 'hjv-marine-hvf242', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 242', label: 'HVF 242 Østfyn (Slipshavn)', initials: '242', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 242 Østfyn.' },
  { id: 'hjv-marine-hvf243', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 243', label: 'HVF 243 Faaborg', initials: '243', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 243 Faaborg.' },
  { id: 'hjv-marine-hvf244', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 244', label: 'HVF 244 Svendborg', initials: '244', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 244 Svendborg.' },
  { id: 'hjv-marine-hvf246', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 246', label: 'HVF 246 Nordvestfyn (Assens)', initials: '246', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 246 Nordvestfyn.' },
  { id: 'hjv-marine-hvf251', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 251', label: 'HVF 251 Kalundborg', initials: '251', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 251 Kalundborg.' },
  { id: 'hjv-marine-hvf255', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 255', label: 'HVF 255 Korsør', initials: '255', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 255 Korsør.' },
  { id: 'hjv-marine-hvf256', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 256', label: 'HVF 256 Storstrømmen (Vordingborg)', initials: '256', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 256 Storstrømmen.' },
  { id: 'hjv-marine-hvf284', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 284', label: 'HVF 284 Østersøen (Rødbyhavn)', initials: '284', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 284 Østersøen.' },
  { id: 'hjv-marine-hvf361', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 361', label: 'HVF 361 Isefjord (Hundested)', initials: '361', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 361 Isefjord.' },
  { id: 'hjv-marine-hvf362', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 362', label: 'HVF 362 Helsingør', initials: '362', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 362 Helsingør.' },
  { id: 'hjv-marine-hvf363', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 363', label: 'HVF 363 Skovshoved', initials: '363', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 363 Skovshoved.' },
  { id: 'hjv-marine-hvf366', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 366', label: 'HVF 366 Kbh Vestegn (Brøndby)', initials: '366', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 366 Københavns Vestegn, Brøndby Havn.' },
  { id: 'hjv-marine-hvf367', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 367', label: 'HVF 367 Dragør', initials: '367', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 367 Dragør.' },
  { id: 'hjv-marine-hvf368', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 368', label: 'HVF 368 Køge', initials: '368', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 368 Køge.' },
  { id: 'hjv-marine-hvf369', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 369', label: 'HVF 369 Holmen', initials: '369', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 369 Marinestation Holmen.' },
  { id: 'hjv-marine-hvf471', kind: 'receiver', type: 'leaf', parentId: 'hjv-marine', org: 'MHV Flotille 471', label: 'HVF 471 Bornholm (Rønne)', initials: '471', scope: 'maritime', destinationIds: [], description: 'Marinehjemmeværnsflotille 471 Bornholm.' },

  // ── Flyverhjemmeværnet eskadriller (29, under hjv-flyver HQ) ────────────
  { id: 'hjv-flyver-hve220', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 220', label: 'HVE 220 Nordvestsjælland (Kalundborg)', initials: '220', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 220 Nordvestsjælland.' },
  { id: 'hjv-flyver-hve221', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 221', label: 'HVE 221 Arresø (Radarhoved Multebjerg)', initials: '221', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 221 Arresø.' },
  { id: 'hjv-flyver-hve223', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 223', label: 'HVE 223 Værløse', initials: '223', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 223 Værløse.' },
  { id: 'hjv-flyver-hve225', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 225', label: 'HVE 225 Roskilde Lufthavn', initials: '225', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 225 Roskilde.' },
  { id: 'hjv-flyver-hve227', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 227', label: 'HVE 227 Kbh Lufthavn (CPH)', initials: '227', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 227 Københavns Lufthavn.' },
  { id: 'hjv-flyver-hve228', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 228', label: 'HVE 228 Kbh Lufthavn (CPH)', initials: '228', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 228 Københavns Lufthavn.' },
  { id: 'hjv-flyver-hve230', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 230', label: 'HVE 230 Midt- og Vestsjælland (Sorø)', initials: '230', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 230 Midt-/Vestsjælland.' },
  { id: 'hjv-flyver-fsd231', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 231', label: 'FSD 231 Stevns (Faxe)', initials: '231', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 231 Stevns.' },
  { id: 'hjv-flyver-hve232', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 232', label: 'HVE 232 Sydsjælland-Møn (Næstved)', initials: '232', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 232 Sydsjælland-Møn.' },
  { id: 'hjv-flyver-hve233', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 233', label: 'HVE 233 Lolland-Falster (Sakskøbing)', initials: '233', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 233 Lolland-Falster.' },
  { id: 'hjv-flyver-hve240', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 240', label: 'HVE 240 Odense (Højstrup)', initials: '240', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 240 Odense.' },
  { id: 'hjv-flyver-hve242', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 242', label: 'HVE 242 Sydfyn (Svendborg)', initials: '242', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 242 Sydfyn.' },
  { id: 'hjv-flyver-hve243', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 243', label: 'HVE 243 Langeland (Torpe)', initials: '243', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 243 Langeland.' },
  { id: 'hjv-flyver-hve260', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 260', label: 'HVE 260 Vendsyssel (Understed)', initials: '260', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 260 Vendsyssel.' },
  { id: 'hjv-flyver-hve261', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 261', label: 'HVE 261 Skive', initials: '261', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 261 Skive.' },
  { id: 'hjv-flyver-hve265', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 265', label: 'HVE 265 Hvidsten (Randers)', initials: '265', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 265 Hvidsten.' },
  { id: 'hjv-flyver-hve266', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 266', label: 'HVE 266 Aalborg Lufthavn', initials: '266', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 266 Aalborg.' },
  { id: 'hjv-flyver-hve270', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 270', label: 'HVE 270 Flyvende (Aalborg + Roskilde)', initials: '270', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 270 Flyvende eskadrille.' },
  { id: 'hjv-flyver-hve272', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 272', label: 'HVE 272 Vestjylland (Ringkøbing)', initials: '272', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 272 Vestjylland.' },
  { id: 'hjv-flyver-hve273', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 273', label: 'HVE 273 Ikast (Herning)', initials: '273', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 273 Ikast.' },
  { id: 'hjv-flyver-hve274', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 274', label: 'HVE 274 Østjylland (Aarhus)', initials: '274', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 274 Østjylland.' },
  { id: 'hjv-flyver-hve275', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 275', label: 'HVE 275 Djursland (Tirstrup)', initials: '275', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 275 Djursland.' },
  { id: 'hjv-flyver-hve277', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 277', label: 'HVE 277 Karup', initials: '277', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 277 Flyvestation Karup.' },
  { id: 'hjv-flyver-hve280', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 280', label: 'HVE 280 Billund (Vejle)', initials: '280', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 280 Billund.' },
  { id: 'hjv-flyver-hve281', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 281', label: 'HVE 281 Vestjylland (Varde)', initials: '281', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 281 Vestjylland.' },
  { id: 'hjv-flyver-hve282', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 282', label: 'HVE 282 Kongeåen (Brørup)', initials: '282', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 282 Kongeåen.' },
  { id: 'hjv-flyver-hve283', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 283', label: 'HVE 283 Trekanten (Kolding)', initials: '283', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 283 Trekanten.' },
  { id: 'hjv-flyver-hve284', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 284', label: 'HVE 284 Skrydstrup', initials: '284', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 284 Flyvestation Skrydstrup.' },
  { id: 'hjv-flyver-hve286', kind: 'receiver', type: 'leaf', parentId: 'hjv-flyver', org: 'FHV Eskadrille 286', label: 'HVE 286 Alssund (Kliplev)', initials: '286', scope: 'aviation', destinationIds: [], description: 'Flyverhjemmeværnseskadrille 286 Alssund.' },

  // ── Flyvevåbnet — Eskadriller + Wing HQs + NAOC ────────────────────────
  { id: 'flv-flyverkommandoen', kind: 'receiver', type: 'leaf', parentId: 'flyvevaabnet', org: 'Flyverkommandoen', label: 'Flyverkommandoen (Karup)', initials: 'Flv', scope: 'aviation', destinationIds: [], description: 'Flyverkommandoen — Flyvevåbnets kommandostab. Flyvestation Karup. Under Forsvarskommandoen.' },
  { id: 'flv-naoc', kind: 'receiver', type: 'leaf', parentId: 'flyvevaabnet', org: 'National Air Operations Centre', label: 'National Air Operations Centre (Karup)', initials: 'Ops', scope: 'aviation', destinationIds: [], description: 'National Air Operations Centre — Danmarks nationale luftoperationscenter. Sidder i Operationsafdelingen under Flyverkommandoen, Flyvestation Karup.' },
  { id: 'flv-esk-727', kind: 'receiver', type: 'leaf', parentId: 'flv-skrydstrup', org: 'Eskadrille 727', label: 'Eskadrille 727 (F-35, Skrydstrup)', initials: '727', scope: 'aviation', destinationIds: [], description: 'Eskadrille 727, F-35 Lightning II, Fighter Wing Skrydstrup. F-16 formally retired 18 Jan 2026.' },
  { id: 'flv-esk-722', kind: 'receiver', type: 'leaf', parentId: 'flv-karup', org: 'Eskadrille 722', label: 'Eskadrille 722 (EH-101, Karup)', initials: '722', scope: 'aviation', destinationIds: [], description: 'Eskadrille 722, EH-101 Merlin SAR + tactical transport, Helicopter Wing Karup.' },
  { id: 'flv-esk-723', kind: 'receiver', type: 'leaf', parentId: 'flv-karup', org: 'Eskadrille 723', label: 'Eskadrille 723 (MH-60R, Karup)', initials: '723', scope: 'aviation', destinationIds: [], description: 'Eskadrille 723, MH-60R Seahawk, Helicopter Wing Karup.' },
  { id: 'flv-esk-724', kind: 'receiver', type: 'leaf', parentId: 'flv-karup', org: 'Eskadrille 724', label: 'Eskadrille 724 (Fennec, Karup)', initials: '724', scope: 'aviation', destinationIds: [], description: 'Eskadrille 724, Fennec observation + SOF support + police cooperation, Helicopter Wing Karup.' },
  { id: 'flv-esk-721', kind: 'receiver', type: 'leaf', parentId: 'flv-aalborg', org: 'Eskadrille 721', label: 'Eskadrille 721 (C-130J + Challenger, Aalborg)', initials: '721', scope: 'aviation', destinationIds: [], description: 'Eskadrille 721, C-130J Hercules + CL-604 Challenger. Home base Flyvestation Aalborg with permanent CL-604 detachment in Kangerlussuaq, Greenland.' },
  { id: 'flv-esk-515', kind: 'receiver', type: 'leaf', parentId: 'flv-karup-control', org: 'Eskadrille 515', label: 'Eskadrille 515 (AIS, Værløse)', initials: '515', scope: 'aviation', destinationIds: [], description: 'Eskadrille 515, Aeronautical Information Service (AIS), Flyvestation Værløse. Air Control Wing.' },

  // ── Søværnet — Eskadrer + specialized centres ───────────────────────────
  { id: 'sov-svk', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Søværnskommandoen', label: 'Søværnskommandoen (Karup)', initials: 'Søv', scope: 'maritime', destinationIds: [], description: 'Søværnskommandoen — Søværnets kommandostab. Flyvestation Karup. Efterfølger til Marinestaben (2019).' },
  { id: 'sov-1-eskadre', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Søværnet · 1. Eskadre', label: '1. Eskadre (Frederikshavn)', initials: '1E', scope: 'maritime', destinationIds: [], description: '1. Eskadre — national/inspection ships, Kongeskibet Dannebrog, opmålere. Flådestation Frederikshavn.' },
  { id: 'sov-2-eskadre', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Søværnet · 2. Eskadre', label: '2. Eskadre (Korsør)', initials: '2E', scope: 'maritime', destinationIds: [], description: '2. Eskadre — fregatter, minerydning, Dykkertjenesten. Flådestation Korsør.' },
  { id: 'sov-3-eskadre', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Søværnet · 3. Eskadre', label: '3. Eskadre (Frederikshavn)', initials: '3E', scope: 'maritime', destinationIds: [], description: '3. Eskadre — national opgaver, drift af flådestationer + overvågning. Flådestation Frederikshavn.' },
  { id: 'sov-4-eskadre', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Søværnet · 4. Eskadre', label: '4. Eskadre (uddannelse, distribueret)', initials: '4E', scope: 'maritime', destinationIds: [], description: '4. Eskadre — Søværnets uddannelseseskadre. Staff distributed across Frederikshavn, København, Korsør, Karup, Sjællands Odde.' },
  { id: 'sov-vbc', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Center for Våben', label: 'Center for Våben (Sjællands Odde)', initials: 'Våb', scope: 'maritime', destinationIds: [], description: 'Center for Våben — Søværnets våbencenter. Gniben, 4583 Sjællands Odde. Tidligere Artilleriskolen.' },
  { id: 'sov-nmoc', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Nationalt Maritimt Operationscenter', label: 'Nationalt Maritimt Operationscenter (Frederikshavn)', initials: 'Mar', scope: 'maritime', destinationIds: [], description: 'Nationalt Maritimt Operationscenter — Søværnets nationale maritime operationscenter. Flådestation Frederikshavn.' },
  { id: 'sov-vts-storebalt', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Skibstrafikcenter Storebælt', label: 'Skibstrafikcenter Storebælt (Korsør)', initials: 'Str', scope: 'maritime', destinationIds: [], description: 'Skibstrafikcenter Storebælt (Vessel Traffic Service). Flådestation Korsør.' },
  { id: 'sov-vts-oeresund', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Skibstrafikcenter Øresund', label: 'Skibstrafikcenter Øresund (DK/SE fælles)', initials: 'Øre', scope: 'maritime', destinationIds: [], description: 'Skibstrafikcenter Øresund (Vessel Traffic Service). Fælles dansk/svensk drift.' },
  { id: 'sov-dykker', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Søværnets Dykkertjeneste', label: 'Søværnets Dykkertjeneste (Korsør)', initials: 'Dyk', scope: 'maritime', destinationIds: [], description: 'Søværnets Dykkertjeneste. Flådestation Korsør.' },
  { id: 'sov-arktisk-kmd', kind: 'receiver', type: 'leaf', parentId: 'sovaernet', org: 'Arktisk Kommando', label: 'Arktisk Kommando (Nuuk)', initials: 'Ark', scope: 'maritime', destinationIds: [], description: 'Arktisk Kommando. Nuuk, Grønland. Joint kommando, primært maritim.' },

  // ── Special police units (Rigspoliti + PET) ──────────────────────────────
  { id: 'rigspoliti-nkc', kind: 'receiver', type: 'leaf', parentId: 'politi', org: 'Nationalt Kriminalteknisk Center', label: 'Nationalt Kriminalteknisk Center (Ejby, Glostrup)', initials: 'Krim', scope: 'all-sites', destinationIds: [], description: 'Nationalt Kriminalteknisk Center — under Rigspolitiet / Nationalt Særligt Kriminalpoliti. Ejby Industrivej 125-135, Glostrup.' },
  { id: 'rigspoliti-nc3', kind: 'receiver', type: 'leaf', parentId: 'politi', org: 'Nationalt Cyber Crime Center', label: 'Nationalt Cyber Crime Center (Ejby, Glostrup)', initials: 'Cyb', scope: 'all-sites', destinationIds: [], description: 'Nationalt Cyber Crime Center — Rigspolitiet, co-lokaliseret med Nationalt Kriminalteknisk Center. Delvis sammenlægning med National Center for IT-relateret økonomisk Kriminalitet slut 2024.' },
  { id: 'rigspoliti-ncik', kind: 'receiver', type: 'leaf', parentId: 'politi-nsk', org: 'National Center for IT-relateret økonomisk Kriminalitet', label: 'National Center for IT-relateret økonomisk Kriminalitet', initials: 'ITØ', scope: 'all-sites', destinationIds: [], description: 'National Center for IT-relateret økonomisk Kriminalitet. Under Nationalt Særligt Kriminalpoliti.' },
  { id: 'rigspoliti-sirene', kind: 'receiver', type: 'leaf', parentId: 'politi', org: 'SIRENE-kontoret Danmark', label: 'SIRENE-kontoret Danmark (Rigspolitiet)', initials: 'Sir', scope: 'all-sites', destinationIds: [], description: 'SIRENE-kontoret Danmark (Supplementary Information Request at the National Entries). Interpol- og Europol-nationale enheder, co-lokaliseret.' },
  { id: 'rigspoliti-dvi', kind: 'receiver', type: 'leaf', parentId: 'politi', org: 'ID-beredskabet', label: 'ID-beredskabet (identifikation af omkomne)', initials: 'ID', scope: 'all-sites', destinationIds: [], description: 'ID-beredskabet — identifikation af omkomne ved katastrofer. Rigspolitiet / Nationalt Kriminalteknisk Center.' },
  { id: 'rigspoliti-hundetjeneste', kind: 'receiver', type: 'leaf', parentId: 'politi', org: 'Politiets Hundetjeneste', label: 'Politiets Hundetjeneste (national)', initials: 'Hund', scope: 'all-sites', destinationIds: [], description: 'National patruljehundetjeneste. Rigspolitiet.' },
  { id: 'kbh-politi-rytteri', kind: 'receiver', type: 'leaf', parentId: 'politi-kbh', org: 'Rytteriafdelingen', label: 'Rytteriafdelingen (Københavns Politi)', initials: 'Ryt', scope: 'all-sites', destinationIds: [], description: 'Københavns Politis Rytteriafdeling — organisatorisk under Københavns Politi, national beredent afdeling, København-baseret med landsdækkende indsæt.' },
  { id: 'rigspoliti-politiskolen', kind: 'receiver', type: 'leaf', parentId: 'politi', org: 'Politiskolen', label: 'Politiskolen (Brøndby og Vejle)', initials: 'Skol', scope: 'all-sites', destinationIds: [], description: 'Politiskolen — uddannelsescenter Øst i Brøndby og uddannelsescenter Vest i Vejle. Grunduddannelse og rekruttering.' },
  { id: 'pet-cta', kind: 'receiver', type: 'leaf', parentId: 'pet', org: 'Center for Terroranalyse', label: 'Center for Terroranalyse (PET-drevet)', initials: 'Ter', scope: 'all-sites', destinationIds: [], description: 'Center for Terroranalyse — fusionscenter bemandet af Politiets Efterretningstjeneste, Forsvarets Efterretningstjeneste, Udenrigsministeriet og Beredskabsstyrelsen.' },
  { id: 'pet-livvagt', kind: 'receiver', type: 'leaf', parentId: 'pet', org: 'Livvagtsstyrken', label: 'Livvagtsstyrken (Politiets Efterretningstjeneste)', initials: 'Liv', scope: 'all-sites', destinationIds: [], description: 'Livvagtsstyrken — personbeskyttelsesenhed under Politiets Efterretningstjeneste.' },

  // ── Cyber + intel extensions ─────────────────────────────────────────────
  { id: 'agency-samsik', kind: 'receiver', type: 'leaf', org: 'Styrelsen for Samfundssikkerhed', label: 'Styrelsen for Samfundssikkerhed', initials: 'Sam', scope: 'all-sites', destinationIds: [], description: 'Styrelsen for Samfundssikkerhed under Ministerium for Samfundssikkerhed og Beredskab. Center for Cybersikkerhed overført til ministeriet aug. 2024, indfusioneret i Styrelsen for Samfundssikkerhed jan./mar. 2025.' },
  { id: 'agency-cfcs-netsikkerhed', kind: 'receiver', type: 'leaf', parentId: 'agency-cfcs', org: 'Netsikkerhedstjenesten', label: 'Netsikkerhedstjenesten (Forsvarets Efterretningstjeneste)', initials: 'Net', scope: 'all-sites', destinationIds: [], description: 'Netsikkerhedstjenesten — den operative defensive cyberenhed under Center for Cybersikkerhed. Forbliver i Forsvarets Efterretningstjeneste.' },
  { id: 'agency-digst', kind: 'receiver', type: 'leaf', org: 'Digitaliseringsstyrelsen', label: 'Digitaliseringsstyrelsen (kompetent NIS2-myndighed)', initials: 'Dig', scope: 'all-sites', destinationIds: [], description: 'Digitaliseringsstyrelsen — kompetent myndighed for digital sektor under NIS2-direktivet. Ministeriet for Digitalisering.' },
  { id: 'agency-datatilsynet', kind: 'receiver', type: 'leaf', org: 'Datatilsynet', label: 'Datatilsynet (dansk databeskyttelsesmyndighed)', initials: 'Dat', scope: 'all-sites', destinationIds: [], description: 'Datatilsynet — dansk databeskyttelsesmyndighed. Uafhængig tilsynsmyndighed under Justitsministeriet.' },
  { id: 'cert-dkcert', kind: 'receiver', type: 'leaf', org: 'DKCERT', label: 'DKCERT (uddannelsessektorens sikkerhedsteam)', initials: 'CERT', scope: 'all-sites', destinationIds: [], description: 'DeiC Sikkerhed / DKCERT — computerberedskabsteam for uddannelses- og forskningssektoren. Hostet på DTU.' },

  // ── Aviation regulator + Naviair towers ──────────────────────────────────
  { id: 'agency-traf-luftfart', kind: 'receiver', type: 'leaf', parentId: 'agency-traf', org: 'Trafikstyrelsen — Luftfart', label: 'Trafikstyrelsen — Luftfart', initials: 'Luft', scope: 'aviation', destinationIds: [], description: 'Trafikstyrelsen — Luftfartsområdet (tidligere Statens Luftfartsvæsen / dansk civil luftfartsmyndighed).' },
  { id: 'agency-traf-jernbane', kind: 'receiver', type: 'leaf', parentId: 'agency-traf', org: 'Trafikstyrelsen — Jernbane', label: 'Trafikstyrelsen — Jernbanesikkerhed', initials: 'Jern', scope: 'all-sites', destinationIds: [], description: 'Trafikstyrelsen — Jernbanesikkerhed. Regulator for jernbanesikkerhed.' },
  { id: 'agency-traf-havne', kind: 'receiver', type: 'leaf', parentId: 'agency-traf', org: 'Trafikstyrelsen — Havne', label: 'Trafikstyrelsen — Havneområde', initials: 'Havn', scope: 'maritime', destinationIds: [], description: 'Trafikstyrelsen — arbejdsområde Havne (kompetent havnemyndighed; ikke en formel afdeling i organisationsdiagrammet).' },
  { id: 'agency-havarikommission', kind: 'receiver', type: 'leaf', org: 'Havarikommissionen', label: 'Havarikommissionen (luftfart og jernbane)', initials: 'Hav', scope: 'all-sites', destinationIds: [], description: 'Havarikommissionen — undersøgelseskommission for luftfarts- og jernbaneulykker.' },
  { id: 'agency-naviair', kind: 'receiver', type: 'parent', org: 'Naviair', label: 'Naviair (dansk lufttrafiktjeneste)', initials: 'Nav', scope: 'aviation', childrenIds: ['agency-naviair-acc-cph', 'agency-naviair-twr-cph', 'agency-naviair-twr-bll', 'agency-naviair-twr-aal', 'agency-naviair-twr-aar', 'agency-naviair-twr-rke', 'agency-naviair-twr-rnn'], description: 'Naviair — dansk lufttrafiktjenesteudbyder (Danish Air Navigation Service Provider).' },
  { id: 'agency-naviair-acc-cph', kind: 'receiver', type: 'leaf', parentId: 'agency-naviair', org: 'Naviair — Kontrolcentral København', label: 'Kontrolcentral København (Kastrup)', initials: 'Cen', scope: 'aviation', destinationIds: [], description: 'Naviair Områdekontrolcentral og indflyvningskontrol Kastrup.' },
  { id: 'agency-naviair-twr-cph', kind: 'receiver', type: 'leaf', parentId: 'agency-naviair', org: 'Naviair — Tårn København', label: 'Tårn Københavns Lufthavn (EKCH)', initials: 'Kbh', scope: 'aviation', destinationIds: [], description: 'Naviair aerodromkontroltårn EKCH.' },
  { id: 'agency-naviair-twr-bll', kind: 'receiver', type: 'leaf', parentId: 'agency-naviair', org: 'Naviair — Tårn Billund', label: 'Tårn Billund Lufthavn (EKBI)', initials: 'Bll', scope: 'aviation', destinationIds: [], description: 'Naviair fjerntårnscenter og aerodromkontroltårn Billund (EKBI).' },
  { id: 'agency-naviair-twr-aal', kind: 'receiver', type: 'leaf', parentId: 'agency-naviair', org: 'Naviair — Tårn Aalborg', label: 'Tårn Aalborg Lufthavn (EKYT)', initials: 'Aal', scope: 'aviation', destinationIds: [], description: 'Naviair aerodromkontroltårn EKYT og indflyvningskontrol Aalborg.' },
  { id: 'agency-naviair-twr-aar', kind: 'receiver', type: 'leaf', parentId: 'agency-naviair', org: 'Naviair — Tårn Aarhus', label: 'Tårn Aarhus Lufthavn (EKAH)', initials: 'Aar', scope: 'aviation', destinationIds: [], description: 'Naviair aerodromkontroltårn EKAH, Tirstrup.' },
  { id: 'agency-naviair-twr-rke', kind: 'receiver', type: 'leaf', parentId: 'agency-naviair', org: 'Naviair — Tårn Roskilde', label: 'Tårn Roskilde Lufthavn (EKRK)', initials: 'Rke', scope: 'aviation', destinationIds: [], description: 'Naviair aerodromkontroltårn EKRK.' },
  { id: 'agency-naviair-twr-rnn', kind: 'receiver', type: 'leaf', parentId: 'agency-naviair', org: 'Naviair — Tårn Bornholm', label: 'Tårn Bornholm Lufthavn (EKRN)', initials: 'Bor', scope: 'aviation', destinationIds: [], description: 'Naviair aerodromkontroltårn EKRN, Rønne.' },

  // ── Maritime regulators + rescue coordination ────────────────────────────
  { id: 'agency-jrcc-dk', kind: 'receiver', type: 'leaf', org: 'Fælles Redningskoordineringscenter Danmark', label: 'Fælles Redningskoordineringscenter (Aarhus)', initials: 'Red', scope: 'maritime', destinationIds: [], description: 'Fælles Redningskoordineringscenter Danmark (Joint Rescue Coordination Centre), Aarhus (Marinestabens bunker). Drevet af Søværnet og Flyvevåbnet.' },
  { id: 'agency-danpilot', kind: 'receiver', type: 'leaf', org: 'DanPilot', label: 'DanPilot (statslig lodstjeneste)', initials: 'Lod', scope: 'maritime', destinationIds: [], description: 'DanPilot — statsejet lodstjeneste.' },
  { id: 'agency-dmaib', kind: 'receiver', type: 'leaf', org: 'Havarikommissionen for Søfart', label: 'Havarikommissionen for Søfart', initials: 'HKS', scope: 'maritime', destinationIds: [], description: 'Havarikommissionen for Søfart (Danish Maritime Accident Investigation Board).' },

  // ── Emergency alarm centrals + AMK (regional pre-hospital dispatch) ─────
  { id: 'alarm-112-kbh', kind: 'receiver', type: 'leaf', org: 'Alarmcentral 112 København', label: 'Alarmcentral 112 København (Hovedstadens Beredskab)', initials: 'Kbh', scope: 'regional', destinationIds: [], meta: { region: 'region-hst' }, description: 'Alarmcentral 112 København, drevet af Hovedstadens Beredskab. Dækker Region Hovedstaden.' },
  { id: 'alarm-112-slagelse', kind: 'receiver', type: 'leaf', org: 'Alarmcentral 112 Slagelse', label: 'Alarmcentral 112 Slagelse (Rigspolitiet)', initials: 'Sla', scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' }, description: 'Alarmcentral 112 Slagelse, drevet af Rigspolitiet. Dækker Sjælland, Fyn og øerne.' },
  { id: 'alarm-112-aarhus', kind: 'receiver', type: 'leaf', org: 'Alarmcentral 112 Aarhus', label: 'Alarmcentral 112 Aarhus (Rigspolitiet)', initials: 'Aar', scope: 'regional', destinationIds: [], meta: { region: 'region-midt' }, description: 'Alarmcentral 112 Aarhus, drevet af Rigspolitiet. Dækker Jylland.' },
  { id: 'amk-hovedstaden', kind: 'receiver', type: 'leaf', org: 'Akutmedicinsk Koordinationscenter Hovedstaden', label: 'Akutmedicinsk Koordinationscenter Hovedstaden (Ballerup)', initials: 'Hov', scope: 'regional', destinationIds: [], meta: { region: 'region-hst' }, description: 'Akutmedicinsk Koordinationscenter — regional præhospital koordinering og ambulancetjeneste. Region Hovedstaden, Ballerup (Akutberedskabet).' },
  { id: 'amk-sjaelland', kind: 'receiver', type: 'leaf', org: 'Akutmedicinsk Koordinationscenter Sjælland', label: 'Akutmedicinsk Koordinationscenter Sjælland (Slagelse)', initials: 'Sjæ', scope: 'regional', destinationIds: [], meta: { region: 'region-sjl' }, description: 'Akutmedicinsk Koordinationscenter — regional præhospital koordinering og ambulancetjeneste. Region Sjælland, Slagelse.' },
  { id: 'amk-syddanmark', kind: 'receiver', type: 'leaf', org: 'Akutmedicinsk Koordinationscenter Syddanmark', label: 'Akutmedicinsk Koordinationscenter Syddanmark (Odense)', initials: 'Syd', scope: 'regional', destinationIds: [], meta: { region: 'region-syd' }, description: 'Akutmedicinsk Koordinationscenter — regional præhospital koordinering og ambulancetjeneste. Region Syddanmark, Odense.' },
  { id: 'amk-midtjylland', kind: 'receiver', type: 'leaf', org: 'Akutmedicinsk Koordinationscenter Midtjylland', label: 'Akutmedicinsk Koordinationscenter Midtjylland (Aarhus)', initials: 'Mid', scope: 'regional', destinationIds: [], meta: { region: 'region-midt' }, description: 'Akutmedicinsk Koordinationscenter — regional præhospital koordinering og ambulancetjeneste. Region Midtjylland, Aarhus (Præhospitalet).' },
  { id: 'amk-nordjylland', kind: 'receiver', type: 'leaf', org: 'Akutmedicinsk Koordinationscenter Nordjylland', label: 'Akutmedicinsk Koordinationscenter Nordjylland (Aalborg)', initials: 'Nor', scope: 'regional', destinationIds: [], meta: { region: 'region-nord' }, description: 'Akutmedicinsk Koordinationscenter — regional præhospital koordinering og ambulancetjeneste. Region Nordjylland, Aalborg.' },

  // ── NATO + EU ────────────────────────────────────────────────────────────
  { id: 'nato-shape', kind: 'receiver', type: 'leaf', org: 'Supreme Headquarters Allied Powers Europe', label: 'Supreme Headquarters Allied Powers Europe (Mons, Belgien)', initials: 'HQ', scope: 'all-sites', destinationIds: [], description: 'Supreme Headquarters Allied Powers Europe — NATOs europæiske overkommando. Casteau/Mons, Belgien.' },
  { id: 'nato-marcom', kind: 'receiver', type: 'leaf', org: 'Allied Maritime Command', label: 'Allied Maritime Command Northwood (Storbritannien)', initials: 'Mar', scope: 'maritime', destinationIds: [], description: 'NATOs allierede maritime kommando. Northwood, Storbritannien.' },
  { id: 'nato-caoc-uedem', kind: 'receiver', type: 'leaf', org: 'Combined Air Operations Centre Uedem', label: 'Combined Air Operations Centre Uedem (Tyskland)', initials: 'Ued', scope: 'aviation', destinationIds: [], description: 'Combined Air Operations Centre Uedem — NATO luftoperationscenter der dækker dansk luftrum under NATOs integrerede luft- og missilforsvar. Uedem, Tyskland.' },
  { id: 'nato-natinamds', kind: 'receiver', type: 'leaf', org: 'NATO Integrated Air and Missile Defence System', label: 'NATO Integrated Air and Missile Defence System (Ramstein)', initials: 'Def', scope: 'aviation', destinationIds: [], description: 'NATO Integrated Air and Missile Defence System — NATOs integrerede luft- og missilforsvar. Under Allied Air Command, Ramstein, Tyskland.' },
  { id: 'nato-jfc-brunssum', kind: 'receiver', type: 'leaf', org: 'Joint Force Command Brunssum', label: 'Joint Force Command Brunssum (Holland)', initials: 'Bru', scope: 'all-sites', destinationIds: [], description: 'NATOs allierede fælleskommando Brunssum — dækker Danmark. Holland.' },
  { id: 'nato-ccdcoe', kind: 'receiver', type: 'leaf', org: 'Cooperative Cyber Defence Centre of Excellence', label: 'Cooperative Cyber Defence Centre of Excellence (Tallinn)', initials: 'Cyb', scope: 'all-sites', destinationIds: [], description: 'NATO Cooperative Cyber Defence Centre of Excellence — NATOs kompetencecenter for cyberforsvar. Tallinn, Estland.' },
  { id: 'nato-ncsc', kind: 'receiver', type: 'leaf', org: 'NATO Cyber Security Centre', label: 'NATO Cyber Security Centre (Mons, Belgien)', initials: 'Sec', scope: 'all-sites', destinationIds: [], description: 'NATO Communications and Information Agency Cyber Security Centre. Mons, Belgien.' },
  { id: 'nordic-nordefco', kind: 'receiver', type: 'leaf', org: 'Nordic Defence Cooperation', label: 'Nordic Defence Cooperation (roterende formandskab)', initials: 'Nor', scope: 'all-sites', destinationIds: [], description: 'Nordic Defence Cooperation — nordisk forsvarssamarbejde. Ingen fast sekretariat, roterende formandskab. Norge har formandskabet 2026.' },
  { id: 'eu-frontex', kind: 'receiver', type: 'leaf', org: 'European Border and Coast Guard Agency', label: 'European Border and Coast Guard Agency (Warszawa)', initials: 'Græn', scope: 'all-sites', destinationIds: [], description: 'European Border and Coast Guard Agency (Frontex) — EUs grænse- og kystvagt. Warszawa, Polen.' },
  { id: 'eu-europol', kind: 'receiver', type: 'leaf', org: 'European Union Agency for Law Enforcement Cooperation', label: 'European Union Agency for Law Enforcement Cooperation (Haag)', initials: 'Pol', scope: 'all-sites', destinationIds: [], description: 'European Union Agency for Law Enforcement Cooperation (Europol). Haag, Holland.' },
  { id: 'eu-enisa', kind: 'receiver', type: 'leaf', org: 'European Union Agency for Cybersecurity', label: 'European Union Agency for Cybersecurity (Athen)', initials: 'Cyb', scope: 'all-sites', destinationIds: [], description: 'European Union Agency for Cybersecurity (ENISA). Athen, Grækenland.' },
  { id: 'eu-eurojust', kind: 'receiver', type: 'leaf', org: 'European Union Agency for Criminal Justice Cooperation', label: 'European Union Agency for Criminal Justice Cooperation (Haag)', initials: 'Ret', scope: 'all-sites', destinationIds: [], description: 'European Union Agency for Criminal Justice Cooperation (Eurojust). Haag, Holland.' },
  { id: 'eu-cert-eu', kind: 'receiver', type: 'leaf', org: 'Cybersecurity Service for EU Institutions', label: 'Cybersecurity Service for EU Institutions (Bruxelles)', initials: 'EU', scope: 'all-sites', destinationIds: [], description: 'Cybersecurity Service for EU Institutions (CERT-EU). Bruxelles, Belgien.' },
  { id: 'eu-emsa', kind: 'receiver', type: 'leaf', org: 'European Maritime Safety Agency', label: 'European Maritime Safety Agency (Lissabon)', initials: 'Sø', scope: 'maritime', destinationIds: [], description: 'European Maritime Safety Agency (EMSA). Lissabon, Portugal.' },
  { id: 'eu-eurocontrol', kind: 'receiver', type: 'leaf', org: 'European Organisation for the Safety of Air Navigation', label: 'European Organisation for the Safety of Air Navigation (Bruxelles)', initials: 'Luft', scope: 'aviation', destinationIds: [], description: 'European Organisation for the Safety of Air Navigation (EUROCONTROL). Bruxelles, Belgien.' },

  // ══════════════════════════════════════════════════════════════════════════
  // G. TOP-LEVEL BUCKET PARENTS (2026-08-31)
  //    Groups otherwise-orphan leaves under logical categories so the
  //    account picker shows ~15 top-level items instead of 200+.
  //    Each bucket has type: 'parent' and childrenIds enumerating members.
  // ══════════════════════════════════════════════════════════════════════════

  { id: 'bucket-kommuner', kind: 'receiver', type: 'parent',
    org: 'Danmarks Kommuner', label: 'Danmarks Kommuner (98)', initials: 'Kom',
    scope: 'regional',
    childrenIds: ['kom-albertslund','kom-alleroed','kom-ballerup','kom-bornholm','kom-broendby','kom-dragoer','kom-egedal','kom-fredensborg','kom-frederiksberg','kom-frederikssund','kom-furesoe','kom-gentofte','kom-gladsaxe','kom-glostrup','kom-gribskov','kom-halsnaes','kom-helsingoer','kom-herlev','kom-hilleroed','kom-hvidovre','kom-hoeje-taastrup','kom-hoersholm','kom-ishoej','kom-koebenhavn','kom-lyngby-taarbaek','kom-rudersdal','kom-roedovre','kom-taarnby','kom-vallensbaek','kom-faxe','kom-greve','kom-guldborgsund','kom-holbaek','kom-kalundborg','kom-koege','kom-lejre','kom-lolland','kom-naestved','kom-odsherred','kom-ringsted','kom-roskilde','kom-slagelse','kom-solroed','kom-soroe','kom-stevns','kom-vordingborg','kom-assens','kom-billund','kom-esbjerg','kom-fanoe','kom-fredericia','kom-faaborg-midtfyn','kom-haderslev','kom-kerteminde','kom-kolding','kom-langeland','kom-middelfart','kom-nordfyns','kom-nyborg','kom-odense','kom-svendborg','kom-soenderborg','kom-toender','kom-varde','kom-vejen','kom-vejle','kom-aeroe','kom-aabenraa','kom-favrskov','kom-hedensted','kom-herning','kom-holstebro','kom-horsens','kom-ikast-brande','kom-lemvig','kom-norddjurs','kom-odder','kom-randers','kom-ringkoebing-skjern','kom-samsoe','kom-silkeborg','kom-skanderborg','kom-skive','kom-struer','kom-syddjurs','kom-viborg','kom-aarhus','kom-broenderslev','kom-frederikshavn','kom-hjoerring','kom-jammerbugt','kom-laesoe','kom-mariagerfjord','kom-morsoe','kom-rebild','kom-thisted','kom-vesthimmerlands','kom-aalborg'],
    description: 'All 98 Danish kommuner. Expand to select a specific municipality.' },

  { id: 'bucket-hospitaler', kind: 'receiver', type: 'parent',
    org: 'Akuthospitaler', label: 'Akuthospitaler (23)', initials: 'Hos',
    scope: 'regional',
    childrenIds: ['hospital-rigshospitalet','hospital-herlev','hospital-hvidovre','hospital-bispebjerg','hospital-nordsjaellands','hospital-bornholms','hospital-suh-koege','hospital-slagelse-sygehus','hospital-holbaek-sygehus','hospital-suh-nykobing','hospital-ouh-odense','hospital-kolding-sygehus','hospital-vejle-sygehus','hospital-esbjerg-sygehus','hospital-aabenraa-sygehus','hospital-auh-aarhus','hospital-goedstrup','hospital-viborg','hospital-horsens','hospital-randers','hospital-auh-aalborg','hospital-rhn-hjoerring','hospital-auh-thisted'],
    description: '24/7 acute-reception hospitals. Region-grouped in child labels.' },

  { id: 'bucket-kbr', kind: 'receiver', type: 'parent',
    org: 'Kommunale Beredskaber', label: 'Kommunale Beredskaber (29)', initials: 'Ber',
    scope: 'regional',
    childrenIds: ['kbr-hovedstaden','kbr-beredskab-ost','kbr-nordsjaellands','kbr-frederiksborg','kbr-beredskab-4k','kbr-koege','kbr-roskilde','kbr-lejre','kbr-vestsjaellands','kbr-slagelse','kbr-midt-sydsjaellands','kbr-lolland-falster','kbr-gribskov','kbr-helsingoer','kbr-taarnby','kbr-bornholm','kbr-fyn','kbr-trekantbrand','kbr-vejle','kbr-sydvestjysk','kbr-brsj','kbr-soenderborg','kbr-sydoestjyllands','kbr-ostjyllands','kbr-beredskab-sikkerhed','kbr-midtjysk','kbr-midtvest','kbr-nordvestjyllands','kbr-nordjyllands'],
    description: '§60 shared municipal fire/rescue services covering all 98 kommuner.' },

  { id: 'bucket-regioner', kind: 'receiver', type: 'parent',
    org: 'Regioner', label: 'Regioner (5)', initials: 'Reg',
    scope: 'regional',
    childrenIds: ['region-hst','region-sjl','region-syd','region-midt','region-nord'],
    description: 'De 5 danske regioner. Folkevalgt regional forvaltning der ejer sundhedsvæsen, præhospital tjeneste og ambulancer. Politisk eskaleringspunkt.' },

  { id: 'bucket-alarm-amk', kind: 'receiver', type: 'parent',
    org: 'Alarmcentraler og Akutmedicinsk Koordination', label: 'Alarmcentraler 112 og Akutmedicinsk Koordinationscentre', initials: 'Alm',
    scope: 'all-sites',
    childrenIds: ['alarm-112-kbh','alarm-112-slagelse','alarm-112-aarhus','amk-hovedstaden','amk-sjaelland','amk-syddanmark','amk-midtjylland','amk-nordjylland'],
    description: '3 alarmcentraler (112) og 5 regionale Akutmedicinsk Koordinationscentre.' },

  { id: 'bucket-ministerier', kind: 'receiver', type: 'parent',
    org: 'Ministerier', label: 'Ministerier', initials: 'Min',
    scope: 'national',
    childrenIds: ['min-just','min-fors','min-klim','min-erhverv','min-sund'],
    description: 'Nationale ministerier med rolle på kritisk infrastruktur.' },

  { id: 'bucket-styrelser', kind: 'receiver', type: 'parent',
    org: 'Styrelser og regulatorer', label: 'Styrelser og regulatorer', initials: 'Sty',
    scope: 'all-sites',
    childrenIds: ['agency-traf','agency-sof','agency-ener','agency-cfcs','agency-samsik','agency-digst','agency-datatilsynet','agency-havarikommission','agency-naviair','agency-jrcc-dk','agency-danpilot','agency-dmaib','cert-dkcert'],
    description: 'Danske styrelser, regulatorer, lufttrafiktjeneste og computerberedskabsteams.' },

  { id: 'bucket-nato', kind: 'receiver', type: 'parent',
    org: 'NATO og Nordisk Forsvar', label: 'NATO og Nordisk Forsvar', initials: 'Nat',
    scope: 'all-sites',
    childrenIds: ['nato-shape','nato-marcom','nato-caoc-uedem','nato-natinamds','nato-jfc-brunssum','nato-ccdcoe','nato-ncsc','nordic-nordefco'],
    description: 'NATO kommandoer og kompetencecentre samt Nordic Defence Cooperation.' },

  { id: 'bucket-eu', kind: 'receiver', type: 'parent',
    org: 'EU-agenturer', label: 'EU-agenturer', initials: 'EU',
    scope: 'all-sites',
    childrenIds: ['eu-frontex','eu-europol','eu-enisa','eu-eurojust','eu-cert-eu','eu-emsa','eu-eurocontrol'],
    description: 'EU-agenturer med rolle på grænse, cyber, søfart og luftfart.' },
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
// Danish A-Å collation. Æ, Ø, Å sort correctly at the end of the
// alphabet (Æ = 27, Ø = 28, Å = 29). Numeric option keeps numbered
// entries in natural order.
const _DA_COLLATOR = new Intl.Collator('da', { sensitivity: 'base', numeric: true });
function _sortByOrgAZ(a, b) {
  return _DA_COLLATOR.compare(a.org || a.label || a.id, b.org || b.label || b.id);
}

// receiverRoles() returns receivers sorted A-Å by org name (Danish
// collation). Every consumer that renders a receiver list gets the
// same intuitive ordering. Source-file order stays hierarchical for
// maintainability; the sort is applied here on read.
export function receiverRoles() { return [...RECEIVERS].sort(_sortByOrgAZ); }
export function operatorRoles() { return [...OPERATORS].sort(_sortByOrgAZ); }
// Raw hierarchical order — for callers that need parent/child navigation
// intact (branch chooser tiles, etc).
export function receiverRolesHierarchical() { return RECEIVERS; }

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

// Compute the set of roles impacted by an event. Aggregates from four
// sources per IDD IF-6.7 (Phase 1 covers sources 1, 2, and 4; source 3
// threat-type routing lands in Phase 3):
//   1. Direct scope — SITES[event.siteId].receivers
//   2. Cross-site cascade — receivers of any linked / shadow event's site
//   4. Explicit participants — anything already on event.participants
//      (added via handoff, observer-add, coordination, etc.)
//
// siteReceiversLookup: fn (siteId) => Array<{id, mode, role, tier, condition}>
//   Populated by main.js at wire-up so this module stays free of a
//   SITES import (roles.js is imported by many modules; SITES pulls in
//   heavier config that we don't want to widen the dep graph on).
//
// linkedEventLookup: fn (eventId) => event | null
//   Optional. When provided, cross-site cascade folds in receivers
//   scoped to any linkedEventIds / shadowOfEventId sites.
//
// Every entry has: {role_id, mode, addedBy, reason, tier?, condition?}
// Dedup: last-write wins per role_id, with mode elevation (an actor
// entry always beats an observer entry for the same role).
export function impactedRoles(event, siteReceiversLookup = null, linkedEventLookup = null) {
  const impacted = new Map();   // role_id → entry
  if (!event) return [];

  const _addEntry = (roleId, entry) => {
    const role = ACCOUNTS.find(r => r.id === roleId);
    if (!role) return;   // silently skip unknown roles (guards against typos in SITES.receivers)
    const existing = impacted.get(roleId);
    if (!existing) { impacted.set(roleId, entry); return; }
    // Mode elevation: actor beats observer.
    if (existing.mode === 'observer' && entry.mode === 'actor') {
      impacted.set(roleId, { ...entry, addedBy: `${existing.addedBy}+${entry.addedBy}` });
    }
  };

  const _foldSite = (siteId, addedByLabel) => {
    if (!siteId) return;
    if (typeof siteReceiversLookup !== 'function') return;
    const entries = siteReceiversLookup(siteId) || [];
    for (const e of entries) {
      _addEntry(e.id, {
        role_id: e.id,
        mode: e.mode || 'actor',
        addedBy: addedByLabel,
        reason: `siteScope:${siteId}`,
        tier: e.tier ?? null,
        condition: e.condition ?? null,
      });
    }
  };

  // Source 1: direct-scope receivers at this event's site.
  _foldSite(event.siteId, 'site-scope');

  // Source 2: cross-site cascade. Linked events' site receivers loop
  // in as observers on the primary (and vice versa if this event is
  // itself a shadow — its primary's site scope also applies).
  if (typeof linkedEventLookup === 'function') {
    const seenSites = new Set([event.siteId]);
    const cascade = (linkedId) => {
      const linked = linkedEventLookup(linkedId);
      if (!linked || seenSites.has(linked.siteId)) return;
      seenSites.add(linked.siteId);
      _foldSite(linked.siteId, 'cross-site-cascade');
    };
    (event.linkedEventIds || []).forEach(cascade);
    if (event.shadowOfEventId) cascade(event.shadowOfEventId);
  }

  // Source 4: explicit participants already added to the event by
  // prior flows (handoff, observer-add, coordination, promotion).
  if (event.participants instanceof Map) {
    for (const [roleId, p] of event.participants) {
      _addEntry(roleId, {
        role_id: roleId,
        mode: p.mode || 'actor',
        addedBy: p.addedBy || 'explicit',
        reason: p.addReason || 'participant',
        tier: null,
        condition: null,
      });
    }
  }

  return Array.from(impacted.values());
}

// Test hook: expose helpers on window for browser console debugging.
if (typeof window !== 'undefined') {
  window.__isrRoles = {
    ACCOUNTS, RECEIVERS, AGENCY_BRANCHES, FLOW_TYPES, FLOW_MATRIX,
    getRole: (id) => ACCOUNTS.find(r => r.id === id),
    agencyBranchOf, relationshipBetween, canInitiate, impactedRoles,
  };
}
