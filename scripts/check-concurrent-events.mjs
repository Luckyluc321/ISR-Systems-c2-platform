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
import { concurrentEvents, buildConcurrentBlock, separationM } from '../src/concurrent_events.js';

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

if (failures) {
  console.log(`\ncheck:concurrent-events FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:concurrent-events passed');
