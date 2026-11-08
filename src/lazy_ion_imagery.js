// ═══════════════════════════════════════════════════════════════════
// ion imagery only when the view needs it
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-08: the free Cesium ion account has 1,000 sessions a
// month and ion is the fallback, never the default. Every page load
// opened ion imagery sessions it did not need:
//
//   Earth at Night (3812)  loaded at boot, used only by night mode
//                          (parked) and auto mode's globe view
//   Bing Aerial (2)        loaded at boot since Google refuses its
//                          satellite map to our key, yet over Denmark
//                          the Danish orthophoto covers the ground
//
// Each now loads once, the first time it is needed, and is inserted where
// it always sat in the layer stack. Google's 3D city is untouched.
// ═══════════════════════════════════════════════════════════════════

// Above this, Cesium's bundled Natural Earth is enough for the ground.
export const LAZY_BING_BELOW_M = 2_000_000;

/**
 * One ion imagery layer, created on the first load() call only.
 *   insertAbove  () => layer the new one goes directly above (or null)
 *   configure    (layer) => set its fixed properties
 *   onLoaded     (layer) => hand it to the caller
 *   -> { load(reason), state(), layer() }   state: waiting|loading|loaded|failed
 */
export function createLazyIonImagery({
  Cesium, viewer, assetId, label,
  insertAbove = () => null, configure = () => {}, onLoaded = () => {},
} = {}) {
  let state = 'waiting';
  let layer = null;

  async function load(reason) {
    if (state !== 'waiting') return layer;
    state = 'loading';
    try {
      const provider = await Cesium.IonImageryProvider.fromAssetId(assetId);
      const above = insertAbove();
      const at = above ? viewer.imageryLayers.indexOf(above) + 1 : 0;
      layer = viewer.imageryLayers.addImageryProvider(provider, at >= 1 ? at : undefined);
      configure(layer);
      state = 'loaded';
      console.log(`[ion_lazy] ${label} loaded (${reason}): one ion imagery session`);
      try { onLoaded(layer); } catch (err) { console.warn(`[ion_lazy] ${label} hand-over failed:`, err?.message || err); }
    } catch (err) {
      state = 'failed';
      console.warn(`[ion_lazy] ${label} failed:`, err?.message || err);
    }
    return layer;
  }

  return { load, state: () => state, layer: () => layer };
}
