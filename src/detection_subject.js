// ═══════════════════════════════════════════════════════════════════
// DETECTION SUBJECT
// Rich structured description of what a sensor mesh has detected.
// This is the shape the neural network's fused output produces.
// Consumed by Agent 3 (Narrative) via mistral.js, and eventually by
// Agent 4 (Recommendation) for threat-scored routing.
//
// Designed for the long horizon: the taxonomy covers everything the
// platform must classify — drones, crewed aircraft, weapons,
// biologicals — with orthogonal sub-heads for cardinality, formation,
// behavior, and per-modality sensor evidence. Each field maps to a
// distinct NN output head or a deterministic derivation from those
// heads.
//
// Today: subjectFromEvent() derives as rich a subject as possible
// from the current mock event shape, filling unknowns with sensible
// defaults + low confidence.
// Post-NN: subjectFromNnOutput() replaces this, consuming the real
// per-tick NN detection batch.
// ═══════════════════════════════════════════════════════════════════

// ── Taxonomy vocabularies ─────────────────────────────────────────

export const CATEGORY = Object.freeze({
  AERIAL_PLATFORM: 'aerial_platform',
  BIOLOGICAL: 'biological',
  WEAPON: 'weapon',
  UNKNOWN: 'unknown',
});

// Class vocabulary per category. Add new entries as the NN's class
// head expands. Never remove entries — retire by setting `deprecated`.
export const CLASS_VOCAB = Object.freeze({
  aerial_platform: [
    'micro_drone',                // <250g, hand-launched
    'quadcopter',                 // consumer / prosumer rotary
    'hexcopter_octocopter',       // higher-payload rotary
    'fixed_wing_drone',           // long-endurance UAV
    'vtol_hybrid',                // tiltrotor / hybrid UAV
    'helicopter_civilian',
    'helicopter_military',
    'fixed_wing_civilian',        // GA aircraft
    'fixed_wing_commercial',      // airliners
    'fixed_wing_military',        // jets, transports
    'glider',                     // unpowered, slow, engine-off, low RCS
    'paraglider_hang_glider',     // recreational, unauthorized incursions at airports
    'balloon_airship',
  ],
  biological: [
    'single_bird',
    'small_bird_flock',
    'large_bird_flock',
    'bat_cluster',
    'insect_swarm',
  ],
  weapon: [
    'cruise_missile',
    'ballistic_missile',
    'hypersonic_weapon',          // >Mach 5, distinct kinematic envelope
    'loitering_munition',         // Shahed-class, Lancet-class
    'dropped_ordnance',
    'artillery_shell',
    'rocket_barrage',
  ],
  unknown: [
    'unclassified_track',
  ],
});

export const CARDINALITY_KIND = Object.freeze({
  SINGLE: 'single',       // exactly 1
  PAIR: 'pair',           // 2
  MULTIPLE: 'multiple',   // 3-9, no coordinated behavior
  SWARM: 'swarm',         // 10+ OR coordinated formation flight
});

export const FORMATION_KIND = Object.freeze({
  NONE: 'none',                             // single subject
  COORDINATED: 'coordinated',               // tight formation, common heading, spacing pattern
  FOLLOW_THE_LEADER: 'follow_the_leader',   // in-line, staggered arrivals
  DISTRIBUTED_SEARCH: 'distributed_search', // dispersed grid coverage
  DECOY_AND_STRIKE: 'decoy_and_strike',     // asymmetric roles (loiter + descend)
  UNCOORDINATED_CLUSTER: 'uncoordinated_cluster', // birds, opportunistic multiples
  UNKNOWN: 'unknown',
});

export const BEHAVIOR_STATE = Object.freeze({
  TRANSIT: 'transit',
  LOITER: 'loiter',
  APPROACH: 'approach',
  EGRESS: 'egress',
  DESCENT_ATTACK_PROFILE: 'descent_attack_profile',
  UNKNOWN: 'unknown',
});

// ── Platform → taxonomy mapping (for deriving from mock event) ────

