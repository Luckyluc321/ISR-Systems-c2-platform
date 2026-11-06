// ═══════════════════════════════════════════════════════════════════
// check:site-case-scope: a site's case holds only what its own sensors
// saw, ends at its last sighting, and is never written after close
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-05. Before this, the first site's case was also the
// live track: the tick wrote the track's state onto it every frame,
// also after it had closed, so the airport case ended with Amager's
// last sighting and a later end time, and the airport company's report
// named another company's sensors.
//
// Now the live track (src/live_track.js) is the engine's object, and a
// site case is written only through one gate (src/site_case_scope.js).
// This check runs the gate's rules, and holds main.js to using them:
// every observation write goes through the gate, the chase reads the
// track, the second close is gone, and the archive is frozen at close.
// See docs/track-and-site-case-architecture.md.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { caseAccepts, observationFor, siteObservationWrite, sitesSeeing } from '../src/site_case_scope.js';
import { _resetTracksForTest, ensureTrack, getTrack, markTrackEnded, observe, setTemporaryLoss, trackLastSeen, trackPosition } from '../src/live_track.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const events = readFileSync(new URL('../src/events.js', import.meta.url), 'utf8');
const live = readFileSync(new URL('../src/live_sensor.js', import.meta.url), 'utf8');

console.log('\n[the rules, run]');
{
  // Two sites: A sees the west, B sees the east, and they overlap in the middle.
  const sees = (sid, lat, lon) => (sid === 'A' ? lon >= 10.0 && lon <= 10.6 : sid === 'B' ? lon >= 10.4 && lon <= 11.0 : false);
  const west = { lat: 55, lon: 10.2, alt: 100 };
  const mid = { lat: 55, lon: 10.5, alt: 100 };
  const east = { lat: 55, lon: 10.8, alt: 100 };
  const nowhere = { lat: 55, lon: 9.5, alt: 100 };
  check('a site records a point its sensors see, and never one they do not',
    observationFor('A', west, sees) === west && observationFor('A', east, sees) === null && observationFor('B', east, sees) === east);
  check('the overlap is both sites\' observation', sitesSeeing(['A', 'B'], mid, sees).join() === 'A,B'
    && sitesSeeing(['A', 'B'], west, sees).join() === 'A' && sitesSeeing(['A', 'B'], nowhere, sees).length === 0);
  const open = { id: 'c1', status: 'active', siteId: 'A' };
  const closed = { id: 'c2', status: 'closed', siteId: 'A' };
  check('an open case of this site accepts; a closed one, or another site\'s, never',
    caseAccepts(open, 'A') && !caseAccepts(closed, 'A') && !caseAccepts(open, 'B') && !caseAccepts(null, 'A') && !caseAccepts(open, null));
  const fields = { lastPosition: west };
  check('the gate passes a sighting of the case\'s own site and drops everything else',
    siteObservationWrite(open, 'A', west, fields, sees) === fields
    && siteObservationWrite(open, 'A', east, fields, sees) === null
    && siteObservationWrite(closed, 'A', west, fields, sees) === null
    && siteObservationWrite(open, 'B', west, fields, sees) === null);
  check('a write that is not about a position (a status, a note) passes on the case alone',
    siteObservationWrite(open, 'A', null, { note: 1 }, sees) !== null && siteObservationWrite(closed, 'A', null, { note: 1 }, sees) === null);
}

