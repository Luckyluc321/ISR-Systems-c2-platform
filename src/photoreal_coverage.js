// ═══════════════════════════════════════════════════════════════════
// Photoreal coverage — where Google's building mesh ends
// ───────────────────────────────────────────────────────────────────
// Google ships building meshes for some cities and draped orthophoto for
// everything else, and publishes no list of which is which. The map's
// extruded OSM boxes exist for the second case. Drawn over the first
// case they cover the real buildings, which is how inner Copenhagen
// came to render as grey blocks over a photoreal city.
//
// The fix clips the boxes out inside hand-traced rings, one per city,
// the same ClippingPolygonCollection the Billund mesh already applies
// to this tileset. The ring has to be traced by eye: the edge is only
// visible by looking at it.
//
// Two halves, kept apart so a wrong ring (data) and a wrong clip (code)
// cannot be mistaken for each other:
//
//   1. the tracer, createCoverageTracer: records ground points from
//      inside the map and prints a ring. Clips nothing.
//   2. the owner, createBoxClipOwner: the ONE place that assigns
//      clippingPolygons on the OSM tileset. The city rings are its
//      base layer; a site mesh (Billund) adds its own polygons on top
//      through setSite and takes them away through clearSite. Before
//      this, applyBuildingSwap and clearBuildingSwap wrote the
//      property directly, and a site unloading wiped the whole
//      collection, city rings included.
//
// The base layer follows the photoreal tileset's visibility. When
// photoreal is hidden (night, Live mode) the boxes are the only
// buildings, so clipping them away would leave the inner city flat.
// follow() is called every frame and rebuilds only on a flip.
//
// WHAT IT NEVER DOES: touch any mode branch in applyImageryMode, set
// .show on either tileset, or change what draws where no ring exists.
//
// Console use, on a dev instance:
//
//   __isr_coverage.arm()          shift-click adds a vertex at the click
//   __isr_coverage.mark()         adds a vertex at the screen centre
//   __isr_coverage.undo()         drops the last vertex
//   __isr_coverage.show()         draws the ring so far (additive entity)
//   __isr_coverage.ring()         prints the ring as JSON, ready to paste
//   __isr_coverage.clear()        starts over
//   __isr_coverage.load(ring)     resumes a ring pasted back in
//
// Shift is deliberate. Cesium dispatches a modified click only to
// handlers registered for that modifier, so the map's own plain
// LEFT_CLICK handlers never see a tracing click and entity picking is
// untouched while a ring is being drawn.
// ═══════════════════════════════════════════════════════════════════

import BUNDLED from './data/photoreal_coverage.json' with { type: 'json' };

const ROUND = 6;   // decimal degrees; 6 places is ~0.1 m, more is noise

/** The bundled rings, as { name: { label, traced, ring } }. */
export function coverageRings(source = BUNDLED) {
  return source?.rings || {};
}

/**
 * Cesium clipping polygons for every usable bundled ring. Rings are
 * data; a ring that is not usable is skipped and named, never thrown
 * on, because one bad trace must not take the boxes away everywhere.
 */
export function coverageClipPolygons(Cesium, rings = coverageRings()) {
  const polygons = [];
  for (const [name, entry] of Object.entries(rings)) {
    const ring = entry?.ring;
    if (!isUsableRing(ring)) {
      console.warn(`[photoreal_coverage] ring "${name}" is not usable (need 3+ [lon, lat] pairs), skipped`);
      continue;
    }
    polygons.push(new Cesium.ClippingPolygon({
      positions: ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
    }));
  }
  return polygons;
}

/**
 * Sole owner of clippingPolygons on the OSM box tileset.
 *
 * @param isPhotorealShown  () => boolean. The base layer applies only
 *                          while this is true; site polygons always.
 */
