#!/usr/bin/env node
//
// What every receiver is offered, pinned.
//
// WHY THIS EXISTS
//
// The receiver action rail decides what 386 agencies are allowed to do.
// Until now the only way to ask "what does this role see" was to open a
// browser, switch profile and look, which meant nobody could answer
// "what would this change do" except by guessing.
//
// That matters because the rail is about to move off a hand-written
// ladder on org-chart branch and onto the archetype engine, and the two
// do not correlate. A naive rewrite moves between 216 and 331 of the 386
// roles. The dangerous direction is roles GAINING a capability: a
// modelled rewrite handed 31 hospitals an ambulance-dispatch button and
// 81 volunteer Home Guard districts a request to scramble a fighter.
//
// So this gate pins the current answer for every role and fails the
// build on any drift. The snapshot is not a target, it is a diff: when
// the rail changes on purpose, regenerate it and the diff IS the review.
//
// FOUR INVARIANTS, each one a failure that is otherwise silent:
//
//   1. Every action emitted has a handler in the RECEIVER click router.
//      That router is a 46-branch if/else; an unhandled string renders a
//      normal-looking button that does nothing. Scoped to that router
//      on purpose: scanning the whole file also matched the operator
//      event list's own action tests and quietly whitelisted names like
//      'note' and 'escalate'.
//
//   2. Every category is one of the four buckets. An unknown one is
//      silently filed under "Audit + participants", so a dispatch button
//      appears as an audit note and the Dispatch group does not render
//      at all, which reads as "this profile owns nothing".
//
//   3. No role without an asset inventory is offered an action that
//      claims to move physical units. This is the line that stops
//      archetype derivation handing out 310 buttons that move nothing.
//
//   4. Every receiver-dispatch carries an assetKey that resolves against
//      the role's own inventory, and every receiver-request a requestKey
//      that does. Resolution, not truthiness: a key that matches nothing
//      fails at click time with "No asset spec for that receiver action",
//      and that is a runtime error the build should have caught.
//
// The signature pins action AND category. Label, icon and tooltip are
// deliberately excluded: they are copy, and churning the baseline on
// every wording change would train everyone to regenerate it unread.
//
// Usage:  node scripts/check-receiver-ctas.mjs            verify
//         node scripts/check-receiver-ctas.mjs --write     regenerate
// Exit:   0 clean, 1 drift or a broken invariant.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SNAP = join(HERE, 'fixtures', 'receiver-cta-baseline.json');

const { RECEIVERS } = await import(join(ROOT, 'src/roles.js'));
// The app stamps archetypes onto the roles at boot. Without this the
// gate sees unstamped roles and silently exercises different code.
const { assignArchetypes } = await import(join(ROOT, 'src/archetypes.js'));
assignArchetypes(RECEIVERS);
const { availableCTAsForReceiver, PHYSICAL_DISPATCH_ACTIONS }
  = await import(join(ROOT, 'src/receiver_ctas.js'));
const { RECEIVER_ASSETS } = await import(join(ROOT, 'src/receiver_assets.js'));
const { SITES: SITE_REGISTRY } = await import(join(ROOT, 'src/sites_registry.js'));

const WRITE = process.argv.includes('--write');
const CATEGORIES = new Set(['dispatch', 'request', 'case', 'audit']);

// ── The event matrix ─────────────────────────────────────────────────
//
// Explicit, not random, so the snapshot is reproducible. The ladder
// branches on exactly these axes and nothing else, so this covers it:
// site (capability-declaring, permissive, and none), platform, threat
// class, liveness, and whether an escalation reached this role.
const SITES = ['billund', 'cph', 'esbjerg', 'energinet_kassoe', 'odense', null];
const CASES = [
  { platform: 'quadcopter', classification: 'hostile', threat: 'high' },
  { platform: 'fixed-wing', classification: 'hostile', threat: 'medium' },
  { platform: 'missile', classification: 'hostile', threat: 'high' },
  { platform: 'quadcopter', classification: 'unknown', threat: 'low' },
];
const STATES = [
  { isActive: true, hasRec: true, isAcked: true },
  { isActive: true, hasRec: true, isAcked: false },
  { isActive: true, hasRec: false, isAcked: false },
  { isActive: false, hasRec: true, isAcked: true },
  // Two branches the first version of this matrix could not reach,
  // because it hardcoded empty dispatches, no wreckage and no
  // participants. Observer mode short-circuits the whole rail to two
  // buttons, and scene release only appears once a ground unit is
  // holding a cordon. Both were unpinned while this file claimed to pin
  // what every agency is allowed to do.
  { isActive: true, hasRec: true, isAcked: true, observer: true },
  { isActive: true, hasRec: true, isAcked: true, wreckage: true, holding: true },
];

