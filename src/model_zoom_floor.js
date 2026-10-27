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
// So the model is exactly the size it is today where the map symbol
// hands over to it, and from there it only ever gets bigger as you zoom
// in, until its real size takes over. growth 0.5 makes it 1.4 times
// bigger each time the distance halves. The existing cap on exaggeration
// (maximumScale) still applies unchanged.
//
// The way back, live: window.__isr_model_tuning = { zoomGrowth: 0 }
// is today's flat floor exactly.
//
// Used for the threat tracks (hostile quads, fixed-wings, loitering
// munitions) and the swarm members. The F-35, the helicopter and the
// interceptor quad swap to their models kilometres out, where their cap
// already governs, and are not changed.
// ═══════════════════════════════════════════════════════════════════

export const ZOOM_CFG = { growth: 0.5 };

/** The pixel floor at camera distance distM. Pure. */
export function zoomFloorPx(floorPx, swapM, distM, growth = ZOOM_CFG.growth) {
  if (!(growth > 0) || !(swapM > 0) || !(distM > 0) || distM >= swapM) return floorPx;
  return floorPx * Math.pow(swapM / Math.max(distM, 1), growth);
}

/** The live tuning knob, read every frame so a console change applies at once. */
export function zoomGrowth() {
  const t = (typeof window !== 'undefined' && window.__isr_model_tuning) || null;
  return typeof t?.zoomGrowth === 'number' ? t.zoomGrowth : ZOOM_CFG.growth;
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
    if (!p) return floorPx;
    const d = Cesium.Cartesian3.distance(viewer.camera.positionWC, p);
    return zoomFloorPx(floorPx, swapM, d, zoomGrowth());
  }, false);
}
