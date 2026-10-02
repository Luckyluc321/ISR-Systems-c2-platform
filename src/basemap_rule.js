// ── Which basemap, and where ──────────────────────────────────────────
//
// THIS ENVIRONMENT ONLY (billund-sovereign worktree). The C2 platform
// never constructs this module.
//
// Two basemaps are loaded at once and exactly one is visible:
//
//   Bing            the global base. Also what Google's photorealistic
//                   3D tiles sit on, where those exist.
//   SDFI GeoDanmark Danish state orthophoto, 10 cm, Denmark only.
//
// The rule is derived, not a list of preferences. Google's photoreal 3D
// covers six Danish cities. Inside those, Bing is good imagery, its
// offset is hidden under photoreal geometry anyway, and we draw no
// building mesh of our own. Everywhere else is rural infrastructure:
// Bing is at its weakest there, its offset is visible, and it is exactly
// where our building meshes go. So:
//
//   in Denmark, low, not in a Google city  ->  SDFI
//   anything else                          ->  Bing
//
// This changes NOTHING geospatial. Positions, distances, bearings and
// sensor coverage are computed from latitude and longitude; an imagery
// layer is a texture. What it changes is whether the picture agrees with
// the numbers. On Bing a track drawn at its true coordinates sits a few
// metres off the imagery under it, so anyone judging "how close did it
// pass" by eye reads it wrong while the debrief figure was right. On
// Danish imagery the two agree.
//
// Why this is a module and not four lines in main.js: three call sites
// need the same answer, and when they each decided for themselves they
// disagreed. Entering a receiver's workspace map forced SDFI on even
// over Copenhagen, which is the one place the rule says not to, and
// leaving it forced SDFI off even over Billund. Both were invisible
// until you flew somewhere the override was wrong. One owner, one
// answer, every call site asks.
//
// Contract:
//   createBasemapRule({ Cesium, viewer, sdfiLayer, bingLayer })
//     -> { apply(reason), status(), force(which), cities }
//
//   apply()   evaluate and set. Idempotent, logs only on change.
//   force()   'sdfi' | 'bing' pin it, 'auto' hands control back. A pin
//             survives later apply() calls, so a demo can hold one
//             basemap without the camera stealing it back.
//   status()  what is active and why, for the console.
//
// sdfiLayer may be null (no token). Then this is inert and Bing stays.

// Centre and radius of each city Google's photorealistic 3D tiles cover
// densely enough that its mesh, not the orthophoto, is what you look at.
// Radii are deliberately generous: being wrong towards Bing costs
// imagery sharpness, being wrong towards SDFI costs the 3D buildings.
export const GOOGLE_PHOTOREAL_CITIES = [
  { name: 'København', lon: 12.568, lat: 55.676, km: 14 },
  { name: 'Aarhus', lon: 10.204, lat: 56.163, km: 11 },
  { name: 'Odense', lon: 10.389, lat: 55.403, km: 10 },
  { name: 'Aalborg', lon: 9.922, lat: 57.048, km: 10 },
  { name: 'Esbjerg', lon: 8.452, lat: 55.467, km: 9 },
  { name: 'Vejle', lon: 9.533, lat: 55.709, km: 8 },
];

// Denmark, generously. Outside this the question does not arise: SDFI
// has no imagery and answers opaque JPEG, which would paint over Bing.
const DK_BOUNDS = [7.5, 54.4, 15.6, 58.0];

// Hysteresis. One threshold flickers when the camera drifts across it;
// two mean it must clearly descend to switch on and clearly climb to
// switch off. Above this the orthophoto is a hazy smear anyway and Bing's
// offset is far below one pixel.
const ON_BELOW_M = 12000;
const OFF_ABOVE_M = 16000;

// Great-circle distance is overkill at city scale; a local flat
// approximation is accurate to centimetres over 15 km and needs no
// Cesium call.
function kmFrom(lon, lat, city) {
  const dx = (lon - city.lon) * 111.32 * Math.cos((lat * Math.PI) / 180);
  const dy = (lat - city.lat) * 111.32;
  return Math.hypot(dx, dy);
}

export function cityCovering(lon, lat) {
  for (const c of GOOGLE_PHOTOREAL_CITIES) {
    if (kmFrom(lon, lat, c) <= c.km) return c;
  }
  return null;
}

export function createBasemapRule({ Cesium, viewer, sdfiLayer, bingLayer }) {
  const DK = Cesium.Rectangle.fromDegrees(...DK_BOUNDS);
  let pinned = null; // 'sdfi' | 'bing' | null

  function evaluate() {
    const c = viewer.camera.positionCartographic;
    if (!c) return null;
    const lon = Cesium.Math.toDegrees(c.longitude);
    const lat = Cesium.Math.toDegrees(c.latitude);
    const inDK = Cesium.Rectangle.contains(
      DK,
      new Cesium.Cartographic(c.longitude, c.latitude),
    );
    const city = cityCovering(lon, lat);
    // Asymmetric threshold, read against what is on screen now.
    const low = sdfiLayer && sdfiLayer.show
      ? c.height < OFF_ABOVE_M
      : c.height < ON_BELOW_M;
    return { lon, lat, height: c.height, inDK, city, low,
             want: inDK && low && !city };
  }

  function apply(reason) {
    if (!sdfiLayer) return null;
    const e = evaluate();
    if (!e) return null;
    const want = pinned ? pinned === 'sdfi' : e.want;
    // Bing is the base layer and SDFI draws over it, so Bing is always
    // fully opaque and visibility is decided by SDFI alone. Entering a
    // workspace map used to zero Bing's alpha, which left a transparent
    // hole anywhere SDFI was hidden.
    if (bingLayer) bingLayer.alpha = 1.0;
    if (want !== sdfiLayer.show) {
      sdfiLayer.show = want;
      const why = pinned
        ? `pinned ${pinned}`
        : !e.inDK ? 'outside Denmark'
        : e.city ? `${e.city.name}, Google photoreal city`
        : !e.low ? `alt ${Math.round(e.height)} m`
        : `alt ${Math.round(e.height)} m over Denmark`;
      console.log(
        `[basemap] ${want ? 'SDFI GeoDanmark' : 'Bing'} — ${why}`
        + (reason ? ` (${reason})` : ''),
      );
    }
    return e;
  }

  // moveEnd, not a per-frame hook: this only needs to settle once the
  // camera stops. Flights fire it on arrival, which is what makes
  // picking a site re-evaluate without anyone calling apply().
  viewer.camera.moveEnd.addEventListener(() => apply('camera'));
  apply('init');

  return {
    apply,
    cities: GOOGLE_PHOTOREAL_CITIES,
    force(which) {
      if (!sdfiLayer) return 'no SDFI layer';
      if (which === 'auto') {
        pinned = null;
        apply('unpinned');
        return 'back to automatic';
      }
      if (which !== 'sdfi' && which !== 'bing') return "use 'sdfi', 'bing' or 'auto'";
      pinned = which;
      apply('pinned');
      return `pinned to ${which}`;
    },
    status() {
      const e = evaluate();
      return {
        active: sdfiLayer && sdfiLayer.show ? 'SDFI GeoDanmark' : 'Bing',
        pinned: pinned || 'auto',
        googleCity: e && e.city ? e.city.name : null,
        inDenmark: e ? e.inDK : null,
        altitudeM: e ? Math.round(e.height) : null,
        lon: e ? +e.lon.toFixed(4) : null,
        lat: e ? +e.lat.toFixed(4) : null,
      };
    },
  };
}
