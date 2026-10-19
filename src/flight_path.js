// ═══════════════════════════════════════════════════════════════════
// flight_path — give the controller its job back
// ───────────────────────────────────────────────────────────────────
// Blender's controller OWNS the trajectory. You hand it a velocity plan
// and it integrates lean, drag and thrust into a position; the path is
// the OUTPUT. Nothing can demand a turn the airframe cannot fly, because
// the airframe is what draws the line. That is the whole reason the
// rendered demo looks right.
//
// Scenario tracks never got that. Their paths are hand-authored
// polylines of a dozen points, the position is an INPUT, and the
// controller is left reporting what attitude an impossible movement
// implies. Measured on cph_swarm_runway_incursion: 44 points over 492 s,
// one every 11 s, with the direction changing INSTANTLY at each.
//
// Two different faults live in that one template, and both end here:
//
//   wp6..wp29   a 181 m loiter orbit, sampled at 20 degrees a step. The
//               geometry is a circle and it is flyable at 12.7 degrees
//               of bank; it just renders as a 24-sided polygon.
//   wp3, wp5    genuine corners of -56 and -62 degrees, with no arc at
//               all. A real airframe needs seconds and a radius.
//
// SUBDIVIDING THE POLYLINE FIXES NEITHER. More points on a line with a
// corner is more points sitting on a corner. The path has to be FLOWN:
// integrate the airframe toward each waypoint and let the positions fall
// out. Only integration bends.
//
// WHAT THIS COSTS, and it is geometry rather than a choice. An airframe
// that is turning swings wide, so it passes NEAR a corner rather than
// through it. Tightening the bank or slowing into the corner shrinks the
// miss; nothing drives it to zero.
//
// Every constant here is the one in _demoFlightPath, which is the one in
// scripts/blender_drone_flight_demo.py.
// ═══════════════════════════════════════════════════════════════════

const G = 9.81, DEG = Math.PI / 180;
export const SIM_DT = 1 / 60;

// Airframe and controller. Mirrors _demoFlightPath exactly.
export const A_MAX = 6.5;
export const DRAG_K = 0.0068111;
export const KV = 1.2;
export const MAX_TILT = 32 * DEG;
export const VZ_TAU = 0.6;
export const YAW_TAU = 0.3;
export const YAW_RATE_MAX_DPS = 100;
export const ATT_TAU = 0.15;
export const ATT_RATE_DPS = 120;

/**
 * Fly a hand-authored waypoint list and return the path the airframe
 * actually flies, sampled at `emitDt`.
 *
 * The guidance is deliberately the simplest thing that preserves the
 * schedule: at any instant the airframe is told to reach the CURRENT
 * target at that target's own tSec, so
 *
 *     desired velocity = (target - position) / time remaining
 *
 * which decelerates into a waypoint, accelerates out of it, and curves
 * between the two without anyone choosing a radius. The schedule is
 * preserved because the target time is never moved: a corner that the
 * airframe swings wide of is made up on the next leg, not by arriving
 * late.
 *
 * @param {Array<{lat,lon,alt,tSec}>} waypoints authored, ascending tSec
 * @param {{emitDt?:number, maxSpeed?:number}} [opts]
 * @returns {Array<{lat,lon,alt,heading,tSec}>}
 */
