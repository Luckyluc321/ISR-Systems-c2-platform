// ═══════════════════════════════════════════════════════════════════
// Danish city meshes: high-definition 3D from Danish sources first
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-07 and 08: over Denmark the 3D city comes from Danish
// sources by default, and Cesium ion is only the fallback. Since
// 2026-11-07 Google refuses Photorealistic 3D Tiles to our own key in the
// European Economic Area, so Google's city now streams through ion, which
// spends the ion session allowance on every page load.
//
// Copenhagen has a Danish high-definition mesh: Hexagon's textured
// photogrammetry from 2023 imagery, made for Skat, published by
// Copenhagen municipality's city data team as Cesium 3D Tiles on ArcGIS
// Online. Same class of detail as Google's city. The entries live in
// src/data/dk_city_meshes.json, so a new city is data, not code.
//
// THE RULE, per mesh
//   loading                    nothing clipped, Google's city as before
//   first tile with content    the mesh is kept only inside its area,
//                              Google's city and the OSM boxes are
//                              clipped out there
//   fails, or keeps failing    nothing clipped, the mesh hidden, Google's
//                              city covers the area: the fallback
//   night mode                 the mesh follows Google's city's own
//                              visibility, so night stays as it was
//   no WebGL2 clipping         no Danish mesh at all, everything as before
//
// Heights: Danish meshes are in DVR90 sea-level heights, Cesium works in
// ellipsoidal heights, so each mesh is raised by the local geoid
// separation (liftM). Live: __isr_dkMeshes.lift('copenhagen', 37.4).
//
// Loads in the background and never blocks boot. It is not Google, so it
// loads on every address, with or without ?google=1. It is the one
// writer of clippingPolygons on Google's tileset and on its own
// tilesets. The OSM boxes are clipped through the box clip owner in
// photoreal_coverage.js, which stays the one writer there.
//
// WHAT IT NEVER DOES: set googlePhotoreal.show or osmBuildings.show,
// touch any mode branch in applyImageryMode, or change anything outside
// a mesh's area.
// ═══════════════════════════════════════════════════════════════════

import BUNDLED from './data/dk_city_meshes.json' with { type: 'json' };
import { isUsableRing } from './photoreal_coverage.js';

// Geoid separation over Denmark runs about 34.5 m (Rønne) to 40.8 m
// (Esbjerg). A lift outside this band is a typo, not a datum.
export const LIFT_RANGE_M = [30, 45];

// A mesh whose tiles fail this often, and more often than they load, is
// treated as down: Google's city comes back over its area.
export const FAIL_LIMIT = 20;

/** Problems with one entry, as short strings. Empty when usable. Pure. */
export function entryProblems(entry) {
  const p = [];
  if (!entry || typeof entry !== 'object') return ['not an object'];
  if (typeof entry.url !== 'string' || !/^https:\/\//.test(entry.url)) p.push('url must be https');
  const [lo, hi] = LIFT_RANGE_M;
  if (!Number.isFinite(entry.liftM) || entry.liftM < lo || entry.liftM > hi) p.push(`liftM must be ${lo} to ${hi} m`);
  const rings = entry.area?.rings;
  if (!Array.isArray(rings) || rings.length === 0) p.push('area.rings missing');
  else if (!rings.every(isUsableRing)) p.push('a ring is not usable');
  return p;
}

/** Usable entries as [{ id, ...entry }]. A bad entry is named and skipped. */
export function meshEntries(source = BUNDLED) {
  const out = [];
  for (const [id, entry] of Object.entries(source?.meshes || {})) {
    const problems = entryProblems(entry);
    if (problems.length) {
      console.warn(`[dk_city_meshes] "${id}" skipped: ${problems.join(', ')}`);
      continue;
    }
    out.push({ id, ...entry });
  }
  return out;
}

/** One Cesium ClippingPolygon per ring of the entry's area. */
export function clipPolygons(Cesium, entry) {
  return entry.area.rings.map((ring) => new Cesium.ClippingPolygon({
    positions: ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
  }));
}

/** Raise a tileset by `metres` along the vertical at its centre. */
export function liftMatrix(Cesium, tileset, metres) {
  const c = Cesium.Cartographic.fromCartesian(tileset.boundingSphere.center);
  const ground = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0.0);
  const raised = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, metres);
  return Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.subtract(raised, ground, new Cesium.Cartesian3()));
}

/**
 * Load every usable mesh in the background and keep Google's city, the
 * OSM boxes and the meshes agreeing on who draws where.
 *
 *   googlePhotoreal   Google's tileset or null (development without
 *                     ?google=1). Read for .show, clipped, never shown
 *                     or hidden from here.
 *   isNight           () => boolean. Only used when there is no Google
 *                     tileset to follow. A throw counts as "not night".
 *   onAreasChange     (polygons) => void. The areas of the meshes that
 *                     are up, for the OSM box clip.
 *
 *   -> { follow(), anyShown(), status(), console }
 */
