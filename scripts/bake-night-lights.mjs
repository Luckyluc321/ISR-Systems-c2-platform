#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Bake night infrastructure lighting geometry into static assets.
// ───────────────────────────────────────────────────────────────────
// Why offline: the density required for a real night-aerial look is the
// full street network, and the public Overpass endpoint returns HTTP 504
// for a whole site bbox in one request. Tiled requests do work, but doing
// that at runtime would mean tens of seconds of latency, a hard dependency
// on a rate-limited community endpoint, and a sovereignty problem. Baking
// once removes all three: the app ships the geometry and loads it locally.
//
// Output: public/night-lights/<siteId>.json
//   { roads: [[lat,lon,...], ...], runway: [...], taxiway: [...], harbour: [...] }
// Flat coordinate arrays, 5dp (~1 m), which is well under the precision
// any of this is rendered at and keeps the files small.
//
// Usage:  node scripts/bake-night-lights.mjs [siteId ...]
// Re-run only when adding a site. The output is committed.
// ═══════════════════════════════════════════════════════════════════

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'night-lights');
// Multiple mirrors. The main endpoint throttles hard under sustained use,
// and a bake is exactly that. Rotating on failure turns a dead run into a
// slow one. This is also precisely why the app does not query at runtime.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
let _endpointIdx = 0;

// Half-extent of the baked area around each site, in degrees. ~0.06 lat is
// roughly 6.5 km, so a site gets a ~13 km square — comfortably more than is
// visible at the altitude these lights render at.
const PAD_LAT = 0.06;
const PAD_LON = 0.10;
// Tile size that reliably completes. A whole site bbox in one request 504s.
// Smaller tiles than the first pass: the combined road+aeroway+seamark
// query is expensive and 504s (server-side timeouts) scale with tile area.
const TILE_LAT = 0.02;
const TILE_LON = 0.03;

const ROAD_CLASSES = 'motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street';

// padLat/padLon override the default half-extent. A site adjacent to a
// major city needs a box covering the CITY, not just the site: the default
// pad centred on CPH airport stopped at 55.678 N, which cuts straight
// through central Copenhagen and left the whole inner city unlit.
const SITES = {
  // NOTE on regional coverage: a full-detail box over all of Sjælland is
  // ~4,300 tiles (hours of fetching) and hundreds of MB. Regional reach is
  // handled by the `--national` pass instead, which bakes only the major
  // network across Denmark at coarse tiles — that is also what real night
  // imagery shows between cities: motorway threads, not lit side streets.
  // Full residential detail stays scoped to city-sized boxes below.
  cph:                        { lat: 55.6600, lon: 12.5900, padLat: 0.115, padLon: 0.190 },
  roskilde:                   { lat: 55.6420, lon: 12.0800, padLat: 0.075, padLon: 0.125 },
  helsingoer:                 { lat: 56.0300, lon: 12.5700, padLat: 0.070, padLon: 0.115 },
  esbjerg:                    { lat: 55.4650, lon: 8.4400 },
  billund:                    { lat: 55.7403, lon: 9.1518 },
  energinet_hovegaard:        { lat: 55.7180, lon: 12.2680 },
  energinet_bjaeverskov:      { lat: 55.4620, lon: 12.0350 },
  energinet_landerupgaard:    { lat: 55.5020, lon: 9.5600 },
  energinet_kassoe:           { lat: 55.0570, lon: 9.3120 },
  energinet_ferslev:          { lat: 56.8400, lon: 9.8800 },
  energinet_amager:           { lat: 55.6600, lon: 12.6200 },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function overpass(query, attempt = 1) {
  const endpoint = ENDPOINTS[_endpointIdx % ENDPOINTS.length];
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'isr-c2-platform/1.0' },
      body: query,
    });
  } catch (err) {
    if (attempt >= 8) throw new Error(`network: ${err.message}`);
    _endpointIdx++;
    await sleep(3000);
    return overpass(query, attempt + 1);
  }
  if (res.status === 429 || res.status === 504 || res.status === 503) {
    if (attempt >= 8) throw new Error(`Overpass ${res.status} after ${attempt} attempts`);
    _endpointIdx++;                       // rotate to the next mirror
    const wait = Math.min(30000, 4000 * attempt);
    console.log(`    ${res.status} on ${new URL(endpoint).host}, next mirror in ${wait / 1000}s...`);
    await sleep(wait);
    return overpass(query, attempt + 1);
  }
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return (await res.json()).elements || [];
}

