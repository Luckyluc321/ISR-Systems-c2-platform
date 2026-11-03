// ═══════════════════════════════════════════════════════════════════
// check:incident-summary: every report tells its own event's story
// ───────────────────────────────────────────────────────────────────
// Audit of 2026-10-30: every neutralised event's report read "Cruise
// missile signature originated south west of Kassø ... Impact avoided
// over inner Copenhagen", named a fighter response when no responder was
// recorded, and the interceptor outcome always said "over Amager. Four DJI
// airframes downed". This gate holds src/incident_summary.js and the
// places in main.js that used to carry a fixed story.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { EVASION_MIN_DEG, incidentExecSummary, respondersOf } from '../src/incident_summary.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const NAMES = { aarhus_harbour: 'Aarhus Harbour', energinet_kassoe: 'Kassø', cph: 'Copenhagen Airport' };
const siteName = (id) => NAMES[id] || id;

console.log('\n[a drone over Aarhus harbour]');
const drone = {
  siteId: 'aarhus_harbour', droneType: 'DJI Matrice 300', classification: 'hostile', identified: true,
  startTime: '2026-11-02T10:04:12.000Z', neutralizedBy: 'Østjyllands Politi drone unit', neutralizedAt: '2026-11-02T10:09:40.000Z',
};
const s1 = incidentExecSummary(drone, { siteName, sitesTouched: ['aarhus_harbour'], evasionDeg: 3, position: '56.1508°N 10.2284°E', positionSite: 'Aarhus Harbour' });
check('names its own airframe, class, site and responder',
  /DJI Matrice 300 \(hostile\)/.test(s1) && /Aarhus Harbour/.test(s1) && /Østjyllands Politi drone unit/.test(s1) && /10:04:12Z/.test(s1) && /10:09:40Z/.test(s1), s1);
check('says nothing about a missile, Kassø, Copenhagen or a fighter', !/missile|Kassø|Copenhagen|fighter|Flyvevåbnet|impact avoided/i.test(s1), s1);
check('a course change under the threshold is not reported as evasion', !/Course changed/.test(s1));

console.log('\n[facts it does not have are left out]');
const bare = { siteId: 'cph', droneType: 'DJI Mavic 3', classification: 'hostile', startTime: '2026-11-02T10:00:00.000Z' };
const s2 = incidentExecSummary(bare, { siteName });
check('no recorded responder is said as such, never filled with one', /responder the record does not name/.test(s2) && !/fighter|Flyvevåbnet/i.test(s2), s2);
check('no position, no position clause', !/position/.test(s2), s2);
const s3 = incidentExecSummary({ ...bare, siteId: 'energinet_kassoe', droneType: 'Cruise missile' },
  { siteName, sitesTouched: ['energinet_kassoe', 'cph'], evasionDeg: EVASION_MIN_DEG + 14 });
check('a real multi-site missile track still reads correctly, from its own data',
  /Cruise missile/.test(s3) && /Tracked across 2 sensor sites: Kassø → Copenhagen Airport/.test(s3) && /Course changed by 22°/.test(s3), s3);
check('a classifying track is not named', !/Mavic/.test(incidentExecSummary({ ...bare, identified: false }, { siteName })));
check('no event, no text, no throw', incidentExecSummary(null) === '');

console.log('\n[main.js]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const code = main.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // comments may tell the history
check('the report summary is built by incidentExecSummary', /\$\{incidentExecSummary\(e, \{/.test(main));
check('no fixed Kassø or inner-Copenhagen story in any shown string', !/south west of Kassø|Impact avoided over inner Copenhagen|post Kassø exit|from Kassø projection/.test(code));
check('no fighter response invented for a missing responder',
  !/'Flyvevåbnet Fighter Response'\}|'Flyvevåbnet fighter response'|neutralised by fighter response|'Flyvevåbnet'\}/.test(code)
  && !/Mach 0\.8 doctrine|E-W transit/.test(code));
check('a missing threat is "UNASSESSED", not "HIGH"', /e\.threat\?\.toUpperCase\(\) \|\| 'UNASSESSED'/.test(main) && !/e\.threat\?\.toUpperCase\(\) \|\| 'HIGH'/.test(main));
check("the cordon names the site's own police district", /Cordon deployed · \$\{_sitePoliceName\}/.test(main) && !/Cordon deployed · Københavns Politi/.test(main));
check('the interceptor outcome uses the event\'s site and its own count',
  /engaged the hostile group over \$\{siteName\(event\.siteId\)\}\. \$\{downedCount\} airframe/.test(main) && !/hostile pack over Amager|Four DJI airframes downed/.test(code));

console.log('\n[the responder comes from the record]');
const killed = { ...bare, neutralisedByDispatchId: 'D-7', counterDispatches: [
  { dispatchId: 'D-3', assetName: 'Københavns Politi patrol car' },
  { dispatchId: 'D-7', assetName: 'Rigspolitiet interceptor swarm' },
  { dispatchId: 'D-9', assetName: 'Hovedstaden ambulance' },
] };
check('no named responder: the dispatch the record says made the kill is named, and only that one',
  respondersOf(killed) === 'Rigspolitiet interceptor swarm' && /by Rigspolitiet interceptor swarm\b/.test(incidentExecSummary(killed, { siteName }))
  && !/patrol car|ambulance/.test(incidentExecSummary(killed, { siteName })));
check('a named responder wins over the dispatch', respondersOf({ ...killed, neutralizedBy: 'F-35, Skrydstrup' }) === 'F-35, Skrydstrup');
check('dispatches on the event but no record of which one killed it: nothing is guessed',
  respondersOf({ ...bare, counterDispatches: killed.counterDispatches }) === null);
check('neither: nothing is invented', respondersOf(bare) === null);
check('the swarm takedown records who did it and when',
  /outcome: overwatchSurvived \? 'partial_neutralisation' : 'neutralized',\s*neutralizedBy: event\.neutralizedBy \|\| d\.assetName \|\| null,\s*neutralizedAt: event\.neutralizedAt \|\| new Date\(\)\.toISOString\(\),/.test(main));
check('no "Fighter Response" fallback anywhere a responder is shown',
  !/\|\| 'Fighter Response'/.test(main) && !/\|\| 'Flyvevåbnet Fighter Response'/.test(main));
check('every responder cell and sentence reads respondersOf', (main.match(/respondersOf\((e|event)\)/g) || []).length >= 5);
check('the PDF header does not default to HIGH or HOSTILE',
  /\(e\.threat \|\| 'UNASSESSED'\)\.toUpperCase\(\)/.test(main) && !/\(e\.threat \|\| 'HIGH'\)/.test(main) && !/\(e\.classification \|\| 'HOSTILE'\)/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
