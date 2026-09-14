// ═══════════════════════════════════════════════════════════════════
// Drone family reference library
// ───────────────────────────────────────────────────────────────────
// Metadata table keyed by the family label the neural network emits
// in its classification output. This is a REFERENCE LIBRARY, not a
// classifier — classification is the NN's job. C2 reads the family
// label the NN produced, then looks up:
//   - response profile (threat level, escalation posture, response time)
//   - recommended observer roles (auto-cascade suggestions per family)
//   - precedent context stubs (fields the retrieval layer fills in
//     with actual historical numbers)
//   - attribution elaboration (extra language the narrative layer uses
//     when discussing this family, beyond what the NN alone provided)
//
// Update this file when a partner (Sydøstjyllands Politi, Trafikstyrelsen,
// PET) revises the response posture for a family. No code deploy required
// for pure data edits — the metadata table is intentionally decoupled
// from the adapter logic in signature_bridge.js.
//
// See docs/integration-contracts.md §9 for the wire contract and
// docs/agentic-signature-bridge-architecture.md for the design rationale.
// ═══════════════════════════════════════════════════════════════════

// Canonical family labels the NN is allowed to emit. Every family
// used anywhere in the C2 must appear here. If the NN emits a label
// not in this set, signature_bridge treats the detection as UNKNOWN
// (operator manual reclassify) rather than fabricating metadata.
export const FAMILIES = Object.freeze({
  SHAHED:              'shahed-loitering-munition',
  CRUISE_MISSILE:      'cruise-missile',
  STRATEGIC_UAV:       'strategic-uav',
  LOITERING_MUNITION:  'loitering-munition',     // generic / non-Shahed
  DJI_QUADCOPTER:      'dji-quadcopter',         // commercial identifiable
  FPV_QUADCOPTER:      'fpv-quadcopter',         // hobby/military FPV
  SMALL_QUADCOPTER:    'small-quadcopter',       // sub-DJI, unspecified
  DRONE_SWARM:         'drone-swarm',            // multi-airframe
  HELICOPTER:          'helicopter',
  FIXED_WING:          'fixed-wing',
  BALLOON_TETHERED:    'balloon-tethered',
  UNKNOWN:             'unknown',                 // NN classified low-conf or the label is off-list
});

// Threat level buckets — coarse, matches the C2 event.threat field.
// Downstream (dispatch, cascade picker, escalation SLA) reads this
// directly. Never invent a level not in this set.
export const THREAT_LEVELS = Object.freeze({
  LOW:      'low',
  MEDIUM:   'medium',
  HIGH:     'high',
  CRITICAL: 'critical',
});

