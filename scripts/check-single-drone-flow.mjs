// ═══════════════════════════════════════════════════════════════════
// check:single-drone-flow: one drone gets a case at every site it crosses
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-03: "Just make the drone swarm flow match into the sole
// event flow". A single Shahed crossing Amager Koblingsstation only noted
// the second site on the airport's case and sent an automatic message to
// twelve national agencies; Energinet never got a case of its own.
//
// The first attempt ran the swarm's whole site lifecycle and closed the
// airport case at the airport's edge. That cost Geran-3 and Shahed-238
// their warhead-impact ending and consequence cascade, and let a drone
// flickering at an edge open a case per return (verifier, 2026-11-03).
// This gate holds the second design: the first case keeps its old
// lifecycle, crossed sites get linked cases with an exit grace.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

console.log('\n[who]');
check('a single multi-site drone, not a swarm, not a missile',
  /function _singleDroneSiteFlow\(event, state\) \{\s*return !!event\?\.multiSiteTrack\s*&& !\(state\?\.swarmBillboards && state\.swarmBillboards\.length > 0\)\s*&& event\.platform !== 'missile';/.test(main));

console.log('\n[crossed sites get linked cases]');
check('every tick, after the swarm block, the crossed sites go through the per-site lifecycle',
  /\[SWARM tick error\]', err\); \}[\s\S]{0,2600}if \(_singleDroneSiteFlow\(event, state\)\) \{[\s\S]{0,700}_handlePerSiteLifecycle\(event, state, crossed\);/.test(main));
check("the first case's own site is left out, so its lifecycle is the one it always had",
  /const crossed = new Set\(Object\.keys\(seen\)\.filter\(sid => sid !== event\.siteId && now - seen\[sid\] < SOLO_SITE_EXIT_GRACE_MS\)\);/.test(main));
check('a crossed site closes 30 s after the drone was last seen there, on the sim clock (no case per edge flicker)',
  /const SOLO_SITE_EXIT_GRACE_MS = 30000;/.test(main) && /const now = monoNow\(\);\s*if \(!state\._soloSiteSeenMs\)/.test(main));

console.log('\n[the first case is as before]');
check("its close is not held open by its crossed-site cases, and takes them with it",
  /\(!linkedActive \|\| _singleDroneSiteFlow\(event, state\)\)/.test(main)
  && /closeEvent\(p\.eventId, exitPoint, \{ autoOutcome: 'left coverage' \}\);\s*if \(_singleDroneSiteFlow\(event, state\)\) _closeSoloSiteCases\(event\);/.test(main));
check('the reacquisition bookkeeping and evasion alert stay; only the automatic national message goes',
  /_fireReacquisition\(event, bestSid, \{ escalate: !_singleDroneSiteFlow\(event, state\) \}\);/.test(main)
  && /function _fireReacquisition\(event, siteId, \{ escalate = true \} = \{\}\)/.test(main)
  && /const autoDests = escalate\s*\?/.test(main));
check('the evasion alert calls a drone a track', /\$\{event\.platform === 'missile' \? 'Missile' : 'Track'\} diverged from its projected path/.test(main));
check('notes call one drone a "track", a swarm a "threat group"',
  /\? 'Threat group' : 'Track'\} re-acquired at/.test(main) && /The track left \$\{SITES\[sid\]\?\.name \|\| sid\} sensor coverage\. Event closed\./.test(main));

console.log('\n[nothing else closes them early or wrongly]');
check("a case records it was opened by a single drone's site flow, never a swarm's",
  /soloSiteCaseOf: _singleDroneSiteFlow\(primary, droneState\.get\(primary\.id\)\) \? primary\.id : null,/.test(main));
check("the unobserved-case sweeper leaves it alone while the drone flies (it read as 'neutralized' 15 s after the drone left)",
  /if \(ev\.soloSiteCaseOf\) \{\s*if \(isTrackLive\(ev\.soloSiteCaseOf\)\) continue;/.test(main)
  && main.indexOf('if (ev.soloSiteCaseOf) {') < main.indexOf('if (now - lastObs < _SWEEP_GRACE_MS) continue;'));
check('once the track has ended (shot down), it closes at once with what its site saw',
  /_closeSoloSiteCases\(_own, _own\.outcome === 'neutralized'\s*\? \{ endedAt: _own\.exit \|\| _own\.lastPosition, outcome: 'neutralized' \}\s*: \{ endedAt: _own\.lastPosition, outcome: 'lost contact' \}\);/.test(main));
check('closing touches only the cases this drone opened', /le\.soloSiteCaseOf !== primary\.id\) continue;/.test(main));
check('down inside the site reads as down, as a swarm site does; a site it had left records that it left',
  /autoOutcome: endedHere \? outcome : 'left coverage'/.test(main)
  && /The tracked airframe at \$\{name\} is down\. Event closed\./.test(main)
  && /The track left \$\{name\} sensor coverage\. Event closed\./.test(main));
check('at the end of its route, before the generic linked-case close',
  /if \(_singleDroneSiteFlow\(event, state\)\) _closeSoloSiteCases\(event, \{ endedAt: p, outcome: 'lost contact' \}\);\s*\/\/ Also close any linked\/secondary events/.test(main));
check('no case is closed as "target impact" here, so no second consequence cascade', !/_closeSoloSiteCases\([^)]*target impact/.test(main));

console.log('\n[the display]');
check('LAST is the last detection, not the first', /const last = \(e\.endTime \|\| e\.lastKnownPosition\?\.timestamp \|\| e\.startTime\)\.slice\(11, 19\) \+ 'Z';/.test(main));
check('a live ledger card shows the clock time it started (never stale), a closed one how long ago',
  /const timeStr = isActive \? `\$\{\(e\.startTime \|\| ''\)\.slice\(11, 19\)\}Z` : relativeTime\(e\.startTime\);/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
