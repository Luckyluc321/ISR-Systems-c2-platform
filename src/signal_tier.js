// ═══════════════════════════════════════════════════════════════════
// Signal tier — the reference library for what a detection's RF means
// ───────────────────────────────────────────────────────────────────
// SCOPE, same as families.js and for the same reason: this is a
// REFERENCE LIBRARY, not a classifier. The neural network decides what
// a platform is. This module answers a narrower and purely factual
// question: given the part of the spectrum an emission was observed in,
// and what kind of emission the network reported it as, what should an
// operator be told about it?
//
// Mapping 2437 MHz to "2.4 GHz ISM" is arithmetic, not inference, which
// is why it is allowed to live here. Concluding "2.4 GHz therefore DJI"
// would be classification and does not belong in C2 at any tier.
//
// ── Why this exists ─────────────────────────────────────────────────
//
// Until now the platform read an RF value out of a free-text string
// with a regular expression and rendered a number: "2400 MHz". That is
// true and almost useless. It does not say whether the band is a
// control uplink or a video downlink, whether occupying it is
// unremarkable or notable, whether the emission is consistent with a
// consumer airframe or a military datalink, or what an operator should
// do differently because of it.
//
// ── Two axes, because one is not enough ─────────────────────────────
//
//   BAND      Where in the spectrum. A physical fact.
//   EMISSION  What kind of transmission. Reported by the network.
//
// They are separate because the same band carries different things. An
// emission at 2.4 GHz may be a control uplink, a video downlink, or a
// decoded Remote ID broadcast, and those mean very different things to
// the person watching the screen.
//
// ── Full spectrum, deliberately ─────────────────────────────────────
//
// This platform is not scoped to the two consumer ISM bands. Military
// reconnaissance and loitering airframes are the population that
// matters here, and they live in long-range control bands, analogue
// video bands, and satellite links, or they go silent in cruise and
// emit nothing at all. A table containing only 2.4 and 5.8 GHz would
// encode the wrong product.
//
// ── Remote ID is a category here, not a dependency ──────────────────
//
// The network can decode a Remote ID broadcast when one is present, so
// it gets a tier like anything else. It is NOT how this platform
// establishes identity, because the airframes that matter do not
// broadcast and never did. It appears when it appears and is silent
// otherwise. What makes it worth surfacing when present is the one
// thing no other modality provides: the operator's own position.
//
// ── The input contract already exists ───────────────────────────────
//
// This module does NOT define a new shape. It consumes the sample the
// recorder already builds and the trajectory export already writes, so
// the fields here are the CSV's column names, unchanged:
//
//   rf_carrier_mhz        centre frequency, MEGAHERTZ not hertz
//   rf_bandwidth_mhz      occupied bandwidth, megahertz
//   rf_power_dbm          received power
//   rf_carrier_type       modulation and band as text, e.g. "OFDM 5.8 GHz"
//   rf_match_signature    the network's signature match, e.g. "DJI OcuSync"
//   rf_match_confidence   confidence in that match, 0 to 1
//
// Fields the schema does not carry yet are listed under EXTENSIONS at
// the bottom of this file. They are named in the same convention so
// that adding them is a schema addition rather than a translation
// layer, and every one of them is optional here.
//
// PROVENANCE MATTERS ON THIS PARTICULAR PANEL. In the simulation the
// signature fields are synthesised: rf_match_signature is always
// "DJI OcuSync" and rf_match_confidence is always 0.89, which
// _buildDroneSample documents at the point it writes them. So a match
// is rendered with its provenance attached rather than asserted flat,
// because a narrative that reports an OcuSync match on a real incident
// that never happened is worse than one that reports nothing.
//
// Wire contract: docs/integration-contracts.md §1 signature.rf, and
// the trajectory export column list in src/main.js.
// ═══════════════════════════════════════════════════════════════════

// ── Emission types ──────────────────────────────────────────────────
// What kind of transmission the network reported. Not derived here.

export const EMISSION = Object.freeze({
  CONTROL_UPLINK: 'control_uplink',
  VIDEO_DOWNLINK: 'video_downlink',
  TELEMETRY: 'telemetry',
  DATALINK: 'datalink',
  SATCOM: 'satcom',
  REMOTE_ID: 'remote_id',
  SILENT: 'silent',
  UNKNOWN: 'unknown',
});

