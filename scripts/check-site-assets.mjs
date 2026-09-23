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
const warnings = [];
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

  // Anything referencing an asset by id must reference one that exists.
  // Renaming an asset is exactly when this breaks, and it breaks
  // silently: a highlight or priority pointing at a deleted id simply
  // stops matching, so the asset the site considers most important
  // quietly drops out of whatever consumes it. Seven references went
  // dangling the moment two sites were corrected on 2026-09-23.
  const assetIds = new Set(assets.map(({ a }) => a.id));
  const refs = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'asset_id' && typeof v === 'string') refs.push(v);
      else walk(v);
    }
  })(ctx);
  for (const ref of refs) {
    if (assetIds.has(ref)) continue;
    errors.push(
      `Site '${siteId}' references asset_id '${ref}', which no longer exists in critical_areas or high_value_assets.\n` +
      `    The reference silently stops matching, so whatever consumes it loses that asset without erroring.`
    );
  }

  // Two assets at the identical coordinate cannot be told apart, so
  // whichever the nearest-asset lookup returns first wins and the other
  // is unreachable by name. Seen three times: CPH's ils_04L carried the
  // runway centre, and several substations have every internal asset
  // sitting on the site's own coordinate because nobody surveyed them.
  //
  // A WARNING rather than an error. A placeholder position is a
  // legitimate state for a site that has not been surveyed yet, and the
  // honest thing is to make it visible, not to block the build over it.
  // It becomes an error only if it is also claimed as verified.
  const byPos = new Map();
  for (const { a, where } of assets) {
    const p = a.center || a.location;
    if (!p || typeof p.lat !== 'number') continue;
    const key = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    if (!byPos.has(key)) byPos.set(key, []);
    byPos.get(key).push({ id: a.id, where, verified: a.verified });
  }
  for (const [key, group] of byPos) {
    if (group.length < 2) continue;
    const claimed = group.filter(g => g.verified === 'high' || g.verified === 'medium');
    const ids = group.map(g => g.id).join(', ');
    if (claimed.length) {
      errors.push(
        `Site '${siteId}': ${claimed.length} asset(s) claim a checked position while sharing the exact\n` +
        `    coordinate ${key} with others: ${ids}.\n` +
        `    A verified position must be that asset's own. Nearest-asset lookups return the first match,\n` +
        `    so the rest are unreachable by name.`
      );
    } else {
      warnings.push(
        `Site '${siteId}': ${group.length} assets share coordinate ${key} (${ids}). ` +
        `All unverified, so this reads as a placeholder rather than a survey. They cannot be told apart until one is.`
      );
    }
  }
}

if (warnings.length) {
  for (const w of warnings) console.warn(`⚠ ${w}`);
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
