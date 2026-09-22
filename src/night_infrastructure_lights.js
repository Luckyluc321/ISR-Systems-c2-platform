// ═══════════════════════════════════════════════════════════════════
// Night infrastructure lighting — static geometry loader
// ───────────────────────────────────────────────────────────────────
// Supplies the real-world geometry of things that are lit every night:
// the full street network, runways, taxiways, aprons, harbours and piers.
//
// Geometry is baked offline by scripts/bake-night-lights.mjs and shipped
// in public/night-lights/<siteId>.json. It is NOT fetched at runtime.
// That is not a shortcut — a full street network for one site returns
// HTTP 504 from the public Overpass endpoint in a single request, and
// tiling it live would mean tens of seconds of latency, a hard dependency
// on a rate-limited community endpoint, and a sovereignty problem for
// government customers. Baking removes all three.
//
// This also means nothing here is hand-authored. Adding a site is a
// re-run of the bake script, not a person typing coordinates.
// ═══════════════════════════════════════════════════════════════════

// Per-class light character. Colours follow real-world convention:
// sodium/amber for street lighting, white for runway, blue for taxiway
// edge lighting — the last of which is the most recognisable "this is an
// airport at night" cue there is.
//
// Widths are deliberately thin. At the altitude these render, a real lit
// street reads as a fine continuous line, not a string of discrete lamps.
// Tiered so the network has the dynamic range real night imagery has:
// motorways are bright continuous threads, residential streets are dim and
// fine, and the difference between them is most of what makes a lit country
// read as lit rather than as a wireframe.
//
// Colour follows Danish lamp reality: motorway and arterial lighting is
// largely converted to cool white LED, while older residential street
// lighting is still warm sodium. That warm/cool split is visible in real
// night imagery and is a large part of why it looks photographic.
export const LIGHT_STYLES = {
  motorway:    { color: '#fff0d4', width: 2.2, glowPower: 0.30, alpha: 0.95 },
  primary:     { color: '#ffd9a0', width: 1.7, glowPower: 0.26, alpha: 0.82 },
  tertiary:    { color: '#ffc078', width: 1.2, glowPower: 0.20, alpha: 0.62 },
  residential: { color: '#ffa94d', width: 0.9, glowPower: 0.16, alpha: 0.42 },
  runway:      { color: '#fff6e6', width: 2.6, glowPower: 0.30, alpha: 1.00 },
  taxiway:     { color: '#5cb3ff', width: 1.9, glowPower: 0.26, alpha: 0.92 },
  harbour:     { color: '#ffc06a', width: 1.6, glowPower: 0.24, alpha: 0.78 },
};

export const LIGHT_CLASSES = Object.keys(LIGHT_STYLES);

const _cache = new Map();

// Returns { roads:[[lat,lon,...]], runway:[], taxiway:[], harbour:[] }.
// Resolves to null when a site has no baked data, so callers can simply
// render nothing rather than handling errors.
// The national major-road layer, loaded alongside whichever site is in
// view. Without it the lit world stops dead at the edge of a site's baked
// box, which is the one artefact that never occurs in real night imagery.
export function loadNationalLights() {
  return loadSiteLights('_national');
}

export async function loadSiteLights(siteId) {
  if (!siteId) return null;
  if (_cache.has(siteId)) return _cache.get(siteId);
  try {
    const res = await fetch(`/night-lights/${siteId}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Compatibility with the first bake schema, which put every road class
    // into a single `roads` bucket before tiering existed. Treated as the
    // mid tier so an un-rebaked site still renders rather than going dark.
    if (Array.isArray(data.roads) && !data.tertiary) {
      data.tertiary = data.roads;
      delete data.roads;
    }
    _cache.set(siteId, data);
    return data;
  } catch (err) {
    console.error(`[night_lights] no baked lighting for site "${siteId}" (${err.message}). Run: node scripts/bake-night-lights.mjs ${siteId}`);
    _cache.set(siteId, null);
    return null;
  }
}
