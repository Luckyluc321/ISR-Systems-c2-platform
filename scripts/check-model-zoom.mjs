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
const flat = (n) => n;   // the original flat floor

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
check(`zoomed out, ${ZOOM_CFG.farBoost} times the old floor: seen, not dramatic`, ZOOM_CFG.farBoost >= 1.2 && ZOOM_CFG.farBoost <= 1.6
  && Math.abs(zoomFloorPx(20, 700, 700) - 20 * ZOOM_CFG.farBoost) < 1e-9 && Math.abs(zoomFloorPx(20, 700, 5000) - 20 * ZOOM_CFG.farBoost) < 1e-9);
check('the way back, growth 0 and boost 1, is the flat floor of before, everywhere', [700, 300, 50, 5].every(d => zoomFloorPx(20, 700, d, 0, 1) === flat(20)));
check('without the boost, 1.4 times bigger each time the distance halves', Math.abs(zoomFloorPx(20, 700, 350, 0.5, 1) / 20 - Math.SQRT2) < 1e-9);
check('a boost too large for the growth is held so the size still never dips', (() => {
  let prev = 0; for (let d = 700; d >= 1; d *= 0.95) { const f = zoomFloorPx(20, 700, d, 0.5, 5) * 1; if (f < prev - 1e-9) return false; prev = f; } return true; })());
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
  check(`${v.name}: at least as big as the old flat floor at every distance`, now.every((x, i) => x >= before[i] - 1e-9));
  // Unless the exaggeration cap (maximumScale, 12 times life) already
  // governs that far out, which it does for a 3 m fixed-wing at 1800 m.
  const capped = drawn(v.lengthM, path[0], 1e9, v.cap);
  const want = Math.min(capped, before[0] * ZOOM_CFG.farBoost);
  check(`${v.name}: zoomed out, ${ZOOM_CFG.farBoost} times the old size where the symbol hands over, or the cap`,
    Math.abs(now[0] - want) < 1e-6, `${now[0].toFixed(1)} px, want ${want.toFixed(1)}`);
  // Up close the boost has faded: within 10% of the unboosted curve.
  const near = path.findIndex(d => d <= v.swap / 20);
  const unboosted = drawn(v.lengthM, path[near], zoomFloorPx(v.floor, v.swap, path[near], ZOOM_CFG.growth, 1), v.cap);
  check(`${v.name}: up close the boost has faded, so a close shot is as realistic as before`, now[near] / unboosted < 1.1,
    `${now[near].toFixed(1)} px against ${unboosted.toFixed(1)} px`);
}

console.log('\n[the wiring]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const uses = (main.match(/minimumPixelSize: zoomFloorProperty\(Cesium, viewer, \(\) => _(billboardRef|swBbRef),/g) || []);
check('the threat track (fixed-wing and quad/loitering branches) and the swarm members use it', uses.length === 3, `${uses.length} uses`);
check('anchored at the same swap distance the symbol uses', (main.match(/zoomFloorProperty\([^)]*\)[^,]*?,[\s\S]{0,80}?MODEL_SWAP_M\)/g) || []).length >= 3);

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
