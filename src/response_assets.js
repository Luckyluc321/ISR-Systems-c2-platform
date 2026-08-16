// Danish national response asset registry.
// Real coordinates of key units used to compute "nearest response" for a
// detection brief. Real product would call an authoritative API (Politi,
// Forsvaret, Beredskabsstyrelsen). For the demo these are hardcoded.
//
// GRADUATED RESPONSE: tacticalResponseForSubject(subject, lat, lon) maps
// a DetectionSubject (class + cardinality + category) to the appropriate
// response asset kinds. Prevents sending an F-35 QRA to intercept a
// hobby quadcopter, and prevents sending a police C-UAS team to a
// hypersonic weapon.
//
// PROVENANCE: every asset entry carries `verified`:
//   'confirmed'         — publicly confirmed unit location and role
//   'public_reporting'  — from press / MoD releases, may be dated
//   'representative'    — plausible attribution for demo purposes, not
//                         claiming operational deployment

const ASSETS = [
  // ── Politi (National Police) — 12 districts + national HQ ──
  { id: 'politi-kbh',     name: 'Politi København',           kind: 'police',   lat: 55.6767, lon: 12.5687, response: 'Patrol dispatch' },
  { id: 'politi-vestegn', name: 'Københavns Vestegns Politi', kind: 'police',   lat: 55.6521, lon: 12.5117, response: 'Patrol dispatch' },
  { id: 'politi-nord',    name: 'Nordsjællands Politi',       kind: 'police',   lat: 55.9384, lon: 12.3239, response: 'Patrol dispatch' },
  { id: 'politi-sydvest', name: 'Syd- og Sønderjyllands Politi (Esbjerg)', kind: 'police', lat: 55.4671, lon: 8.4527, response: 'Patrol dispatch' },
  { id: 'politi-syd',     name: 'Sydsjællands Politi',        kind: 'police',   lat: 55.4123, lon: 11.7614, response: 'Patrol dispatch' },
  { id: 'politi-midtvest',name: 'Midt- og Vestjyllands Politi',kind:'police',   lat: 56.4585, lon: 9.4020,  response: 'Patrol dispatch' },
  { id: 'politi-oestjyl', name: 'Østjyllands Politi',         kind: 'police',   lat: 56.1567, lon: 10.2107, response: 'Patrol dispatch' },
  { id: 'politi-nordjyl', name: 'Nordjyllands Politi',        kind: 'police',   lat: 57.0488, lon: 9.9187,  response: 'Patrol dispatch' },
  { id: 'politi-fyn',     name: 'Fyns Politi',                kind: 'police',   lat: 55.3959, lon: 10.3883, response: 'Patrol dispatch' },
  { id: 'politi-sydoest', name: 'Sydøstjyllands Politi',      kind: 'police',   lat: 55.7100, lon: 9.5350,  response: 'Patrol dispatch' },
  { id: 'politi-bornholm',name: 'Bornholms Politi',           kind: 'police',   lat: 55.1000, lon: 14.7067, response: 'Patrol dispatch' },
  { id: 'politi-midtsjael',name:'Midt- og Vestsjællands Politi',kind:'police',  lat: 55.4200, lon: 11.5700, response: 'Patrol dispatch' },
  { id: 'rigspolitiet',   name: 'Rigspolitiet, National HQ',  kind: 'police-national', lat: 55.6867, lon: 12.5680, response: 'National coordination' },

  // ── Flyvevåbnet (Danish Air Force) ──
  { id: 'flv-skrydstrup', name: 'Flyvevåbnet QRA Skrydstrup', kind: 'air-force-qra', lat: 55.2210, lon: 9.2640, response: 'F-35 airborne intercept' },
  { id: 'flv-aalborg',    name: 'Flyvestation Aalborg',       kind: 'air-force',     lat: 57.0928, lon: 9.8492, response: 'Transport / support' },
  { id: 'flv-karup',      name: 'Flyvestation Karup',         kind: 'air-force',     lat: 56.2975, lon: 9.1247, response: 'Helicopter / air defence control' },

  // ── Søværnet (Danish Navy) ──
  { id: 'sov-frederikshavn', name: 'Søværnet Base Frederikshavn', kind: 'navy',      lat: 57.4419, lon: 10.5460, response: 'Patrol vessel dispatch' },
  { id: 'sov-korsoer',       name: 'Søværnet Base Korsør',        kind: 'navy',      lat: 55.3363, lon: 11.1364, response: 'Patrol vessel dispatch' },

  // ── Kystvagten (Coast Guard, navy-attached) ──
  { id: 'kv-esbjerg',     name: 'Kystvagten Esbjerg',        kind: 'coast-guard',   lat: 55.4671, lon: 8.4400, response: 'Coast Guard cutter' },

  // ── Hjemmeværnet (Home Guard, regional districts) ──
  { id: 'hjv-kbh',        name: 'Hjemmeværnet København',    kind: 'home-guard',    lat: 55.6800, lon: 12.5700, response: 'Ground reinforcement' },
  { id: 'hjv-syd',        name: 'Hjemmeværnet Syddanmark',   kind: 'home-guard',    lat: 55.4700, lon: 9.4100,  response: 'Ground reinforcement' },
  { id: 'hjv-midt',       name: 'Hjemmeværnet Midtjylland',  kind: 'home-guard',    lat: 56.1600, lon: 10.2000, response: 'Ground reinforcement' },
  { id: 'hjv-nord',       name: 'Hjemmeværnet Nordjylland',  kind: 'home-guard',    lat: 57.0500, lon: 9.9200,  response: 'Ground reinforcement' },

  // ── Beredskabsstyrelsen (Emergency Management) ──
  { id: 'brs-hedehusene', name: 'Beredskabsstyrelsen Hedehusene', kind: 'emergency', lat: 55.6519, lon: 12.1975, response: 'Emergency civil response' },
  { id: 'brs-thisted',    name: 'Beredskabsstyrelsen Thisted',    kind: 'emergency', lat: 56.9558, lon: 8.6961,  response: 'Emergency civil response' },
  { id: 'brs-haderslev',  name: 'Beredskabsstyrelsen Haderslev',  kind: 'emergency', lat: 55.2500, lon: 9.4900,  response: 'Emergency civil response' },

  // ── Forsvarskommandoen (Defence Command HQ) ──
  { id: 'forsvarskmd', name: 'Forsvarskommandoen (Karup)', kind: 'defence-command', lat: 56.2975, lon: 9.1247, response: 'Central defence coordination', verified: 'confirmed' },

  // ══════════════════════════════════════════════════════════════
  // ARMY GARRISONS — ISR drones, counter-UAS, tactical response
  // ══════════════════════════════════════════════════════════════

  // Gardehusarregimentet (2nd Brigade). Slagelse Kaserne. Confirmed
  // drone trials 2026, ISR platoons under Hærens modernisation.
  // Source: nordicdefencesector.com, Grokipedia (Guard Hussar Regiment).
  { id: 'army-slagelse-isr', name: 'Gardehusarregimentet · ISR-drone platoon (Slagelse)',
    kind: 'army-isr-drone', lat: 55.4033, lon: 11.3540,
    response: 'Own recon drone dispatch for visual verify',
    verified: 'public_reporting',
    source: 'Danish Army modernisation programme, GHR drone trials 2026' },
  { id: 'army-slagelse-cuas', name: 'Gardehusarregimentet · C-UAS team (Slagelse)',
    kind: 'army-c-uas', lat: 55.4033, lon: 11.3540,
    response: 'Mobile counter-UAS (RF + kinetic)',
    verified: 'representative',
    source: 'Plausible attribution based on GHR ISR role; specific fielding not disclosed' },

  // Livgarden. Høvelte Kaserne. Primarily ceremonial + light infantry.
  // Not a drone-heavy unit historically, but included as ground
  // reinforcement asset for greater-Copenhagen incidents.
  { id: 'army-hovelte-ground', name: 'Livgarden · Rapid ground reinforcement (Høvelte)',
    kind: 'army-ground', lat: 55.8722, lon: 12.3947,
    response: 'Ground reinforcement north Zealand',
    verified: 'confirmed',
    source: 'Livgardens Kaserne, Høvelte — confirmed location' },

  // Efterretningsregimentet (Intel/EW Regiment). Varde Kaserne.
  // ISR + electronic warfare specialisation.
  { id: 'army-varde-isr', name: 'Efterretningsregimentet · ISR/EW (Varde)',
    kind: 'army-isr-drone', lat: 55.6215, lon: 8.5253,
    response: 'Tactical ISR + EW support',
    verified: 'confirmed',
    source: 'Efterretningsregimentet at Varde Kaserne — confirmed' },
  { id: 'army-varde-cuas', name: 'Efterretningsregimentet · C-UAS RF team (Varde)',
    kind: 'army-c-uas', lat: 55.6215, lon: 8.5253,
    response: 'RF-based counter-UAS detect + disrupt',
    verified: 'representative',
    source: 'EW-focused regiment; C-UAS RF role plausible, fielding not disclosed' },

  // Bornholm garrison. Almegård Kaserne. Strategic Baltic position,
  // air defense radar.
  { id: 'army-bornholm-cuas', name: 'Bornholms Værn · C-UAS (Almegård)',
    kind: 'army-c-uas', lat: 55.1272, lon: 14.8703,
    response: 'Island-based counter-UAS + air defense radar',
    verified: 'representative',
    source: 'Almegård Kaserne — confirmed location; C-UAS attribution representative' },

  // Hærens Kampskole. Oksbøl. Training + doctrine + reserve counter-UAS
  // instructor cadre.
  { id: 'army-oksbol-training', name: 'Hærens Kampskole · C-UAS instructor cadre (Oksbøl)',
    kind: 'army-c-uas', lat: 55.6167, lon: 8.2833,
    response: 'Training + reserve C-UAS deployment',
    verified: 'representative',
    source: 'HKS at Oksbøl — confirmed; C-UAS instructor role representative' },

  // ══════════════════════════════════════════════════════════════
  // AIR FORCE — helicopter intercept, tactical air
  // ══════════════════════════════════════════════════════════════

  // Helicopter Wing at Karup. EH-101 Merlin + AS550 Fennec fleet.
  // Suited to slow/medium airborne intercept where F-35 is overkill.
  { id: 'flv-karup-helo-intercept', name: 'Helicopter Wing · Tactical intercept (Karup)',
    kind: 'helicopter-intercept', lat: 56.2975, lon: 9.1247,
    response: 'EH-101 / Fennec airborne intercept for slow movers',
    verified: 'confirmed',
    source: 'Helicopter Wing Karup — confirmed base + fleet' },

  // ══════════════════════════════════════════════════════════════
  // SOF — Special Operations, tactical response
  // ══════════════════════════════════════════════════════════════

  // Jægerkorpset (Danish Army SOF). Aalborg garrison. Reserved for
  // loitering munitions + high-risk C-UAS + interdiction.
  { id: 'sof-aalborg-jaeger', name: 'Jægerkorpset · Tactical response (Aalborg)',
    kind: 'sof-tactical', lat: 57.0928, lon: 9.9200,
    response: 'SOF tactical response, loitering-munition interdiction',
    verified: 'public_reporting',
    source: 'Jægerkorpset at Aalborg — public reporting, exact deployment classified' },

  // ══════════════════════════════════════════════════════════════
  // POLICE — C-UAS teams (Rigspolitiet)
  // ══════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════
  // COUNTER-DRONE INTERCEPTOR SWARM (kinetic, close-range)
  // ══════════════════════════════════════════════════════════════

  // Efterretningsregimentet · Interceptor Drone Team at Varde
  // Realistic staging ground given the regiment's ISR + EW role
  // and existing sensor infrastructure. Interceptor drone capability
  // itself is representative for the demo.
  { id: 'army-varde-interceptor', name: 'Efterretningsregimentet · Interceptor Drone Team (Varde)',
    kind: 'counter-drone-swarm', lat: 55.6215, lon: 8.5253,
    response: 'Airborne counter-drone kinetic package',
    verified: 'representative',
    source: 'Danish MoD C-UAS procurement 2024-2026, unit assignment representative for demo' },

  // Rigspolitiet · Slotsholmen Interceptor Team (near Christiansborg)
  // Inner-city Copenhagen posture. Slotsholmen island lat/lon
  // matches Christiansborg palace complex. Representative for demo,
  // no such standing capability exists today in Danish inventory.
  { id: 'politi-slotsholmen-interceptor', name: 'Rigspolitiet · Slotsholmen Interceptor Team',
    kind: 'counter-drone-swarm', lat: 55.6767, lon: 12.5793,
    response: 'Inner-city counter-drone kinetic response',
    verified: 'representative',
    source: 'Inner-city Copenhagen protection posture, representative for demo' },

  // Rigspolitiet National C-UAS Response Team. Copenhagen HQ.
  // Deployable nationwide, patrol-mounted + fixed jammers.
  { id: 'politi-national-cuas', name: 'Rigspolitiet · National C-UAS Response Team',
    kind: 'police-c-uas', lat: 55.6867, lon: 12.5680,
    response: 'Patrol-mounted C-UAS jamming + drone kit',
    verified: 'representative',
    source: 'Danish Police C-UAS capability publicly acknowledged; team structure representative',
    // Team-specific overrides so the two Politi options don't show
    // identical copy in the Mission Console. Only C-UAS-specialised
    // units are equipped for this response, not standard patrols.
    includesOverride: [
      'Specialised patrol vehicle with heavy RF-jamming array (national kit)',
      'Cruises to intercept point at ~90 km/h with sirens',
      'Deploys own drone kit for visual verify',
      'Coordinates with Air Force + FE if platform is peer-military',
      'Arrest team on scene if operator located',
    ],
    deployedForOverride: 'National-level threats requiring specialised C-UAS package. Cross-jurisdictional incursions, VIP protection, state-level intelligence-linked cases. First-choice unit when the local district lacks C-UAS specialisation.',
    tradeoffsOverride: 'Larger footprint than local patrol. National mobilisation adds coordination overhead. Held for cases the local district cannot handle alone.',
  },

  // Copenhagen Politi C-UAS team. Metro Copenhagen coverage.
  { id: 'politi-kbh-cuas', name: 'Københavns Politi · C-UAS patrol team',
    kind: 'police-c-uas', lat: 55.6767, lon: 12.5687,
    response: 'Metro Copenhagen C-UAS + drone team',
    verified: 'representative',
    source: 'Major-city police C-UAS team is standard practice, specific team not public',
    includesOverride: [
      'Local C-UAS-equipped patrol vehicle (compact kit)',
      'Fast urban response inside Copenhagen district boundaries',
      'Handheld RF jam plus small drone kit',
      'Direct handoff to local investigation unit for arrest',
    ],
    deployedForOverride: 'District-level airport perimeter incidents and small drone incursions inside Copenhagen. First response for CPH airport perimeter events, Christiansborg district events, and central-Copenhagen protection sweeps.',
    tradeoffsOverride: 'Not equipped for peer-military threats. Scope limited to Copenhagen district. Standard patrols WITHOUT C-UAS training are not part of this response option.',
  },

  // ══════════════════════════════════════════════════════════════
  // WILDLIFE — airport bird-strike response
  // ══════════════════════════════════════════════════════════════

  // CPH Airport wildlife management team. Ornithologists, pyrotechnic
  // deterrents, habitat management. Every major airport has one.
  { id: 'wildlife-cph', name: 'CPH Airport · Wildlife Management Team',
    kind: 'wildlife-response', lat: 55.6180, lon: 12.6561,
    response: 'Bird deterrent + wildlife dispersal',
    verified: 'public_reporting',
    source: 'ICAO Annex 14 mandates wildlife management at all commercial airports' },
];

