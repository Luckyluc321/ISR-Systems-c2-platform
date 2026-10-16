#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Live sensor gate — the first real node plugs into the contract,
// not around it
// ───────────────────────────────────────────────────────────────────
// src/live_sensor.js registers a real HackRF node as a sensor, draws
// the same symbol every other sensor uses, and opens detections
// through the same batch fold the simulation uses. The things that
// would silently break the demo or the audit trail:
//
//   - a live sensor record that does not look like a manifest sensor,
//     so a coverage predicate or the popup trips over it
//   - a radius that drifted from the hardcoded 1 km figure
//   - a detection or event that does not carry source: 'live'
//   - a BACKGROUND frame treated as a detection (the C2 classifying)
//   - a symbol spec that drifted from renderSite in main.js
//   - a live event that gains a droneState entry and so escapes the
//     unobserved-event sweeper that is supposed to close it
//   - the console handles not wired, which is the whole demo
//
// Behavioural where the behaviour is reachable under Node; a regex
// against main.js only where the thing being asserted is wiring.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { SITES } from '../src/sites_registry.js';
import { EVENTS, addEvent, getEvent, mutateEvent, addNote, nextEventId, closeEvent } from '../src/events.js';
import {
  LIVE_SOURCE, LIVE_FEED_ID, nearestSiteId, registerLiveSensor, buildLiveSensorRecord,
  liveSensorRejectionReason, liveSensorEntitySpec, liveSensorCoverageSpec,
  normaliseDetection, liveDetectionRejectionReason, buildLiveDetectionBatch,
  buildLiveEvent, createLiveSensorRuntime,
} from '../src/live_sensor.js';
import { LIVE_FEEDS, initLiveFeeds } from '../src/sovereign_live_feeds.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(REPO, 'src/main.js'), 'utf8');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

// A disposable copy of the registry so this gate never mutates what
// other gates import in the same process.
const sites = structuredClone(SITES);
const siteIds = Object.keys(sites);
const siteId = siteIds.includes('cph') ? 'cph' : siteIds[0];
const site = sites[siteId];
const manifestSensor = site.sensors[0];

console.log('\nA live sensor looks exactly like a manifest sensor');
const lat = site.coordinates.lat + 0.001, lon = site.coordinates.lon + 0.001;
check('the nearest site is resolved from the coordinates',
  nearestSiteId(sites, lat, lon)?.siteId === siteId,
  'an event belongs to a site and is tenant-stamped from it; a sensor with no site opens events nobody can see');
const res = registerLiveSensor(sites, { lat, lon, nodeId: 'radxa-1' });
check('registration succeeds', res.status === 'registered' && res.siteId === siteId);
const live = res.sensor;
for (const k of Object.keys(manifestSensor)) {
  if (['label', 'isCore'].includes(k)) continue;
  check(`field "${k}" present, as on manifest sensor ${manifestSensor.id}`, k in live,
    'every coverage predicate, the popup and the night tint iterate site.sensors and read these fields');
}
check('coverage radius is the hardcoded 1 km figure', live.coverageRadius === 1000,
  'the current sensor generation\'s working figure. Not a parameter, not tunable here');
check('coverage radius cannot be passed in',
  registerLiveSensor(sites, { lat: lat + 0.01, lon, coverageRadius: 50, id: 'TRY' }).sensor.coverageRadius === 1000);
check('the record declares its provenance', live.source === LIVE_SOURCE);
check('status starts online so the symbol is green', live.status === 'online');
check('it is appended to site.sensors', site.sensors.includes(live),
  'that array is what every coverage check and the contributing rings iterate');
check('site counters follow', site.sensorsTotal === SITES[siteId].sensorsTotal + 2
  && site.stats.sensorsOnline === SITES[siteId].stats.sensorsOnline + 2);

console.log('\n  bad placements are refused, and say why');
for (const [why, bad, expected] of [
  ['0,0', { lat: 0, lon: 0 }, 'invalid_coordinate'],
  ['a non-finite coordinate', { lat: NaN, lon: 12 }, 'invalid_coordinate'],
  ['a coordinate off the planet', { lat: 95, lon: 12 }, 'invalid_coordinate'],
  ['an unknown site', { lat, lon, siteId: 'nowhere' }, 'unknown_site'],
  ['a duplicate sensor id', { lat, lon, id: live.id }, 'duplicate_sensor_id'],
]) {
  check(`${why} is rejected`, liveSensorRejectionReason(sites, bad) === expected);
}

