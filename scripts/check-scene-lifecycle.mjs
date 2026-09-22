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
// 2. A RELEASE WAS EVENT-LEVEL AND PERMANENT. An event gains wreckages
//    one kill at a time, so a swarm's second crash site had its cordon
//    dissolved on the next two-second sweep, with no way to re-arm it.
//    Releases are now per wreckage site. See the section below.
// ═══════════════════════════════════════════════════════════════════

import {
  cordonReleaseDecisions,
  clearedWreckageIds,
  expiredGhostEventIds,
  sceneReleaseState,
  cordonHoldSecFor,
  isSceneFinished,
  CORDON_ATTACHED_STATES,
} from '../src/scene_lifecycle.js';

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

console.log('\nPerimeter clearing');
check('a wreckage nobody ever held is not cleared',
  clearedWreckageIds([{ id: 'w1' }], [], new Set()).length === 0,
  'a cordon that never formed has not stood down');
check('a held wreckage is not cleared while a unit is en route',
  clearedWreckageIds([{ id: 'w1' }], [unit({ state: 'en_route' })], new Set(['w1'])).length === 0);
check('a held wreckage is cleared once every unit has left',
  clearedWreckageIds([{ id: 'w1' }], [unit({ state: 'rtb_home', assignedWreckageId: null })],
    new Set(['w1']))[0] === 'w1');
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
