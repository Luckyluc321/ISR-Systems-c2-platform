// ═══════════════════════════════════════════════════════════════════════════
// RENDER PROFILE — geospatial data-provider selection
// ═══════════════════════════════════════════════════════════════════════════
//
// Two profiles, one CesiumJS engine, single-flag switch:
//
//   'photoreal' (default) — Cesium Ion + Google Photorealistic 3D Tiles +
//                            OSM Buildings fallback + Cesium World Terrain.
//                            Best fidelity for demos and non-sovereign
//                            customers. Data resides on US-cloud (Google +
//                            Cesium Ion).
//
//   'sovereign'           — SDFI GeoDanmark ortho as primary imagery,
//                            Cesium World Terrain as interim (SDFI DHM
//                            pipeline TODO), Google Photorealistic 3D Tiles
//                            SKIPPED (no US-cloud dependency), OSM Buildings
//                            still loaded (OpenStreetMap is open-data,
//                            not sovereignty-blocked). 100% Danish data
//                            residency for imagery.
//
// How the flag is picked (in order, first match wins):
//   1. URL param     ?profile=sovereign|photoreal
//   2. localStorage  isr:render_profile
//   3. Default       'photoreal'
//
// To flip: open the page with ?profile=sovereign (or set the localStorage
// key). Reload. Zero code change per switch.
//
// Guarantee: with no flag set, EVERY existing render path behaves exactly
// as it did before this module was introduced. This module is additive.
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_PROFILE = 'photoreal';
const VALID_PROFILES = new Set(['photoreal', 'sovereign']);
const STORAGE_KEY = 'isr:render_profile';

let _cached = null;

export function getRenderProfile() {
  if (_cached) return _cached;

  // 1. URL param override (highest precedence)
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('profile');
    if (fromUrl && VALID_PROFILES.has(fromUrl)) {
      _cached = fromUrl;
      return _cached;
    }
  } catch (_) { /* ignore, fall through */ }

  // 2. localStorage override
  try {
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage && VALID_PROFILES.has(fromStorage)) {
      _cached = fromStorage;
      return _cached;
    }
  } catch (_) { /* ignore, fall through */ }

  // 3. Default
  _cached = DEFAULT_PROFILE;
  return _cached;
}

export function isPhotoreal() { return getRenderProfile() === 'photoreal'; }
export function isSovereign() { return getRenderProfile() === 'sovereign'; }

// For DevTools: read + set at runtime. Set requires reload to take effect
// (Cesium tilesets/imagery layers are wired at viewer init, not swappable
// live without a full re-init).
if (typeof window !== 'undefined') {
  window.__isr_renderProfile = () => getRenderProfile();
  window.__isr_setRenderProfile = (p) => {
    if (!VALID_PROFILES.has(p)) {
      console.warn(`[render_profile] invalid profile "${p}". Valid: ${[...VALID_PROFILES].join(', ')}`);
      return false;
    }
    try { localStorage.setItem(STORAGE_KEY, p); } catch (_) {}
    console.log(`[render_profile] set to "${p}". Reload to apply.`);
    return true;
  };
}