// Maps the current event.platform string (short vocab used by the
// mock scenarios) to (category, class, subclass). The NN's real
// output head will replace this lookup entirely.
const PLATFORM_TAXONOMY = {
  'quadcopter':         { category: 'aerial_platform', klass: 'quadcopter',            subclass: null },
  'fixed-wing':         { category: 'aerial_platform', klass: 'fixed_wing_drone',      subclass: null },
  'fixed_wing':         { category: 'aerial_platform', klass: 'fixed_wing_drone',      subclass: null },
  'jet':                { category: 'aerial_platform', klass: 'fixed_wing_military',   subclass: null },
  'helicopter':         { category: 'aerial_platform', klass: 'helicopter_civilian',   subclass: null },
  'commercial':         { category: 'aerial_platform', klass: 'fixed_wing_commercial', subclass: null },
  'missile':            { category: 'weapon',          klass: 'cruise_missile',        subclass: null },
  'loitering-munition': { category: 'weapon',          klass: 'loitering_munition',    subclass: null },
  'bird':               { category: 'biological',      klass: 'small_bird_flock',      subclass: null },
  'non-identifiable':   { category: 'unknown',         klass: 'unclassified_track',    subclass: null },
};

// Class-level payload capability lookup. Real NN training would learn
// this from labeled incidents; today it's a deterministic table.
const PAYLOAD_CAPABLE_CLASSES = new Set([
  'quadcopter', 'hexcopter_octocopter', 'fixed_wing_drone', 'vtol_hybrid',
  'helicopter_civilian', 'helicopter_military',
  'fixed_wing_civilian', 'fixed_wing_commercial', 'fixed_wing_military',
  'cruise_missile', 'ballistic_missile', 'hypersonic_weapon', 'loitering_munition',
  'dropped_ordnance', 'artillery_shell', 'rocket_barrage',
]);

const KNOWN_MILITARY_CLASSES = new Set([
  'helicopter_military', 'fixed_wing_military',
  'cruise_missile', 'ballistic_missile', 'hypersonic_weapon', 'loitering_munition',
  'artillery_shell', 'rocket_barrage',
]);

const WEAPON_CLASSES = new Set([
  'cruise_missile', 'ballistic_missile', 'hypersonic_weapon', 'loitering_munition',
  'dropped_ordnance', 'artillery_shell', 'rocket_barrage',
]);

// ── Derivation from current mock event ────────────────────────────

// Best-effort derivation of a DetectionSubject from today's event
// shape. Fills unknowns with sensible defaults + LOW confidence so
// the narrative agent knows what it can and cannot trust. When the
// real NN lands, subjectFromNnOutput() replaces this entirely.
export function subjectFromEvent(event, opts = {}) {
  const { activeDroneCount = null, formationSamples = null } = opts;
  const platform = event.platform || 'non-identifiable';
  const tax = PLATFORM_TAXONOMY[platform] || PLATFORM_TAXONOMY['non-identifiable'];
  const conf = event.confidence ?? 0.5;

  // Cardinality — derive from active drone count if provided, else
  // fall back to droneCount field, else assume single.
  const count = activeDroneCount ?? event.droneCount ?? 1;
  const cardinality = deriveCardinality(count, tax.category);

  // Formation — only meaningful if count > 1. For biologicals, always
  // uncoordinated. For weapons, always none (single-target class).
  const formation = deriveFormation(cardinality, tax.category, formationSamples);

  // Behavior — inferred from projected path / dwell if available,
  // else UNKNOWN. Weapons default to descent_attack_profile.
  const behavior = deriveBehavior(event, tax.category);

  // Kinematics — pulled from event live-telemetry snapshot if present.
  const kinematics = {
    speed_ms: event.speed_ms ?? null,
    altitude_m_agl: event.altitude_agl_m ?? event.altitude_m ?? null,
    heading_deg: event.heading_deg ?? null,
    climb_rate_ms: event.climb_rate_ms ?? null,
    turn_rate_deg_s: event.turn_rate_deg_s ?? null,
    estimated_endurance_min: estimateEndurance(tax.klass),
  };

  const threat_profile = {
    payload_capable: PAYLOAD_CAPABLE_CLASSES.has(tax.klass),
    weaponized_signature: WEAPON_CLASSES.has(tax.klass),
    known_military_platform: KNOWN_MILITARY_CLASSES.has(tax.klass),
    civilian_flight_plan_match: !!event.flightPlanMatch,
    inert_biological: tax.category === 'biological',
  };

  // Sensor evidence — mock derives from top sensors + any explicit
  // RF/acoustic fields on the event. Real NN emits per-modality
  // confidences directly.
  const sensor_evidence = deriveSensorEvidence(event, tax);

  const nn_meta = {
    model_version: event.nn_model_version || 'mock-v1',
    inference_ts: event.lastUpdated || event.startTime || new Date().toISOString(),
    fusion_ts: event.lastUpdated || event.startTime || new Date().toISOString(),
    fused_from_sensor_nodes: event.sensorsTop || [],
  };

  return {
    category: tax.category,
    class: tax.klass,
    subclass: event.droneType || tax.subclass || null,
    class_confidence: conf,
    cardinality,
    formation,
    behavior,
    kinematics,
    threat_profile,
    sensor_evidence,
    nn_meta,
  };
}

