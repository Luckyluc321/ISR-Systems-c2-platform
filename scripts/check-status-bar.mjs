// ═══════════════════════════════════════════════════════════════════
// check:status-bar — the system cells report truth or report nothing
// ───────────────────────────────────────────────────────────────────
// Five cells shipped as literal text in index.html that nothing in
// main.js ever referenced: a frozen uptime of 47:23:15, an invented
// 112 ms, a made-up model version, a hardcoded "nominal", and a
// personal username visible to every customer.
//
// The failure mode is silent and permanent: static markup looks live
// because everything around it is. So this asserts the markup is inert
// and that absence renders as absence.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import {
  formatUptime, sessionLabel, modelLabel, backendLabel, latencyLabel,
} from '../src/status_bar.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bar = html.slice(html.indexOf('<footer id="status-bar">'), html.indexOf('</footer>') + 9);

console.log('\nNo invented telemetry in the markup');
for (const [what, re] of [
  ['a frozen uptime',        /\d+:\d{2}:\d{2}/],
  ['a latency reading',      /\d+\s*ms/],
  ['a model version',        /v\d+\.\d+/],
  ['a personal username',    /lucasaflindt/i],
  ['a hardcoded health word',/\bnominal\b/i],
]) {
  check(`${what} is not written into index.html`, !re.test(bar),
    `the status bar markup still contains ${what}. These cells are rendered by `
    + 'status_bar.js from live state; a literal here is invisible to every '
    + 'reader because static markup looks live when it sits beside real cells.');
}

console.log('\nEvery cell is addressable');
for (const id of ['sb-sensors', 'sb-site-scope', 'sb-model', 'sb-latency', 'sb-backend', 'sb-uptime', 'sb-session']) {
  check(`#${id} exists`, bar.includes(`id="${id}"`), `${id} is missing from the footer`);
}

console.log('\nAbsence renders as absence, never as a plausible number');
check('unmeasured latency is an em dash',
  latencyLabel(null) === '—' && latencyLabel(undefined) === '—' && latencyLabel(-1) === '—',
  `got ${latencyLabel(null)}. A number nothing measured is the single most `
  + 'damaging thing this bar can show, because it cannot be told apart from one '
  + 'that was measured.');
check('a measured latency is reported',
  latencyLabel(112.4) === '112 ms', latencyLabel(112.4));
check('no feeds reads as local, not as healthy',
  backendLabel([]) === 'local' && backendLabel([{ active: false }]) === 'local',
  `got ${backendLabel([])}. "nominal" with nothing connected is the old bug.`);
check('a mock feed is not reported as live',
  backendLabel([{ active: true, providerName: 'mock' }]).startsWith('mock'),
  backendLabel([{ active: true, providerName: 'mock' }]));

console.log('\nThe cells say what is actually true');
check('the session is the person and org, never a username',
  sessionLabel({ person: 'M. Sørensen', org: 'CPH Airports A/S' }) === 'M. Sørensen · CPH Airports A/S'
  && sessionLabel(null) === '—',
  sessionLabel({ person: 'M. Sørensen', org: 'CPH Airports A/S' }));
check('an all-mock fleet is reported as mock',
  modelLabel(['cph'], { cph: { source: 'mock' } }) === 'mock',
  'every site currently ships against mock, and the bar must say so rather '
  + 'than carry a version string nobody set.');
check('a mixed fleet names its parts instead of inventing a version',
  modelLabel(['a', 'b'], { a: { source: 'mock' }, b: { source: 'live' } }) === 'live + mock',
  'the old value was "v0.2-mixed", which looked like a release and was not one.');
check('uptime counts from zero',
  formatUptime(0) === '0:00:00' && formatUptime(3 * 3600000 + 4 * 60000 + 11000) === '3:04:11',
  formatUptime(0));

// ── tenant isolation ───────────────────────────────────────────────
// A CPH operator read "Sensors 126/130 online · Scope All sites". The
// totals are every tenant's hardware added together, and "all sites"
// told an account that owns one site of ten that the fleet was theirs.
//
// The counting was already scoped. Two things were not: the LABEL, and
// the fact that nothing recomputed either on an account switch, so the
// cells kept the values derived at boot as admin.
const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

const roleChange = mainJs.slice(mainJs.lastIndexOf('onRoleChange(() => {'));
check('the status bar is recomputed when the account changes',
  /updateStatusBar\(/.test(roleChange.slice(0, 4000)),
  'onRoleChange re-scopes the globe, the fly-to list and the ledger but not '
  + 'the status bar, so its cells keep whatever account was active at boot. '
  + 'That is how an operator came to read another tenant\'s sensor total.');

const usb = mainJs.slice(mainJs.indexOf('function updateStatusBar('));
check('the scope label is scoped too, not just the totals',
  /kind === 'operator'/.test(usb.slice(0, 2600)),
  '"All sites" is a claim. It is true for admin and false for an operator, '
  + 'and it sat next to a correctly scoped number, which makes the number '
  + 'look like the fleet total rather than their own.');

// ── hiding has to actually hide ────────────────────────────────────
// applyFlyToScope hides a multi-site operator's group with
// `grp.hidden = true`. The browser's [hidden] rule is the weakest there
// is, so any author `display` wins. .fly-group sets display: flex and
// its header sets it !important, so a CPH operator was shown the
// ENERGINET group one click from another tenant's sites.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
for (const sel of ['.fly-group[hidden]', '.fly-group-hdr[hidden]', '.cp-btn[hidden]']) {
  check(`${sel} is defined`, css.includes(sel),
    `${sel} has an author display rule, so setting .hidden on it does nothing. `
    + 'Anything hidden by script needs a matching [hidden] rule at the same '
    + 'specificity or the element stays on screen.');
}

if (failures) {
  console.log(`\ncheck:status-bar FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:status-bar passed');
