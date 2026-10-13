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

// Rest transform and deployment axis per node, measured from the file.
// The axis is the rotation RELATIVE to the node's rest pose, so the
// deployed orientation is axisAngle(axis, 73.3 deg * f) * rest.
const AIRBRAKES = [
  { node: 'AirBrake.L_084',
    t: [-0.01863, -1.50380, -9.77312], s: [1, 1, 1],
    r: [-0.663199, 0.091592, 0.725048, -0.161506],
    axis: [0.068, 0.356, 0.932] },
  { node: 'AirBrake2.L_085',
    t: [0.35798, -0.22827, -5.45902], s: [1.00001, 1, 1],
    r: [-0.666001, -0.043078, 0.743776, -0.037195],
    axis: [-0.110, 0.002, -0.994] },
  { node: 'AirBrake.R_086',
    t: [-0.01863, -1.50380, 9.77312], s: [1, 1, 1],
    r: [0.725048, 0.161505, -0.663199, -0.091592],
    axis: [-0.068, -0.356, 0.932] },
  { node: 'AirBrake2.R_087',
    t: [0.35798, -0.22827, 5.45902], s: [1.00001, 1, 1],
    r: [0.743776, 0.037196, -0.666001, 0.043078],
    axis: [0.110, -0.002, -0.994] },
];

const FULL_DEFLECTION_DEG = 73.3;

/**
 * nodeTransformations for the airbrakes.
 *
 * @param Cesium   the Cesium namespace
 * @param deployed () => number in 0..1, how far the brakes are out
 */
export function airbrakeTransforms(Cesium, deployed) {
  const out = {};
  for (const b of AIRBRAKES) {
    // TRANSLATION AND SCALE MUST BE EXPLICIT. Cesium's
    // NodeTransformationProperty.getValue falls back to Cartesian3.ZERO
    // for an unspecified translation, NOT to the node's own value, so a
    // rotation-only transform would teleport the panel to the model
    // origin and swing it in a 10 m arc.
    const rest = new Cesium.Quaternion(b.r[0], b.r[1], b.r[2], b.r[3]);
    const axis = new Cesium.Cartesian3(b.axis[0], b.axis[1], b.axis[2]);
    Cesium.Cartesian3.normalize(axis, axis);
    out[b.node] = {
      translation: new Cesium.Cartesian3(b.t[0], b.t[1], b.t[2]),
      scale: new Cesium.Cartesian3(b.s[0], b.s[1], b.s[2]),
      rotation: new Cesium.CallbackProperty(() => {
        const f = Math.min(1, Math.max(0, deployed() || 0));
        if (f <= 0) return Cesium.Quaternion.clone(rest, new Cesium.Quaternion());
        const q = Cesium.Quaternion.fromAxisAngle(
          axis, (FULL_DEFLECTION_DEG * Math.PI / 180) * f, new Cesium.Quaternion());
        return Cesium.Quaternion.multiply(q, rest, new Cesium.Quaternion());
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
