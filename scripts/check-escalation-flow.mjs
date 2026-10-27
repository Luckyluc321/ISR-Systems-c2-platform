// ═══════════════════════════════════════════════════════════════════
// check:escalation-flow — the messenger, not the decision maker
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-26, on the escalation flow at every site:
//   1. a European agency was ticked by default
//   2. the brief listed fighter jets and military helicopters for a
//      recon swarm and told the recipients to dispatch
//   3. only Tier 1 could be folded away
// "We are the messenger, not the decision maker." This gate holds the
// fix: no international body is ever preselected, no default text
// decides the response, the brief carries response assets only on the
// agent's state-attack call, and every tier folds.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { TEMPLATES } from '../src/drones.js';
import { destinationsForSite, isInternationalBody } from '../src/destinations.js';
import { recommendationFor, preselectedDestinationIds } from '../src/escalation_recommendation.js';
import { renderDetectionBrief } from '../src/summary.js';
import { defaultEscalationMessage } from '../src/escalation_messages.js';
import {
  assessmentFacts, parseAssessment, cleanSituation, showResponseAssets,
  maybeRequestEscalationAssessment, _resetEscalationAssessmentState, ASSESS_CFG,
} from '../src/agents/agent_escalation_assessment.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

console.log('\n[international bodies]');
const INTL = ['EUROCONTROL Network Manager', 'Eurocontrol NOTAM System', 'EUROPOL', 'NATO Air Policing Baltic',
  'NATO Allied Air Command, Ramstein', 'NATO Combined Air Operations Centre, Uedem', 'Combined Air Operations Centre, Uedem',
  'NORDEFCO · Nordic Defence Cooperation', 'ENTSO-E, European Network of Transmission System Operators for Electricity'];
const missed = INTL.filter(n => !isInternationalBody({ name: n }));
check('every European and international body is recognised', !missed.length, missed.join(', '));
const DANISH = ['NOST · National Operativ Stab', 'Statsministeriet · Kriseberedskab', 'Københavns Politi', 'Rigspolitiet',
  'Forsvarskommandoen', 'Flyvevåbnet', 'PET · Operations, Politiets Efterretningstjeneste', 'Trafikstyrelsen · Aviation Authority'];
const wrong = DANISH.filter(n => isInternationalBody({ name: n }));
check('no Danish body is taken for one', !wrong.length, wrong.join(', '));
check('an explicit flag wins either way', isInternationalBody({ name: 'Grenzschutz', international: true }) && !isInternationalBody({ name: 'European desk, PET', international: false }));
{
  const SITES = ['cph', 'aarhus_harbour', 'billund', 'esbjerg', 'odense', 'energinet_amager_koblingsstation', 'energinet_kassoe',
    'energinet_bjaeverskov', 'energinet_ferslev', 'energinet_hovegaard', 'energinet_landerupgaard'];
  const odd = [];
  for (const site of SITES) { let l = []; try { l = destinationsForSite(site); } catch (_) {}
    for (const d of l) if (isInternationalBody(d) && d.tier !== 5 && !/eurocontrol/i.test(d.name)) odd.push(`${site}: T${d.tier} ${d.name}`); }
  check('across every site, only Tier 5 bodies and Eurocontrol count as international', !odd.length, odd.slice(0, 4).join(' | '));
}

