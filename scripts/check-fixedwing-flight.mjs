// ═══════════════════════════════════════════════════════════════════
// check:fixedwing-flight — the browser model IS the Blender one
// ───────────────────────────────────────────────────────────────────
// src/fixedwing_flight_model.js is a port of the airframe and autopilot
// in scripts/blender_fixedwing_flight_demo.py. The rendered demo and the
// live map have to be the same aircraft, so this reads the constants out
// of BOTH files and fails if any pair has drifted.
//
// It then flies the exported model and checks the three things that make
// a wing a wing rather than a quadcopter with wings glued on:
//
//   it banks INTO a turn, by the amount the turn requires
//   its nose rides ABOVE its flight path, and further above it slowly
//   it cannot fly below its stall speed
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import * as FM from '../src/fixedwing_flight_model.js';

const DEG = Math.PI / 180;
const blender = readFileSync(new URL('../scripts/blender_fixedwing_flight_demo.py', import.meta.url), 'utf8');

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const pyNum = (n) => {
  const m = new RegExp(`^${n}\\s*=\\s*(-?[0-9.]+)`, 'm').exec(blender);
  return m ? Number(m[1]) : null;
};
const pyTuple = (n) => {
  const m = new RegExp(`^${n}\\s*=\\s*\\(([^)]*)\\)`, 'm').exec(blender);
  return m ? m[1].split(',').map(x => Number(x.trim())).filter(x => !Number.isNaN(x)) : null;
};

console.log('Constants, against the blender file');
for (const name of ['V_CRUISE', 'V_MIN', 'A_LONG', 'A_DECEL', 'KV', 'MAX_BANK_DEG',
  'ROLL_RATE_DPS', 'ROLL_TAU', 'ALPHA_CRUISE_DEG', 'ALPHA_MAX_DEG', 'GAMMA_MAX_DEG',
  'PITCH_RATE_DPS', 'PITCH_TAU', 'GAMMA_TAU', 'THR_IDLE']) {
  const py = pyNum(name), js = FM[name];
  check(`${name} = ${py}`, py !== null && js === py,
    `blender says ${py}, the module says ${js}. One of the two was edited alone.`);
}
for (const name of ['TURB_PITCH_DEG', 'TURB_PITCH_HZ', 'TURB_ROLL_DEG', 'TURB_ROLL_HZ']) {
  const py = pyTuple(name), js = FM[name];
  check(`${name} = [${py}]`,
    py && js && py.length === js.length && py.every((v, i) => v === js[i]),
    `blender says ${py}, the module says ${js}`);
}

console.log('\nDeclared deviations');
check('TURN_RATE_MAX_DPS is declared here and absent from blender',
  typeof FM.TURN_RATE_MAX_DPS === 'number' && FM.TURN_RATE_MAX_DPS > 0
  && FM.TURN_RATE_MAX_DPS <= 45 && pyNum('TURN_RATE_MAX_DPS') === null,
  'Blender hands the autopilot a plan it can fly, so every demand is one '
  + 'the airframe can meet. Here the demands are DIFFERENTIATED FROM A PATH, '
  + 'and a hand-authored polyline turns instantly at a waypoint. An '
  + 'unbounded measured turn rate asks for 90 degrees of bank.');
check('the measured signals are filtered before they reach the physics',
  FM.SPEED_TAU > 0 && FM.TURN_TAU > 0 && FM.CLIMB_TAU > 0
  && FM.TURN_TAU < FM.ROLL_TAU + 0.2,
  'a polyline hands over a staircase; smoothing the BANK afterwards only '
  + 'trades a snap for a lag. Filter the measurement, as the quad does '
  + 'with ACC_TAU.');

