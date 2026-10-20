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

// ── which WAY it banks, and how smoothly the nose moves ────────────
// Both of these passed as a matter of luck before, because nothing
// asserted a DIRECTION or a RATE. The aircraft banked away from every
// turn and the nose moved in 3 degree steps, and every physics
// assertion above was satisfied throughout.
//
// The sign: Blender's psi is "+ve left" at its own declaration, and
// Cesium's heading is atan2(dE, dN), clockwise from north, POSITIVE
// RIGHT. Porting bank_des = -atan(V*w/G) across that flip made a right
// turn command left wing down.
const right = flyStaircase({ speed: FM.V_CRUISE, turnDps: 10 });
const left  = flyStaircase({ speed: FM.V_CRUISE, turnDps: -10 });
check('a RIGHT turn drops the RIGHT wing',
  right.bankDeg > 5,
  `turning right gave ${right.bankDeg.toFixed(1)} deg of roll, and roll is `
  + 'positive right-wing-down. Negative here means the aircraft is banking '
  + 'away from its own turn, which is the sign of -atan(V*w/G) carried over '
  + "from Blender's left-positive heading.");
check('a LEFT turn drops the LEFT wing',
  left.bankDeg < -5,
  `turning left gave ${left.bankDeg.toFixed(1)} deg of roll.`);
check('bank and turn rate never disagree in sign',
  Math.sign(right.turnRateDps) === Math.sign(right.bankDeg)
  && Math.sign(left.turnRateDps) === Math.sign(left.bankDeg),
  `right: bank ${right.bankDeg.toFixed(1)} vs rate ${right.turnRateDps.toFixed(2)}; `
  + `left: bank ${left.bankDeg.toFixed(1)} vs rate ${left.turnRateDps.toFixed(2)}. `
  + 'The turn rate is computed FROM the bank, so these cannot differ unless '
  + 'a sign was flipped between them.');

// The nose must be an integration, not a copy of the measurement.
function headingSteps({ turnDps, secs = 20, fps = 60, stepSec = 0.25 }) {
  const fm = FM.createFixedWingFlightModel({ rps: 20 });
  const dt = 1 / fps, speed = FM.V_CRUISE;
  let lat = 55.6, lon = 12.7, hdg = 0;
  const mLat = 111320, mLon = 111320 * Math.cos(lat * DEG);
  const wps = [{ t: 0, lat, lon }];
  for (let t = stepSec; t <= secs; t += stepSec) {
    hdg += turnDps * DEG * stepSec;
    lat += (speed * Math.cos(hdg) * stepSec) / mLat;
    lon += (speed * Math.sin(hdg) * stepSec) / mLon;
    wps.push({ t, lat, lon });
  }
  let prev = null, worst = 0, crab = 0;
  for (let i = 0; i * dt <= secs - stepSec; i++) {
    const t = i * dt;
    let a = wps[0], b = wps[1];
    for (let k = 0; k < wps.length - 1; k++) {
      if (t >= wps[k].t && t <= wps[k + 1].t) { a = wps[k]; b = wps[k + 1]; break; }
    }
    const f = (b.t - a.t) === 0 ? 0 : (t - a.t) / (b.t - a.t);
    const o = fm.update(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f, 1000, dt);
    if (!o) continue;
    const h = (o.headingRad / DEG);
    if (prev !== null) {
      let d = h - prev; while (d > 180) d -= 360; while (d < -180) d += 360;
      if (i > fps) worst = Math.max(worst, Math.abs(d));   // skip the first second's settle
    }
    prev = h;
    if (i > fps) crab = Math.max(crab, Math.abs(o.hdgErrDeg));
  }
  return { worst, crab };
}

const smooth = headingSteps({ turnDps: 12 });
// A 12 deg/s turn sampled every 0.25 s steps the TRACK by 3 deg at a
// waypoint. At 60 fps a genuinely integrated nose moves 12/60 = 0.2 deg
// per frame, so anything approaching 3 means the measurement is being
// rendered instead of the aircraft.
check('the nose is integrated, not copied from the polyline',
  smooth.worst < 0.8,
  `the worst single-frame heading change is ${smooth.worst.toFixed(2)} deg. A `
  + '12 deg/s turn at 60 fps should move the nose 0.2 deg a frame; 3 deg means '
  + 'the rendered heading IS the measured track, which is the staircase, and '
  + 'that is what reads on screen as the aircraft lagging through its turn.');
check('the nose still points where the aircraft is going',
  smooth.crab < 12,
  `the nose drifted ${smooth.crab.toFixed(1)} deg off the direction of travel. `
  + 'An integrated heading needs HEADING_HOLD_K to keep it honest, or the '
  + 'aircraft flies crabbed.');

const src = readFileSync(new URL('../src/fixedwing_flight_model.js', import.meta.url), 'utf8');
check('the heading is integrated from the bank, as in the Blender file',
  /psi\s*\+=/.test(src) && /headingRad:\s*psi/.test(src),
  'Blender commands a bank and lets the heading follow: psi += w * dt. '
  + 'Returning the MEASURED heading instead renders the path\'s sampling as '
  + 'aircraft motion.');
