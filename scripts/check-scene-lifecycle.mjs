#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Scene lifecycle gate
// ───────────────────────────────────────────────────────────────────
// src/scene_lifecycle.js decides when a cordon stands down. It is pure
// and imports nothing, so it runs here under plain Node with no Cesium
// and no browser.
//
// Two regressions this exists to catch.
//
// 1. THE ONLY RELEASE TRIGGER THAT COULD FIRE WAS THE TIMER, and that
//    timer is gated to simulation, so a live event had no release path
//    at all. Cordon units are also excluded from endurance drain, so
//    there was no backstop either: a live cordon would have held until
//    the browser closed. LIVE_NO_TIMER and LIVE_RELEASES hold this
//    line: a live scene releases when, and only when, a human records
//    it.
//
// 3. AMBULANCES WERE TREATED AS POLICE CORDON UNITS. The promotion to
//    'holding-cordon' tested only "ground vehicle with a wreckage
//    assigned", which is true of an ambulance, so a consequence
//    responder parked on a police perimeter until a police account
//    released it. The last section checks both the predicate and that
//    main.js still calls it at all four sites.
//
// 2. A RELEASE WAS EVENT-LEVEL AND PERMANENT. An event gains wreckages
//    one kill at a time, so a swarm's second crash site had its cordon
//    dissolved on the next two-second sweep, with no way to re-arm it.
//    Releases are now per wreckage site. See the section below.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  cordonReleaseDecisions,
  clearedWreckageIds,
  expiredGhostEventIds,
  sceneReleaseState,
  cordonHoldSecFor,
  isSceneFinished,
  CORDON_ATTACHED_STATES,
  leavesSceneUnassisted,
} from '../src/scene_lifecycle.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mainSrc = readFileSync(join(REPO, 'src/main.js'), 'utf8');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

const HOLD = cordonHoldSecFor('receiver-patrol-car') * 1000;
const unit = (over = {}) => ({
  id: 'd1', eventId: 'e1', kind: 'receiver-patrol-car',
  state: 'holding-cordon', assignedWreckageId: 'w1',
  cordonHoldSinceMs: 0, ...over,
});

console.log('\nLive events (simulationOnly: false)');
check('LIVE_NO_TIMER: hold elapsing does NOT release a live cordon',
  cordonReleaseDecisions([unit()], { now: HOLD * 10, simulationOnly: false }).length === 0);
check('LIVE_RELEASES: a recorded scene release DOES release a live cordon',
  (() => {
    // Length asserted explicitly. `.every()` alone is vacuously true on
    // an empty array, so a mutant that released nothing at all passed.
    const out = cordonReleaseDecisions([unit()], {
      now: 0, simulationOnly: false, releasedWreckageIds: new Set(['w1']),
    });
    return out.length === 1 && out[0].reason === 'scene-released';
  })());

console.log('\nA later crash site is a separate scene');
// The regression this section exists for: releasing was event-level and
// permanent, so a swarm's SECOND wreckage had its cordon dissolved on
// the next 2-second sweep, with no way to re-arm it.
check('releasing site 1 does NOT release a cordon on site 2',
  cordonReleaseDecisions([unit({ id: 'd2', assignedWreckageId: 'w2' })],
    { now: 0, simulationOnly: false, releasedWreckageIds: new Set(['w1']) }).length === 0);
check('releasing site 1 releases only site 1 when both are held',
  (() => {
    const out = cordonReleaseDecisions(
      [unit(), unit({ id: 'd2', assignedWreckageId: 'w2' })],
      { now: 0, simulationOnly: false, releasedWreckageIds: new Set(['w1']) });
    return out.length === 1 && out[0].id === 'd1';
  })());
check('the control is offered again for a site that appears after a release',
  (() => {
    const s = sceneReleaseState({
      hasSceneCommand: true,
      releasedWreckageIds: new Set(['w1']),
      dispatches: [unit({ id: 'd2', assignedWreckageId: 'w2' })],
    });
    return s.offered === true && s.wreckageIds.length === 1 && s.wreckageIds[0] === 'w2';
  })(),
  'an operator with a fresh crash site must be able to release it');
check('a unit still driving to an ALREADY-released site does not re-offer the control',
  sceneReleaseState({
    hasSceneCommand: true,
    releasedWreckageIds: new Set(['w1']),
    dispatches: [unit({ state: 'en_route' })],
  }).offered === false);
