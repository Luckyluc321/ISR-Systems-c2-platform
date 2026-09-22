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
import {
  consequenceAgenciesForSite, allConsequenceAgencyIds, sitesWithConsequenceRouting,
  CONSEQUENCE_BY_SITE, REGION_TO_MEDICAL_COORDINATION,
} from '../src/consequence_routing.js';
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

// ── 2. Is the cascade still wired to the per-site resolver? ────────
// The recipient list is no longer a literal. It is resolved from the
// site, so the checks below run the real resolver instead of reading
// source text. These two assertions only confirm main.js still calls
// it: without them the resolver could be bypassed and every check
// below would still pass, because they verify the tables, not the call.
if (!/const _casConsequenceIds = consequenceAgenciesForSite\(event\.siteId\);/.test(main)) {
  errors.push(
    "The impact cascade no longer resolves consequence agencies via consequenceAgenciesForSite(event.siteId).\n" +
    "    It was a fixed Copenhagen list until 2026-09-22, which alerted Rigshospitalet and Hovedstadens\n" +
    "    Beredskab for a detonation at Billund. Do not go back to a literal."
  );
}
if (!/destinationIds:\s*\[\.\.\._casConsequenceIds,\s*\.\.\._casPoliceIds\]/.test(main)) {
  errors.push(
    "The impact cascade no longer escalates to _casConsequenceIds and _casPoliceIds together.\n" +
    "    Restore the legs, or update this gate deliberately if the routing genuinely moved."
  );
}
if (!/const _casPoliceIds = localPoliceDestinationIds\(event\);/.test(main)) {
  errors.push("The impact cascade no longer resolves the police district via localPoliceDestinationIds(event).");
}

// ── 3. Every detonating site must have consequence routing ─────────
// This replaces the old CASCADE_COVERS allowlist. The cascade used to
// be Copenhagen-only, so the gate's job was to refuse any other
// detonating site. Now it resolves per site, so the job is to refuse a
// site it cannot resolve.
const ROUTED = new Set(sitesWithConsequenceRouting());
for (const siteId of impactSites) {
  if (ROUTED.has(siteId)) continue;
  errors.push(
    `An impact template detonates at site '${siteId}', but src/consequence_routing.js has no entry for it.\n` +
    `    Nothing would be alerted: no ambulance service, no hospital, no fire service, no rescue.\n` +
    `    Add its region, receiving acute hospital, municipal fire service and rescue centre there.\n` +
    `    Verify the kommune against official boundary data, not by name similarity.`
  );
}

// ── 4. Every routed agency must resolve end to end ─────────────────
// destination exists, a role holds it, and if that role has vehicles it
// has a home base to drive from. Any missing link means the alert is
// written and never surfaced, or surfaced and not actionable.
//
// Checked for EVERY site in the routing table, not only the ones that
// can detonate today, so a site is correct before a template there ever
// declares terminalImpact.
const roleHolding = (destId) =>
  RECEIVERS.find((r) => Array.isArray(r.destinationIds) && r.destinationIds.includes(destId));