export function createDanishCityMeshes({
  Cesium, viewer, googlePhotoreal = null, isNight = () => false,
  onAreasChange = () => {}, entries = meshEntries(),
} = {}) {
  const meshes = new Map();
  const supported = !!Cesium.ClippingPolygonCollection?.isSupported?.(viewer.scene);
  let googleKey = null;
  let shownNow = false;

  function night() {
    try { return !!isNight(); } catch (_) { return false; }
  }

  // Follow Google's city where it exists, so every mode keeps its look.
  function wantShown() {
    return googlePhotoreal ? !!googlePhotoreal.show : !night();
  }

  function upIds() {
    return [...meshes.values()].filter((m) => m.state === 'ready' && !m.forcedOff).map((m) => m.entry.id);
  }

  function changed() {
    const ids = upIds();
    const key = ids.join(',');
    if (key === googleKey) return;
    googleKey = key;
    const areas = ids.flatMap((id) => clipPolygons(Cesium, meshes.get(id).entry));
    if (googlePhotoreal) {
      const quality = Math.min(...ids.map((id) => meshes.get(id).entry.clipQuality ?? 0.5), 1);
      googlePhotoreal.clippingPolygons = areas.length
        ? new Cesium.ClippingPolygonCollection({ polygons: areas, inverse: false, quality })
        : undefined;
    }
    try { onAreasChange(ids.flatMap((id) => clipPolygons(Cesium, meshes.get(id).entry))); }
    catch (err) { console.warn('[dk_city_meshes] box clip update failed:', err?.message || err); }
    console.log(ids.length
      ? `[dk_city_meshes] Danish mesh up: ${ids.join(', ')}. Google's city clipped out there`
      : '[dk_city_meshes] no Danish mesh up. Google\'s city everywhere');
  }

  function load(entry) {
    const rec = { entry, tileset: null, state: 'loading', loaded: 0, failed: 0, error: null, forcedOff: false };
    meshes.set(entry.id, rec);
    Cesium.Cesium3DTileset.fromUrl(entry.url, { maximumScreenSpaceError: entry.maximumScreenSpaceError ?? 8 })
      .then((ts) => {
        rec.tileset = ts;
        ts.modelMatrix = liftMatrix(Cesium, ts, entry.liftM);
        ts.clippingPolygons = new Cesium.ClippingPolygonCollection({
          polygons: clipPolygons(Cesium, entry), inverse: true, quality: entry.clipQuality ?? 0.5,
        });
        // Up only once a tile with content has arrived, never on the
        // tileset.json alone: clipping Google's city out before anything
        // Danish is drawn would leave the city flat (the flat-Billund
        // lesson, 2026-10-18).
        ts.tileLoad.addEventListener(() => {
          rec.loaded += 1;
          if (rec.state === 'loading') { rec.state = 'ready'; changed(); }
        });
        ts.tileFailed.addEventListener((e) => {
          rec.failed += 1;
          if (rec.state !== 'failed' && rec.failed >= FAIL_LIMIT && rec.failed > rec.loaded) {
            rec.state = 'failed';
            rec.error = `${rec.failed} tiles failed: ${String(e?.message || e?.url || '').slice(0, 120)}`;
            ts.show = false;
            console.warn(`[dk_city_meshes] ${entry.label} keeps failing, Google's city covers it again`);
            changed();
          }
        });
        viewer.scene.primitives.add(ts);
        console.log(`[dk_city_meshes] ${entry.label}: loading, lift ${entry.liftM} m`);
      })
      .catch((err) => {
        rec.state = 'failed';
        rec.error = String(err?.message || err).slice(0, 160);
        console.warn(`[dk_city_meshes] ${entry.label} did not load, Google's city covers it:`, rec.error);
        changed();
      });
  }

  if (!supported) {
    console.warn('[dk_city_meshes] clipping needs WebGL2: no Danish meshes, Google\'s city everywhere as before');
  } else {
    for (const entry of entries) load(entry);
  }

  /** Per frame. Cheap: one read of Google's show flag, one compare per mesh. */
  function follow() {
    const want = wantShown();
    let any = false;
    for (const m of meshes.values()) {
      if (!m.tileset) continue;
      const s = want && m.state !== 'failed' && !m.forcedOff;
      if (m.tileset.show !== s) m.tileset.show = s;
      if (s && m.state === 'ready') any = true;
    }
    shownNow = any;
  }

  function status() {
    return [...meshes.values()].map((m) => ({
      id: m.entry.id,
      label: m.entry.label,
      state: m.forcedOff ? 'off (forced)' : m.state,
      shown: !!m.tileset?.show,
      tilesLoaded: m.loaded,
      tilesFailed: m.failed,
      liftM: m.entry.liftM,
      error: m.error,
    }));
  }

  return {
    follow,
    anyShown: () => shownNow,
    status,
    console: {
      status,
      /** Raise or lower one mesh live, in metres above its DVR90 heights. */
      lift(id, metres) {
        const m = meshes.get(id);
        if (!m || !m.tileset) return `no loaded mesh "${id}"`;
        if (!Number.isFinite(metres)) return 'pass metres as a number';
        m.entry = { ...m.entry, liftM: metres };
        m.tileset.modelMatrix = liftMatrix(Cesium, m.tileset, metres);
        return `${id} lifted ${metres} m`;
      },
      /** 'off' hides a mesh and gives its area back to Google's city; 'auto' undoes it. */
      force(id, which) {
        const m = meshes.get(id);
        if (!m) return `no mesh "${id}"`;
        if (which !== 'off' && which !== 'auto') return "use 'off' or 'auto'";
        m.forcedOff = which === 'off';
        changed();
        return `${id}: ${which}`;
      },
    },
  };
}