check('the control reports every open site it would release',
  (() => {
    const s = sceneReleaseState({
      hasSceneCommand: true,
      dispatches: [unit(), unit({ id: 'd2', assignedWreckageId: 'w2' })],
    });
    return s.wreckageIds.length === 2 && s.wreckageIds.includes('w1') && s.wreckageIds.includes('w2');
  })());

console.log('\nSimulation events (simulationOnly: true)');
check('hold not yet elapsed holds',
  cordonReleaseDecisions([unit()], { now: HOLD - 1, simulationOnly: true }).length === 0);
check('hold elapsed releases, reason hold-elapsed',
  cordonReleaseDecisions([unit()], { now: HOLD, simulationOnly: true })[0]?.reason === 'hold-elapsed');
check('a human release outranks the timer and is recorded as such',
  cordonReleaseDecisions([unit()], { now: 0, simulationOnly: true, releasedWreckageIds: new Set(['w1']) })[0]?.reason
    === 'scene-released',
  'a timer expiring must never be written down as an agency decision');
check('only holding-cordon units are released',
  cordonReleaseDecisions([unit({ state: 'en_route' })],
    { now: HOLD * 10, simulationOnly: true, releasedWreckageIds: new Set(['w1']) }).length === 0,
  'en-route units release on arrival via the level-triggered sweep');

console.log('\nScene-release control availability');
const held = [unit()];
check('offered to scene command while a cordon is held',
  sceneReleaseState({ hasSceneCommand: true, dispatches: held }).offered === true);
check('NOT offered to an account without scene command',
  sceneReleaseState({ hasSceneCommand: false, dispatches: held }).offered === false);
check('NOT offered once that site is already released',
  sceneReleaseState({ hasSceneCommand: true, releasedWreckageIds: new Set(['w1']), dispatches: held })
    .offered === false);
check('NOT offered when no cordon exists',
  sceneReleaseState({ hasSceneCommand: true, dispatches: [] }).offered === false);
check('offered while units are still en route',
  sceneReleaseState({ hasSceneCommand: true, dispatches: [unit({ state: 'en_route' })] }).offered === true);
check('counts separate en-route from on-cordon',
  (() => {
    const s = sceneReleaseState({
      hasSceneCommand: true,
      dispatches: [unit(), unit({ id: 'd2', state: 'en_route' })],
    });
    return s.attachedCount === 2 && s.holdingCount === 1;
  })());

console.log('\nConsequence responders leave on their own');
// An ambulance arriving at a crash site was pinned to the wreck, told
// the operator it was "securing wreckage perimeter", and parked there
// until a police account released the scene. In a live event with no
// police on the case it would have parked forever.
const CONSEQUENCE = [
  { kind: 'receiver-ambulance',     profile: { consequenceOnly: true, useRoadRouting: true, airborne: false } },
  { kind: 'receiver-akutlaegebil',  profile: { consequenceOnly: true, useRoadRouting: true, airborne: false } },
  { kind: 'receiver-brandbil',      profile: { consequenceOnly: true, useRoadRouting: true, airborne: false } },
  { kind: 'receiver-rescue-team',   profile: { consequenceOnly: true, useRoadRouting: true, airborne: false } },
];
const CORDON_KINDS = [
  { kind: 'receiver-patrol-car',    profile: { useRoadRouting: true, airborne: false } },
  { kind: 'receiver-cordon-squad',  profile: { useRoadRouting: true, airborne: false } },
  { kind: 'police-c-uas',           profile: { useRoadRouting: true, airborne: false } },
];
for (const c of CONSEQUENCE) {
  check(`${c.kind} leaves on its own`, leavesSceneUnassisted(c.profile) === true,
    'it is a responder, not a cordon unit');
}
for (const c of CORDON_KINDS) {
  check(`${c.kind} does NOT leave on its own`, leavesSceneUnassisted(c.profile) === false,
    'it holds a perimeter until scene command releases it');
}
check('a missing profile does not crash and does not leave on its own',
  leavesSceneUnassisted(undefined) === false && leavesSceneUnassisted(null) === false);