console.log('\nThe symbol is the one every other sensor uses');
const stubColor = (css) => ({ css, withAlpha: (a) => ({ css, a }) });
const Cesium = {
  Color: { fromCssColorString: stubColor, WHITE: stubColor('#fff') },
  Cartesian3: { fromDegrees: (lo, la, h) => ({ lo, la, h }) },
  HeightReference: { CLAMP_TO_GROUND: 'CLAMP_TO_GROUND', RELATIVE_TO_GROUND: 'RELATIVE_TO_GROUND' },
  CallbackProperty: class { constructor(fn) { this.fn = fn; } getValue() { return this.fn(); } },
};
const spec = liveSensorEntitySpec(siteId, live, { Cesium, nightNow: false, onlineDay: '#4dff9c', onlineNight: '#5aa9cc' });
const renderSiteBlock = main.slice(main.indexOf('// Sensor dots — clamped to ground'), main.indexOf('// Coverage ring — hidden by default'));
check('renderSite\'s sensor block was found in main.js', renderSiteBlock.length > 200 && renderSiteBlock.length < 4000);
check('same entity id scheme', spec.id === `sensor-${siteId}-${live.id}` && /id: `sensor-\$\{site\.id\}-\$\{sensor\.id\}`/.test(renderSiteBlock));
check('same pixel size rule', spec.point.pixelSize === 8 && /pixelSize: sensor\.isCore \? 11 : 8/.test(renderSiteBlock));
check('same outline rule', spec.point.outlineWidth === 3 && /outlineWidth: sensor\.isCore \? 5 : 3/.test(renderSiteBlock));
check('same outline alpha', spec.point.outlineColor.a === 0.4 && /outlineColor: color\.withAlpha\(0\.4\)/.test(renderSiteBlock));
// Clamping is still the default on both paths. renderSite now reaches it
// through a ternary, because a sensor pinned by __isr_pinSensors must NOT
// also clamp or the clamp overwrites the pin on the next frame. The
// assertion is that clamping is what happens when nothing is pinned, not
// that the line is spelled a particular way.
check('clamped to ground like the others', spec.point.heightReference === 'CLAMP_TO_GROUND'
  && /Cesium\.HeightReference\.CLAMP_TO_GROUND/.test(renderSiteBlock));
// Drawing on top is still the default on both paths. renderSite reaches
// it through _sensorDepthValue() now, because __isr_sensorDepth(true)
// lets scene geometry occlude a marker instead, which is a switch rather
// than a decision. The assertion is the default behaviour, not the
// spelling of the line.
check('depth test disabled like the others', spec.point.disableDepthTestDistance === Infinity
  && /disableDepthTestDistance: (Number\.POSITIVE_INFINITY|_sensorDepthValue\(\))/.test(renderSiteBlock));
check('picked as a sensor by the click handler', spec.properties.type === 'sensor' && spec.properties.sensorId === live.id
  && /type: 'sensor',/.test(renderSiteBlock));
check('repainted by the night tint like the others', spec.properties.online === true && /online: sensor\.status === 'online'/.test(renderSiteBlock));
check('online colour follows day/night', spec.point.color.css === '#4dff9c'
  && liveSensorEntitySpec(siteId, live, { Cesium, nightNow: true, onlineDay: '#4dff9c', onlineNight: '#5aa9cc' }).point.color.css === '#5aa9cc');
check('degraded and offline keep their status colours',
  liveSensorEntitySpec(siteId, { ...live, status: 'degraded' }, { Cesium, nightNow: true, onlineDay: 'x', onlineNight: 'y' }).point.color.css === '#ff8c3d'
  && liveSensorEntitySpec(siteId, { ...live, status: 'offline' }, { Cesium, nightNow: false, onlineDay: 'x', onlineNight: 'y' }).point.color.css === '#ff3838'
  && /'#ff8c3d'/.test(renderSiteBlock) && /'#ff3838'/.test(renderSiteBlock));
const cov = liveSensorCoverageSpec(siteId, live, { Cesium });
check('the hidden coverage ring uses the shared id scheme and radius',
  cov.id === `sensor-cov-${siteId}-${live.id}` && cov.show === false && cov.ellipse.semiMajorAxis === 1000
  && cov.properties.type === 'sensor-coverage');

console.log('\nA detection is the network\'s word, not the platform\'s');
check('a BACKGROUND frame is not a detection',
  liveDetectionRejectionReason(normaliseDetection({ label: 'BACKGROUND', probability: 0.2 })) === 'not_a_detection',
  'the subscriber already applied its threshold. Re-deciding here would make the C2 the classifier');
check('a console call with only a confidence is a DRONE detection',
  liveDetectionRejectionReason(normaliseDetection({ confidence: 0.9 })) === null);
check('bridge field names are accepted', (() => {
  const d = normaliseDetection({ label: 'DRONE', probability: 0.93, node_id: 'radxa-1', frame_seq: 7, capture_ts: 1.5 });
  return d.confidence === 0.93 && d.nodeId === 'radxa-1' && d.frameSeq === 7 && d.captureTs === 1.5;
})());
check('a missing confidence is refused', liveDetectionRejectionReason(normaliseDetection({})) === 'missing_confidence');
check('a confidence outside [0,1] is refused', liveDetectionRejectionReason(normaliseDetection({ confidence: 1.4 })) === 'confidence_out_of_range');