export function flyWaypoints(waypoints, opts = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return waypoints;
  const emitDt = opts.emitDt ?? SIM_DT;
  // The tilt limit is what caps speed, at sqrt(g tan(MAX_TILT)/DRAG_K).
  const topSpeed = opts.maxSpeed ?? Math.sqrt(G * Math.tan(MAX_TILT) / DRAG_K);

  const lat0 = waypoints[0].lat, lon0 = waypoints[0].lon, alt0 = waypoints[0].alt ?? 0;
  const M_LAT = 111320, M_LON = 111320 * Math.cos(lat0 * DEG);
  const toLocal = (w) => ({
    x: (w.lon - lon0) * M_LON, y: (w.lat - lat0) * M_LAT, z: (w.alt ?? 0) - alt0,
    t: w.tSec,
  });
  const targets = waypoints.map(toLocal);
  const endT = targets[targets.length - 1].t;

  let x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
  let yaw = 0, yawRate = 0, leanE = 0, leanN = 0;
  let t = 0, i = 1, sinceEmit = 0;
  const out = [{ lat: lat0, lon: lon0, alt: alt0, heading: 0, tSec: 0 }];

  const steps = Math.round(endT / SIM_DT);
  for (let k = 0; k < steps; k++) {
    const dt = SIM_DT;
    // Advance the target on ITS OWN clock, so the schedule cannot drift.
    while (i < targets.length - 1 && t >= targets[i].t) i++;
    const g = targets[i];
    const left = Math.max(dt, g.t - t);

    // ── guidance: the velocity that arrives on time ──────────────────
    let tgtE = (g.x - x) / left, tgtN = (g.y - y) / left;
    const want = Math.hypot(tgtE, tgtN);
    if (want > topSpeed) { tgtE *= topSpeed / want; tgtN *= topSpeed / want; }
    const bodyU = (g.z - z) / left;

    // ── yaw: point the nose along the demand, rate limited ───────────
    if (want > 0.5) {
      const cmdYaw = Math.atan2(tgtE, tgtN);
      let e = cmdYaw - yaw;
      while (e > Math.PI) e -= 2 * Math.PI;
      while (e < -Math.PI) e += 2 * Math.PI;
      const max = YAW_RATE_MAX_DPS * DEG;
      const cmd = Math.max(-max, Math.min(max, e / YAW_TAU));
      yawRate += (cmd - yawRate) * (1 - Math.exp(-dt / YAW_TAU));
    }
    yaw += yawRate * dt;

    // ── horizontal: identical to _demoFlightPath from here down ──────
    const spd = Math.hypot(vx, vy);
    const dragE = vx * DRAG_K * spd, dragN = vy * DRAG_K * spd;
    let adE = (tgtE - vx) * KV, adN = (tgtN - vy) * KV;
    const adLen = Math.hypot(adE, adN);
    if (adLen > A_MAX) { adE *= A_MAX / adLen; adN *= A_MAX / adLen; }
    const needE = adE + dragE, needN = adN + dragN;
    const needLen = Math.hypot(needE, needN);
    let leanDesE = 0, leanDesN = 0;
    if (needLen > 1e-9) {
      const tilt = Math.min(MAX_TILT, Math.atan(needLen / G));
      leanDesE = (needE / needLen) * tilt;
      leanDesN = (needN / needLen) * tilt;
    }
    const kAtt = 1 - Math.exp(-dt / ATT_TAU);
    let stepE = (leanDesE - leanE) * kAtt, stepN = (leanDesN - leanN) * kAtt;
    const slew = ATT_RATE_DPS * DEG * dt;
    const stepLen = Math.hypot(stepE, stepN);
    if (stepLen > slew) { stepE *= slew / stepLen; stepN *= slew / stepLen; }
    leanE += stepE; leanN += stepN;
    const leanLen = Math.hypot(leanE, leanN);
    let aE = -dragE, aN = -dragN;
    if (leanLen > 1e-9) {
      const thrust = G * Math.tan(leanLen);
      aE = (leanE / leanLen) * thrust - dragE;
      aN = (leanN / leanLen) * thrust - dragN;
    }
    vx += aE * dt; vy += aN * dt;
    vz += (bodyU - vz) * (1 - Math.exp(-dt / VZ_TAU));
    x += vx * dt; y += vy * dt; z += vz * dt;
    t += dt;

    sinceEmit += dt;
    if (sinceEmit >= emitDt - 1e-9) {
      sinceEmit = 0;
      out.push({
        lat: lat0 + y / M_LAT,
        lon: lon0 + x / M_LON,
        alt: alt0 + z,
        heading: ((Math.atan2(vx, vy) / DEG) + 360) % 360,
        tSec: +t.toFixed(3),
      });
    }
  }
  return out;
}

/** How far the flown path passes from each authored waypoint, and when. */
export function missReport(authored, flown) {
  const DEGR = Math.PI / 180;
  const lat0 = authored[0].lat;
  const M_LAT = 111320, M_LON = 111320 * Math.cos(lat0 * DEGR);
  return authored.map((w, idx) => {
    let best = Infinity, at = 0;
    for (const p of flown) {
      const d = Math.hypot((p.lon - w.lon) * M_LON, (p.lat - w.lat) * M_LAT,
        (p.alt ?? 0) - (w.alt ?? 0));
      if (d < best) { best = d; at = p.tSec; }
    }
    return { idx, tSec: w.tSec, missM: best, closestAtSec: at };
  });
}
