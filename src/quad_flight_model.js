// ═══════════════════════════════════════════════════════════════════
// Quadcopter flight model — the Blender model, running in the browser
// ───────────────────────────────────────────────────────────────────
// A port of the airframe and controller in
// scripts/blender_drone_flight_demo.py, calibrated to a DJI Air 3 where
// a public number exists. Every constant below is that file's constant,
// same name, same value. If one is changed here it must be changed
// there, or the rendered demo and the live map stop being the same
// aircraft.
//
// WHAT IS DIFFERENT FROM BLENDER, and it is one thing.
//
// In Blender the controller OWNS the trajectory: a velocity plan goes
// in, the velocity loop produces a lean, the lean produces an
// acceleration, and the acceleration is integrated into a position. The
// position is an output.
//
// On the map the position is an INPUT. It comes from the scenario's
// waypoints and nothing is allowed to move a track off them. So the
// chain is inverted: the position is differentiated to velocity and
// again to acceleration, and from that point the physics is identical.
// The same question is asked — what lean does an airframe need to
// produce this acceleration against this drag — and answered with the
// same equation:
//
//     need      = a_measured + drag(v)
//     lean_des  = unit(need) * min(MAX_TILT, atan(|need| / G))
//     lean     += clamp(step toward lean_des with ATT_TAU, ATT_RATE)
//
// So a drone on a hard turn leans into it by the amount a real one
// would, a drone braking pitches nose-up, and both arrive at that
// attitude through a first-order loop with a slew limit rather than by
// an exponential smooth of an invented target.
//
// This replaces the eight cosmetic smoothing constants the map used
// before: headingSmoothing, pitchSmoothing, rollSmoothing, bankFactor,
// forwardPitchDeg, cruiseMs, bankClampDeg, pitchClampDeg. They
// described how an icon should look. These describe an aircraft.
// ═══════════════════════════════════════════════════════════════════

const G = 9.81;

// The airframe's own top speed, and the lean a steady cruise is allowed
// to settle at beyond it. Not from the Blender file: that model is only
// ever flown inside its envelope, so it never had to answer this.
// 30 m/s, 108 km/h. NOT a DJI Air 3, which does 21. The airframes in
// these scenarios are Russian and Chinese reconnaissance multirotors,
// purpose-built and genuinely faster than anything you can buy in a
// shop. The paths are retimed to sit just under this, in
// _CRUISE_TARGET_MS in drones.js, so a drone cruises near its limit and
// still has lean left for a turn.
export const TOP_SPEED_MS = 30;
export const CRUISE_TILT_CAP_DEG = 20;   // a visible lean, not a pinned one
export const DRAG_K = 9.81 * Math.tan(32.0 * Math.PI / 180) / (30 * 30);

// Airframe and controller. Mirrors blender_drone_flight_demo.py.
export const MAX_TILT_DEG = 32.0;     // DJI limits sport mode to ~35 deg
export const A_MAX = 6.5;             // m/s^2, 0 to 21 m/s in about 3.5 s
// DRAG, DERIVED FROM THE TOP SPEED, NOT COPIED FROM THE DJI.
//
// Blender's 0.0156 is the value that balances a 35 degree lean at
// 21 m/s, which is a DJI Air 3 at its limit. Carry that number onto a
// 30 m/s airframe and the arithmetic contradicts itself: at 26 m/s it
// demands atan(0.0156 * 26^2 / 9.81), which is 47 degrees, past the
// 32 degree tilt limit. The airframe pins and jitters, which is exactly
// the behaviour this was supposed to fix. Raising the top speed without
// the drag is not a faster aircraft, it is an impossible one.
//
// So drag is derived from the airframe rather than inherited:
//
//     DRAG_K = g * tan(MAX_TILT) / TOP_SPEED^2
//
// which is the same statement Blender's constant makes, written as a
// relation instead of a number. At the limit the lean IS the limit, and
// below it the lean falls away as the square of the speed:
//
//     20 m/s -> 15 deg      26 m/s -> 25 deg      30 m/s -> 32 deg
//
// Every other constant is Blender's, unchanged and gated against it.
export const KV = 1.2;                // 1/s, velocity loop gain
export const ATT_TAU = 0.15;          // s, attitude loop time constant
export const ATT_RATE_DPS = 120.0;    // deg/s, attitude slew limit
export const VZ_TAU = 0.6;            // s, vertical speed response
export const YAW_TAU = 0.3;           // s, yaw rate response
export const YAW_RATE_MAX_DPS = 100.0;