export const EMISSION_LIBRARY = Object.freeze({
  [EMISSION.CONTROL_UPLINK]: {
    label: 'Control uplink',
    meaning: 'A pilot is commanding the aircraft right now.',
    operatorNote: 'An active uplink means an operator is present and within link range.',
  },
  [EMISSION.VIDEO_DOWNLINK]: {
    label: 'Video downlink',
    meaning: 'The aircraft is sending imagery back to whoever is flying it.',
    operatorNote: 'Imagery is leaving the site. Treat what the aircraft can see as already seen.',
  },
  [EMISSION.TELEMETRY]: {
    label: 'Telemetry',
    meaning: 'Aircraft state is being reported back over a low-rate link.',
    operatorNote: 'Often long range and low power. Presence without a control uplink can indicate autonomous flight.',
  },
  [EMISSION.DATALINK]: {
    label: 'Datalink',
    meaning: 'A structured command and control link that is not a consumer protocol.',
    operatorNote: 'Uncommon on commercial airframes.',
  },
  [EMISSION.SATCOM]: {
    label: 'Satellite link',
    meaning: 'The aircraft is linked over satellite rather than to a local operator.',
    operatorNote: 'No local operator to locate. Range to the controller is unbounded.',
  },
  [EMISSION.REMOTE_ID]: {
    label: 'Remote identification broadcast',
    meaning: 'The aircraft is broadcasting a regulatory identity message.',
    operatorNote: 'Carries the operator position, which no other modality provides. '
      + 'Unauthenticated in Europe, so it is a lead to verify rather than an identification.',
    // Surfaced only when the network reports a decoded broadcast, never
    // inferred from occupancy of a band that happens to carry it.
    conditional: true,
  },
  [EMISSION.SILENT]: {
    label: 'No emission',
    meaning: 'Detected by other means. Nothing is being transmitted.',
    operatorNote: 'Silence is a finding. Several loitering types transmit nothing in cruise, '
      + 'and an aircraft that stops transmitting mid-flight has changed behaviour.',
  },
  [EMISSION.UNKNOWN]: {
    label: 'Unclassified emission',
    meaning: 'Energy is present. Its purpose has not been established.',
    operatorNote: null,
  },
});

// ── Bands ───────────────────────────────────────────────────────────
// Ordered low to high. `from` and `to` are inclusive bounds in hertz.
//
// `notability` is about the BAND, never about the aircraft. It answers
// "is it unusual to see something here", which is a property of the
// spectrum and of what is licensed to use it. The threat call belongs
// to the network and to families.js.

export const BAND_NOTABILITY = Object.freeze({
  ROUTINE: 'routine',
  ELEVATED: 'elevated',
  UNCOMMON: 'uncommon',
});

export const BANDS = Object.freeze([
  {
    id: 'hf-vhf',
    label: 'High and very high frequency',
    from: 3e6, to: 300e6,
    carries: 'Long-range telemetry and legacy control.',
    notability: BAND_NOTABILITY.UNCOMMON,
    note: 'Very long range for very little power. Rare on small airframes, and notable when present.',
  },
  {
    id: 'uhf-433',
    label: '433 MHz',
    from: 420e6, to: 450e6,
    carries: 'Long-range telemetry links.',
    notability: BAND_NOTABILITY.ELEVATED,
    note: 'Common on self-assembled airframes. Range well beyond what consumer video links reach.',
  },
  {
    id: 'uhf-868-915',
    label: '868 and 915 MHz',
    from: 860e6, to: 930e6,
    carries: 'Long-range control links.',
    notability: BAND_NOTABILITY.ELEVATED,
    note: 'Tens of kilometres of control range. A control link here implies an operator much '
      + 'further away than a 2.4 GHz link would.',
  },
  {
    id: 'l-band-1.2',
    label: '1.2 and 1.3 GHz',
    from: 1.1e9, to: 1.4e9,
    carries: 'Analogue video downlink, long range.',
    notability: BAND_NOTABILITY.ELEVATED,
    note: 'Penetrates obstacles better than the higher video bands. Not licensed for this use '
      + 'in most of Europe, so its presence is itself irregular.',
  },
  {
    id: 'ism-2400',
    label: '2.4 GHz',
    from: 2.4e9, to: 2.5e9,
    carries: 'Control uplinks, video, and Remote ID broadcasts.',
    notability: BAND_NOTABILITY.ROUTINE,
    note: 'The most crowded band in the table. Also carries every wireless network in the area, '
      + 'so occupancy alone says very little.',
  },
  {
    id: 'ism-5800',
    label: '5.8 GHz',
    from: 5.7e9, to: 5.9e9,
    carries: 'Video downlink, and some control.',
    notability: BAND_NOTABILITY.ROUTINE,
    note: 'Shorter range than 2.4 GHz and less congested, so a signal here is easier to '
      + 'attribute to an aircraft than one in the band below.',
  },
  {
    id: 'satcom-ku-ka',
    label: 'Ku and Ka band',
    from: 12e9, to: 40e9,
    carries: 'Satellite command and control.',
    notability: BAND_NOTABILITY.UNCOMMON,
    note: 'Beyond-line-of-sight control. There is no local operator to locate, and the '
      + 'aircraft is not limited by distance from one.',
  },
]);