// ── Derivation helpers ────────────────────────────────────────────

function deriveCardinality(count, category) {
  let kind;
  if (count <= 1) kind = CARDINALITY_KIND.SINGLE;
  else if (count === 2) kind = CARDINALITY_KIND.PAIR;
  else if (count >= 10) kind = CARDINALITY_KIND.SWARM;
  else kind = CARDINALITY_KIND.MULTIPLE;
  // Biological groupings above ~10 count as swarm regardless of
  // formation, since a flock is functionally a swarm to detection.
  return {
    kind,
    count_estimate: count,
    count_confidence: category === 'biological' ? 0.55 : 0.85,
  };
}

function deriveFormation(cardinality, category, formationSamples) {
  if (cardinality.kind === CARDINALITY_KIND.SINGLE) {
    return { kind: FORMATION_KIND.NONE, formation_confidence: 1.0, spacing: null };
  }
  if (category === 'biological') {
    return {
      kind: FORMATION_KIND.UNCOORDINATED_CLUSTER,
      formation_confidence: 0.70,
      spacing: 'loose',
    };
  }
  if (category === 'weapon') {
    // Multi-weapon (e.g. missile salvo) reads as coordinated by
    // origin, but is behaviorally single-target-per-warhead. Flag
    // as coordinated with low confidence, real NN refines.
    return {
      kind: FORMATION_KIND.COORDINATED,
      formation_confidence: 0.60,
      spacing: 'wide',
    };
  }
  // Aerial platforms — if we had formation-analyzer output use it,
  // else default to unknown so the narrative agent doesn't assume.
  if (formationSamples?.kind) {
    return {
      kind: formationSamples.kind,
      formation_confidence: formationSamples.confidence ?? 0.65,
      spacing: formationSamples.spacing ?? null,
    };
  }
  return {
    kind: cardinality.kind === CARDINALITY_KIND.SWARM ? FORMATION_KIND.COORDINATED : FORMATION_KIND.UNKNOWN,
    formation_confidence: 0.50,
    spacing: cardinality.kind === CARDINALITY_KIND.SWARM ? 'tight' : null,
  };
}

function deriveBehavior(event, category) {
  const dwell_zones = event.dwellZones?.map(d => d.name) || [];
  // Weapon → descent_attack_profile with high confidence
  if (category === 'weapon') {
    return {
      state: BEHAVIOR_STATE.DESCENT_ATTACK_PROFILE,
      state_confidence: 0.90,
      dwell_zones,
    };
  }
  // Projected path with impacts → approach
  if (event.projectedPath?.impacts?.length > 0) {
    return {
      state: BEHAVIOR_STATE.APPROACH,
      state_confidence: 0.75,
      dwell_zones,
    };
  }
  // Dwell zones present → loiter
  if (dwell_zones.length > 0) {
    return {
      state: BEHAVIOR_STATE.LOITER,
      state_confidence: 0.70,
      dwell_zones,
    };
  }
  // Default transit
  return {
    state: BEHAVIOR_STATE.TRANSIT,
    state_confidence: 0.55,
    dwell_zones,
  };
}

function estimateEndurance(klass) {
  // Rough endurance estimates in minutes. Real NN + telemetry-based
  // battery/fuel state model will replace this.
  const table = {
    micro_drone: 10,
    quadcopter: 30,
    hexcopter_octocopter: 40,
    fixed_wing_drone: 240,
    vtol_hybrid: 90,
    helicopter_civilian: 120,
    helicopter_military: 180,
    fixed_wing_civilian: 300,
    fixed_wing_commercial: 720,
    fixed_wing_military: 240,
    glider: 480,                    // unpowered but ridge/thermal-sustained
    paraglider_hang_glider: 180,
    balloon_airship: null,
    cruise_missile: 90,
    ballistic_missile: null,
    hypersonic_weapon: 30,
    loitering_munition: 300,
    dropped_ordnance: null,
    artillery_shell: null,
    rocket_barrage: null,
    single_bird: null,
    small_bird_flock: null,
    large_bird_flock: null,
    bat_cluster: null,
    insect_swarm: null,
    unclassified_track: null,
  };
  return table[klass] ?? null;
}

