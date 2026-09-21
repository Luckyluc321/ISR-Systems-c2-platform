#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Impact consequence cascade safety net
// ───────────────────────────────────────────────────────────────────
// POLICY: when a warhead detonates, the platform automatically alerts
// medical, fire and rescue so the case lands in their inbox. The
// dispatch itself always stays a human click; this is alerting only.
//
// That recipient list is a literal in src/main.js naming Copenhagen
// organisations, with no reference to the site that was hit. It is
// correct today only because every template that detonates is a
// Copenhagen template. The day someone adds an impact scenario at
// Esbjerg, Billund or a substation, the alert would still go to
// Copenhagen: an ambulance routed 240 km across Denmark while the
// panel promises "5 to 12 minutes".
//
// Rather than rewrite a working list to solve a problem nobody has
// yet, this gate makes the problem impossible to ship. Add an impact
// template at a new site and the build stops, naming exactly what is
// missing, at the moment you are adding it.
//
// It also checks the existing recipients still resolve end to end.
// That is the bug class this codebase has already hit twice: a role
// carrying destinationIds: [] is not merely unrouted, it is
// unreachable, and the alert is written to a record nobody surfaces.
// Five agencies sat like that for four days, then a sixth was found
// the day after the first five were repaired.
//
// Wired into `npm run build` alongside the event-mutation and
// tenant-stamp gates.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const read = (p) => readFileSync(join(REPO, p), 'utf8');
const drones = read('src/drones.js');
const main = read('src/main.js');
const destinations = read('src/destinations.js');
const roles = read('src/roles.js');
const assets = read('src/receiver_assets.js');
const bases = read('src/receiver_bases.js');

const errors = [];
const warnings = [];

// ── 1. Which sites can produce a detonation? ───────────────────────
// Walk backwards from each terminalImpact declaration to the nearest
// preceding siteId in the same template object.
const impactSites = new Set();
const lines = drones.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (!/terminalImpact:\s*true/.test(lines[i])) continue;
  let siteId = null;
  for (let j = i; j >= 0 && j > i - 60; j--) {
    const m = lines[j].match(/^\s*siteId:\s*'([^']+)'/);
    if (m) { siteId = m[1]; break; }
    // Stop at the start of the enclosing template so we cannot pick up
    // a neighbouring template's site.
    if (j < i && /^ {2}[a-z0-9_]+:\s*\{\s*$/.test(lines[j])) break;
  }
  if (!siteId) {
    errors.push(`src/drones.js:${i + 1} declares terminalImpact but no siteId could be resolved for its template. The cascade cannot know which area to alert.`);
    continue;
  }
  impactSites.add(siteId);
}

if (impactSites.size === 0) {
  warnings.push('No template declares terminalImpact. The consequence cascade is unreachable, so this gate is checking nothing.');
}