// Rotor speed model. Thrust goes with the square of rotor speed.
export const TL_DIP = 0.03;           // translational lift dip...
export const TL_SPEED = 7.0;          // ...centred here (m/s)...
export const TL_WIDTH = 5.0;          // ...and this wide
export const ATT_DIFF = 0.08;         // +-8% across the airframe
export const ATT_DIFF_REF = 14.0;     // rad/s^2
export const YAW_DIFF = 0.08;         // +-8% between CW and CCW pairs
export const YAW_DIFF_REF = 3.5;      // rad/s^2
export const YAW_DAMP_DIFF = 0.02;    // steady differential against drag

// Hover noise: the flight controller correcting a body that drifts in
// its own downwash. Sub-degree, sub-Hertz to a couple of Hertz.
export const NOISE_LEAN_DEG = [0.45, 0.30, 0.20];
export const NOISE_LEAN_HZ = [0.37, 0.91, 1.70];
export const NOISE_YAW_DEG = 0.4;
export const NOISE_YAW_HZ = 0.23;
// NOISE_ALT_M is deliberately NOT ported. In Blender it moves the root
// object; here the position is the scenario's and a track may not be
// nudged off its own waypoints, least of all by a few centimetres of
// cosmetic noise that the terrain reference would then chase.

const DEG = Math.PI / 180;

/** Sum of three sines, as in the Blender script's noise(). */
function _noise(t, amps, hzs, phase) {
  let out = 0;
  for (let i = 0; i < amps.length; i++) {
    out += amps[i] * Math.sin(2 * Math.PI * hzs[i] * t + phase * (i + 1));
  }
  return out;
}

function _clampLen(x, y, max) {
  const len = Math.hypot(x, y);
  if (len <= max || len < 1e-12) return [x, y];
  const k = max / len;
  return [x * k, y * k];
}

/** Shortest signed difference between two angles, radians. */
function _angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * One airframe's flight model. Feed it positions; it returns the
 * attitude and the four rotor speeds an aircraft following that path
 * would actually have.
 *
 * @param {object} opts
 *   rotors   four { bf, br, sense }, body-frame forward and right offsets
 *            in metres and the spin sense (+1 or -1). Order must match
 *            the model's Rotor_1..4 nodes.
 *   rps      hover rotor speed, revolutions per second.
 *   seed     decorrelates the hover noise between members of a swarm, so
 *            five drones do not breathe in unison.
 */
