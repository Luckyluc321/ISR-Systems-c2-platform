// ── Danish imagery, but only where we built the buildings ────────────
//
// THE DEFAULT DOES NOT CHANGE. Bing everywhere, Google's photorealistic
// 3D over the six cities it covers, exactly as before this file existed.
// Nothing here runs unless the camera is standing on ground where we
// have built a mesh of our own.
//
// WHY THE EXCEPTION EXISTS
//
// A draped mesh is built from Danish national data: OpenStreetMap
// footprints, Danmarks Højdemodel heights, and SDFI orthophotos for the
// roof texture. All three agree with each other because they are
// surveyed against the same coordinates. Bing's imagery is registered a
// few metres away from that.
//
// So over a site we have built, the buildings are in the right place and
// the photo under them is not. It does not read as "the photo is
// shifted". It reads as every roof being nudged off its own building by
// the same amount in the same direction, which looks like our mesh is
// wrong. It is not.
//
// Switching to SDFI over exactly that ground makes the mesh and the
// photograph agree, because they come from the same survey.
//
// WHY IT KEYS OFF THE MESH AND NOT A LIST OF PLACES
//
// An earlier version of this rule carried a hand-written list of six
// Danish cities with a radius each. That list is a second source of
// truth: it drifts the moment a site is added, and it answers a
// different question from the one being asked. The question is not
// "is this a big city", it is "did we build the buildings here".
//
// Coverage rectangles already answer that exactly. They are generated
// from the built meshes by export_coverage.py, so they cannot describe
// ground that was not built, and they are already in the bundle for the
// box-clipping. One source, no drift.
//
// NOTHING GLOBAL IS TOUCHED. One imagery layer's `show` flag and Bing's
// alpha. No Cesium scene settings, no day-mode branch, no tilesets, no
// globe properties.
//
// This changes NOTHING geospatial. Positions, distances, bearings and
// sensor coverage are computed from latitude and longitude; an imagery
// layer is a texture. What it changes is whether the picture agrees with
// the numbers. On Bing a track drawn at its true coordinates sits a few
// metres off the imagery under it, so anyone judging "how close did it
// pass" by eye reads it wrong while the debrief figure was right.
//
// Contract:
//   createMeshedSiteBasemap({ Cesium, viewer, sdfiLayer, bingLayer,
//                             meshedSiteIds, coverageFor })
//     -> { apply(reason), status(), force(which), areas() }
//
//   apply()  evaluate and set. Idempotent, logs only on change.
//   force()  'sdfi' | 'bing' pin it, 'auto' hands control back. A pin
//            survives later apply() calls, so a walkthrough can hold one
//            basemap without the camera taking it back.

// Below this the mesh is what you are looking at and its registration
// matters. Above it, the offset is far under one pixel and Bing is the
// better picture. Two thresholds rather than one, because a single one
// flickers when the camera drifts across it.
const ON_BELOW_M = 9000;
const OFF_ABOVE_M = 12000;

export function createMeshedSiteBasemap({
  Cesium, viewer, sdfiLayer, bingLayer, meshedSiteIds, coverageFor,
  // Veto. Night mode already turns this layer off deliberately — SDFI is
  // a daylight orthophoto and has no business in a night scene — and
  // without asking, the next camera move would turn it straight back on.
  // The rule defers to that rather than fighting it.
  allow = () => true,
}) {
  let pinned = null;   // 'sdfi' | 'bing' | null

  // Flattened once at construction: [{ siteId, build, w, s, e, n }].
  // Rebuilt by refresh() if a site's mesh is ever added at runtime.
  let boxes = [];
  function refresh() {
    boxes = [];
    for (const siteId of meshedSiteIds()) {
      for (const r of (coverageFor(siteId) || [])) {
        const xs = r.ring.map((p) => p[0]);
        const ys = r.ring.map((p) => p[1]);
        boxes.push({
          siteId,
          build: r.build || siteId,
          w: Math.min(...xs), e: Math.max(...xs),
          s: Math.min(...ys), n: Math.max(...ys),
        });
      }
    }
    return boxes.length;
  }
  refresh();

  function over(lon, lat) {
    return boxes.find((b) => lon >= b.w && lon <= b.e && lat >= b.s && lat <= b.n) || null;
  }

  function evaluate() {
    const c = viewer.camera.positionCartographic;
    if (!c) return null;
    const lon = Cesium.Math.toDegrees(c.longitude);
    const lat = Cesium.Math.toDegrees(c.latitude);
    const box = over(lon, lat);
    // Asymmetric threshold, read against what is on screen now.
    const low = sdfiLayer && sdfiLayer.show
      ? c.height < OFF_ABOVE_M
      : c.height < ON_BELOW_M;
    return { lon, lat, height: c.height, box, low, want: !!box && low };
  }

  // `allow` closes over the caller's state. If that is not ready yet,
  // or throws for any other reason, the honest answer is "do not switch
  // the basemap", not "take the render loop down with you". This runs
  // inside Cesium's frame callback via moveEnd, where an uncaught throw
  // stops rendering entirely and shows a dead globe.
  function allowed() {
    try { return allow(); } catch (_) { return false; }
  }

  function apply(reason) {
    if (!sdfiLayer) return null;
    let e;
    try { e = evaluate(); } catch (_) { return null; }
    if (!e) return null;
    const want = allowed() && (pinned ? pinned === 'sdfi' : e.want);
    // Bing is the base and SDFI draws over it, so visibility is SDFI's
    // show flag alone and Bing stays fully opaque. Zeroing Bing's alpha
    // leaves a transparent hole anywhere SDFI is hidden, which is what
    // entering a workspace map used to do.
    if (bingLayer) bingLayer.alpha = 1.0;
    if (want !== sdfiLayer.show) {
      sdfiLayer.show = want;
      const why = !allowed() ? 'vetoed by imagery mode'
        : pinned ? `pinned ${pinned}`
        : e.box ? `over ${e.box.build}, alt ${Math.round(e.height)} m`
        : 'no mesh here';
      console.log(`[basemap] ${want ? 'SDFI GeoDanmark' : 'Bing'} — ${why}`
        + (reason ? ` (${reason})` : ''));
    }
    return e;
  }

  // moveEnd, not a per-frame hook: this only needs to settle once the
  // camera stops. Flights fire it on arrival, which is what makes
  // picking a site re-evaluate with nobody calling apply().
  viewer.camera.moveEnd.addEventListener(() => apply('camera'));
  // NO apply() HERE. This is constructed while main.js is still setting
  // itself up, and `allow` closes over state declared further down that
  // file. Calling it now reads a `let` in its temporal dead zone and
  // throws ReferenceError inside Cesium's render loop, which surfaces as
  // "An error occurred while rendering. Rendering has stopped." — a dead
  // globe, not a stack trace anyone would connect to a basemap rule.
  // The caller applies once it is ready.

  return {
    apply,
    refresh,
    areas: () => boxes.map((b) => ({
      site: b.siteId, build: b.build,
      lon: `${b.w.toFixed(4)}..${b.e.toFixed(4)}`,
      lat: `${b.s.toFixed(4)}..${b.n.toFixed(4)}`,
    })),
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
        pinned: pinned || 'auto',
        overMeshedSite: e && e.box ? `${e.box.siteId} / ${e.box.build}` : null,
        altitudeM: e ? Math.round(e.height) : null,
        lon: e ? +e.lon.toFixed(5) : null,
        lat: e ? +e.lat.toFixed(5) : null,
        meshedAreas: boxes.length,
      };
    },
  };
}