check('no leftover minus on the commanded bank',
  !/bankDes\s*=\s*clamp\(\s*-\s*Math\.atan/.test(src),
  "that minus is Blender's, and Blender's heading is positive LEFT.");

// ── the propeller follows the throttle ─────────────────────────────
// Blender's dV is the acceleration it is about to apply, and the
// propeller reads it. Porting that as (V_CRUISE - V) * KV inverted it:
// an aircraft accelerating past cruise produced a negative dV and the
// blades wound DOWN as it sped up. The acceleration is measured now.
function flyAccel(from, to, secs = 10) {
  const fm = FM.createFixedWingFlightModel({ rps: 20 });
  const fps = 60, dt = 1 / fps;
  let lat = 55.6; const mLat = 111320;
  let peak = -Infinity, trough = Infinity;
  for (let i = 0; i < 8 * fps; i++) { lat += (from * dt) / mLat; fm.update(lat, 12.7, 1000, dt); }
  for (let i = 0; i < secs * fps; i++) {
    lat += (to * dt) / mLat;
    const o = fm.update(lat, 12.7, 1000, dt);
    if (o) { peak = Math.max(peak, o.propRps); trough = Math.min(trough, o.propRps); }
  }
  return { peak, trough };
}
const spdUp = flyAccel(36, 52);
const spdDn = flyAccel(36, 24);
check('the propeller speeds up when the aircraft does',
  spdUp.peak > spdDn.trough + 2,
  `accelerating peaks at ${spdUp.peak.toFixed(1)} rps, decelerating bottoms at `
  + `${spdDn.trough.toFixed(1)}. If these are equal the throttle is not reading `
  + 'acceleration at all; if they are REVERSED the commanded-acceleration term '
  + 'was ported without noticing that the map measures speed rather than '
  + 'commanding it.');
check('the propeller reads MEASURED acceleration, not a speed error',
  /clamp\(accel,/.test(src) && typeof FM.ACCEL_TAU === 'number' && FM.ACCEL_TAU > 0,
  'dV must come from the measured acceleration of the filtered speed. '
  + '(V_CRUISE - V) * KV is the commanded form and has the wrong sign here.');

// ── the staircase must not reach the wings ────────────────────────
// The sign and smoothness gates above both passed while the aircraft
// visibly shimmered in every turn, because they measure the NOSE and
// this defect is in the WINGS. A frame-to-frame derivative of a
// piecewise-linear path is a square wave at the waypoint rate; a
// first-order filter only attenuates it, and 13% of 4 Hz got through
// as a +/-1.66 degree roll wobble. Straight flight never showed it,
// which is why it survived three rounds.
function bankRipple({ turnDps, stepSec, secs = 14, fps = 60 }) {
  const fm = FM.createFixedWingFlightModel({ rps: 20 });
  const dt = 1 / fps, speed = FM.V_CRUISE;
  let lat = 55.6, lon = 12.7, hdg = 0;
  const mLat = 111320, mLon = 111320 * Math.cos(lat * DEG);
  const wps = [{ t: 0, lat, lon }];
  for (let t = stepSec; t <= secs; t += stepSec) {
    hdg += turnDps * DEG * stepSec;
    lat += (speed * Math.cos(hdg) * stepSec) / mLat;
    lon += (speed * Math.sin(hdg) * stepSec) / mLon;
    wps.push({ t, lat, lon });
  }
  const bank = [];
  for (let i = 0; i * dt <= secs - stepSec; i++) {
    const t = i * dt;
    let a = wps[0], b = wps[1];
    for (let k = 0; k < wps.length - 1; k++) {
      if (t >= wps[k].t && t <= wps[k + 1].t) { a = wps[k]; b = wps[k + 1]; break; }
    }
    const f = (b.t - a.t) === 0 ? 0 : (t - a.t) / (b.t - a.t);
    const o = fm.update(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f, 1000, dt);
    if (o) bank.push(o.bankDeg);
  }
  // Discard the turn entry, then measure the amplitude at exactly the
  // waypoint frequency by projecting onto one sine and one cosine.
  const y = bank.slice(Math.round(5 * fps));
  const n = y.length, f0 = 1 / stepSec;
  const mean = y.reduce((p, c) => p + c, 0) / n;
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * f0 * i / fps;
    re += (y[i] - mean) * Math.cos(a);
    im += (y[i] - mean) * Math.sin(a);
  }
  return 2 * Math.hypot(re, im) / n;      // amplitude in degrees
}

const rip = bankRipple({ turnDps: 10, stepSec: 0.25 });
check('the waypoint staircase does not shake the wings',
  rip < 0.35,
  `the bank carries ${rip.toFixed(2)} deg of ripple at the 4 Hz waypoint rate. `
  + 'A polyline differentiated frame-to-frame produces a square wave at that '
  + 'frequency and TURN_TAU only attenuates it. Measure the turn rate as a '
  + 'least-squares SLOPE over TURN_WINDOW_SEC instead: a window of length T '
  + 'has nulls at every k/T, so a 1 s window removes it outright rather than '
  + 'damping it. This read as the aircraft lagging through every turn.');

check('the turn rate is measured over a window, not between two frames',
  FM.TURN_WINDOW_SEC >= 4 * 0.25,
  `TURN_WINDOW_SEC is ${FM.TURN_WINDOW_SEC}. It has to span several waypoint `
  + 'cells of the route it is flying, or there is nothing to average over. '
  + "The recon route's cells are 0.25 s.");

// Held to a looser bound than the 0.25 s case ON PURPOSE, and not
// because the mechanism is weaker. At a fixed turn rate a 0.5 s cell
// steps the heading twice as far as a 0.25 s cell, so it excites twice
// as hard. No fixed-wing template in the fleet actually uses 0.5 s
// today; this is here so one can be added without the shimmer coming
// back unnoticed.
const rip2 = bankRipple({ turnDps: 10, stepSec: 0.5 });
check('a coarser 0.5 s spacing stays controlled too',
  rip2 < 0.8,
  `${rip2.toFixed(2)} deg of ripple at 2 Hz, against 0.8 allowed.`);

if (failures) {
  console.log(`\ncheck:fixedwing-flight FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:fixedwing-flight passed');
