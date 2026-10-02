#!/usr/bin/env node
// Simulation clock discipline.
//
// Every value that the simulation later takes a time difference against
// must be stamped on the simulation clock (sim_clock.js), never on the
// browser's. The failure this prevents is silent and ugly: if a baseline
// is stamped with `Date.now()` but compared against `wallNow()`, the
// difference goes NEGATIVE by however long the scene has been frozen,
// and an interceptor steps backwards. If it is stamped with `wallNow()`
// and compared against `Date.now()`, the difference is inflated by the
// pause and the unit jumps forward instead — up to 27 km for the F-35,
// and far enough for the interceptor missile to snap onto its target and
// register a kill it never made.
//
// Neither shows up until someone pauses, which is exactly when a
// customer is watching. There is no test runner in this repo, so this
// script is the enforcement.
//
// It checks assignment sites, not readers. A baseline is written in one
// or two places and differenced in several, so the write is the
// chokepoint, and `const now = wallNow()` at the top of a tick covers
// every reader below it.

import { readFileSync } from 'node:fs';

const FILES = ['src/main.js', 'src/drones.js'];

// Fields whose value is later used as the left or right side of a time
// difference that advances or gates simulation state. Add to this list
// when a new one is introduced; that is the point of the list.
const BASELINE_FIELDS = [
  'lastFrameTs',
  '_battLastMs',
  '_altLastFrameTs',
  '_engageLastFrameTs',
  'engageStartTs',
  'rtbOrbitStartTs',
  'closedAt',
  '_outOfAllCoverageSinceMs',
  'spawnMs',
  'spawnTs',
  '_lastDetectionTs',
  'cordonHoldSinceMs',
  '_lastPersistMs',
  'startTime',
  // Listed so the two deliberate real-clock stamps below are caught and
  // have to justify themselves, rather than passing because nobody
  // thought to look for them.
  'dispatchTs',
  'dispatchedTs',
];

// Deliberate exemptions, each with the reason it is allowed to read the
// real clock. An exemption is a decision, so it is written down here
// rather than left as an absence.
const EXEMPT = [
  {
    match: /_f35\.dispatchTs\s*=/,
    why: 'written once and never read anywhere in src/. Dead stamp.',
  },
  {
    match: /dispatchedTs\s*:/,
    why: 'audit record of when a dispatch was ordered, shown to an '
       + 'operator. A real moment in the real world, so it keeps real time.',
  },
  {
    match: /_replayState|_lastFrameMs|st\._lastFrameMs/,
    why: 'replay is an analysis view with its own independent pause, and '
       + 'must not freeze when the live scene does.',
  },
  {
    match: /startTime\s*:\s*new Date\(\)|Date\.parse|new Date\(/,
    why: 'ISO timestamps on event records. Real moments, real clock.',
  },
];

const RAW = /\b(?:Date|performance)\.now\(\)/;

let failures = 0;
const notes = [];

for (const file of FILES) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!RAW.test(line)) return;
    const field = BASELINE_FIELDS.find((f) =>
      new RegExp(`${f.replace(/[$.]/g, '\\$&')}\\s*[:=]`).test(line));
    if (!field) return;
    const exempt = EXEMPT.find((e) => e.match.test(line));
    if (exempt) {
      notes.push(`  ${file}:${i + 1}  ${field} — exempt: ${exempt.why}`);
      return;
    }
    failures += 1;
    console.error(
      `\n✗ ${file}:${i + 1}\n`
      + `  ${line.trim()}\n`
      + `  "${field}" is a timing baseline stamped on the browser clock.\n`
      + `  A later difference against it will be wrong by the whole pause\n`
      + `  duration. Use wallNow() for Date.now(), monoNow() for\n`
      + `  performance.now() — see src/sim_clock.js. If this really is a\n`
      + `  real-world timestamp, add it to EXEMPT in this file with the reason.`,
    );
  });
}

// The drone engine is the one place where the whole scene's time base
// originates, so it gets a stricter rule: no raw clock at all.
const drones = readFileSync('src/drones.js', 'utf8');
for (const [n, line] of drones.split('\n').entries()) {
  if (!RAW.test(line)) continue;
  failures += 1;
  console.error(
    `\n✗ src/drones.js:${n + 1}\n  ${line.trim()}\n`
    + '  The drone engine must read only the simulation clock. Every\n'
    + '  track position derives from it, and so does every consumer of\n'
    + '  onDroneUpdate.',
  );
}

if (failures) {
  console.error(`\n${failures} simulation-clock violation(s).\n`);
  process.exit(1);
}

console.log(
  `✓ Simulation clock discipline satisfied. ${BASELINE_FIELDS.length} baseline `
  + `fields checked across ${FILES.length} files, ${notes.length} documented exemption(s).`,
);
if (notes.length) console.log(notes.join('\n'));
