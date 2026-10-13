// Moving control surfaces for the airliner, driven node by node.
//
// WHY NOT JUST RUN THE MODEL'S ANIMATION. Because it costs seconds per
// frame. The asset is 190 nodes with a 142-joint skin over 75,815
// vertices, and advancing that every frame is what made the map freeze.
// Note also that Cesium's ModelVisualizer reads runAnimations with
// Property.getValueOrDefault(..., time, TRUE), so OMITTING the property
// runs the animation; it has to be set to false explicitly.
//
// WHY THIS IS SAFE WHERE A PREVIOUS ATTEMPT TORE THE AIRCRAFT APART.
// These are skeleton joints, and overriding a subset of a skin normally
// breaks it: the previous attempt drove 83 of 248 joints and scattered
// wings and gear around the fuselage. The airbrakes are the exception,
// and it is measured rather than hoped for. Of the vertices touching an
// airbrake joint:
//
//     140 vertices touch an airbrake joint
//     140 are weighted ONLY to airbrake joints
//       0 are shared with anything else
//
// So moving these four nodes moves exactly those 140 vertices and
// nothing else in the mesh can follow them.
//
// EVERY NUMBER HERE IS READ OUT OF THE GLB. The rest transforms are the
// nodes' own, and the deployment is the artist's: all four rotate 73.3
// degrees, starting 1.56 s after the animation's own touchdown and
// reaching full deflection 1.2 s later. That is real behaviour. Ground
// spoilers are armed on approach and deploy automatically on wheel
// spin-up, in about a second.

// A NODE TRANSFORM IS A DELTA, NOT A POSE. This is what I got wrong the
// first time, and Cesium's own code says so plainly:
//
//     modelNode.matrix = Matrix4.multiply(
//         modelNode.originalMatrix,   // the node's REST transform
//         transformationMatrix,       // what we supply here
//         ... )
//
// It MULTIPLIES onto the rest transform rather than replacing it. I
// supplied each node's own translation and rotation again, so both were
// applied twice and the panels flew off into open air. The Mi-24 rotor
// block in main.js passes Cartesian3.ZERO and scale (1,1,1) for exactly
// this reason: those are the IDENTITY delta, not a claim that the node
// has no translation of its own.
//
// So translation and scale stay at identity, and the only thing supplied
// is the rotation from rest to deployed, measured straight out of the
// GLB as rel = q_deployed * inverse(q_rest) and stored as a quaternion so
// no axis or angle sign has to be re-derived. All four reach 73.3 degrees
// at t=24.67s, which is 2.8 s after the clip's own touchdown.
const AIRBRAKES = [
  { node: 'AirBrake.L_084',  rel: [-0.040694, -0.212339, -0.556460, 0.802252] },
  { node: 'AirBrake2.L_085', rel: [-0.065739,  0.001224, -0.593352, 0.802253] },
  { node: 'AirBrake.R_086',  rel: [ 0.040694,  0.212340, -0.556460, 0.802252] },
  { node: 'AirBrake2.R_087', rel: [ 0.065738, -0.001223, -0.593351, 0.802254] },
];

/**
 * nodeTransformations for the airbrakes.
 *
 * @param Cesium   the Cesium namespace
 * @param deployed () => number in 0..1, how far the brakes are out
 */
export function airbrakeTransforms(Cesium, deployed) {
  const out = {};
  const identity = new Cesium.Quaternion(0, 0, 0, 1);
  for (const b of AIRBRAKES) {
    const full = new Cesium.Quaternion(b.rel[0], b.rel[1], b.rel[2], b.rel[3]);
    out[b.node] = {
      // Identity delta. See the note above: NOT the node's own values.
      translation: Cesium.Cartesian3.ZERO,
      scale: new Cesium.Cartesian3(1, 1, 1),
      rotation: new Cesium.CallbackProperty(() => {
        const f = Math.min(1, Math.max(0, deployed() || 0));
        if (f <= 0) return Cesium.Quaternion.clone(identity, new Cesium.Quaternion());
        if (f >= 1) return Cesium.Quaternion.clone(full, new Cesium.Quaternion());
        // Slerp from identity, so the panel sweeps through the real arc
        // rather than through whatever a decomposed axis would give.
        return Cesium.Quaternion.slerp(identity, full, f, new Cesium.Quaternion());
      }, false),
    };
  }
  return out;
}

