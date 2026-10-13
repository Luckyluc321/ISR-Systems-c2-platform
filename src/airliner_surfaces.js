// Landing gear for the airliner, driven on the model primitive directly.
//
// THREE FAILED ATTEMPTS, and all three blamed the wrong thing. Running
// the model's animation froze the map; 48 skinned joints through
// nodeTransformations froze it; 118 extracted plain nodes froze it. The
// conclusion I kept drawing was "moving parts are expensive on this
// model". That was wrong.
//
// Reading Cesium rather than guessing: the model side is cheap. The
// ModelNode matrix setter only flags _userAnimationDirty, and
// ModelMatrixUpdateStage walks a node solely when _transformDirty,
// updating draw-command matrices. Nothing there justifies a freeze.
//
// The cost is the ENTITY PROPERTY LAYER above it. ModelGraphics
// nodeTransformations is a PropertyBag, and ModelVisualizer re-evaluates
// it EVERY FRAME while it is defined, then for all 48 entries does
//
//     Matrix4.fromTranslationRotationScale(...)   // allocate
//     modelNode.matrix = Matrix4.multiply(...)    // allocate, multiply
//
// whether or not anything changed. Assigning the bag also rebuilds 48
// properties and raises definitionChanged on each.
//
// So this bypasses it. Cesium keeps the Model primitive in the
// ModelVisualizer's own hash, and Model.getNode(name) is public, so the
// gear is driven by setting node matrices directly, only when the pose
// actually changes. Per-frame cost: zero. Per step: 48 matrix writes.
//
// That makes the motion as smooth as we like, because smoothness is no
// longer rationed against frame rate.

import { GEAR_UP_LOCAL } from './a320_gear_local.js';

/** Find the Model primitive Cesium built for an entity, or null while it
 *  is still loading. ModelVisualizer keeps it in _modelHash, keyed by
 *  entity id. Private, so every access is guarded: if the shape of this
 *  ever changes the gear simply stays down rather than throwing. */
function findModelPrimitive(viewer, entity) {
  try {
    const ds = viewer?.dataSourceDisplay;
    const buckets = [ds?.defaultDataSource, ...(ds?.dataSources?._dataSources || [])];
    for (const b of buckets) {
      for (const v of (b?._visualizers || [])) {
        const hash = v?._modelHash;
        const hit = hash && hash[entity.id];
        if (hit?.modelPrimitive?.getNode) return hit.modelPrimitive;
      }
    }
  } catch (_) { /* fall through: no gear rather than a broken tick */ }
  return null;
}

/**
 * Gear driver for one track.
 * @param extendBelowAglM  height above ground at which gear is selected
 * @param extendMs         travel time; a real A320 is 10 to 15 seconds
 */
export function createGearDriver(Cesium, viewer, {
  monoNow, extendBelowAglM = 300, extendMs = 12000,
} = {}) {
  let model = null;
  let t0 = null;          // when gear was selected down
  let applied = null;     // last fraction written, so we only write on change
  const scratch = new Cesium.Matrix4();

  // Precomputed delta per node: rest -> retracted.
  const parts = GEAR_UP_LOCAL.map(n => ({
    node: n.node,
    t: new Cesium.Cartesian3(n.t[0], n.t[1], n.t[2]),
    r: new Cesium.Quaternion(n.r[0], n.r[1], n.r[2], n.r[3]),
    s: new Cesium.Cartesian3(n.s[0], n.s[1], n.s[2]),
  }));
  const ONE = new Cesium.Cartesian3(1, 1, 1);
  const IDENT = new Cesium.Quaternion(0, 0, 0, 1);

  function write(entity, f) {
    if (!model) model = findModelPrimitive(viewer, entity);
    if (!model) return false;               // not built yet, try next tick
    const T = new Cesium.Cartesian3();
    const S = new Cesium.Cartesian3();
    const R = new Cesium.Quaternion();
    // FINDING THE MODEL IS NOT THE SAME AS IT BEING READY. Model.getNode
    // THROWS until the glTF has loaded, and the primitive exists well
    // before that. Counting actual writes is the difference between
    // "applied" and "found something and wrote to nothing", and getting
    // that wrong is why the aircraft kept starting with its wheels out:
    // the first call found the model, silently wrote nothing, recorded
    // success, and the change guard then blocked every retry.
    let written = 0;
    for (const p of parts) {
      let node;
      try { node = model.getNode(p.node); } catch (_) { node = null; }
      if (!node) continue;
      Cesium.Cartesian3.lerp(p.t, Cesium.Cartesian3.ZERO, f, T);
      Cesium.Cartesian3.lerp(p.s, ONE, f, S);
      Cesium.Quaternion.slerp(p.r, IDENT, f, R);
      // Same composition ModelVisualizer uses: the node's ORIGINAL local
      // matrix times the delta. A node transform is a delta, not a pose.
      Cesium.Matrix4.fromTranslationQuaternionRotationScale(T, R, S, scratch);
      node.matrix = Cesium.Matrix4.multiply(
        node.originalMatrix, scratch, new Cesium.Matrix4());
      written++;
    }
    return written > 0;
  }

  return {
    /** Call from the tick with height above ground. */
    update(entity, aglM) {
      if (t0 === null && typeof aglM === 'number' && aglM > 0 && aglM <= extendBelowAglM) {
        t0 = monoNow();
      }
      const f = t0 === null ? 0 : Math.min(1, (monoNow() - t0) / extendMs);
      // Write only on a real change, and keep retrying 0 until the model
      // finishes loading, otherwise it renders in its rest pose, which
      // for this asset is gear DOWN.
      if (applied !== null && Math.abs(f - applied) < 0.002) return;
      if (write(entity, f)) applied = f;
    },
  };
}
