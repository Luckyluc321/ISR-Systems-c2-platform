// ═══════════════════════════════════════════════════════════════════
// check:quad-flight — the browser flight model IS the Blender one
// ───────────────────────────────────────────────────────────────────
// src/quad_flight_model.js is a port of the airframe and controller in
// scripts/blender_drone_flight_demo.py. The rendered flight demo and
// the live map have to be the same aircraft, so this gate reads the
// constants out of BOTH files and fails if any pair has drifted.
//
// It then flies the real exported model and checks the physics it
// produces, including the two bugs that the first live run found and
// that nothing in the source would have shown:
//
//   - the position advances on the simulation TICK while the model runs
//     every render FRAME, so a tick's travel over one frame reported a
//     drone at 300 m/s
//   - the integration step is clamped for stability, and using that
//     same clamped value as the velocity clock reported 300 m/s again
//     in a throttled tab
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import * as FM from '../src/quad_flight_model.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}`);
  if (why) console.log(`       ${why}`);
};

const blender = readFileSync(new URL('./blender_drone_flight_demo.py', import.meta.url), 'utf8');

// ─── the constants, read out of the Python ──────────────────────────
console.log('The constants, against scripts/blender_drone_flight_demo.py');

const pyNum = (name) => {
  const m = new RegExp(`^${name}\\s*=\\s*(-?[0-9.]+)`, 'm').exec(blender);
  return m ? Number(m[1]) : null;
};
const pyTuple = (name) => {
  const m = new RegExp(`^${name}\\s*=\\s*\\(([^)]*)\\)`, 'm').exec(blender);
  return m ? m[1].split(',').map(x => Number(x.trim())).filter(x => !Number.isNaN(x)) : null;
};

for (const name of ['MAX_TILT_DEG', 'A_MAX', 'DRAG_K', 'KV', 'ATT_TAU', 'ATT_RATE_DPS',
  'VZ_TAU', 'YAW_TAU', 'YAW_RATE_MAX_DPS', 'TL_DIP', 'TL_SPEED', 'TL_WIDTH',
  'ATT_DIFF', 'ATT_DIFF_REF', 'YAW_DIFF', 'YAW_DIFF_REF', 'YAW_DAMP_DIFF',
  'NOISE_YAW_DEG', 'NOISE_YAW_HZ']) {
  const py = pyNum(name), js = FM[name];
  check(`${name} = ${py}`, py !== null && js === py,
    `blender says ${py}, the module says ${js}. One of the two was edited alone.`);
}
for (const name of ['NOISE_LEAN_DEG', 'NOISE_LEAN_HZ']) {
  const py = pyTuple(name), js = FM[name];
  check(`${name} = [${py}]`,
    py && js && py.length === js.length && py.every((v, i) => v === js[i]),
    `blender says ${py}, the module says ${js}`);
}

// ─── the physics, on the real exported model ────────────────────────
console.log('\nThe physics, flying the exported model');

const AIR3_HUBS = [[1.519, -0.198, -0.813], [1.298, -0.242, 1.437],
                   [-1.519, -0.199, -0.813], [-1.296, -0.258, 1.438]];
const rotors = FM.rotorsFromHubs(AIR3_HUBS, '-z', '+y', [1, -1, -1, 1]);

check('rotor geometry resolves four arms with a real reach',
  rotors.length === 4 && rotors.every(r => Math.hypot(r.bf, r.br) > 0.5));
check('the diagonals are opposite-sensed',
  rotors[0].sense === rotors[3].sense && rotors[1].sense === rotors[2].sense
  && rotors[0].sense !== rotors[1].sense);

const M_LAT = 111320, M_LON = 111320 * Math.cos(55.6 * Math.PI / 180);

/** Fly a straight leg at `speed`, position advancing at tickHz, model at fps. */
function flyStraight({ speed, fps = 60, tickHz = 4, secs = 10 }) {
  const fm = FM.createQuadFlightModel({ rotors, rps: 12 });
  const frameDt = 1 / fps;
  let lat = 55.60, lon = 12.65, lastTick = -1, out = null;
  for (let f = 0; f < fps * secs; f++) {
    const t = f * frameDt;
    const tick = Math.floor(t * tickHz);
    if (tick !== lastTick) { lastTick = tick; lon += (speed / tickHz) / M_LON; }
    out = fm.update(lat, lon, 120, frameDt) || out;
  }
  return out;
}

const cruise = flyStraight({ speed: 15 });
const dragBalanceDeg = Math.atan(FM.DRAG_K * 15 * 15 / 9.81) * 180 / Math.PI;

check('speed is measured from MOVEMENT, not from frames',
  Math.abs(cruise.speedMs - 15) < 1.0,
  `a 4 Hz position read every 16 ms frame reported ${cruise.speedMs.toFixed(1)} m/s. `
  + 'Dividing a tick\'s whole displacement by one frame is the 300 m/s bug.');

