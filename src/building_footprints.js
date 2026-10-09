// ═══════════════════════════════════════════════════════════════════
// Building Footprints — swapping extruded boxes for reconstructed ones
// ───────────────────────────────────────────────────────────────────
// Away from the cities Google's photorealistic tiles cover, a building
// in this map is a white extruded box: the right outline at roughly
// the right height, and nothing else. It reads as a placeholder
// because it is one.
//
// scripts/mesh-pipeline builds the replacement from Danish national
// oblique photography: a textured reconstruction of the real building,
// with its real roof and real walls. This module is what puts one in
// place of the other.
//
// ── Why clip instead of cutting the mesh ────────────────────────────
//
// A reconstruction covers the whole SURFACE the cameras saw. Runway,
// taxiways, car parks, fields, trees. Laid over the map as-is it
// replaces terrain and imagery that are already correct, and the only
// part of it anyone wants is the buildings.
//
// So the mesh is cut to building outlines. That can happen in the
// geometry, which scripts/mesh-pipeline/clip_to_buildings.py does, or
// at render time, which is what this does. Cesium's
// ClippingPolygonCollection carries an `inverse` flag, and the two
// settings are exactly the two halves of the swap:
//
//     mesh    inverse: true    keep ONLY what is inside a footprint
//     boxes   inverse: false   remove what is inside a footprint
//
// One set of outlines, used twice, in opposite directions. That
// symmetry is the whole reason to do it this way. A box and the mesh
// that replaces it are cut against the same polygon, so they cannot
// leave a sliver of white box beside a real building, and they cannot
// leave a hole where neither draws. Any other rule for hiding the
// boxes, a bounding box or a site radius or a name match, can disagree
// with the mesh at the edges. This cannot.
//
// The outlines come from OpenStreetMap, deliberately, even though the
// national register is more accurate. The white boxes ARE OSM, drawn
// from Cesium's OSM Buildings tileset, so clipping both against an OSM
// outline makes them swap exactly. Correspondence matters more than
// accuracy here: a more accurate polygon that disagrees with the box
// is worse, not better, because the disagreement is what shows.
//
// ── What this does not do ───────────────────────────────────────────
//
// Clipping hides geometry, it does not stop it downloading. The whole
// tileset still comes over the wire and is still in memory; the parts
// outside a footprint are discarded by the shader. That is fine for a
// single site and wrong for a country, so cutting the geometry with
// clip_to_buildings.py stays the answer for tiling a city. This is the
// render-time half, and it is the half that guarantees the two layers
// agree at the edges.
//
// ── The seam ────────────────────────────────────────────────────────
//
// Outlines are bundled today because there are fourteen of them and
// they change when a building is built, not when a drone flies. The
// adapter registry is here so that a site with live outlines, from the
// national register or a customer's own facility model, registers a
// source and the rest of this file does not change.
// ═══════════════════════════════════════════════════════════════════

import * as Cesium from 'cesium';
import BUNDLED from './data/building_footprints.json';

// Above this, the signed distance texture Cesium builds for clipping
// stops being cheap. Nothing near it today with one site; the warning
// exists so that tiling a city reports the cost rather than quietly
// paying it.
const BUSY_POLYGON_COUNT = 200;

const _adapters = new Map();
let _active = null;

/**
 * Register a source of building outlines.
 *
 * `source` is declared at registration rather than read off the
 * returned data, for the same reason the track and telemetry seams do
 * it: provenance is a property of who is speaking, not a field the
 * payload can claim for itself.
 */
export function registerFootprintAdapter(name, adapter) {
  if (!name || typeof name !== 'string') {
    throw new Error('registerFootprintAdapter: name must be a non-empty string');
  }
  if (!adapter || typeof adapter.footprintsFor !== 'function') {
    throw new Error(`registerFootprintAdapter(${name}): adapter needs footprintsFor(siteId)`);
  }
  if (adapter.source !== 'bundled' && adapter.source !== 'live') {
    throw new Error(
      `registerFootprintAdapter(${name}): source must be 'bundled' or 'live', got ${adapter.source}`,
    );
  }
  _adapters.set(name, adapter);
  // A live source outranks the bundled one. Registering a real outline
  // service should take effect without a second call to say so.
  if (!_active || (adapter.source === 'live' && _adapters.get(_active)?.source !== 'live')) {
    _active = name;
  }
  return adapter;
}

export function getFootprintAdapter(name) {
  return _adapters.get(name) || null;
}

export function listFootprintAdapters() {
  return [..._adapters.entries()].map(([name, a]) => ({ name, source: a.source }));
}

export function activeFootprintAdapter() {
  return _active ? { name: _active, ..._adapters.get(_active) } : null;
}

// The default source: outlines exported by
// scripts/mesh-pipeline/export_footprints.py, covering exactly the
// ground each site's mesh reconstructed.
//
// A site built by the DRAPE pipeline publishes `coverage` instead:
// one rectangle per build, covering the ground where its mesh draws
// every building there is. See coverageFor below for why that is a
// different thing and not a shortcut.
registerFootprintAdapter('bundled', {
  source: 'bundled',
  footprintsFor(siteId) {
    return BUNDLED?.sites?.[siteId]?.buildings || [];
  },
  coverageFor(siteId) {
    return BUNDLED?.sites?.[siteId]?.coverage || [];
  },
});

