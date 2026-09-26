#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Track identity gate — C2 consumes identity, it never mints it
// ───────────────────────────────────────────────────────────────────
// A sensor sees a blip, then another blip. Deciding those are one
// aircraft is association, and it belongs at the edge with the raw
// signal. This platform receives the answer.
//
// That boundary is easy to state and easy to erode. The tempting bug is
// not a crash, it is a helpful default: a track arrives without an id,
// some code generates one so the render layer has something to key on,
// and from that moment the platform is quietly deciding what counts as
// one aircraft. Nothing fails. The map looks right. And two sensors
// seeing one drone become two drones in a case file an agency reads.
//
// So the assertions here are identity-integrity claims, deliberately
// separate from scripts/check-provenance.mjs, which owns the sim/live
// boundary. The split is: provenance asks "did we say where this came
// from", this gate asks "did we make it up".
//
// The contract is not ours. It is SAPIENT, published as BSI Flex 335
// v2.0, Dstl-owned and in NATO ratification, which
// docs/idd-integration-brief.md already commits our detection output
// to. Field names here match the standard exactly so that a conforming
// edge node needs no translation layer.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  registerTrackAdapter, publishTrack, onTrack, trackStats, listTrackAdapters,
  trackRejectionReason, relatedObjectIds, _resetTracksForTest,
  ASSOCIATION_RELATION, LOCATION_DATUM, LOCATION_COORDINATE_SYSTEM,
  CONVERTIBLE_LOCATION_DATUMS,
} from '../src/track_source.js';
import { addEvent, attachMemberTrackIdentity } from '../src/events.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(REPO, 'src/main.js'), 'utf8');
const trackSrc = readFileSync(join(REPO, 'src/track_source.js'), 'utf8');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

// A minimal conforming track, so each assertion below varies one thing.
function validTrack(over = {}) {
  return {
    object_id: '01HQ8Z4K2M5N7P9R3T6V8W0XYZ',
    node_id: 'edge-node-cph-01',
    location: {
      x: 12.647, y: 55.618, z: 120,
      coordinate_system: LOCATION_COORDINATE_SYSTEM.LAT_LNG_DEG_M,
      datum: LOCATION_DATUM.WGS84_G,
    },
    detection_confidence: 0.87,
    ...over,
  };
}

_resetTracksForTest();
let last = null;
onTrack(t => { last = t; });
const pub = registerTrackAdapter('test-edge', { source: 'live', start() {} });

console.log('\nThe platform never invents an identity');
check('a track with no object_id is rejected outright',
  trackRejectionReason(validTrack({ object_id: undefined })) === 'missing_object_id',
  'generating one here would make this platform the thing that decides what counts as one aircraft');
check('an empty object_id is not treated as absent-but-fine',
  trackRejectionReason(validTrack({ object_id: '' })) === 'missing_object_id');
check('a track with no node_id is rejected',
  trackRejectionReason(validTrack({ node_id: undefined })) === 'missing_node_id',
  'on a multi-node site an unattributable track cannot be traced to the sensor that produced it');
