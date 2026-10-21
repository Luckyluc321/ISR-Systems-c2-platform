// Gate: every event that declares multiSiteTrack must also declare
// coverageGatedTrack.
//
// The coverage block reads coverageGatedTrack. Splitting one flag into
// two and setting the new one in only the template constructor left two
// direct creation sites — the breakaway promotion and the per-site
// linked event — writing undefined. The coverage block then never ran
// for them, inAnyCoverage stayed null, and OUT OF RANGE never fired for
// an escaping drone.
//
// A grep is enough to stop that recurring, and a grep that runs is worth
// more than a rule nobody remembers.
import fs from 'fs';

const src = fs.readFileSync('src/main.js', 'utf8').split('\n');
const bad = [];
src.forEach((line, i) => {
  if (line.trim() !== 'multiSiteTrack: true,') return;
  const window = src.slice(i, i + 14).join('\n');
  if (!/coverageGatedTrack:/.test(window)) bad.push(i + 1);
});

if (bad.length) {
  console.error(`✗ multiSiteTrack set without coverageGatedTrack at line(s): ${bad.join(', ')}`);
  console.error('  The coverage check reads coverageGatedTrack. An event missing it');
  console.error('  never evaluates coverage, so OUT OF RANGE and the coverage');
  console.error('  transitions silently stop firing for that track.');
  process.exit(1);
}
// ── An undetected track is not an event ────────────────────────────
// detected === false means no sensor has ever heard it. The ledger
// honoured that already, via filteredEvents(). The detail panel did
// not: selecting the drone's own model on the map opened a card reading
// "Track inferred from cross-cue but not yet inside sensor coverage".
//
// In the WITHOUT ISR run every sensor at the site is off, which is the
// premise of the clip, so nothing cued anything and the card invented
// the inference it reported.
const mainSrc = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const rdp = mainSrc.slice(mainSrc.indexOf('function renderDetailPanel()'));

if (!/if \(!e \|\| e\.detected === false\)/.test(rdp.slice(0, 2500))) {
  console.error('✗ renderDetailPanel does not refuse an undetected event.');
  console.error('  An event with detected === false must render the empty state.');
  console.error('  The ledger already hides it; the map can still select it, and');
  console.error('  that is the path that showed a detection nothing had made.');
  process.exit(1);
}

const rendered = mainSrc.replace(/^\s*\/\/.*$/gm, '');       // drop comments
if (/PRE-INGRESS\s*·\s*AWAITING|cross-cue but not yet/.test(rendered)) {
  console.error('✗ The PRE-INGRESS card is still rendered somewhere.');
  console.error('  It asserts a cross-cue inference the system cannot have made');
  console.error('  when the sensor grid is off.');
  process.exit(1);
}

console.log(`✓ Coverage gate paired. Every multiSiteTrack creator also sets coverageGatedTrack.`);
console.log('✓ An undetected track renders no panel, and the PRE-INGRESS card is gone.');