// Great-circle distance in kilometres
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Response ETA estimator (very rough, for demo).
// speedKmh per kind of asset, plus mobilisation overhead in minutes.
const RESPONSE_PROFILE = {
  'police':               { speedKmh: 80,   mobilisationMin: 3  },
  'police-national':      { speedKmh: 80,   mobilisationMin: 15 },
  'police-c-uas':         { speedKmh: 80,   mobilisationMin: 8  },  // patrol-mounted, ready
  'air-force-qra':        { speedKmh: 1900, mobilisationMin: 8  },  // F-35 supersonic dash
  'air-force':            { speedKmh: 300,  mobilisationMin: 20 },  // helicopter/transport
  'helicopter-intercept': { speedKmh: 250,  mobilisationMin: 12 },  // Merlin / Fennec airborne
  'navy':                 { speedKmh: 35,   mobilisationMin: 30 },  // patrol vessel
  'coast-guard':          { speedKmh: 40,   mobilisationMin: 20 },
  'home-guard':           { speedKmh: 70,   mobilisationMin: 45 },  // mobilisation-heavy
  'army-isr-drone':       { speedKmh: 60,   mobilisationMin: 15 },  // own drone launch + transit
  'army-c-uas':           { speedKmh: 60,   mobilisationMin: 20 },  // mobile C-UAS team
  'army-ground':          { speedKmh: 70,   mobilisationMin: 30 },  // ground reinforcement
  'sof-tactical':         { speedKmh: 200,  mobilisationMin: 25 },  // SOF air-inserted
  'emergency':            { speedKmh: 80,   mobilisationMin: 15 },
  'wildlife-response':    { speedKmh: 20,   mobilisationMin: 5  },  // on-airport, foot/vehicle
  'counter-drone-swarm':  { speedKmh: 120,  mobilisationMin: 5  },  // interceptor swarm, airborne fast
  'defence-command':      { speedKmh: null, mobilisationMin: 2  },  // not physical, coordination only
};

