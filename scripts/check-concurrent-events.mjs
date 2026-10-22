// ═══════════════════════════════════════════════════════════════════
// check:concurrent-events — selection only, and scoped
// ───────────────────────────────────────────────────────────────────
// This module hands the agent a list of what else is live at a site. It
// is NOT a correlator: main.js already has one, it answers "is this the
// same object later", and its kinematic gate correctly refuses to link
// a recon track at one end of an airport to a swarm at the other. The
// question this serves is the other one, "are these acting together
// now", and no rule here is allowed to answer it. The agent judges.
//
// So the assertions are about restraint: what it must never do.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { concurrentEvents, buildConcurrentBlock, separationM, concurrentPanelLines, coordinationReadingFor } from '../src/concurrent_events.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const mk = (id, siteId, lat, lon, o = {}) => ({
  id, siteId, status: o.status || 'active',
  lastPosition: { lat, lon },
  droneType: o.type || 'DJI Matrice 300',
  classification: o.cls || 'hostile', threat: 'high',
  startTime: new Date(Date.now() - 30000).toISOString(),
  detected: o.detected,
});
const swarm = mk('DET-1', 'cph', 55.6164, 12.6899);
const recon = mk('DET-2', 'cph', 55.6300, 12.6100, { type: 'Mohajer-2' });
const all = [
  swarm, recon,
  mk('DET-3', 'billund', 55.74, 9.15),
  mk('DET-4', 'cph', 55.62, 12.65, { detected: false }),
  mk('DET-5', 'cph', 55.62, 12.66, { status: 'closed' }),
];
const ids = concurrentEvents(swarm, all).map(c => c.id);

console.log('\nIt selects the right things');
check('a concurrent track at the same site is returned', ids.includes('DET-2'));
check('a lone event returns nothing', concurrentEvents(swarm, [swarm]).length === 0);
check('separation is measured', separationM(swarm, recon) > 5000);

console.log('\nIt refuses the wrong things');
check('ANOTHER TENANT\'S SITE is never included', !ids.includes('DET-3'),
  'a tenant must not learn that another tenant\'s site is busy');
check('an undetected track is not an event here either', !ids.includes('DET-4'),
  'same rule the ledger and the threat banner follow: no sensor heard it, so '
  + 'the platform does not get to mention it');
check('a closed event is precedent, not concurrency', !ids.includes('DET-5'),
  'precedent_retrieval.js already owns closed events');
check('a FRIENDLY aircraft is not concurrent activity',
  !concurrentEvents(swarm, [swarm, mk('DET-6', 'cph', 55.62, 12.66, { cls: 'friendly' })])
    .some(c => c.id === 'DET-6'),
  'CPH handles about a thousand movements a day. A filed, transponder-tracked '
  + 'airliner sharing a site with a drone is the normal state of an airport. '
  + 'Listing it invites the exact failure this module avoids: asked what two '
  + 'concurrent tracks might mean, a model will find a meaning.');
check('an UNKNOWN track is still listed',
  concurrentEvents(swarm, [swarm, mk('DET-7', 'cph', 55.62, 12.66, { cls: 'unknown' })])
    .some(c => c.id === 'DET-7'),
  'an unidentified track at the other end of the site is precisely what an '
  + 'operator needs told; only friendly is excluded');

console.log('\nIt stays inside its remit');
const src = readFileSync(new URL('../src/concurrent_events.js', import.meta.url), 'utf8');
check('it never writes linkedEventIds', !/linkedEventIds\s*(=|\.push)/.test(src),
  'that field records CONFIRMED continuity from the deterministic correlator. An '
  + 'agent reading is an inference, and mixing them destroys the one distinction '
  + 'the Post-Incident Report exists to preserve.');
