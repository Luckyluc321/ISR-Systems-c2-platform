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
check('a valid fix is accepted and its position carried through',
  publishDispatchFix({ dispatchId: 'cd-1', lat: 55.618, lon: 12.647, heading: 90 }) === true
  && _fix?.lat === 55.618 && _fix?.heading === 90);
// The fix below CLAIMS to be simulated. It must come back live anyway.
// Without that claim in the payload the assertion passes against a seam
// that simply forwards whatever the wire said.
check('a fix claiming to be simulated is stamped live anyway',
  publishDispatchFix({ dispatchId: 'cd-1', lat: 55.62, lon: 12.65, source: 'sim' }) === true
  && _fix?.source === 'live',
  'provenance is stamped by the receiving edge. A feed does not get to describe its own data as simulated, '
  + 'or a real incident could be filed as a drill');
for (const [why, bad] of [
  ['0,0 (the classic missing-data sentinel)', { dispatchId: 'cd-1', lat: 0, lon: 0 }],
  ['a non-finite coordinate', { dispatchId: 'cd-1', lat: NaN, lon: 12 }],
  ['no dispatch id', { lat: 55, lon: 12 }],
  ['a coordinate outside the world', { dispatchId: 'cd-1', lat: 120, lon: 12 }],
]) {
  check(`a fix with ${why} is rejected, not clamped`, publishDispatchFix(bad) === false,
    'coercing a malformed fix puts a vehicle where it is not, on an operator map, during an incident');
}
check('rejections are counted rather than thrown',
  telemetryStats().rejected === 4 && telemetryStats().accepted === 2,
  'a telemetry stream must not be able to take down the tick loop, and a stream quietly producing rubbish must be visible');
check('a listener that throws does not stop delivery',
  (() => {
    _resetTelemetryForTest();
    let reached = false;
    onDispatchFix(() => { throw new Error('boom'); });
    onDispatchFix(() => { reached = true; });
    publishDispatchFix({ dispatchId: 'cd-2', lat: 55.6, lon: 12.6 });
    return reached;
  })());
_resetTelemetryForTest();

console.log('\n  wiring in src/main.js');
check('a live unit is not moved by simulated physics',
  /if \(_telemetryIsLive\(d\)\) \{/.test(main),
  'the tick would otherwise overwrite the real position every frame');
check('climb physics also stands down for a live unit',
  /if \(isSimEvent && !_telemetryIsLive\(d\) && d\.profile\.airborne && physics\)/.test(main));
check('the simulation path is a separate branch, not a rewrite',
  /\} else if \(d\.routePositions && d\.routeSegmentLengths\) \{/.test(main),
  'the road-following and straight-line branches are what every scenario runs through');
check('a fix writes position but never state',
  (() => {
    const m = main.match(/onDispatchFix\(\(fix\) => \{[\s\S]*?\n  \}\);/);
    return !!m && /d\.curLat = fix\.lat;/.test(m[0]) && !/d\.state\s*=/.test(m[0]);
  })(),
  'arrival and stand-down stay derived from geometry so one state machine serves both environments');
check('a fix for an unknown dispatch is ignored, not an error',
  /if \(!d\) return;/.test(main));

console.log('\nProvenance leaves the building with the evidence');
check('the trajectory export includes source',
  /'event_id', 'site_id', 'detection_state', 'sensors_detecting',[\s\S]{0,400}?'source',/.test(main),
  'a CSV handed to an agency that cannot say whether a row was observed or simulated is not evidence');

if (failures) {
  console.error(`\n✗ Provenance gate failed: ${failures} assertion(s).\n`);
  process.exit(1);
}
console.log('\n✓ Provenance gate satisfied.\n');
