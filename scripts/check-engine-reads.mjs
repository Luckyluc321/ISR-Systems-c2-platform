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
// response units, the fighter, drones for receivers) is gated per case
// by the rules in operator_map_scope.js. The dispatch engine reads what
// the sensors see (_sensorShown), never what is drawn for the viewer.
// This check holds all of it. An independent overseer sorted every
// lookup blind before the change and reviewed it after; the lists below
// are that agreed sort.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import * as E from '../src/events.js';
import { caseVisibleTo, followsTrack, isUnfenced, siteVisibleTo } from '../src/operator_map_scope.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const live = readFileSync(new URL('../src/live_sensor.js', import.meta.url), 'utf8');
const lines = main.split('\n');

// ── Where code is: a brace scan, not an indentation guess ──
// Two helpers inside the response-unit tick are declared at the wrong
// indent, which fooled the guess this check used first. Strings,
// template literals, comments and regex literals are skipped, and
// code[i] is line i with all of them blanked, so a comment or a message
// text never trips a rule.
function scan(src) {
  const code = [];
  const openAt = [[]];      // per line: lines of the code braces open at its start
  const bodies = [];        // every '{' right after ')': { line, close }
  const stack = [];
  const KW = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
  const isWord = (ch) => /[A-Za-z0-9_$]/.test(ch);
  let line = 0, buf = '', mode = 'code', prevSig = '', prevSig2 = '', word = '', lastWord = false, inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') {
      code.push(buf); buf = ''; line++;
      openAt.push(stack.filter((s) => s.kind === 'code').map((s) => s.line));
      // A regex literal cannot span lines: one that seems to was a
      // division misread, and the damage stops at the line's end.
      if (mode === 'line' || mode === 'regex') mode = 'code';
      lastWord = false;
      continue;
    }
    if (mode === 'line') { buf += ' '; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; buf += '  '; i++; } else buf += ' '; continue; }
    if (mode === 'sq' || mode === 'dq' || mode === 'tmpl') {
      if (c === '\\') { buf += ' '; if (n !== '\n') { buf += ' '; i++; } continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tmpl' && c === '`')) {
        mode = 'code'; prevSig = 'a'; lastWord = false; buf += ' '; continue;
      }
      if (mode === 'tmpl' && c === '$' && n === '{') { stack.push({ kind: 'tmpl' }); mode = 'code'; prevSig = '{'; buf += '  '; i++; continue; }
      buf += ' '; continue;
    }
    if (mode === 'regex') {
      if (c === '\\') { buf += '  '; i++; continue; }
      if (inClass) { if (c === ']') inClass = false; buf += ' '; continue; }
      if (c === '[') { inClass = true; buf += ' '; continue; }
      if (c === '/') { mode = 'code'; prevSig = 'a'; lastWord = false; }
      buf += ' '; continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; buf += '  '; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; buf += '  '; i++; continue; }
    if (c === "'") { mode = 'sq'; buf += ' '; continue; }
    if (c === '"') { mode = 'dq'; buf += ' '; continue; }
    if (c === '`') { mode = 'tmpl'; buf += ' '; continue; }
    if (c === '/') {
      // After i++ or i-- a slash divides (the overseer's case).
      const postfix = (prevSig === '+' || prevSig === '-') && prevSig2 === prevSig;
      const regexStart = !postfix && (prevSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prevSig) || (isWord(prevSig) && KW.has(word)));
      if (regexStart) { mode = 'regex'; inClass = false; buf += ' '; continue; }
    }
    if (c === '{') {
      const rec = { line, close: -1 };
      if (prevSig === ')') bodies.push(rec);
      stack.push({ kind: 'code', line, rec });
    } else if (c === '}') {
      const top = stack.pop();
      if (!top) throw new Error(`brace scan: unbalanced } on line ${line + 1}`);
      if (top.kind === 'tmpl') { mode = 'tmpl'; buf += ' '; continue; }
      top.rec.close = line;
    }
    if (isWord(c)) { word = lastWord ? word + c : c; lastWord = true; } else lastWord = false;
    if (!/\s/.test(c)) { prevSig2 = prevSig; prevSig = c; }
    buf += c;
  }
  code.push(buf);
  if (stack.length || (mode !== 'code' && mode !== 'line')) throw new Error(`brace scan: ended inside ${mode} with ${stack.length} open`);
  return { code, openAt, bodies };
}
const { code, openAt, bodies } = scan(main);
const fns = [];   // { name, start, end }, declared functions by their braces
code.forEach((l, i) => {
  const m = l.match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
  if (!m) return;
  const body = bodies.find((b) => b.line >= i);
  fns.push({ name: m[1], start: i, end: body ? body.close : -1 });
});
const enclosingRange = (i) => {
  let best = null;
  for (const f of fns) if (f.start <= i && f.end >= i && (!best || f.start > best.start)) best = f;
  return best;
};
const enclosingFn = (i) => enclosingRange(i)?.name || '(top level)';
const rangeOf = (name) => fns.find((f) => f.name === name) || null;
const codeOf = (name) => { const r = rangeOf(name); return r ? code.slice(r.start, r.end + 1).join('\n') : null; };
const rawOf = (name) => { const r = rangeOf(name); return r ? lines.slice(r.start, r.end + 1).join('\n') : ''; };
const linesIn = (name) => { const r = rangeOf(name); return r ? Array.from({ length: r.end - r.start + 1 }, (_, k) => r.start + k) : []; };

