// ═══════════════════════════════════════════════════════════════════
// check:nn-integration-index — the routing page stays true
// ───────────────────────────────────────────────────────────────────
// docs/nn-integration-contract.md is the one page an edge or infra
// engineer starts from. An index that rots is worse than none: it sends
// someone to a file that moved, or promises a field the validator no
// longer requires. So the claims it makes that CAN be checked, are.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const page = read('docs/nn-integration-contract.md');
let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

console.log('\nEvery file the page routes to exists');
const docRefs = [...new Set([...page.matchAll(/`([a-z0-9_-]+\.md)`/g)].map(m => m[1]))];
for (const f of docRefs) check(`docs/${f}`, existsSync(new URL(`docs/${f}`, root)));
const srcRefs = [...new Set([...page.matchAll(/`src\/([a-z0-9_/-]+\.js)`/g)].map(m => m[1]))];
for (const f of srcRefs) check(`src/${f}`, existsSync(new URL(`src/${f}`, root)));

console.log('\nThe IDD says the same thing in its index as in its body');
const idd = read('docs/interface-design-document.md');
const row = idd.match(/\| IF-1 \| Sensor node to C2 ingest \| ([^|]+) \|/);
const body = /## IF-1\. Sensor node to C2 ingest `\[live\]`/.test(idd);
check('IF-1 is [live] in both the index row and the section heading',
  row && /\[live\]/.test(row[1]) && body,
  `index row says ${row ? row[1].trim() : '(missing)'}, body heading is ${body ? '[live]' : 'not [live]'}. `
  + 'A partner reading the table would believe the ingest seam is unbuilt.');

console.log('\nThe track fields the page calls required really are');
const ts = read('src/track_source.js');
for (const f of ['object_id', 'node_id', 'site_id']) {
  check(`${f} is required by trackRejectionReason`,
    new RegExp(`isNonEmptyString\\(track\\.${f}\\)\\) return 'missing_${f}'`).test(ts),
    `the page promises an edge engineer that a track without ${f} is rejected`);
}
check('the page does not promise a datum C2 does not define',
  /WGS84_E/.test(ts) && /WGS84_G/.test(ts));

console.log('\nThe live message types the page lists are handled');
const ls = read('src/live_sensor.js');
for (const t of ['detection', 'sensor_online', 'heartbeat', 'status', 'bridge-closed']) {
  check(`'${t}' has a case in handleFeedMessage`, new RegExp(`case '${t}'`).test(ls));
}

console.log('\nProvenance survives to the event, as the page claims');
check('template events carry source: sim', /source: 'sim',/.test(read('src/main.js')));
check('live events carry source: live', /source: LIVE_SOURCE,/.test(ls));

console.log('\nThe open-questions status the page reports matches the register');
const oq = read('docs/open-questions.md');
for (const q of ['Q1', 'Q2', 'Q5']) {
  const sec = oq.slice(oq.indexOf(`### ${q} ·`));
  check(`${q} is recorded as answered`, /ANSWERED 2026-10-22/.test(sec.slice(0, 1500)));
}
check('Q7 is recorded as closed', /ANSWERED AND CLOSED/.test(oq.slice(oq.indexOf('### Q7 ·'), oq.indexOf('### Q7 ·') + 1500)));
check('Q4 is still open, and the page says so',
  !/ANSWERED|RESOLVED/.test(oq.slice(oq.indexOf('### Q4 ·'), oq.indexOf('### Q5 ·')))
  && /Q4 — interceptor targeting/.test(page));

console.log('\nThe page lists the gates that back it, and they exist');
const pkg = JSON.parse(read('package.json'));
for (const g of ['check:track-identity', 'check:live-sensor', 'check:signal-tier', 'check:coverage-gate']) {
  check(`${g} is a registered script`, typeof pkg.scripts[g] === 'string');
}

if (failures) {
  console.log(`\ncheck:nn-integration-index FAILED — ${failures} issue${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:nn-integration-index passed');
