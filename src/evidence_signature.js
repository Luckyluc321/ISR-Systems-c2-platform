// ═══════════════════════════════════════════════════════════════════
// Evidence signature — hand-authored evidence into structured fields
// ───────────────────────────────────────────────────────────────────
// Each scenario template carries a hand-authored evidence block that
// describes what the sensors saw, in the form an operator would read:
//
//   { rfCarrier: '2.412 GHz', rfBandwidth: '20 MHz OFDM',
//     rfMatch: 'OcuSync 91%', modality: 'RF + acoustic' }
//   { rfCarrier: 'Passive, no active emitter', modality: 'RF + acoustic + visual' }
//   { rfCarrier: 'Ku band SATCOM (12.5 GHz) + PCL from DVB T reflection' }
//   { rfCarrier: '1090 MHz ADS-B', rfMatch: 'SAS743 A320neo, flight plan match' }
//
// That content is specific, varied, and correct per scenario. The
// recorder sample, which is what the trajectory export writes and what
// downstream consumers read, threw all of it away and substituted
// constants: the signature was always 'DJI OcuSync', the confidence
// always 0.89, the bandwidth always 20 MHz.
//
// So a cruise missile with no emitter at all exported as a DJI consumer
// datalink at 89% confidence. The sample carried source: 'sim', which
// is honest about the value being simulated, but a tag does not make a
// wrong value right, and every consumer reading those columns was
// reading a constant dressed as an observation.
//
// This module parses the authored text into the sample's structured
// fields, so the export says what the scenario actually describes.
//
// ── Direction of travel ─────────────────────────────────────────────
//
// Evidence flows INTO the sample. Not the other way round.
//
// The obvious refactor, making the screen read the sample so one shape
// feeds everything, is backwards: the sample is the fabricated one. It
// would have put "DJI OcuSync 89%" on the Skydio inspection flight, the
// A320 on approach, the Shahed, the high-altitude recon platform and
// the cruise missile, all at once, on the customer-facing screen.
//
// ── Nothing is invented to fill a field ─────────────────────────────
//
// A template that does not describe a bandwidth produces no bandwidth.
// Null is the correct answer and the previous constant was not. This
// is the whole point of the module and the reason it does not carry
// defaults.
// ═══════════════════════════════════════════════════════════════════

// A carrier that describes the absence of an emitter. Passive detection
// is a capability of this platform rather than a gap, so this is a
// finding to record, not a missing value to fill.
const PASSIVE_RE = /passive|no active emitter/i;

// Modulation families that appear in authored bandwidth strings, e.g.
// "20 MHz OFDM", "10 MHz FHSS". Matched as whole words so a scenario
// mentioning a word containing one of these does not trip it.
const MODULATIONS = ['OFDM', 'FHSS', 'DSSS', 'QPSK', 'QAM', 'FM', 'AM', 'PCM'];

function firstNumber(re, text) {
  const m = re.exec(text);
  return m ? parseFloat(m[1]) : null;
}

// Pull the first frequency out of an authored carrier string and return
// it in megahertz.
//
// Returns null, never 0, when there is no frequency to find. A missile
// template reads "Passive, no active emitter", and a 0 would render as
// "0 MHz" on an operator panel, which claims a measurement that does
// not exist and hides a capability that does.
export function carrierMhzFrom(carrierText) {
  const text = String(carrierText || '');
  if (!text || PASSIVE_RE.test(text)) return null;
  const ghz = firstNumber(/([\d.]+)\s*GHz/i, text);
  if (ghz != null) return ghz * 1000;
  const mhz = firstNumber(/([\d.]+)\s*MHz/i, text);
  if (mhz != null) return mhz;
  const khz = firstNumber(/([\d.]+)\s*kHz/i, text);
  if (khz != null) return khz / 1000;
  return null;
}

export function isPassiveCarrier(carrierText) {
  return PASSIVE_RE.test(String(carrierText || ''));
}

// "20 MHz OFDM" gives 20. "narrowband" gives null, because it describes
// a bandwidth without stating one.
export function bandwidthMhzFrom(bandwidthText) {
  const text = String(bandwidthText || '');
  if (!text) return null;
  const mhz = firstNumber(/([\d.]+)\s*MHz/i, text);
  if (mhz != null) return mhz;
  const khz = firstNumber(/([\d.]+)\s*kHz/i, text);
  return khz != null ? khz / 1000 : null;
}

// The modulation family, from either the bandwidth or the carrier
// string, whichever names one.
export function modulationFrom(...texts) {
  const joined = texts.map(t => String(t || '')).join(' ');
  return MODULATIONS.find(mod => new RegExp(`\\b${mod}\\b`, 'i').test(joined)) || null;
}

// Split an authored match string into the signature and its confidence.
//
//   'OcuSync 91%'                       → { signature: 'OcuSync', confidence: 0.91 }
//   'Geran-2 modem signature 74%'       → { signature: 'Geran-2 modem signature', confidence: 0.74 }
//   'SAS743 A320neo, flight plan match' → { signature: 'SAS743 A320neo, flight plan match', confidence: null }
//
// A match with no stated percentage keeps its text and reports no
// confidence. Assigning one would be inventing a number that the person
// who wrote the scenario deliberately did not state.
export function matchFrom(matchText) {
  const text = String(matchText || '').trim();
  if (!text) return { signature: null, confidence: null };
  const pct = /(\d+(?:\.\d+)?)\s*%\s*$/.exec(text);
  if (!pct) return { signature: text, confidence: null };
  return {
    signature: text.slice(0, pct.index).trim().replace(/[,;:]$/, '') || null,
    confidence: +(parseFloat(pct[1]) / 100).toFixed(3),
  };
}

// Everything above, applied to one evidence block, in the recorder
// sample's own field names so the result can be spread straight into a
// sample and straight into the trajectory export.
//
// Every field is null when the evidence does not describe it. There are
// no defaults here by design: a constant standing in for an
// unobserved value is what this module exists to remove.
export function signatureFieldsFromEvidence(evidence) {
  const ev = evidence || {};
  const carrierText = ev.rfCarrier || null;
  const match = matchFrom(ev.rfMatch);
  return {
    rf_carrier_mhz: carrierMhzFrom(carrierText),
    // The authored string, preserved. A compound carrier such as
    // "Ku band SATCOM (12.5 GHz) + PCL from DVB T reflection" cannot be
    // reduced to one number without losing what it says, and the
    // passive case has no number at all.
    rf_carrier_text: carrierText,
    rf_bandwidth_mhz: bandwidthMhzFrom(ev.rfBandwidth),
    rf_carrier_type: modulationFrom(ev.rfBandwidth, ev.rfCarrier),
    rf_match_signature: match.signature,
    rf_match_confidence: match.confidence,
    rf_passive: isPassiveCarrier(carrierText),
    modality: ev.modality || null,
  };
}