// The library. Every FAMILIES value must have an entry. Missing entry
// = adapter returns null response_profile (operator handles manually).
export const FAMILY_LIBRARY = {

  [FAMILIES.SHAHED]: {
    display_name: 'Shahed-class loitering munition',
    threat_level: THREAT_LEVELS.CRITICAL,
    escalation_posture: 'immediate-national-tier',
    response_time_secs: 60,
    recommended_observers: ['pet', 'fe', 'forsvarskmd', 'flv-skrydstrup', 'flv-karup', 'rigspoliti', 'min-fors', 'min-just', 'nato-caoc-uedem'],
    dispatch_hint: 'F-35 QRA priority. Ground evacuation of impact-radius sites. No visual-verify assets — this class is confirmed hostile on family label alone.',
    attribution_elaboration: [
      'Iranian-manufactured Shahed-136 / Shahed-238 class. Widely fielded by state and non-state actors since 2022.',
      'Rotary-engine acoustic signature (70-90 Hz fundamental) is diagnostic; RF silent in cruise phase.',
    ],
    typical_kinematics: { cruise_speed_ms: 55, cruise_altitude_m: 1500, endurance_min: 300 },
  },

  [FAMILIES.CRUISE_MISSILE]: {
    display_name: 'Cruise missile',
    threat_level: THREAT_LEVELS.CRITICAL,
    escalation_posture: 'immediate-national-tier',
    response_time_secs: 30,
    recommended_observers: ['pet', 'fe', 'forsvarskmd', 'flv-skrydstrup', 'flv-karup', 'rigspoliti', 'min-fors', 'min-just', 'nato-caoc-uedem', 'agency-cfcs'],
    dispatch_hint: 'F-35 QRA immediate. Alert NATO NATINAMDS via CAOC Uedem. No civilian dispatch — kinetic response only.',
    attribution_elaboration: [
      'Jet-scream acoustic signature + high subsonic transit profile.',
      'Family covers Russian Kh-101 / Kh-55 / Kalibr class and Western analogues. Attribution requires signature-database match.',
    ],
    typical_kinematics: { cruise_speed_ms: 240, cruise_altitude_m: 100, endurance_min: 60 },
  },

  [FAMILIES.STRATEGIC_UAV]: {
    display_name: 'Strategic ISR UAV',
    threat_level: THREAT_LEVELS.HIGH,
    escalation_posture: 'national-tier-briefing',
    response_time_secs: 300,
    recommended_observers: ['pet', 'fe', 'forsvarskmd', 'agency-cfcs', 'nato-caoc-uedem'],
    dispatch_hint: 'Track only — kinetic intercept unlikely to be authorised for this class over Danish airspace. Log SATCOM signature for FE.',
    attribution_elaboration: [
      'High-altitude long-endurance ISR platform. Ku/Ka-band SATCOM RF signature is diagnostic.',
      'Family covers reconnaissance drones (RQ-4 Global Hawk class, foreign equivalents). Foreign-actor tasking requires FE handoff.',
    ],
    typical_kinematics: { cruise_speed_ms: 170, cruise_altitude_m: 18000, endurance_min: 1800 },
  },

  [FAMILIES.LOITERING_MUNITION]: {
    display_name: 'Loitering munition (generic)',
    threat_level: THREAT_LEVELS.CRITICAL,
    escalation_posture: 'immediate-national-tier',
    response_time_secs: 90,
    recommended_observers: ['pet', 'fe', 'forsvarskmd', 'flv-skrydstrup', 'flv-karup', 'rigspoliti', 'min-fors'],
    dispatch_hint: 'Treat as confirmed hostile. Air response priority. Ground evacuation of impact-radius sites. No visual-verify assets.',
    attribution_elaboration: [
      'Delta-wing autonomous airframe, silent RF profile common. Family covers non-Shahed loitering munitions.',
      'Attribution ambiguous on family label alone — signature-database match required for state-actor call.',
    ],
    typical_kinematics: { cruise_speed_ms: 50, cruise_altitude_m: 1200, endurance_min: 240 },
  },

  [FAMILIES.DJI_QUADCOPTER]: {
    display_name: 'DJI-class commercial quadcopter',
    threat_level: THREAT_LEVELS.MEDIUM,
    escalation_posture: 'site-tier-plus-district',
    response_time_secs: 180,
    recommended_observers: ['politi-district', 'pet', 'agency-traf'],
    dispatch_hint: 'Police patrol dispatch + counter-drone electronic-warfare envelope. RF triangulation on OcuSync feed to trace operator.',
    attribution_elaboration: [
      'OcuSync 2.4/5.8 GHz OFDM transmission is diagnostic for DJI Matrice / Mavic / Phantom families.',
      'Commercial platform — most incidents are unregistered hobby flights, but sensitive-site loiter warrants operator attribution via RF.',
    ],
    typical_kinematics: { cruise_speed_ms: 15, cruise_altitude_m: 120, endurance_min: 30 },
  },

  [FAMILIES.FPV_QUADCOPTER]: {
    display_name: 'FPV analog-video quadcopter',
    threat_level: THREAT_LEVELS.HIGH,
    escalation_posture: 'site-plus-district-priority',
    response_time_secs: 120,
    recommended_observers: ['politi-district', 'pet', 'forsvarskmd', 'agency-traf'],
    dispatch_hint: 'FPV-class implies human-piloted terminal attack profile. Assume hostile intent. Counter-drone jammer priority; RF geolocation on video downlink.',
    attribution_elaboration: [
      '5.8 GHz analog video downlink is diagnostic. FPV airframes typically carry payload capacity for weaponisation.',
      'Ukrainian-conflict TTP has proliferated FPV weaponisation techniques globally.',
    ],
    typical_kinematics: { cruise_speed_ms: 25, cruise_altitude_m: 80, endurance_min: 12 },
  },

  [FAMILIES.SMALL_QUADCOPTER]: {
    display_name: 'Small unspecified quadcopter',
    threat_level: THREAT_LEVELS.MEDIUM,
    escalation_posture: 'site-tier-plus-district',
    response_time_secs: 240,
    recommended_observers: ['politi-district', 'agency-traf'],
    dispatch_hint: 'Sub-DJI class, unspecified. Police patrol dispatch, EW envelope, operator search.',
    attribution_elaboration: [
      'High-whine acoustic + small visual silhouette. Family covers uncatalogued hobby drones.',
      'Attribution rarely productive at this class — focus on operator apprehension via RF triangulation.',
    ],
    typical_kinematics: { cruise_speed_ms: 12, cruise_altitude_m: 60, endurance_min: 20 },
  },

  [FAMILIES.DRONE_SWARM]: {
    display_name: 'Drone swarm (multi-airframe)',
    threat_level: THREAT_LEVELS.CRITICAL,
    escalation_posture: 'immediate-national-tier',
    response_time_secs: 60,
    recommended_observers: ['pet', 'fe', 'forsvarskmd', 'flv-skrydstrup', 'flv-karup', 'rigspoliti', 'min-fors'],
    dispatch_hint: 'Multi-airframe coordinated attack. Counter-drone swarm dispatch (AKS), F-35 area denial. Assume saturation attack.',
    attribution_elaboration: [
      'Multi-source acoustic chorus + coordinated formation is diagnostic.',
      'Swarm tactics indicate state-actor or well-resourced non-state operator. Attribution priority is high.',
    ],
    typical_kinematics: { cruise_speed_ms: 20, cruise_altitude_m: 200, endurance_min: 30 },
  },

  [FAMILIES.HELICOPTER]: {
    display_name: 'Helicopter (rotary manned)',
    threat_level: THREAT_LEVELS.LOW,
    escalation_posture: 'log-and-monitor',
    response_time_secs: 900,
    recommended_observers: ['agency-traf'],
    dispatch_hint: 'Cooperative-traffic cross-check first. Rotary manned aircraft rarely require kinetic response; deconflict with Naviair.',
    attribution_elaboration: [
      'Rotor-thump acoustic (10-20 Hz fundamental) is diagnostic. Cross-reference cooperative-traffic feed for registered flights.',
    ],
    typical_kinematics: { cruise_speed_ms: 65, cruise_altitude_m: 500, endurance_min: 180 },
  },

  [FAMILIES.FIXED_WING]: {
    display_name: 'Fixed-wing aircraft',
    threat_level: THREAT_LEVELS.LOW,
    escalation_posture: 'log-and-monitor',
    response_time_secs: 900,
    recommended_observers: ['agency-traf'],
    dispatch_hint: 'Cooperative-traffic cross-check first. Most detections here are registered flights; deconflict with Naviair before any response.',
    attribution_elaboration: [
      'Piston or turbine acoustic + fixed-wing visual silhouette. Registered flights match cooperative-traffic feed by callsign + altitude.',
    ],
    typical_kinematics: { cruise_speed_ms: 100, cruise_altitude_m: 2500, endurance_min: 240 },
  },

  [FAMILIES.BALLOON_TETHERED]: {
    display_name: 'Tethered / free balloon',
    threat_level: THREAT_LEVELS.LOW,
    escalation_posture: 'log-and-monitor',
    response_time_secs: 1800,
    recommended_observers: ['agency-traf'],
    dispatch_hint: 'Log for airspace-manager awareness. Untethered drift into controlled airspace escalates to Trafikstyrelsen.',
    attribution_elaboration: [
      'Balloon silhouette + zero self-propulsion signature. Family covers weather balloons, tethered aerostats, novelty releases.',
    ],
    typical_kinematics: { cruise_speed_ms: 5, cruise_altitude_m: 3000, endurance_min: 720 },
  },

  [FAMILIES.UNKNOWN]: {
    display_name: 'Unknown / unclassified',
    threat_level: THREAT_LEVELS.MEDIUM,   // precautionary default — see feedback_detection_only
    escalation_posture: 'site-tier-plus-operator-review',
    response_time_secs: 300,
    recommended_observers: ['politi-district'],
    dispatch_hint: 'NN classification was low-confidence or off-list. Operator manual reclassification required. Precautionary: treat as medium threat until human labels.',
    attribution_elaboration: [
      'No family label produced by the NN, or the label was outside the known set. Do not fabricate attribution.',
    ],
    typical_kinematics: null,
  },
};

// Lookup helper — returns the metadata entry for a family label, or
// the UNKNOWN entry if the label is off-list. Callers should not
// attempt to look up UNKNOWN metadata via string comparison — always
// go through this helper so future renames stay contained.
export function familyMetadata(familyLabel) {
  if (!familyLabel) return FAMILY_LIBRARY[FAMILIES.UNKNOWN];
  return FAMILY_LIBRARY[familyLabel] || FAMILY_LIBRARY[FAMILIES.UNKNOWN];
}

// Introspection helper — returns the full library keyed by family.
// Used by signature_bridge.js dev handle for coverage debugging and
// by future config UIs that need to enumerate known families.
export function familyLibraryCoverage() {
  return {
    families: Object.keys(FAMILY_LIBRARY),
    familyCount: Object.keys(FAMILY_LIBRARY).length,
    threatLevels: Object.values(THREAT_LEVELS),
  };
}
