#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Event mutation safety net — Phase 1 state-consolidation refactor
// ───────────────────────────────────────────────────────────────────
// POLICY (see src/events.js "Event mutation API" block):
// events.js is the ONLY module allowed to write directly to event
// object fields. Every other module reads events + calls one of the
// exported mutator functions.
//
// This script runs a grep over the codebase and exits non-zero if
// any direct write (assignment, .push, .add, .set) to an event field
// is found outside events.js. Wire into npm scripts / CI to enforce.
//
// Scope: src/*.js and src/**/*.js
// Exempt: src/events.js (owner), src/detection_subject.js (internal
// helper called only by events.js — see the comment at the exempt
// line for the rationale).
//
// The grep patterns catch TOP-LEVEL event field writes only. Nested
// writes like `event.foo.bar = baz` or `event.dispatchOutcomes[key]
// = value` are Phase 1.5 follow-up work (not caught here).
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const EXEMPT_FILES = new Set([
  'src/events.js',                 // owner
  'src/detection_subject.js',      // internal helper called only by events.js
]);

// Patterns that indicate a direct mutation of an event field:
//   event.foo = ...      (assignment)
//   event.foo.push(...)  (array push)
//   event.foo.add(...)   (Set add)
//   event.foo.set(...)   (Map set)
// Also caught: the `ev.` alias, since main.js uses that shorthand
// inside forEach/for-of loops over EVENTS. Extended after Phase 1
// audit missed 5 sites using the shorter name.
// Comparison operators (== != === !==) and arrow bodies (=>) filtered
// out separately.
// (Kept as a comment only — the actual match logic lives inline below.)

// Files to scan.
const files = execSync(
  `find src -name "*.js" -type f`,
  { cwd: REPO, encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

const violations = [];
for (const file of files) {
  if (EXEMPT_FILES.has(file)) continue;
  const content = readFileSync(resolve(REPO, file), 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comparison operators and arrow bodies (false positives).
    if (/\b(event|ev)\.\w+\s*==/.test(line))  continue;
    if (/\b(event|ev)\.\w+\s*!=/.test(line))  continue;
    if (/\b(event|ev)\.\w+\s*=>/.test(line))  continue;
    // Check for assignment or push/add/set. Matches both `event.` and
    // `ev.` prefixes (both are used across the codebase as event
    // variable names).
    if (!/\b(event|ev)\.\w+\s*=[^=]|\b(event|ev)\.\w+\.push\(|\b(event|ev)\.\w+\.add\(|\b(event|ev)\.\w+\.set\(/.test(line)) continue;
    // Line-level "exempt" annotation — used for narrow, justified
    // exceptions (documented at the callsite).
    if (line.includes('// events.js internal helper, exempt')) continue;
    violations.push({ file, line: i + 1, text: line.trim() });
  }
}

if (violations.length === 0) {
  console.log('✓ Event mutation policy satisfied. Every event write goes through events.js.');
  process.exit(0);
}

console.error(`✗ Event mutation policy violation. ${violations.length} direct write${violations.length === 1 ? '' : 's'} found outside events.js:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
console.error(`\nEvery event field write must go through a mutator exported from src/events.js.`);
console.error(`See the "Event mutation API" block in src/events.js for the available functions.`);
process.exit(1);
