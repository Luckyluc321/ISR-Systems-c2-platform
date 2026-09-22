#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Site asset gate — every protected asset declares how well we know it
// ───────────────────────────────────────────────────────────────────
// src/site_context.js lists the assets a site is trying to protect:
// runways, terminals, control towers, transformer halls. Two things
// read those coordinates and both are user-facing:
//
//   nearestCriticalArea() feeds the attack-profile detector's
//   "low + fast + close to a sensitive asset" rule.
//
//   The agentic debrief names the asset a drone dwelt over.
//
// So a coordinate that is 200 metres off does not fail loudly. It names
// the wrong building, confidently, in a report an agency reads.
//
// WHAT THIS GATE ENFORCES: every asset says how well its position is
// known. It does NOT require the position to be verified, because a
// site can legitimately onboard with approximate geometry and refine
// later. It requires the claim to be explicit.
//
// 38 of 66 assets carried no confidence marker at all on 2026-09-22, so
// nothing downstream could tell a surveyed runway threshold from an
// eyeballed apron. They are now marked 'unverified', which is honest
// rather than flattering.
// ═══════════════════════════════════════════════════════════════════

import { SITE_CONTEXT } from '../src/site_context.js';

// 'unverified' is a legitimate state, not a failure. It means nobody
// has checked this against a map or an official source yet, and saying
// so is the point.
const LEVELS = new Set(['high', 'medium', 'approximate', 'unverified']);

const errors = [];
const tally = {};
let total = 0;

for (const [siteId, ctx] of Object.entries(SITE_CONTEXT)) {
  const assets = [
    ...(ctx.critical_areas || []).map(a => ({ a, where: 'critical_areas' })),
    ...(ctx.high_value_assets || []).map(a => ({ a, where: 'high_value_assets' })),
  ];
  for (const { a, where } of assets) {
    total++;
    const v = a.verified;
    if (!v) {
      errors.push(
        `Site '${siteId}' asset '${a.id}' (${where}) declares no 'verified' level.\n` +
        `    Its coordinate drives the attack detector and the asset the debrief names, so how well\n` +
        `    it is known must be explicit. Use 'unverified' if nobody has checked it. That is honest;\n` +
        `    silence is not.`
      );
      continue;
    }
    if (!LEVELS.has(v)) {
      errors.push(`Site '${siteId}' asset '${a.id}' has verified: '${v}', which is not one of ${[...LEVELS].join(', ')}.`);
      continue;
    }
    tally[v] = (tally[v] || 0) + 1;

    // A position is required either way. An asset with no coordinate
    // cannot be the nearest anything, and would silently drop out of
    // every distance calculation rather than erroring.
    const pos = a.center || a.location;
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') {
      errors.push(`Site '${siteId}' asset '${a.id}' has no usable lat/lon. It would silently drop out of every distance calculation.`);
    }
  }
}

if (errors.length) {
  console.error(`✗ Site asset policy violation. ${errors.length} issue${errors.length === 1 ? '' : 's'}:\n`);
  for (const e of errors) console.error(`  ${e}\n`);
  process.exit(1);
}

const summary = ['high', 'medium', 'approximate', 'unverified']
  .filter(k => tally[k])
  .map(k => `${tally[k]} ${k}`)
  .join(', ');
console.log(`✓ Site asset policy satisfied. ${total} protected assets across ${Object.keys(SITE_CONTEXT).length} sites, all with a declared position confidence (${summary}).`);
process.exit(0);
