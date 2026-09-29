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
// Calibrated against real aerial night photography of Copenhagen, where
// the city is a dense carpet of warm sodium threads covering every street
// and the airport is unremarkable within it.
//
// The first tiering attempt dimmed the lower classes to create contrast,
// which made the whole city darker than the untiered version — the exact
// opposite of the reference. Contrast has to come from lifting the major
// roads, never from sinking residential: residential is the overwhelming
// majority of ways (2096 of 3500 at CPH) and therefore *is* the visible
// city. If it is dim, there is no city.
//
// Colour is sodium orange throughout rather than white. Real Danish street
// lighting reads distinctly amber from the air, and white lines were a
// large part of why this looked like a wireframe rather than a photograph.
// `intensity` is the important field and is deliberately unbounded.
//
// Alpha cannot carry brightness: it is clamped to 1.0, so a scene built
// from alpha alone never produces a pixel above 1.0 — and HDR, ACES and
// bloom all do nothing whatsoever below 1.0. Enabling that pipeline while
// feeding it clamped values is why this looked flat no matter how the
// alphas were tuned; ACES on a never-above-1.0 image is purely a darkening
// operator. Brightness therefore rides on emission, which is unclamped.
//
// The spread matters as much as the absolute values. Real street lighting
// runs from roughly 1,000 to 40,000 lumens, a 40x range; the previous
// alphas spanned 0.85-1.00, a 1.18x range. That near-total lack of spread
// is what "no intensity variation" meant.
export const LIGHT_STYLES = {
  motorway:    { color: '#ffd9a0', width: 2.4, glowPower: 0.32, alpha: 1.00, intensity: 22 },
  primary:     { color: '#ffc582', width: 1.9, glowPower: 0.28, alpha: 0.95, intensity: 12 },
  tertiary:    { color: '#ffb163', width: 1.5, glowPower: 0.24, alpha: 0.90, intensity: 6 },
  residential: { color: '#ff9f4a', width: 1.3, glowPower: 0.22, alpha: 0.85, intensity: 3 },
  runway:      { color: '#fff6e6', width: 2.6, glowPower: 0.30, alpha: 1.00, intensity: 28 },
  taxiway:     { color: '#5cb3ff', width: 1.9, glowPower: 0.26, alpha: 0.92, intensity: 14 },
  harbour:     { color: '#ffb457', width: 1.7, glowPower: 0.26, alpha: 0.88, intensity: 8 },
};

export const LIGHT_CLASSES = Object.keys(LIGHT_STYLES);

// ── Measured-radiance bucketing ───────────────────────────────────
// Roads carry a per-way brightness multiplier sampled from NASA VIIRS
// night-lights imagery (see scripts/apply-night-radiance.py), so a
// residential street in a dense district renders brighter than the same
// class of street on the rural fringe. Without it every neighbourhood gets
// identical brightness, which is a large part of why this read as uniform.
//
// Applying it per way is not possible directly: all ways of a class batch
// into one primitive sharing one material, so intensity is per-primitive,
// not per-way. Bucketing into a handful of tiers gets the variation while
// keeping the draw count trivial — visually continuous, ~5 primitives per
// class instead of thousands.
export const RADIANCE_TIERS = 5;

export function bucketByRadiance(polylines, radiance, tiers = RADIANCE_TIERS) {
  const ways = polylines || [];
  if (!ways.length) return [];
  // No measured data (un-sampled site, or an older bake): one bucket at full
  // strength, i.e. exactly the previous uniform behaviour.
  if (!Array.isArray(radiance) || radiance.length !== ways.length) {
    return [{ factor: 1, polylines: ways }];
  }
  const groups = new Map();
  for (let i = 0; i < ways.length; i++) {
    const m = Math.min(1, Math.max(0, radiance[i] ?? 1));
    // Tier index, then the tier's midpoint as the representative factor.
    const t = Math.min(tiers - 1, Math.floor(m * tiers));
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(ways[i]);
  }
  return [...groups.entries()]
    .map(([t, pl]) => ({ factor: (t + 0.5) / tiers, polylines: pl }))
    .sort((a, b) => a.factor - b.factor);
}

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
