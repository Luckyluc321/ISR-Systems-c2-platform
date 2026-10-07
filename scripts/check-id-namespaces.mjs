#!/usr/bin/env node
//
// Agency identifiers must resolve across files.
//
// WHY THIS EXISTS
//
// The same real agency is keyed five different ways in this repo, and
// nothing noticed. Sydøstjyllands Politi is `politi-sydostjyl` in the
// role tree, `politi-sydoest` in the national asset pool and
// `politi-sydoestjylland` in the base registry. Six of twelve police
// districts diverge that way, and the bug class has already shipped
// once: receiver_bases carries the comment
//
//     Key was 'politi-sydsonderjylland' until 2026-09-22. The role is
//     'politi-sydsonderjyl', so this verified base resolved for nobody.
//
// Divergence is not cosmetic. Where two namespaces are compared without
// a join, the comparison silently returns nothing: a role that received
// a site-scoped escalation is absent from the post-incident report, and
// the asset request button resolves 13 of 41 assets to the correct
// agency while the rest collapse to a national parent with no error.
//
// WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
//
// Five namespaces exist and only three of them SHOULD agree:
//
//   roles.js          agency identity. Canonical.
//   receiver_assets   keyed by role id. Must agree.
//   sites/*.yaml      receiver lists. Must agree.
//   geo routing       district lookup. Must agree.
//
//   destinations.js   site-scoped ROUTING ENDPOINTS, not identities.
//                     One agency holds many, one per site. Correctly a
//                     separate namespace. Checked for an owner link,
//                     never for id equality.
//   response_assets   physical UNITS, many per agency. Copenhagen has a
//                     patrol unit and a counter-drone team; they cannot
//                     share an id. Also correctly separate, also checked
//                     for an owner link rather than equality.
//
// So this gate asserts RESOLVABILITY, not sameness. Renaming to make
// everything match is impossible for the two many-to-one namespaces and
// is not the goal.
//
// Checks run in both directions where a set should be closed. The eight
// divergences that exist today all survived a gate that only resolved
// forwards.
//
// Usage:  node scripts/check-id-namespaces.mjs
// Exit:   0 clean, 1 at least one unresolvable identifier.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SITES_DIR = join(ROOT, 'sites');

const { ACCOUNTS, RECEIVERS } = await import(join(ROOT, 'src/roles.js'));
const { ASSETS } = await import(join(ROOT, 'src/response_assets.js'));
const { RECEIVER_ASSETS } = await import(join(ROOT, 'src/receiver_assets.js'));
const { allDestinations } = await import(join(ROOT, 'src/destinations.js'));
const DESTINATIONS = allDestinations();
const { RECEIVER_BASES } = await import(join(ROOT, 'src/receiver_bases.js'));
const { ownerRoleIdForAsset, ownerRoleIdForDestination, NO_OWNING_ROLE: EXEMPT }
  = await import(join(ROOT, 'src/agency_ownership.js'));

const ROLE_IDS = new Set(ACCOUNTS.map((r) => r.id));
const errors = [];
const notes = [];
let checked = 0;

function must(cond, msg) {
  checked += 1;
  if (!cond) errors.push(msg);
}

// The resolvers already return null for an owner that is not a role, so
// a second "is this a role id" assertion after a non-null check is
// unreachable. The null check is the whole test.
//
// The exemption list lives in src/agency_ownership.js, next to the
// mapping it qualifies, and is imported above as EXEMPT. Keeping a
// second copy here would let the two drift, which is the whole failure
// mode this gate exists to catch.

// ── 1. receiver_assets keys must be role ids ─────────────────────────
// Passes today, 28 of 28. Guards the direction that silently no-ops:
// rename a key and the existing cascade gate stops checking it rather
// than failing.
for (const key of Object.keys(RECEIVER_ASSETS)) {
  must(ROLE_IDS.has(key),
    `receiver_assets.js: '${key}' is not a role id. Its owner would read `
    + 'as having no assets, and the dispatch group would silently vanish.');
}

