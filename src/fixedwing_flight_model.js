// ═══════════════════════════════════════════════════════════════════
// Fixed-wing flight model — the Blender model, running in the browser
// ───────────────────────────────────────────────────────────────────
// A port of the airframe and autopilot in
// scripts/blender_fixedwing_flight_demo.py, the file the Sivrisinek
// demo was rendered with. Every constant below is that file's constant,
// same name, same value. Change one here and it must change there, or
// the render and the live map stop being the same aircraft.
//
// WHY A SECOND MODEL AT ALL, when quad_flight_model.js exists.
//
// A quadcopter has no wing. It goes where it leans, it can hover, it can
// fly sideways, and its attitude is a lean vector. None of that is true
// of an aeroplane:
//
//   it cannot hover            there is a minimum speed, below which
//                              the wing stops working
//   it banks to turn           the turn comes FROM the bank, through
//                              gravity, not from pointing and pushing
//   its nose is not its path   the wing needs an angle of attack, so
//                              the nose sits ABOVE the flight path, and
//                              further above it the slower it flies
//
// Driving a wing with the quadcopter model produces an airframe that
// slides round corners flat and points exactly where it is going. That
// reads as a drone with wings glued on.
//
// WHAT IS DIFFERENT FROM BLENDER, and it is the same one thing as the
// quad. There the autopilot OWNS the trajectory: a plan commands speed,
// climb rate and turn rate, and the position falls out. On the map the
// position is an INPUT from the scenario's waypoints, so the chain is
// inverted — the path is differentiated into speed, turn rate and climb
// rate, and from there the physics is identical:
//
//     bank_des  = -atan(V * turnRate / g)        coordinated turn
//     alpha     =  alpha_cruise * (Vc/V)^2 * n   load factor n = 1/cos(bank)
//     theta     =  gamma + alpha                 nose above the path
//
// So an aircraft turning banks by the amount the turn actually requires,
// and one flying slowly rides nose-high because its wing needs the
// angle. Both come out of the measurement rather than being drawn on.
// ═══════════════════════════════════════════════════════════════════

const G = 9.81;
const DEG = Math.PI / 180;

// Airframe, TB2-class. Cruise 130 km/h and a 120 kt maximum are Baykar's
// published TB2 figures; the rest are judgements for a 100 hp pusher of
// that size and are named so they can be argued with.
export const V_CRUISE = 36.0;          // m/s, 130 km/h
export const V_MIN = 24.0;             // m/s, just above the stall
export const A_LONG = 1.2;             // m/s^2, acceleration cap
export const A_DECEL = 1.8;            // m/s^2, deceleration cap
export const KV = 0.6;                 // 1/s, speed loop gain
export const MAX_BANK_DEG = 45.0;
export const ROLL_RATE_DPS = 40.0;     // deg/s
export const ROLL_TAU = 0.35;          // s
export const ALPHA_CRUISE_DEG = 3.5;   // angle of attack at cruise, level
export const ALPHA_MAX_DEG = 11.0;
export const GAMMA_MAX_DEG = 12.0;     // flight-path angle limit
export const PITCH_RATE_DPS = 6.0;     // deg/s
export const PITCH_TAU = 0.5;          // s
export const GAMMA_TAU = 1.2;          // s, the flight path's lag behind the nose
export const THR_IDLE = 0.15;
export const TURB_PITCH_DEG = [0.25, 0.15];
export const TURB_PITCH_HZ = [0.21, 0.47];
export const TURB_ROLL_DEG = [0.45, 0.25];
export const TURB_ROLL_HZ = [0.17, 0.39];

// NOT FROM THE BLENDER FILE, and the same deviation the quad needed.
//
// There the autopilot is handed a plan it can fly, so every demand is
// one the airframe can meet. Here the demands are DIFFERENTIATED FROM A
// PATH, and a hand-authored polyline turns instantly at a waypoint. The
// measured turn rate at such a corner is unbounded, and an unbounded
// turn rate asks for a bank of 90 degrees.
//
// Measuring over a window rather than over one frame is the right fix
// and it is what TURN_TAU does. This is the backstop under it.
export const TURN_RATE_MAX_DPS = 20.0;
// The measured signals carry the path's sampling, so they are filtered
// before they reach the physics. Same reasoning as the quad's ACC_TAU:
// a touch under the loop they feed, so they remove what the airframe
// could not have responded to and leave everything it could.
export const SPEED_TAU = 0.35;         // s
export const TURN_TAU = 0.30;          // s
export const CLIMB_TAU = 0.50;         // s

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Blender's ease(): a first-order step toward a target, optionally slew
 *  limited. Same expression, same argument order. */
function ease(cur, target, tau, dt, slew) {
  let step = (target - cur) * (1 - Math.exp(-dt / tau));
  if (slew !== undefined && slew !== null) step = clamp(step, -slew, slew);
  return cur + step;
}

/** Blender's noise(): a sum of sines. The turbulence that keeps a wing
 *  from looking welded to the air. */
function noise(t, amps, hzs, phase) {
  let out = 0;
  for (let k = 0; k < amps.length; k++) {
    out += amps[k] * Math.sin(2 * Math.PI * hzs[k] * t + phase + 0.9 * k);
  }
  return out;
}

/** Turbulence gain. 1 is the Blender amplitude; 0 turns it off, which is
 *  how a real oscillation is told from the one that belongs there. */
function turbGain() {
  if (typeof window === 'undefined') return 1;
  const g = window.__isr_fixedwing_tuning && window.__isr_fixedwing_tuning.turbulence;
  return typeof g === 'number' ? g : 1;
}