// ── fly it ─────────────────────────────────────────────────────────
// A straight leg, then a steady turn, then a slow leg. Positions are
// generated here so the model is measuring a path, exactly as on the map.
function fly({ speed, turnDps = 0, climb = 0, secs = 25, fps = 60 }) {
  const fm = FM.createFixedWingFlightModel({ rps: 20 });
  const dt = 1 / fps;
  let lat = 55.6, lon = 12.7, alt = 1000, hdg = 0, out = null;
  const mLat = 111320, mLon = 111320 * Math.cos(lat * DEG);
  for (let i = 0; i < secs * fps; i++) {
    hdg += turnDps * DEG * dt;
    lat += (speed * Math.cos(hdg) * dt) / mLat;
    lon += (speed * Math.sin(hdg) * dt) / mLon;
    alt += climb * dt;
    out = fm.update(lat, lon, alt, dt) || out;
  }
  return out;
}

console.log('\nIt flies like a wing, not like a drone');
const level = fly({ speed: FM.V_CRUISE });
check('a level cruise holds its wings level',
  Math.abs(level.bankDeg) < 1.0,
  `${level.bankDeg.toFixed(2)} deg of bank on a straight leg`);

check('at cruise the nose rides a little above the horizon',
  level.pitchDeg > 2 && level.pitchDeg < 6,
  `${level.pitchDeg.toFixed(2)} deg. A wing needs an angle of attack to carry `
  + `its weight, so a level aeroplane is nose-up by roughly ALPHA_CRUISE_DEG `
  + `(${FM.ALPHA_CRUISE_DEG}). An aircraft whose nose sits exactly on its flight `
  + 'path is being drawn, not flown.');

// A coordinated turn: the bank the turn requires is atan(V*w/g).
const turn = fly({ speed: FM.V_CRUISE, turnDps: 10 });
const wanted = Math.atan(FM.V_CRUISE * 10 * DEG / 9.81) / DEG;
check('a turn is flown with the bank the turn requires',
  Math.abs(Math.abs(turn.bankDeg) - wanted) < 2.5,
  `a ${FM.V_CRUISE} m/s aircraft turning 10 deg/s needs atan(V*w/g) = `
  + `${wanted.toFixed(1)} deg of bank; the model holds ${Math.abs(turn.bankDeg).toFixed(1)}. `
  + 'This is the single thing that separates an aeroplane from a quadcopter: '
  + 'the turn comes FROM the bank, through gravity.');

check('banking raises the nose, because the wing is carrying more',
  turn.pitchDeg > level.pitchDeg,
  `level ${level.pitchDeg.toFixed(2)} deg, banked ${turn.pitchDeg.toFixed(2)}. In a `
  + 'bank the load factor is 1/cos(bank), the wing needs more angle of attack, '
  + 'and the nose comes up. A quadcopter does the opposite.');

const slow = fly({ speed: 27 });
check('flying slowly rides nose-high',
  slow.pitchDeg > level.pitchDeg + 1.5,
  `${FM.V_CRUISE} m/s gives ${level.pitchDeg.toFixed(2)} deg, 27 m/s gives `
  + `${slow.pitchDeg.toFixed(2)}. Angle of attack scales as (Vc/V)^2, so the `
  + 'slow leg is where the nose sits highest. This is the shot the demo exists for.');

check('it cannot be flown below the stall',
  fly({ speed: 10 }).speedMs >= FM.V_MIN - 0.01,
  `a wing stops working below V_MIN (${FM.V_MIN} m/s). A path that demands less `
  + 'must not produce an aircraft that simply flies slower.');

const climbRun = fly({ speed: FM.V_CRUISE, climb: 4 });
check('a climb puts the nose above the flight path, not on it',
  climbRun.pitchRad > climbRun.gammaRad + 0.5 * DEG,
  `nose ${(climbRun.pitchRad / DEG).toFixed(2)} deg, flight path `
  + `${(climbRun.gammaRad / DEG).toFixed(2)} deg. theta = gamma + alpha is the `
  + 'whole reason this model exists separately from the quad one.');

