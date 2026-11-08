// ═══════════════════════════════════════════════════════════════════
// check:dk-city-meshes — Danish meshes first, Google's city as fallback
// ───────────────────────────────────────────────────────────────────
// The failure that matters most is a flat city: Google's city clipped
// out of an area where nothing Danish is drawn. So this holds that the
// clip only happens once a Danish tile has actually arrived, and that it
// comes off again when the mesh fails, is forced off, or never loads.
// Second, that night mode keeps its look: the mesh follows Google's own
// visibility and never sets it. Third, that the data stays cheap enough
// for Cesium's clipping shader on a customer's laptop.
//
// Pure node. Cesium is faked.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import {
  meshEntries, entryProblems, createDanishCityMeshes, LIFT_RANGE_M, FAIL_LIMIT,
} from '../src/dk_city_meshes.js';
import { createBoxClipOwner } from '../src/photoreal_coverage.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── fake Cesium ───────────────────────────────────────────────────
const evt = () => { const l = []; return { addEventListener: (f) => l.push(f), raise: (...a) => l.forEach((f) => f(...a)) }; };
let supported = true;
let fromUrlMode = 'resolve';
const created = [];
class FakeTileset {
  constructor(url) {
    this.url = url; this.show = true; this.modelMatrix = null; this.clippingPolygons = undefined;
    this.boundingSphere = { center: { x: 1, y: 2, z: 3 } };
    this.tileLoad = evt(); this.tileFailed = evt();
  }
}
class FakeCartesian3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  static fromDegrees(lon, lat) { return { lon, lat }; }
  static fromRadians(lon, lat, h) { return new FakeCartesian3(0, 0, h); }
  static subtract(a, b, r) { r.x = a.x - b.x; r.y = a.y - b.y; r.z = a.z - b.z; return r; }
}
const FakeCesium = {
  ClippingPolygon: class { constructor({ positions }) { this.positions = positions; } },
  ClippingPolygonCollection: class {
    constructor({ polygons, inverse, quality }) { this.polygons = polygons; this.inverse = inverse; this.quality = quality; }
    get length() { return this.polygons.length; }
    static isSupported() { return supported; }
  },
  Cartesian3: FakeCartesian3,
  Cartographic: { fromCartesian: () => ({ longitude: 0.22, latitude: 0.97 }) },
  Matrix4: { fromTranslation: (t) => ({ lift: t.z }) },
  Cesium3DTileset: {
    fromUrl: (url) => {
      if (fromUrlMode === 'reject') return Promise.reject(new Error('404 from the publisher'));
      const t = new FakeTileset(url); created.push(t); return Promise.resolve(t);
    },
  },
};
const added = [];
const viewer = { scene: { primitives: { add: (t) => added.push(t) } } };
const quiet = (fn) => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return fn(); } finally { console.warn = w; console.log = l; } };

// ── 1. The data ───────────────────────────────────────────────────
console.log('\n[1] bundled meshes');
const raw = JSON.parse(readFileSync(new URL('../src/data/dk_city_meshes.json', import.meta.url)));
const entries = meshEntries(raw);
check('copenhagen is bundled and usable', entries.some((e) => e.id === 'copenhagen'));
const segmentsCross = (a, b, c, d) => {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
const km2 = (ring) => {
  const latRef = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111.32 * Math.cos((latRef * Math.PI) / 180), ky = 110.57;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky);
  }
  return Math.abs(a) / 2;
};
for (const e of entries) {
  const rings = e.area.rings;
  const vertices = rings.reduce((s, r) => s + r.length, 0);
  check(`${e.id}: licence position and check date recorded`, typeof e.licence === 'string' && e.licence.length > 10 && typeof e.checked === 'string',
    'a mesh with no recorded licence position cannot go in front of a customer');
  check(`${e.id}: every vertex inside Denmark`, rings.every((r) => r.every(([lon, lat]) => lon > 7.5 && lon < 15.5 && lat > 54.4 && lat < 58.0)));
  check(`${e.id}: ${vertices} clip vertices, at most 1,500`, vertices <= 1500,
    'Cesium\'s clipping shader visits every vertex for every texel of a 2048 to 4096 px texture; more stalls a weak laptop');
  let crossings = 0;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) crossings++;
    }
  }
  check(`${e.id}: no ring crosses itself`, crossings === 0, `${crossings} crossing pair(s)`);
  const area = rings.reduce((s, r) => s + km2(r), 0);
  check(`${e.id}: area is a town, not a stray (${area.toFixed(1)} km²)`, area > 1 && area < 2000);
  check(`${e.id}: lift inside the Danish geoid band`, e.liftM >= LIFT_RANGE_M[0] && e.liftM <= LIFT_RANGE_M[1]);
}
check('a plain-http url is refused', entryProblems({ ...entries[0], url: 'http://x/tileset.json' }).length > 0);
check('a lift of 10 m is refused', entryProblems({ ...entries[0], liftM: 10 }).length > 0);
check('a missing area is refused', entryProblems({ ...entries[0], area: {} }).length > 0);

