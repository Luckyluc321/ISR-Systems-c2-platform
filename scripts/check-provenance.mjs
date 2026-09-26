#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Provenance gate — every observation says whether it was real
// ───────────────────────────────────────────────────────────────────
// The platform ships as two environments: a simulation the customer
// uses for training and rehearsal, and a real deployment that is the
// same codebase fed by live sensors. A site can be mixed, with real
// sensors watching real airspace while a scenario runs alongside.
//
// Once those two streams touch, nothing after the fact can tell them
// apart. An operator reading a case file, an agency reading an exported
// CSV, and the agentic layer writing a narrative all have to know which
// observations were real.
//
// This matters more than it sounds. Recording samples carry SYNTHESISED
// sensor evidence: the RF signature is always "DJI OcuSync", the
// acoustic fundamental is always 220 Hz, the visual match is always
// 0.85. That is correct for a simulation and it flows straight into the
// debrief and the agentic prompts. Untagged, the agentic layer would
// narrate an OcuSync match on a real incident that never happened.
//
// Tagging is cheap now and impossible to retrofit once mixed data
// exists, which is why this gate exists before any live wiring does.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { SITES } from '../src/sites_registry.js';
import { MockNnOutputSource, WebSocketNnOutputSource } from '../src/nn_source.js';
import {
  publishDispatchFix, onDispatchFix, isValidFix, telemetryStats, _resetTelemetryForTest,
  applyFixToUnit, reassertLivePosition, isTelemetryStale, TELEMETRY_STALE_SEC,
  registerTelemetryAdapter, listTelemetryAdapters, fixRejectionReason,
} from '../src/dispatch_telemetry.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(REPO, 'src/main.js'), 'utf8');
const events = readFileSync(join(REPO, 'src/events.js'), 'utf8');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('\nNo site claims live data it does not have');
const modes = {};
for (const [sid, site] of Object.entries(SITES)) modes[site.mode] = (modes[site.mode] || 0) + 1;
check('every shipped site declares mode: sim',
  Object.keys(modes).length === 1 && modes.sim === Object.keys(SITES).length,
  `found ${JSON.stringify(modes)}. Every site runs from scenario templates. A manifest saying "live" `
  + 'while nothing reads the field is a loaded gun: the first code to read it flips the whole fleet.');
check('an undeclared mode defaults to sim, not live',
  /mode:\s+manifest\.mode\s+\|\|\s+'sim'/.test(readFileSync(join(REPO, 'src/site_loader.js'), 'utf8')),
  'the safe failure is a site that simulates when it should be live, never one that claims real data');

console.log('\nDetections carry provenance, stamped by the source');
const mock = new MockNnOutputSource('cph');
mock.start();
let batch = null;
mock.onDetection(b => { batch = b; });
const site = SITES.cph;
const s0 = site?.sensors?.[0];
if (s0) mock.ingestPositions([{ lat: s0.lat, lon: s0.lon, alt: 50 }]);
check('the mock source declares itself sim', mock.source === 'sim');
check('a new live source declares itself live', new WebSocketNnOutputSource('cph', 'ws://x').source === 'live');
check('every batch carries source', batch?.source === 'sim', 'a batch with no provenance is unattributable');
const dets = (batch?.sensors || []).flatMap(se => se.detections || []);
check('every detection inside a batch carries source',
  dets.length > 0 && dets.every(d => d.source === 'sim'),
  'batch-level tagging is not enough: a mixed site puts real and simulated detections in one tick');
check('detections still carry position',
  dets.every(d => typeof d.lat === 'number' && typeof d.lon === 'number'),
  'position is what the live track assembler will consume');

console.log('\nLive provenance is stamped on arrival, never trusted from the wire');
check('the websocket source overwrites source on every inbound batch',
  /batch\.source = 'live';/.test(readFileSync(join(REPO, 'src/nn_source.js'), 'utf8')),
  'a field node cannot be allowed to declare its own data simulated');
check('it stamps every detection inside that batch too',
  /for \(const det of \(se\.detections \|\| \[\]\)\) det\.source = 'live';/
    .test(readFileSync(join(REPO, 'src/nn_source.js'), 'utf8')));

console.log('\nEvents, samples and dispatches carry it too');
check('events default to sim in the module that owns event writes',
  /if \(!event\.source\) event\.source = 'sim';/.test(events),
  'set once on creation so no caller can forget and no default can drift');
check('recording samples carry source',
  /source: 'sim',\s*\n\s*\};\s*\n\s*\}/.test(main) || /detection_state: detState,[\s\S]{0,1200}?source: 'sim',/.test(main),
  'samples carry synthesised RF, acoustic and visual evidence and feed the agentic narrative');
check('dispatch units declare where their position comes from',
  /telemetrySource: 'sim',/.test(main));