function deriveSensorEvidence(event, tax) {
  const sensorsN = event.sensorsTop?.length || 0;
  const conf = event.confidence ?? 0.5;
  // Split sensor count across modalities if we don't have per-modality
  // breakdown. In practice each sensor covers 1-4 modalities.
  const rfN = tax.category === 'biological' ? 0 : Math.min(sensorsN, 3);
  const acousticN = Math.min(sensorsN, 2);
  const visualN = Math.max(0, sensorsN - 1);
  const radarN = tax.category === 'weapon' || tax.category === 'aerial_platform' ? Math.min(sensorsN, 2) : 0;

  return {
    rf: {
      signature_match: event.rf_signature_match ?? (tax.category === 'biological' ? null : deriveRfSignatureLabel(tax.klass, conf)),
      confidence: tax.category === 'biological' ? 0.0 : conf,
      sensors_agreeing: rfN,
    },
    acoustic: {
      signature_match: deriveAcousticSignatureLabel(tax.klass, conf),
      confidence: Math.max(0.4, conf - 0.10),
      sensors_agreeing: acousticN,
    },
    visual: {
      confirmed: visualN > 0,
      confidence: visualN > 0 ? Math.max(0.5, conf - 0.05) : 0.0,
      sensors_agreeing: visualN,
    },
    radar: {
      return_class: radarN > 0 ? deriveRadarClass(tax.klass) : null,
      rcs_dbsm: null,
      sensors_agreeing: radarN,
    },
    ads_b: event.adsb ? {
      icao24: event.adsb.icao24 ?? null,
      callsign: event.adsb.callsign ?? null,
      flight_plan_match: !!event.adsb.flight_plan_match,
    } : null,
  };
}

function deriveRfSignatureLabel(klass, conf) {
  const pct = Math.round(conf * 100);
  const knownRf = {
    quadcopter: `OcuSync/Lightbridge family ${pct}%`,
    hexcopter_octocopter: `OcuSync family ${pct}%`,
    fixed_wing_drone: `custom telemetry ${pct}%`,
    loitering_munition: `low-emission (LO) signature`,
    cruise_missile: `no active emitter (LO)`,
    hypersonic_weapon: `plasma-attenuated emissions (LO)`,
    glider: null,
    paraglider_hang_glider: null,
    helicopter_civilian: null,
    fixed_wing_commercial: null,
  };
  return knownRf[klass] ?? null;
}

function deriveAcousticSignatureLabel(klass, conf) {
  const pct = Math.round(conf * 100);
  const knownAc = {
    quadcopter: `BLDC 4-motor rotor ${pct}%`,
    hexcopter_octocopter: `BLDC multi-motor rotor ${pct}%`,
    fixed_wing_drone: `IC/electric propeller ${pct}%`,
    helicopter_civilian: `piston rotor signature ${pct}%`,
    helicopter_military: `turbine rotor signature ${pct}%`,
    fixed_wing_commercial: `turbofan signature ${pct}%`,
    fixed_wing_military: `turbojet signature ${pct}%`,
    cruise_missile: `turbojet signature ${pct}%`,
    hypersonic_weapon: `sonic-boom + plasma sheath ${pct}%`,
    loitering_munition: `IC engine signature ${pct}%`,
    glider: `wind-noise only, no propulsion signature`,
    paraglider_hang_glider: `wind-noise only, no propulsion signature`,
    small_bird_flock: `avian calls`,
    large_bird_flock: `avian calls`,
  };
  return knownAc[klass] ?? null;
}

function deriveRadarClass(klass) {
  const table = {
    micro_drone: 'micro-RCS return',
    quadcopter: 'small-RCS multirotor return',
    hexcopter_octocopter: 'small-RCS multirotor return',
    fixed_wing_drone: 'small-RCS fixed-wing return',
    helicopter_civilian: 'rotorcraft doppler',
    helicopter_military: 'rotorcraft doppler',
    fixed_wing_civilian: 'small fixed-wing return',
    fixed_wing_commercial: 'large airliner return',
    fixed_wing_military: 'high-speed jet return',
    glider: 'slow low-RCS return, no doppler on prop',
    paraglider_hang_glider: 'very low speed, very low RCS',
    cruise_missile: 'high-speed low-alt track',
    ballistic_missile: 'high-speed ballistic track',
    hypersonic_weapon: 'hypersonic track (>Mach 5), plasma-attenuated return',
    loitering_munition: 'small-RCS slow-mover',
    single_bird: null,
    small_bird_flock: null,
    large_bird_flock: null,
  };
  return table[klass] ?? null;
}

// ── Digest formatter for prompts ──────────────────────────────────