const recipients = allConsequenceAgencyIds();
for (const id of recipients) {
  if (!getDestination(id)) {
    errors.push(`Consequence agency '${id}' has no destination in src/destinations.js. The escalation would be written to an id that resolves to nothing.`);
    continue;
  }
  const holder = roleHolding(id);
  if (!holder) {
    errors.push(
      `Consequence agency '${id}' is held by no role in src/roles.js.\n` +
      `    Inboxes are built from a role's destinationIds, so this agency is alerted and shown nothing.\n` +
      `    Add '${id}' to its own role's destinationIds.`
    );
    continue;
  }
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
for (const siteId of new Set([...impactSites, ...sitesWithConsequenceRouting()])) {
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

// ── 4d. The district a site routes to must BE the district named ───
// Two errors this catches, both found live on 2026-09-22:
//
//   1. esb-t2-politi was named 'Politi Sydvestjylland', a district that
//      does not exist, and was held by a second role invented for it.
//      Esbjerg and Kassoe share a politikreds but routed to different
//      accounts.
//   2. bjk-t2-politi was named 'Sydsjaellands og Lolland-Falsters
//      Politi' but Bjaeverskov is in Koge, which politi.dk lists under
//      Midt- og Vestsjaellands Politi.
//
// A name and its holder drifting apart is silent: routing still
// "works", it just reaches the wrong agency.
// Checked for EVERY tier-2 Politikreds destination in the table, not
// only the cascade-covered sites. Scoping this to the cascade let the
// Bjaeverskov mismatch pass, because that site does not detonate.
for (const dest of getAllDestinations()) {
  if (dest.tier !== 2 || destinationParent(dest) !== 'Politi') continue;
  const holder = roleHolding(dest.id);
  if (!holder) {
    errors.push(
      `Police destination '${dest.id}' (${dest.name}) is held by no role in src/roles.js.\n` +
      `    Inboxes are built from a role's destinationIds, so an escalation to it reaches nobody.`
    );
    continue;
  }
  const org = holder.org || holder.label || '';
  if (org === dest.name) continue;
  errors.push(
    `Police destination '${dest.id}' is named '${dest.name}', but the role holding it is\n` +
    `    '${holder.id}' (${org}). A destination and its owning role must name the SAME politikreds.\n` +
    `    Denmark has twelve; check politi.dk before changing either side.`
  );
}

// One role per politikreds. Two roles carrying the same district name
// means two inboxes for one agency, and sites inside that district
// silently split between them.
const _byOrg = new Map();
for (const r of RECEIVERS) {
  if (!/ Politi$/.test(r.org || '')) continue;
  if (!_byOrg.has(r.org)) _byOrg.set(r.org, []);
  _byOrg.get(r.org).push(r.id);
}
for (const [org, ids] of _byOrg) {
  if (ids.length > 1) {
    errors.push(`Politikreds '${org}' is represented by ${ids.length} roles: ${ids.join(', ')}. One district, one role.`);
  }
}

// ── 4e. No two destinations may share an id ────────────────────────
// Destinations are looked up by id and the lookup returns the first
// match, so a duplicate means the answer depends on array order. This
// happened: the Aktionsstyrken generator treated siteId null as a site
// and minted a second 'amk-t3-aks'.
const _seenDestIds = new Map();
for (const d of getAllDestinations()) {
  if (_seenDestIds.has(d.id)) {
    errors.push(
      `Destination id '${d.id}' is declared twice (siteId ${JSON.stringify(_seenDestIds.get(d.id))} and ` +
      `${JSON.stringify(d.siteId)}). Lookups return the first match, so routing depends on array order.`
    );
  }
  _seenDestIds.set(d.id, d.siteId);
}

// ── 5. Every routed site must cover all four capabilities ──────────
// A detonation with no ambulance alerted is the failure this whole
// subsystem exists to prevent.
//
// Checked against the NAMED FIELDS in the routing table, never by id
// prefix. Amager Koblingsstation's site code is AMK, so its police
// destination is 'amk-t2-politi'; a prefix test for an ambulance
// service would have counted that as medical coverage and passed with
// no ambulance in the list at all.
for (const siteId of sitesWithConsequenceRouting()) {
  const site = CONSEQUENCE_BY_SITE[siteId];
  if (!REGION_TO_MEDICAL_COORDINATION[site.region]) {
    errors.push(`Site '${siteId}' declares region '${site.region}', which maps to no Akutmedicinsk Koordinationscenter. A detonation assumes casualties.`);
  }
  if (!site.hospitals || !site.hospitals.length) {
    errors.push(`Site '${siteId}' has no receiving acute hospital.`);
  }
  if (!site.fire) errors.push(`Site '${siteId}' has no municipal fire service.`);
  if (!site.rescue) errors.push(`Site '${siteId}' has no rescue reinforcement (Beredskabsstyrelsen).`);
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
  `(${[...impactSites].join(', ')}), ${sitesWithConsequenceRouting().length} sites routed, ` +
  `${recipients.length} consequence agencies plus each site's own Politikreds, all reachable.`
);
process.exit(0);