function estimateEtaMinutes(kind, distanceKm) {
  const p = RESPONSE_PROFILE[kind] || { speedKmh: 80, mobilisationMin: 10 };
  if (p.speedKmh == null) return p.mobilisationMin;
  const travelMin = (distanceKm / p.speedKmh) * 60;
  return Math.round(p.mobilisationMin + travelMin);
}

function formatEta(min) {
  if (min < 1) return 'immediate';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

// Return N closest assets to a given lat/lon. Filters/sorts by ETA (not raw
// distance) because an F-35 QRA 200km away arrives faster than a patrol car
// 30km away in traffic.
export function nearestResponseAssets(lat, lon, count = 3, filterKinds = null) {
  const candidates = ASSETS
    .filter(a => !filterKinds || filterKinds.includes(a.kind))
    .map(a => {
      const d = distanceKm(lat, lon, a.lat, a.lon);
      const etaMin = estimateEtaMinutes(a.kind, d);
      return { ...a, distanceKm: Math.round(d * 10) / 10, etaMin, etaLabel: formatEta(etaMin) };
    })
    .sort((a, b) => a.etaMin - b.etaMin);
  return candidates.slice(0, count);
}

// Return a diverse response mix (one air asset, one police, one ground/local).
// Better for the brief than "3 closest police" which would all be same category.
export function diverseResponseMix(lat, lon) {
  const air    = nearestResponseAssets(lat, lon, 1, ['air-force-qra', 'air-force']);
  const police = nearestResponseAssets(lat, lon, 1, ['police', 'police-national']);
  const ground = nearestResponseAssets(lat, lon, 1, ['home-guard', 'emergency', 'navy', 'coast-guard']);
  return [...police, ...air, ...ground].filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────
// CATEGORIZED ASSET SETS FOR THE RESPONSE OVERLAY
// ─────────────────────────────────────────────────────────────────
// Response = capabilities that can act ON the threat (intercept, disrupt, deny).
//   For aerial drones this means airborne intercept (QRA, helicopters) or naval
//   air-defence in maritime scope. Police are NOT response for an airborne
//   drone — they are ground coordination.
//
// Ground coordination = physical presence at the site (cordon, evidence, arrest
//   the operator when found). Politi districts + Rigspolitiet.
//
// Civil consequence = emergency management + reinforcement. Beredskabsstyrelsen
//   (mass alert, casualty triage, HAZMAT), Hjemmeværnet (reinforcement).

const RESPONSE_KINDS = ['air-force-qra', 'air-force', 'navy', 'coast-guard'];
const GROUND_COORD_KINDS = ['police', 'police-national'];
const CIVIL_KINDS = ['emergency', 'home-guard'];

export function tacticalResponseAssets(lat, lon, count = 2) {
  return nearestResponseAssets(lat, lon, count, RESPONSE_KINDS);
}
export function groundCoordinationAssets(lat, lon, count = 2) {
  return nearestResponseAssets(lat, lon, count, GROUND_COORD_KINDS);
}
export function civilConsequenceAssets(lat, lon, count = 2) {
  return nearestResponseAssets(lat, lon, count, CIVIL_KINDS);
}

// Full response bundle: tactical top, coordination middle, consequence bottom.
// LEGACY entry point — routes by proximity only. Prefer
// responseBundleForSubject(subject, lat, lon) for graduated response.
export function responseBundle(lat, lon) {
  return {
    tactical:     tacticalResponseAssets(lat, lon, 2),
    ground:       groundCoordinationAssets(lat, lon, 2),
    consequence:  civilConsequenceAssets(lat, lon, 2),
  };
}

// ══════════════════════════════════════════════════════════════════
// GRADUATED RESPONSE — DetectionSubject → response asset kinds
// ══════════════════════════════════════════════════════════════════
// Maps what the sensor mesh detected to the RIGHT asset kinds. Fixes
// the "F-35 dispatched to intercept a hobby quadcopter" anti-pattern.
// Consumers pass the DetectionSubject (event.subject) and get back the
// tactical kinds appropriate to class + cardinality + category.

// Returns { kinds: string[], rationale: string }. Empty kinds array
// means "no tactical dispatch appropriate — passive tracking only"
// (e.g. commercial airliner on filed flight plan).
export function tacticalKindsForSubject(subject) {
  if (!subject) return { kinds: ['police-c-uas'], rationale: 'No subject data, dispatch police C-UAS as default.' };

  const cls = subject.class;
  const cardinality = subject.cardinality?.kind;
  const category = subject.category;
  const isSwarm = cardinality === 'swarm' || cardinality === 'multiple';

  // Biological — wildlife only, no military. Even a large bird flock
  // near an airport is handled by the wildlife team, not the Army.
  if (category === 'biological') {
    return { kinds: ['wildlife-response'], rationale: 'Biological target. Wildlife management team, no military dispatch.' };
  }

  // Weapon — graduated by class within the weapon category.
  if (category === 'weapon') {
    if (cls === 'loitering_munition') {
      // Slow enough that helicopter + C-UAS combo works. F-35 only if
      // the loitering munition sprints toward high-value asset.
      return { kinds: ['army-c-uas', 'helicopter-intercept', 'sof-tactical'], rationale: 'Loitering munition. Ground C-UAS + tactical air + SOF interdiction. F-35 held in reserve if terminal-phase sprint detected.' };
    }
    // Cruise / ballistic / hypersonic — peer-level airborne intercept
    return { kinds: ['air-force-qra'], rationale: 'Kinetic weapon. F-35 QRA is the only asset with the closure rate. NASAMS coordination if in-range.' };
  }

  // Peer military aircraft — F-35 QRA
  if (cls === 'fixed_wing_military' || cls === 'helicopter_military') {
    return { kinds: ['air-force-qra'], rationale: 'Peer military platform. F-35 QRA for identification + shadow.' };
  }

  // Commercial / civilian aircraft — passive tracking only unless
  // deviation from filed flight plan triggers reclassification.
  if (cls === 'fixed_wing_commercial' || cls === 'fixed_wing_civilian' || cls === 'helicopter_civilian') {
    return { kinds: [], rationale: 'Civilian aviation. Passive tracking only unless flight-plan deviation triggers reclassification.' };
  }

  // Small consumer drones (micro / quad) — police + own ISR verify
  // + interceptor swarm as kinetic option for restricted airspace
  if ((cls === 'micro_drone' || cls === 'quadcopter') && !isSwarm) {
    return { kinds: ['police-c-uas', 'army-isr-drone', 'counter-drone-swarm'], rationale: 'Single small drone. Police C-UAS patrol as first response. Own ISR drone for visual verify. Interceptor swarm as kinetic option if inside restricted airspace.' };
  }

  // Swarms and coordinated multi-drone — interceptor swarm (kinetic
  // pack hunt) + Army C-UAS jammer for multi-target RF disruption +
  // helicopter for airborne C2 and follow-up
  if (isSwarm) {
    return { kinds: ['counter-drone-swarm', 'army-c-uas', 'helicopter-intercept'], rationale: `Multi-airframe ${cardinality}. Interceptor swarm for kinetic engagement inside restricted airspace. Army C-UAS jammer for RF disruption. Helicopter intercept for airborne C2 and follow-up.` };
  }

  // Fixed-wing drones + VTOL — larger, longer endurance, helicopter class
  if (cls === 'fixed_wing_drone' || cls === 'vtol_hybrid' || cls === 'hexcopter_octocopter') {
    return { kinds: ['helicopter-intercept', 'army-c-uas'], rationale: 'Fixed-wing / heavy-rotor UAS. Helicopter intercept + Army C-UAS. F-35 not appropriate for platform closure rate.' };
  }

  // Gliders, paragliders, balloons — low-threat but jurisdictional police response
  if (cls === 'glider' || cls === 'paraglider_hang_glider' || cls === 'balloon_airship') {
    return { kinds: ['police-c-uas'], rationale: 'Recreational aircraft airspace incursion. Police jurisdiction.' };
  }

  // Unknown — dispatch cautious graduated ground + air C-UAS
  return { kinds: ['police-c-uas', 'army-c-uas', 'army-isr-drone'], rationale: 'Unknown classification. Dispatch graduated ground C-UAS + Army C-UAS + ISR drone for visual verify.' };
}

// ══════════════════════════════════════════════════════════════════
// RESPONSE OPTION DOCTRINE — what each dispatch kind actually includes
// and when it's typically deployed. Consumed by the Mission Console
// after acknowledgment so the duty officer picks with full context,
// not just a green button.
// ══════════════════════════════════════════════════════════════════
export const RESPONSE_OPTION_DETAILS = {
  'helicopter-intercept': {
    displayName: 'Helicopter Airborne Intercept',
    includes: [
      'EH-101 Merlin or AS550 Fennec airborne from Karup',
      'Airborne within ~12 minutes',
      'Orbits threat for observation + shadowing',
      'Optional door-mounted C-UAS jam assist',
      'Real-time relay to ground C-UAS team',
    ],
    deployedFor: 'Slow to medium-speed aerial threats. Especially valuable at rural sites where ground C-UAS mobilisation exceeds 30 minutes. Serves as airborne C2 for coordinated multi-asset response.',
    tradeoffs: 'Commits 1 airframe + 4 crew for ~90 min. Not appropriate for cruise missile intercept (closure rate too high).',
    outcomes: [
      { id: 'visual_shadow', label: 'Visual identification and shadowing complete', description: 'Threat platform positively identified; observation feed relayed to command.' },
      { id: 'contact_broken', label: 'Contact broken', description: 'Threat exited helicopter tracking envelope before engagement.' },
      { id: 'ground_handoff', label: 'Relayed to ground C-UAS team', description: 'Threat position handed off to ground jamming or patrol assets for kinetic follow-up.' },
      { id: 'no_intercept', label: 'Intercept not established', description: 'Threat closure rate exceeded helicopter capability; escalation required.' },
    ],
  },
  'army-c-uas': {
    displayName: 'Army Counter-Drone Jammer',
    includes: [
      'Deployed C-UAS ground station activates on base',
      'RF disruption cone projected toward threat',
      'Kinetic C-UAS option if system is fitted',
      'Continuous jam for up to 12 minutes',
    ],
    deployedFor: 'Coordinated drone swarms, quadcopter incursions, loitering munitions inside effective range (~5-8 km of the ground station).',
    tradeoffs: 'Cannot pursue if threat moves out of coverage. Best paired with helicopter-intercept for follow-up.',
    outcomes: [
      { id: 'link_disrupted', label: 'Command link disrupted', description: 'RF jamming successful; threat lost control or returned to origin.' },
      { id: 'ineffective_range', label: 'Ineffective at range', description: 'Threat outside effective jamming radius; kinetic escalation required.' },
      { id: 'kinetic_authorised', label: 'Kinetic engagement authorised', description: 'Handoff to armed C-UAS operator or SOF team.' },
      { id: 'contact_lost', label: 'Contact lost', description: 'Threat exited coverage before engagement outcome could be assessed.' },
    ],
  },
  'police-c-uas': {
    displayName: 'Police Counter-Drone Patrol',
    includes: [
      'Patrol vehicle with mounted C-UAS gear from district HQ',
      'Drives to intercept point at ~80 km/h',
      'On-site RF jam and small drone kit',
      'Arrest capability if operator located',
    ],
    deployedFor: 'Small drone incursions, unauthorised hobby aircraft, jurisdictional response inside police district. Standard first response for airport perimeter incidents.',
    tradeoffs: 'Slower than airborne assets. Effective mainly against single or small groups, not coordinated swarms.',
    outcomes: [
      { id: 'operator_detained', label: 'Operator located and detained', description: 'Ground-based operator apprehended; drone recovered and secured as evidence.' },
      { id: 'link_disrupted', label: 'Command link disrupted', description: 'RF jam successful; threat lost control before operator could be located.' },
      { id: 'operator_fled', label: 'Operator fled jurisdiction', description: 'Ground team arrived; operator no longer at launch site.' },
      { id: 'no_track', label: 'No track located', description: 'Threat exited before patrol arrival; case referred to intelligence.' },
    ],
  },
  'army-isr-drone': {
    displayName: 'Own ISR Drone Visual Verify',
    includes: [
      'Own recon quadcopter launched from unit',
      'Flies to threat area, orbits for visual confirmation',
      'Live video feed to command',
      'Handoff to kinetic asset once verified',
    ],
    deployedFor: 'Ambiguous classifications requiring visual confirmation before kinetic response. Standard first move when NN confidence is under 70% or the signature is unusual.',
    tradeoffs: 'Does NOT neutralise on its own. Adds ~6 minutes to response chain but reduces friendly-fire and misclassification risk.',
    outcomes: [
      { id: 'platform_confirmed', label: 'Platform visually confirmed', description: 'ISR feed confirms threat class and airframe; classification locked in.' },
      { id: 'payload_confirmed', label: 'Payload signature confirmed', description: 'Visible payload or fitting matches weaponised profile; escalation warranted.' },
      { id: 'hostile_intent_confirmed', label: 'Hostile intent confirmed', description: 'Behaviour observed (loiter, dive, target reconnaissance) consistent with hostile mission.' },
      { id: 'friendly_reidentified', label: 'Reclassified as friendly', description: 'Visual confirms platform is registered / benign; downgrade classification.' },
      { id: 'track_lost', label: 'Track lost before identification', description: 'ISR drone could not maintain visual before threat exited coverage.' },
    ],
  },
  'sof-tactical': {
    displayName: 'SOF Tactical Interdiction',
    includes: [
      'Jægerkorpset team dispatched via air insertion',
      'Ground engagement package',
      'Kinetic capability incl. small arms + C-UAS',
      'Post-engagement site security',
    ],
    deployedFor: 'Loitering munitions with expected ground impact, hostile drone recovery, high-value target defence when standard assets are insufficient.',
    tradeoffs: 'Longest response chain. ~25 min mobilisation + air transit. Reserved for scenarios other assets cannot handle.',
    outcomes: [
      { id: 'threat_neutralised', label: 'Threat neutralised on ground', description: 'SOF engagement successful; threat platform destroyed or captured.' },
      { id: 'payload_recovered', label: 'Payload recovered intact', description: 'Threat payload secured for intelligence exploitation.' },
      { id: 'operator_apprehended', label: 'Operator apprehended', description: 'Ground operator located and detained.' },
      { id: 'threat_evaded', label: 'Threat evaded engagement', description: 'Threat displaced before SOF team could close; alternate assets required.' },
    ],
  },
  'wildlife-response': {
    displayName: 'Airport Wildlife Team',
    includes: [
      'On-airport ornithologist dispatched to site',
      'Pyrotechnic bird deterrent',
      'Habitat management adjustment if pattern repeats',
    ],
    deployedFor: 'Bird flock detections, wildlife on runway. Standard ICAO Annex 14 airport response.',
    tradeoffs: 'Not applicable to man-made threats. Contained to airport perimeter.',
    outcomes: [
      { id: 'dispersed', label: 'Flock dispersed', description: 'Pyrotechnic or acoustic deterrent successful; airspace cleared.' },
      { id: 'relocated', label: 'Wildlife relocated', description: 'Ground fauna moved to safe distance from operating surface.' },
      { id: 'recurrent_pattern', label: 'Recurrent pattern logged', description: 'Habitat modification scheduled; ornithology report filed.' },
    ],
  },
  'counter-drone-swarm': {
    displayName: 'Counter-Drone Interceptor Swarm',
    includes: [
      'Three interceptor quadcopters airborne from unit',
      'Small-arms kinetic package for close-range engagement',
      'Pursues live threat coordinates in formation',
      'Position beacon at wreckage for follow-on ground response',
    ],
    deployedFor: 'Hostile drone incursions inside restricted airspace where RF jamming is insufficient. Effective against single drones and small coordinated swarms in built-up areas where missile intercept would be inappropriate.',
    tradeoffs: 'Close-range engagement only. Not suitable for missile-class threats. Interceptors return to base if the hostile drone escapes coverage before they arrive.',
    outcomes: [
      { id: 'neutralised', label: 'Hostile drones neutralised', description: 'All targets engaged and downed. Wreckage location logged for perimeter response.' },
      { id: 'partial_neutralisation', label: 'Partial neutralisation', description: 'Some hostile drones downed. Others escaped sensor coverage before engagement.' },
      { id: 'target_evaded_before_arrival', label: 'Target evaded before arrival', description: 'Hostile drones exited coverage before interceptors could close. Interceptors patrolled the last known area then returned to base.' },
      { id: 'engagement_aborted', label: 'Engagement aborted', description: 'Mission called off before contact. Interceptors returned to base.' },
    ],
    variants: [
      { id: 'quad_mk1', label: 'Interceptor Quadcopter Mk I', enabled: true, note: 'Standard kinetic package' },
      { id: 'fixed_wing', label: 'Fixed-Wing Interceptor', enabled: false, note: 'Future capability' },
      { id: 'kinetic_net', label: 'Kinetic Net Deployer', enabled: false, note: 'Future capability' },
    ],
  },
  'army-ground': {
    displayName: 'Ground Reinforcement',
    includes: [
      'Livgarden or similar unit dispatched',
      'Perimeter cordon',
      'Ground search + civilian evacuation',
      'Handoff to Politi for arrest phase',
    ],
    deployedFor: 'Post-impact site security, downed drone recovery, ground threat where police alone is insufficient.',
    tradeoffs: 'Slow to mobilise (~30 min). No airborne or kinetic asset. Not appropriate for active airborne threats.',
    outcomes: [
      { id: 'cordon_established', label: 'Cordon established', description: 'Perimeter secured; unauthorised personnel excluded.' },
      { id: 'evidence_secured', label: 'Evidence secured', description: 'Debris, payload, or ground evidence recovered; chain of custody initiated.' },
      { id: 'politi_handoff', label: 'Handed off to Politi', description: 'Site under police control for arrest and investigation phase.' },
    ],
  },
};

// Convenience: outcomes for a given kind (empty array if unknown)
export function outcomesForKind(kind) {
  return RESPONSE_OPTION_DETAILS[kind]?.outcomes || [];
}

// Subject-aware response bundle. Returns tactical assets matched to
// the DetectionSubject, plus the same ground + consequence layers as
// the legacy bundle.
export function responseBundleForSubject(subject, lat, lon) {
  const { kinds: tacticalKinds, rationale } = tacticalKindsForSubject(subject);
  const tactical = tacticalKinds.length
    ? nearestResponseAssets(lat, lon, 3, tacticalKinds)
    : [];
  return {
    tactical,
    tacticalRationale: rationale,
    tacticalKinds,
    ground:       groundCoordinationAssets(lat, lon, 2),
    consequence:  civilConsequenceAssets(lat, lon, 2),
  };
}
