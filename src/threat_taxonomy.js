// ═══════════════════════════════════════════════════════════════════
// Threat taxonomy — two-layer catalog for routing + attribution
// ───────────────────────────────────────────────────────────────────
// Layer A (FAMILIES): 16 canonical bins the routing matrix keys on.
// Coarse enough to be stable, rich enough to differentiate response
// tiers. Adding a new drone model doesn't change routing rules.
//
// Layer B (MODELS): comprehensive catalog of specific platforms with
// signature bindings (RF band, acoustic profile, cruise speed,
// payload, wingspan, origin). Consumed by:
//   - NN adapter for classification output
//   - Chapter renderers for readable model names
//   - Agent B for narrative context ("Shahed-136 signature match")
//   - Precedent retrieval for similar-past-event surfacing
//   - Signature attribution + RF evasion tracker (planned)
//
// Detection-only invariant preserved. This module is pure data +
// helpers. Nothing here dispatches, escalates, or writes.
//
// See docs/cross-agency-flows.md Section 8 "Threat taxonomy" for
// the design contract and docs/threat-routing-overview.md for the
// plain-language walkthrough.
// ═══════════════════════════════════════════════════════════════════

// ── Layer A · Threat families ──────────────────────────────────
// Every model binds to exactly one primary family. Routing matrix
// (src/threat_routing.js — NOT src/routing.js which is the OSRM
// driving-route utility) uses ONLY these, never model-level ids,
// so the routing matrix stays 14 data-driven rules keyed on
// (domain, family, classification, threat) rather than a per-model matrix.

export const FAMILIES = {
  COMMERCIAL_QUADCOPTER:        'commercial-quadcopter',
  FPV_QUADCOPTER:               'fpv-quadcopter',
  CONSUMER_FIXED_WING:          'consumer-fixed-wing',
  MILITARY_ISR_FIXED_WING:      'military-isr-fixed-wing',
  STRATEGIC_UAV:                'strategic-uav',
  LOITERING_MUNITION:           'loitering-munition',
  CRUISE_MISSILE:               'cruise-missile',
  HELICOPTER_CIVILIAN:          'helicopter-civilian',
  HELICOPTER_MILITARY:          'helicopter-military',
  JET_MILITARY:                 'jet-military',
  JET_CIVILIAN:                 'jet-civilian',
  LIGHT_AIRCRAFT:               'light-aircraft',
  GLIDER:                       'glider',
  TETHERED_PLATFORM:            'tethered-platform',
  DRONE_SWARM:                  'drone-swarm',
  UNKNOWN_SIGNATURE:            'unknown-signature',
};

// Human-facing family labels. Renamable in one place.
export const FAMILY_LABELS = {
  [FAMILIES.COMMERCIAL_QUADCOPTER]:   'Commercial quadcopter',
  [FAMILIES.FPV_QUADCOPTER]:          'FPV / racing / kamikaze quadcopter',
  [FAMILIES.CONSUMER_FIXED_WING]:     'Consumer fixed-wing',
  [FAMILIES.MILITARY_ISR_FIXED_WING]: 'Military ISR fixed-wing',
  [FAMILIES.STRATEGIC_UAV]:           'Strategic UAV',
  [FAMILIES.LOITERING_MUNITION]:      'Loitering munition',
  [FAMILIES.CRUISE_MISSILE]:          'Cruise missile',
  [FAMILIES.HELICOPTER_CIVILIAN]:     'Helicopter, civilian',
  [FAMILIES.HELICOPTER_MILITARY]:     'Helicopter, military',
  [FAMILIES.JET_MILITARY]:            'Jet, military',
  [FAMILIES.JET_CIVILIAN]:            'Jet, civilian',
  [FAMILIES.LIGHT_AIRCRAFT]:          'Light aircraft',
  [FAMILIES.GLIDER]:                  'Glider',
  [FAMILIES.TETHERED_PLATFORM]:       'Tethered platform',
  [FAMILIES.DRONE_SWARM]:             'Drone swarm',
  [FAMILIES.UNKNOWN_SIGNATURE]:       'Unknown signature',
};

// Family-level threat profile default. Individual models can override.
// Consumed by routing matrix when threat is not explicitly set on the
// event and no model-level override exists.
export const FAMILY_DEFAULT_THREAT = {
  [FAMILIES.COMMERCIAL_QUADCOPTER]:   'low',
  [FAMILIES.FPV_QUADCOPTER]:          'medium',
  [FAMILIES.CONSUMER_FIXED_WING]:     'low',
  [FAMILIES.MILITARY_ISR_FIXED_WING]: 'high',
  [FAMILIES.STRATEGIC_UAV]:           'critical',
  [FAMILIES.LOITERING_MUNITION]:      'critical',
  [FAMILIES.CRUISE_MISSILE]:          'critical',
  [FAMILIES.HELICOPTER_CIVILIAN]:     'low',
  [FAMILIES.HELICOPTER_MILITARY]:     'high',
  [FAMILIES.JET_MILITARY]:            'critical',
  [FAMILIES.JET_CIVILIAN]:            'low',
  [FAMILIES.LIGHT_AIRCRAFT]:          'low',
  [FAMILIES.GLIDER]:                  'low',
  [FAMILIES.TETHERED_PLATFORM]:       'low',
  [FAMILIES.DRONE_SWARM]:             'high',
  [FAMILIES.UNKNOWN_SIGNATURE]:       'medium',
};

// ── Signature enums (used across MODELS entries) ───────────────

// Radio-frequency band categorisation. `null` = autonomous / no
// active datalink (typical for loitering munitions and cruise
// missiles). Multiple bands = model uses more than one link.
export const RF_BANDS = {
  BAND_2_4_GHZ:  '2.4-GHz',      // Consumer Wi-Fi / drone control
  BAND_5_8_GHZ:  '5.8-GHz',      // FPV video / advanced consumer
  BAND_900_MHZ:  '900-MHz',      // Long-range telemetry
  BAND_433_MHZ:  '433-MHz',      // ISM band, older FPV
  BAND_UHF:      'UHF',          // 300MHz-3GHz military
  BAND_L:        'L-band',       // GPS / SATCOM low
  BAND_S:        'S-band',       // Military datalink
  BAND_C:        'C-band',       // Military SATCOM
  BAND_X:        'X-band',       // Radar / SATCOM
  BAND_KU:       'Ku-band',      // Military SATCOM long-range
  BAND_KA:       'Ka-band',      // High-throughput SATCOM
  BAND_HF:       'HF',           // Long-range voice / data
  BAND_VHF:      'VHF',          // Civil aviation voice
  SILENT:        'silent',       // Fully autonomous, no active link
};

// Acoustic profile categories. What the acoustic sensor detects.
export const ACOUSTIC = {
  SILENT_ELECTRIC:  'silent-electric',   // Battery quadcopter, very quiet
  HIGH_WHINE:       'high-whine',        // Small quadcopter motors
  BUZZ:             'buzz',              // FPV racing quadcopter
  MOPED_BUZZ:       'moped-buzz',        // Shahed rotary engine
  PROP_HUM:         'prop-hum',          // Small fixed-wing prop
  PISTON_DRONE:     'piston-drone',      // Larger piston aircraft
  TURBINE_ROAR:     'turbine-roar',      // Turboprop / turbofan
  JET_SCREAM:       'jet-scream',        // Fighter jet, high-bypass
  ROTOR_THUMP:      'rotor-thump',       // Helicopter main rotor
  TILT_ROTOR:       'tilt-rotor',        // V-22 unique signature
  SWARM_CHORUS:     'swarm-chorus',      // Multi-source acoustic
  UNKNOWN:          'unknown',
};

// Visual / silhouette categorisation for optical + IR sensors.
export const VISUAL = {
  QUADCOPTER_SMALL:       'quadcopter-small',
  QUADCOPTER_LARGE:       'quadcopter-large',
  FPV_FRAME:              'fpv-frame',
  DELTA_WING:             'delta-wing',
  SWEPT_WING:             'swept-wing',
  STRAIGHT_WING:          'straight-wing',
  BOOM_TAIL:              'boom-tail',
  V_TAIL:                 'v-tail',
  TANDEM_ROTOR:           'tandem-rotor',
  MAIN_TAIL_ROTOR:        'main-tail-rotor',
  COAXIAL_ROTOR:          'coaxial-rotor',
  TILT_ROTOR:             'tilt-rotor',
  FIXED_WING_GENERAL:     'fixed-wing-general',
  CRUISE_MISSILE:         'cruise-missile',
  BALLOON:                'balloon',
  GLIDER:                 'glider',
  UNKNOWN:                'unknown',
};

