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
  siteLoadErrorsLabel, escapeHtml,
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

// ── A rejected site manifest is visible, to admin only ─────────────
console.log('\n[rejected site files]');
const _errs = [{ file: '/sites/kobmagergade57.yaml', error: 'site_type "office" not in enum' }];
const _admin = { kind: 'admin' };
const _op = { kind: 'operator', siteIds: ['cph'] };
const _rcv = { kind: 'receiver' };
const _lab = siteLoadErrorsLabel(_errs, _admin);
check('admin sees a rejected site file', _lab && _lab.text === '1 site file rejected');
check('the tooltip names the file and the reason', _lab && /kobmagergade57\.yaml: site_type "office"/.test(_lab.title));
check('plural reads as plural', siteLoadErrorsLabel([..._errs, ..._errs], _admin)?.text === '2 site files rejected');
check('an operator never sees it', siteLoadErrorsLabel(_errs, _op) === null,
  'a file name and validation message describe other tenants\' configuration');
check('a receiver never sees it', siteLoadErrorsLabel(_errs, _rcv) === null);
check('nothing rejected, nothing shown', siteLoadErrorsLabel([], _admin) === null);
check('no role, nothing shown', siteLoadErrorsLabel(_errs, null) === null);
check('escapeHtml neutralises markup and quotes',
  escapeHtml('<b x="1">\'&') === '&lt;b x=&quot;1&quot;&gt;&#39;&amp;');
const _main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('updateStatusBar renders it in the Scope cell, escaped',
  /siteLoadErrorsLabel\(_siteLoaderErrors, getActiveRole\(\)\)/.test(_main)
  && /title="\$\{escapeHtml\(_rej\.title\)\}"/.test(_main)
  && /\$\{escapeHtml\(_rej\.text\)\}/.test(_main));

if (failures) {
  console.log(`\ncheck:status-bar FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:status-bar passed');
