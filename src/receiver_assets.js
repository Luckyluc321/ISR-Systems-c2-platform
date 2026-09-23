// Per-account plug-in asset library. Every dispatchable asset a
// receiver profile owns lives here with descriptive metadata that
// surfaces in the UI so operators understand capability, use cases,
// deploy time, and limitations before they click dispatch.
//
// Two axes per profile:
//
//   dispatchable[]  Assets the profile can fire from their own home
//                   base. Clicking one spawns a billboard at the
//                   profile's home base coordinate (receiver_bases.js)
//                   and animates it toward the incident via the
//                   existing counter dispatch engine in main.js. The
//                   asset kind maps to a CD_PROFILE entry.
//
//   requestable[]   Assets the profile does NOT own but can request
//                   from another profile. Clicking one creates a new
//                   escalation targeting the from profile. Target
//                   profile sees the request in their inbox and can
//                   dispatch their own asset.
//
// Adding new assets for an existing profile: append a new entry to
// dispatchable[] or requestable[]. No code changes required beyond
// ensuring the asset kind has a matching CD_PROFILE entry in main.js
// for the dispatch physics (cruise speed, arrival radius, engage
// time, icon).
//
// Adding a new profile entirely: new top-level key mapping the
// profile's role id to a dispatchable + requestable definition.
//
// Descriptive metadata fields:
//   name          Human-readable asset name shown in the UI
//   count         How many units of this asset the profile owns
//   icon          Emoji or symbol for the CTA button
//   useCases[]    Real-world scenarios this asset addresses
//   capabilities  Structured capability flags (radio frequency,
//                 kinetic, coordination, forensic, etc.)
//   deployTime    Human-readable time from click to on-scene
//   limitations   Where this asset is NOT suitable
//
// Real-customer plug-in path: when a Danish police district gives us
// their actual counter drone inventory, we add rows to their
// dispatchable[] with real names, counts, and metadata. No code
// changes, no logic churn, no risk of ruining existing flows.
//
// See docs/agentic-receiver-asset-plugin-architecture.md for the
// full plug-in flow and mermaid diagram.