// Country of origin ISO codes for the models catalog.
export const ORIGIN = {
  CN: 'CN', US: 'US', IR: 'IR', RU: 'RU', TR: 'TR', IL: 'IL',
  FR: 'FR', DE: 'DE', UK: 'UK', SE: 'SE', DK: 'DK', NO: 'NO',
  FI: 'FI', IT: 'IT', ES: 'ES', PL: 'PL', UA: 'UA', JP: 'JP',
  KR: 'KR', IN: 'IN', BR: 'BR', ZA: 'ZA', AT: 'AT', CH: 'CH',
  SI: 'SI',
  UNKNOWN: 'XX',
};

// ── Layer B · Threat models catalog ────────────────────────────
// Comprehensive open-source enumeration. Each entry:
//   id           — kebab-case unique key
//   label        — human display string
//   family       — FAMILIES enum
//   origin       — ISO country code (or ORIGIN.UNKNOWN)
//   operators    — [ISO codes] known operators (optional)
//   cruiseMs     — approximate cruise speed m/s (null if variable)
//   rangeKm      — approximate operational range (null if variable)
//   payloadKg    — warhead / payload weight (null when N/A)
//   wingspanM    — wingspan or rotor diameter, meters (null if variable)
//   signatures   — { rf: RF_BANDS[], acoustic: ACOUSTIC, visual: VISUAL }
//   threatProfile — model-level override; falls back to family default
//   notes        — one-line context
// All numeric values are approximate — sourced from open OSINT (Wikipedia,
// public datasheets, military inventory reports). Not classified data.

