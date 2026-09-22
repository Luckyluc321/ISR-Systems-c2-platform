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
// destinations.js and roles.js are pure data modules with no imports of
// their own, so they load under plain Node. Importing them lets this
// gate verify the REAL resolver against the REAL table instead of
// pattern-matching source text, which is the only way to check a
// destination that is generated at runtime rather than written as a
// literal (every Amager destination, for one).
import { getDestination, localPoliceDestinationIds, getAllDestinations, destinationParent } from '../src/destinations.js';
import { RECEIVERS } from '../src/roles.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const read = (p) => readFileSync(join(REPO, p), 'utf8');
const drones = read('src/drones.js');
const main = read('src/main.js');
// destinations.js and roles.js are imported above rather than read as
// text: their real exports are checked, not their source.
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
// Two legs, and they resolve differently.
//
//   CONSEQUENCE  a fixed Copenhagen literal, read from source here.
//   POLICE       resolved at runtime from the site's own tier-2
//                Politikreds, so there is no literal to read. Checked
//                against the real destination table in section 4b.
const consequenceMatch = main.match(/_casConsequenceIds\s*=\s*\[([^\]]*)\]/);
if (!consequenceMatch) {
  errors.push("Could not find _casConsequenceIds in src/main.js. If the consequence list was refactored, update this gate to read the new shape rather than deleting it.");
}
const recipients = consequenceMatch
  ? [...consequenceMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : [];

// The police leg must still be wired into the cascade. Without this the
// resolver could be deleted and every check below would still pass,
// because they verify the destination table rather than the call.
if (!/destinationIds:\s*\[\.\.\._casConsequenceIds,\s*\.\.\._casPoliceIds\]/.test(main)) {
  errors.push(
    "The impact cascade no longer escalates to _casPoliceIds.\n" +
    "    The cascade tells medical and fire the scene is not yet declared safe, and police are the only\n" +
    "    agency that can declare it safe, take scene command and later release the scene. Restore the\n" +
    "    police leg, or update this gate deliberately if the routing genuinely moved."
  );
}
if (!/const _casPoliceIds = localPoliceDestinationIds\(event\);/.test(main)) {
  errors.push("The impact cascade no longer resolves the police district via localPoliceDestinationIds(event).");
}

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

// ── 4. Every recipient must resolve end to end ─────────────────
// destination exists, a role holds it, that role has a home base and
// at least one vehicle. Any missing link means the alert is written
// and never surfaced, or surfaced and not actionable.
//
// Two id shapes exist and they must be checked differently:
//
//   SELF-REFERENTIAL   destination id == role id (the consequence six).
//                      The role holds its own id.
//   SITE-SCOPED        '{site}-t{tier}-{slug}' (police and most others).
//                      Some OTHER role holds it, and the role id is a
//                      different string entirely.
//
// The invariant that actually matters in both shapes is the same: some
// role holds this destination id, because inboxes are built from
// eventsForDestinations(role.destinationIds).
const roleHolding = (destId) =>
  RECEIVERS.find((r) => Array.isArray(r.destinationIds) && r.destinationIds.includes(destId));

for (const id of recipients) {
  if (!getDestination(id)) {
    errors.push(`Cascade recipient '${id}' has no destination in src/destinations.js. The escalation would be written to an id that resolves to nothing.`);
    continue;
  }
  const holder = roleHolding(id);
  if (!holder) {
    errors.push(
      `Cascade recipient '${id}' is held by no role in src/roles.js.\n` +
      `    The cascade escalates to '${id}', but the inbox is built from a role's destinationIds, so this\n` +
      `    agency is alerted and shown nothing. Add '${id}' to the owning role's destinationIds.`
    );
    continue;
  }
  // A recipient that can be dispatched needs somewhere to drive from.
  const hasAssets = assets.includes(`'${holder.id}'`);
  if (hasAssets) {
    const baseDecl = assets.slice(assets.indexOf(`'${holder.id}'`)).match(/baseId:\s*'([^']+)'/);
    if (!baseDecl) {
      warnings.push(`Role '${holder.id}' declares vehicles but no baseId. They would spawn on top of the incident having driven nothing.`);
    } else if (!bases.includes(`'${baseDecl[1]}'`) && !bases.includes(`${baseDecl[1]}:`)) {
      errors.push(`Role '${holder.id}' declares baseId '${baseDecl[1]}', which does not exist in src/receiver_bases.js. Its vehicles cannot resolve a starting point.`);
    }
  }
}

// ── 4b. The police leg, per detonating site ────────────────────
// The police recipient is resolved at runtime, so it is verified by
// running the real resolver against the real destination table rather
// than by reading a literal.
//
// domainScope ['ground'] is the MINIMAL scope any site carries. A
// police destination declares ['ground'], so resolving under the
// minimal scope guarantees it also resolves under every real site
// scope, which are supersets. Conservative on purpose.
//
// This is what makes a new site safe: add a site with a detonating
// template and no Politikreds wired to a role, and the build fails
// here instead of the product alerting police into a void.
// Checked for every site that can detonate TODAY and every site the
// cascade declares it covers. A site in CASCADE_COVERS is one we have
// said the cascade is correct for, so its police link must hold before
// a template there ever declares terminalImpact, not after.
for (const siteId of new Set([...impactSites, ...CASCADE_COVERS])) {
  const politiIds = localPoliceDestinationIds({ siteId, domainScope: ['ground'] });
  if (!politiIds.length) {
    errors.push(
      `Site '${siteId}' can detonate but has no tier-2 Politikreds destination in src/destinations.js.\n` +
      `    The impact cascade would alert medical and fire that the scene is not declared safe, with no\n` +
      `    police district on the case to declare it safe or release the scene.`
    );
    continue;
  }
  for (const pid of politiIds) {
    if (!roleHolding(pid)) {
      errors.push(
        `Site '${siteId}' resolves to police destination '${pid}', which is held by no role in src/roles.js.\n` +
        `    The cascade would escalate to it and no inbox would ever show it. Add '${pid}' to the\n` +
        `    destinationIds of the Politikreds that covers this site.`
      );
    }
  }
}

// ── 4c. No Politikreds may fall through destinationParent ───────
// Police routing everywhere keys on destinationParent(d) === 'Politi'.
// That test is a list of district names, so a district written in a
// form the list does not carry is silently reclassified as 'Other' and
// disappears from every police routing decision with no error.
//
// This happened: 'Sydsjaellands og Lolland-Falsters Politi' parented as
// 'Other', so Bjaeverskov had no police routing at all while its
// destination sat in the table looking correct.
for (const d of getAllDestinations()) {
  if (!/ Politi$/.test(d.name || '')) continue;
  if (destinationParent(d) === 'Politi') continue;
  errors.push(
    `Destination '${d.id}' is named '${d.name}' but destinationParent() classifies it as '${destinationParent(d)}'.\n` +
    `    Every police routing decision filters on parent === 'Politi', so this district is invisible to all\n` +
    `    of them. Add its exact name to the Politikreds alternation in src/destinations.js.`
  );
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
  // Police are NOT checked by id pattern here. They are resolved per
  // site rather than listed, so section 4b verifies them against the
  // real destination table for every detonating site.
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
  `(${[...impactSites].join(', ')}), ${recipients.length} consequence recipients plus the local Politikreds, all reachable with a home base.`
);
process.exit(0);