check('a consequence unit is never counted toward a police cordon release',
  cordonReleaseDecisions(
    [unit({ kind: 'receiver-ambulance', assignedWreckageId: null })],
    { now: 0, simulationOnly: false, releasedWreckageIds: new Set(['w1']) }).length === 0,
  'it carries no wreckage pin, so there is nothing to release');
check('the scene-release control does not count an ambulance as on cordon',
  sceneReleaseState({
    hasSceneCommand: true,
    dispatches: [unit({ kind: 'receiver-ambulance', assignedWreckageId: null })],
  }).offered === false,
  'an unpinned responder must not make the police control appear');

// The predicate being right is worthless if main.js stops asking it.
// These four call sites are the whole behaviour.
console.log('\n  wiring in src/main.js');
// Every regex here is ANCHORED to the code it names. Three of these
// were unanchored and passed against the wrong line: reverting the fix
// they claimed to cover left the gate green. An assertion that cannot
// fail is worse than no assertion, because it reads as coverage.
const WIRING = [
  ['given a scene assignment, not a cordon pin',
   /if \(isConsequence\) d\.sceneWreckageId = a\.wreckageId;\s*\n\s*else d\.assignedWreckageId = a\.wreckageId;/,
   'holding-cordon is promoted off assignedWreckageId, so a responder must never hold one'],

  ['aimed at the crash site, not left at the dispatch-time guess',
   /else d\.assignedWreckageId = a\.wreckageId;\s*\n\s*d\.targetLat = a\.ingress\.lat;\s*\n\s*d\.targetLon = a\.ingress\.lon;/,
   'the assignment is the only thing that moves a responder onto the wreck'],

  ['left alone only when already working a KNOWN scene',
   /if \(isConsequence && d\.state === 'engaging' && prevWreckId\) continue;\s*\n\s*if \(isConsequence\) d\.sceneWreckageId/,
   "'engaging' means route consumed, not on scene; and this must return BEFORE the writes, or the record points at a wreck the unit never reached"],

  ['counted as attending, so the perimeter can clear',
   /if \(d\.sceneWreckageId\) _everHeldWreckageIds\.add\(d\.sceneWreckageId\);/,
   'otherwise a consequence-only response leaves the polygon up for the session'],

  ['released from its scene when sent home',
   /d\.assignedWreckageId = null;\s*\n\s*d\.sceneWreckageId = null;/,
   'a stale scene id would hold a perimeter up forever'],

  ['not holding a dead-air event open',
   /leavesSceneUnassisted\(CD_PROFILE\[c\.kind\]\)\);/,
   'an event stayed LIVE with no detections for the whole on-scene task'],

  ['re-dispatchable while driving home',
   /if \(leavesSceneUnassisted\(d\.profile\) && d\.state === 'rtb_home'\) continue;/,
   'a finished ambulance could not be sent to a second scene until it reached its station'],

  ['sent home when its on-scene task finishes',
   /if \(leavesSceneUnassisted\(d\.profile\) && !d\.rtbCompleted\) \{/,
   'without this it falls through to the cordon promotion and parks'],

  ['not re-aimed at the live air track',
   /\} else if \(event\?\.lastPosition && !targetLost && !d\.assignedWreckageId\s*\n\s*&& !d\.sceneWreckageId && !leavesSceneUnassisted\(d\.profile\)\) \{/,
   'an unpinned responder would chase the flying drone every tick'],

  ['spared the interceptor RTB toast',
   /if \(!leavesSceneUnassisted\(d\.profile\)\) \{\s*\n\s*toast\(`\$\{d\.assetName\} back at base\./,
   '"Target signal not reacquired" is meaningless for an ambulance'],
];
for (const [name, re, why] of WIRING) {
  check(`consequence responder is ${name}`, re.test(mainSrc), why);
}

// The wreck fields must reach the event mirror, or the auto-close
// predicate reads undefined and the clause is dead.
check('wreck attachment is mirrored onto the event',
  /entry\.assignedWreckageId = d\.assignedWreckageId \|\| null;\s*\n\s*entry\.sceneWreckageId = d\.sceneWreckageId \|\| null;/.test(mainSrc),
  'the noChase clause reads these off the mirror, and they were never mirrored');

// Outcome confirmation must read the dispatch it is rendering, not the
// first live dispatch that happens to share an asset id.
check('outcome confirmation reads the specific dispatch, not the first of that asset',
  /const state = counterDispatchStateForEntry\(event\.id, cd\);/.test(mainSrc),
  'two live call-outs of one asset made the finished one vanish from Step 4');

// Absence assertions. These guard removals, which a presence check
// cannot see.
check('no "consequence response under way" toast survives',
  !/on scene\. Consequence response under way/.test(mainSrc),
  'it fired at task end AND again while the unit was parked at its own station');
check('arrival wording is not interceptor vocabulary for a responder',
  /d\.profile\?\.stagesAtScene\s*\n\s*\? `\$\{d\.assetName\} staging at scene perimeter\.`/.test(mainSrc),
  'an ambulance arriving announced "on station. Engaging."');

check('the interceptor outcome stamp does not overwrite an existing outcome',
  /if \(event && !event\.dispatchOutcomes\?\.\[d\.id\] && !leavesSceneUnassisted\(d\.profile\)\) \{[\s\S]{0,200}?outcomeId: 'target_evaded_before_arrival'/.test(mainSrc),
  'setDispatchOutcome replaces rather than merges, so every unit driving home was stamped "Target evaded before arrival"');

console.log('\nPerimeter clearing');
check('a wreckage nobody ever held is not cleared',
  clearedWreckageIds([{ id: 'w1' }], [], new Set()).length === 0,
  'a cordon that never formed has not stood down');
check('a held wreckage is not cleared while a unit is en route',
  clearedWreckageIds([{ id: 'w1' }], [unit({ state: 'en_route' })], new Set(['w1'])).length === 0);
check('a held wreckage is cleared once every unit has left',
  clearedWreckageIds([{ id: 'w1' }], [unit({ state: 'rtb_home', assignedWreckageId: null })],
    new Set(['w1']))[0] === 'w1');
check('a responder attending a scene holds its perimeter up',
  clearedWreckageIds([{ id: 'w1' }],
    [unit({ kind: 'receiver-ambulance', assignedWreckageId: null, sceneWreckageId: 'w1', state: 'engaging' })],
    new Set(['w1'])).length === 0,
  'the perimeter belongs to the wreck, not to the police');
check('the perimeter clears once the responder leaves',
  clearedWreckageIds([{ id: 'w1' }],
    [unit({ kind: 'receiver-ambulance', assignedWreckageId: null, sceneWreckageId: null, state: 'rtb_home' })],
    new Set(['w1']))[0] === 'w1',
  'a consequence-only response left the polygon on the map for the session');
check('a responder still does NOT make the police release control appear',
  sceneReleaseState({
    hasSceneCommand: true,
    dispatches: [unit({ kind: 'receiver-ambulance', assignedWreckageId: null, sceneWreckageId: 'w1' })],
  }).offered === false,
  'attending a scene is not holding a cordon');
check('en_route and engaging both count as attached',
  CORDON_ATTACHED_STATES.has('en_route') && CORDON_ATTACHED_STATES.has('engaging')
    && CORDON_ATTACHED_STATES.has('holding-cordon'));

console.log('\nGhost teardown');
check('a closed track past the ghost period is torn down',
  expiredGhostEventIds([['e1', { closedAt: 0 }]], { now: 20000, ghostMs: 15000 })[0] === 'e1');
check('a closed track inside the ghost period is left alone',
  expiredGhostEventIds([['e1', { closedAt: 0 }]], { now: 14000, ghostMs: 15000 }).length === 0);
check('teardown is not repeated',
  expiredGhostEventIds([['e1', { closedAt: 0, _entitiesRemoved: true }]], { now: 20000 }).length === 0);
check('an open track is never torn down',
  expiredGhostEventIds([['e1', {}]], { now: 1e9 }).length === 0);

console.log('\nScene completion');
check('a live track keeps the scene open',
  isSceneFinished({ tracksLive: 1, dispatches: [] }) === false);
check('units still working keep the scene open',
  isSceneFinished({ tracksLive: 0, dispatches: [unit()] }) === false);
check('no tracks and no working units closes the scene',
  isSceneFinished({ tracksLive: 0, dispatches: [unit({ state: 'complete' })] }) === true);

if (failures) {
  console.error(`\n✗ Scene lifecycle gate failed: ${failures} assertion(s).\n`);
  process.exit(1);
}
console.log('\n✓ Scene lifecycle gate satisfied.\n');
