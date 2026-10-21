// ═══════════════════════════════════════════════════════════════════
// check:hidden-guards — two mechanical failures that hid themselves
// ───────────────────────────────────────────────────────────────────
// 1. A HIDE IN SCRIPT MUST ACTUALLY HIDE.
//
// The browser hides [hidden] with a UA rule, the lowest priority there
// is, so any author `display` beats it. Three elements were found this
// way in one afternoon, all tenant scoping: .fly-group and
// .fly-group-hdr kept the ENERGINET group on a CPH operator's panel,
// one click from six sites of another tenant, and .cp-section kept an
// ISR-internal render switch in a customer's console. The code read as
// though each was hidden. Each was on screen.
//
// An earlier version of this gate tried to resolve every `x.hidden =`
// back to the selector x was fetched with, then look for a competing
// display rule. It false-positived on one element and MISSED the
// render-profile section, which is risky through its class and not its
// id. A gate that cries wolf gets ignored, which is worse than none.
//
// So the fix moved into the stylesheet as one blanket rule, and this
// asserts the rule is there. It covers every element, including ones
// nobody has written yet.
//
// 2. A <select> CHANGED IN CODE MUST ANNOUNCE IT.
//
// Assigning .value fires no change event, so every listener keeps the
// previous value. That is how the simulate-threat selector came to read
// "Copenhagen Airport" above a list of Billund's scenarios.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

console.log('\n[hidden] defeats author display');
check('the blanket [hidden] rule exists',
  /^\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/m.test(css),
  'src/style.css must carry  [hidden] { display: none !important; }  near the '
  + 'top. Without it any author display rule silently beats the browser\'s own '
  + '[hidden], and every .hidden = true in the codebase becomes a no-op on '
  + 'exactly the elements that style themselves.');

console.log('\nSelects changed in code announce it');
const lines = js.split('\n');
let seen = 0;
for (let i = 0; i < lines.length; i++) {
  if (!/\b\w*[Ss]el(?:ect)?\w*\.value\s*=/.test(lines[i])) continue;
  if (/\.value\s*=\s*keep\b/.test(lines[i])) continue;   // restoring what was already set
  seen++;
  const near = lines.slice(i, i + 8).join('\n');
  check(`main.js:${i + 1} dispatches a change`, /dispatchEvent/.test(near),
    `${lines[i].trim().slice(0, 88)}\n       Assigning .value fires no change event, `
    + 'so every listener keeps the previous value.');
}
if (!seen) console.log('  (no programmatic select assignments)');

if (failures) {
  console.log(`\ncheck:hidden-guards FAILED — ${failures} issue${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:hidden-guards passed');
