// Moving surfaces for the airliner: landing gear and airbrakes.
//
// WHY NOT THE MODEL'S OWN ANIMATION. It costs seconds per frame. The
// asset is 190 nodes with a 142-joint skin over 75,815 vertices, and
// advancing that every frame froze the map. Note also that Cesium's
// ModelVisualizer reads runAnimations with
// Property.getValueOrDefault(..., time, TRUE), so OMITTING the property
// runs the animation. It has to be set to false explicitly.
//
// WHY NOT DRIVE THE JOINTS EITHER. Measured: 4 joints (the airbrakes)
// was fine, 48 (the gear) put the frame rate on the floor. Touching a
// skeleton joint makes Cesium re-evaluate the skin, and that cost scales
// with the skin, not with how many joints you moved.
//
// SO THE PARTS ARE NOT JOINTS ANY MORE. scripts/split_airliner_surfaces.py
// lifts them out of the skin into plain nodes, which is the same trick
// scripts/split_quad_rotors.py plays on the quadcopter's blades and why
// the Mi-24's rotors spin every frame for free. It is sound here because
// every one of the 51,140 vertices riding those joints is weighted 1.000
// to exactly ONE of them: they are rigid bodies wearing a skin they do
// not need. 118 nodes, 77,672 triangles, and only 6 triangles in the
// whole model span two joints and had to stay behind.
//
// A part can appear in several meshes with different materials, so one
// joint drives SEVERAL nodes. The manifests carry that mapping.

import { RIGID_PARTS as GEAR_UP } from './a320_rigid_gearup.js';
import { RIGID_PARTS as BRAKES_OUT } from './a320_rigid_brakes.js';

const isBrake = (joint) => /AirBrake/i.test(joint);

/**
 * nodeTransformations for every extracted part.
 *
 * Cesium applies these as node.matrix = originalMatrix * yours, and the
 * original matrix each extracted node carries IS its bind global, so
 * these are deltas from where the part sits in the shipped model.
 *
 * @param gear   () => 0..1, 0 = retracted, 1 = down and locked
 * @param brakes () => 0..1, 0 = stowed, 1 = fully deployed
 */
export function rigidTransforms(Cesium, { gear, brakes }) {
  const out = {};
  const ONE = new Cesium.Cartesian3(1, 1, 1);
  const IDENT = new Cesium.Quaternion(0, 0, 0, 1);
  const clamp = (v) => Math.min(1, Math.max(0, v || 0));

  const attach = (nodes, t, r, s, frac, towardIdentity) => {
    const dT = new Cesium.Cartesian3(t[0], t[1], t[2]);
    const dR = new Cesium.Quaternion(r[0], r[1], r[2], r[3]);
    const dS = new Cesium.Cartesian3(s[0], s[1], s[2]);
    for (const node of nodes) {
      out[node] = {
        translation: new Cesium.CallbackProperty(() => {
          const f = clamp(frac());
          return towardIdentity
            ? Cesium.Cartesian3.lerp(dT, Cesium.Cartesian3.ZERO, f, new Cesium.Cartesian3())
            : Cesium.Cartesian3.lerp(Cesium.Cartesian3.ZERO, dT, f, new Cesium.Cartesian3());
        }, false),
        scale: new Cesium.CallbackProperty(() => {
          const f = clamp(frac());
          return towardIdentity
            ? Cesium.Cartesian3.lerp(dS, ONE, f, new Cesium.Cartesian3())
            : Cesium.Cartesian3.lerp(ONE, dS, f, new Cesium.Cartesian3());
        }, false),
        rotation: new Cesium.CallbackProperty(() => {
          const f = clamp(frac());
          return towardIdentity
            ? Cesium.Quaternion.slerp(dR, IDENT, f, new Cesium.Quaternion())
            : Cesium.Quaternion.slerp(IDENT, dR, f, new Cesium.Quaternion());
        }, false),
      };
    }
  };

  // GEAR: the manifest holds the RETRACTED pose, and identity is the
  // model as it ships, which is gear down. So extension runs the delta
  // toward identity.
  for (const p of GEAR_UP) {
    if (isBrake(p.joint)) continue;
    attach(p.nodes, p.t, p.r, p.s, gear, true);
  }
  // AIRBRAKES: identity is stowed and the manifest holds the deployed
  // pose, so this runs the other way.
  for (const p of BRAKES_OUT) {
    if (!isBrake(p.joint)) continue;
    attach(p.nodes, p.t, p.r, p.s, brakes, false);
  }
  return out;
}

/** Ground spoilers are armed on approach and fire on wheel spin-up, so
 *  this is a touchdown event rather than an altitude ramp. */
export function createAirbrakeState({ monoNow, deployMs = 1200, triggerAglM = 0.6 }) {
  let t0 = null;
  return {
    update(aglM) {
      if (t0 === null && typeof aglM === 'number' && aglM <= triggerAglM) t0 = monoNow();
    },
    fraction() { return t0 === null ? 0 : Math.min(1, (monoNow() - t0) / deployMs); },
    reset() { t0 = null; },
  };
}

/** A real A320 selects gear down passing about 2000 ft, 7 to 9 km out.
 *  This approach starts at 10 km and 530 m, so the default puts the
 *  sequence early in the shot where it can be seen. */
export function createGearState({ monoNow, extendBelowAglM = 450, extendMs = 9000 }) {
  let t0 = null;
  return {
    update(aglM) {
      if (t0 === null && typeof aglM === 'number' && aglM > 0 && aglM <= extendBelowAglM) {
        t0 = monoNow();
      }
    },
    fraction() { return t0 === null ? 0 : Math.min(1, (monoNow() - t0) / extendMs); },
    reset() { t0 = null; },
  };
}