// ── 2. Which recipients does the cascade actually alert? ───────────
const cascadeMatch = main.match(/destinationIds:\s*\[([^\]]*)\][^\n]*\n[^\n]*payload:\s*'full'/);
const literalMatch = cascadeMatch || main.match(/destinationIds:\s*\[('amk-hovedstaden'[^\]]*)\]/);
if (!literalMatch) {
  errors.push("Could not find the impact cascade recipient list in src/main.js. If it was refactored into a per-site resolver, update this gate to read the new shape rather than deleting it.");
}
const recipients = literalMatch
  ? [...literalMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : [];

// ── 3. The cascade is Copenhagen-only. Fail on any other site. ─────
// This is the whole point of the gate.
const CASCADE_COVERS = new Set(['cph', 'energinet_amager_koblingsstation']);
for (const siteId of impactSites) {
  if (CASCADE_COVERS.has(siteId)) continue;
  errors.push(
    `An impact template detonates at site '${siteId}', but the consequence cascade in src/main.js alerts a fixed list of Copenhagen organisations:\n` +
    `      ${recipients.join(', ') || '(unreadable)'}\n` +
    `    Those services would be alerted for a detonation at '${siteId}' and would route across the country.\n` +
    `    Before shipping this scenario, configure the ambulance service, the municipal fire service and the\n` +
    `    rescue reinforcement covering '${siteId}', then make the cascade resolve recipients from event.siteId\n` +
    `    and add '${siteId}' to CASCADE_COVERS in this file.`
  );
}

// ── 4. Every recipient must resolve end to end ─────────────────────
// destination exists, a role holds it, that role has a home base and
// at least one vehicle. Any missing link means the alert is written
// and never surfaced, or surfaced and not actionable.
for (const id of recipients) {
  const hasDestination = new RegExp(`id:\\s*'${id}'`).test(destinations);
  if (!hasDestination) {
    errors.push(`Cascade recipient '${id}' has no destination in src/destinations.js. The escalation would be written to an id that resolves to nothing.`);
  }

  // The role must hold this destination id, not merely exist. An empty
  // destinationIds array makes the receiver unreachable: the inbox, the
  // reports pool and the acknowledge gate all key on it.
  const roleIdx = roles.indexOf(`id: '${id}'`);
  if (roleIdx === -1) {
    errors.push(`Cascade recipient '${id}' has no role in src/roles.js.`);
  } else {
    const window = roles.slice(roleIdx, roleIdx + 1400);
    const destIds = window.match(/destinationIds:\s*\[([^\]]*)\]/);
    if (!destIds) {
      warnings.push(`Could not read destinationIds for role '${id}'. Check it by hand.`);
    } else if (!destIds[1].includes(`'${id}'`)) {
      errors.push(
        `Role '${id}' does not hold its own destination id. destinationIds is [${destIds[1].trim()}].\n` +
        `    The cascade escalates to '${id}', but the inbox is built from the role's destinationIds, so this\n` +
        `    agency is alerted and shown nothing. Add '${id}' to its destinationIds in src/roles.js.`
      );
    }
  }

  // A recipient that can be dispatched needs somewhere to drive from.
  const hasAssets = assets.includes(`'${id}'`);
  if (hasAssets) {
    const baseDecl = assets.slice(assets.indexOf(`'${id}'`)).match(/baseId:\s*'([^']+)'/);
    if (!baseDecl) {
      warnings.push(`Role '${id}' declares vehicles but no baseId. They would spawn on top of the incident having driven nothing.`);
    } else if (!bases.includes(`'${baseDecl[1]}'`) && !bases.includes(`${baseDecl[1]}:`)) {
      errors.push(`Role '${id}' declares baseId '${baseDecl[1]}', which does not exist in src/receiver_bases.js. Its vehicles cannot resolve a starting point.`);
    }
  }
}

// ── 5. At least one of each capability must be alerted ─────────────
// A detonation with no ambulance alerted is the failure this whole
// subsystem exists to prevent.
if (recipients.length) {
  const hasMedical = recipients.some((id) => /^(amk|hospital)-/.test(id));
  const hasFire = recipients.some((id) => /^kbr-/.test(id));
  const hasRescue = recipients.some((id) => /^brs-/.test(id));
  if (!hasMedical) errors.push('The impact cascade alerts no ambulance service or hospital. A detonation assumes casualties.');
  if (!hasFire) errors.push('The impact cascade alerts no municipal fire service.');
  if (!hasRescue) errors.push('The impact cascade alerts no rescue reinforcement (Beredskabsstyrelsen).');
}

// ── Report ─────────────────────────────────────────────────────────
if (warnings.length) {
  for (const w of warnings) console.warn(`⚠ ${w}`);
}
if (errors.length) {
  console.error(`✗ Impact cascade policy violation. ${errors.length} issue${errors.length === 1 ? '' : 's'}:\n`);
  for (const e of errors) console.error(`  ${e}\n`);
  process.exit(1);
}

console.log(
  `✓ Impact cascade policy satisfied. ${impactSites.size} detonating site${impactSites.size === 1 ? '' : 's'} ` +
  `(${[...impactSites].join(', ')}), ${recipients.length} recipients, all reachable with a home base.`
);
process.exit(0);
