// ═══════════════════════════════════════════════════════════════════
// check:single-drone-flow: one drone crosses sites the way a swarm does
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-03: "Just make the drone swarm flow match into the sole
// event flow". A single Shahed crossing Amager Koblingsstation only noted
// the second site on the airport's case and sent an automatic message to
// twelve national agencies; Energinet never got a case of its own and the
// report had no linked event. Measured on 2026-11-03 after the change:
// the airport case closes as the drone leaves the airport, a linked
// Amager case opens for Energinet and closes as it leaves Amager, and no
// escalation goes out by itself. This gate holds the wiring in main.js.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

console.log('\n[who takes the swarm\'s site flow]');
check('a single multi-site drone, not a swarm, not a missile',
  /function _singleDroneSiteFlow\(event, state\) \{\s*return !!event\?\.multiSiteTrack\s*&& !\(state\?\.swarmBillboards && state\.swarmBillboards\.length > 0\)\s*&& event\.platform !== 'missile';/.test(main));

console.log('\n[the flow]');
check('every tick, after the swarm block, a single drone runs the same per-site lifecycle',
  /\[SWARM tick error\]', err\); \}[\s\S]{0,1400}if \(_singleDroneSiteFlow\(event, state\)\) \{\s*const solo = [^\n]*\n\s*_handlePerSiteLifecycle\(event, state, _aggregateGroupSites\(solo\)\);/.test(main));
check('the old reacquisition path, with its automatic national message, no longer runs for it',
  /bestSid !== event\._prevCoverageSite &&[\s\S]{0,200}!_singleDroneSiteFlow\(event, state\)\s*\) \{\s*_fireReacquisition\(event, bestSid\);/.test(main));
check('missiles keep the reacquisition path', (main.match(/_fireReacquisition\(event, bestSid\)/g) || []).length === 1);
check('a single drone is a "track", a swarm a "threat group"',
  /\? 'Threat group' : 'Track'\} re-acquired at/.test(main) && /The track left \$\{SITES\[sid\]\?\.name \|\| sid\} sensor coverage\. Event closed\./.test(main));

console.log('\n[the display]');
check('LAST is the last detection, not the first', /const last = \(e\.endTime \|\| e\.lastKnownPosition\?\.timestamp \|\| e\.startTime\)\.slice\(11, 19\) \+ 'Z';/.test(main));
check('the ledger says how long ago a live case started, not "now"', /const timeStr = relativeTime\(e\.startTime\);/.test(main) && !/const timeStr = isActive \? 'now'/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