check('dispatch provenance reaches the permanent record',
  /entry\.telemetrySource = d\.telemetrySource \|\| 'sim';/.test(main),
  'the event mirror is a whitelist, so an unmirrored field never leaves the browser tab');

console.log('\nA responding unit can be tracked instead of simulated');
_resetTelemetryForTest();
let _fix = null;
onDispatchFix(f => { _fix = f; });
const pub = registerTelemetryAdapter('test-agency', { start() {} });

check('an adapter registers by name, like every sibling seam',
  listTelemetryAdapters().includes('test-agency'),
  'nn_source, dispatch_source, escalation_source and cooperative_traffic_source are all keyed registries');
check('an unregistered provider cannot publish',
  publishDispatchFix('nobody', { dispatchId: 'x', lat: 55, lon: 12 }).reason === 'unknown_provider',
  'refusing one is what makes the provider on a payload mean anything');

check('a valid fix is accepted and its position carried through',
  pub({ dispatchId: 'cd-1', lat: 55.618, lon: 12.647, heading: 90 }).status === 'accepted'
  && _fix?.lat === 55.618 && _fix?.heading === 90);
check('an accepted fix names the feed that produced it',
  _fix?.provider === 'test-agency',
  'on a multi-agency incident a bad position must be attributable to one feed, not to "live"');
// The fix below CLAIMS to be simulated. It must come back live anyway.
// Without that claim in the payload the assertion passes against a seam
// that simply forwards whatever the wire said.
check('a fix claiming to be simulated is stamped live anyway',
  pub({ dispatchId: 'cd-1', lat: 55.62, lon: 12.65, source: 'sim' }).status === 'accepted'
  && _fix?.source === 'live',
  'provenance is stamped by the receiving edge. A feed does not get to describe its own data as simulated, '
  + 'or a real incident could be filed as a drill');

for (const [why, bad, expected] of [
  ['0,0 (the classic missing-data sentinel)', { dispatchId: 'cd-1', lat: 0, lon: 0 }, 'null_island'],
  ['a non-finite coordinate', { dispatchId: 'cd-1', lat: NaN, lon: 12 }, 'non_finite_coordinate'],
  ['no dispatch id', { lat: 55, lon: 12 }, 'missing_dispatch_id'],
  ['a coordinate outside the world', { dispatchId: 'cd-1', lat: 120, lon: 12 }, 'coordinate_out_of_range'],
  ['a heading of 720', { dispatchId: 'cd-1', lat: 55, lon: 12, heading: 720 }, 'heading_out_of_range'],
]) {
  const res = pub(bad);
  check(`a fix with ${why} is rejected, not clamped, and says why`,
    res.status === 'rejected' && res.reason === expected,
    'coercing a malformed fix puts a vehicle where it is not, on an operator map, during an incident. '
    + 'A caller that cannot tell which failure it hit cannot act on either');
}

console.log('\n  altitude without a datum is refused rather than guessed');
check('an altitude with no declared datum is rejected',
  pub({ dispatchId: 'cd-1', lat: 55.6, lon: 12.6, alt: 120 }).reason === 'missing_altitude_datum',
  'the renderer treats altitude as metres above ground and real trackers report ellipsoid or sea-level height. '
  + 'Guessing is a silent error the size of the local terrain');
check('an above-ground altitude is applied',
  pub({ dispatchId: 'cd-1', lat: 55.6, lon: 12.6, alt: 120, altDatum: 'agl' }).altitudeApplied === true
  && _fix?.alt === 120);
for (const datum of ['msl', 'ellipsoid']) {
  const res = pub({ dispatchId: 'cd-1', lat: 55.6, lon: 12.6, alt: 120, altDatum: datum });
  check(`a ${datum} altitude is accepted but not applied until there is a conversion`,
    res.status === 'accepted' && res.altitudeApplied === false
    && _fix?.alt === null && _fix?.altRaw === 120 && _fix?.altDatum === datum,
    'the position is still good. Dropping only the altitude is a visible gap rather than a silent error');
}

console.log('\n  a bad feed is visible and cannot take the loop down');
const st = telemetryStats('test-agency');
check('rejections are counted per provider, with reasons',
  st.rejected === 6 && st.reasons.null_island === 1 && st.reasons.missing_altitude_datum === 1,
  'one aggregate counter cannot tell you which agency feed is the broken one');
check('a listener that throws does not stop delivery',
  (() => {
    _resetTelemetryForTest();
    let reached = false;
    onDispatchFix(() => { throw new Error('boom'); });
    onDispatchFix(() => { reached = true; });
    registerTelemetryAdapter('t2', { start() {} })({ dispatchId: 'cd-2', lat: 55.6, lon: 12.6 });
    return reached;
  })());