console.log('\n[defaults, every scenario at every site]');
let scenarios = 0;
const ticked = [], decided = [];
for (const [key, t] of Object.entries(TEMPLATES)) {
  if (!t.siteId) continue;
  let dests; try { dests = destinationsForSite(t.siteId); } catch (_) { continue; }
  if (!dests?.length) continue;
  scenarios++;
  const rec = recommendationFor(t);
  const pre = new Set(preselectedDestinationIds(rec, dests));
  for (const d of dests) if (pre.has(d.id) && isInternationalBody(d)) ticked.push(`${key}: ${d.name}`);
  if (/\bdispatch|\bescalate to tier|within \d+ seconds|radio silence/i.test(rec.text)) decided.push(`${key}: ${rec.text}`);
}
check(`checked ${scenarios} scenarios`, scenarios >= 30, `${scenarios}`);
check('no international body is ever ticked by default', !ticked.length, ticked.slice(0, 4).join(' | '));
check('no default text decides the response', !decided.length, decided.slice(0, 2).join(' | '));
{
  const kassoe = destinationsForSite('energinet_kassoe');
  const pre = new Set(preselectedDestinationIds(recommendationFor({ classification: 'hostile', threat: 'high', platform: 'missile' }), kassoe));
  const t5 = kassoe.filter(d => d.tier === 5);
  check('a missile ticks the Danish crisis staffs in Tier 5', t5.filter(d => /NOST|Statsministeriet/.test(d.name)).every(d => pre.has(d.id)) && t5.some(d => pre.has(d.id)));
  check('and none of the international bodies beside them', !t5.some(d => isInternationalBody(d) && pre.has(d.id)));
}
{
  const cph = destinationsForSite('cph');
  const pre = new Set(preselectedDestinationIds(recommendationFor({ classification: 'hostile', threat: 'high', platform: 'quadcopter' }), cph));
  check('"Apply recommended" on a hostile drone at Copenhagen ticks site security and the police',
    cph.some(d => d.tier === 1 && pre.has(d.id)) && cph.some(d => d.tier === 2 && pre.has(d.id)));
  check('and leaves the national agencies for the manager to add', !cph.some(d => d.tier === 3 && pre.has(d.id)));
  const eurocontrol = cph.find(d => /eurocontrol/i.test(d.name));
  check('and leaves Eurocontrol on the list, unticked', eurocontrol && !pre.has(eurocontrol.id));
}

console.log('\n[what a drone suggests, Lucas 2026-10-27: Tier 1 and 2 to begin with]');
{
  const tiersFor = k => recommendationFor(TEMPLATES[k]).tiers.join(',');
  const drones = Object.entries(TEMPLATES).filter(([, t]) => t.siteId && t.classification === 'hostile'
    && !['missile', 'loitering-munition'].includes(t.platform));
  const wider = drones.filter(([k]) => tiersFor(k) !== '1,2').map(([k]) => `${k}: ${tiersFor(k)}`);
  check(`every hostile drone suggests Tier 1 and 2 only (${drones.length} scenarios)`, drones.length >= 12 && !wider.length, wider.slice(0, 4).join(' | '));
  check('the recon swarm at Copenhagen suggests Tier 1 and 2', tiersFor('swarm_recon_cph_amk') === '1,2');
  check('the Aarhus fixed-wings suggest Tier 1 and 2', tiersFor('aarhus_fixedwing_probe') === '1,2' && tiersFor('aarhus_fixedwing_terminal') === '1,2');
  check('a loitering munition still suggests the national agencies', recommendationFor({ classification: 'hostile', threat: 'high', platform: 'loitering-munition' }).tiers.includes(3));
  check('a missile still suggests defence', recommendationFor({ classification: 'hostile', threat: 'high', platform: 'missile' }).tiers.includes(4));
}

