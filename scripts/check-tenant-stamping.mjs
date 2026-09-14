#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Tenant-stamp safety net — Phase 3 tenant-isolation refactor
// ───────────────────────────────────────────────────────────────────
// POLICY: every site manifest under sites/ must declare a `tenant`
// field, and every operator role's tenant id must match a manifest
// tenant somewhere. If a manifest is missing a tenant, events at
// that site will have tenantId = null and be invisible to every
// operator actor (default-deny — safe, but silent, so we surface it
// here).
//
// Second check: every OPERATORS entry in src/roles.js must have at
// least one site whose manifest tenant matches the operator id. If
// no site points at an operator, that operator has no visible events.
//
// Runs in CI alongside check-event-mutations.mjs. Wired into
// `npm run build`.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SITES_DIR = join(REPO, 'sites');
const ROLES_FILE = join(REPO, 'src/roles.js');

const errors = [];
const warnings = [];

// ── Check every sites/*.yaml has a `tenant:` line ──────────────────
const siteFiles = readdirSync(SITES_DIR).filter(f => f.endsWith('.yaml'));
const siteToTenant = {};
for (const file of siteFiles) {
  const content = readFileSync(join(SITES_DIR, file), 'utf8');
  const tenantMatch = content.match(/^tenant:\s*(\S+)/m);
  const siteIdMatch = content.match(/^site_id:\s*(\S+)/m);
  const siteId = siteIdMatch ? siteIdMatch[1] : file.replace(/\.yaml$/, '');
  if (!tenantMatch) {
    errors.push(`sites/${file}: missing required 'tenant:' field. Events at this site would be invisible to every operator.`);
    continue;
  }
  siteToTenant[siteId] = tenantMatch[1];
}

// ── Check every OPERATORS entry in roles.js resolves to at least one site ──
const rolesContent = readFileSync(ROLES_FILE, 'utf8');
const operatorIds = [];
// Match OPERATORS array: id: 'op-...' entries (there are 4-5 operators today)
const opIdRegex = /id:\s*'(op-[a-z0-9-]+)'/g;
let match;
while ((match = opIdRegex.exec(rolesContent)) !== null) {
  operatorIds.push(match[1]);
}
if (!operatorIds.length) {
  warnings.push(`No operator ids found in src/roles.js. Tenant check has nothing to verify.`);
}

const declaredTenants = new Set(Object.values(siteToTenant));
for (const opId of operatorIds) {
  if (!declaredTenants.has(opId)) {
    errors.push(`Operator '${opId}' declared in src/roles.js but no site manifest declares 'tenant: ${opId}'. That operator will see an empty event feed.`);
  }
}

// ── Check every manifest tenant matches at least one operator ──────
for (const [siteId, tenant] of Object.entries(siteToTenant)) {
  if (!operatorIds.includes(tenant)) {
    errors.push(`sites/${siteId}.yaml declares 'tenant: ${tenant}' but no operator in src/roles.js has id '${tenant}'. Events at this site would be invisible.`);
  }
}

// ── Report ─────────────────────────────────────────────────────────
if (warnings.length) {
  for (const w of warnings) console.warn(`⚠ ${w}`);
}
if (errors.length) {
  console.error(`✗ Tenant-stamp policy violation. ${errors.length} issue${errors.length === 1 ? '' : 's'}:\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(`\nEvery site manifest must declare a 'tenant:' field.`);
  console.error(`Every operator id in roles.js must match at least one manifest tenant.`);
  process.exit(1);
}

console.log(`✓ Tenant-stamp policy satisfied. ${siteFiles.length} manifests, ${operatorIds.length} operators, ${declaredTenants.size} distinct tenants — all aligned.`);
process.exit(0);