check('a steady cruise settles at the drag balance',
  Math.abs(cruise.tiltDeg - dragBalanceDeg) < 2.0,
  `atan(DRAG_K * 15^2 / g) is ${dragBalanceDeg.toFixed(1)} deg, `
  + `the model holds ${cruise.tiltDeg.toFixed(1)}. That equality is the whole airframe: `
  + 'thrust tilt balancing quadratic drag.');

check('a cruise leans forward, not sideways',
  Math.abs(cruise.leanFwdDeg - cruise.tiltDeg) < 1.0 && Math.abs(cruise.leanRgtDeg) < 2.0);

// A THROTTLED TAB. Frames arrive seconds apart; the integration step is
// clamped and the velocity clock must not be.
function flyThrottled({ speed, frameDt, secs = 12 }) {
  const fm = FM.createQuadFlightModel({ rotors, rps: 12 });
  let lat = 55.60, lon = 12.65, out = null;
  for (let t = 0; t < secs; t += frameDt) {
    lon += (speed * frameDt) / M_LON;
    out = fm.update(lat, lon, 120, frameDt) || out;
  }
  return out;
}
const slow = flyThrottled({ speed: 15, frameDt: 2.5 });
check('a throttled tab still reports the real speed',
  slow && Math.abs(slow.speedMs - 15) < 1.0,
  `frames 2.5 s apart reported ${slow ? slow.speedMs.toFixed(1) : 'nothing'} m/s. `
  + 'The integration step is clamped to 0.1 s for stability; using that same '
  + 'clamped value as the velocity clock multiplies the speed by 25.');

const fast = flyStraight({ speed: 21 });
check('top speed does not exceed the tilt limit',
  fast.tiltDeg <= FM.MAX_TILT_DEG + 0.5,
  `${fast.tiltDeg.toFixed(1)} deg against a ${FM.MAX_TILT_DEG} deg limit`);

const hover = flyStraight({ speed: 0 });
check('a hover is nearly level, but not perfectly still',
  hover.tiltDeg < 2.0 && hover.tiltDeg > 0,
  `${hover.tiltDeg.toFixed(2)} deg. Zero would mean the hover noise is not running; `
  + 'a real airframe corrects itself in its own downwash.');

// ─── rotor differential ─────────────────────────────────────────────
console.log('\nThe rotor speed model');

check('a cruise spins all four at a similar rate',
  (() => {
    const r = cruise.rotorRps;
    const spread = (Math.max(...r) - Math.min(...r)) / (Math.max(...r) || 1);
    return spread < 0.25;
  })(),
  `rotors ${cruise.rotorRps.map(x => x.toFixed(2)).join(' ')}`);

check('rotor speed rises with thrust demand',
  Math.min(...fast.rotorRps) > Math.min(...hover.rotorRps),
  'a leaning airframe needs more total thrust than a hovering one');

check('the rotor angle accumulates, so the props actually turn',
  cruise.rotorAngleRad.every(a => Math.abs(a) > 1));

// ─── the wiring in main.js ──────────────────────────────────────────
console.log('\nThe wiring');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

check('both threat rigs run the flight model',
  (main.match(/createQuadFlightModel\(/g) || []).length >= 2,
  'the lead and each swarm member need their OWN instance: a formation is '
  + 'five airframes, not one attitude copied five times');

check('the old cosmetic rig is gone from the threat path',
  !/targetRoll = yawRate \* bankFactor/.test(main)
  || (main.match(/targetRoll = yawRate \* bankFactor/g) || []).length === 1,
  'bankFactor may survive for the interceptor quad, which has no flight '
  + 'model, but not for a threat drone');

check('rotor transforms accept a per-rotor speed',
  /Array\.isArray\(r\) \? \(r\[i\]/.test(main),
  'one shared number cannot show a quadcopter differentiating its rotors');

check('the model key is captured, not read live per frame',
  /const _quadKey = \(window\.__isr_quad_tuning \|\| \{\}\)\.model/.test(main)
  // Every resolve inside an orientation callback must pass the captured
  // key. A bare _quadModelSpec() is fine in a diagnostic handle, which
  // runs when a human types it, and fatal in a per-frame rig, which is
  // what turned airborne drones sideways.
  && /const _qM = _quadModelSpec\(_quadKey\);/.test(main)
  && (main.match(/const _qM = _quadModelSpec\(/g) || []).length
     === (main.match(/const _qM = _quadModelSpec\(_quadKey\);/g) || []).length,
  'reading the live switch inside a per-frame callback is what turned '
  + 'airborne drones sideways');

check('the hover noise has an off switch',
  /__isr_quadHum/.test(main) && /hoverNoise/.test(main),
  'telling a real oscillation from the designed one needs an A/B');

check('the nose offset can be hunted without a rebuild',
  /__isr_quadNose/.test(main),
  'there are four possible answers and only a human can see which is right');

if (failures) {
  console.log(`\ncheck:quad-flight FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:quad-flight passed');