// ── the staircase ──────────────────────────────────────────────────
// EVERY TEST ABOVE FLIES A SMOOTH PATH, AND THAT IS WHY THEY ALL PASSED
// WHILE THE AIRCRAFT FLEW EVERY TURN DEAD LEVEL.
//
// fly() advances the heading a little each frame, so the turn rate it
// hands the model is a clean constant. The map does not do that. There
// the position comes from interpolate(), which is piecewise-linear
// between waypoints 0.25 s apart, so the direction of travel is constant
// inside a cell and changes only AT a waypoint: a staircase, whose
// derivative is a spike of roughly 180 deg/s one frame in fifteen and
// zero in between.
//
// The shipped line clamped that spike to TURN_RATE_MAX_DPS before
// filtering it, which threw away the area under it. On the real 792
// waypoint route the aircraft banked 5.1 deg at peak where it needed
// 27.3, and 5 deg of bank is invisible at any camera distance. Order
// matters: filter the measurement, THEN clamp the result.
//
// So this flies a staircase on purpose. A smooth-path test cannot see
// this class of bug at all.
function flyStaircase({ speed, turnDps, secs = 25, fps = 60, stepSec = 0.25 }) {
  const fm = FM.createFixedWingFlightModel({ rps: 20 });
  const dt = 1 / fps;
  let lat = 55.6, lon = 12.7, hdg = 0, out = null;
  const mLat = 111320, mLon = 111320 * Math.cos(lat * DEG);
  // Waypoints every stepSec, then LINEAR interpolation between them,
  // exactly as drones.js does it.
  const wps = [{ t: 0, lat, lon }];
  for (let t = stepSec; t <= secs; t += stepSec) {
    hdg += turnDps * DEG * stepSec;
    lat += (speed * Math.cos(hdg) * stepSec) / mLat;
    lon += (speed * Math.sin(hdg) * stepSec) / mLon;
    wps.push({ t, lat, lon });
  }
  for (let i = 0; i * dt <= secs - stepSec; i++) {
    const t = i * dt;
    let a = wps[0], b = wps[1];
    for (let k = 0; k < wps.length - 1; k++) {
      if (t >= wps[k].t && t <= wps[k + 1].t) { a = wps[k]; b = wps[k + 1]; break; }
    }
    const f = (b.t - a.t) === 0 ? 0 : (t - a.t) / (b.t - a.t);
    out = fm.update(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f, 1000, dt) || out;
  }
  return out;
}

// bank = atan(V * w / g) is the only bank that holds a coordinated turn.
const _needBank = (v, wDps) => Math.atan((v * wDps * DEG) / 9.81) / DEG;

const stair = flyStaircase({ speed: FM.V_CRUISE, turnDps: 12 });
const want = _needBank(FM.V_CRUISE, 12);
check('a turn measured off a POLYLINE still banks the aircraft',
  Math.abs(stair.bankDeg) > 0.6 * want,
  `a 12 deg/s turn at ${FM.V_CRUISE} m/s needs ${want.toFixed(1)} deg of bank; `
  + `flying it as 0.25 s waypoints gives ${stair.bankDeg.toFixed(1)} deg. `
  + 'If this is near zero the turn rate is being clamped BEFORE it is '
  + 'filtered, which destroys the staircase spikes the filter needs to '
  + 'average. Filter the measurement, then clamp the result.');

check('the polyline and the smooth path agree on the bank',
  Math.abs(Math.abs(stair.bankDeg) - Math.abs(fly({ speed: FM.V_CRUISE, turnDps: 12 }).bankDeg)) < 6.0,
  `polyline ${stair.bankDeg.toFixed(1)} deg vs smooth `
  + `${fly({ speed: FM.V_CRUISE, turnDps: 12 }).bankDeg.toFixed(1)} deg. How the path `
  + 'happens to be SAMPLED must not change how the aircraft flies it.');

check('the turn-rate filter runs before the clamp, not inside it',
  /turnRate\s*=\s*ease\(\s*turnRate\s*,\s*wRaw\s*,/.test(
    readFileSync(new URL('../src/fixedwing_flight_model.js', import.meta.url), 'utf8')),
  'ease() must be handed the RAW measured rate. Wrapping clamp() around '
  + 'its input is the bug this file now tests for: it cost a factor of 5.4 '
  + 'in bank angle on the real route.');

if (failures) {
  console.log(`\ncheck:fixedwing-flight FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:fixedwing-flight passed');