const det = normaliseDetection({ label: 'DRONE', probability: 0.931, node_id: 'radxa-1' });
const batch = buildLiveDetectionBatch(siteId, live, det);
check('the batch is IF-1.4 shaped and site scoped', batch.siteId === siteId && Array.isArray(batch.sensors)
  && batch.sensors[0].sensorId === live.id && batch.sensors[0].status === 'online');
check('batch and detection carry source: live', batch.source === LIVE_SOURCE && batch.sensors[0].detections[0].source === LIVE_SOURCE);
check('the position is the sensor\'s own and says so',
  batch.sensors[0].detections[0].lat === live.lat && batch.sensors[0].detections[0].positionKind === 'sensor-anchor',
  'one sensor gives presence inside its radius, not a fix. SAPIENT range_bearing without a range');

console.log('\nThe event is created through the contract');
const before = EVENTS.length;
const ev = buildLiveEvent({ eventId: nextEventId(), siteId, sensor: live, det });
check('source: live is set explicitly', ev.source === LIVE_SOURCE,
  'addEvent defaults to sim. A live event that forgets would be filed as a drill');
check('detected: true so the sweeper may close it', ev.detected === true);
check('no template, no track flags', ev.templateKey === null && ev.multiSiteTrack === false && ev.coverageGatedTrack === false);
check('confidence is the network probability', ev.confidence === 0.93);
check('posture is unknown, not invented', ev.classification === 'unknown' && ev.threat === 'unknown',
  'threat posture is not network output today');
check('the subject taxonomy resolves to an unclassified track', ev.platform === 'non-identifiable');
addEvent(ev);
const stored = getEvent(ev.id);
check('addEvent keeps it live and stamps the site tenant',
  EVENTS.length === before + 1 && stored?.source === LIVE_SOURCE && stored?.tenantId === SITES[siteId].operatorAccountId);
check('the subject was synced on creation', stored?.subject?.class === 'unclassified_track');
closeEvent(ev.id, null, { autoOutcome: 'lost contact' });

console.log('\nThe runtime: place, detect, refresh, repaint');
const added = [];
const viewer = { entities: { add: (spec) => { added.push(spec); return spec; } } };
const applied = [];
const toasts = [];
const rendered = { strip: 0, panel: 0 };
const rt = createLiveSensorRuntime({
  sites: structuredClone(SITES), viewer, Cesium, events: EVENTS, addEvent, getEvent, mutateEvent, addNote,
  nextEventId, applyDetectionBatch: (b, e) => { applied.push(b); e._lastDetectionTs = 1; },
  selectEvent: () => {}, renderAlertStrip: () => rendered.strip++, renderDetailPanel: () => rendered.panel++,
  toast: (m) => toasts.push(m), ringIcon: () => 'ring', nightNow: () => false,
  colours: { onlineDay: '#4dff9c', onlineNight: '#5aa9cc' }, log: { log() {}, warn() {} },
});
check('a detection before any sensor is refused with a reason', rt.detect({ confidence: 0.9 }).reason === 'no_live_sensor');
const placed = rt.placeSensor(lat, lon, { nodeId: 'radxa-1' });
check('placing adds the dot, the hidden coverage ring and the pulse ring',
  placed.status === 'placed' && added.length === 3
  && added[0].properties.type === 'sensor' && added[1].properties.type === 'sensor-coverage'
  && added[2].properties.type === 'live-sensor-ring');
check('a bad placement is refused, not thrown', rt.placeSensor(0, 0).status === 'rejected');
check('the pulse ring is dark before any detection', added[2].billboard.show.getValue() === false);
const activeBefore = EVENTS.filter(e => e.status === 'active').length;
const first = rt.detect({ confidence: 0.9 });
check('the first DRONE frame opens an event', first.status === 'opened' && EVENTS.filter(e => e.status === 'active').length === activeBefore + 1);
const liveEv = getEvent(first.eventId);
check('the event is live and belongs to the sensor\'s site', liveEv.source === LIVE_SOURCE && liveEv.siteId === siteId);
check('the batch was folded through the injected apply', applied.length === 1 && applied[0].sensors[0].sensorId === placed.sensor.id);
check('the operator saw it: toast + alert strip', toasts.some(t => /DETECTED/.test(t)) && rendered.strip === 1);
check('the pulse ring lights up', added[2].billboard.show.getValue() === true);
const second = rt.detect({ label: 'DRONE', probability: 0.97, node_id: 'typed-differently' });
check('a second frame refreshes the same event, routed to the only live sensor',
  second.status === 'refreshed' && second.eventId === first.eventId && applied.length === 2 && getEvent(first.eventId).confidence === 0.97);