// Compact, human-readable block for Mistral. Structured so the LLM
// can lean on labeled fields rather than parsing free text. Skips
// null/zero fields to keep the prompt tight and avoid the model
// confabulating around empty values.
// Count noun by category. Prevents "1 airframe" for a bird.
function countNoun(category, count) {
  if (category === 'biological') return count === 1 ? 'target' : 'targets';
  if (category === 'unknown') return count === 1 ? 'target' : 'targets';
  // aerial_platform + weapon
  return count === 1 ? 'airframe' : 'airframes';
}

export function renderSubjectDigest(subject) {
  const lines = [];
  const push = (l) => lines.push(l);
  const pct = (n) => (n == null ? '?' : Math.round(n * 100) + '%');

  push('DETECTION SUBJECT');
  push('─────────────────');
  push(`Category: ${subject.category}`);
  push(`Class: ${subject.class} (${pct(subject.class_confidence)} confidence)`);
  if (subject.subclass) push(`Subclass: ${subject.subclass}`);

  const c = subject.cardinality;
  push(`Cardinality: ${c.kind} (${c.count_estimate} ${countNoun(subject.category, c.count_estimate)}, ${pct(c.count_confidence)} confidence)`);

  if (subject.formation && subject.formation.kind !== FORMATION_KIND.NONE) {
    const f = subject.formation;
    push(`Formation: ${f.kind}${f.spacing ? ` (${f.spacing} spacing)` : ''} (${pct(f.formation_confidence)} confidence)`);
  }

  const b = subject.behavior;
  push(`Behavior: ${b.state} (${pct(b.state_confidence)} confidence)${b.dwell_zones.length ? `, dwelling over ${b.dwell_zones.join(', ')}` : ''}`);

  const k = subject.kinematics;
  const kparts = [];
  if (k.speed_ms != null) kparts.push(`${Math.round(k.speed_ms)} m/s`);
  if (k.altitude_m_agl != null) kparts.push(`${Math.round(k.altitude_m_agl)}m AGL`);
  if (k.heading_deg != null) kparts.push(`heading ${Math.round(k.heading_deg)}°`);
  if (k.climb_rate_ms != null && Math.abs(k.climb_rate_ms) > 0.5) kparts.push(`${k.climb_rate_ms > 0 ? '+' : ''}${k.climb_rate_ms.toFixed(1)} m/s climb`);
  if (k.estimated_endurance_min) kparts.push(`~${k.estimated_endurance_min} min endurance envelope`);
  if (kparts.length) push(`Kinematics: ${kparts.join(', ')}`);

  const t = subject.threat_profile;
  const tflags = [];
  if (t.payload_capable) tflags.push('payload_capable');
  if (t.weaponized_signature) tflags.push('weaponized_signature');
  if (t.known_military_platform) tflags.push('known_military_platform');
  if (t.civilian_flight_plan_match) tflags.push('civilian_flight_plan_match');
  if (t.inert_biological) tflags.push('inert_biological');
  if (tflags.length) push(`Threat flags: ${tflags.join(', ')}`);

  const s = subject.sensor_evidence;
  push('Sensor evidence:');
  if (s.rf?.sensors_agreeing > 0) push(`  RF: ${s.rf.signature_match || 'match TBD'} (${pct(s.rf.confidence)}, ${s.rf.sensors_agreeing} sensor${s.rf.sensors_agreeing === 1 ? '' : 's'})`);
  else if (s.rf?.signature_match === null && subject.category === 'biological') push('  RF: no signal (biological)');
  if (s.acoustic?.sensors_agreeing > 0 && s.acoustic?.signature_match) push(`  Acoustic: ${s.acoustic.signature_match} (${pct(s.acoustic.confidence)}, ${s.acoustic.sensors_agreeing} sensor${s.acoustic.sensors_agreeing === 1 ? '' : 's'})`);
  if (s.visual?.confirmed) push(`  Visual: confirmed (${pct(s.visual.confidence)}, ${s.visual.sensors_agreeing} sensor${s.visual.sensors_agreeing === 1 ? '' : 's'})`);
  if (s.radar?.return_class) push(`  Radar: ${s.radar.return_class} (${s.radar.sensors_agreeing} sensor${s.radar.sensors_agreeing === 1 ? '' : 's'})`);
  if (s.ads_b) push(`  ADS-B: ${s.ads_b.icao24 || 'no ID'}${s.ads_b.callsign ? ` (${s.ads_b.callsign})` : ''}, flight plan match: ${s.ads_b.flight_plan_match}`);
  else if (subject.category === 'aerial_platform' || subject.category === 'weapon') push('  ADS-B: no transponder');

  push(`NN model: ${subject.nn_meta.model_version}`);

  return lines.join('\n');
}
