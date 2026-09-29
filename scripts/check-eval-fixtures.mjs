#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Eval fixture gate — a fixture may not grade against stale prompt text
// ───────────────────────────────────────────────────────────────────
// Several eval fixtures carry a canned copy of a formatted prompt block
// as test input: the precedent block, the cooperative traffic block.
// Canning the DATA is correct and deliberate. A fixture should be a
// fixed input, and regenerating it from live retrieval would make it
// non-reproducible, because the precedent formatter computes "22 days
// ago" from the current clock.
//
// Canning the INSTRUCTION is a different thing, and it is the part that
// bites. The instruction is what the model is told to do, and it is
// exactly what an eval is supposed to be measuring compliance with.
// When the two copies drift, the eval grades against an instruction the
// model was never given.
//
// THIS IS NOT HYPOTHETICAL. On 2026-09-28 the precedent instruction was
// changed in src/precedent_retrieval.js to require the model cite the
// event id it references. The eval kept using its own copy, the
// assertion kept failing, and the change looked like it had done
// nothing. The fixture had to be re-synced by hand, and would have
// drifted again the next time.
//
// So the fixed strings now have one definition, exported from the
// module that owns them, and this gate fails the build when a fixture
// no longer carries them. Static: no model call, no network, runs in
// the same second as every other gate.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { PRECEDENT_BLOCK_HEADER, PRECEDENT_INSTRUCTION } from '../src/precedent_retrieval.js';
import { COOPERATIVE_BLOCK_HEADER } from '../src/cooperative_traffic_reconciler.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(REPO, 'eval/fixtures/events');

// Each canned block a fixture may carry, and what must still be true of
// it. `header` is the block's first line, so a fixture whose format has
// been superseded is caught. `instruction` is the part the model is
// graded on, and is the reason this gate exists.
const BLOCKS = [
  {
    field: 'precedentBlock',
    owner: 'src/precedent_retrieval.js',
    header: PRECEDENT_BLOCK_HEADER,
    instruction: PRECEDENT_INSTRUCTION,
  },
  {
    field: 'cooperativeCheckBlock',
    owner: 'src/cooperative_traffic_reconciler.js',
    header: COOPERATIVE_BLOCK_HEADER,
    // No fixed instruction. Every line after the header is derived from
    // the match state, so there is nothing constant to compare. Listed
    // anyway so the header is checked, and so this gate already covers
    // the field if an instruction is ever added to it.
    instruction: null,
  },
];

const errors = [];
let fixturesWithBlocks = 0;
let blocksChecked = 0;

const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json'));
for (const file of files) {
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
  } catch (err) {
    errors.push(`${file} is not valid JSON: ${err.message}`);
    continue;
  }

  let hasAny = false;
  for (const block of BLOCKS) {
    const text = fixture[block.field];
    if (typeof text !== 'string' || !text) continue;
    hasAny = true;
    blocksChecked++;

    if (!text.startsWith(block.header)) {
      errors.push(
        `${file} · ${block.field} no longer starts with the block header produced by ${block.owner}.\n`
        + `    expected first line: ${JSON.stringify(block.header)}\n`
        + `    fixture first line:  ${JSON.stringify(text.split('\n')[0])}\n`
        + '    The formatter changed and this canned copy did not. Re-sync it.',
      );
    }

    if (block.instruction && !text.includes(block.instruction)) {
      errors.push(
        `${file} · ${block.field} does not carry the instruction currently defined in ${block.owner}.\n`
        + '    The eval is grading the model against wording the model was never given.\n'
        + `    expected to contain:\n      ${block.instruction}\n`
        + `    fixture ends with:\n      ${JSON.stringify(text.slice(-180))}`,
      );
    }
  }
  if (hasAny) fixturesWithBlocks++;
}

if (!blocksChecked) {
  // A gate that silently checks nothing is worse than no gate. If the
  // fixtures move or the field names change, say so rather than passing.
  errors.push(
    'No fixture carried any known prompt block. Either the fixtures moved out of '
    + `${FIXTURE_DIR.replace(REPO + '/', '')}, or the field names changed. This gate was checking nothing.`,
  );
}

if (errors.length) {
  console.error(`✗ Eval fixture policy violation. ${errors.length} issue${errors.length === 1 ? '' : 's'}:\n`);
  for (const e of errors) console.error(`  ${e}\n`);
  process.exit(1);
}

console.log(
  `✓ Eval fixture policy satisfied. ${blocksChecked} canned prompt block${blocksChecked === 1 ? '' : 's'} `
  + `across ${fixturesWithBlocks} fixture${fixturesWithBlocks === 1 ? '' : 's'} still match their formatter.`,
);
process.exit(0);