// ── Lookup ──────────────────────────────────────────────────────────

// Which band does this centre frequency fall in?
//
// Returns null rather than a nearest guess. A frequency between the
// table's entries is a real observation the library does not describe,
// and saying so is more useful than assigning it to whichever band
// happens to be closest.
export function bandForHz(centerHz) {
  if (!Number.isFinite(centerHz) || centerHz <= 0) return null;
  return BANDS.find(b => centerHz >= b.from && centerHz <= b.to) || null;
}

export function bandById(id) {
  return BANDS.find(b => b.id === id) || null;
}

export function emissionMetadata(type) {
  return EMISSION_LIBRARY[type] || EMISSION_LIBRARY[EMISSION.UNKNOWN];
}

// Format a frequency the way an operator reads it, rather than always
// in megahertz. 2437000000 becomes "2.437 GHz", 433920000 becomes
// "433.92 MHz".
export function formatHz(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3).replace(/\.?0+$/, '')} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(2).replace(/\.?0+$/, '')} MHz`;
  return `${Math.round(hz / 1e3)} kHz`;
}

// ── The tier ────────────────────────────────────────────────────────

// Describe an observed emission.
//
// Input is a recorder sample, or anything carrying the same field
// names. Every field is optional, because a real detection is
// frequently partial: a bearing-only radio-frequency sensor may give a
// band and nothing else.
//
// `source` is the sample's own provenance tag ('sim' or 'live') and is
// used to qualify the signature match, not to filter anything out.
export function signalTier(sample = {}) {
  const mhz = Number.isFinite(sample.rf_carrier_mhz) ? sample.rf_carrier_mhz : null;
  const centerHz = mhz != null ? mhz * 1e6 : null;
  const band = bandForHz(centerHz);

  const emissionType = sample.rf_emission && EMISSION_LIBRARY[sample.rf_emission]
    ? sample.rf_emission
    : EMISSION.UNKNOWN;
  const emission = emissionMetadata(emissionType);

  // Detail rows, built conditionally. A row is present only when the
  // thing it describes was actually observed. An empty row that reads
  // "unknown" trains an operator to ignore the panel.
  const rows = [];

  if (band) {
    rows.push({ key: 'band', label: 'Band', value: band.label, note: band.note });
  } else if (centerHz) {
    rows.push({
      key: 'band',
      label: 'Band',
      value: 'Outside the reference library',
      note: 'This frequency is not described in the band table. Recorded as observed.',
    });
  }

  if (centerHz) {
    rows.push({ key: 'frequency', label: 'Centre frequency', value: formatHz(centerHz) });
  }
  if (Number.isFinite(sample.rf_bandwidth_mhz)) {
    rows.push({ key: 'bandwidth', label: 'Bandwidth', value: formatHz(sample.rf_bandwidth_mhz * 1e6) });
  }
  if (Number.isFinite(sample.rf_power_dbm)) {
    rows.push({ key: 'power', label: 'Received power', value: `${sample.rf_power_dbm.toFixed(1)} dBm` });
  }

  // Modulation, taken from rf_carrier_type. That field reads "OFDM
  // 5.8 GHz", so the band half is dropped: it is already its own row
  // above, derived from the frequency rather than from a string.
  const modulation = _modulationFrom(sample.rf_carrier_type);
  if (modulation) {
    rows.push({ key: 'modulation', label: 'Modulation', value: modulation });
  }

  if (emissionType !== EMISSION.UNKNOWN) {
    rows.push({
      key: 'emission',
      label: 'Emission',
      value: emission.label,
      note: emission.operatorNote,
    });
  }

  if (sample.rf_hopping === true) {
    rows.push({
      key: 'hopping',
      label: 'Frequency hopping',
      value: 'Observed',
      note: 'The emitter is changing frequency. It is harder to jam and harder to hold on a '
        + 'narrowband receiver, and it is characteristic of purpose-built links rather than '
        + 'consumer video.',
    });
  }

  // The network's signature match, carried with its provenance.
  //
  // Qualified rather than asserted when the sample is simulated,
  // because these fields are synthesised in the simulation and flow
  // straight into the debrief and the agentic narrative.
  if (sample.rf_match_signature) {
    const simulated = sample.source === 'sim';
    const conf = Number.isFinite(sample.rf_match_confidence)
      ? ` (${Math.round(sample.rf_match_confidence * 100)}%)`
      : '';
    rows.push({
      key: 'signature_match',
      label: simulated ? 'Signature match (simulated)' : 'Signature match',
      value: `${sample.rf_match_signature}${conf}`,
      note: simulated
        ? 'This sample is simulated. The signature is generated by the scenario, not observed, '
          + 'and must not be reported as evidence.'
        : 'Reported by the neural network. C2 does not classify signatures.',
    });
  }

  // Remote identification: present only when a broadcast was actually
  // decoded. Never inferred from a 2.4 GHz emission, because the
  // overwhelming majority of 2.4 GHz traffic at any site is not
  // Remote ID, and because the airframes this platform exists for do
  // not broadcast at all.
  const rid = sample.remote_id || null;
  if (rid) {
    rows.push({
      key: 'remote_id',
      label: 'Remote identification',
      value: rid.uas_id || 'Broadcast decoded, no identifier',
      note: EMISSION_LIBRARY[EMISSION.REMOTE_ID].operatorNote,
    });
    if (Number.isFinite(rid.operator_lat) && Number.isFinite(rid.operator_lon)) {
      rows.push({
        key: 'operator_position',
        label: 'Operator position',
        value: `${rid.operator_lat.toFixed(4)}°N ${rid.operator_lon.toFixed(4)}°E`,
        note: 'Self-reported by the aircraft and not verified by this platform. '
          + 'A measured bearing that disagrees with it is itself a finding.',
      });
    }
  }

  return {
    band,
    bandId: band?.id ?? null,
    notability: band?.notability ?? null,
    emission: emissionType,
    emissionLabel: emission.label,
    modulation,
    hasRemoteId: !!rid,
    simulatedSignature: !!sample.rf_match_signature && sample.source === 'sim',
    summary: _summarise(band, centerHz, emissionType, emission),
    rows,
  };
}

// Pull the modulation out of rf_carrier_type, which reads like
// "OFDM 5.8 GHz". The band half is dropped because it is derived
// properly elsewhere, from the frequency rather than from text.
function _modulationFrom(carrierType) {
  if (typeof carrierType !== 'string' || !carrierType.trim()) return null;
  const m = carrierType.replace(/[\d.]+\s*(GHz|MHz|kHz)/ig, '').trim();
  return m || null;
}

function _summarise(band, centerHz, emissionType, emission) {
  if (emissionType === EMISSION.SILENT) return 'No emission';
  const left = band ? band.label : (centerHz ? formatHz(centerHz) : null);
  if (!left) return emissionType === EMISSION.UNKNOWN ? 'No radio-frequency data' : emission.label;
  if (emissionType === EMISSION.UNKNOWN) return left;
  return `${left} · ${emission.label}`;
}

// Coverage, so a gate can assert the library has not drifted.
export function signalTierCoverage() {
  return {
    bands: BANDS.length,
    emissions: Object.keys(EMISSION_LIBRARY).length,
    lowestHz: Math.min(...BANDS.map(b => b.from)),
    highestHz: Math.max(...BANDS.map(b => b.to)),
  };
}

// ── Extensions ──────────────────────────────────────────────────────
// Fields the recorder schema does not carry yet, named in its own
// convention so that supplying them is a schema addition rather than a
// translation layer. Every one is optional and the tier renders
// correctly without it.
//
//   rf_emission     one of EMISSION. Whether the transmission is a
//                   control uplink, a video downlink, telemetry, a
//                   datalink, a satellite link, a Remote ID broadcast,
//                   or nothing at all. The network knows this; the
//                   schema has no column for it, so the Emission row
//                   is absent today.
//
//   rf_hopping      boolean. Whether the emitter is changing
//                   frequency. Characteristic of purpose-built links
//                   rather than consumer video, which is exactly the
//                   distinction this platform's population turns on.
//
//   remote_id       decoded broadcast payload, present ONLY when one
//                   was actually decoded:
//                     { uas_id, operator_lat, operator_lon }
//                   The sensor node's DroneIDDetection already carries
//                   uas_id and operator_position, so this is a matter
//                   of routing it through, not of building anything.
//
// Requested as part of the same conversation as the track identity
// ask. See Q1 in docs/open-questions.md.
export const SCHEMA_EXTENSIONS = Object.freeze(['rf_emission', 'rf_hopping', 'remote_id']);
