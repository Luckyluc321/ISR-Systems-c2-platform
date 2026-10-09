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
console.log(`✓ Coverage gate paired. Every multiSiteTrack creator also sets coverageGatedTrack.`);