function buildMatrix() {
  const out = [];
  for (const siteId of SITES) {
    for (const c of CASES) {
      for (const st of STATES) out.push({ siteId, ...c, ...st });
    }
  }
  return out;
}

function evFor(role, m) {
  const rec = m.hasRec
    ? { id: 'r1', destinationId: (role.destinationIds || [])[0] || role.id,
        status: 'acknowledged', assessmentPackage: {} }
    : null;
  const participants = new Map();
  if (m.observer) participants.set(role.id, { mode: 'observer', roleId: role.id });
  const wreckages = m.wreckage ? [{ id: 'w1', lat: 55.7, lon: 9.15 }] : [];
  const dispatches = m.holding
    ? [{ id: 'd1', eventId: 'snap', state: 'holding-cordon',
         assignedWreckageId: 'w1', ownerRoleId: role.id, profile: { useRoadRouting: true } }]
    : [];
  return {
    ev: {
      id: 'snap', siteId: m.siteId, status: m.isActive ? 'active' : 'closed',
      classification: m.classification, threat: m.threat, platform: m.platform,
      escalations: rec ? [rec] : [], wreckages, participants,
    },
    ctx: { rec, isAcked: m.isAcked, isActive: m.isActive, dispatches,
           siteReceivers: SITE_REGISTRY[m.siteId]?.receivers,
           },
  };
}

// ── Collect ──────────────────────────────────────────────────────────
const matrix = buildMatrix();
const perRole = {};
const emittedActions = new Set();
const emittedCategories = new Set();
const errors = [];

for (const role of RECEIVERS) {
  const sigs = new Set();
  for (const m of matrix) {
    const { ev, ctx } = evFor(role, m);
    let ctas;
    try {
      ctas = availableCTAsForReceiver(role.id, ev, ctx) || [];
    } catch (err) {
      errors.push(`${role.id} threw on ${JSON.stringify(m)}: ${err.message}`);
      continue;
    }
    for (const c of ctas) {
      if (c.action) emittedActions.add(c.action);
      emittedCategories.add(c.category);

      // 3. physical actions require a declared inventory
      if (PHYSICAL_DISPATCH_ACTIONS.has(c.action) && !RECEIVER_ASSETS[role.id]) {
        errors.push(`${role.id} has no asset inventory but is offered '${c.action}', `
          + 'which claims to move physical units.');
      }
      // 4. asset-lane CTAs must RESOLVE, not merely be truthy.
      //
      // This used to test truthiness alone while claiming to check
      // resolution, so a CTA carrying a key that matched no asset passed
      // cleanly. The button then fails at click time with "No asset spec
      // for that receiver action", which is a runtime error the build
      // should have caught.
      if (c.action === 'receiver-dispatch') {
        const spec = RECEIVER_ASSETS[role.id];
        const hit = spec?.dispatchable?.some((a) => a.assetKey === c.assetKey);
        if (!hit) {
          errors.push(`${role.id}: receiver-dispatch carries assetKey `
            + `'${c.assetKey}', which matches nothing in its inventory.`);
        }
      }
      if (c.action === 'receiver-request') {
        const key = c.requestId || c.requestKey;
        const spec = RECEIVER_ASSETS[role.id];
        const hit = spec?.requestable?.some((r) => r.requestKey === key);
        if (!hit) {
          errors.push(`${role.id}: receiver-request carries requestKey `
            + `'${key}', which matches nothing in its inventory.`);
        }
      }
    }
    // Action AND category. Pinning the action alone let a dispatch
    // button be refiled under Audit without the gate noticing, which is
    // the exact failure described at the top of this file. Label, icon
    // and tooltip stay out: they are copy, and churning the baseline on
    // every wording change would train everyone to regenerate it blind.
    sigs.add(ctas.map((c) => `${c.action}:${c.category}`).join(','));
  }
  perRole[role.id] = [...sigs].sort();
}

