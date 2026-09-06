// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN GEO ROUTING — auto-derive destination candidates via DAGI
// ═══════════════════════════════════════════════════════════════════════════
//
// The product-value payoff for loading DAGI polygons: when a threat fires
// at site coordinates, we point-in-polygon against kommune/politikreds/
// region layers to auto-select the correct local destinations, instead of
// requiring hand-configured `destinationsForSite()` entries per site.
//
// Result: adding a new site becomes just adding coordinates. Escalation
// destinations materialise from geography.
//
// Design:
//   1. LAZY. DAGI polygons are only fetched when a geo lookup is
//      requested (they are large — ~30MB kommunegrænser). Cached in
//      memory for the session + optional IndexedDB cache (TODO).
//   2. ADDITIVE. Existing destinationsForSite() still works verbatim.
//      This module provides destinationsForSiteGeo() as an ADDITIONAL
//      resolver that callers can merge in.
//   3. FAIL-SAFE. If polygons haven't loaded or DAWA credentials aren't
//      configured, returns []. Never throws. Existing hand-configured
//      destinations remain the guaranteed baseline.
//   4. ROLES-DRIVEN. Maps a resolved kommune-name → matching roles.js
//      receiver id (e.g. "Billund" → "kom-billund"). Same for politikreds
//      + region.
// ═══════════════════════════════════════════════════════════════════════════

// ── Kommune-name → roles.js receiver id map ─────────────────────────────
// DAGI navn field uses Danish letters. roles.js receiver ids use ascii
// slugs (kom-koebenhavn, kom-aeroe, etc). Map explicit — safer than
// slugify heuristics.
const KOMMUNE_TO_RECEIVER = Object.freeze({
  'Albertslund': 'kom-albertslund', 'Allerød': 'kom-alleroed', 'Assens': 'kom-assens',
  'Ballerup': 'kom-ballerup', 'Billund': 'kom-billund', 'Bornholm': 'kom-bornholm',
  'Brøndby': 'kom-broendby', 'Brønderslev': 'kom-broenderslev',
  // Note: Christiansø/Ertholmene is NOT a kommune (administered directly by
  // Forsvarsministeriet, ~90 residents) — deliberately omitted; DAGI's
  // kommuneinddeling_current doesn't list it either.
  'Dragør': 'kom-dragoer', 'Egedal': 'kom-egedal', 'Esbjerg': 'kom-esbjerg',
  'Fanø': 'kom-fanoe', 'Favrskov': 'kom-favrskov', 'Faxe': 'kom-faxe',
  'Fredensborg': 'kom-fredensborg', 'Fredericia': 'kom-fredericia', 'Frederiksberg': 'kom-frederiksberg',
  'Frederikshavn': 'kom-frederikshavn', 'Frederikssund': 'kom-frederikssund', 'Furesø': 'kom-furesoe',
  'Faaborg-Midtfyn': 'kom-faaborg-midtfyn', 'Gentofte': 'kom-gentofte', 'Gladsaxe': 'kom-gladsaxe',
  'Glostrup': 'kom-glostrup', 'Greve': 'kom-greve', 'Gribskov': 'kom-gribskov',
  'Guldborgsund': 'kom-guldborgsund', 'Haderslev': 'kom-haderslev', 'Halsnæs': 'kom-halsnaes',
  'Hedensted': 'kom-hedensted', 'Helsingør': 'kom-helsingoer', 'Herlev': 'kom-herlev',
  'Herning': 'kom-herning', 'Hillerød': 'kom-hilleroed', 'Hjørring': 'kom-hjoerring',
  'Holbæk': 'kom-holbaek', 'Holstebro': 'kom-holstebro', 'Horsens': 'kom-horsens',
  'Hvidovre': 'kom-hvidovre', 'Høje-Taastrup': 'kom-hoeje-taastrup', 'Hørsholm': 'kom-hoersholm',
  'Ikast-Brande': 'kom-ikast-brande', 'Ishøj': 'kom-ishoej', 'Jammerbugt': 'kom-jammerbugt',
  'Kalundborg': 'kom-kalundborg', 'Kerteminde': 'kom-kerteminde', 'Kolding': 'kom-kolding',
  'København': 'kom-koebenhavn', 'Køge': 'kom-koege', 'Langeland': 'kom-langeland',
  'Lejre': 'kom-lejre', 'Lemvig': 'kom-lemvig', 'Lolland': 'kom-lolland',
  'Lyngby-Taarbæk': 'kom-lyngby-taarbaek', 'Læsø': 'kom-laesoe', 'Mariagerfjord': 'kom-mariagerfjord',
  'Middelfart': 'kom-middelfart', 'Morsø': 'kom-morsoe', 'Norddjurs': 'kom-norddjurs',
  'Nordfyns': 'kom-nordfyns', 'Nyborg': 'kom-nyborg', 'Næstved': 'kom-naestved',
  'Odder': 'kom-odder', 'Odense': 'kom-odense', 'Odsherred': 'kom-odsherred',
  'Randers': 'kom-randers', 'Rebild': 'kom-rebild', 'Ringkøbing-Skjern': 'kom-ringkoebing-skjern',
  'Ringsted': 'kom-ringsted', 'Roskilde': 'kom-roskilde', 'Rudersdal': 'kom-rudersdal',
  'Rødovre': 'kom-roedovre', 'Samsø': 'kom-samsoe', 'Silkeborg': 'kom-silkeborg',
  'Skanderborg': 'kom-skanderborg', 'Skive': 'kom-skive', 'Slagelse': 'kom-slagelse',
  'Solrød': 'kom-solroed', 'Sorø': 'kom-soroe', 'Stevns': 'kom-stevns',
  'Struer': 'kom-struer', 'Svendborg': 'kom-svendborg', 'Syddjurs': 'kom-syddjurs',
  'Sønderborg': 'kom-soenderborg', 'Thisted': 'kom-thisted', 'Tønder': 'kom-toender',
  'Tårnby': 'kom-taarnby', 'Vallensbæk': 'kom-vallensbaek', 'Varde': 'kom-varde',
  'Vejen': 'kom-vejen', 'Vejle': 'kom-vejle', 'Vesthimmerlands': 'kom-vesthimmerlands',
  'Viborg': 'kom-viborg', 'Vordingborg': 'kom-vordingborg', 'Ærø': 'kom-aeroe',
  'Aabenraa': 'kom-aabenraa', 'Aalborg': 'kom-aalborg', 'Aarhus': 'kom-aarhus',
});

