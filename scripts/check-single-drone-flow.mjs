// ═══════════════════════════════════════════════════════════════════
// check:single-drone-flow: a single drone runs the swarm's per-site flow
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-03: "Just make the drone swarm flow match into the sole
// event flow", then "just merge that single drone case into the working
// one" and never touch the swarm's own flow.
//
// A single Shahed crossing Amager Koblingsstation only noted the second
// site on the airport's case and sent an automatic message to twelve
// national agencies; Energinet never got a case of its own. The airport's
// case then followed the drone over Amager, and recorded an impact at
// Amalienborg, where no sensor stands, as an observed one.
//
// Now a single drone hands _handlePerSiteLifecycle the sites whose sensors
// see it, as the swarm block hands it the sites that see its drones: one
// case per site, opened on entry, closed on exit, the first site included.
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
check("a case records it was opened by a single drone's site flow, never a swarm's",
  /soloSiteCaseOf: _singleDroneSiteFlow\(primary, droneState\.get\(primary\.id\)\) \? primary\.id : null,/.test(main));

console.log("\n[the swarm's flow, fed one drone]");
const swarmCall = main.indexOf('_handlePerSiteLifecycle(event, state, currentGroupSites);');
const soloCall = main.indexOf('_handlePerSiteLifecycle(event, state, sites);');
check('the swarm block still hands it the sites that see its live drones, unchanged',
  /const currentGroupSites = _aggregateGroupSites\(groupPositions\);\s*_handlePerSiteLifecycle\(event, state, currentGroupSites\);/.test(main));
check('a single drone hands the same function the sites that see it, right after the swarm block',
  soloCall > swarmCall && swarmCall > 0
  && /if \(_singleDroneSiteFlow\(event, state\)\) \{\s*const sites = p\?\.lat != null\s*\? _aggregateGroupSites\(\[\{ lat: p\.lat, lon: p\.lon, alt: typeof p\.alt === 'number' \? p\.alt : 0 \}\]\)\s*: new Set\(\);/.test(main));
check('the first site included, once the drone is detected, so detection keeps its own moment',
  /if \(event\.detected !== true\) sites\.delete\(event\.siteId\);\s*_handlePerSiteLifecycle\(event, state, sites\);/.test(main));
check('no wait of its own on a site exit: a swarm has none', !/SOLO_SITE_EXIT_GRACE_MS|_soloSiteSeenMs/.test(main));
check('the all-coverage close has the swarm\'s gate again, with no exception for single drones',
  /if \(inAnyCoverage === false && noChase && !linkedActive\) \{/.test(main)
  && !/\(!linkedActive \|\| _singleDroneSiteFlow\(event, state\)\)/.test(main));

console.log('\n[nothing is written to a closed case]');
// Since 2026-11-05 the one rule for both flows is site_case_scope.js
// (caseAccepts, siteObservationWrite), held by check:site-case-scope.
// This check only asserts the old single-drone guard is gone, so the
// rule is not duplicated in two shapes that drift.
check('the old single-drone guard is gone: the one rule for both flows is site_case_scope.js',
  !/_soloCaseClosed|_soloTrackLoss|_soloClosed\b/.test(main));
check('the countdown is kept on the track, and the track ends without closing a per-site case again',
  /setTrackLoss\(event\.id, _loss\);\s*if \(caseAccepts\(event, event\.siteId\)\) mutateEvent\(event\.id, \{ temporaryLoss: _loss \}\);/.test(main)
  && /markTrackEnded\(event\.id\);\s*if \(!_trackContinuesAfterClose\(event\)\) markTrackClosed\(p\.eventId\);\s*if \(!_perSiteCases\) \{/.test(main));
check('the fused confidence of a single drone goes only to its open case',
  /if \(_fcOn && leadInCov && !state\.closedAt && caseAccepts\(event, event\.siteId\)\) \{/.test(main));

console.log('\n[kept from before]');
check('the reacquisition bookkeeping and evasion alert stay; only the automatic national message goes',
  /_fireReacquisition\(event, bestSid, \{ escalate: !_singleDroneSiteFlow\(event, state\) \}\);/.test(main)
  && /function _fireReacquisition\(event, siteId, \{ escalate = true \} = \{\}\)/.test(main)
  && /const autoDests = escalate\s*\?/.test(main));
check('the evasion alert calls a drone a track', /\$\{event\.platform === 'missile' \? 'Missile' : 'Track'\} diverged from its projected path/.test(main));
check('notes call one drone a "track", a swarm a "threat group"',
  /\? 'Threat group' : 'Track'\} re-acquired at/.test(main) && /The track left \$\{SITES\[sid\]\?\.name \|\| sid\} sensor coverage\. Event closed\./.test(main));
check("the unobserved-case sweeper leaves a single drone's site case alone while the drone flies (it read as 'neutralized')",
  /if \(ev\.soloSiteCaseOf\) \{\s*if \(isTrackLive\(ev\.soloSiteCaseOf\)\) continue;/.test(main)
  && main.indexOf('if (ev.soloSiteCaseOf) {') < main.indexOf('if (now - lastObs < _SWEEP_GRACE_MS) continue;'));
check('once the track has ended (shot down), its site cases close at once with what each site saw',
  /const _end = trackLastSeen\(_own\.id\) \|\| _own\.exit \|\| _own\.lastPosition;\s*_closeSoloSiteCases\(_own, _own\.outcome === 'neutralized'\s*\? \{ endedAt: _end, outcome: 'neutralized' \}\s*: \{ endedAt: _end, outcome: 'lost contact' \}\);/.test(main));
check('closing touches only the cases this drone opened', /le\.soloSiteCaseOf !== primary\.id\) continue;/.test(main));
check('no case is closed as "target impact" here, so no second consequence cascade', !/_closeSoloSiteCases\([^)]*target impact/.test(main));
check('LAST is the last detection, not the first', /const last = \(e\.endTime \|\| e\.lastKnownPosition\?\.timestamp \|\| e\.startTime\)\.slice\(11, 19\) \+ 'Z';/.test(main));
check('a live ledger card shows the clock time it started (never stale), a closed one how long ago',
  /const timeStr = isActive \? `\$\{\(e\.startTime \|\| ''\)\.slice\(11, 19\)\}Z` : relativeTime\(e\.startTime\);/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
