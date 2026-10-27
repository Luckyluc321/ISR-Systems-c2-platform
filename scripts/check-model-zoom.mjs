// ═══════════════════════════════════════════════════════════════════
// check:model-zoom — zooming in on a vehicle never makes it smaller
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-27: "the more I zoom into a vehicle, the smaller it
// gets, until you're close enough where you're actually right around
// it". A flat minimumPixelSize held the model at N pixels across most of
// the zoom while the world grew around it. src/model_zoom_floor.js grows
// the floor inside the swap distance. This gate runs Cesium's own sizing
// rule over the zoom for the vehicles it applies to.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { zoomFloorPx, ZOOM_CFG } from '../src/model_zoom_floor.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

// Cesium (Model.js, updateComputedScale): the scale that makes the model
// minimumPixelSize pixels, never below its own scale, capped at
// maximumScale. In pixels, with life the model's true on-screen size:
//   drawn = life * min(cap, max(1, floor / life))
const FOCAL_PX = 935;   // a 1080 px tall view at Cesium's 60 degree field
const drawn = (lengthM, d, floorPx, capX) => {
  const life = lengthM * FOCAL_PX / d;
  return life * Math.min(capX, Math.max(1, floorPx / life));
};

console.log('\n[the floor]');
check('unchanged at the swap distance, where the map symbol hands over', zoomFloorPx(20, 700, 700) === 20);
check('unchanged beyond it', zoomFloorPx(20, 700, 5000) === 20);
check('growth 0 is the flat floor of before, everywhere', [700, 300, 50, 5].every(d => zoomFloorPx(20, 700, d, 0) === 20));
check('1.4 times bigger each time the distance halves', Math.abs(zoomFloorPx(20, 700, 350) / 20 - Math.SQRT2) < 1e-9);
check(`default growth is ${ZOOM_CFG.growth}`, ZOOM_CFG.growth === 0.5);

console.log('\n[on screen, zooming in from the swap distance to point blank]');
const VEHICLES = [
  { name: 'hostile quadcopter', lengthM: 0.5, floor: 14, swap: 250, cap: 12 },
  { name: 'Shahed-class loitering munition', lengthM: 3.5, floor: 24, swap: 250, cap: 12 },
  { name: 'fixed-wing, Aarhus (700 m swap)', lengthM: 3.0, floor: 20, swap: 700, cap: 12 },
  { name: 'fixed-wing, default (1800 m swap)', lengthM: 3.0, floor: 20, swap: 1800, cap: 12 },
];
for (const v of VEHICLES) {
  const path = []; for (let d = v.swap; d >= 3; d *= 0.97) path.push(d);
  const now = path.map(d => drawn(v.lengthM, d, zoomFloorPx(v.floor, v.swap, d), v.cap));
  const before = path.map(d => drawn(v.lengthM, d, v.floor, v.cap));
  let shrinks = 0, flat = 0;
  for (let i = 1; i < path.length; i++) {
    if (now[i] < now[i - 1] - 1e-9) shrinks++;
    if (Math.abs(before[i] - before[i - 1]) < 1e-9) flat++;
  }
  const flatShare = Math.round(100 * flat / (path.length - 1));
  check(`${v.name}: grows at every step of the zoom (before, it stood still for ${flatShare}% of it)`, shrinks === 0 && now.at(-1) > now[0]);
  const mid = path.findIndex(d => d <= v.swap / 4);
  // Twice the pinned size there, unless its true size has already
  // taken over (a 3.5 m Shahed at 60 m is past its floor either way).
  const expect = drawn(v.lengthM, path[mid], v.floor * Math.sqrt(v.swap / path[mid]), v.cap);
  check(`${v.name}: at a quarter of the swap distance, twice the pinned size or true size`, Math.abs(now[mid] - expect) < 1e-6 && now[mid] >= before[mid],
    `${now[mid].toFixed(1)} px, before ${before[mid].toFixed(1)} px`);
  check(`${v.name}: same size as before where the symbol hands over`, Math.abs(now[0] - before[0]) < 1e-9);
}

console.log('\n[the wiring]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const uses = (main.match(/minimumPixelSize: zoomFloorProperty\(Cesium, viewer, \(\) => _(billboardRef|swBbRef),/g) || []);
check('the threat track (fixed-wing and quad/loitering branches) and the swarm members use it', uses.length === 3, `${uses.length} uses`);
check('anchored at the same swap distance the symbol uses', (main.match(/zoomFloorProperty\([^)]*\)[^,]*?,[\s\S]{0,80}?MODEL_SWAP_M\)/g) || []).length >= 3);

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