// ── Politikreds-name → receiver id map (12 politikredse) ────────────────
const POLITIKREDS_TO_RECEIVER = Object.freeze({
  'Bornholms Politi': 'politi-bornholm',
  'Fyns Politi': 'politi-fyn',
  'Københavns Politi': 'politi-kbh',
  'Københavns Vestegns Politi': 'politi-vestegn',
  'Midt- og Vestjyllands Politi': 'politi-midtvestjyl',
  'Midt- og Vestsjællands Politi': 'politi-midtvestsjaelland',
  'Nordjyllands Politi': 'politi-nordjyl',
  'Nordsjællands Politi': 'politi-nordsj',
  'Syd- og Sønderjyllands Politi': 'politi-sydsonderjyl',
  'Sydsjællands og Lolland-Falsters Politi': 'politi-sydsjaelland',
  'Sydøstjyllands Politi': 'politi-sydostjyl',
  'Østjyllands Politi': 'politi-ostjyl',
});

// ── Region-name → receiver id map ──────────────────────────────────────
const REGION_TO_RECEIVER = Object.freeze({
  'Region Hovedstaden': 'region-hst',
  'Region Sjælland': 'region-sjl',
  'Region Syddanmark': 'region-syd',
  'Region Midtjylland': 'region-midt',
  'Region Nordjylland': 'region-nord',
});

// ── Cache of DAGI GeoJSON pulls ────────────────────────────────────────
const _cache = {
  kommuner: null,        // GeoJSON FeatureCollection
  politikredse: null,
  regioner: null,
  fetchedAt: null,
};

// Load DAGI layer via direct Datafordeler WFS. Reuses same auth as the
// DAGI layer entries in sovereign_layers.js — expects VITE_DATAFORDELER_CREDS
// to be set (which is required for BBR already).
async function _fetchDagi(typename, credsToken) {
  if (!credsToken) throw new Error('Datafordeler creds missing — set VITE_DATAFORDELER_CREDS in .env.local.');
  const [user, pass] = String(credsToken).split(':');
  if (!user || !pass) throw new Error('Datafordeler creds must be "user:pass".');
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typenames: `dagi_v001:${typename}_current`,
    outputFormat: 'application/json',
    srsname: 'EPSG:4326',
    username: user,
    password: pass,
  });
  const url = `https://wfs.datafordeler.dk/DAGI/DAGI_WFS/1.0.0/WFS?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DAGI ${typename} fetch failed: ${res.status}`);
  return await res.json();
}