// ── 2. The controller ─────────────────────────────────────────────
console.log('\n[2] Danish first, Google as fallback');
const cph = entries.find((e) => e.id === 'copenhagen');
const nRings = cph.area.rings.length;
let areas = null;
const google = { show: true, clippingPolygons: undefined };
const ctl = quiet(() => createDanishCityMeshes({
  Cesium: FakeCesium, viewer, googlePhotoreal: google, entries: [cph], onAreasChange: (p) => { areas = p; },
}));
await tick();
const ts = created[0];
check('the mesh tileset is added to the scene', added.includes(ts));
check('lifted by liftM', ts.modelMatrix && ts.modelMatrix.lift === cph.liftM);
check('the mesh is kept only inside its area (inverse clip)', ts.clippingPolygons && ts.clippingPolygons.inverse === true && ts.clippingPolygons.length === nRings);
check('before any tile arrives, Google\'s city is untouched', google.clippingPolygons === undefined,
  'clipping on tileset.json alone is the flat-city failure');
check('...and the boxes are untouched', areas === null);
ctl.follow();
check('...and nothing counts as shown yet', ctl.anyShown() === false);

quiet(() => ts.tileLoad.raise());
check('first tile: Google\'s city clipped out inside the area', google.clippingPolygons && google.clippingPolygons.inverse === false && google.clippingPolygons.length === nRings);
check('first tile: the box clip gets the same area', Array.isArray(areas) && areas.length === nRings);
ctl.follow();
check('shown while Google\'s city is shown', ts.show === true && ctl.anyShown() === true);
google.show = false; ctl.follow();
check('hidden while Google\'s city is hidden (night keeps its look)', ts.show === false && ctl.anyShown() === false);
check('...and Google\'s show flag was never written', google.show === false);
google.show = true; ctl.follow();

quiet(() => ctl.console.force('copenhagen', 'off'));
check('forced off: Google\'s city gets the area back', google.clippingPolygons === undefined && areas.length === 0);
ctl.follow();
check('forced off: the mesh is hidden', ts.show === false);
quiet(() => ctl.console.force('copenhagen', 'auto'));
ctl.follow();
check('auto again: clip and mesh return', google.clippingPolygons && google.clippingPolygons.length === nRings && ts.show === true);

quiet(() => ctl.console.lift('copenhagen', 38.2));
check('live lift moves the mesh', ts.modelMatrix.lift === 38.2);

quiet(() => { for (let i = 0; i < FAIL_LIMIT; i++) ts.tileFailed.raise({ message: 'tile 503' }); });
check(`after ${FAIL_LIMIT} failed tiles: Google's city covers the area again`, google.clippingPolygons === undefined && areas.length === 0);
ctl.follow();
check('...the mesh stays hidden', ts.show === false && ctl.anyShown() === false);
check('...and status says why', /failed/.test(ctl.status()[0].state) && /tiles failed/.test(ctl.status()[0].error || ''));

