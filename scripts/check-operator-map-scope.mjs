// ═══════════════════════════════════════════════════════════════════
// check:operator-map-scope: an operator's live map shows only its sites
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-04, in the DK Airport operator account: a recon swarm
// left the airport's range and its coordinates kept showing, and an
// ENTRY pin appeared at Amager Koblingsstation, a site the account has
// no tie to. Site geometry was already fenced (2026-09-20); the live
// track layer was not: drone icons, trails, crossing pins, a case's
// outcome marks and projected path, and the toasts naming a site.
//
// The rules live in src/operator_map_scope.js and are run here. The
// wiring in main.js is held by its source, above all the rule that the
// fence is DISPLAY ONLY: the any-site coverage answers that drive the
// case flow, the recording, the confidence and the pursuit stay as
// they are, whoever is signed in.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fencedSiteIds, ownSitesSeePoint, siteOfPinLabel, trailForRole, UNKNOWN_SITE } from '../src/operator_map_scope.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const admin = { kind: 'admin' };
const receiver = { kind: 'receiver', siteIds: ['cph'] };
const airport = { kind: 'operator', siteIds: ['cph'] };
const sites = {
  cph: { code: 'CPH', name: 'DK Airport', sensors: [{ id: 'N1', at: 'cph' }] },
  amk: { code: 'AMK', name: 'Amager Koblingsstation', sensors: [{ id: 'A1', at: 'amk' }] },
};
// A sensor "sees" a point when the point names its site.
const sees = (s, lat) => s.at === lat;

console.log('\n[who is fenced]');
check('admin and receivers are not fenced', fencedSiteIds(admin) === null && fencedSiteIds(receiver) === null && fencedSiteIds(null) === null);
check('an operator is fenced to its own sites', JSON.stringify(fencedSiteIds(airport)) === '["cph"]');
check('an operator with no sites sees nothing, not everything', JSON.stringify(fencedSiteIds({ kind: 'operator' })) === '[]');

console.log('\n[a drone is shown where its own sites see it]');
check('admin and receivers keep their own any-site answer', ownSitesSeePoint(admin, sites, sees, 'amk') === null && ownSitesSeePoint(receiver, sites, sees, 'amk') === null);
check('the airport operator sees it over the airport', ownSitesSeePoint(airport, sites, sees, 'cph') === true);
check('the airport operator does not see it over Amager', ownSitesSeePoint(airport, sites, sees, 'amk') === false);

console.log('\n[a trail shows only the points its own sites saw]');
const pts = ['p1', 'p2', 'p3', 'p4'];
const seenBy = [['cph'], ['cph', 'amk'], ['amk'], null];
check('admin gets the very same array back, untouched', trailForRole(admin, pts, seenBy) === pts);
check('the airport operator gets its own points only, never an unrecorded one', JSON.stringify(trailForRole(airport, pts, seenBy)) === '["p1","p2"]');

console.log('\n[an old pin finds its site from its label]');
check('ENTRY ... · CPH', siteOfPinLabel('ENTRY 09:39:44Z · CPH', sites) === 'cph');
check('OUT OF RANGE ... · AMK signal lost', siteOfPinLabel('OUT OF RANGE #2 09:40:01Z · AMK signal lost', sites) === 'amk');
check('EXIT ... · CPH · DRONE-3', siteOfPinLabel('EXIT 09:41:10Z · CPH · DRONE-3', sites) === 'cph');
check('REACQUIRED ... · AMK signal returned', siteOfPinLabel('REACQUIRED #2 09:42:00Z · AMK signal returned', sites) === 'amk');
check('a label naming no site is unknown, which no operator owns', siteOfPinLabel('crossing', sites) === UNKNOWN_SITE && siteOfPinLabel('ENTRY · XYZ', sites) === UNKNOWN_SITE);

console.log('\n[main.js: display only]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('the coverage answers that drive data are still the any-site ones',
  /const leadInCov = _shouldAutoDetect\(p\.lat, p\.lon, p\.alt\);/.test(main)
  && /const inCov = _shouldAutoDetect\(pos\.lat, pos\.lon, pos\.alt\);/.test(main)
  && /const swShouldShow = inCov;/.test(main)
  && /if \(_fcOn && leadInCov && !state\.closedAt/.test(main));
check('the lead is drawn from the viewer\'s answer, and not on a fighter\'s seeker for an operator',
  /const leadViewable = _viewerSeesPoint\(p\.lat, p\.lon, p\.alt, leadInCov\) && _viewerFollowsTrack\(event\);/.test(main)
  && /: \(leadViewable \|\| \(beingChased && !_fencedView && _viewerFollowsTrack\(event\)\) \|\| _coop\)\);/.test(main)
  && /state\.trail\.show = !_fencedView \|\| leadViewable;/.test(main));
