// ═══════════════════════════════════════════════════════════════════
// The Baykar's propeller: the builder's clip, on the file's throttle
// ───────────────────────────────────────────────────────────────────
// The asset carries its own propeller animation: one clip, 2 channels
// on node SivriSinekIhaV2_Pervane, 46 keys over 0.92 s, unskinned. It
// is better than anything written by hand, and Lucas was right to stop
// me rebuilding it.
//
// But a clip plays at one rate, and a propeller does not. The whole
// point of the throttle model is that the prop rises on the climb and
// the fast pass and falls when the aircraft slows, which is what
// scripts/blender_fixedwing_flight_demo.py renders.
//
// Note what that file does about this exact conflict, in its own words:
//
//     # The file's own animation (this one carries a propeller clip)
//     # would fight the hub we drive. Drop it; the propeller is ours now.
//
// Blender deletes the clip and spins the hub itself. We can do better,
// because Cesium lets a clip's time be supplied rather than advanced:
// `animationTime` is called every frame and its return value IS the
// normalised position within the clip. So the geometry and motion stay
// the builder's, and the RATE becomes the flight model's.
//
// Two consequences worth stating.
//
// First, this needs no clock. ModelAnimationCollection.update() returns
// early when frameState.time has not moved, UNLESS animateWhilePaused
// is set, and `delta` comes from our callback rather than from elapsed
// scene time. So the propeller spins with viewer.clock frozen, and the
// clock borrow this replaced is gone: no sun movement, nothing global
// touched. It also means the propeller cannot drift with the sim clock.
//
// Second, it has to be done on the Model primitive, because the entity
// layer cannot express it: ModelVisualizer hardcodes
// `addAll({ loop: REPEAT })` and offers no multiplier, no
// animationTime, no animateWhilePaused. `multiplier` would not have
// been enough anyway, since ModelAnimation exposes it get-only and
// caches a duration from it on first use.
//
// The entity must therefore declare `runAnimations: false`, which makes
// ModelVisualizer call removeAll() once and then leave the collection
// alone for good (it only acts when the value CHANGES). We add our own
// afterwards. Ordering between that pass and ours is not assumed: the
// wiring re-checks every frame and re-applies itself if the collection
// ever comes back empty.
// ═══════════════════════════════════════════════════════════════════
import { findModelPrimitive } from './airliner_surfaces.js';

const TAU = 2 * Math.PI;

/**
 * Drive one fixed-wing's propeller clip from its flight model.
 *
 * @param Cesium        the namespace, passed in as everything here does
 * @param viewer        for finding the Model primitive behind the entity
 * @param phaseRad      () => the model's integrated propeller angle, rad
 * @returns {{update:(entity:object)=>boolean, wired:boolean, diag:()=>object}}
 */
export function createPropellerDriver(Cesium, viewer, { phaseRad } = {}) {
  let wired = false;
  let model = null;
  let attempts = 0;
  let lastErr = null;

  // The glTF is 3 MB and loads in well under a second, but a failed
  // wire must not retry forever on a model that will never animate.
  // 1800 frames is about 30 seconds at 60 fps.
  const MAX_ATTEMPTS = 1800;

  function wire(entity) {
    model = findModelPrimitive(viewer, entity);
    if (!model || !model.ready) return false;
    const anims = model.activeAnimations;
    if (!anims) return false;
    // addAll THROWS before the glTF has loaded, and `ready` is checked
    // above, but the guard stays: a propeller that does not spin is a
    // great deal better than a tick that throws every frame.
    try {
      anims.removeAll();
      // Bypasses the "has the scene clock moved" early-out, which is
      // what kept this still while viewer.clock is pinned for the sun.
      anims.animateWhilePaused = true;
      anims.addAll({
        loop: Cesium.ModelAnimationLoop.REPEAT,
        // Returns normalised clip position. Cesium truncates with
        // delta - floor(delta) for a REPEAT loop, so an ever-growing
        // phase wraps on its own and never needs resetting.
        animationTime: () => (phaseRad ? phaseRad() : 0) / TAU,
      });
      return anims.length > 0;
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
      return false;
    }
  }

  return {
    /** Call once a frame from the tick. Cheap after it has taken. */
    update(entity) {
      if (!entity) return wired;
      // Self-healing rather than order-dependent: if ModelVisualizer's
      // own pass cleared the collection after we filled it, fill it
      // again. A length check is all this costs per frame.
      if (wired && model && model.activeAnimations
          && model.activeAnimations.length > 0) return true;
      if (attempts >= MAX_ATTEMPTS) return wired;
      attempts++;
      wired = wire(entity);
      return wired;
    },
    get wired() { return wired; },
    diag: () => ({ wired, attempts, lastErr,
      clips: model && model.activeAnimations ? model.activeAnimations.length : null }),
  };
}