// ── The agreed sort ──
// Engine: runs whoever is watching and must read every case. The F-35
// loop, the friendly missile and the dev inbound pass run their frames
// in inline functions; their enclosing functions are named here.
const ENGINE_FNS = ['_liveTargetPositionFor', '_simComputeEngagementOutcome', '_passPointFor', '_initiateJamFall', '_launchInboundPass',
  '_syncDispatchToEvent', '_tickCounterDispatch', '_gapLimitedStep', '_resolveEngagement', 'counterDispatchStateFor', '_startF35Loop', '_launchFriendlyMissile',
  'tryNeutralize', '_sweepUnobservedActiveEvents', '_findGroupEventForSite', '_closeSoloSiteCases', '_persistCrossCuedRecordings',
  'onDroneTick', 'cancelActiveThreats', 'pushNotification', 'pushObserver', '_bestTargetForDispatch',
  '_handlePerSiteLifecycle', '_spawnLinkedSiteEvent', 'processDroneSiteMarkers', '_fireDelayedOORForEmptiedSites', '_fireReacquisition',
  '_markMemberBrokenAway', '_rebalancePatrolsToWreckages', '_sweepSceneLifecycle', '_startCounterDispatchLoop'];
// The response-unit chase: decides from what the sensors see.
const CHASE_FNS = ['_tickCounterDispatch', '_gapLimitedStep', '_resolveEngagement', '_assignInterceptorTarget', '_allDownableHostiles',
  '_syncDispatchToEvent', 'counterDispatchStateFor', '_bestTargetForDispatch', '_simComputeEngagementOutcome', '_liveTargetPositionFor',
  '_passPointFor', '_initiateJamFall', 'tryNeutralize'];
// Visibility gates: they read a case only to decide what to SHOW.
const GATE_FNS = ['_viewerSeesCase', '_viewerTrail', '_dropMarker', '_rescopeCaseEntities', '_createCounterDispatchEntities', '_createF35Entities'];
// Lines in main()'s own body rather than in a function: the visibility
// rules' case lookup, the live sensor's gate, and the live sensor's
// engine read (the module reads cases nowhere else).
const DOOR_LINES = [/^\s*lookup: \(id\) => getEventForEngine\(id\),$/, /^\s*canShow: \(id\) => _viewerSeesCase\(getEventForEngine\(id\)\),$/,
  /^\s*sites: SITES, viewer, Cesium, events: EVENTS, addEvent, getEvent: getEventForEngine, mutateEvent, addNote,$/];

console.log('\n[the scan itself]');
check('every declared function closes', fns.length > 400 && fns.every((f) => f.end >= f.start), fns.filter((f) => f.end < f.start).map((f) => f.name).join(', '));
const named = [...new Set([...ENGINE_FNS, ...CHASE_FNS, ...GATE_FNS, '_enterDronePOV', '_createF35Entities'])];
const twice = named.filter((n) => fns.filter((f) => f.name === n).length !== 1);
check('every function this check reads by name is declared exactly once', twice.length === 0, twice.map((n) => `${n} x${fns.filter((f) => f.name === n).length}`).join(', '));
check('a slash after i++ divides: it does not open a regex that would hide the lines after it',
  (() => { const t = scan('let i = 0;\nconst q = i++ / 2;\ntoast(q);\nconst r = q / 2;\n'); return /toast\(q\)/.test(t.code[2]); })());
