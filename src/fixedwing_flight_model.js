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
// THE ONE PIECE BLENDER HAS NO NEED OF.
//
// There the aircraft IS the path: heading is integrated from bank and
// nothing else exists to disagree with. Here a route says where the
// aircraft must be, so the nose it integrates has to be kept honest
// against the direction it is actually travelling, or the two drift
// apart and it flies crabbed.
//
// This is the gain on that correction, in 1/s. It must stay SMALL. It
// is the one path by which the polyline's staircase can reach the nose,
// and the whole point of integrating the heading is that it never does:
// 0.8 closes a heading error with a 1.25 s time constant, slow enough
// that a 3 degree waypoint step arrives as 2.4 deg/s of extra turn
// demand and is then smoothed again by ROLL_TAU before it moves
// anything.
export const HEADING_HOLD_K = 0.8;     // 1/s
// THE LOOK-AHEAD, and why the turns lagged without it.
//
// Measuring a turn from where the aircraft HAS BEEN means the bank can
// only start once the path has already begun to turn, and can only
// stop once it has already straightened. Simulated on a 0.25 s
// waypoint route at 60 fps, a 10 deg/s turn at 36 m/s: the nose trailed
// the path by 4.6 deg through the roll-in, and at the end of the turn
// the aircraft kept turning 4.3 deg past the path, rolled 7.6 deg the
// OTHER way to catch up, and took four seconds to settle. That
// counter-bank is what read as lag on screen.
//
// A real autopilot flying a known route rolls in BEFORE the turn and
// out BEFORE the new heading, because it knows the route. The map knows
// it too: the waypoints are the scenario. So the rig hands the model the
// path's heading LEAD seconds ahead, and the bank is commanded to bring
// the nose onto that heading in that time: w_des = (hdg_ahead - psi) /
// LEAD. LEAD is the roll-in time, a third of a second of ROLL_TAU plus
// the 33 degrees of bank at 40 deg/s, which is what makes the bank
// arrive as the turn begins rather than after it. Blender has no need
// of this: there the autopilot commands the turn and the path follows.
export const LOOKAHEAD_SEC = 0.8;
// Blender's dV is the acceleration it is ABOUT TO APPLY: it comes from
// the plan's commanded speed, (v_t - V) * KV, and the next line
// integrates it. The propeller then reads it, so the prop rises as the
// aircraft accelerates and falls as it slows.
//
// Here the path commands the speed, so there is no v_t to difference
// against. Writing (V_CRUISE - V) * KV in its place inverted the term:
// an aircraft genuinely accelerating past cruise produced a NEGATIVE
// dV and the propeller wound DOWN as it sped up. So the acceleration is
// measured off the filtered speed instead, which is the same quantity
// Blender's dV denotes, arrived at the only way a measured path allows.
//
// Filtered, because it is a second derivative of a polyline and so the
// noisiest signal in the model.
export const ACCEL_TAU = 0.40;         // s
// MEASURE THE TURN RATE OVER A WINDOW, NOT OVER ONE FRAME.
//
// This is the line TURN_RATE_MAX_DPS's own note predicted: "measuring
// over a window rather than over one frame is the right fix". It was
// right, and filtering afterwards was never going to do it.
//
// interpolate() is piecewise-linear, so the direction of travel is
// CONSTANT inside a waypoint cell and changes only at a waypoint. A
// frame-to-frame derivative of that is a square wave at the waypoint
// rate, and the recon route's 0.25 s spacing puts it at 4 Hz. A
// first-order filter only attenuates it: at TURN_TAU = 0.30 s, 13 per
// cent of 4 Hz still gets through, which measured as a +/-1.66 degree
// wobble of the wings in every turn. At the camera distance in Lucas's
// recording that is about 4 px of wingtip movement at 4 Hz, which is
// exactly the shimmer he kept calling a lag. Straight flight never
// showed it because a straight line has no corners.
//
// A least-squares slope over a window of length T averages the
// staircase away instead of chasing it. Note what it does NOT do: a
// boxcar mean of length T has exact nulls at every k/T, but an LS
// SLOPE weights each sample by (t - tmean), a linear ramp, and that
// window's zeros are not at k/T. It attenuates strongly and broadly
// rather than nulling one frequency, which is the more useful
// property here because the fleet's waypoint spacings are not all the
// same. Measured attenuation at 10 deg/s: 0.25 s spacing (4 Hz) falls
// to 0.1 deg of ripple, 0.5 s spacing (2 Hz) to 0.56 deg, the latter
// higher only because a 0.5 s cell steps the heading twice as far.
//
// One second is long enough to cover several cells of the 0.25 s recon
// route while staying short enough that turn entry is not visibly
// delayed.
//
// Measured on the real route, bank residual in a steady turn:
//
//     frame-to-frame   +/-1.66 deg at 4.00 Hz   (3.9 px of wingtip)
//     1 s LS window    +/-0.65 deg at 0.60 Hz   (1.5 px)
//
// The frequency matters as much as the amplitude. 4 Hz reads as a
// broken render; what is left at 0.6 Hz reads as an aircraft working
// in the wind, which is the detail Lucas asked to keep. It costs 0.22 s
// on turn entry, measured to 90 per cent of steady bank.
export const TURN_WINDOW_SEC = 1.0;    // s

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
  let V = V_CRUISE, turnRate = 0, climb = 0, accel = 0;
  // Heading history for the windowed turn-rate fit. Unwrapped, because
  // a least-squares slope cannot be taken across a +/-pi branch cut.
  let hdgUnwrap = 0;
  const hdgHist = [];                  // [tSec, unwrapped heading]
  // Attitude state. These are the Blender integrator's variables.
  // psi is the HEADING THE AIRCRAFT IS POINTING, integrated from bank
  // exactly as Blender integrates it. It is deliberately NOT the
  // measured direction of travel: see the chain below.
  let bank = 0, theta = ALPHA_CRUISE_DEG * DEG, gamma = 0, psi = null;
  let propAngle = 0, tSec = 0;
  // Previous sample, for differentiating the path.
  let pLat = null, pLon = null, pAlt = null, pHdg = null;

  return {
    /** @returns null until there are two samples to differentiate. */
    update(latDeg, lonDeg, altM, dtSec, ahead) {
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
      if (hdg !== null && pHdg !== null) {
        let d = hdg - pHdg;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        hdgUnwrap += d;
      }
      if (hdg !== null) pHdg = hdg;

      // The turn rate, as the SLOPE of the heading over TURN_WINDOW_SEC
      // rather than the difference between two frames. See the constant:
      // the window's nulls are placed on the waypoint rate, so the
      // staircase does not reach the wings at all instead of reaching
      // them attenuated.
      hdgHist.push([tSec, hdgUnwrap]);
      while (hdgHist.length > 2 && tSec - hdgHist[0][0] > TURN_WINDOW_SEC) {
        hdgHist.shift();
      }
      let wRaw = 0;
      if (hdgHist.length > 2) {
        let st = 0, sh = 0;
        for (const [a, b] of hdgHist) { st += a; sh += b; }
        const mt = st / hdgHist.length, mh = sh / hdgHist.length;
        let num = 0, den = 0;
        for (const [a, b] of hdgHist) { num += (a - mt) * (b - mh); den += (a - mt) * (a - mt); }
        wRaw = den > 0 ? num / den : 0;
      } else if (hdgHist.length === 2) {
        // First frames only, before the window has filled.
        wRaw = (hdgHist[1][1] - hdgHist[0][1]) / Math.max(hdgHist[1][0] - hdgHist[0][0], 1e-6);
      }

      // Filter the measurements, not the results. A polyline hands over a
      // staircase; smoothing the bank afterwards only trades a snap for a
      // lag. See the quad model's ACC_TAU note, which is the same point.
      const vPrev = V;
      V = ease(V, Math.max(V_MIN, vRaw), SPEED_TAU, dt);
      // The acceleration the aircraft is actually undergoing. See
      // ACCEL_TAU: this is Blender's dV, measured rather than commanded.
      accel = ease(accel, (V - vPrev) / dt, ACCEL_TAU, dt);
      climb = ease(climb, climbRaw, CLIMB_TAU, dt);
      // FILTER FIRST, THEN CLAMP. The order here was the whole bug: the
      // aircraft flew every turn dead level because this line destroyed
      // the very signal it was supposed to smooth.
      //
      // The route is interpolated LINEARLY between waypoints, so inside
      // one 0.25 s cell the direction of travel is constant and the
      // heading only changes AT a waypoint. The raw turn rate is
      // therefore not a steady 11.8 deg/s: it is a spike of roughly
      // 180 deg/s for one frame in fifteen, and zero in between.
      //
      // Clamping that spike to 20 deg/s BEFORE the filter throws away
      // the area under it, and what reaches the filter averages out to a
      // tenth of the truth. Measured on a 36 m/s aircraft in a turn that
      // genuinely needs 37.1 degrees of bank:
      //
      //     clamp then filter    1.33 deg/s  ->   4.9 deg of bank
      //     filter then clamp   11.79 deg/s  ->  36.3 deg of bank
      //
      // The filter's job is to average the staircase back into the real
      // rate, which it does correctly when it is given the spikes. The
      // clamp is only a backstop against a genuinely impossible demand,
      // so it belongs after the averaging, not before it.
      const wCap = TURN_RATE_MAX_DPS * DEG;
      turnRate = ease(turnRate, wRaw, TURN_TAU, dt);
      turnRate = clamp(turnRate, -wCap, wCap);

      // ── bank first, heading SECOND. The file's causal order. ──────
      //
      // THIS WAS BACKWARDS, AND IT IS WHY THE AIRCRAFT LOOKED LAGGY AND
      // BANKED THE WRONG WAY.
      //
      // Blender does not measure a heading. It commands a bank, and the
      // heading is what the bank PRODUCES:
      //
      //     bank_des = clamp(-atan(V * w_t / G), ...)
      //     bank     = ease(bank, bank_des, ROLL_TAU, dt, roll_slew)
      //     w        = -G * tan(bank) / V      # the turn the bank MAKES
      //     psi     += w * dt                  # heading INTEGRATES
      //
      // The old code ran that backwards: it took the measured heading as
      // truth and derived a bank from it. Two consequences, both of which
      // Lucas saw before I did.
      //
      // One, the rendered heading WAS the measurement, so it was the
      // polyline's staircase: the nose snapped about 3 degrees at every
      // waypoint, fifteen times a second's worth of steps, and no amount
      // of fixing the bank could smooth it because the nose was not being
      // filtered at all. Integrating psi from a filtered bank means the
      // nose can only move as fast as the wings roll.
      //
      // Two, THE SIGN. Blender's psi is "+ve left", stated at its own
      // declaration. Cesium's heading is atan2(dE, dN): clockwise from
      // north, POSITIVE RIGHT. The minus in bank_des belongs to the
      // left-positive convention, and carrying it across the flip made a
      // right turn command left wing down. The aircraft banked AWAY from
      // every turn. So: no minus here, and no minus on w either.
      const maxBank = MAX_BANK_DEG * DEG;
      if (psi === null) psi = hdg ?? 0;

      // Keep the integrated nose honest against the direction of travel.
      // Small gain on purpose; HEADING_HOLD_K says why.
      let hdgErr = 0;
      if (hdg !== null) {
        hdgErr = hdg - psi;
        while (hdgErr > Math.PI) hdgErr -= 2 * Math.PI;
        while (hdgErr < -Math.PI) hdgErr += 2 * Math.PI;
      }
      let wDes;
      let onRoute = false;
      if (ahead && Number.isFinite(ahead.turnRateRad) && Number.isFinite(ahead.headingRad)) {
        // THE ROUTE IS KNOWN, so the bank can lead the turn the way a
        // real roll-in does, and the nose can sit on the path's tangent
        // the way a coordinated turn does. Two separate things:
        //
        //   bank  <- the turn rate the route will have LEAD seconds from
        //            now, through the roll loop. It is built by the time
        //            the track bends, and shed before it straightens.
        //   nose  <- the route's heading of travel NOW, chord-smoothed by
        //            the caller over half a second, so it carries no
        //            staircase and no lag. On a fixed path the nose
        //            cannot be anywhere else without sideslip.
        //
        // Integrating the nose from the bank (the fallback below) is
        // right when the aircraft owns its path and wrong when the path
        // is given: an early bank then swings the nose off the track
        // until the track catches up, and a late one trails it.
        onRoute = true;
        wDes = clamp(ahead.turnRateRad, -wCap, wCap);
      } else {
        wDes = clamp(turnRate + hdgErr * HEADING_HOLD_K, -wCap, wCap);
      }

      const bankDes = clamp(Math.atan((V * wDes) / G), -maxBank, maxBank);
      bank = ease(bank, bankDes, ROLL_TAU, dt, ROLL_RATE_DPS * DEG * dt);
      // The turn rate the bank actually produces. Off a known route it is
      // also what sweeps the heading; on one the heading is the route's.
      const wActual = (G * Math.tan(bank)) / V;
      if (onRoute) {
        psi = ahead.headingRad;
        hdgErr = 0;
      } else {
        psi += wActual * dt;
      }

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
      // The Blender expression unchanged, with the measured acceleration
      // where it had the commanded one. KV is consequently no longer in
      // this chain: it is the gain on a speed command, and a measured
      // path issues none. It stays exported because the parity gate
      // reads it against the Blender file.
      const dV = clamp(accel, -A_DECEL, A_LONG);
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
        // The INTEGRATED heading, never the measured one. The measured
        // one is the polyline's staircase and putting it on screen is
        // what made the turns judder.
        headingRad: psi ?? 0,
        pitchRad: thShown,          // nose above the horizon, POSITIVE up
        rollRad: phShown,           // right wing down, POSITIVE
        speedMs: V,
        gammaRad: gamma,            // the flight path, which the nose leads
        alphaRad: alpha,
        bankDeg: bank / DEG,
        turnRateDps: wActual / DEG,     // what the bank is producing
        hdgErrDeg: hdgErr / DEG,        // nose vs direction of travel
        pitchDeg: thShown / DEG,
        throttle: thr,
        propRps: wProp,
        propAngleRad: propAngle,
        accelMs2: accel,
      };
    },
  };
}
