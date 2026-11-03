// ═══════════════════════════════════════════════════════════════════
// check:mission-console: an agency dispatches its own units
// ───────────────────────────────────────────────────────────────────
// Audit of 2026-10-30: the Mission Console chose "your units" by unit
// type. Københavns Politi got Rigspolitiet's national drone response
// with its own Dispatch button, Rigspolitiet got Københavns Politi's
// district unit, and the dispatch was saved with no owner, so the live
// response credited "Operator" and the agency got no chapter in the
// report. This gate holds src/mission_console_scope.js over the real
// account tree and ownership table, and the wiring in main.js.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { ACCOUNTS } from '../src/roles.js';
import { COMMAND_AUTHORITY, canDispatchUnit } from '../src/mission_console_scope.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const role = (id) => ACCOUNTS.find((r) => r.id === id);
const may = (rid, asset) => canDispatchUnit(role(rid), asset);

console.log('\n[the Copenhagen Airport case from the audit]');
check('Københavns Politi dispatches its own unit', may('politi-kbh', 'politi-kbh-cuas'));
check("Københavns Politi does not dispatch Rigspolitiet's units", !may('politi-kbh', 'politi-national-cuas') && !may('politi-kbh', 'politi-slotsholmen-interceptor'));
check('Rigspolitiet dispatches its own units', may('rigspoliti', 'politi-national-cuas') && may('rigspoliti', 'politi-slotsholmen-interceptor'));
check("Rigspolitiet does not dispatch Københavns Politi's unit", !may('rigspoliti', 'politi-kbh-cuas'));

console.log('\n[defence]');
check('a garrison dispatches its own units, not another garrison\'s', may('haer-varde', 'army-varde-cuas') && !may('haer-varde', 'army-oksbol-training'));
check('Karup dispatches its helicopter, Skrydstrup does not', may('flv-karup', 'flv-karup-helo-intercept') && !may('flv-skrydstrup', 'flv-karup-helo-intercept'));
check('a branch dispatches the units below it in the tree', may('haeren', 'army-varde-cuas') && may('flyvevaabnet', 'flv-karup-helo-intercept'));
check('Forsvarskommandoen keeps command of every defence unit',
  ['army-varde-cuas', 'army-oksbol-training', 'flv-karup-helo-intercept', 'sof-aalborg-jaeger'].every((a) => may('forsvarskmd', a)));
check('...and no police unit', !may('forsvarskmd', 'politi-kbh-cuas') && !may('forsvarskmd', 'politi-national-cuas'));
check('the only command beyond the tree is Forsvarskommandoen over Forsvaret',
  JSON.stringify(COMMAND_AUTHORITY) === '{"forsvarskmd":["forsvaret"]}' && Object.isFrozen(COMMAND_AUTHORITY));

console.log('\n[fail closed]');
check('a unit with no known owner is nobody\'s', !may('politi-kbh', 'no-such-unit') && !may('rigspoliti', undefined));
check('no account, no dispatch', canDispatchUnit(null, 'politi-kbh-cuas') === false);
check('admin may dispatch anything', canDispatchUnit({ kind: 'admin', id: 'admin-isr' }, 'politi-national-cuas'));
check('a cycle in the tree cannot hang the check',
  canDispatchUnit({ kind: 'receiver', id: 'x' }, 'u', { ownerOf: () => 'a', parentOf: (id) => (id === 'a' ? 'b' : 'a') }) === false);

console.log('\n[main.js]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('the console splits units by ownership, not by kind',
  /const canDispatchMc = \(asset\) => canDispatchUnit\(activeRole, asset\?\.id\);/.test(main)
  && /canDispatchMc\(a\)\);\s*const otherList = tactical\.filter\(a => DISPATCHABLE_KINDS_MC\.has\(a\.kind\) && !canDispatchMc\(a\)\);/.test(main)
  && !/roleScopeMc \? roleScopeMc\.has\(kind\)/.test(main));
check("a receiver cannot dispatch another agency's counter-drone unit by any button",
  /getActiveRole\(\)\?\.kind === 'receiver' && bundle\.tactical\.includes\(asset\) && !canDispatchUnit\(getActiveRole\(\), asset\.id\)/.test(main));
check('the dispatch records who sent it, so the report credits the agency',
  /dispatchCounterResponse\(id, asset, \{ \.\.\.\(units > 1 \? \{ swarmSize: units \} : \{\}\), ownerRoleId: _dispatchOwner \}\);/.test(main));

console.log('\n[a counter-drone role that owns none of the units in play]');
check('falls back to the units it does own, instead of "You hold no units"',
  /const _mcNoOwnCounterDrone = !roleScopeMc \|\| \(roleScopeMc\.size > 0 && mineList\.length === 0\);/.test(main)
  && /const _mcOwnSpec = \(_mcNoOwnCounterDrone && /.test(main));
check('Energinet keeps its deliberately empty table entry', /'op-energinet':\s*new Set\(\[\]\)/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
