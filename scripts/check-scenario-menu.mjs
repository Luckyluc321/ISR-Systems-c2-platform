// ═══════════════════════════════════════════════════════════════════
// check:scenario-menu — one scenario list, and no hardcoded default site
// ───────────────────────────────────────────────────────────────────
// [menu] The simulate-threat picker had two lists: THREAT_MENU with a
// `label` per entry, and _SIM_COMPOSER_META with the threat and path
// strings the picker actually showed for 27 keys. Wherever the second
// had an entry, the first one's label was dead text, so renaming a
// scenario in the obvious place changed nothing on screen. The
// Mohajer-2 rename hit exactly that.
//
// Now one list. This gate evaluates the real menu code out of main.js
// and asserts what the picker relies on: every entry names a threat,
// every (threat, path) pair at a site is unique (the pair is how the
// picker finds an entry, so a duplicate is unreachable), and every key
// it would launch is a real template.
//
// [defaults] The Config page opened on 'cph' for every account. An
// instance without CPH started on a site it does not have, and any
// other operator opened it on CPH's destination list.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { TEMPLATES, makeSubstationThreats } from '../src/drones.js';
import { SITES } from '../src/sites_registry.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

// ── menu ───────────────────────────────────────────────────────────
console.log('\n[menu]');
check('the second list is gone', !/const _SIM_COMPOSER_META\b/.test(main) && !/_SIM_COMPOSER_META\[/.test(main));

const start = main.indexOf('  const THREAT_MENU = {');
const end = main.indexOf('  function renderSimPanel()');
check('menu segment found', start > 0 && end > start);
const segment = main.slice(start, end);
check('no entry carries a `label` the picker would ignore', !/\blabel:/.test(segment));

const THREAT_MENU = new Function('SITES', `${segment}\nreturn THREAT_MENU;`)(SITES);

// Same registration main.js does at module init.
const ALL = { ...TEMPLATES };
for (const site of Object.values(SITES).filter(s => s.siteType === 'energy')) {
  Object.assign(ALL, makeSubstationThreats(site.id, site.name, site.coordinates.lat,
    site.coordinates.lon, site.sensors.map(s => s.id)));
}

let entries = 0;
for (const [site, menu] of Object.entries(THREAT_MENU)) {
  check(`${site}: is a site the registry loaded`, !!SITES[site]);
  const seen = new Map();
  for (const t of menu) {
    entries++;
    const path = t.pathLabel || 'Authored route';
    if (typeof t.threat !== 'string' || !t.threat.trim()) {
      check(`${site}/${t.key}: names a threat`, false);
      continue;
    }
    const pair = `${t.threat} | ${path}`;
    if (seen.has(pair)) {
      check(`${site}: "${pair}" is unique`, false, `${seen.get(pair)} and ${t.key} collide; the second can never be launched`);
    }
    seen.set(pair, t.key);
    if (t.module) continue;   // drives itself; resolved from window at launch
    const keys = t.combo ? t.combo.map(c => c.key) : [t.key];
    const missing = keys.filter(k => !ALL[k]);
    if (missing.length) check(`${site}/${t.key}: launches real templates`, false, `missing: ${missing.join(', ')}`);
  }
}
check(`every entry named a threat, paired uniquely and resolved (${entries} entries)`, failures === 0);
check('the picker reads threat and path off the entry itself',
  /threat: t\.threat,\n\s*pathLabel: t\.pathLabel \|\| 'Authored route',/.test(main));

// ── defaults ───────────────────────────────────────────────────────
console.log('\n[defaults]');
check('Config has no literal default site', !/let _configSiteId = ['"`][^'"`]+['"`]/.test(main));
check('Config re-resolves its site against the active account on every render',
  /_configSiteId = _configSiteFor\(_configSiteId, _visibleSiteIds\(\)\);/.test(main));
check('the fallback uses the shared site order, so it matches fly-to',
  /\[\.\.\.visible\]\.sort\(_siteWorkOrder\)\[0\]/.test(main)
  && /\.sort\(_siteWorkOrder\)/.test(main.slice(main.indexOf('function renderSiteLists'))));

if (failures) {
  console.log(`\ncheck:scenario-menu FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:scenario-menu passed');
