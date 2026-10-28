// ═══════════════════════════════════════════════════════════════════
// Over Denmark, the ground is the Danish state orthophoto
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-28. Google's billing report for October, by SKU:
//
//   Map Tiles API: 2D Map Tiles            175,742 tiles   298.94 kr
//   Map Tiles API: Photorealistic 3D Tiles      588 loads     0.00 kr
//
// The 3D city was free (under the 1,000 root requests Google gives
// each month). The whole bill was the flat 2D satellite layer under it,
// which Google meters per tile: every pan, zoom and camera follow pulls
// dozens. Lucas: "2d* with SDFI".
//
// THE RULE
//   camera over Denmark, below sdfiOnBelowM     Danish orthophoto on top
//   ... and below googleOffBelowM               Google's 2D layer hidden,
//                                               so it requests no tiles
//   anywhere else, or higher up                 Google's 2D, as before
//   night mode                                  untouched, as before
//   Google's 3D city, OSM buildings, terrain    untouched, as before
//
// The two heights are staggered on purpose. On the way down the
// orthophoto comes on first and loads over Google's picture, and Google
// is only switched off once the camera is lower still. Switching both at
// once would show the backdrop for a moment while the Danish tiles
// arrive. Each has a band (on below one height, off above a higher one)
// so a camera hovering at the boundary does not flicker.
//
// WHERE THE ORTHOPHOTO HAS NO PICTURE (open sea, Sweden, Germany) the
// service paints a background colour, which main.js asks for as a key
// colour and makes see-through on the layer (colorToAlpha). Whatever is
// underneath shows instead: Google's 2D where it is still on, otherwise
// Cesium's bundled offline Natural Earth imagery, which main.js keeps
// as a free backdrop below Google. The key is the backdrop's own sea
// blue, so the soft edge JPEG leaves around it reads as water.
//
// Measured 2026-10-28 before choosing it: a transparent PNG would have
// done the same with no key, but weighed 145 KB a tile against 11 KB,
// about 10 MB per site view against 0.8 MB.
//
// WHAT IT DOES NOT DO. It changes which picture is drawn on the ground,
// nothing else. Positions, distances and coverage are computed from
// coordinates. It touches two layers' `show` flags and nothing global.
//
// The way back, live, for a side-by-side look:
//   __isr_basemap.force('bing')   Google's 2D everywhere, as before
//   __isr_basemap.force('sdfi')   the orthophoto everywhere it exists
//   __isr_basemap.force('auto')   this rule
// ('bing' is the old name for "the normal base map", which is Google's
// 2D wherever a Google key is configured.) For good, revert the commit.
//
// Live knobs: window.__isr_basemap_tuning = { sdfiOnBelowM: 40000 }
// ═══════════════════════════════════════════════════════════════════

export const DK_BASEMAP_CFG = {
  // Denmark as two boxes. The main one stops at 12.80 E: east of
  // Copenhagen Airport and Saltholm, west of Malmö (13.0 E), so the
  // camera standing over Skåne is "not over Denmark". Bornholm and
  // Ertholmene get their own box. The coastal tips the boxes take in
  // (Flensburg, the Swedish coast north of Helsingborg) only decide
  // when Google's 2D is switched off. The picture there is the backdrop.
  areas: [
    { name: 'Denmark', w: 7.99, e: 12.80, s: 54.43, n: 57.78 },
    { name: 'Bornholm', w: 14.65, e: 15.25, s: 54.95, n: 55.35 },
  ],
  sdfiOnBelowM: 60000,
  sdfiOffAboveM: 80000,
  googleOffBelowM: 30000,
  googleOnAboveM: 40000,
  // ...and never sooner than this after the orthophoto came on, so its
  // tiles have arrived before Google's picture goes from under them. The
  // heights alone did not hold on a fast fly-in, which can drop from
  // 80 km to 18 km between two checks.
  googleOffAfterMs: 1500,
  // The service's background, made see-through on the layer. #4075a8
  // is the Natural Earth backdrop's sea, sampled over the Kattegat.
  // The threshold is a per-channel distance, enough to swallow JPEG
  // noise in a flat field of the key and no more.
  keyColor: '#4075a8',
  keyThreshold: 0.08,
  // Level 19 draws about 17 cm a pixel at 56 N, coarser than the 12.5 cm
  // the orthophoto is flown at. Level 20 draws about 8 cm, so the photo's
  // own detail reaches the screen.
  maximumLevel: 20,
  // The service's published coverage (GetCapabilities, 2026-10-28) with
  // a small margin. The layer requests nothing outside it.
  rectangle: { w: 7.9, s: 54.4, e: 15.7, n: 57.8 },
  // The data's licence ("Vilkår for brug af frie geografiske data",
  // 2022) asks for this credit, the dataset and "WMS-tjeneste". It is
  // not CC BY 4.0, which the old credit said.
  credit: 'Indeholder data fra Styrelsen for Dataforsyning og Infrastruktur, Ortofoto forår, WMS-tjeneste',
};