console.log('\n[the brief]');
const baseEvent = {
  id: 'EVT-TEST', siteId: 'cph', classification: 'hostile', threat: 'high', platform: 'quadcopter',
  droneType: 'Quadcopter swarm (port surveillance suspected)', confidence: 0.82, droneCount: 5,
  startTime: '2026-10-26T10:00:00.000Z',
  lastPosition: { lat: 55.62, lon: 12.65, alt: 120, speed: 14, heading: 200, rangeToPerim: 300 },
  contributingSensors: [{ id: 'N01', confidence: 0.7 }, { id: 'N02', confidence: 0.5 }],
  evidence: {},
};
const hasTables = html => /Tactical Response Assets|Ground Coordination|Consequence \+ Reinforcement/.test(html);
{
  const html = renderDetectionBrief(baseEvent);
  check('no assessment: no response asset tables', !hasTables(html));
  check('no assessment: no Situation section', !/>Situation</.test(html));
  check('no Recommended Action section, ever', !/Recommended Action/.test(html));
  check('nothing in the brief tells anyone to dispatch', !/\bdispatch/i.test(html));
}
{
  const ev = { ...baseEvent, escalationAssessment: { situation: 'Five drones hold <b>120 m</b> over the cargo area.', stateAttack: false, at: '2026-10-26T10:01:00.000Z', model: 'mistral-test' } };
  const html = renderDetectionBrief(ev);
  check('a recon swarm: the Situation section is there', />Situation</.test(html) && /Five drones hold/.test(html));
  check('and the model text is escaped', /&lt;b&gt;120 m&lt;\/b&gt;/.test(html) && !/<b>120 m<\/b>/.test(html));
  check('and it says it is a model reading', /Model reading · mistral-test/.test(html));
  check('a recon swarm: no fighter jets, no helicopters, no asset tables', !hasTables(html));
}
{
  const ev = { ...baseEvent, platform: 'missile', escalationAssessment: { situation: 'A missile is inbound toward the site at low level.', stateAttack: true, at: '2026-10-26T10:01:00.000Z', model: 'mistral-test' } };
  const html = renderDetectionBrief(ev);
  check('the agent calls a state attack: the asset tables are there', /Tactical Response Assets/.test(html));
  check('framed as reference for the authorities who decide', /who decide the response/.test(html));
}
{
  // The floor under the agent: a recon swarm never gets the tables,
  // even if the model answers true.
  const ev = { ...baseEvent, escalationAssessment: { situation: 'Five drones hold over the cargo area.', stateAttack: true, at: '2026-10-26T10:01:00.000Z', model: 'mistral-test' } };
  check('a recon swarm with a wrong "true" from the model: still no tables', !hasTables(renderDetectionBrief(ev)) && showResponseAssets(ev) === false);
  const lm = { ...ev, platform: 'loitering-munition' };
  check('a loitering munition with "true": tables', showResponseAssets(lm) === true);
  const mil = { ...ev, platform: 'quadcopter', subject: { threat_profile: { weaponized_signature: true } } };
  check('a weapon-class signature with "true": tables', showResponseAssets(mil) === true);
}

