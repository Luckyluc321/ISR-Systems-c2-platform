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
//   event.foo = ...          (assignment)
//   event.foo[key] = ...     (nested bracket write, e.g. dispatchOutcomes)
//   event.foo.push(...)      (array push)
//   event.foo.add(...)       (Set add)
//   event.foo.set(...)       (Map set)
//
// Whitelisted event variable aliases (all discovered by successive
// audit passes over main.js — do NOT match arbitrary identifiers, or
// unrelated code like `_ensure(role).escalations.push(x)` fires false
// positives): event, ev, targetEv, primary, selectedEv.
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
  // Whitelisted event variable aliases. Match starts with `\b` so
  // suffixed identifiers like `myEvent` or `preview.event` don't count.
  const ALIASES = '(event|ev|targetEv|primary|selectedEv)';
  const cmpPatterns = new RegExp(`\\b${ALIASES}\\.\\w+\\s*(==|!=|=>)`);
  const writePatterns = new RegExp(
    `\\b${ALIASES}\\.\\w+\\s*=[^=]` +                        // top-level assignment
    `|\\b${ALIASES}\\.\\w+\\[[^\\]]+\\]\\s*=[^=]` +         // nested bracket write
    `|\\b${ALIASES}\\.\\w+\\.push\\(` +
    `|\\b${ALIASES}\\.\\w+\\.add\\(` +
    `|\\b${ALIASES}\\.\\w+\\.set\\(`
  );
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comparison operators and arrow bodies (false positives).
    if (cmpPatterns.test(line))    continue;
    // Check for direct write to an event field.
    if (!writePatterns.test(line)) continue;
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