/** Whether lon/lat (degrees) stands over Denmark. Pure. */
export function overDenmark(lon, lat, areas = DK_BASEMAP_CFG.areas) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  return areas.some((a) => lon >= a.w && lon <= a.e && lat >= a.s && lat <= a.n);
}

/**
 * What to show. Pure, so check:basemap-denmark can hold it.
 *   sdfiShown, baseHidden  what is on screen now (for the bands)
 *   sdfiShownForMs         how long the orthophoto has been on
 *   pinned                 null | 'sdfi' | 'bing'
 *   allowed                false in night mode (its own rules apply)
 *   billedBase             true when the base layer is Google's, the
 *                          only case where hiding it saves anything
 */
export function decideBasemap({ lon, lat, height, sdfiShown, baseHidden, sdfiShownForMs = 0, pinned, allowed, billedBase, cfg = DK_BASEMAP_CFG }) {
  if (!allowed || pinned === 'bing') return { sdfi: false, hideBase: false };
  if (pinned === 'sdfi') return { sdfi: true, hideBase: !!billedBase };
  const h = Number.isFinite(height) ? height : Infinity;
  const over = overDenmark(lon, lat, cfg.areas);
  const sdfi = over && h < (sdfiShown ? cfg.sdfiOffAboveM : cfg.sdfiOnBelowM);
  // Once hidden, Google stays hidden inside its band without waiting
  // again. Only the switch-off waits for the orthophoto's tiles.
  const settled = baseHidden || (sdfiShown && sdfiShownForMs >= cfg.googleOffAfterMs);
  const hideBase = !!billedBase && sdfi && settled && h < (baseHidden ? cfg.googleOnAboveM : cfg.googleOffBelowM);
  return { sdfi, hideBase };
}

function _tuned(cfg) {
  const t = (typeof window !== 'undefined' && window.__isr_basemap_tuning) || null;
  if (!t) return cfg;
  const out = { ...cfg };
  for (const k of ['sdfiOnBelowM', 'sdfiOffAboveM', 'googleOffBelowM', 'googleOnAboveM', 'googleOffAfterMs']) {
    if (typeof t[k] === 'number') out[k] = t[k];
  }
  return out;
}

/**
 * Same contract as basemap_meshed_sites.js, so every caller of
 * window.__isr_basemap keeps working:
 *   -> { apply(reason), status(), force(which), areas(), refresh() }
 */