// 2. categories
for (const cat of emittedCategories) {
  if (cat === undefined) { errors.push('a CTA was emitted with no category; it silently files under Audit.'); continue; }
  if (!CATEGORIES.has(cat)) errors.push(`unknown category '${cat}'; it silently files under Audit.`);
}

// 1. every action has a handler
//
// SCOPED to the receiver router, deliberately. Scanning the whole file
// for `action === '...'` also matched nine `btn.dataset.action === '...'`
// tests in the operator event list, a different UI entirely, which
// injected names like 'note', 'escalate' and 'reclassify' into the
// handled set. A receiver CTA called any of those would have passed this
// check with no branch to run it, which is the precise silent failure
// the check exists to prevent.
const mainSrc = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const routerAt = mainSrc.indexOf("receiverView.querySelectorAll('[data-rcv]')");
if (routerAt < 0) {
  errors.push('could not find the receiver click router in main.js; the handler '
    + 'check cannot run and would otherwise pass vacuously.');
}
const routerSrc = routerAt < 0 ? '' : mainSrc.slice(routerAt);
const handled = new Set([...routerSrc.matchAll(/action === '([a-z0-9-]+)'/g)].map((m) => m[1]));
for (const m of mainSrc.matchAll(/STUB_DISPATCH_ACTIONS = new Set\(\[([\s\S]*?)\]\)/g)) {
  for (const s of m[1].matchAll(/'([a-z0-9-]+)'/g)) handled.add(s[1]);
}
for (const a of emittedActions) {
  if (!handled.has(a)) {
    errors.push(`action '${a}' is emitted but no branch in the click router handles it. `
      + 'The button renders normally and does nothing.');
  }
}

// ── Compare or write ─────────────────────────────────────────────────
const payload = { roles: Object.keys(perRole).length, matrix: matrix.length, perRole };
const body = JSON.stringify(payload, null, 1);
const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);

if (errors.length) {
  console.error(`\n✗ ${errors.length} receiver-CTA invariant failure(s):\n`);
  for (const e of [...new Set(errors)].slice(0, 25)) console.error(`  ${e}`);
  const uniq = new Set(errors).size;
  if (uniq > 25) console.error(`\n  ... and ${uniq - 25} more`);
  process.exit(1);
}

if (WRITE) {
  mkdirSync(dirname(SNAP), { recursive: true });
  writeFileSync(SNAP, body + '\n');
  console.log(`✓ baseline written: ${payload.roles} roles x ${payload.matrix} events, hash ${hash}`);
  process.exit(0);
}

if (!existsSync(SNAP)) {
  console.error('\n✗ no baseline at scripts/fixtures/receiver-cta-baseline.json.\n'
    + '  Run: node scripts/check-receiver-ctas.mjs --write\n');
  process.exit(1);
}

const prev = JSON.parse(readFileSync(SNAP, 'utf8'));
const changed = [];
for (const id of new Set([...Object.keys(prev.perRole), ...Object.keys(perRole)])) {
  const a = JSON.stringify(prev.perRole[id]);
  const b = JSON.stringify(perRole[id]);
  if (a !== b) changed.push(id);
}

if (changed.length) {
  console.error(`\n✗ the receiver action rail changed for ${changed.length} of ${payload.roles} roles.\n`);
  for (const id of changed.slice(0, 12)) {
    console.error(`  ${id}`);
    console.error(`    was: ${JSON.stringify(prev.perRole[id])}`);
    console.error(`    now: ${JSON.stringify(perRole[id])}`);
  }
  if (changed.length > 12) console.error(`\n  ... and ${changed.length - 12} more`);
  console.error('\nIf this is deliberate, regenerate the baseline and let the diff be the\n'
    + 'review:  node scripts/check-receiver-ctas.mjs --write\n');
  process.exit(1);
}

console.log(`✓ Receiver action rail unchanged. ${payload.roles} roles x ${payload.matrix} `
  + `events, ${emittedActions.size} distinct actions, all handled. Baseline ${hash}.`);
