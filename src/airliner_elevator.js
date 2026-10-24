// The airliner's elevators: the two moving surfaces on the back edge of
// the horizontal tail. The model names them BackAileron.L and .R, which
// is why they were missed: they sit at the tail (17 to 19 m behind the
// centre, 1 to 3.8 m either side), hinge on a swept spanwise axis, and
// the model's own animation swings them between about 31 degrees up and
// 21 down, which is an A320 elevator's range.
//
// Pure. airliner_surfaces.js feeds it the aircraft's pitch and height
// and writes the deflection it returns onto the two nodes.
//
// WHAT AN ELEVATOR DOES ON AN APPROACH. Almost nothing while the
// aircraft is stable on the glide path: the trimmable stabiliser holds
// the attitude and the elevator sits near neutral. It moves visibly
// twice: trailing edge up for the flare, and a firm pull at a go-around.
//
// So two terms:
//
//   1. THE PITCH RATE, for deliberate manoeuvres. Nose rising, trailing
//      edge up. Behind a dead zone, because the attitude rig's nose
//      wanders by a degree or two as the path's climb rate varies, and
//      following that made the tail flap: replayed through the go-around
//      without the dead zone it swung from 8 down to 8 up in the climb
//      out. With it the climb out stays within about 3 and the rotation
//      still shows about 10. The nose-down side is softer and capped
//      low: arresting a rotation eases the elevator back, it does not
//      throw it down.
//
//   2. THE FLARE, by height. The rig's nose barely moves in the flare,
//      so a rate cannot see it. Trailing edge comes up over the last
//      15 m of a descent, as the pilot's back pressure does, and eases
//      back to neutral on the runway while the nose comes down.
//
// Sign: positive is trailing edge UP. The model's local hinge axis turns
// the trailing edge DOWN for a positive angle, measured on its vertices
// (scripts/check-airliner-elevator.mjs holds it), so the driver writes
// the negative.

export const ELEVATOR_CFG = {
  // Nose-up rate: degrees of trailing edge up per deg/s beyond the dead
  // zone. The rig caps pitch rate at 3 deg/s, so a go-around rotation
  // shows about 10 up.
  gainDegPerDegS: 7,
  // Nose-down rate, softer.
  downGainDegPerDegS: 2,
  deadbandDegS: 1.2,
  maxUpDeg: 15,
  maxDownDeg: 3,
  // The rate is filtered over this time constant before anything else.
  rateTauS: 1.0,
  // How fast the surface itself may move, degrees per second, and how
  // slowly it relaxes once the wheels are on the runway.
  slewDegS: 20,
  groundRelaxDegS: 2,
  // The flare: up to flareUpDeg, growing over the last flareFromAglM of
  // a descent.
  flareFromAglM: 15,
  flareUpDeg: 5,
  // Ignore the first seconds after a track appears, while the attitude
  // rig settles from its first frame onto the real flight path.
  settleS: 3,
};

/** One track's elevators. step() once per tick. */
export function createElevator(cfg = ELEVATOR_CFG) {
  let firstMs = null;
  let lastMs = null;
  let lastPitch = null;
  let lastAgl = null;
  let descending = false;
  let rate = 0;      // filtered nose-up rate, deg/s
  let defl = 0;      // trailing edge up, deg

  return {
    /**
     * @param pitchRad  the aircraft's pitch, nose up positive, radians
     * @param aglM      height above ground, metres
     * @param nowMs     milliseconds, same clock every call
     * @param on        false holds the surfaces neutral, which is the
     *                  model as it ships
     * @returns         deflection in degrees, trailing edge up positive
     */
    step(pitchRad, aglM, nowMs, on = true) {
      if (!on) { defl = 0; rate = 0; lastPitch = null; lastMs = nowMs; return 0; }
      if (typeof pitchRad !== 'number' || !Number.isFinite(pitchRad)) return defl;
      const pitchDeg = pitchRad * 180 / Math.PI;
      if (firstMs === null) firstMs = nowMs;
      const dt = lastMs === null ? 0 : Math.max(0, (nowMs - lastMs) / 1000);
      if (lastPitch !== null && dt > 0) {
        const q = (pitchDeg - lastPitch) / dt;
        rate += (q - rate) * Math.min(1, dt / cfg.rateTauS);
      }
      const hasAgl = typeof aglM === 'number' && Number.isFinite(aglM);
      const onGround = hasAgl && aglM <= 1.0;
      // Held while the height is not changing, so a paused flare keeps
      // its back pressure rather than easing off.
      if (hasAgl && lastAgl !== null && aglM !== lastAgl) descending = aglM < lastAgl;
      lastPitch = pitchDeg;
      lastMs = nowMs;
      if (hasAgl) lastAgl = aglM;

      let want = 0;
      if ((nowMs - firstMs) / 1000 >= cfg.settleS && !onGround) {
        const over = Math.max(0, Math.abs(rate) - cfg.deadbandDegS);
        want = rate >= 0 ? cfg.gainDegPerDegS * over : -cfg.downGainDegPerDegS * over;
        if (descending && aglM < cfg.flareFromAglM) {
          want += cfg.flareUpDeg * (1 - aglM / cfg.flareFromAglM);
        }
        want = Math.max(-cfg.maxDownDeg, Math.min(cfg.maxUpDeg, want));
      }
      const lim = (onGround ? cfg.groundRelaxDegS : cfg.slewDegS) * dt;
      defl = defl + Math.max(-lim, Math.min(lim, want - defl));
      // Snap the last hundredth onto neutral so it can come to rest.
      if (want === 0 && Math.abs(defl) < 0.01) defl = 0;
      return defl;
    },
  };
}