export function createDenmarkBasemap({
  Cesium, viewer, sdfiLayer, baseLayer, billedBase = false,
  // Veto. Night mode turns the orthophoto off and the base layer on by
  // itself. The rule defers to that instead of fighting it.
  allow = () => true,
  cfg = DK_BASEMAP_CFG,
}) {
  let pinned = null;   // 'sdfi' | 'bing' | null
  let _sdfiOnSince = null;   // performance.now() when the orthophoto came on

  // `allow` closes over the caller's state. If that is not ready yet, or
  // throws for any other reason, the honest answer is "change nothing",
  // not "take the render loop down with you": this runs inside Cesium's
  // camera events, where an uncaught throw stops rendering.
  function allowed() {
    try { return !!allow(); } catch (_) { return false; }
  }

  function evaluate() {
    const c = viewer.camera.positionCartographic;
    if (!c) return null;
    return {
      lon: Cesium.Math.toDegrees(c.longitude),
      lat: Cesium.Math.toDegrees(c.latitude),
      height: c.height,
    };
  }

  function apply(reason) {
    if (!sdfiLayer) return null;
    let e;
    try { e = evaluate(); } catch (_) { return null; }
    if (!e) return null;
    const ok = allowed();
    const now = performance.now();
    if (!sdfiLayer.show) _sdfiOnSince = null;
    const d = decideBasemap({
      ...e,
      sdfiShown: sdfiLayer.show,
      baseHidden: !!baseLayer && baseLayer.show === false,
      sdfiShownForMs: sdfiLayer.show && _sdfiOnSince !== null ? now - _sdfiOnSince : 0,
      pinned, allowed: ok, billedBase, cfg: _tuned(cfg),
    });
    // Night mode owns both layers. Hand them back as it left them and
    // touch nothing: it shows the base and hides the orthophoto itself.
    if (!ok) return e;
    let changed = false;
    if (d.sdfi !== sdfiLayer.show) {
      sdfiLayer.show = d.sdfi;
      _sdfiOnSince = d.sdfi ? now : null;
      changed = true;
    } else if (d.sdfi && _sdfiOnSince === null) {
      // On already, by someone else's hand (workspace map mode). Count
      // from now.
      _sdfiOnSince = now;
    }
    if (baseLayer && billedBase && baseLayer.show === d.hideBase) { baseLayer.show = !d.hideBase; changed = true; }
    if (changed) {
      const why = pinned ? `pinned ${pinned}` : `alt ${Math.round(e.height)} m`;
      console.log(`[basemap] ${d.sdfi ? 'Danish orthophoto' : 'no orthophoto'}, Google 2D ${d.hideBase ? 'off' : 'on'}, ${why}`
        + (reason ? ` (${reason})` : ''));
    }
    return e;
  }

  // Read the camera every 200 ms while frames are drawn, and once more
  // when a move ends. camera.changed was tried first: it fires only every
  // half view of movement, so a three-second fly-in from the globe
  // skipped straight from 49 km to 6 km and switched the orthophoto on
  // and Google off in the same instant, which shows the backdrop while
  // the Danish tiles arrive. The stagger needs the heights in between.
  // Cost per check: one cartographic read and two flag compares.
  const CHECK_EVERY_MS = 200;
  let _lastCheck = 0;
  viewer.scene.postRender.addEventListener(() => {
    const now = performance.now();
    if (now - _lastCheck < CHECK_EVERY_MS) return;
    _lastCheck = now;
    apply('camera');
  });
  viewer.camera.moveEnd.addEventListener(() => apply('camera'));
  // NO apply() HERE. main.js constructs this before imageryMode exists,
  // and `allow` reads it. The caller applies once it is ready.

  return {
    apply,
    refresh: () => cfg.areas.length,
    areas: () => cfg.areas.map((a) => ({ site: a.name, build: 'Denmark', lon: `${a.w}..${a.e}`, lat: `${a.s}..${a.n}` })),
    force(which) {
      if (!sdfiLayer) return 'no SDFI layer';
      if (which === 'auto') { pinned = null; apply('unpinned'); return 'back to automatic'; }
      if (which !== 'sdfi' && which !== 'bing') return "use 'sdfi', 'bing' or 'auto'";
      pinned = which; apply('pinned'); return `pinned to ${which}`;
    },
    status() {
      const e = evaluate();
      return {
        active: sdfiLayer && sdfiLayer.show ? 'SDFI GeoDanmark' : 'Bing',
        google2d: !baseLayer ? 'none' : (baseLayer.show ? 'on' : 'off'),
        billedBase,
        pinned: pinned || 'auto',
        overDenmark: e ? overDenmark(e.lon, e.lat, cfg.areas) : null,
        altitudeM: e ? Math.round(e.height) : null,
        lon: e ? +e.lon.toFixed(5) : null,
        lat: e ? +e.lat.toFixed(5) : null,
        meshedAreas: cfg.areas.length,
      };
    },
  };
}
