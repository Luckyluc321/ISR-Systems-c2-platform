#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Attribution gate — the platform must never over-claim
// ───────────────────────────────────────────────────────────────────
// src/attribution.js is the one surface that turns sensor output into
// something resembling an intelligence assessment. The failure mode is
// not a crash. It is a confident sentence nobody can support, sitting
// in a report an intelligence receiver reads.
//
// The invariants below are the ones that keep it honest:
//
//   1. Identifying an airframe is not identifying an operator.
//   2. An unresolved classification produces no attribution at all.
//   3. Confidence never leaks upward from a weaker claim to a stronger
//      one, and no claim outranks the platform identification it rests
//      on.
//   4. Every claim states where it came from.
//   5. Intel archetype only. An assessment read by someone without the
//      training to weigh it is how a caveat becomes a fact.
// ═══════════════════════════════════════════════════════════════════

import {
  getAttributionAssessment, canSeeAttribution, confidenceTierFor,
  registerAttributionSource, hasAttributionSource, CONFIDENCE, PROVENANCE,
} from '../src/attribution.js';
import { RECEIVERS } from '../src/roles.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

const RANK = { high: 3, moderate: 2, low: 1, insufficient: 0 };
const shahed = (score) => ({ id: 'e', subject: { class: 'shahed-loitering-munition', class_confidence: score } });
const priorsOf = (n, cls = 'hostile') => Array.from({ length: n }, () => ({
  featureFields: { platform_family: 'shahed-loitering-munition' }, classification: cls,
}));

console.log('\nIdentifying an airframe is not identifying an operator');
const a = getAttributionAssessment(shahed(0.99), { priors: priorsOf(5) });
check('a near-certain platform identification still yields NO operator claim',
  a.claims.find(c => c.kind === 'operator').confidence === CONFIDENCE.INSUFFICIENT,
  'sensors observe airframes, not who launched them');
check('the platform claim itself can be high',
  a.claims.find(c => c.kind === 'platform').confidence === CONFIDENCE.HIGH);
check('class origin is capped below the platform claim',
  RANK[a.claims.find(c => c.kind === 'origin').confidence] < RANK[a.claims.find(c => c.kind === 'platform').confidence],
  'a fact about the platform class is not an observation of this flight');
check('a site pattern never exceeds moderate',
  RANK[a.claims.find(c => c.kind === 'pattern').confidence] <= RANK[CONFIDENCE.MODERATE],
  'recurrence at a site is not attribution of an actor');

console.log('\nAn unresolved classification produces no attribution');
const unk = getAttributionAssessment({ id: 'e', subject: { class: 'unknown', class_confidence: 0.99 } }, { priors: [] });
check('a confidently-unknown platform is INSUFFICIENT, not high',
  unk.claims.find(c => c.kind === 'platform').confidence === CONFIDENCE.INSUFFICIENT,
  '"classified as unknown, 99% confident" is not an attribution');
check('no class-origin claim is made for an unresolved platform',
  !unk.claims.some(c => c.kind === 'origin'),
  'the unknown-family library entry carries boilerplate that would read as a finding');
check('an event with nothing at all still produces an assessment',
  getAttributionAssessment({ id: 'e' }, {}).claims.length >= 2);

console.log('\nConfidence never leaks upward');
for (const [score, expect] of [[0.99, 'high'], [0.95, 'high'], [0.94, 'moderate'], [0.80, 'moderate'], [0.79, 'low'], [0.50, 'low'], [0.49, 'insufficient']]) {
  check(`${score} maps to ${expect}`, confidenceTierFor(score) === expect);
}
check('a missing score is INSUFFICIENT, not a default',
  confidenceTierFor(undefined) === CONFIDENCE.INSUFFICIENT && confidenceTierFor(NaN) === CONFIDENCE.INSUFFICIENT);
check('overall confidence never exceeds the platform identification',
  (() => {
    const m = getAttributionAssessment(shahed(0.62), { priors: priorsOf(5) });
    return RANK[m.overall] <= RANK[m.claims.find(c => c.kind === 'platform').confidence];
  })(),
  'everything rests on knowing what the airframe is');

console.log('\nEvery claim states where it came from');
check('no claim is rendered without provenance',
  getAttributionAssessment(shahed(0.9), { priors: priorsOf(2) }).claims.every(c => !!c.provenance));
check('provenance values come from the declared set',
  (() => {
    const known = new Set(Object.values(PROVENANCE));
    return getAttributionAssessment(shahed(0.9), { priors: priorsOf(2) }).claims.every(c => known.has(c.provenance));
  })());

console.log('\nThe external feed is the only route to an operator claim');
check('with nothing registered, the module says so',
  hasAttributionSource() === false
  && /No basis for operator attribution/.test(getAttributionAssessment(shahed(0.9), {}).claims.find(c => c.kind === 'operator').text));
registerAttributionSource(() => [{ text: 'Feed says X.', confidence: CONFIDENCE.LOW }]);
check('a registered feed CAN produce an operator claim',
  getAttributionAssessment(shahed(0.9), {}).claims.find(c => c.kind === 'operator').provenance === PROVENANCE.FEED);
registerAttributionSource(() => { throw new Error('feed down'); });
check('a throwing feed does not take down the assessment',
  (() => {
    const r = getAttributionAssessment(shahed(0.9), {});
    return r.claims.find(c => c.kind === 'operator').confidence === CONFIDENCE.INSUFFICIENT;
  })(),
  'a broken intelligence feed must degrade to "no basis", never to a crash or a stale claim');
registerAttributionSource(null);

console.log('\nIntel archetype only');
const role = (id) => RECEIVERS.find(r => r.id === id);
for (const id of ['fe', 'politi-nsk']) {
  const r = role(id);
  if (r) check(`${id} sees the assessment`, canSeeAttribution(r) === true);
}
for (const id of ['politi-kbh', 'amk-hovedstaden', 'kbr-hovedstaden', 'brs-hedehusene']) {
  const r = role(id);
  if (r) check(`${id} does NOT`, canSeeAttribution(r) === false);
}
check('an unknown or missing role sees nothing',
  canSeeAttribution(null) === false && canSeeAttribution({ id: 'nope' }) === false);

if (failures) {
  console.error(`\n✗ Attribution gate failed: ${failures} assertion(s).\n`);
  process.exit(1);
}
console.log('\n✓ Attribution gate satisfied.\n');