console.log('\n[the agent]');
{
  const f = assessmentFacts(baseEvent, { siteName: 'Copenhagen Airport', siteKind: 'commercial_airport', heldSeconds: 40 });
  check('the detector type reaches the model without the scenario commentary', f.type_reported_by_detector === 'Quadcopter swarm');
  check('facts carry the swarm size, position against the perimeter and sensors holding',
    f.airframes_in_track === 5 && f.inside_site_perimeter === false && f.distance_to_perimeter_m === 300 && f.sensors_holding === 2);
  check('no recommendation or response field reaches the model', !Object.keys(f).some(k => /recommend|response|dispatch|tier/i.test(k)));
}
{
  check('parses plain JSON', parseAssessment('{"situation": "Five drones hold 120 m over the cargo area.", "state_attack": false}')?.stateAttack === false);
  check('parses JSON inside a code fence', !!parseAssessment('```json\n{"situation": "A missile is inbound at low level.", "state_attack": true}\n```')?.stateAttack);
  check('only an explicit true is a state attack', parseAssessment('{"situation": "Five drones hold over the cargo area.", "state_attack": "true"}')?.stateAttack === false);
  check('no situation: no assessment', parseAssessment('{"state_attack": true}') === null);
  check('not JSON: no assessment', parseAssessment('The drones are over the site.') === null);
  const c = cleanSituation('**Five drones** hold over the quay — slowly; sensors N01 and N02 hold them');
  check('strips markdown, em-dashes and semicolons', c && !/[*—;]/.test(c), c);
  const long = cleanSituation(Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ') + '.');
  check(`caps the length at ${ASSESS_CFG.MAX_WORDS} words`, long && long.split(' ').length <= ASSESS_CFG.MAX_WORDS, long?.split(' ').length);
  check('showResponseAssets is false with no assessment', showResponseAssets(baseEvent) === false);
}
{
  _resetEscalationAssessmentState();
  const writes = []; let calls = 0; let cb = null;
  const transport = { configured: () => true, model: () => 'mistral-test', stream: (m, c) => { calls++; cb = c; } };
  const ctx = { transport, write: (id, a) => writes.push(a), nowMs: Date.parse('2026-10-26T10:00:00Z') };
  const ev = { ...baseEvent };
  maybeRequestEscalationAssessment(ev, ctx);
  maybeRequestEscalationAssessment(ev, ctx);
  check('one request while one is in flight', calls === 1);
  cb.onDone('{"situation": "Five drones hold over the cargo area.", "state_attack": false}');
  check('the answer is written with its model and time', writes[0]?.situation && writes[0].model === 'mistral-test' && writes[0].at);
  ev.escalationAssessment = writes[0];
  maybeRequestEscalationAssessment(ev, { ...ctx, nowMs: ctx.nowMs + 10000 });
  check('a fresh assessment is reused', calls === 1);
  maybeRequestEscalationAssessment(ev, { ...ctx, nowMs: ctx.nowMs + ASSESS_CFG.MAX_AGE_MS + 1000 });
  check('a stale one is asked again', calls === 2);
  cb.onError(new Error('timeout'));
  check('an error clears it rather than leaving it stale', writes[writes.length - 1] === null);
  ev.escalationAssessment = null;
  maybeRequestEscalationAssessment(ev, ctx); cb.onError(new Error('HTTP 401 unauthorised'));
  const before = calls;
  maybeRequestEscalationAssessment(ev, ctx);
  check('a rejected key parks it for the session', calls === before);
  _resetEscalationAssessmentState();
}

console.log('\n[the messages, every recipient at every site]');
{
  const DECIDES = /\b(request ground stop|hold or divert|recommend|stop vehicle|patrols to|crews to standby|no response required|no assistance required|runway unavailable|until further notice|already engaged|no cyber indicators|request patrol|request response|response requested|target selection|local response running|dispatch)\b/i;
  const SITES = ['cph', 'aarhus_harbour', 'billund', 'esbjerg', 'odense', 'energinet_amager_koblingsstation', 'energinet_kassoe',
    'energinet_bjaeverskov', 'energinet_ferslev', 'energinet_hovegaard', 'energinet_landerupgaard'];
  const ev = { classification: 'hostile', threat: 'high', platform: 'quadcopter', droneType: '5x quadcopter (recon formation)', confidence: 0.9 };
  const bad = []; let n = 0;
  for (const site of SITES) { let l = []; try { l = destinationsForSite(site); } catch (_) {}
    for (const d of l) { const m = defaultEscalationMessage(d, ev, site); n++;
      if (DECIDES.test(m)) bad.push(`${d.id}: ${m}`); } }
  check(`no default message decides for its recipient (${n} checked)`, n > 200 && !bad.length, bad.slice(0, 3).join(' | '));
  const cam = destinationsForSite('cph').find(d => d.type === 'system' && /camera/i.test(d.name));
  check('the camera system is still told to slew, which is sensing, not response', cam && /Slew to the live track/.test(defaultEscalationMessage(cam, ev, 'Copenhagen Airport')));
}

console.log('\n[the wiring]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('main.js no longer carries its own recommendationFor', !/function recommendationFor\(/.test(main));
check('the modal opens with nothing ticked', /function openEscalateModal[\s\S]{0,1500}dests\.forEach\(d => \{ _selectedChannels\[d\.id\] = new Set\(\); \}\);/.test(main)
  && !/const preselected = new Set\(preselectedDestinationIds/.test(main));
check('"Apply recommended" uses the same rule', /_recIds = new Set\(preselectedDestinationIds\(rec, dests\)\)/.test(main));
check('every tier header carries the fold control', /data-esc-tier="\$\{tier\}"/.test(main));
check('tiers reset to recommended-open each time the modal opens', /_tierFolded = new Set\(Object\.keys\(destsByTier\)/.test(main));
check('opening the modal asks for the assessment', /function openEscalateModal[\s\S]{0,200}_requestEscalationAssessment\(e\)/.test(main));
check('an escalation an auto-rule sent is assessed once', /ev\.escalations\?\.length && !_assessAsked\.has\(ev\.id\)[\s\S]{0,120}_requestEscalationAssessment\(ev\)/.test(main));
const rules = readFileSync(new URL('../src/rules.js', import.meta.url), 'utf8');
check('an auto-rule never sends to an international body', /escalateToTiers\.includes\(d\.tier\) && !isInternationalBody\(d\)/.test(rules));
check('no default rule says it dispatches', !/name: '[^']*dispatch/i.test(rules));
check('the fixed-wing rule no longer tells Tier 3 on its own by default', /id: 'r-fixed-wing-t3',[\s\S]{0,500}enabled: false,/.test(rules));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
