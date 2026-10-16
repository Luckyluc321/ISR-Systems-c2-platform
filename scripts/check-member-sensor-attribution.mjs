// Gate: a sensor is attributed to the AIRFRAME it observed, never to
// the formation the airframe belongs to.
//
// WHY THIS EXISTS. contributingSensors was one array per EVENT, and the
// swarm tick wrote into it five times per frame: once for the lead
// (src/main.js, inside the `if (p.visible)` branch) and once per wingman
// inside the swarm loop. Every writer MAX-merged into the same list, so
// the instant any one member crossed into a ring, that sensor was
// credited with holding the whole case and there was no per-member list
// anywhere that could disagree. Clicking DRONE-4 in the roster showed
// DRONE-1's sensors because there was only ever one list.
//
// It was worse than a union, in two ways that no other gate can see:
//
//   1. THE DECAY BASELINE DEPENDED ON CALL ORDER. The per-tick decay
//      ran on the FIRST call for the event in a tick and every later
//      call could only raise values. So which airframe's geometry set
//      the floor was whoever the loop reached first.
//
//   2. A MEMBER WHOSE CALL IS SKIPPED KEPT ITS SENSORS. The lead's call
//      is skipped while it is neutralised and the whole `p.visible`
//      branch is skipped once its trajectory completes, while the
//      wingman loop sits OUTSIDE that branch and keeps running. Nothing
//      then decayed the lead's contribution, so sensors held up by a
//      wingman read as holding a lead that had stopped being evaluated.
//
// And the member confidence in the roster was computed from the case
// union's mass, so a member held by one weak sensor printed the number
// of a member held by four.
//
// None of that is visible to a build, to check:undeclared or to
// check:event-mutations: the code ran, the panel filled, and the only
// symptom was a number that was confidently wrong.
//
// This gate has two halves.
//
//   STATIC   the attribution contract in the source text: the writer
//            takes a member key, both tick call sites pass one, decay /
//            geometry floor / batch merge all act on the member's own
//            bucket, the case union is DERIVED from the buckets, and
//            member confidence reads member mass.
//
//   LIVE     the real functions, extracted from the file under test and
//            run against the real site manifests and the real CPH
//            5-drone swarm template. Proves per-member attribution on
//            actual geometry rather than on the presence of a keyword.
//
// A path argument exists so the gate can be pointed at a deliberately
// broken copy and shown to fail. A gate nobody has seen fail is a
// decoration.
//
//   node scripts/check-member-sensor-attribution.mjs [path/to/main.js]

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { SITES } from '../src/sites_registry.js';
import { TEMPLATES } from '../src/drones.js';
import { MockNnOutputSource } from '../src/nn_source.js';

const FILE = process.argv[2] ?? 'src/main.js';
const main = fs.readFileSync(FILE, 'utf8');

