// Landing gear for the airliner, applied in discrete steps.
//
// THE PROBLEM, measured three times. This model's REST pose is the
// landed configuration, so with its animation off the gear is
// permanently down, including at 500 m on approach. Driving it costs:
// running the model's own animation froze the map, 48 skinned joints
// driven every frame froze it, and 118 plain nodes driven every frame
// froze it too. The cost is not the node count and not whether they are
// skin joints. It is that Cesium re-applies and re-dirties EVERY frame:
//
//     modelNode.matrix = Matrix4.multiply(
//         modelNode.originalMatrix, transformationMatrix, ...)
//
// THE WAY OUT is in the line above that one:
//
//     if (defined(nodeTransformations)) { ...apply... }
//
// There is no else. When the property is undefined Cesium skips the
// loop and does NOT restore anything, so a transform applied once stays
// applied, for free, forever.
//
// So the gear moves in discrete steps. Each step assigns a plain
// transform, holds it a few frames so the visualizer picks it up, then
// clears the property. Across a 195 s flight that is about 2 seconds of
// work in total instead of 195.
//
// It also means the extracted rigid model is not needed: this drives the
// ordinary skinned joints of a320_hq.glb, which is the known-good asset.

import { GEAR_UP_LOCAL } from './a320_gear_local.js';

/**
 * One gear pose as PLAIN values, not CallbackProperties.
 * @param f 0 = retracted, 1 = down and locked (the model's own rest pose)
 */
export function gearPose(Cesium, f) {
  const out = {};
  const ONE = new Cesium.Cartesian3(1, 1, 1);
  const IDENT = new Cesium.Quaternion(0, 0, 0, 1);
  const t = Math.min(1, Math.max(0, f));
  for (const n of GEAR_UP_LOCAL) {
    out[n.node] = {
      translation: Cesium.Cartesian3.lerp(
        new Cesium.Cartesian3(n.t[0], n.t[1], n.t[2]),
        Cesium.Cartesian3.ZERO, t, new Cesium.Cartesian3()),
      scale: Cesium.Cartesian3.lerp(
        new Cesium.Cartesian3(n.s[0], n.s[1], n.s[2]),
        ONE, t, new Cesium.Cartesian3()),
      rotation: Cesium.Quaternion.slerp(
        new Cesium.Quaternion(n.r[0], n.r[1], n.r[2], n.r[3]),
        IDENT, t, new Cesium.Quaternion()),
    };
  }
  return out;
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
  };
}