check('the response-unit tick is read whole, past its two mis-indented helpers',
  rangeOf('_tickCounterDispatch') && rangeOf('_gapLimitedStep')
  && rangeOf('_tickCounterDispatch').end > rangeOf('_gapLimitedStep').end
  && enclosingFn(lines.findIndex((l) => l.includes("reacquired target. Resuming intercept."))) === '_tickCounterDispatch');

console.log('\n[the two reads]');
E.EVENTS.length = 0;
E.EVENTS.push(
  { id: 'T-AIR', siteId: 'cph', tenantId: 'op-cph-airports', status: 'active', domainScope: ['aviation'], linkedEventIds: ['T-AMK'], escalations: [] },
  { id: 'T-AMK', siteId: 'amk', tenantId: 'op-energinet', status: 'active', domainScope: ['ground', 'maritime'], linkedEventIds: ['T-AIR'], escalations: [] },
);
E.setCurrentActor({ kind: 'operator', tenantId: 'op-cph-airports', roleId: 'op-cph-airports' });
check("screens: an operator's getEvent still hides another company's case", E.getEvent('T-AMK') === null && E.getEvent('T-AIR')?.id === 'T-AIR');
check('engine: getEventForEngine sees every case whoever is signed in', E.getEventForEngine('T-AMK')?.id === 'T-AMK' && E.getEventForEngine('nope') === null);
E.unionLinkedEventDomains('T-AIR');
check('a case takes the domains of every linked case, even with an operator signed in (Lucas, 2026-11-04)',
  ['aviation', 'ground', 'maritime'].every((d) => E.getEventForEngine('T-AIR').domainScope.includes(d)));
E.setCurrentActor(null);
E.EVENTS.length = 0;

console.log('\n[who may be shown a case: the rules, run]');
{
  const AIR = { id: 'C-AIR', siteId: 'cph', tenantId: 'op-cph-airports', escalations: [{ destinationId: 'cph-t2-politi' }], linkedEventIds: ['C-AMK'] };
  const AMK = { id: 'C-AMK', siteId: 'amk', tenantId: 'op-energinet', escalations: [], linkedEventIds: ['C-AIR'] };
  const BLL = { id: 'C-BLL', siteId: 'bll', tenantId: 'op-billund', escalations: [], linkedEventIds: [] };
  const all = [AIR, AMK, BLL];
  const deps = (ownSites = []) => ({
    lookup: (id) => all.find((c) => c.id === id) || null,
    visibleToActor: E._visibleToActor,
    roleCanSeeSite: (sid) => ownSites.includes(sid),
  });
  const admin = { kind: 'admin', roleId: 'admin-isr', isAdminBypass: true };
  const operator = { kind: 'operator', tenantId: 'op-cph-airports', roleId: 'op-cph-airports' };
  const police = { kind: 'receiver', roleId: 'politi-kbh', destinationIds: ['cph-t2-politi', 'amk-t2-politi'] };
  const hospital = { kind: 'receiver', roleId: 'hospital', destinationIds: ['hospital-dest'] };
  const d = deps(['cph']);
  check('admin, and the boot moment before any account: everything, even a case no longer in memory',
    [admin, null].every((a) => isUnfenced(a) && all.every((c) => caseVisibleTo(a, c, d)) && caseVisibleTo(a, null, d)
      && siteVisibleTo(a, BLL, 'bll', d) && followsTrack(a, BLL, d)));
  check('an operator: its own company\'s cases only, linked or not',
    !isUnfenced(operator) && caseVisibleTo(operator, AIR, d) && !caseVisibleTo(operator, AMK, d) && !caseVisibleTo(operator, BLL, d) && !caseVisibleTo(operator, null, d));
  check('an operator: site messages by its own sites',
    siteVisibleTo(operator, AMK, 'cph', d) && !siteVisibleTo(operator, AIR, 'amk', d));
  check('a receiver: a case it is on, and the other cases of that track',
    caseVisibleTo(police, AIR, d) && caseVisibleTo(police, AMK, d) && !caseVisibleTo(police, BLL, d) && !caseVisibleTo(police, null, d)
      && siteVisibleTo(police, AMK, 'amk', d) && !siteVisibleTo(police, BLL, 'bll', d)
      && followsTrack(police, AMK, d) && !followsTrack(police, BLL, d));
  check('a receiver on no case: nothing (a hospital never learns who else is on it)',
    all.every((c) => !caseVisibleTo(hospital, c, d) && !followsTrack(hospital, c, d) && !siteVisibleTo(hospital, c, c.siteId, d)));
  check('an unknown kind of account: nothing', !caseVisibleTo({ kind: 'auditor' }, AIR, d) && !siteVisibleTo({ kind: 'auditor' }, AIR, 'cph', d));
  check('main.js decides through these rules and nothing else',
    /function _viewerSeesCase\(ev\) \{ return caseVisibleTo\(getCurrentActor\(\), ev, _viewerScopeDeps\); \}/.test(main)
    && /function _viewerSeesSite\(ev, siteId\) \{ return siteVisibleTo\(getCurrentActor\(\), ev, siteId, _viewerScopeDeps\); \}/.test(main)
    && /function _viewerFollowsTrack\(ev\) \{ return followsTrack\(getCurrentActor\(\), ev, _viewerScopeDeps\); \}/.test(main)
    && /function _viewerIsAdmin\(\) \{ return isUnfenced\(getCurrentActor\(\)\); \}/.test(main)
    && /lookup: \(id\) => getEventForEngine\(id\),\s*visibleToActor: \(e, a\) => _visibleToActor\(e, a\),\s*roleCanSeeSite: \(sid\) => _roleCanSeeSite\(sid\),/.test(main));
}