check('it mutates nothing at all', !/mutateEvent|linkEvents\(|addNote\(/.test(src));
check('it scores no coordination of its own',
  !/score|weight|threshold/i.test(src.replace(/\/\/.*$/gm, '')),
  'C2 runs no rule-based classifiers. Selection is deterministic; judgement is '
  + 'the agent\'s.');

const block = buildConcurrentBlock(swarm, all);
console.log('\nThe prompt block is honest');
check('it states no link has been established', /NOT because any link/.test(block));
check('it forbids recommending an action', /Do NOT recommend an action/.test(block),
  'detection-only, same guard precedent retrieval uses');
check('it invites the agent to say "no"', /often coincidence/.test(block),
  'a model asked only to find patterns will find them');
check('it is empty when nothing is concurrent', buildConcurrentBlock(swarm, [swarm]) === '',
  'a quiet site must cost no tokens');

// ── step 2: the agent is told, and only when there is something ────
// The property that matters is that a quiet site produces a prompt
// BYTE-IDENTICAL to today's. The chain: buildConcurrentBlock returns ''
// -> main.js stores null -> concurrentSection is '' -> .filter(Boolean)
// drops it from the prompt array entirely.
const agent = readFileSync(new URL('../src/agents/agent_b_debrief.js', import.meta.url), 'utf8');
const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

console.log('\nThe agent receives it');
check('the debrief builder accepts a concurrentBlock',
  /const concurrentBlock = opts\.concurrentBlock;/.test(agent));
check('it becomes a section only when present',
  /const concurrentSection = concurrentBlock \? \[/.test(agent),
  'a falsy block must yield an empty string, not the word undefined');
check('the section is placed in the user prompt',
  /concurrentSection,/.test(agent.slice(agent.indexOf('const userPrompt'))));
check('an empty section is dropped from the prompt entirely',
  /\]\.filter\(Boolean\)\.join/.test(agent),
  'without filter(Boolean) a quiet site would add a blank line to every '
  + 'prompt, which is a change to a working path for no reason');
check('main.js builds it from the TENANT-SCOPED list',
  /_buildConcurrentBlock\(event, visibleEvents\(\)/.test(mainJs),
  'visibleEvents() is actor-filtered. Passing the raw EVENTS array here would '
  + 'tell one tenant that another tenant\'s site is busy, in a prompt.');
check('a build failure cannot break the debrief',
  /\[concurrent_events\] build failed/.test(mainJs),
  'wrapped in try/catch like the precedent block beside it');

// ── the measured checklist, and where identity came from ───────────
// Every field here is arithmetic over the event record. The point is
// that it stays true with the model unreachable: the net eventually
// supplies WHAT a thing is, the checklist supplies where and when, and
// the agent is asked only the question neither can answer.
const centre = { lat: 55.6085, lon: 12.6350 };
const A = mk('A', 'cph', 55.5900, 12.6100);
const B = mk('B', 'cph', 55.6200, 12.6900);
A.startTime = new Date(Date.now() - 520000).toISOString();
B.startTime = new Date(Date.now() - 280000).toISOString();
const [row] = concurrentEvents(A, [A, B], { siteCentre: centre });

console.log('\nThe checklist is arithmetic, not inference');
check('bearing from the site centre is reported', row.bearingDeg != null);
check('opposite ends is detected', row.approach === 'opposite ends',
  `got ${row.approach} at ${row.bearingSeparationDeg} deg apart`);
check('which track appeared first is reported', row.appearedAfterSec === 240,
  `got ${row.appearedAfterSec}`);
check('with no site centre it degrades instead of throwing',
  concurrentEvents(A, [A, B])[0].bearingDeg === null,
  'the module takes the centre as an argument and never reaches for the '
  + 'site registry itself');

console.log('\nIdentity provenance survives into the agent prompt');
check('a template event declares source sim',
  /source: 'sim',/.test(readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')),
  'nn_source.js tags every detection sim or live and says tagging is cheap now '
  + 'and impossible to retrofit. Events dropped it, so a scenario-authored '
  + 'identity and a detected one were indistinguishable downstream.');
check('the checklist carries identitySource', row.identitySource != null);
const liveB = { ...B, source: 'live' };
check('a live identity is named as such in the block',
  /identity from a live detector/.test(buildConcurrentBlock(A, [A, liveB], { siteCentre: centre })));
check('a simulated identity is named as such too',
  /identity from a simulation, not a detector/.test(buildConcurrentBlock(A, [A, B], { siteCentre: centre })),
  'the agent must not read an authored identity as a detected one');


// ── The panel: measured lines, and a coordination line every time ──
console.log('\n[panel]');
const _panelList = concurrentEvents(A, [A, B], { siteCentre: centre });
const _lines = concurrentPanelLines(_panelList);
check('one panel line per concurrent track', _lines.length === _panelList.length && _lines.length > 0);
check('a panel line carries distance and approach, no confidence',
  /km away|m away/.test(_lines[0]) && !/confidence/i.test(_lines[0]));
const _none = coordinationReadingFor({ id: 'X' });
check('no model reading: says "not assessed", never silent',
  _none.assessed === false && /Not assessed\. Inference not connected\./.test(_none.text));
const _bad = coordinationReadingFor({ coordinationReading: { text: 'Coordinated', confidence: 'certain' } });
check('a reading without a valid confidence is not shown as assessed', _bad.assessed === false);
const _ok = coordinationReadingFor({ coordinationReading: { text: ' No coordination indicated. ', confidence: 'low', modelVersion: 'mistral-large-2' } });
check('a structured reading renders with confidence and model version',
  _ok.assessed && _ok.text === 'No coordination indicated.' && _ok.confidence === 'low' && _ok.modelVersion === 'mistral-large-2');
const _main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('the panel row reads the tenant-scoped list',
  /_concurrentEvents\(e, visibleEvents\(\) \|\| \[\]/.test(_main));
check('the coordination line renders whenever the concurrent row does',
  /const _coord = _conc\.length \? _coordinationReadingFor\(e\) : null;/.test(_main)
  && /\$\{concurrentRow\}/.test(_main) && /\$\{coordinationLines\}/.test(_main));
check('panel text is escaped (identity will come from the net)',
  /escapeHtml\(l\)/.test(_main) && /escapeHtml\(_coord\.text\)/.test(_main));
check('a panel line says where the identity came from',
  /· simulated$/.test(concurrentPanelLines(concurrentEvents(A, [A, B], { siteCentre: centre }))[0])
  && /· live detection$/.test(concurrentPanelLines(concurrentEvents(A, [A, { ...B, source: 'live' }], { siteCentre: centre }))[0]));
check('a track that appeared in the same second reads as the same time',
  /appeared at the same time/.test(concurrentPanelLines([{ droneType: 'X', classification: 'hostile', appearedAfterSec: 0 }])[0]));
check('the panel counts what it is not showing',
  /maxEvents: Infinity/.test(_main) && /\+ \$\{_concMore\} more at this site/.test(_main));
check('a coordination confidence never borrows the hostile verdict colour',
  /mc-conf mc-conf-neutral">Confidence · \$\{_coord\.confidence/.test(_main) && !/mc-conf-\$\{_coord\.confidence\}/.test(_main));
check('nothing in the panel path writes linkedEventIds',
  !/_concurrentEvents\([\s\S]{0,600}linkedEventIds\s*=/.test(_main));

if (failures) {
  console.log(`\ncheck:concurrent-events FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:concurrent-events passed');
