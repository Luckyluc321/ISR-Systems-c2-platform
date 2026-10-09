// ═══════════════════════════════════════════════════════════════════
// Armament — what a Danish unit can actually fire at an aerial target
// ───────────────────────────────────────────────────────────────────
// Every row carries a source and a confidence label. Nothing is here
// because it sounded plausible.
//
// This file exists because of a specific mistake. Patrol cars in this
// product once carried invented counter-drone jamming hardware, which
// had to be torn out. Naming a weapon is the same trap one step
// further in, so the rule is: no weapon appears here without a Danish
// source, and anything unsourced is labelled as such and says so in
// the UI rather than quietly reading as fact.
//
// CONFIDENCE
//   'confirmed'        — an official source says it: forsvaret.dk,
//                        politi.dk, fmn.dk, fmi.dk, a government bill,
//                        or a manufacturer announcing a contract
//   'public_reporting' — credible media, not officially confirmed
//   'representative'   — no source found; a plausible class, shown as
//                        unverified and never as fact
//
// Matches the same three-level vocabulary already used by the
// `verified` field in response_assets.js.
//
// THE MOST IMPORTANT FACT IN THIS FILE
//
// Forsvarskommandoen's evaluation of 22 Sep – 6 Oct 2025 records what
// was ACTUALLY fired at suspected drones over Denmark, across roughly
// 200 reports: jamming, ONE shotgun shot, and 43 rifle rounds. No
// missiles, no autocannon, no interceptor drones, no energy weapons.
// Nothing was brought down; no crashed drone was recovered, and the
// jamming attempts are recorded as having no visible effect.
//
// So the honest picture is a thin and largely unsuccessful set of
// effectors, which is the gap this product addresses. Overstating it
// would undercut the argument, not support it.
// ═══════════════════════════════════════════════════════════════════

export const CONFIDENCE = {
  CONFIRMED: 'confirmed',
  REPORTED: 'public_reporting',
  REPRESENTATIVE: 'representative',
};

// Short label shown next to any unverified claim in the UI.
export const CONFIDENCE_LABEL = {
  confirmed: 'Confirmed',
  public_reporting: 'Reported',
  representative: 'Representative — unverified',
};

/**
 * Armament by dispatch kind.
 *
 * `engagesAir` is the field that matters operationally: a weapon can be
 * real, carried and still be useless against an aerial target. A police
 * sidearm is confirmed and is not a counter-drone effector.
 */