_resetTelemetryForTest();

console.log('\n  a real position survives the simulation');
// BEHAVIOURAL, not a regex against the source. The first version of
// this gate asserted the shape of the guard in main.js and passed while
// the behaviour was false: the guard covered one movement state out of
// four and a separate altitude block overwrote live altitude every
// frame regardless. Assert the outcome instead.
{
  const unit = { telemetrySource: 'sim', curLat: 55.0, curLon: 12.0, curAlt: 60, heading: 0 };
  _resetTelemetryForTest();
  onDispatchFix(f => applyFixToUnit(unit, f));
  registerTelemetryAdapter('t3', { start() {} })(
    { dispatchId: 'u1', lat: 55.618, lon: 12.647, alt: 120, altDatum: 'agl' });
  check('a fix flips the unit to live and writes its position', unit.telemetrySource === 'live' && unit.curLat === 55.618);

  // Everything the tick loop does to a unit it believes it is flying.
  unit.curLat = 1; unit.curLon = 1; unit.curAlt = 999; unit.heading = 3;
  const wrote = reassertLivePosition(unit);
  check('simulated movement is overwritten by the real position',
    wrote && unit.curLat === 55.618 && unit.curLon === 12.647,
    'the tick writes position from four states. Re-asserting after it is what makes this hold for physics nobody has written yet');
  check('simulated altitude is overwritten too', unit.curAlt === 120,
    'a separate block interpolates altitude ahead of every movement branch');

  // A unit nobody is tracking must be left entirely alone.
  const simUnit = { telemetrySource: 'sim', curLat: 7, curLon: 8 };
  check('a simulated unit is untouched by the authority pass',
    reassertLivePosition(simUnit) === false && simUnit.curLat === 7,
    'no feed means nothing changes, which is why wiring this cannot disturb the simulation environment');
}

console.log('\n  a feed that goes quiet fails safe');
{
  const unit = { telemetrySource: 'sim' };
  applyFixToUnit(unit, { dispatchId: 'u2', lat: 55.6, lon: 12.6, receivedAt: new Date(1000000).toISOString() });
  check('a fresh fix is not stale', isTelemetryStale(unit, 1000000 + 1000) === false);
  // Absolute, not TELEMETRY_STALE_SEC + 5. Measuring against the
  // constant makes the assertion a tautology that moves with it, and a
  // threshold raised to effectively never would stay green.
  check('a unit silent for five minutes is stale',
    isTelemetryStale(unit, 1000000 + 300 * 1000) === true,
    'a frozen unit reading as still en route wedges the event open and lets the record claim it lost its target');
  check('the staleness threshold is an operationally sane duration',
    TELEMETRY_STALE_SEC >= 30 && TELEMETRY_STALE_SEC <= 300,
    'too short and a normal reporting gap flags a healthy unit; too long and a dead feed holds an event open');
  check('a simulated unit is never stale', isTelemetryStale({ telemetrySource: 'sim' }, 9e12) === false);
}

console.log('\n  heading is derived when the feed omits it');
{
  const unit = { telemetrySource: 'sim' };
  applyFixToUnit(unit, { dispatchId: 'u3', lat: 55.0, lon: 12.0 });
  applyFixToUnit(unit, { dispatchId: 'u3', lat: 55.1, lon: 12.0 });   // due north
  check('heading comes from the bearing between consecutive fixes',
    Math.abs(unit.heading) < 0.01,
    'a tracker reporting position but not heading is common, and the airframe would otherwise point at its dispatch bearing all incident');
}
_resetTelemetryForTest();

console.log('\n  wiring in src/main.js');
check('the authority pass runs after every dispatch tick',
  /_tickCounterDispatch\(d, now\);[\s\S]{0,900}?reassertLivePosition\(d\)/.test(main),
  're-asserting before the tick rather than after would be overwritten by it');
