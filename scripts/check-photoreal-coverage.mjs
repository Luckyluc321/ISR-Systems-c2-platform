// ═══════════════════════════════════════════════════════════════════
// check:photoreal-coverage — the rings are sound, the owner keeps them
// ───────────────────────────────────────────────────────────────────
// Inside a bundled ring the OSM boxes are clipped away because Google's
// own building meshes are there. A bad ring therefore fails in the one
// way that looks worst: flat ground where a city should stand. And the
// clip lives on a tileset that a site mesh also clips, so the second
// thing to guard is that a site coming and going never takes the city
// rings with it, which is exactly what the old direct writes did.
//
// Pure node. Cesium is faked: a ClippingPolygon is whatever it was
// given, a collection is its polygon list.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import {
  coverageRings, coverageClipPolygons, createBoxClipOwner, isUsableRing,
} from '../src/photoreal_coverage.js';
import { applyBuildingSwap, clearBuildingSwap } from '../src/building_footprints.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const FakeCesium = {
  ClippingPolygon: class { constructor({ positions }) { this.positions = positions; } },
  ClippingPolygonCollection: class {
    constructor({ polygons, inverse }) { this.polygons = polygons; this.inverse = inverse; }
    get length() { return this.polygons.length; }
  },
  Cartesian3: { fromDegrees: (lon, lat) => ({ lon, lat }) },
};

// ── 1. The data ───────────────────────────────────────────────────
console.log('\n[1] bundled rings');
const raw = JSON.parse(readFileSync(new URL('../src/data/photoreal_coverage.json', import.meta.url)));
const rings = coverageRings(raw);
check('at least one ring is bundled', Object.keys(rings).length >= 1);

const segmentsCross = (a, b, c, d) => {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
const shoelaceKm2 = ring => {
  const latRef = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111.32 * Math.cos((latRef * Math.PI) / 180), ky = 111.32;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky);
  }
  return Math.abs(a) / 2;
};

for (const [name, entry] of Object.entries(rings)) {
  const ring = entry.ring;
  check(`${name}: usable ring`, isUsableRing(ring));
  check(`${name}: dated and attributed`, typeof entry.traced === 'string' && typeof entry.by === 'string',
    'a ring with no trace date cannot be re-walked when Google extends coverage');
  check(`${name}: inside Denmark's bounding box`,
    ring.every(([lon, lat]) => lon > 7.5 && lon < 15.5 && lat > 54.4 && lat < 58.0),
    'a vertex outside Denmark is a lon/lat swap or a stray click');
  let dup = false;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i][0] === ring[i - 1][0] && ring[i][1] === ring[i - 1][1]) dup = true;
  }
  check(`${name}: no repeated consecutive vertex`, !dup);
  const n = ring.length;
  let crossings = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) crossings++;
    }
  }
  check(`${name}: no self-intersection`, crossings === 0,
    `${crossings} crossing segment pair(s); Cesium builds a distance field from this and the clip goes wrong at the crossing`);
  const area = shoelaceKm2(ring);
  check(`${name}: area is a city, not a stray triangle (${Math.round(area)} km²)`, area > 10 && area < 20000);
}

// ── 2. Polygons from rings ────────────────────────────────────────
console.log('\n[2] polygons');
const polys = coverageClipPolygons(FakeCesium, rings);
check('one polygon per usable ring', polys.length === Object.values(rings).filter(e => isUsableRing(e.ring)).length);
check('vertices pass through as lon, lat in that order',
  polys[0].positions[0].lon === Object.values(rings)[0].ring[0][0]
  && polys[0].positions[0].lat === Object.values(rings)[0].ring[0][1]);
const origWarn = console.warn; let warned = '';
console.warn = (...a) => { warned += a.join(' '); };
const skipped = coverageClipPolygons(FakeCesium, { bad: { ring: [[12, 55]] }, good: rings[Object.keys(rings)[0]] });
console.warn = origWarn;
check('a bad ring is skipped and named, the others still apply', skipped.length === 1 && /bad/.test(warned));