function tileQuery(s, w, n, e) {
  const bbox = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  return `[out:json][timeout:60];
(
  way["highway"~"^(${ROAD_CLASSES})$"](${bbox});
  way["aeroway"~"^(runway|taxiway|apron)$"](${bbox});
  way["man_made"="pier"](${bbox});
  way["waterway"="dock"](${bbox});
  // IALA navigation lights. Real charted lights with real colours and
  // flash characteristics — harbours are not an ICAO Annex 14 matter.
  node["seamark:type"~"^(light_major|light_minor|light_vessel|landmark|buoy_lateral|buoy_cardinal|beacon_lateral|beacon_cardinal)$"](${bbox});
  // ICAO Annex 14 Ch.6 obstacle lighting — tall fixed structures carry
  // steady or flashing red. Matters at substations and industrial sites.
  node["man_made"~"^(mast|tower|chimney|water_tower)$"](${bbox});
  way["man_made"~"^(mast|tower|chimney|water_tower)$"](${bbox});
  node["power"="tower"](${bbox});
);
out geom;`;
}

// Road class is preserved rather than collapsed into one bucket. Real night
// imagery has enormous dynamic range — motorways are bright continuous
// threads, residential streets are dim and fine, and rural road is often
// not lit at all. Rendering every street identically is what makes a map
// read as a wireframe instead of a lit country.
//
// OSM records lighting directly via the `lit` tag (~95% coverage on Danish
// urban ways), so roads explicitly marked unlit are dropped rather than
// guessed at.
function classify(tags = {}) {
  if (tags.aeroway === 'runway') return 'runway';
  if (tags.aeroway === 'taxiway' || tags.aeroway === 'apron') return 'taxiway';
  if (tags['seamark:type']) return 'seamark';
  if (tags.man_made === 'mast' || tags.man_made === 'tower' ||
      tags.man_made === 'chimney' || tags.man_made === 'water_tower' ||
      tags.power === 'tower') return 'obstacle';
  if (tags.man_made === 'pier' || tags.waterway === 'dock') return 'harbour';

  const hw = tags.highway;
  if (!hw) return null;

  // Tunnels are lit inside but invisible from above. Without this the
  // Drogden tunnel renders as a motorway glowing across the seabed of the
  // Øresund — the road is tagged tunnel=yes, layer=-1 and is genuinely
  // under the water. Covered ways and anything below ground level go too.
  if (tags.tunnel && tags.tunnel !== 'no') return null;
  if (tags.covered && tags.covered !== 'no') return null;
  if (parseInt(tags.layer ?? '0', 10) < 0) return null;

  const lit = tags.lit;
  if (lit === 'no' || lit === 'disused') return null;

  if (hw === 'motorway' || hw === 'trunk') return 'motorway';
  if (hw === 'primary' || hw === 'secondary') return 'primary';
  if (hw === 'tertiary' || hw === 'unclassified') return 'tertiary';
  return 'residential';   // residential + living_street
}