// Point-in-polygon test (ray-casting). Handles Polygon + MultiPolygon +
// polygon HOLES (rings after the first are treated as holes — a point
// inside a hole is NOT inside the polygon). Correctness matters for
// København (contains Frederiksberg as a hole/enclave).
function _ringContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function _pointInFeature(lon, lat, feature) {
  const g = feature.geometry;
  if (!g) return false;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) {
    if (!poly[0]) continue;
    // Must be inside outer ring AND outside all holes
    if (!_ringContains(poly[0], lon, lat)) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) {
      if (_ringContains(poly[h], lon, lat)) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

// ── Public API ─────────────────────────────────────────────────────────

// Prime the cache — fetch all three DAGI layers. Promise.allSettled so
// a single flaky endpoint doesn't nuke the whole prime. Layers that
// succeed are cached; failures leave that layer null and resolveAdmin*
// handles that gracefully.
export async function primeDagiCache(credsToken) {
  const results = await Promise.allSettled([
    _fetchDagi('kommuneinddeling', credsToken),
    _fetchDagi('politikreds',      credsToken),
    _fetchDagi('regionsinddeling', credsToken),
  ]);
  const [k, p, r] = results;
  if (k.status === 'fulfilled') _cache.kommuner = k.value;
  else console.warn('[geo_routing] kommuner prime failed:', k.reason?.message || k.reason);
  if (p.status === 'fulfilled') _cache.politikredse = p.value;
  else console.warn('[geo_routing] politikredse prime failed:', p.reason?.message || p.reason);
  if (r.status === 'fulfilled') _cache.regioner = r.value;
  else console.warn('[geo_routing] regioner prime failed:', r.reason?.message || r.reason);
  _cache.fetchedAt = new Date().toISOString();
  return {
    kommuner: _cache.kommuner?.features?.length || 0,
    politikredse: _cache.politikredse?.features?.length || 0,
    regioner: _cache.regioner?.features?.length || 0,
  };
}

// Resolve a lat/lon point to the DAGI admin polygons containing it.
// Null-safe per layer — if a layer failed to prime, that field stays null.
export function resolveAdminPolygons(lat, lon) {
  const out = { kommune: null, politikreds: null, region: null };
  for (const f of (_cache.kommuner?.features || [])) {
    if (_pointInFeature(lon, lat, f)) { out.kommune = f.properties?.navn || null; break; }
  }
  for (const f of (_cache.politikredse?.features || [])) {
    if (_pointInFeature(lon, lat, f)) { out.politikreds = f.properties?.navn || null; break; }
  }
  for (const f of (_cache.regioner?.features || [])) {
    if (_pointInFeature(lon, lat, f)) { out.region = f.properties?.navn || null; break; }
  }
  return out;
}

// Turn a resolved admin polygon set into destination receiver ids.
// Callers merge these with hand-configured destinationsForSite() results.
export function receiverIdsForPoint(lat, lon) {
  const admins = resolveAdminPolygons(lat, lon);
  const ids = [];
  if (admins.kommune && KOMMUNE_TO_RECEIVER[admins.kommune]) ids.push(KOMMUNE_TO_RECEIVER[admins.kommune]);
  if (admins.politikreds && POLITIKREDS_TO_RECEIVER[admins.politikreds]) ids.push(POLITIKREDS_TO_RECEIVER[admins.politikreds]);
  if (admins.region && REGION_TO_RECEIVER[admins.region]) ids.push(REGION_TO_RECEIVER[admins.region]);
  return { ids, admins };
}

export function isDagiCachePrimed() { return !!_cache.kommuner; }
export function dagiCacheStats() {
  return {
    primed: isDagiCachePrimed(),
    kommuner: _cache.kommuner?.features?.length || 0,
    politikredse: _cache.politikredse?.features?.length || 0,
    regioner: _cache.regioner?.features?.length || 0,
    fetchedAt: _cache.fetchedAt,
  };
}