// ── 3. The owner ──────────────────────────────────────────────────
console.log('\n[3] owner');
let photoreal = true;
const box = {};
const owner = createBoxClipOwner({ Cesium: FakeCesium, boxTileset: box, isPhotorealShown: () => photoreal });
owner.setBase(polys);
check('base applies: collection on the tileset, inverse false',
  box.clippingPolygons && box.clippingPolygons.length === polys.length && box.clippingPolygons.inverse === false);

const siteRects = [new FakeCesium.ClippingPolygon({ positions: [1, 2, 3] })];
owner.setSite(siteRects);
check('site polygons add on top of the base', box.clippingPolygons.length === polys.length + 1);
owner.clearSite();
check('clearing the site keeps the city rings', box.clippingPolygons.length === polys.length,
  'this is the regression the owner exists to stop: unloading Billund used to wipe the whole collection');

photoreal = false; owner.follow();
check('photoreal hidden: base comes off, boxes are the only buildings again', box.clippingPolygons === undefined);
owner.setSite(siteRects);
check('photoreal hidden: a site mesh still clips its own boxes', box.clippingPolygons && box.clippingPolygons.length === 1);
photoreal = true; owner.follow();
check('photoreal back: base returns beside the site polygons', box.clippingPolygons.length === polys.length + 1);
owner.setBase([]); owner.clearSite();
check('nothing to clip: property cleared, not an empty collection', box.clippingPolygons === undefined);

const noBox = createBoxClipOwner({ Cesium: FakeCesium, boxTileset: null });
noBox.setBase(polys);
check('no OSM tileset: owner is inert', noBox.state().applied === false);

// ── 4. building_footprints routes through the owner ───────────────
console.log('\n[4] building swap');
globalThis.Cesium = FakeCesium;   // building_footprints reads the global
const box2 = {};
const owner2 = createBoxClipOwner({ Cesium: FakeCesium, boxTileset: box2 });
owner2.setBase(polys);
const r = applyBuildingSwap({ siteId: 'billund', boxTileset: box2, boxClip: owner2 });
check('applyBuildingSwap with an owner reports boxes handled', r.boxes === true && r.polygons > 0);
check('...and the city rings are still in the collection', box2.clippingPolygons.length === polys.length + r.polygons);
clearBuildingSwap({ boxTileset: box2, boxClip: owner2 });
check('clearBuildingSwap with an owner leaves the city rings', box2.clippingPolygons.length === polys.length);
const box3 = {};
applyBuildingSwap({ siteId: 'billund', boxTileset: box3 });
check('without an owner the old direct write still works', !!box3.clippingPolygons);
clearBuildingSwap({ boxTileset: box3 });
check('...and clears as before', box3.clippingPolygons === undefined);

// ── 5. main.js wiring ─────────────────────────────────────────────
console.log('\n[5] wiring');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const direct = main.match(/osmBuildings\.clippingPolygons\s*=/g) || [];
check('main.js never writes osmBuildings.clippingPolygons directly', direct.length === 0,
  `${direct.length} direct write(s); every write goes through _boxClip`);
const swapCalls = main.match(/(applyBuildingSwap|clearBuildingSwap)\(\{[^}]*boxTileset: osmBuildings[^}]*\}/g) || [];
check('every swap call that names the box tileset passes the owner',
  swapCalls.length >= 4 && swapCalls.every(c => /boxClip: _boxClip/.test(c)),
  `${swapCalls.length} call(s), missing owner in: ${swapCalls.filter(c => !/boxClip/.test(c)).length}`);
check('base layer only applied when photoreal loaded', /if \(googlePhotoreal && osmBuildings\)[\s\S]{0,400}_boxClip\.setBase/.test(main));
check('follow() runs per frame', /preRender\.addEventListener\(\(\) => _boxClip\.follow\(\)\)/.test(main));
check('no mode branch sets osmBuildings.show from this change',
  (main.match(/osmBuildings\.show = /g) || []).length === 7,
  'applyImageryMode and _updateNightPhotoreal own .show; this change must not add a writer');

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