console.log('\n[the engine reads every case: the agreed sort]');
const misplaced = [];
code.forEach((l, i) => {
  // A lookup that only feeds a visibility test is a gate wherever it is.
  // Called or passed by name, every other use is placed.
  if (!/\bgetEventForEngine\b/.test(l.replace(/_viewer(?:Sees[A-Za-z]*|FollowsTrack)\(getEventForEngine\(/g, ''))) return;
  if (/^\s*(?:export\s+)?import\b/.test(l)) return;
  const fn = enclosingFn(i);
  if ([...ENGINE_FNS, ...GATE_FNS].includes(fn)) return;
  if (DOOR_LINES.some((rx) => rx.test(lines[i]))) return;
  misplaced.push(`${i + 1} in ${fn}`);
});
check("no screen reads through the engine's door: every getEventForEngine call sits in an engine function or a visibility gate",
  misplaced.length === 0, misplaced.join(', '));
const FILTERED = /(?<![A-Za-z0-9_$.])(getEvent|visibleEvents|filteredEvents|getSelectedEvent)(?![A-Za-z0-9_$])(?!\s*:)/;
const stillFiltered = ENGINE_FNS.filter((fn) => { const b = codeOf(fn); return !b || FILTERED.test(b); });
check('no engine function touches a filtered reader, called or passed (getEvent, visibleEvents, filteredEvents, getSelectedEvent)',
  stillFiltered.length === 0, stillFiltered.join(', '));
// Beyond the list: everything the engine's loops can reach, called or
// passed by name. The engine redraws screens, so screens are reachable;
// those that read through the filter are named here, each a screen or a
// person's own action on a case they can see. A new reachable function
// that reads through the filter fails until someone sorts it.
const SCREEN_OR_ACTION = ['triggerQraIntercept', 'dispatchReceiverAsset', 'requestReceiverAsset', 'dispatchCounterResponse',
  'dispatchPostIncident', 'closePostIncidentEvent', 'dispatchPostIncidentAction', 'generatePirReport', '_setEventMarkersVisibility',
  '_resolveChainPrimaryEvent', 'startDebrief', '_fireMistralDebrief', 'startReplay', '_openCascadeCaptureModal',
  '_openArchetypeCascadeModal', '_openObserverPicker', 'renderAlertStrip', 'renderPalantirClosedPanel', 'renderDetailPanel',
  'openRunbookDrawer', '_refreshBriefPreview', 'openBriefPreview', 'openEscalateModal', 'openReclassifyForm',
  '_ensureEventMarkersFromData', '_eventChain', '_applyMarkerFilterToggle', 'renderWorkspaceMissionConsole', '_startMonEngTick',
  '_renderPirEventChain', '_computeReceiverPatternMatch', '_bindReceiverActions'];
const ENGINE_LOOPS = ['onDroneTick', '_tickCounterDispatch', '_startCounterDispatchLoop', '_sweepUnobservedActiveEvents',
  '_sweepSceneLifecycle', '_startF35Loop', '_launchFriendlyMissile', 'tryNeutralize', '_persistCrossCuedRecordings'];
const declared = new Set(fns.map((f) => f.name));
const callees = new Map();
for (const f of fns) {
  const s = callees.get(f.name) || new Set();
  for (const m of code.slice(f.start, f.end + 1).join('\n').matchAll(/(?<![A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)(?![A-Za-z0-9_$])/g)) {
    if (declared.has(m[1]) && m[1] !== f.name) s.add(m[1]);
  }
  callees.set(f.name, s);
}
const reach = new Set();
for (const queue = [...ENGINE_LOOPS]; queue.length;) {
  const n = queue.shift();
  if (reach.has(n)) continue;
  reach.add(n);
  for (const c of callees.get(n) || []) queue.push(c);
}
const unsorted = [...reach].filter((n) => !SCREEN_OR_ACTION.includes(n)
  && fns.filter((f) => f.name === n).some((f) => FILTERED.test(code.slice(f.start, f.end + 1).join('\n'))));
check(`nothing the engine's loops reach (${reach.size} functions) reads through the filter, except named screens and a person's own actions`,
  reach.size > 200 && unsorted.length === 0, unsorted.join(', '));
check("the dispatch target chain and the live sensor read through the engine's door",
  /\(event\.linkedEventIds \|\| \[\]\)\.map\(getEventForEngine\)/.test(main) && /getEvent: getEventForEngine, mutateEvent, addNote,/.test(main));
check("the drone tick starts from the engine's read", /const event = getEventForEngine\(p\.eventId\);\s*if \(!event\) return;/.test(main));

console.log('\n[the dispatch engine reads what the sensors see, never what is drawn]');
// billboard.show is what THIS viewer is shown: the account fence and the
// first-person view both change it. The chase must change with neither,
// so it reads _sensorShown, the sensors' answer.
const drawnReads = [];
for (const fn of new Set([...ENGINE_FNS, ...CHASE_FNS])) {
  for (const i of linesIn(fn)) {
    for (const m of code[i].matchAll(/billboard\??\.show(?![A-Za-z0-9_$])(?!\s*=(?!=))/g)) drawnReads.push(`${i + 1} in ${fn}: ${m[0]}`);
  }
}
check('no engine function reads the drawn flag', drawnReads.length === 0, drawnReads.join('; '));
const viewReads = [];
for (const fn of CHASE_FNS) {
  for (const i of linesIn(fn)) {
    for (const m of code[i].matchAll(/(?<![A-Za-z0-9_$])(?:_povActive|_dronePov)(?![A-Za-z0-9_$])(?!\s*=(?!=))|\.show(?![A-Za-z0-9_$])(?!\s*=(?!=))/g)) {
      viewReads.push(`${i + 1} in ${fn}: ${m[0]}`);
    }
  }
}
check('no chase function reads anything the viewer changes: no shown flag of any entity, no first-person view',
  viewReads.length === 0, viewReads.join('; '));
const chase = codeOf('_tickCounterDispatch') || '';
check('the three chase decisions read _sensorShown',
  /d\.assignedSwarmMember\?\._sensorShown === true\)\)/.test(chase) && /d\.assignedSwarmMember\._sensorShown === false/.test(chase)
  && /&& d\.assignedSwarmMember\._sensorShown === true\) \{/.test(chase));
check('every chase target starts with it: each member and the lead wrapper',
  /swarmBillboards\.push\(\{\s*billboard: swarmBb,(?:\s*\/\/[^\n]*)*\s*_sensorShown: true,/.test(main)
  && /isLead: true,[^\n]*\n\s*_sensorShown: true,/.test(main));
check("the lead and each member mirror the sensors' value every tick, without the account fence or the first-person view",
  /state\.leadSwarmMember\._sensorShown = leadDown \? false : \(state\.closedAt\s*\? false\s*: \(leadInCov \|\| beingChased \|\| _coop\)\);/.test(main)
  && /sw\._sensorShown = _swVisible;[^\n]*\n\s*sw\.billboard\.show = _swViewable && !sw\._povActive;/.test(main));
// Every other write of a drone's shown flag is a hide (= false), and
// hides the SAME drone's _sensorShown, also to false, within four lines.
// Exempt by exact line: the four Cesium graphics writes (overlay icons,
// marker filters, the model and symbol swap), the two display writes
// whose mirrors are pinned above, and the first-person view, which
// hides the icon from the camera and must leave _sensorShown alone.
const NOT_A_DRONE = [
  /^\s*if \(e\.billboard\) e\.billboard\.show = overlayState\.icons;$/,
  /^\s*if \(ent\.billboard\) ent\.billboard\.show = false;$/,
  /^\s*if \(ent\.billboard\) ent\.billboard\.show = catVisible && filters\.showIcons !== false;$/,
  /^\s*billboard\.billboard\.show = new Cesium\.CallbackProperty\(\(\) => !_useModel\(\), false\);$/,
  /^\s*state\.billboard\.show = shouldShow;$/,
  /^\s*sw\.billboard\.show = _swViewable && !sw\._povActive;$/,
];
const CAMERA_ONLY = /^\s*swRef\.billboard\.show = false;\s*\/\/ the camera's view only: _sensorShown is untouched$/;
const unmirrored = [];
code.forEach((l, i) => {
  for (const m of l.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\??\.billboard\.show(?![A-Za-z0-9_$])\s*=(?!=)\s*([^;]*)/g)) {
    if (NOT_A_DRONE.some((rx) => rx.test(lines[i]))) continue;
    const near = code.slice(Math.max(0, i - 4), i + 5).join('\n');
    if (CAMERA_ONLY.test(lines[i])) {
      if (/_sensorShown\s*=(?!=)/.test(near)) unmirrored.push(`${i + 1}: the first-person view writes _sensorShown`);
      continue;
    }
    if (m[2].trim() !== 'false') { unmirrored.push(`${i + 1}: a computed write this check does not pin: ${lines[i].trim().slice(0, 60)}`); continue; }
    const mirror = new RegExp(`\\b${m[1].replace(/\$/g, '\\$')}\\??\\.(?:leadSwarmMember\\.)?_sensorShown\\s*=\\s*false\\b`);
    if (!mirror.test(near)) unmirrored.push(`${i + 1}: ${lines[i].trim().slice(0, 70)}`);
  }
});
check("every drone hide sets the same drone's _sensorShown false; the first-person view leaves it alone", unmirrored.length === 0, unmirrored.join('; '));

console.log('\n[nobody is shown more than before]');
// A toast about a case, raised whoever is watching, is gated on the
// line, by an enclosing block's condition, or by an early return in its
// block. The rule holds in every engine function and in every function
// that already gates one, so a new toast next to a gated one cannot
// slip through.
// A gate lets the toast through only when the viewer MAY see the case:
// an if whose condition calls _viewerSees… unnegated and joins with &&
// alone (a ! or an || would let it through without the gate), or an
// early return on the negated call alone. A call whose answer is
// ignored is no gate.
const posGate = (cond) => /_viewerSees[A-Za-z]*\(/.test(cond) && !/!\s*_viewerSees|\|\|/.test(cond);
const toastLines = code.map((l, i) => (/(?<![A-Za-z0-9_$.])toast\??\.?\(/.test(l) ? i : -1)).filter((i) => i >= 0);
const gated = (i) => {
  const at = code[i].search(/(?<![A-Za-z0-9_$.])toast\??\.?\(/);
  const same = code[i].slice(0, at).match(/^\s*(?:\}\s*else\s+)?if\s*\((.*)\)\s*$/);
  if (same && posGate(same[1])) return true;
  const fn = enclosingRange(i);
  const opens = openAt[i].filter((o) => !fn || o >= fn.start);
  if (opens.some((o) => { const m = code[o].match(/^\s*(?:\}\s*else\s+)?if\s*\((.*)\)\s*\{\s*$/); return m && posGate(m[1]); })) return true;
  const from = opens.length ? opens[opens.length - 1] : (fn ? fn.start : 0);
  for (let g = from + 1; g < i; g++) {
    if (openAt[g].length === openAt[i].length && /^\s*if\s*\(\s*!\s*_viewerSees[A-Za-z]*\([^|&]*\)\s*\)\s*return\b/.test(code[g])) return true;
  }
  return false;
};
const TOAST_EXEMPT = {
  _launchInboundPass: 'developer test harness: its toasts answer the person who pressed it',
  pushNotification: 'only the recipient role is toasted',
};
check('pushNotification toasts only the recipient role', /if \(activeRoleId === roleId && payload\.toast\) \{\s*toast\(/.test(rawOf('pushNotification')));
const ruled = new Set(ENGINE_FNS);
for (const i of toastLines) if (gated(i)) ruled.add(enclosingFn(i));
ruled.delete('main');
ruled.delete('(top level)');
for (const fn of Object.keys(TOAST_EXEMPT)) ruled.delete(fn);
const open = toastLines.filter((i) => ruled.has(enclosingFn(i)) && !gated(i)).map((i) => `${i + 1} in ${enclosingFn(i)}`);
check(`every toast in ${ruled.size} engine functions goes only to an account that may see its case`, open.length === 0, open.join(', '));
check('the response unit\'s status toasts are among them (arrival, pursuit, fuel, coverage, return, miss)',
  ['_tickCounterDispatch', '_resolveEngagement', '_startCounterDispatchLoop', '_launchFriendlyMissile', '_sweepSceneLifecycle'].every((fn) => ruled.has(fn))
  && (main.match(/if \(_viewerSeesCase\(getEventForEngine\(d\.eventId\)\)\) toast\(/g) || []).length >= 18);
check('the overdue alert and the live sensor toast only an account that may see the case',
  /const evt = getEvent\(eventId\);\s*\/\/[^\n]*\n\s*if \(!evt\) return;/.test(main)
  && /canShow: \(id\) => _viewerSeesCase\(getEventForEngine\(id\)\),/.test(main)
  && /if \(canShow\?\.\(liveEvent\.id\) \?\? true\) \{\s*toast\?\.\(`DETECTED[^\n]*\n\s*try \{ selectEvent\?\.\(liveEvent\.id\);/.test(live));
check('flashes, explosions, tracer fire and the fall animation draw only for an account that sees the case',
  /if \(_viewerSeesCase\(targetEv\)\) _playExplosionSequence\(/.test(main) && /if \(_viewerSeesCase\(event\)\) _playExplosionSequence\(/.test(main)
  && /\{ visible: _viewerSeesCase\(targetEv\) \}\);/.test(main) && /if \(_viewerSeesCase\(event\)\) _spawnNeutralisationBurst\(/.test(main)
  && /if \(_viewerSeesCase\(event\)\) _spawnFlashEntity\(dropLon, dropLat,/.test(main)
  && /if \(_viewerSeesCase\(getEventForEngine\(d\.eventId\)\)\) _spawnFlashEntity\(muzzle\.lon, muzzle\.lat,/.test(main)
  && /function _fireSingleTracerRound\(d, target\) \{(?:\s*\/\/[^\n]*)*\s*if \(!_viewerSeesCase\(getEventForEngine\(d\.eventId\)\)\) return;/.test(main));
check('receivers see a drone, its trails and its dashed path only for a case they are on',
  /const leadViewable = _viewerSeesPoint\(p\.lat, p\.lon, p\.alt, leadInCov\) && _viewerFollowsTrack\(event\);/.test(main)
  && /_viewerSeesPoint\(pos\.lat, pos\.lon, pos\.alt, true\) && _viewerFollowsTrack\(event\);/.test(main)
  && /!fencedSiteIds\(getActiveRole\(\)\) && _viewerFollowsTrack\(event\);/.test(main)
  && /if \(eventId && !_viewerFollowsTrack\(getEventForEngine\(eventId\)\)\) return \[\];/.test(main));
// Every part of a response unit, and the fighter and its missile, is
// hidden from the first frame, then re-checked.
const created = [...main.matchAll(/\b(d|_f35|_friendlyMissile)\.([A-Za-z_$]+) = viewer\.entities\.add\(([^\n]*)\n([^\n]*)/g)];
const unscoped = created.filter((m) => !/^\s*show: _(viewerSeesCase|show)\b/.test(m[4]) && !/\.show = _viewerSeesCase\(/.test(m[4])).map((m) => `${m[1]}.${m[2]}`);
check('every response-unit, fighter and missile entity is created hidden from accounts that may not see its case',
  created.length >= 8 && unscoped.length === 0
  && /const _show = _viewerSeesCase\(getEventForEngine\(_f35\.targetEventId \|\| _f35\.dispatchedForEventId\)\);/.test(rawOf('_createF35Entities')),
  unscoped.join(', '));
const unitAssign = [];
code.forEach((l, i) => {
  for (const m of l.matchAll(/\b(d\.(?:entity|trail|routeEntity|radiationEntity|jammingPipEntity)|_f35\.(?:jetEntity|trailEntity)|_friendlyMissile\.entity)\s*=(?!=)\s*([^;]*)/g)) {
    if (m[2].trim() !== 'null' && !m[2].trim().startsWith('viewer.entities.add(')) unitAssign.push(`${i + 1}: ${m[1]} = ${m[2].trim().slice(0, 40)}`);
  }
});
check('a unit, fighter or missile entity comes only from a creation checked above, or is cleared', unitAssign.length === 0, unitAssign.join('; '));
const rescope = codeOf('_rescopeCaseEntities') || '';
const unitParts = (main.match(/for \(const k of (\[[^\]]*\])\) \{ if \(d\[k\]\) d\[k\]\.show = ok; \}/) || [])[1] || '';
const notRescoped = created.filter((m) => m[1] === 'd' && !unitParts.includes(`'${m[2]}'`)).map((m) => `d.${m[2]}`);
check('every response-unit part is re-checked', unitParts && notRescoped.length === 0, notRescoped.join(', '));
check('the re-check covers pins, jam-down marks, projected paths, cordons, units, the fighter and its missile, every second and on every switch',
  ['_perEventMarkers', '_jamDownMarks', 'projectedTrajectoryEntities', '_wreckagePerimeterEntities', '_counterDispatches',
    '_f35', '_friendlyMissile'].every((k) => rescope.includes(k))
  && /const _f35Case = _f35\.targetEventId \|\| _f35\.dispatchedForEventId;/.test(main)
  && /setInterval\(_rescopeCaseEntities, 1000\);/.test(main) && /applySiteScopeVisibility\(\);\s*\/\/[^\n]*\n[^\n]*\n\s*_rescopeCaseEntities\(\);/.test(main));
check('a jam-down mark is hidden from the first frame and re-checked, and stays on the map after its case closes',
  /const _jamEnt = viewer\.entities\.add\(\{\s*position: [^\n]*\n\s*properties: \{ markerEventId: event\.id, markerKind: 'jam-down', siteId: event\.siteId \},\s*show: _viewerSeesCase\(event\),/.test(main) && /_jamDownMarks\.set\(_jamEnt, event\.id\);/.test(main)
  && !/_perEventMarkers[^\n]*_jamEnt/.test(main)
  && /for \(const \[ent, eventId\] of _jamDownMarks\) \{\s*if \(!viewer\.entities\.contains\(ent\)\) \{ _jamDownMarks\.delete\(ent\); continue; \}\s*ent\.show = _viewerSeesCase\(getEventForEngine\(eventId\)\);\s*\}/.test(main));
check('cordons carry their case',
  /function _renderWreckagePerimeter\(wreckage, cordon, caseEvent = null\)/.test(main)
  && (main.match(/_renderWreckagePerimeter\((wreck|_impWreck), cordon, (targetEv|event)\);/g) || []).length === 3);

console.log('\n[the audit trail does not record who was watching]');
check("automatic cascades send as the system, a person's action as that person",
  /function _fireEscalationAdapterSend\(event, records, actorRole = getActiveRole\(\)\)/.test(main)
  && /_fireEscalationAdapterSend\(event, records, \{ id: 'system-cordon-command', kind: 'system' \}\);/.test(main)
  && /_fireEscalationAdapterSend\(event, _casRecords, \{ id: 'system-impact-cascade', kind: 'system' \}\);/.test(main));

console.log('\n[screens fail closed]');
check('a recording download for a case the account cannot see gets nothing; admin keeps one from an earlier session',
  /if \(!event\) return _viewerIsAdmin\(\) \? rec : null;\s*if \(!rec\?\.timeseries\) return rec;/.test(main)
  && (main.match(/if \(!rec\) \{ toast\('Recording is not available for this account\.', 'info'\); return; \}/g) || []).length === 2);
check('a replay of a case the account cannot see is refused; admin is not',
  /async function startReplay\(eventId\) \{(?:\s*\/\/[^\n]*)*\s*if \(!getEvent\(eventId\) && !_viewerIsAdmin\(\)\) \{ toast\('Replay is not available for this account\.', 'info'\); return; \}/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
