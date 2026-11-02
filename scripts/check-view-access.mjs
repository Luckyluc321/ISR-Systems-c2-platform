// ═══════════════════════════════════════════════════════════════════
// check:view-access: a receiver sees its console and nothing else
// ───────────────────────────────────────────────────────────────────
// docs/user-flows.md gives a receiver its inbox, the brief and its
// responses. The 2026-10-30 audit found History, Fleet and Config one
// click away for every receiver: every customer's sensors, and any
// site's escalation chain and rules open for editing. This gate holds
// the table in src/view_access.js and every route in main.js that could
// get round it.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { VIEWS_BY_KIND, canOpenView, viewsFor } from '../src/view_access.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const ALL = ['live', 'history', 'fleet', 'config'];
console.log('\n[the table]');
check('admin opens every view', ALL.every((v) => canOpenView({ kind: 'admin' }, v)));
check('an operator opens every view', ALL.every((v) => canOpenView({ kind: 'operator' }, v)));
check('a receiver opens its console (live) only',
  canOpenView({ kind: 'receiver' }, 'live') && ['history', 'fleet', 'config'].every((v) => !canOpenView({ kind: 'receiver' }, v)));
check('an unknown kind, or no account, gets live only (fail closed)',
  JSON.stringify(viewsFor({ kind: 'auditor' })) === '["live"]' && JSON.stringify(viewsFor(null)) === '["live"]' && JSON.stringify(viewsFor(undefined)) === '["live"]');
check('an unknown view is never open', !canOpenView({ kind: 'admin' }, 'secrets'));
check('the table cannot be changed at runtime', Object.isFrozen(VIEWS_BY_KIND) && Object.isFrozen(VIEWS_BY_KIND.receiver));

console.log('\n[the routes in main.js]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('setActiveView turns any view the account may not open into live',
  /function setActiveView\(view\) \{[\s\S]{0,200}if \(!canOpenView\(getActiveRole\(\), view\)\) view = 'live';\s*_activeView = view;/.test(main));
check('the tab bar hides what the account may not open, on every account switch',
  /function updateOperatorChip\(\) \{[\s\S]*?b\.style\.display = canOpenView\(r, b\.dataset\.view\) \? '' : 'none';[\s\S]{0,120}if \(!canOpenView\(r, _activeView\)\) setActiveView\('live'\);/.test(main));
check('the escalation-chain editor refuses an account without Config',
  /window\.__openConfigModal = \(\) => \{[\s\S]{0,200}if \(!canOpenView\(getActiveRole\(\), 'config'\)\) return;\s*configBackdrop\.style\.display = 'flex';/.test(main));
check('the rules editor refuses an account without Config',
  /window\.__openRulesModal = \(\) => \{\s*if \(!canOpenView\(getActiveRole\(\), 'config'\)\) return;\s*rulesBackdrop\.style\.display = 'flex';/.test(main));
const opens = (main.match(/configBackdrop\.style\.display = 'flex'|rulesBackdrop\.style\.display = 'flex'/g) || []).length;
check('the editors open from those two places only', opens === 2, `found ${opens}`);
const views = (main.match(/setActiveView\('(history|fleet|config)'\)/g) || []);
check('nothing jumps straight to History, Fleet or Config past the guard', views.length === 0, views.join(', '));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