console.log('\n[the live track]');
{
  _resetTracksForTest();
  ensureTrack('T1', 'A');
  const p1 = observe('T1', { lat: 55, lon: 10.2, alt: 100, speed: 20, heading: 90 }, ['A']);
  check('a track position carries speed, heading, alt, timestamp, inCoverage and the sites that saw it',
    p1.speed === 20 && p1.heading === 90 && p1.alt === 100 && typeof p1.timestamp === 'string' && p1.inCoverage === true && p1.siteIds.join() === 'A');
  observe('T1', { lat: 55, lon: 11.5, alt: 100, speed: 20, heading: 90 }, []);
  check('out of every site\'s coverage the position is kept but the last sighting is not moved',
    trackPosition('T1').inCoverage === false && trackLastSeen('T1').lon === 10.2 && trackLastSeen('T1').siteIds.join() === 'A');
  observe('T1', { lat: 55, lon: 10.8, alt: 100, speed: 20, heading: 90 }, ['B']);
  check('sites crossed accumulate in order of first sighting', getTrack('T1').sitesCrossed.join() === 'A,B');
  setTemporaryLoss('T1', { graceMs: 30000 });
  markTrackEnded('T1');
  check('the loss and the end live on the track', getTrack('T1').temporaryLoss.graceMs === 30000 && getTrack('T1').ended === true);
  check('the track module never reads a case or Cesium',
    !/EVENTS|getEvent|Cesium\.|viewer\./.test(readFileSync(new URL('../src/live_track.js', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '')));
  _resetTracksForTest();
}

console.log('\n[main.js writes a site case only through the gate]');
check('the gate is called with the one sensor predicate, and the swarm\'s site membership passes altitude to the same predicate',
  /function _writeSiteObservation\(caseRecord, siteId, position, fields\) \{\s*const ok = siteObservationWrite\(caseRecord, siteId, position, fields, _siteSees\);/.test(main)
  && /function _siteSees\(siteId, lat, lon, altM\) \{\s*for \(const s of SITES\[siteId\]\?\.sensors \|\| \[\]\) if \(_sensorSeesPoint\(s, lat, lon, altM\)\) return true;/.test(main)
  && /groupPositions\.push\(\{ lat: p\.lat, lon: p\.lon, alt: typeof p\.alt === 'number' \? p\.alt : 0 \}\);/.test(main)
  && /groupPositions\.push\(\{ lat: sw\.stats\.lat, lon: sw\.stats\.lon, alt: typeof sw\.stats\.alt === 'number' \? sw\.stats\.alt : 0 \}\);/.test(main));
// Observation fields: written to a case only inside a _recordObservation
// callback (which runs through the gate) or under caseAccepts.
const OBS = ['lastPosition', 'lastKnownPosition', 'projectionSnapshot', 'temporaryLoss', 'currentlyInCoverage', 'duration', 'subject'];
const lines = main.split('\n');
const bare = [];
lines.forEach((l, i) => {
  // A patch whose first field is on the next line is read across both;
  // anything else is read on its own line, so the line reported is the
  // line that writes.
  const RX = /mutateEvent\((event|ev|primaryEvent|targetEv|siteEv|_own|le|liveEvent)\.id, \{\s*([A-Za-z_]+)\s*:/;
  const m = l.match(RX) || (/mutateEvent\([A-Za-z_]+\.id, \{\s*$/.test(l) ? (l + ' ' + (lines[i + 1] || '')).match(RX) : null);
  if (!m || !OBS.includes(m[2])) return;
  const ctx = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
  if (/caseAccepts\(/.test(ctx) || /_recordObservation\(/.test(lines.slice(Math.max(0, i - 8), i + 1).join('\n'))) return;
  bare.push(`${i + 1}: ${l.trim().slice(0, 80)}`);
});
check('no observation field is written to a case outside the gate', bare.length === 0, bare.join('; '));
check('the tick observes the track for every position, and each open site case records only its own sighting',
  /const _seenBy = sitesSeeing\(Object\.keys\(SITES\), \{ lat: p\.lat, lon: p\.lon, alt: p\.alt \}, _siteSees\);\s*const _tpos = observeTrack\(event\.id,/.test(main)
  && /_recordObservation\(event, _tpos, \(ev, sid, whole\) => \(\{\s*lastKnownPosition: \{[^}]*siteId: whole \? bestSid : sid, timestamp: _tpos\.timestamp,/.test(main)
  && /rangeToPerim: _perim \? distanceToPerimeter\(p\.lat, p\.lon, _perim\) : null, eta: null,/.test(main));
check('the subject\'s live kinematics are written through the gate, never in place',
  !/event\.subject\.kinematics\.(speed_ms|heading_deg|altitude_m_agl)\s*=/.test(main)
  && /subject: \{ \.\.\.ev\.subject, kinematics: \{ \.\.\.ev\.subject\.kinematics, speed_ms: p\.speed,/.test(main));
check('crossing rows go to the case of the site they name; per-site bookkeeping lives on the track',
  /function _appendSiteCrossing\(event, siteId, row\) \{\s*const target = _siteCasesOf\(event\)\.get\(siteId\);\s*if \(!target\) return false;/.test(main)
  && !/appendEventArray\(event\.id, 'perSiteCrossings'/.test(main)
  && !/_siteAgg|_droneCovState|_droneInsideState|_droneTransitionLog|_prevCoverageSite|_prevInCoverage|_reacquiredSites/.test(main.replace(/\/\/[^\n]*/g, '')));
check('a linked site case copies no kinematics from the first site, and the live group mirrors members only to cases whose sensors see them',
  /kinematics: \{ lat: null, lon: null, alt: null, heading: null, speedMs: null \},\s*formationOffset: \{ \.\.\.mt\.formationOffset \},\s*inCoverage: false,/.test(main)
  && /function _syncMemberEverywhere\(event, memberId, k\) \{(?:\s*\/\/[^\n]*)*\s*if \(caseAccepts\(event, event\.siteId\) && _siteSees\(event\.siteId, k\.lat, k\.lon,[^\n]*\n\s*syncMemberTrack\(event\.id, memberId, k\);/.test(main)
  && (main.match(/_setMemberStatusEverywhere\(/g) || []).length >= 5);
check('a kill lands on the case that sent the unit (the response layer), and a loss on the open cases that held the member',
  /function _setMemberStatusEverywhere\(event, memberId, status, extra, where, ownerCaseId = null\) \{\s*const took = \[\];\s*if \(!event\) return took;\s*if \(ownerCaseId && setMemberStatus\(ownerCaseId, memberId, status, extra\)\) took\.push\(ownerCaseId\);/.test(main)
  && /_setMemberStatusEverywhere\(getEventForEngine\(d\.eventId\), sw\.memberId, 'neutralised', \{ reason: 'interceptor kill' \}, _liveTargetPositionFor\(d\), d\.eventId\);/.test(main)
  && /_setMemberStatusEverywhere\(event, sw\.memberId, 'neutralised', \{ reason: 'jamming forced landing' \}, pos, event\.id\);/.test(main)
  && /_setMemberStatusEverywhere\(event, sw\.memberId, 'lost', \{\s*reason: 'no sensor or responder holds it',\s*\}, null\)/.test(main)
  && /if \(m && \(where \|\| m\.kinematics\?\.lat != null\) && setMemberStatus\(ev\.id, m\.memberId, status, extra\)\) took\.push\(ev\.id\);/.test(main));
check('a member note goes where its status went: never to a closed case, never for a breakaway the case\'s sensors did not see',
  /for \(const cid of _took\) appendEventArray\(cid, 'notes', \{[\s\S]{0,300}?broke formation/.test(main)
  && /for \(const cid of _took\) appendEventArray\(cid, 'notes', \{[\s\S]{0,300}?lost\. `/.test(main)
  && !/appendEventArray\(event\.id, 'notes', \{\s*timestamp: new Date\(\)\.toISOString\(\),\s*author: 'AUTO-CORRELATOR',\s*text: `\$\{sw\.role \|\| sw\.memberId \|\| 'A (detached )?member'\} (broke formation|lost)/.test(main));

console.log('\n[one close per case, and the track still ends]');
check('the track-level branch ends the track and closes only a single-case track (the missile)',
  /const _perSiteCases = !!event\.multiSiteTrack && event\.platform !== 'missile';/.test(main)
  && /markTrackEnded\(event\.id\);\s*if \(!_trackContinuesAfterClose\(event\)\) markTrackClosed\(p\.eventId\);\s*if \(!_perSiteCases\) \{/.test(main)
  && !/leftCoverageOf: 'all-sites-auto' \}\s*: \(event\.exit \|\| null\);\s*mutateEvent\(event\.id, \{ exit: exitPoint \}\);\s*if \(!_trackContinuesAfterClose/.test(main));
check('completion is keyed on the track, and closes the first case only if it is still open',
  /if \(p\.completed && !state\.closedAt && !getTrack\(event\.id\)\?\.ended && !event\.awaitingNeutralization && !_resolvingEngagement\) \{/.test(main)
  && /markTrackEnded\(event\.id\);\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(event\.status === 'active'\) closeEvent\(p\.eventId, event\.exit \|\| null, \{ autoOutcome: _didImpact \? 'target impact' : 'left coverage' \}\);/.test(main));
check('a site case closes at its site\'s exit with its own last sighting as its exit',
  /closeEvent\(ev\.id, _siteExitFor\(ev\), \{ autoOutcome: 'left coverage' \}\);/.test(main)
  && /function _siteExitFor\(ev\) \{/.test(main));
check('the loss is classified against the fence of the last site that saw the track',
  /function _classifyDetectionLoss\(event, lk = event\.lastKnownPosition \|\| event\.lastPosition, siteId = event\.siteId\) \{/.test(main)
  && /_classifyDetectionLoss\(event, _ls \|\| event\.lastKnownPosition \|\| event\.lastPosition, _ls\?\.siteIds\?\.\[0\] \|\| event\.siteId\)/.test(main));
check('the old single-drone guard is gone: one rule for both flows', !/_soloCaseClosed|_soloTrackLoss|_soloClosed\b/.test(main));

console.log('\n[the chase reads the track]');
check('one helper resolves a case to its track and answers where the track is',
  /function _trackIdFor\(eventId\) \{[\s\S]*?return ev\.soloSiteCaseOf \|\| ev\.shadowOfEventId \|\| ev\.linkedEventId \|\| ev\.id;/.test(main)
  && /function _trackPositionFor\(eventId\) \{\s*const tp = trackPosition\(_trackIdFor\(eventId\)\);\s*if \(tp\) return tp;/.test(main));
const chaseFns = ['_tickCounterDispatch', '_gapLimitedStep', '_liveTargetPositionFor', '_bestTargetForDispatch', '_simComputeEngagementOutcome', '_passPointFor', '_startF35Loop', '_launchFriendlyMissile', '_launchInboundPass', '_scoreKinematicContinuity'];
const readsCase = [];
// A function's body by its braces, not by indentation: two helpers
// inside the response-unit tick are declared at the wrong indent and
// would end the scan early (the overseer, 2026-11-05).
function bodyOf(name) {
  const i = main.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let depth = 0, j = main.indexOf('{', i), inS = null;
  for (; j < main.length; j++) {
    const c = main[j];
    if (inS) { if (c === '\\') j++; else if (c === inS) inS = null; continue; }
    if (c === '\'' || c === '"' || c === '`') { inS = c; continue; }
    if (c === '/' && main[j + 1] === '/') { j = main.indexOf('\n', j); continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return main.slice(i, j + 1);
  }
  return null;
}
for (const fn of chaseFns) {
  const raw = bodyOf(fn);
  if (!raw) { readsCase.push(`${fn} missing`); continue; }
  const body = raw.replace(/\/\/[^\n]*/g, '');
  // A case's own field may stand only as the fallback after a track
  // read on the same line (a seeded case has no track), or as a brand
  // new case's own first sighting (the correlator's newEvent).
  for (const line of body.split('\n')) {
    if (!/(event|ev|targetEv|target|prior|_bpEv)\??\.(lastPosition|lastKnownPosition|currentlyInCoverage)\b/.test(line)) continue;
    if (/trackLastSeen\(|_trackPositionFor\(|trackPosition\(/.test(line)) continue;
    readsCase.push(`${fn}: ${line.trim().slice(0, 70)}`);
  }
}
check('no chase or engine function decides from a case\'s lastPosition or currentlyInCoverage (a track read comes first)', readsCase.length === 0, readsCase.join('; '));
check('the dormant dispatch handover is gone', !/d\.crossCued = true;/.test(main) && !/if \(linked && linked\.status === 'active' && linked\.lastPosition\) \{/.test(main));
check('a unit on a linked site case follows the track but gets no target to engage (its chase is keyed on its own case)',
  /if \(_trackIdFor\(d\.eventId\) !== d\.eventId\) return null;\s*const st = droneState\.get\(d\.eventId\);/.test(main));
check('the impact is recorded only on an open first case', /const _didImpact = !!_tplDone\?\.terminalImpact && event\.status === 'active';/.test(main));
check('a single-case track records the whole track on its one case',
  /const whole = !!event\?\.multiSiteTrack && event\.platform === 'missile';[\s\S]{0,200}fieldsFor\(ev, sid, whole\);[\s\S]{0,120}whole \? null : position, fields\);/.test(main));
check('the evasion check reads the track', /const prevSnap = getTrack\(event\.id\)\?\.projectionSnapshot \|\| event\.projectionSnapshot;\s*const nowHeading = trackPosition\(event\.id\)\?\.heading \?\? event\.lastPosition\?\.heading;/.test(main));
check('the projection line is drawn under the open site case whose sensors see the track',
  /const _seeing = \[\.\.\._siteCasesOf\(event\)\.values\(\)\]\.find\(\(c\) => _siteSees\(c\.siteId, p\.lat, p\.lon, p\.alt\)\) \|\| null;/.test(main));
check('a site case\'s exit is where the last live drone left its coverage', /const oor = \(ev\.perSiteCrossings \|\| \[\]\)\.filter\(\(c\) => c\.kind === 'oor' && c\.siteId === ev\.siteId\)\.pop\(\);/.test(main));
check('the live track is kept past the teardown and dropped on cancel', (main.match(/removeTrack\(eventId\);/g) || []).length === 1);
check('the sweeper\'s single-drone verdict and the chain\'s terminal sample come from the track\'s end',
  /const _end = trackLastSeen\(_own\.id\) \|\| _own\.exit \|\| _own\.lastPosition;/.test(main)
  && /_appendTerminalIfMissing\(chainPrimary, chainRec\.timeseries, trackLastSeen\(chainPrimary\.id\)\)/.test(main));

console.log('\n[frozen at close, and the one other writer]');
check('the archived report is a deep copy', /e\.postIncidentReport = structuredClone\(report\);/.test(events));
check('the live sensor writes its single-site case only while it is open and its own',
  /if \(liveEvent\.status === 'active' && liveEvent\.siteId === siteId\) \{\s*mutateEvent\(liveEvent\.id, \{\s*confidence:/.test(live));
check('the recording stays whole under the track id and each sample says which sites saw it',
  /sites_seen: sensors\.map\(\(s\) => s\.site_id \?\? s\.siteId\)/.test(main)
  && /'event_id', 'site_id', 'sites_seen', 'detection_state', 'sensors_detecting',/.test(main)
  && /_persistRecording\(p\.eventId\);/.test(main));


console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