check('each airframe and its trail are drawn from the viewer\'s answer',
  /const _swViewable = _swVisible && _viewerSeesPoint\(pos\.lat, pos\.lon, pos\.alt, true\) && _viewerFollowsTrack\(event\);\s*[\s\S]{0,200}sw\.billboard\.show = _swViewable && !sw\._povActive;/.test(main)
  && /if \(sw\.trailLine\) sw\.trailLine\.show = _swViewable;/.test(main));
check('the path no sensor saw is never drawn for an operator',
  /sw\.projLine\.show = sw\.projPositions\.length >= 2 && !fencedSiteIds\(getActiveRole\(\)\) && _viewerFollowsTrack\(event\);/.test(main));
check('both trails render through the viewer\'s filter, and record who saw each point',
  (main.match(/new Cesium\.CallbackProperty\(\(\) => _viewerTrail\(trailPositions, trailSeenBy, event\.id\), false\)/g) || []).length === 2
  && /state\.trailSeenBy\.push\(_trailTag\(p\.lat, p\.lon, p\.alt\)\);/.test(main)
  && /sw\.trailSeenBy\.push\(_trailTag\(pos\.lat, pos\.lon, pos\.alt\)\);/.test(main)
  && /if \(sw\.trailSeenBy\) sw\.trailSeenBy\.length = 0;/.test(main));

console.log('\n[main.js: pins, marks, paths, toasts]');
check('a pin carries its site and is shown only to an account that owns it',
  /function _dropMarker\(lat, lon, colorHex, labelText, eventId = null, siteId = null\)/.test(main)
  && /if \(siteId\) ent\.show = _viewerSeesSite\(getEventForEngine\(eventId\), siteId\);/.test(main));
check('every per-site pin passes its site, and its saved record keeps it',
  (main.match(/, lbl, event\.id, sid\);/g) || []).length === 9
  && !/_dropMarker\(hit\.lat, hit\.lon, [^)]*event\.id\);/.test(main)
  && /_appendSiteCrossing\(event, siteId, \{ kind, lat, lon, color, label, siteId,/.test(main)
  && /function _appendSiteCrossing\(event, siteId, row\) \{\s*const target = _siteCasesOf\(event\)\.get\(siteId\);\s*if \(!target\) return false;/.test(main));
check('pins rebuilt from a case\'s saved points find their site',
  (main.match(/_pinSiteForPoint\(event, event\.(entry|exit|outOfRange)\.lat/g) || []).length === 3
  && /c\.siteId \|\| siteOfPinLabel\(c\.label, SITES\)/.test(main));
check('a case\'s outcome marks and projected path belong to the case\'s site',
  (main.match(/markerKind: '(kill|jam-down|impact)', siteId: (event|targetEv)\.siteId \},\s*show: _viewerSeesCase\((event|targetEv)\),/g) || []).length === 4
  && (main.match(/properties: \{ siteId: event\.siteId \},\s*show: _viewerSeesCase\(event\),/g) || []).length === 3);
check('toasts naming a site, or reporting a case, go only to an account that owns it',
  (main.match(/if \(_viewerSeesSite\((event|primaryEvent), (siteId|sid|bestSid)\)\) toast\(/g) || []).length === 7
  && (main.match(/if \(_viewerSeesCase\(event\)\) toast\((`IMPACT|_casRecords)/g) || []).length === 2
  && /if \(!_viewerSeesSite\(event, siteId\)\) return;\s*toast\(`EVASION CONFIRMED/.test(main));
check('a site switch re-applies the scope to every pin and mark, through the same siteId',
  /function applySiteScopeVisibility\(\) \{\s*for \(const e of viewer\.entities\.values\) \{\s*const sid = e\.properties\?\.siteId\?\.getValue\?\.\(\);/.test(main)
  && /syncSitesToRole\(\);\s*applySiteScopeVisibility\(\);/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