export function createBoxClipOwner({ Cesium, boxTileset, isPhotorealShown = () => true } = {}) {
  let base = [];
  let site = [];
  let shown = null;

  function apply() {
    shown = !!isPhotorealShown();
    if (!boxTileset) return;
    const polygons = [...(shown ? base : []), ...site];
    boxTileset.clippingPolygons = polygons.length
      ? new Cesium.ClippingPolygonCollection({ polygons, inverse: false })
      : undefined;
  }

  return {
    setBase(polygons) { base = Array.isArray(polygons) ? polygons : []; apply(); },
    setSite(polygons) { site = Array.isArray(polygons) ? polygons : []; apply(); },
    clearSite() { site = []; apply(); },
    /** Per frame. Cheap: one boolean compare unless visibility flipped. */
    follow() { if (!!isPhotorealShown() !== shown) apply(); },
    state() {
      return {
        base: base.length,
        site: site.length,
        photorealShown: shown,
        applied: !!(boxTileset && boxTileset.clippingPolygons),
      };
    },
  };
}

/**
 * Ground point under a window position as [lon, lat], or null.
 * Prefers the 3D tile surface so the vertex lands where the building
 * edge is seen, not on the ellipsoid underneath it.
 */
export function groundPointAt(Cesium, viewer, windowPos) {
  const scene = viewer.scene;
  let cart = null;
  if (scene.pickPositionSupported) {
    const p = scene.pickPosition(windowPos);
    if (p) cart = p;
  }
  if (!cart) {
    const ray = viewer.camera.getPickRay(windowPos);
    cart = ray ? scene.globe.pick(ray, scene) : null;
  }
  if (!cart) cart = viewer.camera.pickEllipsoid(windowPos, scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  if (!c) return null;
  const f = 10 ** ROUND;
  return [
    Math.round(Cesium.Math.toDegrees(c.longitude) * f) / f,
    Math.round(Cesium.Math.toDegrees(c.latitude) * f) / f,
  ];
}

/** A ring is usable when it has three or more [lon, lat] pairs. */
export function isUsableRing(ring) {
  return Array.isArray(ring)
    && ring.length >= 3
    && ring.every(p => Array.isArray(p) && p.length === 2
      && Number.isFinite(p[0]) && Number.isFinite(p[1])
      && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
}

export function createCoverageTracer({ Cesium, viewer } = {}) {
  let ring = [];
  let handler = null;
  let drawn = null;

  function redraw() {
    if (!drawn) return;
    drawn.polyline.positions = ring.length >= 2
      ? ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 2))
      : [];
  }

  function add(pt, why) {
    if (!pt) return `no ground under ${why}`;
    ring.push(pt);
    redraw();
    return `#${ring.length} ${pt[1]}, ${pt[0]} (${why})`;
  }

  return {
    arm() {
      if (handler) return 'already armed';
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction(
        ev => console.log('[coverage]', add(groundPointAt(Cesium, viewer, ev.position), 'shift-click')),
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
        Cesium.KeyboardEventModifier.SHIFT,
      );
      return 'armed: shift-click adds a vertex';
    },
    disarm() {
      if (handler) { handler.destroy(); handler = null; }
      return 'disarmed';
    },
    mark() {
      const c = viewer.scene.canvas;
      const centre = new Cesium.Cartesian2(c.clientWidth / 2, c.clientHeight / 2);
      return add(groundPointAt(Cesium, viewer, centre), 'screen centre');
    },
    undo() {
      const p = ring.pop();
      redraw();
      return p ? `dropped ${p[1]}, ${p[0]}, ${ring.length} left` : 'ring is empty';
    },
    show() {
      if (!drawn) {
        drawn = viewer.entities.add({
          id: '__isr_coverage_trace',
          polyline: {
            positions: [],
            width: 3,
            material: Cesium.Color.CYAN,
            clampToGround: false,
          },
        });
      }
      redraw();
      return `${ring.length} vertices drawn`;
    },
    hide() {
      if (drawn) { viewer.entities.remove(drawn); drawn = null; }
      return 'trace hidden';
    },
    ring() {
      const s = JSON.stringify(ring);
      console.log(`[coverage] ${ring.length} vertices${isUsableRing(ring) ? '' : ' (need 3+)'}\n${s}`);
      return s;
    },
    load(r) {
      if (!Array.isArray(r)) return 'pass an array of [lon, lat]';
      ring = r.filter(p => Array.isArray(p) && p.length === 2).map(([a, b]) => [a, b]);
      redraw();
      return `${ring.length} vertices loaded`;
    },
    clear() {
      ring = [];
      redraw();
      return 'cleared';
    },
    count() { return ring.length; },
  };
}
