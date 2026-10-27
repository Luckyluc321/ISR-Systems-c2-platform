// ═══════════════════════════════════════════════════════════════════
// A vehicle grows as you zoom in on it
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-27: "the more I zoom into a vehicle, the smaller it
// gets, until you're close enough where you're actually right around it".
//
// WHY. A 3D model carries minimumPixelSize: never smaller than N pixels
// on screen (docs/3d-vehicle-rendering.md, sections 2 and 8e). Inside the
// distance where the model is drawn, a drone's real size is a few
// pixels, so the floor governs over most of the zoom: the model is held
// at N pixels and quietly shrunk to stay there as the camera closes. On
// screen it stands still while the harbour and the buildings grow around
// it, which reads as the drone getting smaller. Only once its real size
// beats N pixels does it start to grow.
//
// THE FIX. Inside the model's swap distance the floor is no longer flat.
// It grows as the camera closes, with the square root of how much closer
// it is:
//
//   floor(d) = N                         at and beyond the swap distance
//   floor(d) = N * (swap / d) ^ growth   closer than that
//
// So the model starts where the map symbol hands over to it at the size
// set below, and from there it only ever gets bigger as you zoom in,
// until its real size takes over. growth 0.5 makes it 1.4 times
// bigger each time the distance halves. The existing cap on exaggeration
// (maximumScale) still applies unchanged.
//
// ZOOMED OUT, A LITTLE BIGGER (Lucas, same day: "you can barely see the
// drones ... not dramatically, as that would ruin the entire video
// because of how unrealistic it is. Just needs to be able to be seen").
// A quadcopter model at its 14 px floor is a speck next to the 32 px
// symbol it replaces. farBoost raises the floor at and beyond the swap
// distance, 1.4 by default (a quad to about 20 px, a fixed-wing to 28,
// still under the symbol), and fades out as the camera closes, so a
// close shot is exactly as realistic as before:
//
//   floor(d) = N * (swap / d) ^ growth * (1 + (farBoost - 1) * d / swap)
//
// The fade is held under the growth, so the drawn size still only ever
// gets bigger as you zoom in.
//
// Live knobs, and the way back to the flat floor of before:
//   window.__isr_model_tuning = { farBoost: 1.2 }              // subtler
//   window.__isr_model_tuning = { zoomGrowth: 0, farBoost: 1 } // as before
//
// Used for the threat tracks (hostile quads, fixed-wings, loitering
// munitions) and the swarm members. The F-35, the helicopter and the
// interceptor quad swap to their models kilometres out, where their cap
// already governs, and are not changed.
// ═══════════════════════════════════════════════════════════════════

// farBoost OFF by default since the same evening: "Why is the drones so
// big when you're far away?" The WITHOUT ISR run draws the swarm's models
// out to 20 km, so a boost held at and beyond the swap distance made
// every far drone bigger than it had ever been. Far away is back to the
// flat floor of before; zooming in still grows. The knob stays live.
export const ZOOM_CFG = { growth: 0.5, farBoost: 1 };

/** The pixel floor at camera distance distM. Pure. */
export function zoomFloorPx(floorPx, swapM, distM, growth = ZOOM_CFG.growth, farBoost = ZOOM_CFG.farBoost) {
  const g = growth > 0 ? growth : 0;
  // The boost's fade must stay under the growth or the drawn size would
  // dip as the camera closes: (1 + a d/M)(M/d)^g falls with d only while
  // a < g / (1 - g). Held at 90% of that.
  let a = Math.max(0, (typeof farBoost === 'number' ? farBoost : 1) - 1);
  if (g > 0 && g < 1) a = Math.min(a, 0.9 * g / (1 - g));
  else if (g === 0) a = 0;
  if (!(swapM > 0) || !(distM > 0) || distM >= swapM) return floorPx * (1 + a);
  return floorPx * Math.pow(swapM / Math.max(distM, 1), g) * (1 + a * distM / swapM);
}

/** The live tuning knobs, read every frame so a console change applies at once. */
function _tuning() {
  return (typeof window !== 'undefined' && window.__isr_model_tuning) || null;
}
export function zoomGrowth() {
  const t = _tuning();
  return typeof t?.zoomGrowth === 'number' ? t.zoomGrowth : ZOOM_CFG.growth;
}
export function farBoost() {
  const t = _tuning();
  return typeof t?.farBoost === 'number' ? t.farBoost : ZOOM_CFG.farBoost;
}

/**
 * A minimumPixelSize property that follows the camera.
 * getEntity: () => the entity once it exists (its position is read live).
 */
export function zoomFloorProperty(Cesium, viewer, getEntity, floorPx, swapM) {
  const scratch = new Cesium.Cartesian3();
  return new Cesium.CallbackProperty((time) => {
    const e = getEntity();
    const p = e?.position?.getValue?.(time, scratch);
    if (!p) return zoomFloorPx(floorPx, swapM, Infinity, zoomGrowth(), farBoost());
    const d = Cesium.Cartesian3.distance(viewer.camera.positionWC, p);
    return zoomFloorPx(floorPx, swapM, d, zoomGrowth(), farBoost());
  }, false);
}