export const ARMAMENT = {
  'helicopter-intercept': {
    weapons: [{
      name: '12,7 mm GAU-21 døradmonteret maskingevær',
      alt: '7,62 mm MAG58M also reported',
      effectiveRangeM: 1100,
      confidence: CONFIDENCE.REPORTED,
      source: 'DR 2016 MH-60R handover fact box citing Forsvarsministeriets Materiel- '
        + 'og Indkøbsstyrelse. forsvaret.dk\'s own MH-60R page lists no armament.',
    }],
    engagesAir: true,
    // Stated so nobody re-adds it. The US MH-60R carries Hellfire and
    // the Danish one does not; its official role is rescue, observation
    // and transport, and torpedo integration was still in dummy-drop
    // testing in May 2025.
    notCarried: ['AGM-114 Hellfire', 'air-to-surface missiles'],
  },

  'army-c-uas': {
    weapons: [
      { name: 'Haglgevær (Benelli M4 reported)', effectiveRangeM: 100,
        confidence: CONFIDENCE.CONFIRMED,
        source: 'forsvaret.dk 2025: shotguns acquired for "nedkæmpelse af bl.a. droner '
          + 'på kort afstand". Chosen because pellets are lethal within a few hundred '
          + 'metres where rifled rounds carry several thousand. Benelli M4 and the '
          + '~50-100 m figure are TV 2 reporting, not official.' },
      { name: 'Stationære jammingsystemer', effectiveRangeM: null,
        confidence: CONFIDENCE.CONFIRMED,
        source: 'Forsvarskommandoen 3 Jun 2026: "På udvalgte installationer har '
          + 'Forsvaret desuden stationære dronebekæmpelsessystemer". Selected '
          + 'installations only, and recorded as having no visible effect in 2025.' },
      { name: 'IKK CV90, 35 mm maskinkanon', effectiveRangeM: 4000,
        confidence: CONFIDENCE.CONFIRMED,
        source: 'forsvaret.dk 2025: can "nedkæmpe mål både på jorden og om nødvendigt '
          + 'i luften". Deployed during the 2025 incursions.' },
    ],
    engagesAir: true,
  },

  'police-c-uas': {
    weapons: [
      { name: 'Tjenestepistol (H&K USP Compact / SIG Sauer P320)', effectiveRangeM: 50,
        confidence: CONFIDENCE.CONFIRMED,
        source: 'politi.dk 2023. Mid-transition: the P320 replaces the USP Compact '
          + 'with full rollout expected end-2027, so both are in service today.' },
      { name: 'Karabin (H&K MP5 / Colt Canada M/10 / SIG MCX)', effectiveRangeM: 200,
        confidence: CONFIDENCE.CONFIRMED,
        source: 'politi.dk 2023, MCX selected 2024. NOT in every patrol car: the '
          + 'pistol goes to all officers, the carbine only to selected groups and '
          + 'reaction patrols.' },
      { name: 'Basalt nedtagningsudstyr (type not disclosed)', effectiveRangeM: null,
        confidence: CONFIDENCE.CONFIRMED,
        source: 'politi.dk 25 Jun 2026 confirms the purchase and describes it no '
          + 'further. Also bought: thermal scopes, distributed; and detection gear.' },
    ],
    // Deliberately false. The police have the legal POWER to neutralise
    // drones under politiloven § 13 a since 1 Jan 2026, with method
    // freedom explicitly including firearms and jamming. A power is not
    // a capability: no official source confirms the police own a
    // jammer, a net launcher or an interceptor drone, and jamming
    // hardware is in principle unlawful under radioudstyrsloven outside
    // narrow exceptions. In September 2025 the police chose NOT to
    // shoot, on the stated grounds that falling drones were too
    // dangerous over that location.
    engagesAir: false,
    notCarried: ['jammer', 'net launcher', 'interceptor drone'],
  },

  'hjv-reinforce': {
    weapons: [{
      name: 'Gevær M/25 (Colt Canada C8 MRR) / M/10, 5,56 mm', effectiveRangeM: 500,
      confidence: CONFIDENCE.CONFIRMED,
      source: 'forsvaret.dk 2026: ~50,000 M/25 being issued to Forsvaret and '
        + 'Hjemmeværnet, replacing the M/10, phased through 2026-27, so both are in '
        + 'service.',
    }],
    // A 5.56 mm rifle is not a counter-drone effector in any doctrinal
    // sense. The one documented Danish rifle engagement against a drone
    // produced 43 rounds and no recovered airframe.
    engagesAir: false,
  },

  'sof-tactical': {
    weapons: [{
      name: 'Colt Canada C8-familie karabin',
      confidence: CONFIDENCE.REPRESENTATIVE,
      source: 'No forsvaret.dk source lists Jægerkorpset or Frømandskorpset small '
        + 'arms. Consistent with the Army\'s C8-derived M/10 and M/25, but inferred. '
        + 'Note Specialoperationskommandoen contributes counter-drone EQUIPMENT to '
        + 'these tasks rather than small arms.',
    }],
    engagesAir: false,
  },

  'air-force-qra': {
    weapons: [
      { name: 'AIM-120 AMRAAM', effectiveRangeM: 160000, confidence: CONFIDENCE.CONFIRMED,
        source: 'Standard F-35A air-to-air armament.' },
      { name: 'AIM-9X Sidewinder', effectiveRangeM: 35000, confidence: CONFIDENCE.CONFIRMED,
        source: 'Standard F-35A air-to-air armament.' },
      { name: 'GAU-22/A 25 mm kanon', effectiveRangeM: 3000, confidence: CONFIDENCE.CONFIRMED,
        source: 'Internal cannon, F-35A.' },
    ],
    // Against a manned aircraft or a cruise missile, yes. Against a
    // drone over civilian infrastructure, no: Forsvarskommandoen's
    // effector list contains no aircraft, and civilian-site response is
    // police-led. response_assets.js already guards this as "the F-35
    // dispatched to intercept a hobby quadcopter anti-pattern".
    engagesAir: true,
    notFor: 'small drones over civilian sites',
  },

  // Explicitly unarmed. Listed rather than omitted so the absence is a
  // decision on the record and nobody later assumes it was overlooked.
  'army-isr-drone': { weapons: [], engagesAir: false, note: 'Visual verification only.' },
  'wildlife-response': { weapons: [], engagesAir: false, note: 'Bird dispersal, on-airport.' },
  'receiver-ambulance': { weapons: [], engagesAir: false },
  'receiver-brandbil': { weapons: [], engagesAir: false },
  'receiver-rescue-team': { weapons: [], engagesAir: false },
  'receiver-forensic-van': { weapons: [], engagesAir: false },
  'receiver-cyber-team': { weapons: [], engagesAir: false },
  'receiver-coord-cell': { weapons: [], engagesAir: false },
};

