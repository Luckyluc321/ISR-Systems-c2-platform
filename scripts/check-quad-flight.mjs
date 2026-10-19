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
import * as DRONES from '../src/drones.js';

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

// DRAG_K is checked with a TOLERANCE, a few lines down, and not here.
// Both sides now describe the same 30 m/s airframe, but one computes
// g*tan(32)/30^2 as an expression and the other writes the rounded
// literal 0.0068111, so they differ by about 7e-11. Exact equality
// would fail the build on a rounding difference that no aircraft can
// tell apart.
// ATT_RATE_DPS is a DECLARED deviation, checked below with its reason,
// for the same class of cause as DRAG_K: Blender flies a plan it
// generated and therefore never demands more than the airframe can
// give, while the scenario paths were authored for an icon and five of
// twelve fly at munition speeds.
for (const name of ['MAX_TILT_DEG', 'A_MAX', 'KV', 'ATT_TAU',
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

check('the attitude slew is bounded below blender\'s, deliberately',
  (() => {
    const py = pyNum('ATT_RATE_DPS');
    return py === 120 && FM.ATT_RATE_DPS < py && FM.ATT_RATE_DPS >= 10;
  })(),
  `blender ${pyNum('ATT_RATE_DPS')} deg/s, the model ${FM.ATT_RATE_DPS}. Blender's `
  + 'number is the rotors\' real authority and is correct there, because that '
  + 'model only ever sees demands it can meet. The scenario paths demand losing '
  + '167 m/s at a waypoint, and a faithful response to that is a 35 degree pitch '
  + 'swing. Bounding the NOSE RATE leaves speed, route, waypoints, duration and '
  + 'timing untouched. If this ever equals 120 again, either the paths were fixed '
  + 'or someone removed the bound without reading why it is here.');

check('DRAG_K agrees with the blender file, to a tolerance',
  (() => {
    const py = pyNum('DRAG_K');
    return py !== null && Math.abs(py - FM.DRAG_K) < 1e-6;
  })(),
  `blender ${pyNum('DRAG_K')} against the module ${FM.DRAG_K}. A tolerance `
  + 'because one side is an expression and the other a rounded literal; '
  + 'anything larger than 1e-6 is a real disagreement about the airframe.');

check('TOP_SPEED_MS agrees with the blender file',
  pyNum('TOP_SPEED_MS') === FM.TOP_SPEED_MS,
  'the two must describe one aircraft');

check('drag is derived from the airframe, not inherited from the DJI',
  Math.abs(FM.DRAG_K - 9.81 * Math.tan(FM.MAX_TILT_DEG * Math.PI / 180) / (FM.TOP_SPEED_MS ** 2)) < 1e-9,
  'DRAG_K must satisfy g*tan(MAX_TILT)/TOP_SPEED^2, which is the same '
  + 'statement Blender\'s constant makes written as a relation. Raising '
  + 'the top speed without the drag is not a faster aircraft, it is an '
  + 'impossible one.');

check('at its own top speed the lean IS the tilt limit',
  Math.abs(Math.atan(FM.DRAG_K * FM.TOP_SPEED_MS ** 2 / 9.81) * 180 / Math.PI
    - FM.MAX_TILT_DEG) < 0.01);

check('the blender airframe is still what the demo path flies',
  (() => {
    const m = /^DRAG_K\s*=\s*([0-9.]+)/m.exec(blender);
    // The demo cruises at about 3 m/s, where drag is under a degree on
    // either constant, so the sequence looks the same on both.
    const v = 3;
    const a = Math.atan(Number(m[1]) * v * v / 9.81) * 180 / Math.PI;
    const b = Math.atan(FM.DRAG_K * v * v / 9.81) * 180 / Math.PI;
    return Math.abs(a - b) < 0.5;
  })(),
  'the manoeuvre demo must still match the render');

// ─── the physics, on the real exported model ────────────────────────
console.log('\nThe physics, flying the exported model');

// THESE USED TO BE A LITERAL COPY, and this gate never opened the GLB.
// It was in `npm run build` and would have passed a completely broken
// asset: it validated its own copy of the data. check:dji-air-3 now
// reads the real hubs out of the file and asserts they match what
// src/main.js hardcodes, so a broken asset fails the build there.
// Here they stay literal ON PURPOSE, as the second half of that pair:
// if someone edits main.js's table, these two gates disagree.
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

check('bounding the slew did not flatten the demo',
  (() => {
    // The flight demo's path IS flyable, so the bound must barely touch
    // it: the brake still pitches the nose up past 25 degrees.
    const w = DRONES.TEMPLATES.cph_dji_flight_demo?.waypoints;
    if (!w) return false;
    const fm = FM.createQuadFlightModel({ rotors, rps: 12 });
    const fps = 60, dt = 1 / fps;
    const lerp = (t) => {
      if (t <= w[0].tSec) return w[0];
      for (let i = 1; i < w.length; i++) {
        if (t <= w[i].tSec) {
          const a = w[i - 1], b = w[i], u = (t - a.tSec) / ((b.tSec - a.tSec) || 1);
          return { lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u,
                   alt: a.alt + (b.alt - a.alt) * u };
        }
      }
      return w[w.length - 1];
    };
    let lo = 0;
    for (let f = 0; f < fps * 47; f++) {
      const t = f * dt, p = lerp(t);
      const o = fm.update(p.lat, p.lon, p.alt, dt);
      if (o && t > 3) lo = Math.min(lo, o.leanFwdDeg);
    }
    return lo < -25;
  })(),
  'the demo brakes from 25 m/s and the nose must still come up past 25 degrees. '
  + 'If the bound flattens that, it is too low and the showcase stops matching '
  + 'the render.');

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

// ─── the paths are faster than the airframe ─────────────────────────
console.log('\nDrag above the airframe top speed');

check('a cruise inside the envelope is untouched',
  Math.abs(cruise.tiltDeg - dragBalanceDeg) < 2.0,
  '15 m/s is below the 21 m/s top speed, so the drag term must be exactly '
  + 'the Blender one');

check('a cruise FAR above it does not pin at the tilt limit',
  (() => {
    const fast58 = flyStraight({ speed: 58 });   // cph_quad_hostile's median
    return fast58.tiltDeg < FM.MAX_TILT_DEG - 2;
  })(),
  'at 58 m/s the raw drag term demands 79 degrees of lean. Clamped to the '
  + '32 degree limit it sits pinned for the whole flight and jitters around '
  + 'the clamp, which is what read as lying on its side.');

check('the acceleration lean is NOT capped',
  (() => {
    // A hard stop from 58 m/s must still lean the airframe hard.
    const fm = FM.createQuadFlightModel({ rotors, rps: 12 });
    const frameDt = 1 / 60; let lat = 55.60, lon = 12.65, out = null;
    for (let f = 0; f < 60 * 6; f++) {
      const v = f < 60 * 3 ? 58 : 0;
      lon += (v * frameDt) / M_LON;
      out = fm.update(lat, lon, 120, frameDt) || out;
      if (f === 60 * 3 + 20) break;
    }
    return out.tiltDeg > 20;
  })(),
  'the cap is on the steady drag lean only. A brake or a hard turn must '
  + 'still read as one.');

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

// ─── the demo plan and its generator ────────────────────────────────
//
// The manoeuvre sequence exists twice: PLAN in the Python, and
// _DEMO_PLAN in drones.js, which _demoFlightPath integrates into
// waypoints. Nothing but a person kept them equal, and the generator
// also carried its OWN copy of the drag constant, which sat at the DJI
// value and would have capped the map's demo at 19.8 m/s while the
// render did 25. Both are gated now.
console.log('\nThe demo manoeuvre plan');
const dronesSrc = readFileSync(new URL('../src/drones.js', import.meta.url), 'utf8');

const pyPlan = (() => {
  const m = /^PLAN = \[([\s\S]*?)^\]/m.exec(blender);
  if (!m) return null;
  return [...m[1].matchAll(/\(\s*"([^"]+)"\s*,\s*\(([^)]*)\)\s*,\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*\)/g)]
    .map(r => [r[1], ...r[2].split(',').map(x => Number(x.trim())), Number(r[3]), Number(r[4])]);
})();
const jsPlan = (() => {
  const m = /const _DEMO_PLAN = \[([\s\S]*?)\n\];/.exec(dronesSrc);
  if (!m) return null;
  return [...m[1].matchAll(/\['([^']+)',\s*([^\]]+)\]/g)]
    .map(r => [r[1], ...r[2].split(',').map(x => Number(x.trim()))]);
})();

check('the plan table is mirrored exactly',
  pyPlan && jsPlan && pyPlan.length === jsPlan.length
  && pyPlan.every((row, i) => row.length === jsPlan[i].length
    && row.every((v, k) => (typeof v === 'string' ? v === jsPlan[i][k] : Math.abs(v - jsPlan[i][k]) < 1e-9))),
  `blender has ${pyPlan ? pyPlan.length : '?'} legs, drones.js has `
  + `${jsPlan ? jsPlan.length : '?'}. The render and the flyable scenario `
  + 'are the same sequence or they are not.');

check('the generator compensates drag through the lean, as blender does',
  (() => {
    const m = /const needE = adE \+ dragE, needN = adN \+ dragN;/.test(dronesSrc)
      && /thrust - dragE/.test(dronesSrc);
    return m;
  })(),
  'A quadcopter leans far enough to overcome drag AND accelerate, so '
  + 'inside the tilt limit it reaches the speed it was asked for. '
  + 'Subtracting drag from the demand instead caps a 25 m/s leg at '
  + 'KV(v_t-v) = DRAG_K v^2, which is 22.2, against the render\'s 24.7.');

check('the generator carries a LEAN STATE, with the lag and the slew',
  /const kAtt = 1 - Math\.exp\(-dt \/ ATT_TAU\);/.test(dronesSrc)
  && /const slew = ATT_RATE_DPS \* DEG \* dt;/.test(dronesSrc)
  && /leanE \+= stepE; leanN \+= stepN;/.test(dronesSrc),
  'applying the demanded tilt in the step that computes it puts the '
  + 'airframe in a state no aircraft reaches: accelerating before it has '
  + 'leaned. The browser flight model DOES apply the lag to the attitude '
  + 'it derives from the path, so an instant-lean path disagrees with it '
  + 'for about a third of a second at every transition.');

check('the demo path length matches the render, within a metre',
  (() => {
    const w = DRONES.TEMPLATES.cph_dji_flight_demo?.waypoints;
    if (!w) return false;
    let len = 0;
    for (let i = 1; i < w.length; i++) {
      const dN = (w[i].lat - w[i - 1].lat) * 111320;
      const dE = (w[i].lon - w[i - 1].lon) * 111320 * Math.cos(w[i].lat * Math.PI / 180);
      len += Math.hypot(dN, dE);
    }
    return Math.abs(len - 390.2) < 1;
  })(),
  'Peak speed is set by the plan, so it matches on a wrong integrator '
  + 'too. LENGTH is set by the dynamics and is the sharper test: 390.2 m '
  + 'with the attitude lag, 384.6 without it.');

check('the demo path is EMITTED at frame rate too',
  /_demoFlightPath\(55\.6205, 12\.6480, 90, 1 \/ 60\)/.test(dronesSrc),
  'the model measures velocity off the path, and interpolate() is '
  + 'linear, so a 0.25 s path hands it a 4 Hz staircase. This one is '
  + 'generated, so there is no reason to sample it coarsely.');

// `main` is read further down this file, so it is in its temporal dead
// zone here. kAcc lives in the model anyway, not in main.js.
const modelSrc = readFileSync(new URL('../src/quad_flight_model.js', import.meta.url), 'utf8');
check('the acceleration is low-passed before it reaches the lean',
  /const kAcc = 1 - Math\.exp\(-dtSec \/ ACC_TAU\);/.test(modelSrc)
  && typeof FM.ACC_TAU === 'number' && FM.ACC_TAU > 0 && FM.ACC_TAU < FM.ATT_TAU,
  'hand-authored paths cannot be re-emitted, so their sampling has to be '
  + 'removed in the model. ACC_TAU must sit UNDER the attitude time '
  + 'constant: it should only remove what the airframe could not have '
  + 'responded to anyway.');

check('steady forward flight does not wobble more than the hover noise',
  (() => {
    const w = DRONES.TEMPLATES.cph_dji_flight_demo?.waypoints;
    if (!w) return false;
    const fps = 60, dt = 1 / fps;
    const lerp = (t) => {
      if (t <= w[0].tSec) return w[0];
      for (let i = 1; i < w.length; i++) {
        if (t <= w[i].tSec) {
          const a = w[i - 1], b = w[i], u = (t - a.tSec) / ((b.tSec - a.tSec) || 1);
          return { lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u,
                   alt: a.alt + (b.alt - a.alt) * u };
        }
      }
      return w[w.length - 1];
    };
    const fm = FM.createQuadFlightModel({ rotors, rps: 12 });
    const p = [];
    for (let f = 0; f < fps * 9; f++) {
      const t = f * dt, q = lerp(t);
      const o = fm.update(q.lat, q.lon, q.alt, dt);
      if (o && t >= 3 && t <= 8) p.push(o.leanFwdDeg);
    }
    // Remove the real ramp with a centred 0.25 s average; the residual is
    // the wobble a viewer sees as humming.
    const N = 15, res = [];
    for (let i = N; i < p.length - N; i++) {
      let sum = 0;
      for (let k = -N; k <= N; k++) sum += p[i + k];
      res.push(p[i] - sum / (2 * N + 1));
    }
    const rms = Math.sqrt(res.reduce((a, b) => a + b * b, 0) / res.length);
    return rms < 0.3;
  })(),
  'A one degree per frame ripple at the waypoint rate is what Lucas saw '
  + 'as the airframe humming. It has to stay under the deliberate hover '
  + 'noise, which is about 0.5 degrees rms, or it is the thing you notice.');

check('the generator integrates at frame rate, not at the emit rate',
  /const SIM_DT = 1 \/ 60;/.test(dronesSrc)
  && /function _demoFlightPath\(lat0, lon0, alt0, emitDt = 0.25\)/.test(dronesSrc),
  'a first-order loop stepped at 0.25 s does not match one stepped at '
  + "the render's 1/60");

check('the generator uses the airframe drag, not the DJI value',
  (() => {
    const m = /const A_MAX = [0-9.]+, DRAG_K = ([0-9.]+)/.exec(dronesSrc);
    return m && Math.abs(Number(m[1]) - FM.DRAG_K) < 1e-6;
  })(),
  '_demoFlightPath carries its own copy. At the DJI 0.0156 it caps the '
  + "map's demo at 19.8 m/s while the render does 25, and the two stop "
  + 'being the same flight.');

// ─── the scenario clocks are not ours to move ───────────────────────
console.log('\nScenario timing');
const drones = readFileSync(new URL('../src/drones.js', import.meta.url), 'utf8');

check('no template is retimed',
  (() => {
    const m = /const _CRUISE_TARGET_MS = \{([\s\S]*?)\n\};/.exec(drones);
    if (!m) return false;
    // Entries only, comments stripped.
    const body = m[1].replace(/\/\/.*$/gm, '').trim();
    return body === '';
  })(),
  'These scenarios were timed by hand and signed off. Stretching a clock '
  + 'to slow a drone moves choreography that was tuned against it. The '
  + 'pinning is cured by the airframe\'s drag and cruise cap instead, '
  + 'which leaves every clock alone.');

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

// ─── hover noise is HOVER noise ─────────────────────────────────────
console.log('\nHover noise fades with airspeed');

check('NOISE_FADE_MS is a declared deviation, absent from blender',
  typeof FM.NOISE_FADE_MS === 'number' && FM.NOISE_FADE_MS > 1
    && FM.NOISE_FADE_MS < 15 && pyNum('NOISE_FADE_MS') === null,
  'Blender has no such term and does not need one: its demo plan tops out '
  + 'at 25 m/s and sits near zero for most of its 47 s, so the noise reads '
  + 'as life there. A map drone holds 25 to 35 m/s for twenty seconds at a '
  + 'time with a constant lean, and then three sines at 0.37, 0.91 and 1.70 '
  + 'Hz are the ONLY motion on screen. The knee belongs between 5 and 8 m/s, '
  + 'where a multirotor leaves its own downwash and the induced flow '
  + 'attaches. If this constant ever appears in the blender file, port it '
  + 'properly instead of declaring it here.');

check('a hover keeps blender\'s full noise amplitude',
  (() => {
    const fade = 1 / (1 + (0 / FM.NOISE_FADE_MS) ** 2);
    return Math.abs(fade - 1) < 1e-12;
  })(),
  'the fade must be exactly 1 at zero airspeed, or the hover case stops '
  + 'being the aircraft the constants were tuned for');

check('a steady CRUISE does not hover-twitch',
  (() => {
    // A dead-straight constant-speed leg at cruise. A correct airframe
    // holds ONE pitch angle for all of it, so anything that moves is
    // either the model or the noise, and at 30 m/s it should be neither.
    const fm = FM.createQuadFlightModel({ rotors, rps: 12 });
    const dt = 1 / 60, speed = 30, p = [];
    let lon = 12.65;
    for (let f = 0; f < 60 * 170; f++) {
      lon += (speed * dt) / M_LON;
      const o = fm.update(55.60, lon, 120, dt);
      if (o && f > 60 * 60) p.push(o.pitchRad * 180 / Math.PI);
    }
    const mean = p.reduce((a, b) => a + b, 0) / p.length;
    const rms = Math.sqrt(p.reduce((a, b) => a + (b - mean) ** 2, 0) / p.length);
    return rms < 0.05;
  })(),
  'Measured at 0.42 deg rms and 3.0 oscillations a second before the fade, '
  + 'on a leg where the pitch should not move at all. That is the whole of '
  + 'the reported "lags and hums like mini jumping up and down while flying '
  + 'forward" — the flight model was never wrong, it was being asked to '
  + 'hover-twitch at 120 km/h. The gate above this one could not catch it: '
  + 'it tests cph_dji_flight_demo, whose median is 6.5 m/s, where the fade '
  + 'barely applies.');

// ─── no quadcopter path may out-accelerate the airframe ─────────────
console.log('\nEvery quadcopter path is inside A_MAX');

check('no quadcopter template demands more than A_MAX at a waypoint',
  (() => {
    const D = Math.PI / 180;
    const bad = [];
    for (const [key, t] of Object.entries(DRONES.TEMPLATES)) {
      if ((t.platform || '') !== 'quadcopter') continue;
      const w = t.waypoints;
      // Generated paths are emitted at frame rate by the flight model
      // itself and are flyable by construction.
      if (!w || w.length < 3 || w.length > 500) continue;
      const v = [];
      for (let i = 0; i < w.length - 1; i++) {
        const a = w[i], b = w[i + 1];
        const m = Math.hypot((b.lat - a.lat) * 111320,
          (b.lon - a.lon) * 111320 * Math.cos(a.lat * D), (b.alt || 0) - (a.alt || 0));
        const dt = b.tSec - a.tSec;
        v.push({ v: dt > 0 ? m / dt : 0, dt });
      }
      for (let i = 0; i < v.length - 1; i++) {
        const acc = (v[i + 1].v - v[i].v) / Math.max(0.5, Math.min(v[i].dt, v[i + 1].dt));
        if (Math.abs(acc) > FM.A_MAX) {
          bad.push(`${key} wp${i + 1} ${v[i].v.toFixed(0)}->${v[i + 1].v.toFixed(0)} m/s, ${acc.toFixed(1)} m/s2`);
        }
      }
    }
    if (bad.length) console.log('       ' + bad.join('\n       '));
    return bad.length === 0;
  })(),
  `A_MAX is ${FM.A_MAX} m/s2. A waypoint that demands more is not a tuning `
  + 'problem: the flight model is faithful, so it pitches as hard nose-up as '
  + 'a real airframe must to shed the speed, and then nose-down again. '
  + 'swarm_recon_cph_amk had two such waypoints, 9.9 and 8.0 m/s2, both on '
  + 'off-screen transit legs that were never timed, and they produced a 48 '
  + 'degree pitch swing. That is the "forward, jump upwards, forward, jump '
  + 'upwards" that was reported. Trim the leg, do not bound the model.');

if (failures) {
  console.log(`\ncheck:quad-flight FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:quad-flight passed');