// a publisher that is down from the start
fromUrlMode = 'reject';
const g2 = { show: true, clippingPolygons: undefined };
const ctl2 = quiet(() => createDanishCityMeshes({ Cesium: FakeCesium, viewer, googlePhotoreal: g2, entries: [cph] }));
await tick();
check('mesh never loads: Google\'s city untouched', g2.clippingPolygons === undefined && ctl2.status()[0].state === 'failed');
fromUrlMode = 'resolve';

// development without ?google=1: no Google tileset to follow
const ctl3 = quiet(() => createDanishCityMeshes({ Cesium: FakeCesium, viewer, googlePhotoreal: null, entries: [cph], isNight: () => { throw new ReferenceError('imageryMode in TDZ'); } }));
await tick();
const ts3 = created[created.length - 1];
quiet(() => ts3.tileLoad.raise());
let threw = false;
try { ctl3.follow(); } catch (_) { threw = true; }
check('no Google tileset, isNight throws: no throw, mesh shown', !threw && ts3.show === true);

// no WebGL2 clipping
supported = false;
const before = created.length;
const g4 = { show: true, clippingPolygons: undefined };
quiet(() => createDanishCityMeshes({ Cesium: FakeCesium, viewer, googlePhotoreal: g4, entries: [cph] }));
await tick();
check('no clipping support: no Danish mesh loaded, Google untouched', created.length === before && g4.clippingPolygons === undefined);
supported = true;

// ── 3. The box clip owner ─────────────────────────────────────────
console.log('\n[3] OSM boxes');
let danishUp = false;
const box = {};
const owner = createBoxClipOwner({ Cesium: FakeCesium, boxTileset: box, isPhotorealShown: () => false, isDanishMeshShown: () => danishUp });
const kk = cph.area.rings.map((r) => new FakeCesium.ClippingPolygon({ positions: r }));
owner.setDanish(kk);
check('Danish areas do not clip while no mesh is shown', box.clippingPolygons === undefined);
danishUp = true; owner.follow();
check('mesh shown: boxes clipped out of its area', box.clippingPolygons && box.clippingPolygons.length === kk.length);
danishUp = false; owner.follow();
check('mesh hidden or down: the boxes come back', box.clippingPolygons === undefined);
const throwing = createBoxClipOwner({ Cesium: FakeCesium, boxTileset: {}, isDanishMeshShown: () => { throw new Error('early frame'); } });
let threw2 = false;
try { throwing.setDanish(kk); throwing.follow(); } catch (_) { threw2 = true; }
check('a throwing flag counts as not shown, never throws', !threw2);

// ── 4. main.js wiring ─────────────────────────────────────────────
console.log('\n[4] wiring');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const mod = readFileSync(new URL('../src/dk_city_meshes.js', import.meta.url), 'utf8');
check('main.js imports createDanishCityMeshes', /import \{ createDanishCityMeshes \} from '\.\/dk_city_meshes\.js'/.test(main));
const decl = main.indexOf('let _dkMeshes = null;');
const ownerAt = main.indexOf('createBoxClipOwner({');
check('_dkMeshes is declared before the owner that reads it', decl > 0 && ownerAt > decl);
check('the owner is told when a Danish mesh is shown', /isDanishMeshShown: \(\) => !!_dkMeshes && _dkMeshes\.anyShown\(\)/.test(main));
check('the meshes start without blocking boot (no await)', /_dkMeshes = createDanishCityMeshes\(\{/.test(main) && !/await createDanishCityMeshes/.test(main));
check('Google\'s tileset is passed in', /createDanishCityMeshes\(\{[\s\S]{0,200}googlePhotoreal,/.test(main));
check('follow() runs per frame', /preRender\.addEventListener\(\(\) => _dkMeshes\.follow\(\)\)/.test(main));
check('main.js never clips Google\'s tileset itself', !/googlePhotoreal\.clippingPolygons\s*=/.test(main));
check('no new writer of googlePhotoreal.show in main.js', (main.match(/googlePhotoreal\.show = /g) || []).length === 4,
  'applyImageryMode and _updateNightPhotoreal own it');
const modCode = mod.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
check('the module never sets Google\'s or the boxes\' show flag', !/(googlePhotoreal|osmBuildings)\.show\s*=[^=]/.test(modCode));

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