check('simulated battery does not order a real vehicle home',
  /if \(d\.enduranceMin && !_telemetryIsLive\(d\)/.test(main),
  'its endurance is a real quantity this platform does not observe');
check('simulation envelope limits are not applied to a real position',
  /if \(!_telemetryIsLive\(d\)\n\s*&& \(d\.state === 'en_route' \|\| d\.state === 'engaging'\) && d\.profile\.supportsRTB/.test(main),
  'a real helicopter legitimately 30 km out would otherwise be turned around');
check('a stale live unit does not block an event from closing',
  /c\.telemetryStale === true/.test(main));
check('the seam is reachable from the running application',
  /window\.__isr_dispatchFix = _consoleFix;/.test(main)
  && /registerTelemetryAdapter\('console'/.test(main),
  'otherwise the only consumer is this gate and the live path never executes in a browser');
check('the feed that produced a position reaches the permanent record',
  /entry\.telemetryProvider = d\.telemetryProvider \|\| null;/.test(main),
  'the event mirror is a whitelist, so an unmirrored field never leaves the browser tab');
check('a fix writes position but never state',
  (() => {
    const m = main.match(/onDispatchFix\(\(fix\) => \{[\s\S]*?\n  \}\);/);
    return !!m && !/\bstate\b/.test(m[0]);
  })(),
  'arrival and stand-down stay derived from geometry so one state machine serves both environments');
check('a fix for an unknown dispatch is ignored, not an error',
  (() => {
    const m = main.match(/onDispatchFix\(\(fix\) => \{[\s\S]*?\n  \}\);/);
    return !!m && /if \(!d\) return;/.test(m[0]);
  })(),
  'anchored inside the subscriber. The bare pattern appears six times in main.js and matched regardless');

console.log('\nA recorded sample describes its own scenario, not a constant');
// The signature fields used to be hardcoded: always 'DJI OcuSync',
// always 0.89, always 20 MHz. source: 'sim' was honest about the value
// being simulated, but a provenance tag does not make a wrong value
// right, and a cruise missile with no emitter exported as a consumer
// datalink.
{
  const { signatureFieldsFromEvidence, carrierMhzFrom, matchFrom } =
    await import('../src/evidence_signature.js');

  const missile = signatureFieldsFromEvidence({ rfCarrier: 'Passive, no active emitter' });
  check('a passive track exports no carrier frequency rather than zero',
    missile.rf_carrier_mhz === null && missile.rf_passive === true,
    'a zero renders as "0 MHz" on an operator panel, which claims a measurement that does not '
    + 'exist and hides passive detection, which is a capability rather than a gap');
  // The case that makes the passive guard load-bearing. Passive
  // coherent location works BY reading someone else's transmitter, so
  // a passive carrier string can legitimately name a frequency that
  // the tracked object is not emitting. Parsing it out would attribute
  // a broadcast tower's carrier to the aircraft.
  check('a passive carrier that names a frequency still exports none',
    carrierMhzFrom('Passive, no active emitter, tracked via 1090 MHz reflection') === null,
    'the frequency belongs to the illuminator, not to the object being tracked');
  check('a passive track exports no signature match',
    missile.rf_match_signature === null,
    'it emitted nothing. There is no signature to have matched');

  const quad = signatureFieldsFromEvidence({
    rfCarrier: '2.412 GHz', rfBandwidth: '20 MHz OFDM', rfMatch: 'OcuSync 91%',
  });
  check('an authored match becomes a signature and a confidence',
    quad.rf_match_signature === 'OcuSync' && quad.rf_match_confidence === 0.91);
  check('an authored bandwidth and modulation are carried through',
    quad.rf_bandwidth_mhz === 20 && quad.rf_carrier_type === 'OFDM');

  check('a match with no stated confidence does not get one invented',
    matchFrom('SAS743 A320neo, flight plan match').confidence === null,
    'the person who wrote the scenario deliberately did not state one');
  check('a compound carrier keeps its text alongside the number',
    signatureFieldsFromEvidence({ rfCarrier: 'Ku band SATCOM (12.5 GHz) + PCL from DVB T reflection' })
      .rf_carrier_text.includes('PCL'),
    'reducing it to one number loses what it says');
  check('an undescribed field comes out null rather than defaulted',
    (() => {
      const bare = signatureFieldsFromEvidence({ rfCarrier: '433 MHz LoRa telemetry' });
      return bare.rf_bandwidth_mhz === null && bare.rf_match_confidence === null;
    })(),
    'a constant standing in for an unobserved value is the whole thing being removed here');
  check('no signature constant survives in the sample builder',
    !/rf_match_signature: 'DJI OcuSync'/.test(main)
    && !/rf_match_confidence: 0\.89/.test(main)
    && !/rf_bandwidth_mhz: 20,/.test(main),
    'these five scenarios each describe a different emitter, and one constant described them all');
  check('the sample builder reads the scenario evidence',
    /signatureFieldsFromEvidence\(event\.evidence\)/.test(main));
  check('the export carries the authored carrier text and the passive flag',
    /'rf_carrier_text', 'rf_passive', 'modality',/.test(main),
    'added alongside the numeric columns, not replacing them');
}

console.log('\nProvenance leaves the building with the evidence');
check('the trajectory export includes source',
  /'event_id', 'site_id', 'detection_state', 'sensors_detecting',[\s\S]{0,400}?'source',/.test(main),
  'a CSV handed to an agency that cannot say whether a row was observed or simulated is not evidence');

if (failures) {
  console.error(`\n✗ Provenance gate failed: ${failures} assertion(s).\n`);
  process.exit(1);
}
console.log('\n✓ Provenance gate satisfied.\n');
