// ═══════════════════════════════════════════════════════════════════
// check:identification-gate — nothing goes out before the track is known
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-27: "2 seconds in the system cannot classify what it
// is, and thus we can't share a 'Drone here' before even knowing what it
// is." This gate holds src/identification_gate.js and everything that
// waits for it: the clock agrees with the roster's own schedule, it runs
// on the sim clock, rules skip an unidentified track, and an escalation
// sent before identification names no type, no class and no "drones".
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { IDENT_CFG, createIdentificationClock, initialIdentified, isUnidentified } from '../src/identification_gate.js';
import { destinationsForSite } from '../src/destinations.js';
import { defaultEscalationMessage } from '../src/escalation_messages.js';
import { renderDetectionBrief } from '../src/summary.js';
import { assessmentFacts } from '../src/agents/agent_escalation_assessment.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../src/rules.js', import.meta.url), 'utf8');

console.log('\n[the moment]');
const sched = /const _IDENT_SCHEDULE_S = \[([^\]]+)\]/.exec(main);
const lead = sched ? Number(sched[1].split(',')[0]) : NaN;
check(`identified when the roster names the lead: ${IDENT_CFG.LEAD_IDENTIFIED_S} s, the same as _IDENT_SCHEDULE_S[0]`, lead === IDENT_CFG.LEAD_IDENTIFIED_S, `roster ${lead}`);
check('a hostile track starts classifying', initialIdentified({ classification: 'hostile' }) === false);
check('a cooperative aircraft starts identified (its transponder says what it is)', initialIdentified({ cooperative: true, classification: 'friendly' }) === true);
check('isUnidentified only on an explicit false', isUnidentified({ identified: false }) && !isUnidentified({}) && !isUnidentified({ identified: true }));

console.log('\n[the clock]');
{
  const c = createIdentificationClock();
  const ev = { id: 'E1', status: 'active', detected: true, identified: false };
  const t0 = 1_000_000;
  check('not identified at first sight', c.step([ev], t0).length === 0);
  check('not at 7.9 s', c.step([ev], t0 + 7900).length === 0);
  check('identified at 8 s', c.step([ev], t0 + 8000).includes('E1'));
}
{
  const c = createIdentificationClock();
  const ev = { id: 'E2', status: 'active', detected: false, identified: false };
  c.step([ev], 0); const r = c.step([ev], 60000);
  check('never while undetected, however long it has existed', r.length === 0);
  ev.detected = true; c.step([ev], 60000);
  check('the clock starts at detection, not at spawn', c.step([ev], 67000).length === 0 && c.step([ev], 68000).includes('E2'));
}
{
  const c = createIdentificationClock();
  const ev = { id: 'E3', status: 'active', detected: true, identified: false };
  c.step([ev], 5000);
  let fired = false; for (let i = 0; i < 100; i++) fired = fired || c.step([ev], 5000 + 3000).length > 0;
  check('a paused sim clock does not finish the classification', !fired);
}
{
  const c = createIdentificationClock();
  const ev = { id: 'E4', status: 'active', detected: true, identified: false };
  check("a formation's own first-detection stamp is the start when it has one", c.step([ev], 20000, () => 12000).includes('E4'));
}

console.log('\n[before it is known, nothing says what it is]');
const SITES = ['cph', 'billund', 'aarhus_harbour', 'esbjerg', 'energinet_kassoe'];
const ev = { id: 'E5', siteId: 'cph', classification: 'hostile', threat: 'high', platform: 'quadcopter', droneType: '5x quadcopter (recon formation)',
  confidence: 0.82, identified: false, startTime: '2026-10-27T10:00:00.000Z', droneCount: 5,
  lastPosition: { lat: 55.6140, lon: 12.6500, alt: 120, speed: 15, heading: 268, rangeToPerim: -400 },
  evidence: { rfMatch: 'OcuSync 91%' }, contributingSensors: [{ id: 'N01', confidence: 0.7 }] };
{
  const leak = /drone|quadcopter|ocusync|hostile|five|missile|signature/i;
  const bad = [];
  for (const site of SITES) for (const d of destinationsForSite(site).filter(d => d.tier <= 5)) {
    const m = defaultEscalationMessage(d, { ...ev, siteId: site }, 'Site');
    if (leak.test(m)) bad.push(`${d.id}: ${m}`);
  }
  check('no default message, at any site, names a type, a class or "drones"', !bad.length, bad.slice(0, 3).join(' | '));
  const tower = destinationsForSite('cph').find(d => d.id === 'cph-t1-atc');
  const m = defaultEscalationMessage(tower, ev, 'DK Airport');
  check('the tower still gets where it is and how it moves', /^UNIDENTIFIED TRACK, DK Airport\. Over Runway 04R\/22L, 400 ft, tracking 268 at 30 kt\. Classification in progress\./.test(m), m);
  check('once identified, the same tower message says what it is', /^DRONE ALERT, DK Airport/.test(defaultEscalationMessage(tower, { ...ev, identified: true }, 'DK Airport')));
}
{
  const html = renderDetectionBrief(ev);
  check('the brief names no type, no class, no signature match', !/quadcopter|OcuSync|HOSTILE/i.test(html));
  check('and says it is an unidentified track, classification in progress', /Unidentified track/.test(html) && /Classification (is )?in progress/.test(html));
}
{
  const f = assessmentFacts(ev, {});
  check("the brief's agent gets no type while classifying", f.type_reported_by_detector === null && f.classification_in_progress === true);
}

console.log('\n[the wiring]');
check('a template event starts with initialIdentified(template)', /identified: initialIdentified\(template\),/.test(main));
check('the clock stamps identified and identifiedAt', /_identClock\.step\(EVENTS, monoNow\(\)[\s\S]{0,200}mutateEvent\(id, \{ identified: true, identifiedAt:/.test(main));
check('the clock does not run while the sim is paused', /setInterval\(\(\) => \{\s*if \(simIsPaused\(\)\) return;\s*const ids = _identClock/.test(main));
check('auto-rules skip an unidentified track', /export function evaluateAllRules[\s\S]{0,600}if \(event\.identified === false\) return;/.test(rules));
check("the escalate modal's summary says unidentified while classifying", /isUnidentified\(e\) \? 'Unidentified track, classification in progress,'/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
