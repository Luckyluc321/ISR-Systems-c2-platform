// ═══════════════════════════════════════════════════════════════════
// check:engine-reads: what the platform records never depends on who
// is signed in, and nobody is shown more than before
// ───────────────────────────────────────────────────────────────────
// 2026-11-04. Since Phase 3 (2026-09-14) getEvent() has filtered by the
// signed-in account. The engine (simulation, case lifecycle, rules,
// recording, dispatch physics) read through it too, so the recorded
// data changed with the viewer:
//  - with the DK Airport operator signed in, Energinet's Amager case
//    closed "lost contact" or never closed;
//  - with Energinet's operator signed in, the airport swarm froze, with
//    0 alerts against 7.
// Lucas: "For production with live operators, this can NEVER happen."
//
// The engine now reads through getEventForEngine(); screens keep
// getEvent(). What the engine shows (toasts, flashes, pins, cordons,
// response units, drones for receivers) is gated per case. This check
// holds both sides. An independent overseer sorted every lookup blind
// before the change; the allowlist below is that agreed sort.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import * as E from '../src/events.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const lines = main.split('\n');

// A function's body: from its declaration to the closing brace at its
// own indentation (the codebase's consistent formatting).
function bodyOf(name) {
  const i = lines.findIndex((l) => new RegExp(`^(\\s*)(?:async\\s+)?function ${name}\\(`).test(l));
  if (i < 0) return null;
  const ind = lines[i].match(/^\s*/)[0];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j] === `${ind}}` || lines[j].startsWith(`${ind}};`) || lines[j].startsWith(`${ind}})`)) return lines.slice(i, j + 1).join('\n');
  }
  return null;
}
// The innermost declared function enclosing a line.
function enclosingFn(idx) {
  const ind = lines[idx].match(/^\s*/)[0].length;
  for (let j = idx; j >= 0; j--) {
    const m = lines[j].match(/^(\s*)(?:async\s+)?function ([A-Za-z0-9_$]+)\(/);
    if (m && m[1].length < ind) return m[2];
  }
  return '(top level)';
}

console.log('\n[the two reads]');
E.EVENTS.length = 0;
E.EVENTS.push(
  { id: 'T-AIR', siteId: 'cph', tenantId: 'op-cph-airports', status: 'active', domainScope: ['aviation'], linkedEventIds: ['T-AMK'], escalations: [] },
  { id: 'T-AMK', siteId: 'amk', tenantId: 'op-energinet', status: 'active', domainScope: ['ground', 'maritime'], linkedEventIds: ['T-AIR'], escalations: [] },
);
E.setCurrentActor({ kind: 'operator', tenantId: 'op-cph-airports', roleId: 'op-cph-airports' });
check("screens: an operator's getEvent still hides another company's case", E.getEvent('T-AMK') === null && E.getEvent('T-AIR')?.id === 'T-AIR');
check("engine: getEventForEngine sees every case whoever is signed in", E.getEventForEngine('T-AMK')?.id === 'T-AMK' && E.getEventForEngine('nope') === null);
E.unionLinkedEventDomains('T-AIR');
check('a case takes the domains of every linked case, even with an operator signed in (Lucas, 2026-11-04)',
  ['aviation', 'ground', 'maritime'].every((d) => E.getEventForEngine('T-AIR').domainScope.includes(d)));
E.setCurrentActor(null);
E.EVENTS.length = 0;

console.log('\n[the engine reads every case: the agreed sort]');
// The F-35 loop, the friendly missile and the dev inbound pass run their
// frames in inline functions; their enclosing functions are named here.
const ENGINE_FNS = ['_liveTargetPositionFor', '_simComputeEngagementOutcome', '_passPointFor', '_initiateJamFall', '_launchInboundPass',
  '_syncDispatchToEvent', '_tickCounterDispatch', '_gapLimitedStep', '_resolveEngagement', 'counterDispatchStateFor', '_startF35Loop', '_launchFriendlyMissile',
  'tryNeutralize', '_sweepUnobservedActiveEvents', '_findGroupEventForSite', '_closeSoloSiteCases', '_persistCrossCuedRecordings',
  'onDroneTick', 'cancelActiveThreats', 'pushNotification', 'pushObserver'];
// Visibility gates: they read a case only to decide what to SHOW.
const GATE_FNS = ['_viewerSeesCase', '_viewerTrail', '_dropMarker', '_rescopeCaseEntities', '_createCounterDispatchEntities'];
const misplaced = [];
lines.forEach((l, i) => {
  if (!/getEventForEngine\(/.test(l) || l.trim().startsWith('//')) return;
  const fn = enclosingFn(i);
  if (![...ENGINE_FNS, ...GATE_FNS].includes(fn)) misplaced.push(`${i + 1} in ${fn}`);
});
check('no screen reads through the engine\'s door: every getEventForEngine call sits in an engine function or a visibility gate',
  misplaced.length === 0, misplaced.join(', '));
const stillFiltered = ENGINE_FNS.filter((fn) => {
  const b = bodyOf(fn);
  if (!b) return true;
  return /(?<![A-Za-z0-9_$.])getEvent\(/.test(b.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'));
});
check('no engine function reads through the account filter any more', stillFiltered.length === 0, stillFiltered.join(', '));
check('the dispatch target chain and the live sensor read through the engine\'s door',
  /\(event\.linkedEventIds \|\| \[\]\)\.map\(getEventForEngine\)/.test(main) && /getEvent: getEventForEngine, mutateEvent, addNote,/.test(main));
check('the drone tick starts from the engine\'s read', /const event = getEventForEngine\(p\.eventId\);\s*if \(!event\) return;/.test(main));

console.log('\n[nobody is shown more than before]');
check('one rule for what an account is shown about a case',
  /function _viewerSeesCase\(ev\) \{\s*if \(!ev\) return false;\s*const actor = getCurrentActor\(\);\s*if \(!actor \|\| actor\.isAdminBypass \|\| actor\.kind === 'admin'\) return true;\s*if \(_visibleToActor\(ev, actor\)\) return true;\s*if \(actor\.kind !== 'receiver'\) return false;/.test(main));
check('engine toasts about a case go only to an account that may see it',
  (main.match(/if \(_viewerSeesCase\((event|targetEv|ev|_ev)\)\) toast\(/g) || []).length >= 11
  && /if \(_viewerSeesCase\(event\) && _viewerSeesCase\(linked\)\) toast\(`\$\{d\.assetName\} track handed off/.test(main)
  && /if \(jammedCount > 0 && _viewerSeesCase\(event\)\)/.test(main));
check('site toasts: an operator by its own sites, a receiver by the case', (main.match(/_viewerSeesSite\((event|primaryEvent), (siteId|sid|bestSid)\)/g) || []).length >= 8);
check('flashes, explosions and the fall animation draw only for an account that sees the case',
  /if \(_viewerSeesCase\(targetEv\)\) _playExplosionSequence\(/.test(main) && /if \(_viewerSeesCase\(event\)\) _playExplosionSequence\(/.test(main)
  && /\{ visible: _viewerSeesCase\(targetEv\) \}\);/.test(main) && /if \(_viewerSeesCase\(event\)\) _spawnNeutralisationBurst\(/.test(main)
  && /if \(_viewerSeesCase\(event\)\) _spawnFlashEntity\(dropLon, dropLat,/.test(main));
check('receivers see a drone, its trails and its dashed path only for a case they are on',
  /const leadViewable = _viewerSeesPoint\(p\.lat, p\.lon, p\.alt, leadInCov\) && _viewerFollowsTrack\(event\);/.test(main)
  && /_viewerSeesPoint\(pos\.lat, pos\.lon, pos\.alt, true\) && _viewerFollowsTrack\(event\);/.test(main)
  && /!fencedSiteIds\(getActiveRole\(\)\) && _viewerFollowsTrack\(event\);/.test(main)
  && /if \(eventId && !_viewerFollowsTrack\(getEventForEngine\(eventId\)\)\) return \[\];/.test(main));
check('pins, outcome marks, projected paths, cordons, units and the fighter are re-checked every second and on every switch',
  /setInterval\(_rescopeCaseEntities, 1000\);/.test(main) && /applySiteScopeVisibility\(\);\s*\/\/[^\n]*\n[^\n]*\n\s*_rescopeCaseEntities\(\);/.test(main)
  && /function _renderWreckagePerimeter\(wreckage, cordon, caseEvent = null\)/.test(main)
  && (main.match(/_renderWreckagePerimeter\((wreck|_impWreck), cordon, (targetEv|event)\);/g) || []).length === 3
  && /d\.entity\.show = _viewerSeesCase\(getEventForEngine\(d\.eventId\)\);/.test(main));

console.log('\n[the audit trail does not record who was watching]');
check('automatic cascades send as the system, a person\'s action as that person',
  /function _fireEscalationAdapterSend\(event, records, actorRole = getActiveRole\(\)\)/.test(main)
  && /_fireEscalationAdapterSend\(event, records, \{ id: 'system-cordon-command', kind: 'system' \}\);/.test(main)
  && /_fireEscalationAdapterSend\(event, _casRecords, \{ id: 'system-impact-cascade', kind: 'system' \}\);/.test(main));

console.log('\n[screens fail closed]');
check('a recording download for a case the account cannot see gets nothing',
  /if \(!event\) return null;\s*if \(!rec\?\.timeseries\) return rec;/.test(main)
  && (main.match(/if \(!rec\) \{ toast\('Recording is not available for this account\.', 'info'\); return; \}/g) || []).length === 2);
check('a replay of a case the account cannot see is refused',
  /async function startReplay\(eventId\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*if \(!getEvent\(eventId\)\) \{ toast\('Replay is not available for this account\.', 'info'\); return; \}/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