/**
 * Deployment fraction over time. Ground spoilers are armed on approach
 * and fire on wheel spin-up, so this is a touchdown event, not an
 * altitude ramp: nothing moves until the wheels are down, then the
 * panels are fully out in just over a second and stay there.
 *
 * Returns a closure to hand to airbrakeTransforms.
 */
export function createAirbrakeState({ monoNow, deployMs = 1200, triggerAglM = 0.6 }) {
  let t0 = null;
  return {
    /** Call from the tick with the current height above ground. */
    update(aglM) {
      if (t0 === null && typeof aglM === 'number' && aglM <= triggerAglM) {
        t0 = monoNow();
      }
    },
    fraction() {
      if (t0 === null) return 0;
      return Math.min(1, (monoNow() - t0) / deployMs);
    },
    reset() { t0 = null; },
  };
}

// ── Landing gear ──────────────────────────────────────────────────────
//
// This model's REST pose is the landed configuration, so with the
// animation off the gear is permanently down, including at 500 m on
// approach. Measured earlier: only 5 of the animation's 248 channels
// differ between its final frame and the bind pose.
//
// The retracted pose is the animation's t=0, and src/a320_gear_up.js
// holds the delta from rest to that, generated from the GLB. 48 nodes
// carry a real delta, against 4 for the airbrakes, because the gear rig
// is FLAT: 96 nodes across 28 roots, every hinge and door parented
// straight to the fuselage rather than nested under a strut, so there is
// no three-node shortcut.
//
// Translation and scale are interpolated as well as rotation, not just
// rotation like the airbrakes: the nose mechanism translates 1.57 m and
// a strut telescopes by a scale factor of 0.59.

import { GEAR_UP_DELTA } from './a320_gear_up.js';

/**
 * nodeTransformations for the gear.
 * @param extended () => number, 0 = fully retracted, 1 = down and locked
 */
export function gearTransforms(Cesium, extended) {
  const out = {};
  const ONE = new Cesium.Cartesian3(1, 1, 1);
  const IDENT = new Cesium.Quaternion(0, 0, 0, 1);
  for (const n of GEAR_UP_DELTA) {
    const upT = new Cesium.Cartesian3(n.t[0], n.t[1], n.t[2]);
    const upR = new Cesium.Quaternion(n.r[0], n.r[1], n.r[2], n.r[3]);
    const upS = new Cesium.Cartesian3(n.s[0], n.s[1], n.s[2]);
    const f = () => Math.min(1, Math.max(0, extended() ?? 1));
    out[n.node] = {
      // Interpolating TOWARD identity, because identity is the model as
      // it ships, which is gear down.
      translation: new Cesium.CallbackProperty(() => Cesium.Cartesian3.lerp(
        upT, Cesium.Cartesian3.ZERO, f(), new Cesium.Cartesian3()), false),
      scale: new Cesium.CallbackProperty(() => Cesium.Cartesian3.lerp(
        upS, ONE, f(), new Cesium.Cartesian3()), false),
      rotation: new Cesium.CallbackProperty(() => Cesium.Quaternion.slerp(
        upR, IDENT, f(), new Cesium.Quaternion()), false),
    };
  }
  return out;
}

/**
 * Gear extension over time. A real A320 selects gear down passing about
 * 2000 ft, roughly 7 to 9 km out, and it takes some seconds to travel
 * and lock. This approach starts at 10 km and 530 m, so the default
 * threshold puts the sequence early in the shot where it is visible
 * rather than already finished before the camera sees anything.
 */
export function createGearState({ monoNow, extendBelowAglM = 450, extendMs = 9000 }) {
  let t0 = null;
  return {
    update(aglM) {
      if (t0 === null && typeof aglM === 'number'
          && aglM > 0 && aglM <= extendBelowAglM) {
        t0 = monoNow();
      }
    },
    fraction() {
      if (t0 === null) return 0;          // up, until the trigger
      return Math.min(1, (monoNow() - t0) / extendMs);
    },
    reset() { t0 = null; },
  };
}
