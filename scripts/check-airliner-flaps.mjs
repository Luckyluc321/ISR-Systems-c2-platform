// ═══════════════════════════════════════════════════════════════════
// check:airliner-flaps — slats and flaps follow the approach
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-24: the A320 landed with a clean wing. The model has
// slats and flaps, they were never driven. This gate holds the wiring:
// the extracted parts exist in the model and are not gear or spoilers,
// the stops travel one way, and every airliner route in the scenarios
// flies the schedule in airliner_flaps.js: out in order on the way down,
// FULL before the wheels touch, one step up at a go-around, clean on
// the climb out, never faster than the surfaces travel, and clean again
// the moment the switch is off.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { FLAPS_OUT, FLAP_STOPS } from '../src/a320_rigid_flaps.js';
import { RIGID_PARTS } from '../src/a320_rigid_gearup.js';
import { RIGID_PARTS as BRAKES_OUT } from '../src/a320_rigid_brakes.js';
import { createFlapSchedule, scheduledConfig, FLAP_CONFIGS, FLAP_CFG } from '../src/airliner_flaps.js';
import { TEMPLATES } from '../src/drones.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

console.log('\n[the parts]');
const glb = readFileSync(new URL('../public/aircraft/a320_noskin.glb', import.meta.url));
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const names = new Set((gltf.nodes || []).map(n => n.name));
const wingNodes = FLAPS_OUT.flatMap(p => p.nodes);
const missing = wingNodes.filter(n => !names.has(n));
check(`all ${wingNodes.length} slat and flap nodes exist in a320_noskin.glb`, !missing.length, missing.slice(0, 5).join(', '));
check('8 slat parts and 8 flap parts',
  FLAPS_OUT.filter(p => p.kind === 'slat').length === 8 && FLAPS_OUT.filter(p => p.kind === 'flap').length === 8);
check('slats are FrontFlaps, flaps are BackFlaps',
  FLAPS_OUT.every(p => (p.kind === 'slat') === /^FrontFlaps/.test(p.joint) && /Flaps/.test(p.joint)));
const driven = new Set([
  ...RIGID_PARTS.filter(p => /wheel|gear|wheeldoor/i.test(p.joint)).flatMap(p => p.nodes),
  ...BRAKES_OUT.filter(p => /AirBrake/i.test(p.joint)).flatMap(p => p.nodes),
]);
const shared = wingNodes.filter(n => driven.has(n));
check('no slat or flap node is also a gear or spoiler node', !shared.length, shared.join(', '));
check('no node listed twice', new Set(wingNodes).size === wingNodes.length);
const ang = r => 2 * Math.acos(Math.min(1, Math.abs(r[3])));
const backwards = FLAPS_OUT.filter(p => p.k.length !== FLAP_STOPS.length
  || p.k.some((q, i) => i > 0 && ang(q.r) <= ang(p.k[i - 1].r)));
check(`every part turns further at each of its ${FLAP_STOPS.length} stops`, !backwards.length,
  backwards.map(p => p.joint).join(', '));
const tooFar = FLAPS_OUT.filter(p => ang(p.k[p.k.length - 1].r) * 180 / Math.PI > 50);
check('no part turns more than 50 degrees', !tooFar.length, tooFar.map(p => p.joint).join(', '));

console.log('\n[the schedule]');
check('configs run 0, 1, 2, 3, FULL', FLAP_CONFIGS.map(c => c.name).join() === '0,1,2,3,FULL');
check('slats and flaps never go back in as the lever goes forward',
  FLAP_CONFIGS.every((c, i) => i === 0 || (c.slat >= FLAP_CONFIGS[i - 1].slat && c.flap >= FLAP_CONFIGS[i - 1].flap)));
check('FULL is the model fully out', FLAP_CONFIGS[4].slat === 1 && FLAP_CONFIGS[4].flap === 1);
check('3 and FULL come after the gear (selected at 300 m)',
  FLAP_CFG.selectBelowAglM[3] < 300 && FLAP_CFG.selectBelowAglM[4] < FLAP_CFG.selectBelowAglM[3]);
check('heights pick the right lever',
  scheduledConfig(1500) === 0 && scheduledConfig(900) === 1 && scheduledConfig(500) === 2
  && scheduledConfig(240) === 3 && scheduledConfig(100) === 4 && scheduledConfig(0) === 4);

{
  const s = createFlapSchedule();
  const a = s.step(530, 0);
  check('a track first seen at 530 m already has flaps 2 out',
    a.lever === '2' && a.slat === FLAP_CONFIGS[2].slat && a.flap === FLAP_CONFIGS[2].flap, JSON.stringify(a));
  const off = s.step(520, 1000, false);
  check('switch off: clean at once', off.slat === 0 && off.flap === 0);
  const on = s.step(510, 2000, true);
  check('switch back on: straight to the setting for the height', on.lever === '2' && on.flap === FLAP_CONFIGS[2].flap);
  const n = s.step(NaN, 3000);
  check('no height: holds where it is', n.flap === on.flap && n.slat === on.slat);
}