export const MODELS = [
  // ═══════════════════════════════════════════════════════════════
  // COMMERCIAL QUADCOPTERS — most common civilian sighting.
  // Counts intentionally omitted; `taxonomyCoverage()` is authoritative.
  // ═══════════════════════════════════════════════════════════════
  { id: 'dji-mavic-3-pro',      label: 'DJI Mavic 3 Pro',         family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 21, rangeKm: 15, payloadKg: null, wingspanM: 0.35, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Prosumer aerial photography, triple-camera Hasselblad.' },
  { id: 'dji-mavic-3',          label: 'DJI Mavic 3',             family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 21, rangeKm: 15, payloadKg: null, wingspanM: 0.35, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Prosumer photography quadcopter, Hasselblad camera.' },
  { id: 'dji-mavic-3-classic',  label: 'DJI Mavic 3 Classic',     family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 21, rangeKm: 15, payloadKg: null, wingspanM: 0.35, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Simplified Mavic 3, single camera.' },
  { id: 'dji-mavic-2-pro',      label: 'DJI Mavic 2 Pro',         family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 20, rangeKm: 8,  payloadKg: null, wingspanM: 0.32, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Prev-gen consumer photography quadcopter.' },
  { id: 'dji-mavic-air-2s',     label: 'DJI Air 2S',              family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 19, rangeKm: 12, payloadKg: null, wingspanM: 0.30, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Mid-tier photography quadcopter.' },
  { id: 'dji-mini-3-pro',       label: 'DJI Mini 3 Pro',          family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 16, rangeKm: 12, payloadKg: null, wingspanM: 0.25, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Sub-250g, evades most drone regulations.' },
  { id: 'dji-mini-4-pro',       label: 'DJI Mini 4 Pro',          family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 16, rangeKm: 20, payloadKg: null, wingspanM: 0.25, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Sub-250g, omnidirectional obstacle sensing.' },
  { id: 'dji-phantom-4-pro-v2', label: 'DJI Phantom 4 Pro V2.0',  family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 20, rangeKm: 7,  payloadKg: null, wingspanM: 0.35, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Legacy prosumer, still in use for surveying.' },
  { id: 'dji-inspire-3',        label: 'DJI Inspire 3',           family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 26, rangeKm: 12, payloadKg: 1.5,  wingspanM: 0.60, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, notes: 'Professional cinema quadcopter, cinema-grade payload.' },
  { id: 'dji-matrice-300-rtk',  label: 'DJI Matrice 300 RTK',     family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 23, rangeKm: 15, payloadKg: 2.7,  wingspanM: 0.90, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, notes: 'Enterprise inspection quadcopter.' },
  { id: 'dji-matrice-350-rtk',  label: 'DJI Matrice 350 RTK',     family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 23, rangeKm: 20, payloadKg: 2.7,  wingspanM: 0.90, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, notes: 'Enterprise inspection + surveillance quadcopter.' },
  { id: 'dji-matrice-30t',      label: 'DJI Matrice 30T',         family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 23, rangeKm: 15, payloadKg: null, wingspanM: 0.66, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Foldable enterprise quadcopter with thermal.' },
  { id: 'dji-agras-t50',        label: 'DJI Agras T50',           family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 13, rangeKm: 2,  payloadKg: 50,   wingspanM: 2.20, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, notes: 'Agricultural spraying drone. Large payload capacity.' },
  { id: 'autel-evo-max-4t',     label: 'Autel EVO Max 4T',        family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 20, rangeKm: 20, payloadKg: null, wingspanM: 0.36, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ, RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Enterprise quad, direct DJI competitor.' },
  { id: 'autel-evo-ii-pro-v3',  label: 'Autel EVO II Pro V3',     family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 20, rangeKm: 15, payloadKg: null, wingspanM: 0.32, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Consumer photography, 6K camera.' },
  { id: 'autel-evo-lite-plus',  label: 'Autel EVO Lite+',         family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 18, rangeKm: 12, payloadKg: null, wingspanM: 0.29, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Consumer photography, 1-inch sensor.' },
  { id: 'autel-nano-plus',      label: 'Autel Nano+',             family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 15, rangeKm: 10, payloadKg: null, wingspanM: 0.20, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Sub-250g competitor to DJI Mini series.' },
  { id: 'skydio-x10',           label: 'Skydio X10',              family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.US, cruiseMs: 20, rangeKm: 12, payloadKg: null, wingspanM: 0.36, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ, RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Autonomous flight, enterprise + defence.' },
  { id: 'skydio-2-plus',        label: 'Skydio 2+',               family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.US, cruiseMs: 16, rangeKm: 6,  payloadKg: null, wingspanM: 0.27, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Autonomous tracking quadcopter.' },
  { id: 'parrot-anafi-ai',      label: 'Parrot Anafi Ai',         family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.FR, cruiseMs: 15, rangeKm: 30, payloadKg: null, wingspanM: 0.32, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: '4G-connected commercial drone.' },
  { id: 'parrot-anafi-usa',     label: 'Parrot Anafi USA',        family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.FR, cruiseMs: 15, rangeKm: 5,  payloadKg: null, wingspanM: 0.32, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'US-market defence-focused variant.' },
  { id: 'yuneec-h520e',         label: 'Yuneec H520E',            family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 12, rangeKm: 1.6,payloadKg: null, wingspanM: 0.54, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, notes: 'Enterprise hexacopter (6 rotors).' },
  { id: 'yuneec-typhoon-h-plus',label: 'Yuneec Typhoon H Plus',   family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 14, rangeKm: 1.6,payloadKg: null, wingspanM: 0.52, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, notes: 'Prosumer hexacopter.' },
  { id: 'hubsan-zino-pro-plus', label: 'Hubsan Zino Pro+',        family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 15, rangeKm: 8,  payloadKg: null, wingspanM: 0.26, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Budget consumer quadcopter.' },
  { id: 'jjrc-x9p',             label: 'JJRC X9P Heron',          family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 12, rangeKm: 1.5,payloadKg: null, wingspanM: 0.32, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Low-cost consumer quadcopter.' },
  { id: 'holystone-hs720',      label: 'Holy Stone HS720E',       family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 12, rangeKm: 1,  payloadKg: null, wingspanM: 0.27, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Entry-level GPS quadcopter.' },
  { id: 'dji-avata-2',          label: 'DJI Avata 2',             family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 27, rangeKm: 13, payloadKg: null, wingspanM: 0.19, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, notes: 'Cinewhoop-style, goggles required.' },
  { id: 'dji-fpv',              label: 'DJI FPV',                 family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.CN, cruiseMs: 39, rangeKm: 10, payloadKg: null, wingspanM: 0.26, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, notes: 'DJI ready-to-fly FPV quadcopter.' },
  { id: 'freefly-alta-x',       label: 'Freefly Alta X',          family: FAMILIES.COMMERCIAL_QUADCOPTER, origin: ORIGIN.US, cruiseMs: 15, rangeKm: 5,  payloadKg: 15,   wingspanM: 1.19, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, notes: 'Heavy-lift cinema + industrial quadcopter.' },

  // ═══════════════════════════════════════════════════════════════
  // FPV / RACING / KAMIKAZE QUADCOPTERS
  // ═══════════════════════════════════════════════════════════════
  { id: 'fpv-5inch-freestyle',  label: 'FPV 5-inch freestyle build',    family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.UNKNOWN, cruiseMs: 30, rangeKm: 3, payloadKg: 0.5, wingspanM: 0.22, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ, RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, notes: 'Generic hobbyist FPV racing frame. Highly modifiable.' },
  { id: 'fpv-7inch-longrange',  label: 'FPV 7-inch long-range build',   family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.UNKNOWN, cruiseMs: 25, rangeKm: 20, payloadKg: 1.5, wingspanM: 0.30, signatures: { rf: [RF_BANDS.BAND_900_MHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, notes: 'Long-range FPV, common payload delivery frame.' },
  { id: 'fpv-cinewhoop',        label: 'FPV cinewhoop',                 family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.UNKNOWN, cruiseMs: 15, rangeKm: 1, payloadKg: 0.3, wingspanM: 0.15, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, notes: 'Ducted-prop indoor FPV, quiet + agile.' },
  { id: 'fpv-10inch-heavy',     label: 'FPV 10-inch heavy-lift',        family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.UNKNOWN, cruiseMs: 20, rangeKm: 15, payloadKg: 3,   wingspanM: 0.40, signatures: { rf: [RF_BANDS.BAND_900_MHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, notes: 'Heavy-lift FPV, often payload-delivery configured.' },
  { id: 'ua-wild-hornet',       label: 'Ukrainian "Wild Hornet" FPV',   family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.UA, cruiseMs: 30, rangeKm: 20, payloadKg: 3, wingspanM: 0.30, signatures: { rf: [RF_BANDS.BAND_900_MHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, threatProfile: 'high', notes: 'Battlefield FPV munition, Ukrainian volunteer production.' },
  { id: 'ua-baba-yaga',         label: 'Ukrainian "Baba Yaga" bomber',  family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.UA, cruiseMs: 15, rangeKm: 10, payloadKg: 20, wingspanM: 1.50, signatures: { rf: [RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, threatProfile: 'high', notes: 'Heavy multirotor night bomber, up to 20kg payload.' },
  { id: 'ua-vampire',           label: 'Ukrainian "Vampire" heavy bomber', family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.UA, cruiseMs: 15, rangeKm: 15, payloadKg: 15, wingspanM: 1.30, signatures: { rf: [RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, threatProfile: 'high', notes: 'Multirotor bomber, thermal + night-optimised.' },
  { id: 'ua-perun-f',           label: 'Perun-F',                       family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.UA, cruiseMs: 25, rangeKm: 12, payloadKg: 2, wingspanM: 0.28, signatures: { rf: [RF_BANDS.BAND_900_MHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, threatProfile: 'high', notes: 'Ukrainian FPV munition, semi-autonomous terminal guidance.' },
  { id: 'ru-kub-fpv',           label: 'Russian ZALA Kub FPV',          family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.RU, cruiseMs: 30, rangeKm: 10, payloadKg: 3, wingspanM: 0.30, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, threatProfile: 'high', notes: 'Russian FPV kamikaze variant.' },
  { id: 'ru-molniya',           label: 'Russian Molniya FPV',           family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.RU, cruiseMs: 30, rangeKm: 30, payloadKg: 5, wingspanM: 0.40, signatures: { rf: [RF_BANDS.BAND_900_MHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.BUZZ, visual: VISUAL.FPV_FRAME }, threatProfile: 'high', notes: 'Russian long-range strike FPV.' },
  { id: 'kargu-2',              label: 'STM Kargu-2 (rotary)',          family: FAMILIES.FPV_QUADCOPTER, origin: ORIGIN.TR, cruiseMs: 20, rangeKm: 10, payloadKg: 1.4, wingspanM: 0.60, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.SILENT], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, threatProfile: 'high', notes: 'Turkish autonomous rotary loitering munition. Used in Libya reports.' },

  // ═══════════════════════════════════════════════════════════════
  // CONSUMER + INDUSTRIAL FIXED-WING
  // ═══════════════════════════════════════════════════════════════
  { id: 'sensefly-ebee-x',      label: 'SenseFly eBee X',              family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.CH, cruiseMs: 15, rangeKm: 90, payloadKg: null, wingspanM: 1.16, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'Professional mapping fixed-wing, hand-launched.' },
  { id: 'wingtra-one-gen-ii',   label: 'WingtraOne Gen II',            family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.CH, cruiseMs: 16, rangeKm: 60, payloadKg: 1.2, wingspanM: 1.25, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'VTOL fixed-wing mapper.' },
  { id: 'delair-ux11',          label: 'Delair UX11',                  family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.FR, cruiseMs: 15, rangeKm: 60, payloadKg: null, wingspanM: 1.10, signatures: { rf: [RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'Long-endurance mapping fixed-wing.' },
  { id: 'trinity-f90-plus',     label: 'Quantum-Systems Trinity F90+', family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.DE, cruiseMs: 17, rangeKm: 100,payloadKg: null, wingspanM: 2.39, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'VTOL survey drone.' },
  { id: 'atlas-pro',            label: 'AtlasPRO',                     family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.UNKNOWN, cruiseMs: 20, rangeKm: 50, payloadKg: 1.5, wingspanM: 1.00, signatures: { rf: [RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'Industrial mapping + surveillance UAV.' },
  { id: 'bramor-c4eye',         label: 'C-Astral Bramor C4EYE',        family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.SI, cruiseMs: 15, rangeKm: 50, payloadKg: null, wingspanM: 2.30, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'Slovenian ISR fixed-wing, catapult-launched.' },
  { id: 'rc-hobbyist-fw',       label: 'Generic RC hobbyist fixed-wing', family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.UNKNOWN, cruiseMs: 20, rangeKm: 5,  payloadKg: null, wingspanM: 1.50, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'Hobby fixed-wing RC aircraft, low signature.' },
  { id: 'flying-wing-hobby',    label: 'Flying-wing hobbyist build',   family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.UNKNOWN, cruiseMs: 25, rangeKm: 10, payloadKg: null, wingspanM: 1.40, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.DELTA_WING }, notes: 'Popular hobbyist delta configuration.' },
  { id: 'zohd-dart-xl',         label: 'ZOHD Dart XL Extreme',         family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.CN, cruiseMs: 22, rangeKm: 8,  payloadKg: null, wingspanM: 1.00, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'Popular FPV wing platform.' },
  { id: 'x-uav-mini-talon',     label: 'X-UAV Mini Talon',             family: FAMILIES.CONSUMER_FIXED_WING, origin: ORIGIN.CN, cruiseMs: 20, rangeKm: 15, payloadKg: 0.5, wingspanM: 1.30, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'FPV V-tail long-range platform.' },

  // ═══════════════════════════════════════════════════════════════
  // MILITARY ISR FIXED-WING
  // ═══════════════════════════════════════════════════════════════
  { id: 'ga-mq-1-predator',     label: 'General Atomics MQ-1 Predator', family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.US, cruiseMs: 40, rangeKm: 1250, payloadKg: 204, wingspanM: 14.8, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.BOOM_TAIL }, notes: 'Legacy ISR + strike UAV. Retired US inventory 2018.' },
  { id: 'ga-mq-9-reaper',       label: 'General Atomics MQ-9 Reaper',   family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.US, cruiseMs: 82, rangeKm: 1850, payloadKg: 1700,wingspanM: 20.1, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.BOOM_TAIL }, threatProfile: 'critical', notes: 'MALE armed ISR UAV, primary US strike drone.' },
  { id: 'ga-mq-1c-gray-eagle',  label: 'General Atomics MQ-1C Gray Eagle', family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.US, cruiseMs: 42, rangeKm: 400,  payloadKg: 220, wingspanM: 17.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.BOOM_TAIL }, notes: 'US Army armed ISR variant.' },
  { id: 'bayraktar-tb2',        label: 'Baykar Bayraktar TB2',          family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.TR, cruiseMs: 36, rangeKm: 150, payloadKg: 150, wingspanM: 12.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.BOOM_TAIL }, threatProfile: 'high', notes: 'Turkish armed MALE UAV. Widely operated.' },
  { id: 'bayraktar-akinci',     label: 'Baykar Bayraktar Akıncı',       family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.TR, cruiseMs: 55, rangeKm: 300, payloadKg: 1350,wingspanM: 20.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.BOOM_TAIL }, threatProfile: 'critical', notes: 'Turkish heavy strike UAV, air-to-air capable.' },
  { id: 'bayraktar-kizilelma',  label: 'Baykar Kızılelma',              family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.TR, cruiseMs: 232,rangeKm: 930, payloadKg: 1500,wingspanM: 10.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C, RF_BANDS.BAND_X], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, threatProfile: 'critical', notes: 'Turkish unmanned jet-powered combat air vehicle.' },
  { id: 'tai-anka',             label: 'TAI ANKA-S',                    family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.TR, cruiseMs: 42, rangeKm: 250, payloadKg: 200, wingspanM: 17.5, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.V_TAIL }, notes: 'Turkish Aerospace MALE UAV.' },
  { id: 'tai-aksungur',         label: 'TAI AKSUNGUR',                  family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.TR, cruiseMs: 47, rangeKm: 6500,payloadKg: 750, wingspanM: 24.2, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.V_TAIL }, threatProfile: 'high', notes: 'Turkish twin-engine HALE UAV.' },
  { id: 'iai-heron-tp',         label: 'IAI Heron TP (Eitan)',          family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.IL, cruiseMs: 65, rangeKm: 7400,payloadKg: 1000,wingspanM: 26.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.BOOM_TAIL }, threatProfile: 'critical', notes: 'Israeli HALE armed ISR UAV.' },
  { id: 'elbit-hermes-900',     label: 'Elbit Hermes 900',              family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.IL, cruiseMs: 41, rangeKm: 300, payloadKg: 300, wingspanM: 15.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.BOOM_TAIL }, threatProfile: 'high', notes: 'Israeli MALE ISR UAV, widely exported.' },
  { id: 'elbit-hermes-450',     label: 'Elbit Hermes 450',              family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.IL, cruiseMs: 33, rangeKm: 200, payloadKg: 150, wingspanM: 10.5, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.BOOM_TAIL }, notes: 'Israeli tactical ISR UAV.' },
  { id: 'ch-4',                 label: 'CASC CH-4',                     family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.CN, cruiseMs: 47, rangeKm: 3500,payloadKg: 345, wingspanM: 18.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.BOOM_TAIL }, threatProfile: 'high', notes: 'Chinese MALE strike UAV, widely exported.' },
  { id: 'ch-5',                 label: 'CASC CH-5',                     family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.CN, cruiseMs: 60, rangeKm: 6500,payloadKg: 1000,wingspanM: 21.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.BOOM_TAIL }, threatProfile: 'critical', notes: 'Chinese heavy MALE UAV.' },
  { id: 'wing-loong-ii',        label: 'AVIC Wing Loong II',            family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.CN, cruiseMs: 51, rangeKm: 4000,payloadKg: 480, wingspanM: 20.5, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.BOOM_TAIL }, threatProfile: 'high', notes: 'Chinese MALE strike UAV. Comparable to MQ-9.' },
  { id: 'tb-001',               label: 'CASIC TB-001',                  family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.CN, cruiseMs: 55, rangeKm: 6000,payloadKg: 1200,wingspanM: 20.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.BOOM_TAIL }, notes: 'Chinese twin-engine reconnaissance-strike UAV.' },
  { id: 'orlan-10',             label: 'STC Orlan-10',                  family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.RU, cruiseMs: 42, rangeKm: 150, payloadKg: 5,   wingspanM: 3.10, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, threatProfile: 'high', notes: 'Russian tactical ISR UAV, catapult-launched.' },
  { id: 'orion',                label: 'Kronshtadt Orion',              family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.RU, cruiseMs: 33, rangeKm: 250, payloadKg: 200, wingspanM: 16.3, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.V_TAIL }, threatProfile: 'high', notes: 'Russian MALE UAV.' },
  { id: 'ru-forpost',           label: 'Forpost (IAI Searcher licence)',family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.RU, cruiseMs: 40, rangeKm: 250, payloadKg: 68,  wingspanM: 8.55, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'Russian-built IAI Searcher-II licensed variant.' },
  { id: 'watchkeeper-wk450',    label: 'Thales Watchkeeper WK450',      family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.UK, cruiseMs: 42, rangeKm: 150, payloadKg: 150, wingspanM: 10.9, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.BOOM_TAIL }, notes: 'UK Army tactical ISR UAV.' },
  { id: 'sc-eagle',             label: 'Insitu ScanEagle',              family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.US, cruiseMs: 25, rangeKm: 100, payloadKg: 3.2, wingspanM: 3.11, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.FIXED_WING_GENERAL }, notes: 'Tube-launched tactical ISR, widely operated.' },
  { id: 'rq-7-shadow',          label: 'AAI RQ-7 Shadow',               family: FAMILIES.MILITARY_ISR_FIXED_WING, origin: ORIGIN.US, cruiseMs: 45, rangeKm: 125, payloadKg: 46,  wingspanM: 4.30, signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_C], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.V_TAIL }, notes: 'US Army tactical ISR, catapult-launched.' },

  // ═══════════════════════════════════════════════════════════════
  // STRATEGIC UAVs
  // ═══════════════════════════════════════════════════════════════
  { id: 'rq-4-global-hawk',     label: 'Northrop RQ-4 Global Hawk',     family: FAMILIES.STRATEGIC_UAV, origin: ORIGIN.US, cruiseMs: 175, rangeKm: 22800, payloadKg: 1360, wingspanM: 39.9, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_KA, RF_BANDS.BAND_X], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.STRAIGHT_WING }, threatProfile: 'critical', notes: 'HALE strategic ISR, 60000+ ft ceiling.' },
  { id: 'mq-4c-triton',         label: 'Northrop MQ-4C Triton',         family: FAMILIES.STRATEGIC_UAV, origin: ORIGIN.US, cruiseMs: 170, rangeKm: 15200, payloadKg: 1450, wingspanM: 39.9, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_KA], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.STRAIGHT_WING }, notes: 'Naval variant, maritime patrol.' },
  { id: 'rq-170-sentinel',      label: 'Lockheed RQ-170 Sentinel',      family: FAMILIES.STRATEGIC_UAV, origin: ORIGIN.US, cruiseMs: null, rangeKm: null, payloadKg: null, wingspanM: 20.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_X], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.DELTA_WING }, notes: 'Stealth flying-wing ISR. Classified specs.' },
  { id: 's-70-okhotnik',        label: 'Sukhoi S-70 Okhotnik-B',        family: FAMILIES.STRATEGIC_UAV, origin: ORIGIN.RU, cruiseMs: 275, rangeKm: 5000,  payloadKg: 6000, wingspanM: 20.0, signatures: { rf: [RF_BANDS.BAND_KU], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.DELTA_WING }, threatProfile: 'critical', notes: 'Russian stealth UCAV flying wing.' },
  { id: 'gj-11-sharp-sword',    label: 'Hongdu GJ-11 Sharp Sword',      family: FAMILIES.STRATEGIC_UAV, origin: ORIGIN.CN, cruiseMs: 275, rangeKm: 4000,  payloadKg: 2000, wingspanM: 14.0, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_X], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.DELTA_WING }, threatProfile: 'critical', notes: 'Chinese stealth UCAV flying wing.' },
  { id: 'wz-8',                 label: 'AVIC WZ-8',                     family: FAMILIES.STRATEGIC_UAV, origin: ORIGIN.CN, cruiseMs: 1030, rangeKm: 6000, payloadKg: null, wingspanM: 4.50, signatures: { rf: [RF_BANDS.BAND_KA, RF_BANDS.BAND_KU], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.DELTA_WING }, threatProfile: 'critical', notes: 'Chinese hypersonic supersonic ISR drone.' },

  // ═══════════════════════════════════════════════════════════════
  // LOITERING MUNITIONS — the Shahed / Lancet / Switchblade class
  // ═══════════════════════════════════════════════════════════════
  { id: 'shahed-136',           label: 'Shahed-136 / Geran-2',          family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.IR, operators: ['IR', 'RU'], cruiseMs: 50, rangeKm: 2500, payloadKg: 50,  wingspanM: 2.50, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_L], acoustic: ACOUSTIC.MOPED_BUZZ, visual: VISUAL.DELTA_WING }, threatProfile: 'critical', notes: 'Iranian one-way attack UAV, autonomous. Distinctive rotary engine.' },
  { id: 'shahed-131',           label: 'Shahed-131 / Geran-1',          family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.IR, operators: ['IR', 'RU'], cruiseMs: 50, rangeKm: 900,  payloadKg: 15,  wingspanM: 2.20, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_L], acoustic: ACOUSTIC.MOPED_BUZZ, visual: VISUAL.DELTA_WING }, threatProfile: 'critical', notes: 'Smaller Shahed variant, shorter range.' },
  { id: 'shahed-101',           label: 'Shahed-101',                    family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.IR, cruiseMs: 47, rangeKm: 700,  payloadKg: 8,   wingspanM: 2.20, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_L], acoustic: ACOUSTIC.MOPED_BUZZ, visual: VISUAL.DELTA_WING }, threatProfile: 'high', notes: 'Small Iranian loitering munition.' },
  { id: 'arash-2',              label: 'Iran Arash-2',                  family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.IR, cruiseMs: 55, rangeKm: 2000, payloadKg: 260, wingspanM: 3.00, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_L], acoustic: ACOUSTIC.MOPED_BUZZ, visual: VISUAL.DELTA_WING }, threatProfile: 'critical', notes: 'Larger Iranian one-way strike UAV.' },
  { id: 'lancet-3',             label: 'ZALA Lancet-3',                 family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.RU, cruiseMs: 30, rangeKm: 70,   payloadKg: 3,   wingspanM: 1.65, signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.DELTA_WING }, threatProfile: 'high', notes: 'Russian tactical loitering munition, X-configuration wings.' },
  { id: 'lancet-1',             label: 'ZALA Lancet-1',                 family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.RU, cruiseMs: 30, rangeKm: 40,   payloadKg: 1,   wingspanM: 1.20, signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.DELTA_WING }, threatProfile: 'high', notes: 'Smaller Lancet variant.' },
  { id: 'kub-bla',              label: 'ZALA Kub-BLA',                  family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.RU, cruiseMs: 36, rangeKm: 40,   payloadKg: 3,   wingspanM: 1.20, signatures: { rf: [RF_BANDS.BAND_L], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.DELTA_WING }, threatProfile: 'high', notes: 'Russian delta-wing loitering munition.' },
  { id: 'switchblade-300',      label: 'AeroVironment Switchblade 300', family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.US, cruiseMs: 28, rangeKm: 10,   payloadKg: 1,   wingspanM: 0.70, signatures: { rf: [RF_BANDS.BAND_L, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.DELTA_WING }, threatProfile: 'high', notes: 'Tube-launched tactical loitering munition.' },
  { id: 'switchblade-600',      label: 'AeroVironment Switchblade 600', family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.US, cruiseMs: 51, rangeKm: 40,   payloadKg: 15,  wingspanM: 1.20, signatures: { rf: [RF_BANDS.BAND_L, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.DELTA_WING }, threatProfile: 'high', notes: 'Anti-armor Switchblade variant.' },
  { id: 'coyote-block-3',       label: 'Raytheon Coyote Block 3',       family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.US, cruiseMs: 43, rangeKm: 80,   payloadKg: null,wingspanM: 1.47, signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.STRAIGHT_WING }, notes: 'US swarming counter-UAS + strike variant.' },
  { id: 'harop',                label: 'IAI Harop',                     family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.IL, cruiseMs: 55, rangeKm: 1000, payloadKg: 23,  wingspanM: 3.00, signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.DELTA_WING }, threatProfile: 'critical', notes: 'Israeli anti-radar loitering munition. 6+ hour endurance.' },
  { id: 'harpy-2',              label: 'IAI Harpy 2 (Harop precursor)', family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.IL, cruiseMs: 50, rangeKm: 500,  payloadKg: 32,  wingspanM: 2.10, signatures: { rf: [RF_BANDS.SILENT], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.DELTA_WING }, threatProfile: 'critical', notes: 'Autonomous anti-radiation drone.' },
  { id: 'hero-30',              label: 'Uvision Hero-30',               family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.IL, cruiseMs: 28, rangeKm: 40,   payloadKg: 0.5, wingspanM: 0.80, signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.DELTA_WING }, notes: 'Small canister-launched loitering munition.' },
  { id: 'hero-120',             label: 'Uvision Hero-120',              family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.IL, cruiseMs: 39, rangeKm: 60,   payloadKg: 4,   wingspanM: 1.30, signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.DELTA_WING }, notes: 'Mid-size loitering munition.' },
  { id: 'hero-400',             label: 'Uvision Hero-400EC',            family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.IL, cruiseMs: 39, rangeKm: 150,  payloadKg: 10,  wingspanM: 2.50, signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.DELTA_WING }, threatProfile: 'critical', notes: 'Large Israeli loitering munition, long endurance.' },
  { id: 'ws-43',                label: 'CASIC WS-43',                   family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.CN, cruiseMs: 47, rangeKm: 60,   payloadKg: 20,  wingspanM: null, signatures: { rf: [RF_BANDS.BAND_L], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.CRUISE_MISSILE }, notes: 'Chinese cruise-missile-shaped loitering munition.' },
  { id: 'ch-901',               label: 'CASC CH-901',                   family: FAMILIES.LOITERING_MUNITION, origin: ORIGIN.CN, cruiseMs: 42, rangeKm: 15,   payloadKg: 3,   wingspanM: null, signatures: { rf: [RF_BANDS.BAND_L], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.CRUISE_MISSILE }, notes: 'Chinese tube-launched loitering munition.' },

  // ═══════════════════════════════════════════════════════════════
  // CRUISE MISSILES
  // ═══════════════════════════════════════════════════════════════
  { id: 'kh-101',               label: 'Kh-101 / Kh-102',               family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.RU, cruiseMs: 220, rangeKm: 4500, payloadKg: 400, wingspanM: 3.00, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Russian air-launched stealth cruise missile.' },
  { id: 'kh-555',               label: 'Kh-555',                        family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.RU, cruiseMs: 240, rangeKm: 2500, payloadKg: 410, wingspanM: 3.10, signatures: { rf: [RF_BANDS.SILENT], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Russian modernised Kh-55.' },
  { id: 'kh-22',                label: 'Kh-22 Burya',                   family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.RU, cruiseMs: 1100,rangeKm: 600,  payloadKg: 1000,wingspanM: 3.00, signatures: { rf: [RF_BANDS.BAND_X], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Russian supersonic anti-ship cruise missile.' },
  { id: 'iskander-k',           label: 'Iskander-K (9M728)',            family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.RU, cruiseMs: 220, rangeKm: 500,  payloadKg: 500, wingspanM: 2.60, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Russian ground-launched cruise missile.' },
  { id: 'kalibr-3m14',          label: 'Kalibr 3M14 Klub',              family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.RU, cruiseMs: 220, rangeKm: 2500, payloadKg: 450, wingspanM: 3.10, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Russian naval-launched land-attack cruise missile.' },
  { id: 'zircon-3m22',          label: 'Zircon 3M22 (hypersonic)',      family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.RU, cruiseMs: 2700,rangeKm: 1000, payloadKg: 400, wingspanM: null, signatures: { rf: [RF_BANDS.BAND_X], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Russian hypersonic anti-ship missile. Mach 8+.' },
  { id: 'tomahawk-bgm-109',     label: 'BGM-109 Tomahawk',              family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.US, cruiseMs: 240, rangeKm: 2500, payloadKg: 450, wingspanM: 2.67, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'US subsonic land-attack cruise missile.' },
  { id: 'jassm-agm-158',        label: 'AGM-158 JASSM / JASSM-ER',      family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.US, cruiseMs: 250, rangeKm: 1000, payloadKg: 450, wingspanM: 2.40, signatures: { rf: [RF_BANDS.SILENT], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'US air-launched stealth cruise missile.' },
  { id: 'storm-shadow',         label: 'Storm Shadow / SCALP-EG',       family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.UK, cruiseMs: 270, rangeKm: 550,  payloadKg: 450, wingspanM: 3.00, signatures: { rf: [RF_BANDS.SILENT], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'UK/France air-launched stealth cruise missile.' },
  { id: 'paveh',                label: 'Iran Paveh',                    family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.IR, cruiseMs: 200, rangeKm: 1650, payloadKg: 350, wingspanM: null, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Iranian land-attack cruise missile.' },
  { id: 'soumar',               label: 'Iran Soumar',                   family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.IR, cruiseMs: 220, rangeKm: 2500, payloadKg: 400, wingspanM: 3.10, signatures: { rf: [RF_BANDS.SILENT], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Iranian variant of Kh-55.' },
  { id: 'df-100',               label: 'DF-100 (CJ-100)',               family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.CN, cruiseMs: 1300,rangeKm: 3000, payloadKg: 500, wingspanM: null, signatures: { rf: [RF_BANDS.BAND_X], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Chinese supersonic cruise missile.' },
  { id: 'yj-18',                label: 'YJ-18',                         family: FAMILIES.CRUISE_MISSILE, origin: ORIGIN.CN, cruiseMs: 900, rangeKm: 540,  payloadKg: 300, wingspanM: null, signatures: { rf: [RF_BANDS.BAND_X], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.CRUISE_MISSILE }, threatProfile: 'critical', notes: 'Chinese naval supersonic anti-ship cruise missile.' },

  // ═══════════════════════════════════════════════════════════════
  // CIVILIAN HELICOPTERS
  // ═══════════════════════════════════════════════════════════════
  { id: 'robinson-r22',         label: 'Robinson R22',                  family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.US, cruiseMs: 47, rangeKm: 386, payloadKg: 181, wingspanM: 7.67, signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Training + small utility helicopter.' },
  { id: 'robinson-r44',         label: 'Robinson R44',                  family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.US, cruiseMs: 55, rangeKm: 560, payloadKg: 349, wingspanM: 10.06,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Popular 4-seat piston helicopter.' },
  { id: 'robinson-r66',         label: 'Robinson R66 Turbine',          family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.US, cruiseMs: 61, rangeKm: 650, payloadKg: 545, wingspanM: 10.06,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Turbine version of R44.' },
  { id: 'bell-206',             label: 'Bell 206 JetRanger',            family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.US, cruiseMs: 56, rangeKm: 693, payloadKg: 630, wingspanM: 10.20,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Iconic civilian turbine helicopter.' },
  { id: 'bell-407',             label: 'Bell 407',                      family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.US, cruiseMs: 63, rangeKm: 611, payloadKg: 1180,wingspanM: 10.67,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Utility + medevac configuration common.' },
  { id: 'airbus-h125',          label: 'Airbus H125 (AS350)',           family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.FR, cruiseMs: 65, rangeKm: 620, payloadKg: 1400,wingspanM: 10.69,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Iconic Squirrel light helicopter.' },
  { id: 'airbus-h135',          label: 'Airbus H135 (EC135)',           family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.DE, cruiseMs: 68, rangeKm: 635, payloadKg: 1500,wingspanM: 10.20,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Twin-engine light utility, popular EMS.' },
  { id: 'airbus-h145',          label: 'Airbus H145 (EC145)',           family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.FR, cruiseMs: 73, rangeKm: 665, payloadKg: 1750,wingspanM: 11.00,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Medium twin, EMS + law enforcement.' },
  { id: 'airbus-h160',          label: 'Airbus H160',                   family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.FR, cruiseMs: 87, rangeKm: 830, payloadKg: 1800,wingspanM: 12.00,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Fenestron tail-rotor design, quieter signature.' },
  { id: 'sikorsky-s-92',        label: 'Sikorsky S-92',                 family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.US, cruiseMs: 76, rangeKm: 1000,payloadKg: 3860,wingspanM: 17.17,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Heavy offshore + VIP transport helicopter.' },
  { id: 'leonardo-aw139',       label: 'Leonardo AW139',                family: FAMILIES.HELICOPTER_CIVILIAN, origin: ORIGIN.IT, cruiseMs: 82, rangeKm: 1250,payloadKg: 2500,wingspanM: 13.80,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Medium twin, offshore + SAR + EMS.' },

  // ═══════════════════════════════════════════════════════════════
  // MILITARY HELICOPTERS
  // ═══════════════════════════════════════════════════════════════
  { id: 'ah-64-apache',         label: 'Boeing AH-64 Apache',           family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.US, cruiseMs: 79, rangeKm: 480, payloadKg: 1421,wingspanM: 14.63,signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, threatProfile: 'high', notes: 'Attack helicopter, 30mm cannon + Hellfire.' },
  { id: 'uh-60-blackhawk',      label: 'Sikorsky UH-60 Black Hawk',     family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.US, cruiseMs: 80, rangeKm: 500, payloadKg: 4082,wingspanM: 16.36,signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Ubiquitous utility helicopter.' },
  { id: 'mh-60r-seahawk',       label: 'Sikorsky MH-60R Seahawk',       family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.US, cruiseMs: 74, rangeKm: 830, payloadKg: 4082,wingspanM: 16.36,signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L, RF_BANDS.BAND_X], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Naval ASW variant, Denmark operates 9.' },
  { id: 'ch-47-chinook',        label: 'Boeing CH-47 Chinook',          family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.US, cruiseMs: 78, rangeKm: 741, payloadKg: 10886,wingspanM: 18.29,signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.TANDEM_ROTOR }, notes: 'Tandem-rotor heavy lift.' },
  { id: 'v-22-osprey',          label: 'Bell Boeing V-22 Osprey',       family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.US, cruiseMs: 122,rangeKm: 1627,payloadKg: 9070,wingspanM: 25.78,signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.TILT_ROTOR, visual: VISUAL.TILT_ROTOR }, threatProfile: 'high', notes: 'Tiltrotor VTOL transport.' },
  { id: 'aw159-wildcat',        label: 'Leonardo AW159 Wildcat',        family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.UK, cruiseMs: 78, rangeKm: 780, payloadKg: 1100,wingspanM: 12.30,signatures: { rf: [RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'UK Navy multi-role.' },
  { id: 'eh-101-merlin',        label: 'Leonardo AW101 Merlin',         family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.UK, cruiseMs: 82, rangeKm: 1000,payloadKg: 5443,wingspanM: 18.60,signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Denmark operates for SAR. AW101 platform.' },
  { id: 'tigre-had',            label: 'Airbus Tigre HAD',              family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.FR, cruiseMs: 76, rangeKm: 800, payloadKg: 1800,wingspanM: 13.00,signatures: { rf: [RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, threatProfile: 'high', notes: 'French-German attack helicopter.' },
  { id: 'nh90-caiman',          label: 'NH90 Caiman',                   family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.FR, cruiseMs: 82, rangeKm: 800, payloadKg: 4000,wingspanM: 16.30,signatures: { rf: [RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'European medium military transport.' },
  { id: 'ka-52-alligator',      label: 'Kamov Ka-52 Alligator',         family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.RU, cruiseMs: 72, rangeKm: 460, payloadKg: 2000,wingspanM: 14.50,signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.COAXIAL_ROTOR }, threatProfile: 'high', notes: 'Russian coaxial-rotor attack helicopter.' },
  { id: 'mi-28-havoc',          label: 'Mil Mi-28N Havoc',              family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.RU, cruiseMs: 74, rangeKm: 435, payloadKg: 2300,wingspanM: 17.20,signatures: { rf: [RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, threatProfile: 'high', notes: 'Russian dedicated attack helicopter.' },
  { id: 'mi-8-mi-17-hip',       label: 'Mil Mi-8 / Mi-17 Hip',          family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.RU, cruiseMs: 66, rangeKm: 495, payloadKg: 4000,wingspanM: 21.29,signatures: { rf: [RF_BANDS.BAND_UHF, RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Ubiquitous Russian utility helicopter.' },
  { id: 'mi-24-hind',           label: 'Mil Mi-24/35 Hind',             family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.RU, cruiseMs: 89, rangeKm: 450, payloadKg: 2400,wingspanM: 17.30,signatures: { rf: [RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, threatProfile: 'high', notes: 'Attack + transport hybrid.' },
  { id: 'hkp-15-a109',          label: 'HKP 15 (Agusta A109M)',         family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.IT, cruiseMs: 78, rangeKm: 830, payloadKg: 900, wingspanM: 11.00,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Swedish light utility.' },
  { id: 'z-20-copperhead',      label: 'Harbin Z-20',                   family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.CN, cruiseMs: 80, rangeKm: 600, payloadKg: 4000,wingspanM: 16.36,signatures: { rf: [RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, notes: 'Chinese Black Hawk analog.' },
  { id: 'z-10',                 label: 'Changhe Z-10',                  family: FAMILIES.HELICOPTER_MILITARY, origin: ORIGIN.CN, cruiseMs: 77, rangeKm: 800, payloadKg: 1500,wingspanM: 13.00,signatures: { rf: [RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.ROTOR_THUMP, visual: VISUAL.MAIN_TAIL_ROTOR }, threatProfile: 'high', notes: 'Chinese attack helicopter.' },

  // ═══════════════════════════════════════════════════════════════
  // MILITARY JETS
  // ═══════════════════════════════════════════════════════════════
  { id: 'f-16-fighting-falcon', label: 'Lockheed Martin F-16',          family: FAMILIES.JET_MILITARY, origin: ORIGIN.US, cruiseMs: 250, rangeKm: 4220, payloadKg: 7700, wingspanM: 9.96, signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, notes: 'Danish F-16 fleet transitioning to F-35.' },
  { id: 'f-35-lightning-ii',    label: 'Lockheed Martin F-35 Lightning II', family: FAMILIES.JET_MILITARY, origin: ORIGIN.US, cruiseMs: 280, rangeKm: 2200, payloadKg: 8100, wingspanM: 10.70,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_KA, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, notes: 'Denmark operates 27 F-35A. Low RCS.' },
  { id: 'eurofighter-typhoon',  label: 'Eurofighter Typhoon',           family: FAMILIES.JET_MILITARY, origin: ORIGIN.DE, cruiseMs: 300, rangeKm: 2900, payloadKg: 9000, wingspanM: 10.95,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.DELTA_WING }, notes: 'European multi-role fighter.' },
  { id: 'rafale',               label: 'Dassault Rafale',               family: FAMILIES.JET_MILITARY, origin: ORIGIN.FR, cruiseMs: 300, rangeKm: 3700, payloadKg: 9500, wingspanM: 10.90,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.DELTA_WING }, notes: 'French multi-role fighter.' },
  { id: 'jas-39-gripen',        label: 'Saab JAS 39 Gripen',            family: FAMILIES.JET_MILITARY, origin: ORIGIN.SE, cruiseMs: 275, rangeKm: 3200, payloadKg: 5300, wingspanM: 8.40, signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.DELTA_WING }, notes: 'Swedish multi-role, operated by Sweden + others.' },
  { id: 'su-27-flanker',        label: 'Sukhoi Su-27 Flanker',          family: FAMILIES.JET_MILITARY, origin: ORIGIN.RU, cruiseMs: 350, rangeKm: 3530, payloadKg: 6000, wingspanM: 14.70,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, threatProfile: 'high', notes: 'Russian air superiority fighter.' },
  { id: 'su-35',                label: 'Sukhoi Su-35',                  family: FAMILIES.JET_MILITARY, origin: ORIGIN.RU, cruiseMs: 355, rangeKm: 3600, payloadKg: 8000, wingspanM: 15.30,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_UHF, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, threatProfile: 'high', notes: 'Modernised Flanker variant.' },
  { id: 'su-57',                label: 'Sukhoi Su-57 Felon',            family: FAMILIES.JET_MILITARY, origin: ORIGIN.RU, cruiseMs: 500, rangeKm: 3500, payloadKg: 10000,wingspanM: 14.10,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_KA], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, threatProfile: 'critical', notes: 'Russian 5th-gen stealth fighter.' },
  { id: 'mig-31-foxhound',      label: 'MiG-31 Foxhound',               family: FAMILIES.JET_MILITARY, origin: ORIGIN.RU, cruiseMs: 700, rangeKm: 3300, payloadKg: 9000, wingspanM: 13.46,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_L], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, threatProfile: 'critical', notes: 'Russian long-range interceptor. Kinzhal launch platform.' },
  { id: 'tu-95-bear',           label: 'Tupolev Tu-95 Bear',            family: FAMILIES.JET_MILITARY, origin: ORIGIN.RU, cruiseMs: 200, rangeKm: 15000,payloadKg: 15000,wingspanM: 50.10,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_HF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.SWEPT_WING }, threatProfile: 'critical', notes: 'Russian strategic bomber, cruise missile carrier.' },
  { id: 'tu-160-blackjack',     label: 'Tupolev Tu-160 Blackjack',      family: FAMILIES.JET_MILITARY, origin: ORIGIN.RU, cruiseMs: 260, rangeKm: 12300,payloadKg: 40000,wingspanM: 55.70,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_HF], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, threatProfile: 'critical', notes: 'Russian variable-sweep supersonic bomber.' },
  { id: 'a-10-thunderbolt',     label: 'Fairchild A-10 Thunderbolt II', family: FAMILIES.JET_MILITARY, origin: ORIGIN.US, cruiseMs: 155, rangeKm: 1200, payloadKg: 7260, wingspanM: 17.53,signatures: { rf: [RF_BANDS.BAND_X, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.STRAIGHT_WING }, notes: 'CAS jet, 30mm GAU-8 gun.' },

  // ═══════════════════════════════════════════════════════════════
  // CIVILIAN JETS + LIGHT AIRCRAFT
  // ═══════════════════════════════════════════════════════════════
  { id: 'cessna-172',           label: 'Cessna 172 Skyhawk',            family: FAMILIES.LIGHT_AIRCRAFT, origin: ORIGIN.US, cruiseMs: 63, rangeKm: 1272, payloadKg: 481, wingspanM: 11.00,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.STRAIGHT_WING }, notes: 'Most-produced aircraft ever. Trainer + tourism.' },
  { id: 'cessna-182',           label: 'Cessna 182 Skylane',            family: FAMILIES.LIGHT_AIRCRAFT, origin: ORIGIN.US, cruiseMs: 78, rangeKm: 1722, payloadKg: 636, wingspanM: 11.00,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.STRAIGHT_WING }, notes: '4-seat single-engine, common charter.' },
  { id: 'cessna-208-caravan',   label: 'Cessna 208 Caravan',            family: FAMILIES.LIGHT_AIRCRAFT, origin: ORIGIN.US, cruiseMs: 92, rangeKm: 1979, payloadKg: 1497,wingspanM: 15.90,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.STRAIGHT_WING }, notes: 'Turboprop utility, cargo + skydive.' },
  { id: 'piper-pa-28',          label: 'Piper PA-28 Cherokee',          family: FAMILIES.LIGHT_AIRCRAFT, origin: ORIGIN.US, cruiseMs: 62, rangeKm: 1091, payloadKg: 400, wingspanM: 9.20, signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.STRAIGHT_WING }, notes: 'Popular trainer + touring aircraft.' },
  { id: 'piper-pa-46',          label: 'Piper PA-46 Malibu',            family: FAMILIES.LIGHT_AIRCRAFT, origin: ORIGIN.US, cruiseMs: 108,rangeKm: 2200, payloadKg: 500, wingspanM: 13.10,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.STRAIGHT_WING }, notes: 'Pressurised single-engine tourer.' },
  { id: 'diamond-da40',         label: 'Diamond DA40',                  family: FAMILIES.LIGHT_AIRCRAFT, origin: ORIGIN.AT, cruiseMs: 71, rangeKm: 1667, payloadKg: 430, wingspanM: 11.94,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.STRAIGHT_WING }, notes: 'Composite trainer + tourer.' },
  { id: 'cirrus-sr22',          label: 'Cirrus SR22',                   family: FAMILIES.LIGHT_AIRCRAFT, origin: ORIGIN.US, cruiseMs: 92, rangeKm: 2000, payloadKg: 585, wingspanM: 11.68,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.STRAIGHT_WING }, notes: 'Fast piston single with whole-airframe parachute.' },
  { id: 'beechcraft-king-air',  label: 'Beechcraft King Air',           family: FAMILIES.LIGHT_AIRCRAFT, origin: ORIGIN.US, cruiseMs: 138,rangeKm: 2800, payloadKg: 2000,wingspanM: 17.65,signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.TURBINE_ROAR, visual: VISUAL.STRAIGHT_WING }, notes: 'Twin turboprop, business + special mission.' },
  { id: 'cessna-citation-cj4',  label: 'Cessna Citation CJ4',           family: FAMILIES.JET_CIVILIAN, origin: ORIGIN.US, cruiseMs: 216, rangeKm: 3700, payloadKg: 907, wingspanM: 15.49,signatures: { rf: [RF_BANDS.BAND_VHF, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, notes: 'Business jet.' },
  { id: 'gulfstream-g550',      label: 'Gulfstream G550',               family: FAMILIES.JET_CIVILIAN, origin: ORIGIN.US, cruiseMs: 250, rangeKm: 12500,payloadKg: 2900,wingspanM: 28.50,signatures: { rf: [RF_BANDS.BAND_VHF, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, notes: 'Long-range business jet.' },
  { id: 'embraer-phenom-300',   label: 'Embraer Phenom 300',            family: FAMILIES.JET_CIVILIAN, origin: ORIGIN.BR, cruiseMs: 237, rangeKm: 3650, payloadKg: 1200,wingspanM: 16.24,signatures: { rf: [RF_BANDS.BAND_VHF, RF_BANDS.BAND_UHF], acoustic: ACOUSTIC.JET_SCREAM, visual: VISUAL.SWEPT_WING }, notes: 'Light business jet.' },

  // ═══════════════════════════════════════════════════════════════
  // GLIDERS + TETHERED + SWARM PATTERNS
  // ═══════════════════════════════════════════════════════════════
  { id: 'schleicher-ask21',     label: 'Schleicher ASK 21 (glider)',    family: FAMILIES.GLIDER, origin: ORIGIN.DE, cruiseMs: 30, rangeKm: null, payloadKg: null, wingspanM: 17.00, signatures: { rf: [RF_BANDS.SILENT, RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.SILENT_ELECTRIC, visual: VISUAL.GLIDER }, notes: 'Two-seat training glider. Effectively silent.' },
  { id: 'stemme-s12',           label: 'Stemme S12 motor glider',       family: FAMILIES.GLIDER, origin: ORIGIN.DE, cruiseMs: 55, rangeKm: 1800, payloadKg: 200, wingspanM: 25.00, signatures: { rf: [RF_BANDS.BAND_VHF], acoustic: ACOUSTIC.PROP_HUM, visual: VISUAL.GLIDER }, notes: 'Self-launching motor glider.' },
  { id: 'elistair-orion-2',     label: 'Elistair Orion 2 (tethered)',   family: FAMILIES.TETHERED_PLATFORM, origin: ORIGIN.FR, cruiseMs: 0, rangeKm: 0.1, payloadKg: 2, wingspanM: 0.60, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_LARGE }, notes: 'Tethered surveillance quadcopter, unlimited endurance.' },
  { id: 'fotokite-sigma',       label: 'Fotokite Sigma (tethered)',     family: FAMILIES.TETHERED_PLATFORM, origin: ORIGIN.CH, cruiseMs: 0, rangeKm: 0.05,payloadKg: 1, wingspanM: 0.50, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ], acoustic: ACOUSTIC.HIGH_WHINE, visual: VISUAL.QUADCOPTER_SMALL }, notes: 'Emergency-response tethered drone.' },
  { id: 'aerostat-surveillance',label: 'Aerostat surveillance balloon', family: FAMILIES.TETHERED_PLATFORM, origin: ORIGIN.UNKNOWN, cruiseMs: 0, rangeKm: 3, payloadKg: 200, wingspanM: 20.00, signatures: { rf: [RF_BANDS.BAND_KU, RF_BANDS.BAND_X], acoustic: ACOUSTIC.SILENT_ELECTRIC, visual: VISUAL.BALLOON }, notes: 'Tethered surveillance balloon, extended dwell.' },
  { id: 'drone-swarm-generic',  label: 'Coordinated drone swarm',       family: FAMILIES.DRONE_SWARM, origin: ORIGIN.UNKNOWN, cruiseMs: null, rangeKm: null, payloadKg: null, wingspanM: null, signatures: { rf: [RF_BANDS.BAND_2_4_GHZ, RF_BANDS.BAND_5_8_GHZ, RF_BANDS.BAND_900_MHZ], acoustic: ACOUSTIC.SWARM_CHORUS, visual: VISUAL.UNKNOWN }, threatProfile: 'high', notes: 'Multi-drone coordinated attack pattern. Signature = many simultaneous low-RCS returns.' },
  { id: 'unknown-signature',    label: 'Unknown signature',             family: FAMILIES.UNKNOWN_SIGNATURE, origin: ORIGIN.UNKNOWN, cruiseMs: null, rangeKm: null, payloadKg: null, wingspanM: null, signatures: { rf: [], acoustic: ACOUSTIC.UNKNOWN, visual: VISUAL.UNKNOWN }, notes: 'Detection outside all known signatures. Manual attribution required.' },
];

// ── Public helpers ─────────────────────────────────────────────

// O(1) model lookup by id. Built once on module load.
const _byId = new Map();
for (const m of MODELS) _byId.set(m.id, m);

export function modelFor(modelId) {
  return _byId.get(modelId) || null;
}

// Coarse family binding — the routing matrix uses this.
export function familyOf(modelId) {
  return _byId.get(modelId)?.family || null;
}

// All models in a family. Consumed by picker filters + reporter.
export function modelsInFamily(family) {
  return MODELS.filter(m => m.family === family);
}

// Effective threat level for a model — model-level override wins,
// falls back to family default. Consumed by routing + auto-observer.
export function threatProfileFor(modelId) {
  const model = _byId.get(modelId);
  if (!model) return FAMILY_DEFAULT_THREAT[FAMILIES.UNKNOWN_SIGNATURE];
  if (model.threatProfile) return model.threatProfile;
  return FAMILY_DEFAULT_THREAT[model.family] || 'medium';
}

// Signature-driven attribution helper. Given a detected signature
// profile { rf?, acoustic?, visual? } returns models whose signature
// bindings overlap. Rough attribution scaffold — real signature
// matching lives in the future signature bridge module.
export function candidateModelsBySignature({ rf = [], acoustic = null, visual = null } = {}) {
  const rfSet = new Set(rf);
  return MODELS.filter(m => {
    if (acoustic && m.signatures.acoustic !== acoustic) return false;
    if (visual   && m.signatures.visual !== visual) return false;
    if (rfSet.size) {
      const modelRf = m.signatures.rf || [];
      const overlap = modelRf.some(b => rfSet.has(b));
      if (!overlap) return false;
    }
    return true;
  });
}

// Coverage snapshot for the console dev handle. Reports per-family
// model counts so a doc-vs-code drift is one grep away.
export function taxonomyCoverage() {
  const counts = {};
  for (const key of Object.keys(FAMILIES)) counts[FAMILIES[key]] = 0;
  for (const m of MODELS) if (m.family && counts[m.family] !== undefined) counts[m.family]++;
  return { total: MODELS.length, byFamily: counts };
}