/** Outlines for a site, as `[{ id, name, ring: [[lon, lat], ...] }]`. */
export function footprintsFor(siteId) {
  const adapter = _active && _adapters.get(_active);
  if (!adapter) return [];
  try {
    return adapter.footprintsFor(siteId) || [];
  } catch (err) {
    // An outline source that throws must not stop a site loading. The
    // map without the swap is the map as it was, which is a working
    // map.
    console.warn(`[footprints] ${_active} failed for ${siteId}:`, err?.message || err);
    return [];
  }
}

/**
 * Areas where a site's mesh draws every building, as the same
 * `[{ ring }]` shape outlines use.
 *
 * Only the draped pipeline publishes these, and the distinction from
 * footprintsFor is the whole point. An outline says "a building stands
 * here". A coverage rectangle says "inside here, the mesh is the
 * complete set of buildings, so nothing else needs to draw one".
 */
export function coverageFor(siteId) {
  const adapter = _active && _adapters.get(_active);
  if (!adapter || typeof adapter.coverageFor !== 'function') return [];
  try {
    return adapter.coverageFor(siteId) || [];
  } catch (err) {
    console.warn(`[footprints] ${_active} coverage failed for ${siteId}:`, err?.message || err);
    return [];
  }
}

/** Cesium clipping polygons for a site, or an empty array. */
export function clipPolygonsFor(siteId, rings) {
  const prints = rings || footprintsFor(siteId);
  const polygons = [];
  for (const b of prints) {
    const ring = b?.ring;
    // Three points is the minimum for an area. A shorter ring is a
    // line, and Cesium builds a degenerate distance field from it.
    if (!Array.isArray(ring) || ring.length < 3) continue;
    polygons.push(
      new Cesium.ClippingPolygon({
        positions: ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
      }),
    );
  }
  if (polygons.length > BUSY_POLYGON_COUNT) {
    console.warn(
      `[footprints] ${siteId}: ${polygons.length} clipping polygons. Past about ` +
      `${BUSY_POLYGON_COUNT} the distance texture gets expensive. Cut the mesh ` +
      'geometry with clip_to_buildings.py instead of clipping at render time.',
    );
  }
  return polygons;
}

/**
 * Swap the extruded boxes for the reconstruction over a site.
 *
 * Both tilesets get their own collection over the same outlines,
 * because a ClippingPolygonCollection belongs to one primitive and
 * carries the `inverse` flag that makes each side do its opposite job.
 *
 * Returns what it did, so a caller can log or assert on it rather than
 * assuming it worked.
 */
export function applyBuildingSwap({ siteId, meshTileset, boxTileset, quality } = {}) {
  const coverage = coverageFor(siteId);
  const result = {
    siteId, mode: null, polygons: 0, mesh: false, boxes: false,
  };

  const collection = (polygons, inverse) => {
    const c = new Cesium.ClippingPolygonCollection({ polygons, inverse });
    if (quality > 0) c.quality = quality;
    return c;
  };

  // ── Draped site: coverage rectangles, and the mesh is left alone ──
  //
  // drape_site.py builds only buildings — a roof per footprint and
  // walls down to the ground, about twenty faces each and no terrain.
  // So there is nothing in the mesh to clip away, and clipping it can
  // only delete buildings that should be drawn.
  //
  // That is not hypothetical. Billund kept the outline set from the
  // first photogrammetry run: 15 buildings over an 835 m box. Those 15
  // outlines were clipping a 3,743-building mesh down to 15, and the
  // rest of the town showed as white boxes. It looked exactly like a
  // mesh that had failed to load.
  //
  // The boxes still have to go, but inside the covered area the mesh
  // is the complete set of buildings, so every box in it is redundant
  // and one rectangle per build removes the lot. Three polygons rather
  // than 3,743, which also keeps it under the budget below.
  if (coverage.length) {
    const polygons = clipPolygonsFor(siteId, coverage);
    result.mode = 'coverage';
    result.polygons = polygons.length;
    if (!polygons.length) return result;
    if (meshTileset) meshTileset.clippingPolygons = undefined;
    if (boxTileset) {
      boxTileset.clippingPolygons = collection(polygons, false);
      result.boxes = true;
    }
    return result;
  }

  // ── Photogrammetry site: per-building outlines, both halves cut ──
  //
  // The original mesh reconstructed everything the cameras saw, so one
  // set of outlines does both jobs: keep only what is inside them in
  // the mesh, remove only what is inside them in the boxes. The
  // symmetry is why this clips rather than hiding the boxes some other
  // way — neither can leave a sliver beside a real building.
  const polygons = clipPolygonsFor(siteId);
  result.mode = 'outlines';
  result.polygons = polygons.length;
  if (!polygons.length) return result;

  if (meshTileset) {
    meshTileset.clippingPolygons = collection(polygons, true);
    result.mesh = true;
  }
  if (boxTileset) {
    boxTileset.clippingPolygons = collection(polygons, false);
    result.boxes = true;
  }
  return result;
}

/**
 * Put both layers back as they were.
 *
 * Called when a site unloads. Without it the previous site's outlines
 * keep cutting holes in the OSM boxes somewhere the mesh no longer
 * draws, which shows up as buildings missing for no visible reason.
 */
export function clearBuildingSwap({ meshTileset, boxTileset } = {}) {
  if (meshTileset) meshTileset.clippingPolygons = undefined;
  if (boxTileset) boxTileset.clippingPolygons = undefined;
}

/** Sites with bundled outlines. */
export function sitesWithFootprints() {
  return Object.keys(BUNDLED?.sites || {});
}