console.log('\n[every airliner route]');
const airliners = Object.entries(TEMPLATES).filter(([, t]) => t.gearRetracts);
check('the airliner routes are the five known ones', airliners.length === 5, airliners.map(([k]) => k).join(', '));
const altAt = (w, t) => {
  if (t <= w[0].tSec) return w[0].alt;
  for (let i = 1; i < w.length; i++) if (t <= w[i].tSec) {
    const u = (t - w[i - 1].tSec) / ((w[i].tSec - w[i - 1].tSec) || 1);
    return w[i - 1].alt + (w[i].alt - w[i - 1].alt) * u;
  }
  return w[w.length - 1].alt;
};
const ORDER = FLAP_CONFIGS.map(c => c.name);
for (const [key, t] of airliners) {
  const w = t.waypoints;
  const end = w[w.length - 1].tSec;
  const s = createFlapSchedule();
  let prev = null, minAlt = Infinity, fullOutAt = null, levers = [], down = [], tooFast = null;
  let atTouch = null, gaLever = null, preGaLever = null;
  for (let ms = 0; ms <= end * 1000; ms += 100) {
    const alt = altAt(w, ms / 1000);
    const r = s.step(alt, ms);
    if (alt < minAlt) minAlt = alt;
    if (levers[levers.length - 1] !== r.lever) levers.push(r.lever);
    if (prev && !tooFast) {
      const ds = Math.abs(r.slat - prev.slat), df = Math.abs(r.flap - prev.flap);
      if (ds > 0.1 / FLAP_CFG.slatTravelS + 1e-9 || df > 0.1 / FLAP_CFG.flapTravelS + 1e-9) tooFast = `${(ms / 1000).toFixed(1)} s`;
    }
    if (fullOutAt === null && r.slat === 1 && r.flap === 1) fullOutAt = alt;
    if (atTouch === null && alt <= 1) atTouch = r;
    if (gaLever === null && alt > minAlt + FLAP_CFG.goAroundClimbM) { gaLever = r.lever; preGaLever = prev?.lever; }
    if (gaLever === null && down[down.length - 1] !== r.lever) down.push(r.lever);
    prev = r;
  }
  const climbs = w[w.length - 1].alt > minAlt + FLAP_CFG.goAroundClimbM;
  const inOrder = down.every((l, i) => i === 0 || ORDER.indexOf(l) > ORDER.indexOf(down[i - 1]));
  console.log(`  ${key}: ${levers.join(' > ')}, lowest ${Math.round(minAlt)} m${fullOutAt !== null ? `, FULL out at ${Math.round(fullOutAt)} m` : ''}`);
  check(`${key}: out in order on the way down`, inOrder, down.join(' > '));
  check(`${key}: never moves faster than the surfaces travel`, !tooFast, tooFast);
  if (atTouch) {
    check(`${key}: FULL and fully out when the wheels touch`, atTouch.lever === 'FULL' && atTouch.slat === 1 && atTouch.flap === 1, JSON.stringify(atTouch));
    check(`${key}: fully out by 100 m`, fullOutAt !== null && fullOutAt >= 100, `at ${fullOutAt} m`);
  }
  if (climbs) {
    check(`${key}: one step up at the go-around`,
      preGaLever && ORDER.indexOf(gaLever) === ORDER.indexOf(preGaLever) - 1, `${preGaLever} then ${gaLever}`);
    const last = prev;
    if (w[w.length - 1].alt >= FLAP_CFG.retractTo0AboveAglM) {
      check(`${key}: clean by the end of the climb out`, last.lever === '0' && last.slat === 0 && last.flap === 0, JSON.stringify(last));
    }
  }
  if (minAlt > FLAP_CFG.selectBelowAglM[1]) {
    check(`${key}: never below 1,000 m, so never leaves the wing clean`, levers.join() === '0', levers.join());
  }
}

console.log('\n[the wiring]');
const surf = readFileSync(new URL('../src/airliner_surfaces.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('the driver steps the schedule with the switch', /flaps\.step\(aglM,\s*now,\s*flapsOn\(\)\)/.test(surf));
check('a group record moves only when that group was written', /for \(const k of only\) applied\[k\] = pose\[k\]/.test(surf));
check('main.js reads the switch from __isr_airliner_tuning.flaps',
  /flapsOn:\s*\(\)\s*=>\s*\(window\.__isr_airliner_tuning \|\| \{\}\)\.flaps \?\? true/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
