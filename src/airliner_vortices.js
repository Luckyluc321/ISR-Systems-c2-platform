// Wingtip vortices for the airliner.
//
// WHAT THIS DRAWS, and what it does not. A heavy aircraft on short final
// at high angle of attack drags two condensation cores off its wingtips.
// That is the read that says "real aircraft, heavy, humid air" in a
// second of footage. It is NOT the sheet of vapour that forms over the
// wing root, which is a volume sitting on the wing rather than a trail
// behind it, and which a polyline cannot express. That needs a particle
// system, and a particle system advances on viewer.clock rather than on
// the simulation clock, so it would keep emitting while the simulation
// is paused. Deliberately not built until something asks for it.
//
// Mechanism is the one already in this codebase: a polyline whose
// positions come from a CallbackProperty over a ring buffer. Nothing new
// to reason about, and it freezes when the simulation freezes because the
// samples are only appended from the tick.
//
// THE OFFSETS ARE MEASURED, not guessed. From the model's own vertices
// (75,815 of them, bind pose): the wingtips sit at X +/- 17.009,
// Y 4.298, Z 4.550, and the span is 34.115 m against the real A320's
// 34.1 m. The nose is on model -Z, so in body terms a wingtip is 4.550 m
// AFT of the origin and 4.298 m above it.

import { monoNow } from './sim_clock.js';

// Body-frame offset of a wingtip, in metres.
//   forward  +ve toward the nose
//   side     +ve to PORT, the aircraft's left   (same sign convention as
//            _muzzleOffsetFor in main.js, so the rotation below matches
//            the one that was finally made to work on the helicopter gun)
//   up       +ve above the model origin
const TIP = { forward: -4.55, side: 17.009, up: 4.298 };

// FAR SUBTLER THAN THE FIRST ATTEMPT. Width 7 at half alpha over 154 m,
// starting 400 m up, did not read as condensation. It read as two big
// white streaks, which is worse than drawing nothing. Vapour is thin,
// short, faint, and only appears when the aircraft is low and working.
const DEFAULTS = {
  enabled: false,     // explicit opt-in; see the gate in main.js
  seconds: 1.1,       // ~77 m at 70 m/s, about two fuselage lengths
  sampleMs: 45,
  width: 2.5,
  glowPower: 0.1,
  alpha: 0.22,
  // Low and working, which is the last few hundred metres, not the
  // whole approach.
  fadeFromAglM: 120,
  fullAglM: 25,
};

export function createWingVortices(viewer, Cesium) {
  const tracks = new Map();

  function tune() {
    return { ...DEFAULTS, ...(typeof window !== 'undefined'
      ? (window.__isr_vortex_tuning || {}) : {}) };
  }

  // A point bolted to the airframe has to be rotated by the airframe's
  // FULL attitude, roll then pitch then heading. Applying it in the world
  // horizontal plane is what put the helicopter's tracer rounds behind
  // the gunner's head: a point 17 m out to the side moves 4.4 m
  // vertically through a 15 degree bank.
  function tipWorld(cart, heading, pitch, roll, side, T) {
    const fwd = T.forward, up = T.up;
    // Positive roll drops the right wing, so a point to PORT rises.
    const sR = side * Math.cos(roll) - up * Math.sin(roll);
    const uR = up * Math.cos(roll) + side * Math.sin(roll);
    // Positive pitch is nose up, so a point FORWARD rises.
    const fP = fwd * Math.cos(pitch) - uR * Math.sin(pitch);
    const uP = uR * Math.cos(pitch) + fwd * Math.sin(pitch);
    // Heading's unit vector is (sin, cos) in (east, north). A quarter
    // turn anticlockwise gives port: (-cos, sin).
    const dEast  = Math.sin(heading) * fP + -Math.cos(heading) * sR;
    const dNorth = Math.cos(heading) * fP +  Math.sin(heading) * sR;

    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(cart);
    const out = Cesium.Cartesian3.clone(cart, new Cesium.Cartesian3());
    const add = (ix, scale) => {
      const v = new Cesium.Cartesian3(enu[ix], enu[ix + 1], enu[ix + 2]);
      Cesium.Cartesian3.multiplyByScalar(v, scale, v);
      Cesium.Cartesian3.add(out, v, out);
    };
    add(0, dEast);    // east
    add(4, dNorth);   // north
    add(8, uP);       // up
    return out;
  }

  function ensure(id) {
    let t = tracks.get(id);
    if (t) return t;
    const left = [], right = [];
    const cfg = tune();
    const mat = () => new Cesium.PolylineGlowMaterialProperty({
      glowPower: cfg.glowPower,
      color: new Cesium.CallbackProperty(
        () => Cesium.Color.WHITE.withAlpha((tracks.get(id)?.strength || 0) * tune().alpha),
        false),
    });
    const mk = (suffix, buf) => viewer.entities.add({
      id: `airliner-vortex-${suffix}-${id}`,
      polyline: {
        positions: new Cesium.CallbackProperty(() => buf, false),
        width: cfg.width,
        material: mat(),
        // Never draped. These are in the air, by definition.
        clampToGround: false,
      },
    });
    t = { left, right, strength: 0, lastMs: 0,
          entities: [mk('l', left), mk('r', right)] };
    tracks.set(id, t);
    return t;
  }

  return {
    // Called from the drone tick, once per update, with the aircraft's
    // current position and world-semantic attitude.
    step(id, cart, attitude, aglM) {
      if (!cart || !attitude) return;
      const T = tune();
      const t = ensure(id);
      // Fade with height rather than switching on, so it arrives as the
      // aircraft comes down instead of popping.
      const span = Math.max(1, T.fadeFromAglM - T.fullAglM);
      t.strength = Math.min(1, Math.max(0,
        (T.fadeFromAglM - (aglM ?? 0)) / span));
      const now = monoNow();
      if (now - t.lastMs < T.sampleMs) return;
      t.lastMs = now;
      const cap = Math.max(2, Math.round((T.seconds * 1000) / T.sampleMs));
      const tip = { forward: T.forward ?? TIP.forward,
                    side: T.side ?? TIP.side, up: T.up ?? TIP.up };
      t.left.push(tipWorld(cart, attitude.heading, attitude.pitch,
        attitude.roll, tip.side, tip));
      t.right.push(tipWorld(cart, attitude.heading, attitude.pitch,
        attitude.roll, -tip.side, tip));
      while (t.left.length > cap) t.left.shift();
      while (t.right.length > cap) t.right.shift();
    },
    release(id) {
      const t = tracks.get(id);
      if (!t) return;
      t.entities.forEach(e => viewer.entities.remove(e));
      tracks.delete(id);
    },
    destroy() { for (const id of [...tracks.keys()]) this.release(id); },
  };
}