export function createQuadFlightModel(opts = {}) {
  const rotors = opts.rotors || [];
  const baseRps = opts.rps ?? 12;
  const seed = opts.seed ?? 0;
  // Hover noise gain. 1 is the Blender model's own amplitude, sub-degree
  // at a fraction of a Hertz to a couple of Hertz, which is a real
  // flight controller correcting a body that drifts in its own
  // downwash. 0 turns it off, which is the way to tell a genuine
  // oscillation from the one that is supposed to be there.
  const noiseGain = () => {
    // `&&` yields FALSE outside a browser, and false is not null, so a
    // `?? 1` or `== null` guard against it silently returns 0 and turns
    // the hover noise off everywhere there is no window. Which is the
    // gate, where "a hover is not perfectly still" then failed.
    if (typeof window === 'undefined') return 1;
    const g = window.__isr_quad_tuning && window.__isr_quad_tuning.hoverNoise;
    return typeof g === 'number' ? g : 1;
  };

  const maxTilt = MAX_TILT_DEG * DEG;
  const yawMax = YAW_RATE_MAX_DPS * DEG;
  const leanAmps = NOISE_LEAN_DEG.map(d => d * DEG);

  // State. Lean is a world-horizontal vector: its direction is the way
  // the airframe leans, its magnitude is the tilt angle in radians.
  let leanE = 0, leanN = 0;
  let leanRateE = 0, leanRateN = 0;
  let vE = 0, vN = 0, vU = 0;
  let yaw = null, yawRate = 0, yawRatePrev = 0;
  let prev = null;          // { e, n, u } metres, relative to the first sample
  let sinceMove = 0;        // seconds since the position last changed
  let vEraw = 0, vNraw = 0, vUraw = 0;   // last measured velocity, held between ticks
  let vMeasured = false;    // did THIS call produce a new velocity?
  let originLat = null, originLon = null;
  let tSec = 0;
  const theta = rotors.map(() => 0);

  // Flat-earth metres at the track's own latitude. A drone scenario
  // spans a few kilometres, where this is exact to well under a
  // millimetre, and it keeps this module free of a Cesium import.
  const M_PER_DEG_LAT = 111320;
  const mPerDegLon = (lat) => 111320 * Math.cos(lat * DEG);

  return {
    /**
     * @param lat,lon,alt  the position the scenario put the track at
     * @param dtSec        seconds since the previous call
     * @returns { headingRad, pitchRad, rollRad, rotorRps, rotorAngleRad }
     *          or null until there is enough history to differentiate.
     */
    update(lat, lon, alt, dtSec) {
      if (!(dtSec > 0) || !isFinite(lat) || !isFinite(lon)) return null;
      // TWO CLOCKS, DELIBERATELY.
      //
      // dt is clamped, because integrating a half-second step through a
      // 0.15 s time constant is a jump rather than a loop, and a
      // backgrounded tab produces exactly that.
      //
      // The VELOCITY clock must not be clamped. It measures how long
      // the airframe took to travel between two positions, and feeding
      // it the clamped value reports a drone that covered 2.5 seconds
      // of ground in a tenth of a second: 300 m/s, an impossible lean,
      // and a saturated tilt. Measured in a throttled browser, where
      // frames arrive seconds apart; at 60 fps the clamp never bites
      // and the bug is invisible.
      const dt = Math.min(dtSec, 0.1);

      if (originLat == null) { originLat = lat; originLon = lon; }
      const e = (lon - originLon) * mPerDegLon(originLat);
      const n = (lat - originLat) * M_PER_DEG_LAT;
      const u = alt || 0;

      if (!prev) { prev = { e, n, u }; return null; }

      tSec += dt;

      // ── measured velocity, ANCHORED TO MOVEMENT, not to frames ────
      //
      // The position advances on the simulation TICK; this runs every
      // render FRAME. Dividing a tick's whole displacement by one
      // frame's 16 ms reports a drone at 300 m/s, which then demands an
      // impossible lean and saturates the tilt. Measured exactly that
      // on the first live run.
      //
      // So the clock for the velocity is the time since the position
      // last actually CHANGED. Between ticks the velocity is held, and
      // the attitude loop below still runs per frame, which is what
      // makes the lean smooth rather than stepped.
      sinceMove += dtSec;          // raw, never the clamped dt
      const moved = Math.hypot(e - prev.e, n - prev.n, u - prev.u);
      vMeasured = false;
      if (moved > 1e-4 && sinceMove > 1e-4) {
        vMeasured = true;
        vEraw = (e - prev.e) / sinceMove;
        vNraw = (n - prev.n) / sinceMove;
        vUraw = (u - prev.u) / sinceMove;
        prev = { e, n, u };
        sinceMove = 0;
      }
      const vEnew = vEraw, vNnew = vNraw, vUnew = vUraw;

      // The path is a polyline, so raw differentiation is a staircase.
      // A first-order filter at the VERTICAL time constant is the
      // gentlest thing that is still part of the model rather than an
      // invented smoothing: VZ_TAU is how fast this airframe's speed
      // can change at all, so anything faster than it in the measured
      // signal is the path's sampling and not the aircraft.
      // RAW dtSec, like the velocity clock above and for the same
      // reason: this is a time-based low pass, so feeding it the
      // clamped step makes its effective time constant 25x too long
      // when frames are 2.5 s apart, and the reported speed converges
      // to less than half the real one. The attitude loop below keeps
      // the CLAMPED step on purpose: there, lagging after a stall is
      // the safe behaviour and snapping is not.
      const kv = 1 - Math.exp(-dtSec / VZ_TAU);
      vE += (vEnew - vE) * kv;
      vN += (vNnew - vN) * kv;
      vU += (vUnew - vU) * kv;
      const az = (vUnew - vU) / VZ_TAU;

      // ── ACCELERATION, ACROSS VELOCITY SAMPLES, NOT ACROSS FRAMES ──
      //
      // This read (vNew - vFiltered) / frameDt. Between ticks vNew is
      // held constant while vFiltered is still converging toward it, so
      // the numerator is the filter's own residual and the denominator
      // is 16 ms. Half a metre per second of residual over one frame is
      // 31 m/s^2: past A_MAX, so the lean saturated at the 32 degree
      // tilt limit and sat there, jittering, every frame of every
      // flight. That is the "jumping up and down like crazy", and it is
      // why every airframe read exactly 11.5 degrees of tilt no matter
      // what it was doing.
      //
      // Acceleration is a change in velocity over the time between two
      // VELOCITY MEASUREMENTS. There is no new velocity between ticks,
      // so there is no new acceleration either; it is held, exactly as
      // the velocity is.
      // AND IT DIFFERENTIATES THE FILTERED VELOCITY, NOT THE RAW ONE.
      //
      // A scenario path is a polyline and interpolate() is linear, so
      // the RAW velocity is piecewise constant and STEPS at every
      // waypoint. Differentiating that gives a spike at each one: a
      // 1.2 m/s step over a 16 ms frame is 75 m/s2, clamped to A_MAX,
      // which saturates the lean for that frame and releases it the
      // next. On the demo path, sampled at 0.25 s, that is the airframe
      // nodding 5 degrees four times a second for the whole flight.
      // Measured at 5.3 degrees peak to peak before this.
      //
      // vE and vN are already low-passed at VZ_TAU, which is the
      // airframe's own vertical response and therefore the fastest its
      // speed can genuinely change. Differentiating THAT is continuous,
      // and it is the real acceleration rather than the path's
      // sampling artefact.
      // AND IT IS THE FILTER'S ANALYTIC DERIVATIVE, not a difference
      // quotient. For a first-order low pass the derivative is exact
      // and needs no dt at all:
      //
      //     dv_filtered/dt = (v_raw - v_filtered) / VZ_TAU
      //
      // Any numerator over a 16 ms frame amplifies whatever noise is in
      // the numerator by 60. Differencing the RAW velocity amplified
      // the waypoint steps, and differencing the FILTERED velocity
      // amplified the filter's own per-frame increment, which is why
      // the second attempt was worse than the first: 8.7 degrees of
      // nodding against 5.3. This expression has no such term. It is
      // bounded by the speed change divided by 0.6 s, which is the
      // fastest this airframe can accelerate anyway.
      const aE = (vEnew - vE) / VZ_TAU;
      const aN = (vNnew - vN) / VZ_TAU;

      // ── yaw: follow the direction of travel, rate limited ─────────
      const speed = Math.hypot(vE, vN);
      // Below a walking pace the direction of travel is noise, so the
      // airframe holds the heading it has. A real one does the same:
      // there is nothing to point at.
      const yawCmd = speed > 0.5 ? Math.atan2(vE, vN) : (yaw ?? 0);
      if (yaw == null) yaw = yawCmd;
      const yawErr = _angDiff(yawCmd, yaw);
      const cmdRate = Math.max(-yawMax, Math.min(yawMax, yawErr / YAW_TAU));
      yawRate += (cmdRate - yawRate) * (1 - Math.exp(-dt / YAW_TAU));
      const yawAcc = (yawRate - yawRatePrev) / dt;
      yawRatePrev = yawRate;
      yaw += yawRate * dt;

      // ── horizontal: lean demand from the acceleration and the drag ─
      // Identical to the Blender model from here down. There the
      // acceleration came from a velocity loop; here it is measured.
      const [adE, adN] = _clampLen(aE, aN, A_MAX);
      // ── DRAG, CAPPED ABOVE THE AIRFRAME'S TOP SPEED ───────────────
      //
      // DRAG_K is calibrated so that drag balances a ~35 degree lean at
      // 21 m/s, which is a DJI Air 3 flat out. The scenario paths were
      // authored for an ICON, not an airframe, and fly far beyond that:
      //
      //    cph_quad_hostile        58 m/s median, 89 peak
      //    esbjerg_quad_hostile    77 m/s median
      //    swarm_recon_cph_amk     34 m/s median, 251 peak
      //
      // At 58 m/s the drag term alone demands atan(0.0156*58^2/9.81),
      // which is 79 degrees. Clamped to the 32 degree tilt limit, so
      // the airframe sits pinned at maximum lean for the whole flight
      // and jitters around the clamp. That is what reads as lying on
      // its side.
      //
      // Below TOP_SPEED_MS nothing here changes and the model is
      // Blender's exactly. Above it, where Blender was never run and
      // has no answer, the steady drag lean is held at
      // cruiseTiltCapDeg instead of pinning. ACCELERATION is untouched
      // and still leans the airframe fully, so a hard turn or a brake
      // still reads as one.
      //
      // The real fix is the paths. 58 m/s is 209 km/h, which is a
      // missile, not a quadcopter. This keeps them watchable until
      // someone decides to slow them down.
      const capDeg = (typeof window !== 'undefined'
        && window.__isr_quad_tuning && typeof window.__isr_quad_tuning.cruiseTiltCapDeg === 'number')
        ? window.__isr_quad_tuning.cruiseTiltCapDeg : CRUISE_TILT_CAP_DEG;
      let dragMag = DRAG_K * speed;
      if (speed > TOP_SPEED_MS) {
        const maxDragAccel = G * Math.tan(capDeg * DEG);
        dragMag = Math.min(dragMag, maxDragAccel / Math.max(speed, 1e-6));
      }
      const needE = adE + vE * dragMag;
      const needN = adN + vN * dragMag;
      const needLen = Math.hypot(needE, needN);
      let leanDesE = 0, leanDesN = 0;
      if (needLen > 1e-6) {
        const tilt = Math.min(maxTilt, Math.atan(needLen / G));
        leanDesE = (needE / needLen) * tilt;
        leanDesN = (needN / needLen) * tilt;
      }
      const k = 1 - Math.exp(-dt / ATT_TAU);
      const [stepE, stepN] = _clampLen(
        (leanDesE - leanE) * k, (leanDesN - leanN) * k, ATT_RATE_DPS * DEG * dt);
      const newLeanE = leanE + stepE, newLeanN = leanN + stepN;
      const rateE = stepE / dt, rateN = stepN / dt;
      const leanAccE = (rateE - leanRateE) / dt, leanAccN = (rateN - leanRateN) / dt;
      leanRateE = rateE; leanRateN = rateN;
      leanE = newLeanE; leanN = newLeanN;

      // ── hover noise, decorrelated per airframe ────────────────────
      const ng = noiseGain();
      const nLeanE = ng * _noise(tSec, leanAmps, NOISE_LEAN_HZ, 0.0 + seed);
      const nLeanN = ng * _noise(tSec, leanAmps, NOISE_LEAN_HZ, 2.1 + seed);
      const nYaw = ng * NOISE_YAW_DEG * DEG
        * Math.sin(2 * Math.PI * NOISE_YAW_HZ * tSec + 1.3 + seed);
      const shownE = leanE + nLeanE, shownN = leanN + nLeanN;
      const shownYaw = yaw + nYaw;

      // ── lean vector into body pitch and roll ──────────────────────
      // The lean points the way the airframe tips. Its component along
      // the nose is pitch (leaning forward is nose DOWN, so negative in
      // Cesium's convention) and its component along the right wing is
      // roll (leaning right is right wing down, positive).
      const cy = Math.cos(shownYaw), sy = Math.sin(shownYaw);
      const fwdE = sy, fwdN = cy;          // unit vector along the nose
      const rgtE = cy, rgtN = -sy;         // unit vector out the right wing
      const leanFwd = shownE * fwdE + shownN * fwdN;
      const leanRgt = shownE * rgtE + shownN * rgtN;

      // ── rotor speeds ──────────────────────────────────────────────
      const thrustW = Math.sqrt((needLen / G) ** 2 + (1 + az / G) ** 2);
      const tl = 1 - TL_DIP * Math.exp(-(((speed - TL_SPEED) / TL_WIDTH) ** 2));
      const base = baseRps * Math.sqrt(Math.max(0.2, thrustW)) * tl;
      const accF = leanAccE * fwdE + leanAccN * fwdN;
      const accR = leanAccE * rgtE + leanAccN * rgtN;
      const rotorRps = [];
      for (let i = 0; i < rotors.length; i++) {
        const R = rotors[i];
        const reach = Math.hypot(R.bf, R.br) || 1.0;
        const dAtt = -ATT_DIFF * (R.bf * accF + R.br * accR) / reach / ATT_DIFF_REF;
        // Reaction torque opposes spin: to yaw the body anticlockwise
        // the CLOCKWISE rotors speed up. Hence the minus sense.
        const dYaw = -R.sense * (YAW_DIFF * yawAcc / YAW_DIFF_REF
          + YAW_DAMP_DIFF * yawRate / (60 * DEG));
        const w = base * (1 + Math.max(-0.2, Math.min(0.2, dAtt + dYaw)));
        rotorRps.push(w);
        theta[i] += R.sense * 2 * Math.PI * w * dt;
      }

      return {
        headingRad: shownYaw,
        pitchRad: -leanFwd,
        rollRad: leanRgt,
        rotorRps,
        rotorAngleRad: theta.slice(),
        // Diagnostics, for __isr_attitude and the gate.
        speedMs: speed,
        tiltDeg: Math.hypot(shownE, shownN) / DEG,
        leanFwdDeg: leanFwd / DEG,
        leanRgtDeg: leanRgt / DEG,
      };
    },
  };
}