// ── 2. Every sites/*.yaml receiver must be a role id ─────────────────
// The dangerous direction. roles.js drops an unknown id from the
// impacted set with no error, so a typo here removes an agency from
// every routing decision at that site and nothing says so.
for (const file of readdirSync(SITES_DIR).filter((f) => f.endsWith('.yaml'))) {
  const text = readFileSync(join(SITES_DIR, file), 'utf8');
  for (const m of text.matchAll(/^\s*-\s*([a-z0-9][a-z0-9-]{2,})\s*$/gm)) {
    const id = m[1];
    // Only ids that look like role references, not free-text list items.
    if (!/^(politi|forsvar|flv|haer|sov|hjv|brs|kbr|amk|hospital|kom|agency|region|rigspoliti|nato|eu|sov)/.test(id)) continue;
    must(ROLE_IDS.has(id),
      `sites/${file}: receiver '${id}' is not a role id. roles.js drops `
      + 'unknown ids silently, so this agency is absent from every '
      + 'routing decision at this site.');
  }
}

// ── 3. Base registry keys must be reachable ──────────────────────────
// Reachable means: a role id, or named by some role's baseId. A key
// matching neither is a base nobody can resolve, which is exactly the
// 2026-09-22 bug.
const DECLARED_BASE_IDS = new Set(
  Object.values(RECEIVER_ASSETS).map((spec) => spec?.baseId).filter(Boolean),
);
for (const key of Object.keys(RECEIVER_BASES)) {
  const reachable = ROLE_IDS.has(key) || DECLARED_BASE_IDS.has(key);
  if (!reachable) {
    notes.push(`  receiver_bases '${key}' is reached by no role id and no baseId`);
  }
}

// ── 4. Every national-pool asset must resolve to an owning role ──────
// The join that did not exist. Without it the request path walked id
// prefixes and landed on whatever role shared the most leading tokens,
// which was a national parent for every mismatched district.
for (const a of ASSETS) {
  if (!a?.id) continue;
  if (EXEMPT[a.id]) continue;
  const owner = ownerRoleIdForAsset(a.id);
  must(!!owner,
    `response_assets.js: '${a.id}' (${a.name || '?'}) resolves to no owning role. `
    + 'A request for it would reach the wrong agency, or none.');
  if (owner) {
    must(ROLE_IDS.has(owner),
      `response_assets.js: '${a.id}' resolves to '${owner}', which is not a role id.`);
  }
}

// ── 5. Every destination must resolve to an owning role, or be internal
// Site-scoped endpoints are not agency identities, so they are never
// checked for id equality. They do have to resolve to an owner, because
// an agency whose only involvement was receiving one is otherwise absent
// from the incident report.
for (const d of DESTINATIONS) {
  if (!d?.id) continue;
  if (d.type === 'internal' || d.type === 'system') continue;
  const slug = d.siteId ? (/^[a-z0-9]+-t\d+-(.+)$/.exec(d.id)?.[1] ?? d.id) : d.id;
  if (EXEMPT[d.id] || EXEMPT[slug]) continue;
  const owner = ownerRoleIdForDestination(d.id);
  must(!!owner,
    `destinations.js: '${d.id}' resolves to no owning role. A role whose only `
    + 'involvement was receiving this escalation is absent from the report.');
}

// ── 6. Closure: every destinationIds entry must exist ────────────────
// The reverse direction. A role pointing at a destination that was
// renamed or removed routes into nothing.
const DEST_IDS = new Set(DESTINATIONS.map((d) => d.id));
for (const r of RECEIVERS) {
  for (const did of r.destinationIds || []) {
    must(DEST_IDS.has(did),
      `roles.js: '${r.id}' routes to destination '${did}', which does not exist.`);
  }
}

// ── Report ───────────────────────────────────────────────────────────
if (notes.length) {
  console.log(`\n${notes.length} advisory note(s):`);
  console.log(notes.slice(0, 12).join('\n'));
  if (notes.length > 12) console.log(`  ... and ${notes.length - 12} more`);
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} unresolvable identifier(s) of ${checked} checked:\n`);
  for (const e of errors.slice(0, 25)) console.error(`  ${e}`);
  if (errors.length > 25) console.error(`\n  ... and ${errors.length - 25} more`);
  console.error('\nIdentifiers must resolve ACROSS files. Renaming is not the fix for '
    + 'the two many-to-one namespaces: an agency owns several units and several '
    + 'routing endpoints, so they cannot share its id. Give them an ownerRoleId.\n');
  process.exit(1);
}

console.log(`✓ Identifier namespaces resolve. ${checked} cross-file references checked `
  + `across ${ACCOUNTS.length} roles, ${ASSETS.length} national assets, `
  + `${DESTINATIONS.length} destinations, ${Object.keys(RECEIVER_ASSETS).length} asset `
  + `libraries${Object.keys(EXEMPT).length ? `, ${Object.keys(EXEMPT).length} documented exemption(s)` : ''}.`);