check('a BACKGROUND frame is ignored and opens nothing',
  rt.detect({ label: 'BACKGROUND', probability: 0.1 }).status === 'ignored' && applied.length === 2);
check('the live event never gets a render track',
  !/droneState\.set\(/.test(readFileSync(join(REPO, 'src/live_sensor.js'), 'utf8')),
  '_sweepUnobservedActiveEvents skips events with a droneState entry; a live event must stay under that sweeper');
check('the sweeper closes exactly this shape', /if \(droneState\.has\(ev\.id\)\) continue;/.test(main)
  && /const lastObs = ev\._lastDetectionTs \|\| ev\.spawnTs/.test(main),
  'the close path for a live event is the unobserved-event sweeper in main.js');
const hb = rt.handleFeedMessage({ type: 'heartbeat', node_id: 'radxa-1', label: 'OFFLINE' });
check('an OFFLINE heartbeat repaints the dot red and marks the sensor',
  rt.sensors()[0].status === 'offline' && added[0].point.color.css === '#ff3838' && added[0].properties.online === false);
check('an offline sensor does not pulse', added[2].billboard.show.getValue() === false);
rt.handleFeedMessage({ type: 'status', nodes: { 'radxa-1': { status: 'online' } } });
check('a status message brings it back', rt.sensors()[0].status === 'online' && added[0].point.color.css === '#4dff9c');
rt.handleFeedMessage({ type: 'bridge-closed' });
check('losing the bridge reads as degraded, with the reason on the sensor',
  rt.sensors()[0].status === 'degraded' && /bridge/i.test(rt.sensors()[0].issues));
rt.handleFeedMessage({ type: 'detection', label: 'DRONE', probability: 0.8, node_id: 'radxa-1', frame_seq: 9 });
check('a bridge detection message drives the same detect()', applied.length === 3 && applied[2].sensors[0].detections[0].frameSeq === 9);
closeEvent(first.eventId, null, { autoOutcome: 'lost contact' });

console.log('\nThe bridge feed');
const entry = LIVE_FEEDS.find(f => f.id === LIVE_FEED_ID);
check('the feed is registered in sovereign_live_feeds.js', !!entry && entry.enabledByDefault === false);
check('its provider reads VITE_ISR_SENSOR_WS_URL', entry?.providers?.bridge?.urlEnv === 'VITE_ISR_SENSOR_WS_URL');
class FakeWs {
  constructor(url) { this.url = url; FakeWs.last = this; }
  close() { this.onclose?.(); }
}
globalThis.WebSocket = FakeWs;
const mgr = initLiveFeeds({}, {});
const feedRec = mgr.get(LIVE_FEED_ID);
check('the manager builds the bridge provider', feedRec?.providerName === 'bridge');
let got = [];
feedRec.provider.onUpdate(m => got.push(m));
mgr.start(LIVE_FEED_ID);
check('no URL means no connection and no throw', !feedRec.provider.isActive);
mgr.start(LIVE_FEED_ID, { url: 'ws://laptop:8000/ws/detections' });
check('a runtime URL starts it without a rebuild', feedRec.provider.isActive && FakeWs.last?.url === 'ws://laptop:8000/ws/detections');
FakeWs.last.onopen();
FakeWs.last.onmessage({ data: JSON.stringify({ type: 'detection', label: 'DRONE', probability: 0.9, node_id: 'radxa-1', frame_seq: 1 }) });
check('messages are forwarded unchanged, after an open marker',
  got[0]?.type === 'bridge-open' && got[1]?.type === 'detection' && got[1].probability === 0.9);
mgr.stop(LIVE_FEED_ID);
check('stop closes the socket and marks it closed', !feedRec.provider.isActive && got.some(m => m.type === 'bridge-closed'));

console.log('\nWiring in src/main.js');
check('the runtime is imported', /import \{ createLiveSensorRuntime \} from '\.\/live_sensor\.js';/.test(main));
check('__isr_liveSensor is the console entry point', /window\.__isr_liveSensor = /.test(main));
check('__isr_liveDetect is the console entry point', /window\.__isr_liveDetect = /.test(main));
check('the bridge URL env reaches the feed manager', /VITE_ISR_SENSOR_WS_URL: _isrSensorWsUrl,/.test(main));
check('the runtime folds batches through the real apply',
  /applyDetectionBatch: _applyDetectionBatchToEvent,/.test(main));
check('the ring hold is the sweeper\'s grace, one number', /ringHoldMs: _SWEEP_GRACE_MS,/.test(main));

console.log(failures ? `\n✗ ${failures} live-sensor check(s) failed` : '\n✓ live sensor gate green');
process.exit(failures ? 1 : 0);