export const RECEIVER_ASSETS = {

  // ── Københavns Politi (Copenhagen Police District) ──────────

  'politi-kbh': {
    label: 'Københavns Politi',
    baseId: 'politi-koebenhavn',
    dispatchable: [
      {
        assetKey: 'kbh-patrol-car',
        kind: 'receiver-patrol-car',
        name: 'Patrol car',
        count: 12,
        icon: '🚔',
        useCases: [
          'First ground responder to any incident in Copenhagen district',
          'Perimeter presence and civilian evacuation coordination',
          'Witness location and initial statement gathering',
        ],
        capabilities: {
          coordination: true,
          civilian_management: true,
          armed: true,
          kinetic_counter_drone: false,
        },
        deployTime: '3-8 minutes from station via real road routing',
        limitations: 'Copenhagen district only. No airspace jurisdiction.',
      },
      {
        assetKey: 'kbh-k9-unit',
        kind: 'receiver-k9-unit',
        name: 'K9 search unit',
        count: 4,
        icon: '🐕',
        useCases: [
          'Explosive detection at cordon points',
          'Search of downed drone wreckage or suspect packages',
          'Suspect track and locate',
        ],
        capabilities: {
          explosive_detection: true,
          suspect_track: true,
        },
        deployTime: '10-15 minutes from station',
        limitations: 'Requires clear scene, cannot deploy into active kinetic engagement.',
      },
      {
        assetKey: 'kbh-cordon-squad',
        kind: 'receiver-cordon-squad',
        name: 'Perimeter cordon squad',
        count: 6,
        icon: '⚑',
        useCases: [
          'Establish and hold a physical perimeter around the incident',
          'Traffic diversion and civilian standoff distance',
          'Evidence scene preservation',
        ],
        capabilities: {
          crowd_management: true,
          traffic_control: true,
        },
        deployTime: '15-25 minutes from station',
        limitations: 'Squad is stationary once established. Requires 5+ officers.',
      },
      {
        assetKey: 'kbh-forensic',
        kind: 'receiver-forensic-van',
        name: 'Forensic team',
        count: 2,
        icon: '🔬',
        useCases: [
          'Scene documentation after incident closure',
          'Evidence recovery from downed drone or impact site',
          'Chain of custody handoff to Rigspolitiet cyber crime team',
        ],
        capabilities: {
          evidence_recovery: true,
          scene_documentation: true,
        },
        deployTime: '20-30 minutes from station',
        limitations: 'Post-incident only. Requires scene secured by patrol or cordon first.',
      },
    ],
    requestable: [
      {
        requestKey: 'req-aks',
        from: 'politi-aks',
        name: 'Tactical intervention',
        useCases: [
          'Armed hostage or barricaded suspect',
          'Active shooter scenario',
          'Terminal phase counter drone intercept in populated area',
        ],
        priority: 'critical',
        expectedResponse: 'Aktionsstyrken tactical van or strike team from Ejby',
      },
    ],
  },

  // ── Aktionsstyrken (National Police Tactical Unit) ───────────

  'politi-aks': {
    label: 'Aktionsstyrken',
    baseId: 'aks-cta',
    dispatchable: [
      {
        assetKey: 'aks-tactical-van',
        kind: 'receiver-tactical-van',
        name: 'Tactical van',
        count: 3,
        icon: '🚐',
        useCases: [
          'Armed hostage or barricaded suspect response',
          'High-risk arrest',
          'Terminal-phase counter drone intercept',
        ],
        capabilities: {
          armed: true,
          armored: true,
          kinetic_counter_drone: true,
          breach_capability: true,
        },
        deployTime: '15-25 minutes from Ejby to Copenhagen area',
        limitations: 'National unit, single-scene at a time.',
      },
      {
        assetKey: 'aks-strike-team',
        kind: 'receiver-strike-team',
        name: 'Strike team',
        count: 2,
        icon: '🛡',
        useCases: [
          'Multi-suspect breach and clear',
          'Hostage rescue',
          'High-threat entry',
        ],
        capabilities: {
          armed: true,
          breach_capability: true,
          hostage_rescue: true,
        },
        deployTime: '20-30 minutes from Ejby',
        limitations: 'Requires senior political approval for domestic hostage rescue.',
      },
    ],
    requestable: [],
  },

  // ── Rigspolitiet (National Police HQ) ────────────────────────

  'rigspoliti': {
    label: 'Rigspolitiet',
    baseId: 'rigspolitiet',
    dispatchable: [
      {
        assetKey: 'rigs-coord-cell',
        kind: 'receiver-coord-cell',
        name: 'National coordination cell',
        count: 1,
        icon: '📞',
        useCases: [
          'Cross-district resource marshalling for a multi-district incident',
          'National-scale crisis coordination with military and ministries',
          'Media and public communication coordination',
        ],
        capabilities: {
          coordination: true,
          static: true,
        },
        deployTime: 'Instant activation from Rigspolitiet HQ',
        limitations: 'Coordination only, no kinetic or field response.',
      },
      {
        assetKey: 'rigs-nc3-cyber',
        kind: 'receiver-cyber-team',
        name: 'National cyber crime team',
        count: 8,
        icon: '💻',
        useCases: [
          'Digital forensics on captured drone control channels',
          'Attribution analysis for state-sponsored incidents',
          'Cyber threat intelligence handoff to Politiets Efterretningstjeneste and Forsvarets Efterretningstjeneste',
        ],
        capabilities: {
          digital_forensics: true,
          cyber_analysis: true,
          static: true,
        },
        deployTime: 'Remote analysis begins immediately, on-site forensics 60-90 minutes to Copenhagen area',
        limitations: 'Analysis and forensics only, no kinetic response.',
      },
    ],
    requestable: [
      {
        requestKey: 'req-aks',
        from: 'politi-aks',
        name: 'Tactical intervention',
        useCases: [
          'Armed hostage or barricaded suspect',
          'Active shooter scenario',
          'Terminal phase counter drone intercept in populated area',
        ],
        priority: 'critical',
        expectedResponse: 'Aktionsstyrken tactical van or strike team from Ejby',
      },
    ],
  },

  // ── Medical + rescue (impact / mass-casualty response) ───────
  // Plain asset names per operational reality: ambulances and the
  // akutlægebil deploy to a point of impact. Hospitals hold small
  // own fleets; the regional fleet lives at Akutberedskabet (AMK
  // Hovedstaden, Ballerup). BRS Hedehusene is the national civil
  // protection heavy-rescue center closest to Copenhagen.

  'amk-hovedstaden': {
    label: 'Akutmedicinsk Koordinationscenter Hovedstaden',
    baseId: 'akutberedskabet-ballerup',
    dispatchable: [
      {
        assetKey: 'amk-ambulance',
        kind: 'receiver-ambulance',
        name: 'Ambulance',
        count: 8,
        icon: '🚑',
        useCases: [
          'Casualty transport from an impact or crash site',
          'On-scene triage and stabilisation',
          'Standby posture at an active threat perimeter',
        ],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '5-12 minutes via real road routing',
        limitations: 'Staging outside the cordon until the scene is declared safe by police.',
      },
      {
        assetKey: 'amk-akutlaegebil',
        kind: 'receiver-akutlaegebil',
        name: 'Akutlægebil',
        count: 2,
        icon: '🚨',
        useCases: [
          'Physician-level intervention at the scene',
          'Mass-casualty medical command on arrival',
        ],
        capabilities: { physician_on_scene: true, medical_command: true },
        deployTime: '4-10 minutes via real road routing',
        limitations: 'Single vehicle, no transport capacity. Works with ambulances, not instead of them.',
      },
    ],
    requestable: [],
  },

  'hospital-rigshospitalet': {
    label: 'Rigshospitalet',
    baseId: 'hospital-rigshospitalet',
    dispatchable: [
      { assetKey: 'righ-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 2, icon: '🚑',
        useCases: ['Casualty transport to own akutmodtagelse', 'On-scene triage support'],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '4-10 minutes via real road routing',
        limitations: 'Staging outside the cordon until police declare the scene safe.' },
      { assetKey: 'righ-akutlaegebil', kind: 'receiver-akutlaegebil', name: 'Akutlægebil', count: 1, icon: '🚨',
        useCases: ['Physician-level intervention at the scene'],
        capabilities: { physician_on_scene: true },
        deployTime: '3-8 minutes via real road routing',
        limitations: 'Single vehicle, no transport capacity.' },
    ],
    requestable: [],
  },

  'hospital-hvidovre': {
    label: 'Hvidovre Hospital',
    baseId: 'hospital-hvidovre',
    dispatchable: [
      { assetKey: 'hvh-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 2, icon: '🚑',
        useCases: ['Casualty transport to own akutmodtagelse', 'On-scene triage support'],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '5-12 minutes via real road routing',
        limitations: 'Staging outside the cordon until police declare the scene safe.' },
      { assetKey: 'hvh-akutlaegebil', kind: 'receiver-akutlaegebil', name: 'Akutlægebil', count: 1, icon: '🚨',
        useCases: ['Physician-level intervention at the scene'],
        capabilities: { physician_on_scene: true },
        deployTime: '4-10 minutes via real road routing',
        limitations: 'Single vehicle, no transport capacity.' },
    ],
    requestable: [],
  },

  'hospital-herlev': {
    label: 'Herlev Hospital',
    baseId: 'hospital-herlev',
    dispatchable: [
      { assetKey: 'her-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 2, icon: '🚑',
        useCases: ['Casualty transport to own akutmodtagelse', 'On-scene triage support'],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '6-14 minutes via real road routing',
        limitations: 'Staging outside the cordon until police declare the scene safe.' },
    ],
    requestable: [],
  },

  'hospital-bispebjerg': {
    label: 'Bispebjerg Hospital',
    baseId: 'hospital-bispebjerg',
    dispatchable: [
      { assetKey: 'bbh-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 2, icon: '🚑',
        useCases: ['Casualty transport to own akutmodtagelse', 'On-scene triage support'],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '4-10 minutes via real road routing',
        limitations: 'Staging outside the cordon until police declare the scene safe.' },
    ],
    requestable: [],
  },

  // Municipal fire services, Zealand and the Triangle. Added 2026-09-22.
  'kbr-taarnby': {
    label: 'Tårnby Brandvæsen',
    baseId: 'taarnby-brandstation',
    dispatchable: [
      {
        assetKey: 'tbbv-brandbil',
        kind: 'receiver-brandbil',
        name: 'Brandbil',
        count: 3,
        icon: '🚒',
        useCases: [
          'Fire suppression at an impact or crash site',
          'Technical rescue and first response',
          'Scene lighting, water supply, and equipment support',
        ],
        capabilities: { fire_suppression: true, technical_rescue: true },
        deployTime: '4-9 minutes via real road routing',
        limitations: 'Stages at the assembly point until police declare the scene safe (REFIL doctrine at attack scenes).',
      },
    ],
    requestable: [],
  },

  'kbr-frederiksborg': {
    label: 'Frederiksborg Brand & Redning',
    baseId: 'fbbr-frederikssund',
    dispatchable: [
      {
        assetKey: 'fbbr-brandbil',
        kind: 'receiver-brandbil',
        name: 'Brandbil',
        count: 3,
        icon: '🚒',
        useCases: [
          'Fire suppression at an impact or crash site',
          'Technical rescue and first response',
          'Scene lighting, water supply, and equipment support',
        ],
        capabilities: { fire_suppression: true, technical_rescue: true },
        deployTime: '10-20 minutes via real road routing',
        limitations: 'Stages at the assembly point until police declare the scene safe (REFIL doctrine at attack scenes).',
      },
    ],
    requestable: [],
  },

  'kbr-koege': {
    label: 'Brand & Redning Køge-Solrød-Stevns',
    baseId: 'brkss-koege',
    dispatchable: [
      {
        assetKey: 'brkss-brandbil',
        kind: 'receiver-brandbil',
        name: 'Brandbil',
        count: 3,
        icon: '🚒',
        useCases: [
          'Fire suppression at an impact or crash site',
          'Technical rescue and first response',
          'Scene lighting, water supply, and equipment support',
        ],
        capabilities: { fire_suppression: true, technical_rescue: true },
        deployTime: '8-18 minutes via real road routing',
        limitations: 'Stages at the assembly point until police declare the scene safe (REFIL doctrine at attack scenes).',
      },
    ],
    requestable: [],
  },

  'kbr-trekantbrand': {
    label: 'TrekantBrand',
    baseId: 'trekantbrand-kolding',
    dispatchable: [
      {
        assetKey: 'trbr-brandbil',
        kind: 'receiver-brandbil',
        name: 'Brandbil',
        count: 4,
        icon: '🚒',
        useCases: [
          'Fire suppression at an impact or crash site',
          'Technical rescue and first response',
          'Scene lighting, water supply, and equipment support',
        ],
        capabilities: { fire_suppression: true, technical_rescue: true },
        deployTime: '8-30 minutes via real road routing',
        limitations: 'Stages at the assembly point until police declare the scene safe (REFIL doctrine at attack scenes).',
      },
    ],
    requestable: [],
  },

  // Regional medical coordination centres, added 2026-09-22. Five
  // ambulances and one physician car each, against Hovedstaden's eight
  // and two: these coordinate a region rather than a dense capital, and
  // the count is what one centre can commit to a single incident.
  'amk-sjaelland': {
    label: 'Akutmedicinsk Koordinationscenter Sjælland',
    baseId: 'amk-sjaelland-naestved',
    dispatchable: [
      { assetKey: 'amks-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 5, icon: '🚑',
        useCases: [
          'Casualty transport from an impact or crash site',
          'On-scene triage and stabilisation',
          'Standby posture at an active threat perimeter',
        ],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '8-20 minutes via real road routing',
        limitations: 'Staging outside the cordon until the scene is declared safe by police.' },
      { assetKey: 'amks-akutlaegebil', kind: 'receiver-akutlaegebil', name: 'Akutlægebil', count: 1, icon: '🚨',
        useCases: ['Physician-level intervention at the scene'],
        capabilities: { physician_on_scene: true },
        deployTime: '7-16 minutes via real road routing',
        limitations: 'Single vehicle, no transport capacity.' },
    ],
    requestable: [],
  },

  'amk-syddanmark': {
    label: 'Akutmedicinsk Koordinationscenter Syddanmark',
    baseId: 'amk-syddanmark-odense',
    dispatchable: [
      { assetKey: 'amksy-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 5, icon: '🚑',
        useCases: [
          'Casualty transport from an impact or crash site',
          'On-scene triage and stabilisation',
          'Standby posture at an active threat perimeter',
        ],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '10-25 minutes via real road routing',
        limitations: 'Staging outside the cordon until the scene is declared safe by police.' },
      { assetKey: 'amksy-akutlaegebil', kind: 'receiver-akutlaegebil', name: 'Akutlægebil', count: 1, icon: '🚨',
        useCases: ['Physician-level intervention at the scene'],
        capabilities: { physician_on_scene: true },
        deployTime: '9-20 minutes via real road routing',
        limitations: 'Single vehicle, no transport capacity.' },
    ],
    requestable: [],
  },

  'amk-nordjylland': {
    label: 'Akutmedicinsk Koordinationscenter Nordjylland',
    baseId: 'amk-nordjylland-aalborg',
    dispatchable: [
      { assetKey: 'amkn-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 5, icon: '🚑',
        useCases: [
          'Casualty transport from an impact or crash site',
          'On-scene triage and stabilisation',
          'Standby posture at an active threat perimeter',
        ],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '8-20 minutes via real road routing',
        limitations: 'Staging outside the cordon until the scene is declared safe by police.' },
      { assetKey: 'amkn-akutlaegebil', kind: 'receiver-akutlaegebil', name: 'Akutlægebil', count: 1, icon: '🚨',
        useCases: ['Physician-level intervention at the scene'],
        capabilities: { physician_on_scene: true },
        deployTime: '7-16 minutes via real road routing',
        limitations: 'Single vehicle, no transport capacity.' },
    ],
    requestable: [],
  },

  // Acute hospitals outside the capital, added 2026-09-22. Two
  // ambulances each, matching the pattern of the non-Rigshospitalet
  // Copenhagen hospitals. Physician cars sit with the regional
  // Akutmedicinsk Koordinationscenter rather than with each hospital.
  'hospital-suh-koege': {
    label: 'Sjællands Universitetshospital Køge',
    baseId: 'hospital-suh-koege',
    dispatchable: [
      { assetKey: 'suhk-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 2, icon: '🚑',
        useCases: ['Casualty transport to own akutmodtagelse', 'On-scene triage support'],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '6-14 minutes via real road routing',
        limitations: 'Staging outside the cordon until police declare the scene safe.' },
    ],
    requestable: [],
  },

  'hospital-kolding-sygehus': {
    label: 'Kolding Sygehus',
    baseId: 'hospital-kolding-sygehus',
    dispatchable: [
      { assetKey: 'kols-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 2, icon: '🚑',
        useCases: ['Casualty transport to own akutmodtagelse', 'On-scene triage support'],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '6-14 minutes via real road routing',
        limitations: 'Staging outside the cordon until police declare the scene safe.' },
    ],
    requestable: [],
  },

  'hospital-esbjerg-sygehus': {
    label: 'Esbjerg Sygehus',
    baseId: 'hospital-esbjerg-sygehus',
    dispatchable: [
      { assetKey: 'esbs-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 2, icon: '🚑',
        useCases: ['Casualty transport to own akutmodtagelse', 'On-scene triage support'],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '4-10 minutes via real road routing',
        limitations: 'Staging outside the cordon until police declare the scene safe.' },
    ],
    requestable: [],
  },

  'hospital-aabenraa-sygehus': {
    label: 'Sygehus Sønderjylland Aabenraa',
    baseId: 'hospital-aabenraa-sygehus',
    dispatchable: [
      { assetKey: 'aabs-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 2, icon: '🚑',
        useCases: ['Casualty transport to own akutmodtagelse', 'On-scene triage support'],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '6-14 minutes via real road routing',
        limitations: 'Staging outside the cordon until police declare the scene safe.' },
    ],
    requestable: [],
  },

  'hospital-auh-aalborg': {
    label: 'Aalborg Universitetshospital',
    baseId: 'hospital-auh-aalborg',
    dispatchable: [
      { assetKey: 'aalb-ambulance', kind: 'receiver-ambulance', name: 'Ambulance', count: 2, icon: '🚑',
        useCases: ['Casualty transport to own akutmodtagelse', 'On-scene triage support'],
        capabilities: { casualty_transport: true, triage: true },
        deployTime: '6-14 minutes via real road routing',
        limitations: 'Staging outside the cordon until police declare the scene safe.' },
    ],
    requestable: [],
  },

  // Added 2026-09-22 alongside per-site consequence routing. Counts are
  // deliberately modest: these are the engines a main station can put on
  // the road for one incident, not the organisation's whole fleet.
  'kbr-sydvestjysk': {
    label: 'Sydvestjysk Brandvæsen',
    baseId: 'svjb-esbjerg',
    dispatchable: [
      {
        assetKey: 'svjb-brandbil',
        kind: 'receiver-brandbil',
        name: 'Brandbil',
        count: 4,
        icon: '🚒',
        useCases: [
          'Fire suppression at an impact or crash site',
          'Technical rescue and first response',
          'Scene lighting, water supply, and equipment support',
        ],
        capabilities: { fire_suppression: true, technical_rescue: true },
        deployTime: '5-12 minutes via real road routing',
        limitations: 'Stages at the assembly point until police declare the scene safe (REFIL doctrine at attack scenes).',
      },
    ],
    requestable: [],
  },

  'kbr-brsj': {
    label: 'Brand & Redning Sønderjylland',
    baseId: 'brsj-aabenraa',
    dispatchable: [
      {
        assetKey: 'brsj-brandbil',
        kind: 'receiver-brandbil',
        name: 'Brandbil',
        count: 3,
        icon: '🚒',
        useCases: [
          'Fire suppression at an impact or crash site',
          'Technical rescue and first response',
          'Scene lighting, water supply, and equipment support',
        ],
        capabilities: { fire_suppression: true, technical_rescue: true },
        deployTime: '8-18 minutes via real road routing',
        limitations: 'Stages at the assembly point until police declare the scene safe (REFIL doctrine at attack scenes).',
      },
    ],
    requestable: [],
  },

  'kbr-nordjyllands': {
    label: 'Nordjyllands Beredskab',
    baseId: 'nobr-aalborg',
    dispatchable: [
      {
        assetKey: 'nobr-brandbil',
        kind: 'receiver-brandbil',
        name: 'Brandbil',
        count: 4,
        icon: '🚒',
        useCases: [
          'Fire suppression at an impact or crash site',
          'Technical rescue and first response',
          'Scene lighting, water supply, and equipment support',
        ],
        capabilities: { fire_suppression: true, technical_rescue: true },
        deployTime: '8-20 minutes via real road routing',
        limitations: 'Stages at the assembly point until police declare the scene safe (REFIL doctrine at attack scenes).',
      },
    ],
    requestable: [],
  },

  'kbr-hovedstaden': {
    label: 'Hovedstadens Beredskab',
    baseId: 'hbr-hovedbrandstationen',
    dispatchable: [
      {
        assetKey: 'hbr-brandbil',
        kind: 'receiver-brandbil',
        name: 'Brandbil',
        count: 6,
        icon: '🚒',
        useCases: [
          'Fire suppression at an impact or crash site',
          'Technical rescue and first response in the capital region',
          'Scene lighting, water supply, and equipment support',
        ],
        capabilities: { fire_suppression: true, technical_rescue: true },
        deployTime: '4-10 minutes via real road routing',
        limitations: 'Stages at the assembly point until police declare the scene safe (REFIL doctrine at attack scenes).',
      },
    ],
    requestable: [],
  },

  // Added 2026-09-22. Same two rescue teams as Hedehusene, from the
  // centre that actually covers each region. Both bases were already in
  // receiver_bases.js, verified against brs.dk, and unused: the role
  // existed, the address existed, and nothing connected them.
  'brs-haderslev': {
    label: 'Beredskabsstyrelsen Sydjylland (Haderslev)',
    baseId: 'brs-sydjylland-haderslev',
    dispatchable: [
      {
        assetKey: 'brsh-rescue-team',
        kind: 'receiver-rescue-team',
        name: 'Rescue team',
        count: 2,
        icon: '⛑',
        useCases: [
          'Heavy rescue at a structural impact site',
          'Search of collapsed or damaged structures',
          'Scene support for fire and hazmat conditions',
        ],
        capabilities: { heavy_rescue: true, structural_search: true, hazmat_support: true },
        deployTime: '20-35 minutes via real road routing',
        limitations: 'Not a medical unit. Works alongside ambulances and fire services.',
      },
    ],
    requestable: [],
  },

  // Added 2026-09-22. Same two rescue teams as Hedehusene, from the
  // centre that actually covers each region. Both bases were already in
  // receiver_bases.js, verified against brs.dk, and unused: the role
  // existed, the address existed, and nothing connected them.
  'brs-thisted': {
    label: 'Beredskabsstyrelsen Nordjylland (Thisted)',
    baseId: 'brs-nordjylland-thisted',
    dispatchable: [
      {
        assetKey: 'brst-rescue-team',
        kind: 'receiver-rescue-team',
        name: 'Rescue team',
        count: 2,
        icon: '⛑',
        useCases: [
          'Heavy rescue at a structural impact site',
          'Search of collapsed or damaged structures',
          'Scene support for fire and hazmat conditions',
        ],
        capabilities: { heavy_rescue: true, structural_search: true, hazmat_support: true },
        deployTime: '20-35 minutes via real road routing',
        limitations: 'Not a medical unit. Works alongside ambulances and fire services.',
      },
    ],
    requestable: [],
  },

  'brs-naestved': {
    label: 'Beredskabsstyrelsen Sjælland (Næstved)',
    baseId: 'brs-sjaelland-naestved',
    dispatchable: [
      {
        assetKey: 'brsn-rescue-team',
        kind: 'receiver-rescue-team',
        name: 'Rescue team',
        count: 2,
        icon: '⛑',
        useCases: [
          'Heavy rescue at a structural impact site',
          'Search of collapsed or damaged structures',
          'Scene support for fire and hazmat conditions',
        ],
        capabilities: { heavy_rescue: true, structural_search: true, hazmat_support: true },
        deployTime: '20-35 minutes via real road routing',
        limitations: 'Not a medical unit. Works alongside ambulances and fire services.',
      },
    ],
    requestable: [],
  },

  'brs-hedehusene': {
    label: 'Beredskabsstyrelsen Hovedstaden',
    baseId: 'brs-hedehusene',
    dispatchable: [
      {
        assetKey: 'brs-rescue-team',
        kind: 'receiver-rescue-team',
        name: 'Rescue team',
        count: 2,
        icon: '⛑',
        useCases: [
          'Heavy rescue at a structural impact site',
          'Search of collapsed or damaged structures',
          'Scene support for fire and hazmat conditions',
        ],
        capabilities: { heavy_rescue: true, structural_search: true, hazmat_support: true },
        deployTime: '20-35 minutes via real road routing',
        limitations: 'Not a medical unit. Works alongside ambulances and fire services.',
      },
    ],
    requestable: [],
  },
};

// Resolve the asset spec for a receiver role. Returns null if the
// role has no defined assets yet. Callers use this to render the
// role's response console.
export function assetsForReceiverRole(roleId) {
  return RECEIVER_ASSETS[roleId] || null;
}

// Look up a specific dispatchable asset spec by role + assetKey.
// Used when the operator clicks a dispatch button so the handler
// knows the asset's kind, icon, and label.
export function getReceiverDirectAsset(roleId, assetKey) {
  const roleAssets = RECEIVER_ASSETS[roleId];
  if (!roleAssets) return null;
  return roleAssets.dispatchable.find(a => a.assetKey === assetKey || a.assetKey === assetKey) || null;
}

// Look up a requestable asset spec by role + requestKey. Used when
// the operator clicks a request button so the handler knows which
// target profile to route the escalation to.
export function getReceiverRequestAsset(roleId, requestKey) {
  const roleAssets = RECEIVER_ASSETS[roleId];
  if (!roleAssets) return null;
  return roleAssets.requestable.find(r => r.requestKey === requestKey) || null;
}