async function bakeSite(siteId, { lat, lon, padLat, padLon }) {
  const pLat = padLat ?? PAD_LAT;
  const pLon = padLon ?? PAD_LON;
  const south = lat - pLat, north = lat + pLat;
  const west = lon - pLon, east = lon + pLon;
  console.log(`\n${siteId}  (${lat}, ${lon})  bbox ${south.toFixed(3)},${west.toFixed(3)} -> ${north.toFixed(3)},${east.toFixed(3)}`);

  const out = {
    motorway: [], primary: [], tertiary: [], residential: [],
    runway: [], taxiway: [], harbour: [],
    // Point features rather than polylines: {lat, lon, ...}
    seamark: [], obstacle: [],
  };
  const seen = new Set();   // way ids, so tile overlaps don't duplicate

  let failed = 0;
  const rows = Math.ceil((north - south) / TILE_LAT);
  const cols = Math.ceil((east - west) / TILE_LON);
  let done = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ts = south + r * TILE_LAT;
      const tw = west + c * TILE_LON;
      const tn = Math.min(ts + TILE_LAT, north);
      const te = Math.min(tw + TILE_LON, east);
      // Per-tile failure must not be fatal. Overpass 504s are routine under
      // load, and an unhandled one previously threw away every tile already
      // fetched for the site. A missing tile is a small dark patch; a lost
      // run is half an hour.
      // A skipped tile is a visible dark rectangle in the middle of a lit
      // city, so failures get a second pass with a long pause rather than
      // being written off. Only a tile that fails twice is abandoned.
      let els = [];
      try {
        els = await overpass(tileQuery(ts, tw, tn, te));
      } catch (err) {
        process.stdout.write(`\n    tile ${r},${c} failed, retrying after 30s...\n`);
        await sleep(30000);
        try {
          els = await overpass(tileQuery(ts, tw, tn, te));
        } catch (err2) {
          failed++;
          process.stdout.write(`    tile ${r},${c} skipped (${err2.message})\n`);
        }
      }
      for (const el of els) {
        // Nodes and ways share an id space, so key on both.
        const uid = `${el.type}/${el.id}`;
        if (seen.has(uid)) continue;
        seen.add(uid);
        const cls = classify(el.tags);
        if (!cls) continue;

        if (cls === 'seamark' || cls === 'obstacle') {
          // Point features. A way-tagged mast is reduced to its first
          // vertex, which is close enough for a single lamp.
          const lat = el.lat ?? el.geometry?.[0]?.lat;
          const lon = el.lon ?? el.geometry?.[0]?.lon;
          if (lat == null || lon == null) continue;
          const t = el.tags;
          const rec = { lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
          if (cls === 'seamark') {
            // Real charted light characteristics, kept so the render can
            // flash at the actual period rather than inventing one.
            const colour = t['seamark:light:colour'] ?? t['seamark:light:1:colour'];
            const character = t['seamark:light:character'] ?? t['seamark:light:1:character'];
            const period = t['seamark:light:period'] ?? t['seamark:light:1:period'];
            if (colour) rec.c = colour;
            if (character) rec.ch = character;
            if (period) rec.p = +period || undefined;
            rec.k = t['seamark:type'];
          } else {
            const h = parseFloat(t.height ?? t['tower:height'] ?? '');
            if (!Number.isNaN(h)) rec.h = h;
          }
          out[cls].push(rec);
          continue;
        }

        if (!Array.isArray(el.geometry) || el.geometry.length < 2) continue;
        const flat = [];
        for (const p of el.geometry) {
          flat.push(+p.lat.toFixed(5), +p.lon.toFixed(5));
        }
        out[cls].push(flat);
      }
      done++;
      process.stdout.write(`\r    tiles ${done}/${rows * cols}  ways ${seen.size}   `);
      await sleep(1200);   // be a good citizen on a shared endpoint
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${siteId}.json`);
  const json = JSON.stringify(out);
  await writeFile(file, json);
  const counts = Object.entries(out).filter(([, v]) => v.length).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`\n    -> ${file}  (${(json.length / 1024).toFixed(0)} KB)  ${counts}${failed ? `  [${failed} tiles skipped]` : ''}`);
}

// ── National layer ────────────────────────────────────────────────
// A per-site box ends somewhere, and that edge is visible as a hard line
// where the lit world simply stops. Real night imagery has no such edge:
// bright city cores are joined by thin motorway threads running across the
// whole country. This bakes only the major network nationally — sparse
// enough to use far larger tiles — and the per-site files layer dense
// residential detail on top of it.
const DENMARK = { south: 54.50, west: 8.00, north: 57.85, east: 15.25 };
const NAT_TILE_LAT = 0.5;
const NAT_TILE_LON = 0.5;

function nationalQuery(s, w, n, e) {
  const bbox = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  return `[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary)$"](${bbox});
);
out geom;`;
}

async function bakeNational() {
  console.log('\nnational major network (Denmark)');
  const out = { motorway: [], primary: [], tertiary: [], residential: [], runway: [], taxiway: [], harbour: [], seamark: [], obstacle: [] };
  const seen = new Set();
  const rows = Math.ceil((DENMARK.north - DENMARK.south) / NAT_TILE_LAT);
  const cols = Math.ceil((DENMARK.east - DENMARK.west) / NAT_TILE_LON);
  let done = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ts = DENMARK.south + r * NAT_TILE_LAT;
      const tw = DENMARK.west + c * NAT_TILE_LON;
      const tn = Math.min(ts + NAT_TILE_LAT, DENMARK.north);
      const te = Math.min(tw + NAT_TILE_LON, DENMARK.east);
      let els = [];
      try {
        els = await overpass(nationalQuery(ts, tw, tn, te));
      } catch (err) {
        console.log(`\n    tile ${r},${c} failed (${err.message}), continuing`);
      }
      for (const el of els) {
        const uid = `${el.type}/${el.id}`;
        if (seen.has(uid)) continue;
        seen.add(uid);
        const cls = classify(el.tags);
        if (!cls || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
        const flat = [];
        for (const p of el.geometry) flat.push(+p.lat.toFixed(5), +p.lon.toFixed(5));
        (out[cls] ?? out.primary).push(flat);
      }
      done++;
      process.stdout.write(`\r    tiles ${done}/${rows * cols}  ways ${seen.size}   `);
      await sleep(1000);
    }
  }
  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, '_national.json');
  const json = JSON.stringify(out);
  await writeFile(file, json);
  console.log(`\n    -> ${file}  (${(json.length / 1024).toFixed(0)} KB)  motorway ${out.motorway.length}, primary ${out.primary.length}`);
}

const requested = process.argv.slice(2);
if (requested[0] === '--national') {
  await bakeNational();
  console.log('\nDone.');
  process.exit(0);
}
const targets = requested.length
  ? requested.filter(id => SITES[id] || console.warn(`unknown site: ${id}`))
  : Object.keys(SITES);

for (const id of targets) {
  try {
    await bakeSite(id, SITES[id]);
  } catch (err) {
    console.error(`  FAILED ${id}: ${err.message}`);
  }
}
console.log('\nDone.');