let failures = 0;
function check(label, ok, why) {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${why ? `\n       ${why}` : ''}`);
}

// Whitespace and line breaks are formatting, not contract.
const flat = (s) => s.replace(/\s+/g, ' ').trim();

// ── Extract one top-level helper from the file under test ────────────
// Every function this gate cares about is declared at two-space indent
// inside main()'s body, so the closing brace is the next line that is
// exactly "  }". Indentation rather than brace counting, because brace
// counting needs a tokeniser to survive the braces inside this file's
// template literals and regexes.
const lines = main.split('\n');
function extract(name) {
  const start = lines.findIndex(l => l.startsWith(`  function ${name}(`));
  if (start === -1) throw new Error(`could not find "  function ${name}(" in ${FILE}`);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '  }') return lines.slice(start, i + 1).join('\n');
  }
  throw new Error(`could not find the closing brace of ${name} in ${FILE}`);
}

// ═══════════════════════════════════════════════════════════════════
// STATIC — the attribution contract, in the source text
// ═══════════════════════════════════════════════════════════════════
console.log('A sensor is attributed to one airframe');

const writer = extract('_updateContributingSensorsForPosition');
const batcher = extract('_applyDetectionBatchToEvent');
const recompute = extract('_recomputeEventContributingSensors');
const memberQ = extract('_evidenceQForMember');
const fused = extract('_fusedMemberConfidence');
const target = extract('_fusedTarget');

check('the position writer takes a member key',
  /function _updateContributingSensorsForPosition\(event, lat, lon, altM, memberKey\)/.test(writer),
  'without it there is nothing to attribute the observation to');

check('the detection batch merge takes a member key',
  /function _applyDetectionBatchToEvent\(batch, targetEvent, memberKey\)/.test(batcher));

check('the writer resolves exactly one bucket for the position it was given',
  /_memberSensorBucket\(targetEvent, _mk\)/.test(writer),
  'one call, one position, one airframe, one bucket');

check('that bucket comes from the caller\'s member key',
  /const _mk = memberKey \|\| _MEMBER_SENSORS_UNATTRIBUTED;/.test(writer),
  'pinning _mk to one value is the original defect wearing the new shape: '
  + 'every member writing into one list again');

// DECAY IS NOT ATTRIBUTED, RAISING IS.
//
// Ageing is a function of time and time passes for an airframe whether
// or not the tick called this for it, so the decay pass may not sit
// behind the member's own call: the lead's call is guarded while it is
// neutralised and the whole p.visible branch is skipped once a
// trajectory completes, and a bucket that is only aged by its own call
// then freezes at its last value for the rest of the case. One pass,
// once per event per tick, over every bucket. The live half below is
// what actually proves it.
check('decay runs once per event per tick, over every bucket',
  /if \(targetEvent\._contribTickSeq !== tickSeq\)/.test(writer)
  && /for \(const _bk of Object\.keys\(targetEvent\.memberSensors\)\)/.test(writer),
  'behind the member\'s own call, a member that stops being evaluated '
  + 'never ages out');

check('decay acts on the buckets, not on the case union',
  /for \(const existing of targetEvent\.memberSensors\[_bk\]\)/.test(writer)
  && !/for \(const existing of targetEvent\.contributingSensors\)/.test(writer),
  'decaying the union is what let one member hold another up');

check('the prune acts on the buckets',
  /targetEvent\.memberSensors\[_bk\] = targetEvent\.memberSensors\[_bk\]\s*\n?\s*\.filter\(/.test(writer));

check('the union is rebuilt after the buckets age',
  /_recomputeEventContributingSensors\(targetEvent\);/.test(writer));

check('the geometry floor raises the member bucket, not the case union',
  /const _entry = _memberList\.find\(c => c\.id === _s\.id\)/.test(writer)
  && !/const _entry = targetEvent\.contributingSensors\.find/.test(writer),
  'the distance in that loop is the distance to THIS position, so applying '
  + 'it to the union credits the nearest airframe\'s range to every member');

check('the geometry floor still refuses to invent an entry',
  /if \(!_entry \|\| _entry\.offline\) continue;/.test(writer),
  'a sensor may only appear because a detection source reported it');

check('an offline sensor is still skipped by the floor',
  /if \(_s\.status === 'offline'\) continue;/.test(writer));

check('sensor health still scales the floor',
  /const _hf = _sensorHealth\(_s\);/.test(writer) && /if \(_hf <= 0\) continue;/.test(writer));

check('the batch merge writes into the member bucket',
  /const existing = _bucket\.find\(s => s\.id === sEntry\.sensorId\)/.test(batcher)
  && /_bucket\.push\(\{ id: sEntry\.sensorId/.test(batcher)
  && !/targetEvent\.contributingSensors\.push\(/.test(batcher));

check('the batch merge still drops offline sensors and dead units',
  /if \(sEntry\.status === 'offline'\) continue;/.test(batcher)
  && /if \(_hf <= 0\) continue;/.test(batcher));

check('the case union is DERIVED from the buckets',
  /targetEvent\.contributingSensors = \[\.\.\.merged\.values\(\)\]/.test(recompute)
  && /for \(const bucket of Object\.values\(targetEvent\.memberSensors\)\)/.test(recompute),
  'two independently written stores for one fact drift the first time a '
  + 'writer is missed');

check('the union keeps a case-level view for the strip and the case file',
  /_recomputeEventContributingSensors\(targetEvent\)/.test(batcher),
  'every writer must leave contributingSensors correct without a second call');

check('offline declarations survive a union rebuild',
  /if \(prev\?\.offline\) merged\.set\(prev\.id, \{ \.\.\.prev \}\)/.test(recompute),
  'offline is a statement about the sensor, not an observation of a target, '
  + 'and the historical events in events.js carry them');

check('member mass is the member\'s own bucket',
  /const bucket = store\[memberKey\]/.test(memberQ)
  && /mass \/ _FUSION_SATURATION_MASS/.test(memberQ));

check('a member with a store but an empty bucket scores zero, not the union\'s',
  /if \(!Array\.isArray\(bucket\)\) return 0;/.test(memberQ),
  'borrowing the formation\'s mass is the defect this replaces');

check('an event with no per-member store falls back to the case union',
  /if \(!store \|\| !memberKey\) return _evidenceQ\(event\);/.test(memberQ),
  'single-platform events and the historical events in events.js have none');

check('member confidence is driven by member mass',
  /_evidenceQForMember\(event, memberKey \?\? _memberKeyForSlot\(event, slotIdx\)\)/.test(fused),
  'reading _evidenceQ(event) here is what printed one number five times');

check('the unsmoothed target is driven by member mass too',
  /_evidenceQForMember\(event, memberKey \?\? _memberKeyForSlot\(event, slotIdx\)\)/.test(target),
  'smoothing a case-level target is still a case-level answer');

console.log('\nBoth tick call sites name the airframe they are about');

// The lead's call lives in the p.visible branch; the wingman's in the
// swarm loop. Anchored on the surrounding guards so a moved call site
// is caught rather than silently matched somewhere else.
const leadCall = /if \(!state\.leadSwarmMember\?\.neutralised\) \{\s*_updateContributingSensorsForPosition\(event, p\.lat, p\.lon, p\.alt,\s*state\.leadSwarmMember\?\.memberId \|\| _memberKeyForSlot\(event, 0\)\);/;
check('the lead passes its own member id', leadCall.test(main),
  'p is the lead airframe\'s position and nothing else\'s');

const wingCall = /_updateContributingSensorsForPosition\(event, pos\.lat, pos\.lon, pos\.alt,\s*sw\.memberId \|\| _memberKeyForSlot\(event, i \+ 1\)\);/;
check('each wingman passes its own member id', wingCall.test(main));

check('no tick call site omits the member key',
  [...main.matchAll(/_updateContributingSensorsForPosition\(([^;]*?)\);/gs)]
    .every(m => m[1].split(',').length >= 5),
  'a four-argument call files a sim position as unattributed');

check('the lead\'s roster confidence is scoped to the lead',
  /_fusedMemberConfidence\(\s*event, state, 0,[\s\S]{0,220}?state\.leadSwarmMember\?\.memberId \|\| _memberKeyForSlot\(event, 0\)\)/.test(main));

check('each wingman\'s roster confidence is scoped to that wingman',
  /_fusedMemberConfidence\(event, state, i \+ 1, _isRogue,\s*sw\.memberId \|\| _memberKeyForSlot\(event, i \+ 1\)\)/.test(main));

console.log('\nThe operator can see which sensors hold the focused airframe');

check('the panel renders a per-member sensor section',
  /data-live-member-sensors="1" data-member-key="\$\{_key\}"/.test(main));

check('that section is keyed off the FOCUSED member, not the lead',
  /_idx === 0\s*\n?\s*\? _st\.leadSwarmMember\?\.memberId\s*\n?\s*: _st\.swarmBillboards\?\.\[_idx - 1\]\?\.memberId/.test(main));

check('the case-level section is kept alongside it',
  /Contributing Sensors · \$\{e\.contributingSensors\.filter/.test(main),
  'the alert strip and the case file need the union');

check('the per-member section is live-patched, not only full-rendered',
  /_memberSensorRowsHtml\(event, _key\)/.test(main)
  && /\[data-live-member-sensors="1"\]/.test(main),
  'the hover gate blocks the full render, so a sensor acquiring an '
  + 'airframe while the pointer is on the panel would not appear until '
  + 'the operator clicked something');

check('a change in the case union\'s membership forces a full render',
  /_caseSection\.dataset\.sensorSig !== _sigNow/.test(main),
  'the rows carry an id and a value and nothing else, so there is '
  + 'nothing to patch when the SET changes');

check('each member carries its own sensor count and mass on its stats',
  /sensorCount: 0, sensorMass: 0,/.test(main)
  && /sw\.stats\.sensorCount = _own\.filter/.test(main)
  && /sensorCount: \(\(\) => \{/.test(main),
  'the roster reads this per row; recomputing it per row per frame '
  + 'would walk the buckets five times a tick for nothing');

check('the roster row says how many sensors hold that airframe',
  /title="\$\{_rosterRowTitle\(d\)\}"/.test(main)
  && /held by \$\{n\} sensor/.test(main),
  'a tooltip, not an eleventh grid column: widening the roster grid '
  + 'reflows every row');

check('the roster tooltip is live-patched too',
  /if \(row\.title !== _t\) row\.title = _t;/.test(main));

check('the audit handle reports per member',
  /const store = ev\.memberSensors;/.test(main)
  && /PER MEMBER/.test(main),
  '__isr_sensorAudit is how this gets confirmed in the browser');

check('the audit no longer claims members must share one list',
  !/two members of a swarm must always show the same\s*\n?\s*\/\/ list/.test(main)
  && /THIS NOTE USED TO SAY THE OPPOSITE/.test(main));

// ═══════════════════════════════════════════════════════════════════
// LIVE — the real functions, on the real geometry
// ═══════════════════════════════════════════════════════════════════
console.log('\nThe real attribution code, on the real CPH swarm geometry');

const HARNESS = `
const SITES = __d.SITES;
const haversineM = __d.haversineM;
const monoNow = __d.monoNow;
const wallNow = __d.wallNow;
const _getNnSourceFor = __d.getSourceFor;
const getEvent = __d.getEvent;
const _CONF_HALF_LIFE_MS = ${/const _CONF_HALF_LIFE_MS = (\d+);/.exec(main)?.[1] ?? 1500};
const _FUSION_SATURATION_MASS = ${/const _FUSION_SATURATION_MASS = (\d+);/.exec(main)?.[1] ?? 5};
const _MEMBER_SENSORS_UNATTRIBUTED = ${/const _MEMBER_SENSORS_UNATTRIBUTED = ('[^']+');/.exec(main)?.[1] ?? "'_event'"};
let _contribTickSeq = 0;
${extract('_sensorHealth')}
${extract('_sensorCeilingM')}
${extract('_sensorSeesPoint')}
${extract('_sitesSeeingPoint')}
${extract('_findGroupEventForSite')}
${extract('_memberKeyForSlot')}
${extract('_memberSensorBucket')}
${extract('_memberSensorsFor')}
${extract('_recomputeEventContributingSensors')}
${extract('_evidenceQ')}
${extract('_evidenceQForMember')}
${extract('_updateContributingSensorsForPosition')}
${extract('_applyDetectionBatchToEvent')}
export const api = {
  bumpTick: () => { _contribTickSeq++; },
  update: _updateContributingSensorsForPosition,
  memberSensorsFor: _memberSensorsFor,
  evidenceQForMember: _evidenceQForMember,
  evidenceQ: _evidenceQ,
};
`;

function hav(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// A real MockNnOutputSource per site, exactly as nn_registry builds one.
const _srcCache = new Map();
const getSourceFor = (siteId) => {
  if (!_srcCache.has(siteId)) {
    const s = new MockNnOutputSource(siteId);
    s.start();
    _srcCache.set(siteId, s);
  }
  return _srcCache.get(siteId);
};

let _fakeMs = 0;
const EV = {
  id: 'GATE-0001', siteId: 'cph', status: 'active',
  contributingSensors: [], linkedEventIds: [],
};
globalThis.__d = {
  SITES, haversineM: hav, monoNow: () => _fakeMs, wallNow: () => _fakeMs,
  getSourceFor, getEvent: (id) => (id === EV.id ? EV : null),
};

const tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'isr-member-sensors-'));
const tmpFile = path.join(tmpDir, 'harness.mjs');
fs.writeFileSync(tmpFile, HARNESS, 'utf8');
let api;
try {
  ({ api } = await import(pathToFileURL(tmpFile).href));
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* nothing */ }
}

const T = TEMPLATES.cph_swarm_runway_incursion;
const N23 = SITES.cph.sensors.find(s => s.id === 'N23');
const N24 = SITES.cph.sensors.find(s => s.id === 'N24');

// Two positions on the real ingress leg, 1.4 km apart along track: the
// first is inside N24 and outside N23, the second is inside both. One
// stands in for the lead, the other for a wingman that is still behind.
// Chosen by distance rather than by time so the assertion does not move
// if the waypoint timings are retuned.
const LEAD = { lat: 55.63280, lon: 12.66860, alt: 255 };   // t ~ 31 s on the real path
const WING = { lat: 55.63700, lon: 12.67900, alt: 265 };   // the spawn point, 1.5 km out

check('the fixture positions are what the assertions assume',
  hav(LEAD.lat, LEAD.lon, N24.lat, N24.lon) <= N24.coverageRadius
  && hav(LEAD.lat, LEAD.lon, N23.lat, N23.lon) <= N23.coverageRadius
  && hav(WING.lat, WING.lon, N24.lat, N24.lon) > N24.coverageRadius,
  `lead->N24 ${hav(LEAD.lat, LEAD.lon, N24.lat, N24.lon).toFixed(0)} m, `
  + `lead->N23 ${hav(LEAD.lat, LEAD.lon, N23.lat, N23.lon).toFixed(0)} m, `
  + `wing->N24 ${hav(WING.lat, WING.lon, N24.lat, N24.lon).toFixed(0)} m`);

const M0 = `${EV.id}-m0`, M1 = `${EV.id}-m1`;

_fakeMs = 1000;
api.bumpTick();
api.update(EV, LEAD.lat, LEAD.lon, LEAD.alt, M0);
api.update(EV, WING.lat, WING.lon, WING.alt, M1);

const lead0 = api.memberSensorsFor(EV, M0).map(s => s.id).sort();
const wing0 = api.memberSensorsFor(EV, M1).map(s => s.id).sort();

check('the member in coverage has its own sensors', lead0.includes('N23') && lead0.includes('N24'),
  `got ${JSON.stringify(lead0)}`);
check('the member still outside coverage has none of them',
  !wing0.includes('N23') && !wing0.includes('N24'),
  `the trailing airframe was credited with ${JSON.stringify(wing0)}`);
check('the two members do not share one list', JSON.stringify(lead0) !== JSON.stringify(wing0));

check('the case union is the union of the members',
  EV.contributingSensors.some(s => s.id === 'N23') && EV.contributingSensors.some(s => s.id === 'N24'),
  'the alert strip and the case file still need "which sensors hold this case"');

check('the union carries the best value any member earned',
  EV.contributingSensors.every(u => {
    const best = Math.max(
      ...Object.values(EV.memberSensors).flat()
        .filter(b => b.id === u.id).map(b => b.confidence || 0), 0);
    return Math.abs((u.confidence || 0) - best) < 1e-9;
  }));

check('the member in coverage scores off its own mass, not the union\'s',
  api.evidenceQForMember(EV, M0) > 0 && api.evidenceQForMember(EV, M1) === 0,
  `m0 q=${api.evidenceQForMember(EV, M0).toFixed(3)}, m1 q=${api.evidenceQForMember(EV, M1).toFixed(3)}`);

check('the case-level q is still the union\'s', api.evidenceQ(EV) >= api.evidenceQForMember(EV, M0));

// Now the asymmetry that made this reproducible: stop calling for the
// lead, exactly as the tick does once the lead is neutralised or its
// trajectory completes, and keep calling for the wingman. The lead's
// sensors must age out of the LEAD's list rather than being held up by
// the wingman that is now inside the same rings.
const leadConfBefore = api.memberSensorsFor(EV, M0).find(s => s.id === 'N24')?.confidence || 0;
for (let k = 0; k < 10; k++) {
  _fakeMs += 400;
  api.bumpTick();
  api.update(EV, LEAD.lat, LEAD.lon, LEAD.alt, M1);   // the WINGMAN is here now
}
const leadConfAfter = api.memberSensorsFor(EV, M0).find(s => s.id === 'N24')?.confidence || 0;

check('a member that stopped being observed decays on its own clock',
  leadConfAfter < leadConfBefore * 0.3,
  `N24 held the lead at ${leadConfBefore.toFixed(3)} and still reads `
  + `${leadConfAfter.toFixed(3)} after 4 s of the lead not being evaluated. `
  + `A per-event decay clock is what lets another member hold it up.`);

check('the member that IS observed reads strongly on the same sensor',
  (api.memberSensorsFor(EV, M1).find(s => s.id === 'N24')?.confidence || 0) > 0.3);

check('peak confidence is still monotonic per member',
  (api.memberSensorsFor(EV, M0).find(s => s.id === 'N24')?.peakConfidence || 0) >= leadConfBefore,
  'the closed-case summary and the PDF read peak, not current');

check('an unattributed batch still reaches the case union',
  (() => {
    const ev2 = { id: 'GATE-0002', siteId: 'cph', status: 'active', contributingSensors: [], linkedEventIds: [] };
    globalThis.__d.getEvent = (id) => (id === ev2.id ? ev2 : (id === EV.id ? EV : null));
    _fakeMs += 400;
    api.bumpTick();
    api.update(ev2, LEAD.lat, LEAD.lon, LEAD.alt, undefined);
    return Object.keys(ev2.memberSensors).includes('_event')
      && ev2.contributingSensors.some(s => s.id === 'N24');
  })(),
  'a real field node reports a detection, not a formation slot');

if (failures) {
  console.log(`\ncheck:member-sensors FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:member-sensors passed');