check('nothing in the seam generates an identifier',
  !/object_id\s*[:=]\s*(?!track\.|t\.)[`'"]/.test(trackSrc.replace(/^\s*\/\/.*$/gm, ''))
  && !/crypto\.randomUUID|Math\.random\(\)/.test(trackSrc),
  'an id minted here would be indistinguishable downstream from one the edge assigned');
check('a valid track is accepted and keeps the id it arrived with',
  pub(validTrack()).status === 'accepted' && last.objectId === '01HQ8Z4K2M5N7P9R3T6V8W0XYZ');

console.log('\nProvenance comes from the registration, not the payload');
check('an adapter must declare whether it is simulated or real',
  (() => {
    try { registerTrackAdapter('undeclared', { start() {} }); return false; } catch { return true; }
  })(),
  'a track with no provenance is unattributable once real and simulated data mix');
check('a live adapter stamps live', last.source === 'live');
check('a track claiming to be simulated is stamped from its adapter anyway',
  pub(validTrack({ source: 'sim' })).status === 'accepted' && last.source === 'live',
  'the field a feed would have to lie in is not read at all');
check('a simulated adapter stamps sim, so the mock cannot masquerade as real',
  (() => {
    const simPub = registerTrackAdapter('test-sim', { source: 'sim', start() {} });
    return simPub(validTrack({ object_id: 'SIMOBJECT000000000000000AA' })).status === 'accepted'
      && last.source === 'sim';
  })(),
  'a mixed site runs real sensors and a rehearsal scenario at once, and nothing after the fact can separate them');
check('an unregistered provider cannot publish',
  publishTrack('nobody', validTrack()).reason === 'unknown_provider',
  'refusing one is what makes the provider on a payload mean anything');
check('the registry lists adapters by name, like every sibling seam',
  listTrackAdapters().includes('test-edge') && listTrackAdapters().includes('test-sim'));

console.log('\nA bearing with no range is a real observation, not a broken one');
check('a bearing-only track is accepted',
  (() => {
    const r = pub({
      object_id: 'BEARINGONLY0000000000000AA', node_id: 'rf-node-1',
      range_bearing: { azimuth: 137.5, azimuth_error: 4.0 },
    });
    return r.status === 'accepted' && r.bearingOnly === true;
  })(),
  'a radio-frequency sensor commonly gives a direction and no distance, and must not be made to invent one');
check('a bearing-only track carries range as an explicit null',
  last.rangeBearing.range === null && last.lat === null,
  'a consumer must not mistake "not measured" for "not sent"');
check('a track with both a location and a range-bearing is rejected as ambiguous',
  trackRejectionReason({
    object_id: 'X0000000000000000000000AAA', node_id: 'n1',
    location: validTrack().location, range_bearing: { azimuth: 90 },
  }) === 'ambiguous_position',
  'the standard models these as a mandatory oneof; both is ambiguous about what was actually measured');
check('a track with neither is rejected',
  trackRejectionReason({ object_id: 'X0000000000000000000000AAA', node_id: 'n1' }) === 'missing_position');
check('an azimuth outside a circle is rejected',
  trackRejectionReason({
    object_id: 'X0000000000000000000000AAA', node_id: 'n1', range_bearing: { azimuth: 400 },
  }) === 'azimuth_out_of_range');

console.log('\nAltitude without a datum is refused rather than guessed');
check('an altitude with no declared datum is rejected',
  trackRejectionReason(validTrack({
    location: { ...validTrack().location, datum: undefined },
  })) === 'missing_altitude_datum',
  'the standard makes datum mandatory precisely because an altitude without one is a silent error');
check('an explicitly unspecified datum is also rejected',
  trackRejectionReason(validTrack({
    location: { ...validTrack().location, datum: LOCATION_DATUM.UNSPECIFIED },
  })) === 'missing_altitude_datum');
check('no datum is applied until a conversion exists for it',
  CONVERTIBLE_LOCATION_DATUMS.size === 0
  && pub(validTrack({ object_id: 'ALTTEST00000000000000000AA' })).altitudeApplied === false
  && last.alt === null && last.altRaw === 120 && last.altDatum === LOCATION_DATUM.WGS84_G,
  'the renderer wants height above ground and neither datum is that. Dropping only the altitude '
  + 'is a visible gap rather than a silent error the size of the local terrain');

console.log('\nThe association graph says which blips are one aircraft');
check('associations are carried through untouched',
  (() => {
    const r = pub(validTrack({
      object_id: 'LEADAAAAAAAAAAAAAAAAAAAAAA',
      associated_detection: [
        { node_id: 'n1', object_id: 'WING1AAAAAAAAAAAAAAAAAAAAA', association_type: ASSOCIATION_RELATION.SIBLING },
        { node_id: 'n2', object_id: 'WING2AAAAAAAAAAAAAAAAAAAAA', association_type: ASSOCIATION_RELATION.SIBLING },
      ],
    }));
    return r.status === 'accepted' && last.associations.length === 2;
  })());
check('PARENT, CHILD and SIBLING all resolve to a real relationship',
  relatedObjectIds({
    associations: [
      { object_id: 'A', association_type: ASSOCIATION_RELATION.PARENT },
      { object_id: 'B', association_type: ASSOCIATION_RELATION.CHILD },
      { object_id: 'C', association_type: ASSOCIATION_RELATION.SIBLING },
    ],
  }).join(',') === 'A,B,C');
check('NO_RELATION is not quietly treated as weak evidence of a link',
  relatedObjectIds({
    associations: [
      { object_id: 'A', association_type: ASSOCIATION_RELATION.NO_RELATION },
      { object_id: 'B', association_type: ASSOCIATION_RELATION.UNSPECIFIED },
    ],
  }).length === 0,
  'a producer explicitly saying two detections are unrelated must not have that read as a link');
check('an object associated with itself is rejected',
  trackRejectionReason(validTrack({
    associated_detection: [{
      node_id: 'n1', object_id: '01HQ8Z4K2M5N7P9R3T6V8W0XYZ',
      association_type: ASSOCIATION_RELATION.SIBLING,
    }],
  })) === 'self_association',
  'it would build a self-referential identity graph that nothing walking it can terminate on');
check('an unknown association type is rejected rather than ignored',
  trackRejectionReason(validTrack({
    associated_detection: [{ node_id: 'n1', object_id: 'OTHER', association_type: 'MAYBE_SAME' }],
  })) === 'unknown_association_type');
check('an association missing its node is rejected',
  trackRejectionReason(validTrack({
    associated_detection: [{ object_id: 'OTHER' }],
  })) === 'association_missing_node_id');

console.log('\nA bad feed is visible and cannot take the loop down');
for (const [why, over, expected] of [
  ['0,0', { location: { ...validTrack().location, x: 0, y: 0 } }, 'null_island'],
  ['a non-finite coordinate', { location: { ...validTrack().location, y: NaN } }, 'non_finite_coordinate'],
  ['a latitude past the pole', { location: { ...validTrack().location, y: 120 } }, 'coordinate_out_of_range'],
  ['an unsupported coordinate system',
    { location: { ...validTrack().location, coordinate_system: LOCATION_COORDINATE_SYSTEM.UTM_M } },
    'unsupported_coordinate_system'],
  ['a confidence above one', { detection_confidence: 1.4 }, 'confidence_out_of_range'],
]) {
  check(`a track with ${why} is rejected, not clamped, and says why`,
    pub(validTrack(over)).reason === expected,
    'coercing a malformed track puts an aircraft where it is not, on an operator map, during an incident');
}
check('rejections are counted per provider, with reasons',
  (() => {
    const st = trackStats('test-edge');
    return st.rejected === 5 && st.reasons.null_island === 1 && st.reasons.confidence_out_of_range === 1;
  })(),
  'one aggregate counter cannot tell you which edge node is the broken one');
check('a listener that throws does not stop delivery to the others',
  (() => {
    _resetTracksForTest();
    let reached = false;
    onTrack(() => { throw new Error('boom'); });
    onTrack(() => { reached = true; });
    registerTrackAdapter('t2', { source: 'live', start() {} })(validTrack());
    return reached;
  })());

console.log('\nThe simulation speaks the same contract');
_resetTracksForTest();
const mock = await import('../src/adapters/track_mock.js');
let mockGot = null;
onTrack(t => { mockGot = t; });
check('the mock adapter self-registers from src/adapters/, like its siblings',
  listTrackAdapters().includes('sim'));
check('the same simulation member always gets the same object id',
  mock.objectIdForMember('DET-1-m0') === mock.objectIdForMember('DET-1-m0')
  && mock.objectIdForMember('DET-1-m0') !== mock.objectIdForMember('DET-1-m1'),
  'stability across ticks is the single property that makes this a track feed rather than a detection feed');
check('a mock object id is ULID-shaped, as the standard specifies',
  /^[0-9A-HJKMNP-TV-Z]{26}$/.test(mock.objectIdForMember('DET-1-m0')),
  'a producer emitting something else would be caught by a conforming consumer, so ours must not');
check('a mock track passes the real validator, not a relaxed one',
  mock.publishMockTrack(mock.buildMockTrack({
    memberKey: 'DET-9-m0', siteId: 'cph', lat: 55.618, lon: 12.647, alt: 120, confidence: 0.9,
  })).status === 'accepted',
  'a mock that cannot satisfy the contract proves nothing about the path a real feed will take');
check('a mock track is stamped sim all the way through', mockGot.source === 'sim');
check('a formation emits siblings, not one merged object',
  (() => {
    const t = mock.buildMockTrack({
      memberKey: 'DET-9-m0', siteId: 'cph', lat: 55.6, lon: 12.6,
      relatedMemberKeys: ['DET-9-m0', 'DET-9-m1', 'DET-9-m2'],
    });
    return t.associated_detection.length === 2
      && t.associated_detection.every(a => a.association_type === ASSOCIATION_RELATION.SIBLING);
  })(),
  'the standard expresses "these belong to one thing" without collapsing them, which is what the '
  + 'interceptor layer needs in order to target a single member');
_resetTracksForTest();

console.log('\nTwo edge nodes disagreeing is a finding, not noise');
{
  // A real event, so the mutator is exercised rather than described.
  addEvent({
    id: 'TRACKGATE-1', siteId: 'cph', status: 'active',
    memberTracks: [{ memberId: 'TRACKGATE-1-m0', nnTrackId: null, kinematics: {} }],
  });
  const first = attachMemberTrackIdentity('TRACKGATE-1', 'TRACKGATE-1-m0', 'OBJ-AAA', { provider: 'edge-a' });
  check('the first edge node to identify a member wins', first?.status === 'attached');
  check('re-sending the same id is not treated as a change',
    attachMemberTrackIdentity('TRACKGATE-1', 'TRACKGATE-1-m0', 'OBJ-AAA')?.status === 'unchanged',
    'a track feed repeats itself every tick and must not churn state');
  const clash = attachMemberTrackIdentity('TRACKGATE-1', 'TRACKGATE-1-m0', 'OBJ-BBB', { provider: 'edge-b' });
  check('a second node claiming the same member is refused, not silently applied',
    clash?.status === 'conflict' && clash.existing === 'OBJ-AAA' && clash.offered === 'OBJ-BBB',
    'two nodes disagreeing about what is one aircraft is a real disagreement. Taking the most recent '
    + 'would hide it, and the case file would show one drone becoming another mid-incident');
  check('a track for a member we do not hold is ignored, not an error',
    attachMemberTrackIdentity('TRACKGATE-1', 'no-such-member', 'OBJ-CCC') === null);
}

console.log('\nIdentity is never inherited by a derived event');
// A cross-cued shadow event and a breakaway child both build their
// member tracks from an existing event's. Both spread the source
// member, and a spread copies every field including the one assigned
// per object by the edge. Two member tracks carrying one object_id is
// the platform asserting that one aircraft is two objects.
for (const [what, anchor] of [
  ['a cross-cued shadow event', /sourceMemberId: mt\.memberId,[\s\S]{0,900}?nnTrackId: null,/],
  ['a breakaway child', /nnTrackId: null,/],
]) {
  check(`${what} starts with no identity of its own`, anchor.test(main),
    'the resolver matches on nnTrackId and returns the first hit in EVENTS order, so a copied id '
    + 'makes the other event unreachable by track');
}

console.log('\nThe simulation actually publishes, so the path runs in a browser');
check('the tick publishes a track beside the kinematics sync',
  (main.match(/_publishSimTrack\(event,/g) || []).length >= 2,
  'both the lead and the wingmen. A seam only the console can reach has never run where it matters');
check('it publishes once per member, not once per tick',
  /if \(!m \|\| m\.nnTrackId\) return;/.test(main),
  'identity does not change, so a republish resolves through the index, returns unchanged, and '
  + 'costs a linear scan of EVENTS for no effect');
check('it is hung off the kinematics sync, not off the recorder',
  (() => {
    const i = main.indexOf('_publishSimTrack(event, state.leadSwarmMember.memberId');
    return i > 0 && main.lastIndexOf('syncMemberTrack(event.id', i) > main.lastIndexOf('recording.timeseries.push', i);
  })(),
  'hanging it off the recorder would couple identity to a neutralised-lead guard that exists for '
  + 'an unrelated reason, and identity would stop attaching after a kill');
check('the tick publishes identity but never position',
  (() => {
    const m = main.match(/function _publishSimTrack\([\s\S]*?\n  \}/);
    return !!m && /alt: null,/.test(m[0]) && !/syncMemberTrack|curLat|kinematics/.test(m[0]);
  })(),
  'the architecture separates identity from movement so the edge can take over one before the '
  + 'other. A position branch growing out of this function is how that separation is lost');
check('a formation publishes as siblings, not as unrelated objects',
  /relatedMemberKeys: \[\]/.test(main) === false && /_memberKeysFor\(event\)/.test(main),
  'the standard expresses "these belong to one thing" without collapsing them, which is what the '
  + 'interceptor layer needs to target a single member');
check('a publish failure cannot break the tick',
  /\[track_source\] sim publish failed/.test(main));
check('the conflict warning is emitted once per member, not per publish',
  /_trackConflictsWarned\.has\(key\.memberId\)/.test(main),
  'a persistent disagreement repeating at feed rate makes a shared console unusable, which is how '
  + 'a real finding ends up scrolled past');

console.log('\nWiring in src/main.js');
// Anchored to a real import statement. A bare filename match also hits
// a commented-out import, which is exactly how this assertion passed
// against a mutant that removed the wiring entirely.
check('the mock adapter is imported, so the path actually executes',
  /^import \{[^}]*\}\s*from '\.\/adapters\/track_mock\.js';/m.test(main),
  'a seam nothing imports is a seam that has never run. The dispatch telemetry seam shipped four '
  + 'defects behind exactly this gap');
check('the seam is reachable from the running application',
  /window\.__isr_publishTrack\s*=/.test(main));
check('an arriving track writes the id the edge assigned onto the member track',
  /nnTrackId/.test(main) && /onTrack\(/.test(main),
  'memberTracks[].nnTrackId has been the designed landing spot since the swarm tracking work');

if (failures) {
  console.error(`\n✗ Track identity gate failed: ${failures} assertion(s).\n`);
  process.exit(1);
}
console.log('\n✓ Track identity gate satisfied.\n');
