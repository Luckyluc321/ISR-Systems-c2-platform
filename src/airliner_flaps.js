// Slats and flaps for the airliner: which setting the crew has selected,
// and where the surfaces are on their way to it.
//
// Pure. No Cesium, no clock of its own: airliner_surfaces.js feeds it
// height above ground and the time, and writes the two fractions it
// returns onto the model. That keeps the schedule testable on its own
// (scripts/check-airliner-flaps.mjs).
//
// THE SETTINGS. A320 flap lever positions, slat and flap angles in
// degrees (FlyByWire A32NX documentation, which follows the FCOM):
//
//   lever   slats   flaps
//   0         0       0
//   1        18       0     in flight; 1+F with 10 of flap is take-off only
//   2        22      15
//   3        22      20
//   FULL     27      40
//
// Written as fractions of FULL, because the model's own animation has
// one extended pose and a320_rigid_flaps.js stores the travel towards it.
//
// THE APPROACH. Selected on the way down by height above ground. 1 and 2
// where a real approach selects them (about 3,300 and 2,100 ft). The
// gear comes down at 300 m in airliner_surfaces.js, and on a real A320
// the gear goes down before 3 and FULL, so those follow it: 3 at 250 m,
// once the gear is locked, and FULL at 200 m, fully out by about 150 m,
// inside the 500 ft gate for a stabilised visual approach.
//
// THE GO-AROUND. TOGA and "flaps one step up" happen together, so the
// selection drops one step as soon as the aircraft climbs. Then the
// normal clean-up once it has accelerated: 1 at 450 m (about the 1,500 ft
// acceleration altitude), 0 at 600 m. Never back out after that: these
// routes fly one approach each.

export const FLAP_CONFIGS = [
  { name: '0',    slat: 0,       flap: 0 },
  { name: '1',    slat: 18 / 27, flap: 0 },
  { name: '2',    slat: 22 / 27, flap: 15 / 40 },
  { name: '3',    slat: 22 / 27, flap: 20 / 40 },
  { name: 'FULL', slat: 1,       flap: 1 },
];

export const FLAP_CFG = {
  // Lever position i is selected at or below selectBelowAglM[i] metres.
  selectBelowAglM: [Infinity, 1000, 650, 250, 200],
  // A climb this far above the lowest point is a go-around. The gear
  // waits for 80 m, a positive rate of climb; the lever moves at TOGA.
  goAroundClimbM: 20,
  // Clean-up on the climb out.
  retractTo1AboveAglM: 450,
  retractTo0AboveAglM: 600,
  // Full travel times. Slats 0 to 18 degrees takes about 13 s, flaps
  // 20 to 40 about 12 s, in the range a real A320 takes per selection.
  slatTravelS: 20,
  flapTravelS: 25,
};

/** The lever position a descending aircraft at this height has selected. */
export function scheduledConfig(aglM, cfg = FLAP_CFG) {
  for (let i = cfg.selectBelowAglM.length - 1; i > 0; i--) {
    if (aglM <= cfg.selectBelowAglM[i]) return i;
  }
  return 0;
}

const _toward = (v, target, maxStep) =>
  v < target ? Math.min(target, v + maxStep) : Math.max(target, v - maxStep);

/**
 * One track's flaps. step() once per tick.
 *
 * The first step after creation, or after the switch comes back on,
 * puts the surfaces straight at the setting for that height: an aircraft
 * that appears at 530 m on final already has flaps 2 out, it does not
 * start extending them in front of the camera.
 */
export function createFlapSchedule(cfg = FLAP_CFG) {
  let lever = null;        // selected position, index into FLAP_CONFIGS
  let slat = 0, flap = 0;  // where the surfaces are, 0 to 1 of FULL
  let lastMs = null;
  let minAgl = null;
  let goneAround = false;

  return {
    /**
     * @param aglM   height above ground, metres
     * @param nowMs  milliseconds, same clock every call
     * @param on     false holds the wing clean, which is the model as it
     *               ships and how every airliner flew before this
     */
    step(aglM, nowMs, on = true) {
      if (!on) {
        lever = null; slat = 0; flap = 0; lastMs = nowMs;
        return { slat, flap, lever: '0' };
      }
      if (typeof aglM !== 'number' || !Number.isFinite(aglM)) {
        return { slat, flap, lever: lever == null ? '0' : FLAP_CONFIGS[lever].name };
      }
      minAgl = minAgl === null ? aglM : Math.min(minAgl, aglM);
      if (lever === null) {
        lever = goneAround ? 0 : scheduledConfig(aglM, cfg);
        slat = FLAP_CONFIGS[lever].slat;
        flap = FLAP_CONFIGS[lever].flap;
        lastMs = nowMs;
        return { slat, flap, lever: FLAP_CONFIGS[lever].name };
      }
      if (!goneAround && aglM > minAgl + cfg.goAroundClimbM) {
        goneAround = true;
        lever = Math.max(0, lever - 1);
      }
      if (goneAround) {
        if (aglM >= cfg.retractTo0AboveAglM) lever = 0;
        else if (aglM >= cfg.retractTo1AboveAglM) lever = Math.min(lever, 1);
      } else {
        // Only ever further out on the way down: a few metres of
        // ballooning above a threshold is not a reason to retract.
        lever = Math.max(lever, scheduledConfig(aglM, cfg));
      }
      const dt = Math.max(0, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      slat = _toward(slat, FLAP_CONFIGS[lever].slat, dt / cfg.slatTravelS);
      flap = _toward(flap, FLAP_CONFIGS[lever].flap, dt / cfg.flapTravelS);
      return { slat, flap, lever: FLAP_CONFIGS[lever].name };
    },
  };
}