/**
 * Create a fixed-wing attitude model driven by position.
 *
 * Feed it where the aircraft is, every frame, and it reports the attitude
 * an aeroplane flying that path would hold.
 *
 * @param {{rps?:number}} [opts] propeller revolutions per second at cruise
 * @returns {{update:(latDeg:number, lonDeg:number, altM:number, dtSec:number)=>object|null}}
 */
export function createFixedWingFlightModel(opts = {}) {
  const rpsBase = opts.rps ?? 20;

  // Measured state, filtered.
  let V = V_CRUISE, turnRate = 0, climb = 0;
  // Attitude state. These are the Blender integrator's variables.
  let bank = 0, theta = ALPHA_CRUISE_DEG * DEG, gamma = 0;
  let propAngle = 0, tSec = 0;
  // Previous sample, for differentiating the path.
  let pLat = null, pLon = null, pAlt = null, pHdg = null;

  return {
    /** @returns null until there are two samples to differentiate. */
    update(latDeg, lonDeg, altM, dtSec) {
      const dt = Math.min(Math.max(dtSec, 1e-4), 0.1);
      tSec += dt;

      if (pLat === null) {
        pLat = latDeg; pLon = lonDeg; pAlt = altM;
        return null;
      }

      // ── differentiate the path ────────────────────────────────────
      const mLat = 111320, mLon = 111320 * Math.cos(latDeg * DEG);
      const dN = (latDeg - pLat) * mLat;
      const dE = (lonDeg - pLon) * mLon;
      const dU = altM - pAlt;
      pLat = latDeg; pLon = lonDeg; pAlt = altM;

      const horiz = Math.hypot(dE, dN);
      const vRaw = Math.hypot(horiz, dU) / dtSec;
      const climbRaw = dU / dtSec;

      // Heading of travel, and its rate. Below a crawl the direction of
      // travel is noise, so the aircraft holds the heading it has.
      let hdg = pHdg;
      if (horiz / dtSec > 1) hdg = Math.atan2(dE, dN);
      let wRaw = 0;
      if (hdg !== null && pHdg !== null) {
        let d = hdg - pHdg;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        wRaw = d / dtSec;
      }
      if (hdg !== null) pHdg = hdg;

      // Filter the measurements, not the results. A polyline hands over a
      // staircase; smoothing the bank afterwards only trades a snap for a
      // lag. See the quad model's ACC_TAU note, which is the same point.
      V = ease(V, Math.max(V_MIN, vRaw), SPEED_TAU, dt);
      climb = ease(climb, climbRaw, CLIMB_TAU, dt);
      const wCap = TURN_RATE_MAX_DPS * DEG;
      turnRate = ease(turnRate, clamp(wRaw, -wCap, wCap), TURN_TAU, dt);

      // ── bank: the turn comes FROM the bank ────────────────────────
      // Identical to the Blender line, with a measured turn rate where it
      // had a commanded one.
      const maxBank = MAX_BANK_DEG * DEG;
      const bankDes = clamp(-Math.atan((V * turnRate) / G), -maxBank, maxBank);
      bank = ease(bank, bankDes, ROLL_TAU, dt, ROLL_RATE_DPS * DEG * dt);

      // ── pitch leads, flight path follows ──────────────────────────
      // The load factor in a bank, and the angle of attack the wing needs
      // at this speed to carry it. Slower means more angle; banked means
      // more again.
      const n = 1 / Math.max(0.3, Math.cos(bank));
      const alpha = clamp(
        ALPHA_CRUISE_DEG * DEG * (V_CRUISE / V) ** 2 * n,
        0.5 * DEG, ALPHA_MAX_DEG * DEG);
      const gammaMax = GAMMA_MAX_DEG * DEG;
      const gammaDes = clamp(Math.asin(clamp(climb / Math.max(V, 1e-6), -0.5, 0.5)),
        -gammaMax, gammaMax);
      theta = ease(theta, gammaDes + alpha, PITCH_TAU, dt, PITCH_RATE_DPS * DEG * dt);
      gamma = ease(gamma, theta - alpha, GAMMA_TAU, dt);

      // ── throttle, inferred, for the propeller ─────────────────────
      const dV = clamp((V_CRUISE - V) * KV, -A_DECEL, A_LONG);
      const thr = clamp(
        0.55 * (V / V_CRUISE) ** 2 + 0.25 * (dV / A_LONG)
        + 0.6 * Math.sin(gamma) * V / 4.0 + 0.15, THR_IDLE, 1.0);

      const wProp = rpsBase * (0.55 + 0.45 * thr);
      propAngle += 2 * Math.PI * wProp * dt;

      // ── turbulence ────────────────────────────────────────────────
      const tg = turbGain();
      const thShown = theta + tg * noise(tSec, TURB_PITCH_DEG.map(d => d * DEG), TURB_PITCH_HZ, 0.3);
      const phShown = bank + tg * noise(tSec, TURB_ROLL_DEG.map(d => d * DEG), TURB_ROLL_HZ, 1.9);

      return {
        headingRad: hdg ?? 0,
        pitchRad: thShown,          // nose above the horizon, POSITIVE up
        rollRad: phShown,           // right wing down, POSITIVE
        speedMs: V,
        gammaRad: gamma,            // the flight path, which the nose leads
        alphaRad: alpha,
        bankDeg: bank / DEG,
        pitchDeg: thShown / DEG,
        throttle: thr,
        propRps: wProp,
        propAngleRad: propAngle,
      };
    },
  };
}
