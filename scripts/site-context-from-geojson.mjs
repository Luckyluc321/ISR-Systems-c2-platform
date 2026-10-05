#!/usr/bin/env node
// GeoJSON from geojson.io -> a site_context.js block.
//
// Nothing in the data model changes. This is a converter, and it exists
// because the alternative is typing coordinates into a 1,500-line JS
// file by hand, which is how Billund ended up with seven of nine assets
// wrong by 800 m to 1.4 km, and how CPH ended up with two different
// assets sharing one position because somebody reached for the runway
// centre when they wanted a glidepath antenna.
//
// The input is what an operator can actually produce: points on a map.
// Not names to be looked up — that was tried and measured against
// Billund, where OpenStreetMap holds 1,505 aerodrome features and names
// 30 of them, most of which are Legoland attractions. A name resolver
// found three of ten real assets and would have reported the other
// seven as unverified.
//
// TWO THINGS IT REFUSES TO GUESS
//
//   verified. Defaults to 'unverified' unless the feature says
//   otherwise. A pin someone dropped is not a surveyed position, and
//   the build gate already demands this field be honest rather than
//   flattering.
//
//   position. A point outside the site boundary is reported as an error
//   rather than written out. That is the failure that does not announce
//   itself: the block parses, the gate passes, and the asset sits in a
//   field a kilometre away.
//
// Usage:
//   node scripts/site-context-from-geojson.mjs --site odense --in assets.geojson
//   node scripts/site-context-from-geojson.mjs --site odense --in assets.geojson --group critical_areas
//
// Feature properties it reads, all optional except name:
//   name         what it is called. Required.
//   id           snake_case key. Derived from name if absent.
//   asset_type   e.g. fuel_storage, atc_control_tower, emergency_response
//   criticality  critical | high | medium | low     (default: high)
//   verified     high | medium | approximate | unverified  (default: unverified)
//   reason       one line on why it matters. Left as a TODO if absent.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const siteId = opt('site');
const inPath = opt('in');
const group = opt('group', 'high_value_assets');
if (!siteId || !inPath) {
  console.error('usage: --site <site_id> --in <file.geojson> [--group high_value_assets|critical_areas|response_asset_positions]');
  process.exit(2);
}

const { SITES } = await import('../src/sites_registry.js');
const site = SITES[siteId];
if (!site) {
  console.error(`Unknown site '${siteId}'. Known: ${Object.keys(SITES).join(', ')}`);
  process.exit(2);
}
const ring = site.boundary || site.perimeter || site.siteBoundary || [];
if (ring.length < 3) {
  console.error(`Site '${siteId}' has no usable boundary, so nothing can be checked against it.`);
  process.exit(2);
}

// Even-odd ray cast. The boundary is [lon, lat] pairs, same as GeoJSON.
function insideBoundary(lon, lat) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const slug = (s) => s.toLowerCase()
  .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'oe').replace(/[å]/g, 'aa')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

const doc = JSON.parse(readFileSync(inPath, 'utf8'));
const feats = doc.type === 'FeatureCollection' ? doc.features : [doc];

const rows = [];
const errors = [];
const seen = new Set();

for (const [n, f] of feats.entries()) {
  const g = f.geometry || {};
  const p = f.properties || {};
  const label = p.name || p.title;
  if (g.type !== 'Point') {
    errors.push(`feature ${n + 1}${label ? ` (${label})` : ''}: geometry is ${g.type}, not Point. `
      + 'Areas belong in critical_areas with their own shape; this writes point assets.');
    continue;
  }
  if (!label) {
    errors.push(`feature ${n + 1}: no "name" property. An unnamed asset cannot be referenced by anything.`);
    continue;
  }
  const [lon, lat] = g.coordinates;
  if (!insideBoundary(lon, lat)) {
    errors.push(`"${label}" at ${lat.toFixed(5)}, ${lon.toFixed(5)} is OUTSIDE the ${siteId} boundary. `
      + 'Refusing to write it: a pin in the wrong field still parses and still passes the gate.');
    continue;
  }
  const id = p.id || slug(label);
  if (seen.has(id)) {
    errors.push(`duplicate id '${id}' from "${label}". Give one of them an explicit "id" property.`);
    continue;
  }
  seen.add(id);
  rows.push({
    id,
    name: label,
    lat: +lat.toFixed(6),
    lon: +lon.toFixed(6),
    asset_type: p.asset_type || 'unclassified',
    criticality: p.criticality || 'high',
    verified: p.verified || 'unverified',
    reason: p.reason || 'TODO: why this asset matters operationally.',
  });
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s), nothing written:\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('');
  process.exit(1);
}
if (!rows.length) {
  console.error('No point features found.');
  process.exit(1);
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const pad = (s, w) => String(s).padEnd(w);
const wId = Math.max(...rows.map(r => q(r.id).length)) + 1;
const wNm = Math.max(...rows.map(r => q(r.name).length)) + 1;

console.log(`    // ${rows.length} asset(s) from ${inPath}, placed on a map rather than`);
console.log('    // matched by name. Positions are exact to where the pin was dropped;');
console.log("    // 'verified' says how much that pin was trusted, not how precise it is.");
console.log(`    ${group}: [`);
for (const r of rows) {
  console.log(
    `      { id: ${pad(q(r.id) + ',', wId)} name: ${pad(q(r.name) + ',', wNm)}`
    + ` location: { lat: ${r.lat}, lon: ${r.lon} },`
    + ` asset_type: ${q(r.asset_type)}, criticality: ${q(r.criticality)}, verified: ${q(r.verified)},`);
  console.log(`        reason: ${q(r.reason)} },`);
}
console.log('    ],');

const byV = rows.reduce((a, r) => (a[r.verified] = (a[r.verified] || 0) + 1, a), {});
console.error(`\n✓ ${rows.length} asset(s), all inside the ${siteId} boundary. `
  + Object.entries(byV).map(([k, v]) => `${v} ${k}`).join(', ')
  + '\n  Paste the block above into src/site_context.js under this site.\n');