/**
 * Capabilities Denmark is commonly assumed to have and does not.
 *
 * Kept in code rather than a document because each one is a question
 * somebody will eventually ask of this product, and the answer should
 * not depend on who is in the room.
 */
export const NOT_FIELDED = [
  { claim: 'Danish interceptor drones',
    status: 'No contract, no supplier, absent from FMI\'s Anskaffelsesplan 2026. '
      + 'Forsvarskommandoen\'s evaluation lists them both as an existing capability '
      + 'and as one being built, which is internally inconsistent. MEROPS is '
      + 'unverified from any Danish source.' },
  { claim: 'Police jammers, net launchers or interceptor drones',
    status: 'politiloven § 13 a permits the methods from 1 Jan 2026. Rigspolitiet '
      + 'admits only thermal scopes, detection equipment and undescribed "basalt '
      + 'nedtagningsudstyr".' },
  { claim: 'Energy or laser weapons',
    status: 'The evaluation lists energivåben among effector types that exist in the '
      + 'world. It does not claim Denmark has one.' },
  { claim: 'Terma command-and-control as an effector',
    status: 'It fuses sensors. It controls no weapon today; countermeasures are a '
      + 'stated future integration.' },
  { claim: 'NASAMS against small drones',
    status: 'Contracted Nov 2025, full operational capability reported 2028, and not '
      + 'available during the 2025 incursions. No Danish source presents it as a '
      + 'counter-small-drone system.' },
  { claim: 'Skyranger 30 in service',
    status: '16 turrets contracted Sep 2024. No source confirms delivery or '
      + 'operational status.' },
  { claim: 'A published sensor range for the Danish MH-60R',
    status: 'There is none. Neither Forsvaret nor FMI publishes a detection '
      + 'range, and no manufacturer figure exists for the AN/APS-147 class '
      + 'radar or the MTS-FLIR turret. The "200 nautical miles" in circulation '
      + 'is an INSTRUMENTED range from a third-party equipment database — the '
      + 'distance the test instrumentation measures to, not a detection range '
      + 'against a target. The acquisition figure in CD_PROFILE is '
      + 'deliberately conservative and labelled representative.' },
  { claim: 'Hellfire on Danish MH-60R',
    status: 'The US aircraft carries it. No Danish source names it. Official Danish '
      + 'role is rescue, observation and transport.' },
];

/** Armament for a dispatch kind, or null when nothing is recorded. */
export function armamentFor(kind) {
  return ARMAMENT[kind] || null;
}

/** Weapons on this unit that can engage an aerial target at all. */
export function airEngagementWeapons(kind) {
  const entry = ARMAMENT[kind];
  if (!entry || !entry.engagesAir) return [];
  return entry.weapons || [];
}

/** True when any part of this unit's armament is unverified. */
export function hasUnverifiedArmament(kind) {
  const entry = ARMAMENT[kind];
  if (!entry) return false;
  return (entry.weapons || []).some((w) => w.confidence === CONFIDENCE.REPRESENTATIVE);
}
