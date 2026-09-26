#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Signal tier gate — the band table stays a library, not a classifier
// ───────────────────────────────────────────────────────────────────
// src/signal_tier.js answers a narrow, factual question: given where in
// the spectrum an emission was seen, and what kind of emission the
// network reported it as, what should an operator be told?
//
// Two ways that erodes, and both are quiet:
//
//   It starts classifying. Mapping 2437 MHz to "2.4 GHz ISM" is
//   arithmetic. Concluding "2.4 GHz therefore DJI OcuSync" is
//   inference, it is the network's job, and it would be wrong roughly
//   as often as it was right, because every wireless network in the
//   area sits in that band too.
//
//   It shrinks to the consumer bands. This platform exists for
//   military reconnaissance and loitering airframes, which live in
//   long-range control bands, analogue video bands and satellite
//   links, or go silent in cruise and emit nothing. A table containing
//   only 2.4 and 5.8 GHz would encode the wrong product, and it is the
//   easiest kind of table to end up with, because those are the two
//   bands everyone names first.
//
// Remote ID gets particular attention here. The network can decode a
// broadcast when one is present, so it is a legitimate category. It is
// NOT an identity mechanism for this platform, because the airframes
// that matter do not broadcast. So it must appear when decoded and be
// absent otherwise, and must never be inferred from a band.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  signalTier, bandForHz, bandById, formatHz, signalTierCoverage,
  BANDS, EMISSION, EMISSION_LIBRARY, BAND_NOTABILITY, SCHEMA_EXTENSIONS,
} from '../src/signal_tier.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(REPO, 'src/main.js'), 'utf8');
// Comments stripped. These assertions are about the DATA the library
// carries, not the prose explaining why it stays out of the network's
// job. The first version of this gate failed against its own module,
// because the header says "concluding 2.4 GHz therefore DJI would be
// classification" in order to rule it out.
const tierSrc = readFileSync(join(REPO, 'src/signal_tier.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('\nThe spectrum is not two consumer bands');
const cov = signalTierCoverage();
check('the band table reaches well below the ISM bands',
  cov.lowestHz <= 450e6,
  `lowest band starts at ${formatHz(cov.lowestHz)}. Long-range control and telemetry live down here, `
  + 'and they are what a self-assembled or purpose-built airframe uses');
check('the band table reaches well above the ISM bands',
  cov.highestHz >= 12e9,
  'satellite command and control puts the operator beyond line of sight entirely');
check('bands exist between and beyond 2.4 and 5.8 GHz',
  BANDS.filter(b => b.to < 2.4e9 || b.from > 5.9e9).length >= 4,
  'a table of only the two crowded consumer bands would encode the wrong product');
for (const [label, hz, expectId] of [
  ['433 MHz telemetry', 433.92e6, 'uhf-433'],
  ['868 MHz long-range control', 868e6, 'uhf-868-915'],
  ['1.2 GHz analogue video', 1.28e9, 'l-band-1.2'],
  ['2.4 GHz', 2.437e9, 'ism-2400'],
  ['5.8 GHz', 5.8e9, 'ism-5800'],
  ['Ku-band satellite', 14.2e9, 'satcom-ku-ka'],
]) {
  check(`${label} resolves to its band`, bandForHz(hz)?.id === expectId);
}
check('a frequency between bands is reported as outside the library, not snapped to the nearest',
  bandForHz(3.5e9) === null
  && signalTier({ rf_carrier_mhz: 3500 }).rows.some(r => /Outside the reference library/.test(r.value)),
  'assigning an unknown observation to whichever band is closest would be a quiet fabrication');
check('every band declares what it carries and how notable it is',
  BANDS.every(b => b.carries && Object.values(BAND_NOTABILITY).includes(b.notability)));
check('band notability is about the band, never a threat call',
  !/threat|hostile|attack|malicious/i.test(
    BANDS.map(b => `${b.carries} ${b.note}`).join(' ')),
  'whether an aircraft is a threat is the network\'s call and families.js\'s library, not the spectrum\'s');

console.log('\nIt describes, it does not classify');
check('no platform or manufacturer is named in the band table',
  !/DJI|Autel|Parrot|Mavic|OcuSync|Lightbridge|Skydio/i.test(tierSrc),
  'concluding a manufacturer from a frequency is inference, it belongs to the network, and in the '
  + 'most crowded band it would be wrong more often than right');
check('the module maps frequency to band and nothing further',
  !/nn_family|classification|threat_estimate/.test(tierSrc));

console.log('\nSame band, different meaning, because emission is a separate axis');
const video = signalTier({ rf_carrier_mhz: 5800, rf_emission: EMISSION.VIDEO_DOWNLINK });
const control = signalTier({ rf_carrier_mhz: 5800, rf_emission: EMISSION.CONTROL_UPLINK });
check('one band with two emission types produces two different readings',
  video.summary !== control.summary && video.bandId === control.bandId,
  'the same band carries an uplink and a downlink, and those mean different things to the operator');
check('2.4 GHz and 5.8 GHz do not read identically',
  signalTier({ rf_carrier_mhz: 2437 }).summary !== signalTier({ rf_carrier_mhz: 5800 }).summary);
check('every emission type carries an operator-facing meaning',
  Object.values(EMISSION_LIBRARY).every(e => e.label && e.meaning));

console.log('\nSilence is a finding, not missing data');
const silent = signalTier({ rf_emission: EMISSION.SILENT });
check('a passive track reports no emission rather than no data',
  silent.summary === 'No emission' && silent.emission === EMISSION.SILENT,
  'several loitering types transmit nothing in cruise. Rendering that as a blank field loses the finding');
check('the silent category says why it matters',
  /cruise|behaviour|silence/i.test(EMISSION_LIBRARY[EMISSION.SILENT].operatorNote || ''));

console.log('\nRemote identification appears when decoded and never otherwise');
const plain24 = signalTier({ rf_carrier_mhz: 2437, rf_emission: EMISSION.CONTROL_UPLINK });
check('a 2.4 GHz emission alone produces no Remote ID claim',
  plain24.hasRemoteId === false
  && !plain24.rows.some(r => r.key === 'remote_id' || r.key === 'operator_position'),
  'the overwhelming majority of 2.4 GHz traffic at any site is not Remote ID. Inferring it from the '
  + 'band would manufacture an identity for an aircraft that never broadcast one');
const withRid = signalTier({
  rf_carrier_mhz: 2437,
  rf_emission: EMISSION.REMOTE_ID,
  remote_id: { uas_id: '1581F4A1B2C3', operator_lat: 55.6201, operator_lon: 12.6502 },
});
check('a decoded broadcast surfaces the identifier', withRid.hasRemoteId === true
  && withRid.rows.some(r => r.key === 'remote_id' && r.value === '1581F4A1B2C3'));
check('a decoded broadcast surfaces the operator position',
  withRid.rows.some(r => r.key === 'operator_position'),
  'it is the one thing no other modality provides. Every other sensor finds the aircraft');
// Asserted per row, not across both. Checking them together let a
// mutant relabel the operator position as "Confirmed operator location"
// while the neighbouring row still carried the word "verify".
check('the identifier is presented as a lead, not as an identification',
  /unauthenticated|verify|lead/i.test(withRid.rows.find(r => r.key === 'remote_id')?.note || ''),
  'Europe broadcasts no authentication at all, so a broadcast is a lead, not proof');
check('the operator position is marked self-reported on its own row',
  (() => {
    const note = withRid.rows.find(r => r.key === 'operator_position')?.note || '';
    return /self-reported|not verified/i.test(note) && !/confirmed|verified operator/i.test(note);
  })(),
  'it is the highest-consequence field on the panel. An operator acting on it is sending people '
  + 'to an address the aircraft chose to broadcast, and an ESP32 can broadcast any address');
check('the Remote ID category is marked conditional in the library',
  EMISSION_LIBRARY[EMISSION.REMOTE_ID].conditional === true);

console.log('\nA partial detection renders what it has');
const bandOnly = signalTier({ rf_carrier_mhz: 2440 });
check('a band with no emission type still produces a reading',
  bandOnly.rows.length >= 2 && bandOnly.summary === '2.4 GHz',
  'a bearing-only radio-frequency sensor may give a band and nothing else, which is a real observation');
check('nothing is invented to fill a row',
  !bandOnly.rows.some(r => /unknown|n\/a|none/i.test(String(r.value))),
  'a row reading "unknown" trains an operator to stop reading the panel');
check('an empty observation does not throw and says so plainly',
  signalTier({}).summary === 'No radio-frequency data');
check('a nonsensical frequency is refused rather than formatted',
  bandForHz(-1) === null && bandForHz(NaN) === null && formatHz(0) === null);

console.log('\nFrequencies read the way an operator says them');
check('gigahertz values render as gigahertz', formatHz(2.437e9) === '2.437 GHz');
check('megahertz values render as megahertz', formatHz(433.92e6) === '433.92 MHz');
check('trailing zeroes are trimmed', formatHz(5.8e9) === '5.8 GHz');

console.log('\nIt consumes the recorder schema, not a parallel one');
check('the trajectory export field names are what the tier reads',
  (() => {
    const t = signalTier({
      rf_carrier_mhz: 5800, rf_bandwidth_mhz: 20, rf_power_dbm: -68,
      rf_carrier_type: 'OFDM 5.8 GHz',
    });
    return t.bandId === 'ism-5800'
      && t.rows.some(r => r.key === 'bandwidth' && r.value === '20 MHz')
      && t.rows.some(r => r.key === 'power' && r.value === '-68.0 dBm');
  })(),
  'the recorder already writes these columns and the CSV already exports them. A parallel shape '
  + 'invented for the screen would need a translation layer and would drift from the export');
check('the carrier frequency is read as megahertz, matching the column name',
  signalTier({ rf_carrier_mhz: 2437 }).bandId === 'ism-2400'
  && signalTier({ rf_carrier_mhz: 2.437e9 }).bandId !== 'ism-2400',
  'rf_carrier_mhz is megahertz. Treating it as hertz would put every detection off the table');
check('modulation comes from rf_carrier_type with the band text stripped',
  signalTier({ rf_carrier_type: 'OFDM 5.8 GHz' }).modulation === 'OFDM',
  'the band belongs in its own row, derived from the frequency rather than parsed out of a string');
check('a simulated signature match is labelled, not asserted',
  (() => {
    const t = signalTier({
      rf_carrier_mhz: 2437, rf_match_signature: 'DJI OcuSync',
      rf_match_confidence: 0.89, source: 'sim',
    });
    const row = t.rows.find(r => r.key === 'signature_match');
    return t.simulatedSignature === true
      && /simulated/i.test(row.label)
      && /not observed|generated by the scenario/i.test(row.note);
  })(),
  'these fields are synthesised in the simulation: the signature is always OcuSync and the '
  + 'confidence always 0.89. Rendering that flat would put a match nobody observed into a debrief');
check('a live signature match is not labelled simulated',
  (() => {
    const t = signalTier({
      rf_carrier_mhz: 2437, rf_match_signature: 'OcuSync 4', source: 'live',
    });
    return t.simulatedSignature === false
      && !/simulated/i.test(t.rows.find(r => r.key === 'signature_match').label);
  })());
check('fields the schema does not carry yet are named in its convention',
  SCHEMA_EXTENSIONS.every(f => /^[a-z][a-z0-9_]*$/.test(f))
  && SCHEMA_EXTENSIONS.includes('rf_emission')
  && SCHEMA_EXTENSIONS.includes('remote_id'),
  'adding them should be a schema addition, not a translation layer');

console.log('\nWiring in src/main.js');
check('the display path passes provenance through rather than declaring it',
  /source: stats\?\.source \?\? 'sim',/.test(main),
  'hardcoding it would relabel every synthesised signature as observed, which is the exact failure '
  + 'the simulated-match label exists to prevent. Defaulting to sim is the safe direction');
check('the display path builds a recorder-shaped sample',
  /function _sampleFrom\(/.test(main) && /rf_carrier_mhz:/.test(main),
  'both display surfaces normalise to the export\'s field names, so neither invents its own');
check('the roster shows band and emission, not a bare frequency',
  !/\$\{d\.stats\.rfCarrierMHz \|\| 2412\} MHz/.test(main)
  && /_tierSummary\(d\.stats\)/.test(main),
  '"2412 MHz" is true and almost useless. "2.4 GHz · Control uplink" is what an operator acts on');
check('the old regex-the-string-for-a-number path is gone',
  !/const _ghz = _rfRaw\.match/.test(main));
check('the evidence panel renders library rows',
  /_t\.rows\.map/.test(main));
check('a passive track is routed to the silent category, not to no data',
  /passive\/i\.test\(raw\) \? _EMISSION\.SILENT/.test(main));
check('Remote ID reaches the tier only from a decoded payload',
  /remote_id: stats\?\.remote_id \?\? null/.test(main),
  'never derived in main.js from a band or a frequency');

if (failures) {
  console.error(`\n✗ Signal tier gate failed: ${failures} assertion(s).\n`);
  process.exit(1);
}
console.log(`\n✓ Signal tier gate satisfied. ${cov.bands} bands from ${formatHz(cov.lowestHz)} to ${formatHz(cov.highestHz)}, ${cov.emissions} emission types.\n`);
