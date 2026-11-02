// ═══════════════════════════════════════════════════════════════════
// check:national-reach: every national agency is reachable from every site
// ───────────────────────────────────────────────────────────────────
// Audit of 2026-10-30: PET, FE, Rigspolitiet, Beredskabsstyrelsen,
// Forsvarskommandoen, the Hæren garrisons, Jægerkorpset, Karup and
// Skrydstrup held endpoints at the first eight sites only. An escalation
// to them from Billund, Odense or Amager reached no inbox, and a Billund
// receiver's "Cascade to intelligence services" said no FE or PET was
// configured. This gate holds the destination pass in destinations.js
// and the account rules applied by auto_destinations.js, using the same
// code main.js runs at boot.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { RECEIVERS } from '../src/roles.js';
import { NATIONAL_SERVICE_SUFFIXES, getAllDestinations } from '../src/destinations.js';
import { applyAutoDestinations } from '../src/auto_destinations.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const dests = getAllDestinations();
applyAutoDestinations(RECEIVERS, dests);
const sites = [...new Set(dests.map((d) => d.siteId).filter((s) => s != null))].sort();

console.log(`\n[every site has the national services] (${sites.length} sites)`);
for (const suffix of NATIONAL_SERVICE_SUFFIXES) {
  const missing = sites.filter((s) => !dests.some((d) => d.siteId === s && d.id.endsWith(`-${suffix}`)));
  check(`${suffix} at every site`, missing.length === 0, `missing at ${missing.join(', ')}`);
}
check('Billund, Odense and Amager are among the sites checked',
  ['billund', 'odense', 'energinet_amager_koblingsstation'].every((s) => sites.includes(s)));
const ids = dests.map((d) => d.id);
check('no destination id appears twice', new Set(ids).size === ids.length, ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));

console.log('\n[every national agency holds an endpoint at every site]');
const NATIONAL = ['pet', 'fe', 'beredskab', 'rigspoliti', 'forsvarskmd', 'haer-slagelse', 'haer-hovelte',
  'haer-varde', 'haer-bornholm', 'haer-oksbol', 'sok-aalborg', 'flv-karup', 'flv-skrydstrup', 'politi-aks'];
const siteOf = new Map(dests.map((d) => [d.id, d.siteId]));
for (const id of NATIONAL) {
  const r = RECEIVERS.find((x) => x.id === id);
  if (!r) { check(`${id} exists`, false); continue; }
  const held = new Set((r.destinationIds || []).map((d) => siteOf.get(d)).filter(Boolean));
  const missing = sites.filter((s) => !held.has(s));
  check(`${id} reaches all ${sites.length} sites`, missing.length === 0, `not at ${missing.join(', ')}`);
}
check('every id an agency holds resolves to a real site endpoint',
  NATIONAL.every((id) => (RECEIVERS.find((x) => x.id === id)?.destinationIds || []).every((d) => siteOf.has(d))));

console.log('\n[the right endpoint for the right base]');
const sky = RECEIVERS.find((x) => x.id === 'flv-skrydstrup');
const kar = RECEIVERS.find((x) => x.id === 'flv-karup');
check("Skrydstrup holds Billund's and Odense's Skrydstrup entries, not their Karup ones",
  ['bll-t4-qra-skrydstrup', 'ode-t4-qra-skrydstrup'].every((d) => sky.destinationIds.includes(d))
  && !['bll-t4-qra', 'ode-t4-qra'].some((d) => sky.destinationIds.includes(d)));
check("Karup holds Billund's and Odense's Karup entries",
  ['bll-t4-qra', 'ode-t4-qra'].every((d) => kar.destinationIds.includes(d)));

console.log('\n[the Billund case that failed]');
const bll = new Set(dests.filter((d) => d.siteId === 'billund').map((d) => d.id));
const reach = (rid) => (RECEIVERS.find((x) => x.id === rid)?.destinationIds || []).filter((d) => bll.has(d));
check('"Cascade to intelligence services" finds FE and PET at Billund', reach('fe').length > 0 && reach('pet').length > 0);

console.log('\n[wiring]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const dsrc = readFileSync(new URL('../src/destinations.js', import.meta.url), 'utf8');
check('main.js applies the account rules with the shared function', /applyAutoDestinations\(RECEIVERS, getAllDestinations\(\)\);/.test(main));
check('the national pass runs after a saved browser edit replaces the catalogue',
  dsrc.indexOf('DESTINATIONS.push(...overrides);') > -1
  && dsrc.indexOf('for (const suffix of NATIONAL_SERVICE_SUFFIXES)') > dsrc.indexOf('DESTINATIONS.push(...overrides);'));
check('Billund and Odense get the universal endpoints too', /billund: 'bll',/.test(dsrc) && /odense: 'ode',/.test(dsrc));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