/**
 * Body-frame rotor geometry from composed hub positions.
 *
 * The hub coordinates come from walking the asset's full node transform
 * chain, which is the only way to read them on a model whose arms fold
 * under hinge matrices. Which model axis is the nose and which is up
 * differs per asset, so both are declared rather than assumed.
 *
 * @param hubs   four [x, y, z] in the model's own space, Rotor_1..4
 * @param noseAxis  e.g. '-z' for dji_air_3, '+x' for assault_drone_concept
 * @param upAxis    e.g. '+y'
 * @param senses    spin sense per rotor, matching the renderer
 */
export function rotorsFromHubs(hubs, noseAxis, upAxis, senses) {
  const axis = (s) => {
    const sign = s[0] === '-' ? -1 : 1;
    const i = { x: 0, y: 1, z: 2 }[s[s.length - 1].toLowerCase()];
    const v = [0, 0, 0]; v[i] = sign; return v;
  };
  const f = axis(noseAxis), u = axis(upAxis);
  // right = forward x up, in a right-handed frame.
  const r = [
    f[1] * u[2] - f[2] * u[1],
    f[2] * u[0] - f[0] * u[2],
    f[0] * u[1] - f[1] * u[0],
  ];
  return hubs.map((h, i) => ({
    bf: h[0] * f[0] + h[1] * f[1] + h[2] * f[2],
    br: h[0] * r[0] + h[1] * r[1] + h[2] * r[2],
    sense: senses[i],
  }));
}
