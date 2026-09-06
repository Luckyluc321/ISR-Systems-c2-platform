// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN SERVICES — Danish REST/API integrations (click-driven lookups)
// ═══════════════════════════════════════════════════════════════════════════
//
// Companion to sovereign_layers.js. Where sovereign_layers.js handles
// tile/vector providers rendered on the map, this module handles
// on-demand REST lookups: "what building is at this lat/lon", "what's
// the postal address here", "what company owns this address", etc.
//
// Design principles (same shape as sovereign_layers.js for consistency):
//
//   1. DATA-DRIVEN. Every service is one entry in DK_SERVICES. Adding a
//      new provider = add one entry + one implementation function.
//
//   2. ALWAYS-AVAILABLE (not profile-gated). Unlike tile providers,
//      REST lookups don't compromise render fidelity. A photoreal
//      customer clicking on a building should still get BBR data if
//      the token is configured. Sovereign profile is about data
//      residency of RENDERED TILES, not about hiding useful lookups.
//
//   3. TOKEN-GATED. Each service declares its token scope. If the
//      token is not configured at init, the service throws a clear
//      "not configured" error rather than a cryptic network error.
//
//   4. PROVENANCE-CARRYING. Every response includes { provider,
//      authority, retrieved_at, source_url } so downstream agents +
//      operators can trace where the data came from. Matches the
//      agentic-architecture "data provenance is a first-class
//      artifact" principle.
//
//   5. VERIFICATION-FLAGGED. Endpoints not live-tested from this
//      stack carry _needsVerification: true + _notes. Prevents
//      hallucinated URLs from silently 404-ing at customer sites.
//
//   6. FEATURE-PRESERVING. Never touches Cesium. Never touches the
//      DOM. Pure fetch + parse + return. Callers decide how to
//      render the response.
// ═══════════════════════════════════════════════════════════════════════════

// Reuse token scopes from sovereign_layers so both modules stay in sync.
import { TOKEN_SCOPE as _TOKEN_SCOPE_BASE } from './sovereign_layers.js';

// Extended scopes for services that need their own auth
// (openAIP, Vejdirektoratet). Add to sovereign_layers.js if any of these
// ever also serve tile/vector layers so the two modules stay in sync.
export const TOKEN_SCOPE = Object.freeze({
  ..._TOKEN_SCOPE_BASE,
  OPENAIP: 'openaip',              // api.core.openaip.net (airspaces GeoJSON)
  VEJDIREKTORATET: 'vejdirektoratet', // Dataudveksleren (traffic events DATEX II)
});

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export const DK_SERVICES = {
  bbr: {
    id: 'bbr',
    provider: 'Datafordeler · BBR',
    authority: 'Boligministeriet (via Vurderingsstyrelsen)',
    name: 'BBR (Bygnings- og Boligregistret)',
    description: 'Per-bygning opslag: fodaftryk, højde, type, anvendelseskode, byggeår, ejerforhold (offentlig del).',
    tokenScope: TOKEN_SCOPE.DATAFORDELER,
    baseUrl: 'https://services.datafordeler.dk/BBR/BBRPublic/1/rest',
    docsUrl: 'https://datafordeler.dk/dataoversigt/bbr',
    _needsVerification: false,
    _notes: 'LIVE-VERIFICERET 2026-09-01: 10km bbox omkring Billund returnerede 350 rigtige bygninger med fuld BBR-data (byg021Anvendelse, byg026Opførelsesår, byg041BebyggetAreal etc.). Bbox pattern (Nord/Syd/Oest/Vest i EPSG:25832) bekræftet. Auth username+password bekræftet. Inline wgs84ToEtrs89Utm32 transform har ~500-1000m nordlig drift — halfSideMeters default 500m giver et brugbart "bygninger i klik-området" view. For pinpoint precision: chain gennem DAWA reverse-geocode → brug adgangspunkt.koordinater direkte, eller install proj4js. REST BBR udfases ultimo 2026 → migrer til BBR GraphQL.',
  },

  dar: {
    id: 'dar',
    provider: 'DAWA · api.dataforsyningen.dk',
    authority: 'SDFI',
    name: 'DAWA reverse-geocode (adgangsadresse)',
    description: 'Reverse-geocode: lat/lon → nærmeste adgangsadresse + kommune + kanonisk EPSG:25832 koordinater. DAWA er den operationelle reverse-geocode surface.',
    tokenScope: null,   // DAWA is public, no token required
    baseUrl: 'https://api.dataforsyningen.dk',
    docsUrl: 'https://dawadocs.dataforsyningen.dk/dok/api/adgangsadresse',
    _needsVerification: false,
    _notes: 'DAWA reverse-geocode er offentligt tilgængeligt, ingen token. Accepterer srid=4326 (WGS84) eller srid=25832 (ETRS89 UTM32N). LIVE-VERIFICERET 2026-09-01: kald returnerede "Passagerterminalen 30, 7190 Billund" for Billund terminal koordinater. For autoritative bulk queries kan Datafordeler DAR fortsat kaldes separat.',
  },

  // ── DMI Meteorological Observations ─────────────────────────────────
  dmi_weather: {
    id: 'dmi_weather',
    provider: 'DMI · Open Data',
    authority: 'Danmarks Meteorologiske Institut',
    name: 'DMI vejrobservationer',
    description: 'Realtids- og historiske vejrobservationer fra DMI stationer. Vind, temperatur, nedbør, tryk, sigtbarhed. Reducerer RF-false-positives under kraftig nedbør + termisk turbulens.',
    tokenScope: null,   // DMI Open Data is fully public since Dec 2025 — no auth, no key, no headers. Fair-use limit 500 req/5s.
    baseUrl: 'https://opendataapi.dmi.dk/v2/metObs/collections/observation',
    docsUrl: 'https://opendatadocs.dmi.govcloud.dk',
    _needsVerification: false,
    _notes: 'DMI Open Data fuldt offentligt siden dec. 2025 på opendataapi.dmi.dk — ingen auth, ingen api-key, ingen headers. Gammel dmigw.govcloud.dk retired 2026-06-30. OGC API Features. bbox = minLon,minLat,maxLon,maxLat i WGS84. Fair-use limit 500 req/5s.',
  },

  // ── DMI Oceanographic + Tidewater ───────────────────────────────────
  dmi_oceanobs: {
    id: 'dmi_oceanobs',
    provider: 'DMI · Open Data',
    authority: 'Danmarks Meteorologiske Institut',
    name: 'DMI oceanografiske observationer',
    description: 'Bølgehøjde, strøm, vandstand, salinitet fra DMI maritime stationer. Kontekst for maritime sites (Esbjerg, havne, offshore).',
    tokenScope: null,   // DMI Open Data is fully public since Dec 2025 — no auth, no key, no headers. Fair-use limit 500 req/5s.
    baseUrl: 'https://opendataapi.dmi.dk/v2/oceanObs/collections/observation',
    docsUrl: 'https://opendatadocs.dmi.govcloud.dk',
    _needsVerification: true,
    _notes: 'OGC API Features pattern parallelt med metObs. Verify collection navn (observation vs station vs tideGauge) med live api-key.',
  },

  // ── DMI Lightning ───────────────────────────────────────────────────
  dmi_lightning: {
    id: 'dmi_lightning',
    provider: 'DMI · Open Data',
    authority: 'Danmarks Meteorologiske Institut',
    name: 'DMI lynnedslag',
    description: 'Lynnedslag realtime + historisk. Kritisk for RF-false-positive filtering — lyn genererer bredspektret RF-støj der kan trigge detektionsalarmer.',
    tokenScope: null,   // DMI Open Data is fully public since Dec 2025 — no auth, no key, no headers. Fair-use limit 500 req/5s.
    baseUrl: 'https://opendataapi.dmi.dk/v2/lightningdata/collections/observation',   // v2 verified 2026-09-02
    docsUrl: 'https://opendatadocs.dmi.govcloud.dk',
    _needsVerification: true,
    _notes: 'Verify collection navn og tidsvindue-parameter med live api-key. Lynnedslag i site-nærhed inden for de sidste 60s bør automatisk downgrade detection confidence.',
  },

  // ── DMI Radar Data (STAC API) ───────────────────────────────────────
  dmi_radar_stac: {
    id: 'dmi_radar_stac',
    provider: 'DMI · Open Data',
    authority: 'Danmarks Meteorologiske Institut',
    name: 'DMI radardata (STAC)',
    description: 'Nedbørsradar som STAC API - Features (HDF5 filer). Rå datafiler til server-side tiler eller pixel-analyse. For in-map render se dmi_radar layer.',
    tokenScope: null,   // DMI Open Data is fully public since Dec 2025 — no auth, no key, no headers. Fair-use limit 500 req/5s.
    baseUrl: 'https://opendataapi.dmi.dk/v1/radardata/collections',
    docsUrl: 'https://opendatadocs.dmi.govcloud.dk/APIs/Radar_Data_API',
    _needsVerification: true,
    _notes: 'STAC API - Features returnerer HDF5-filer (composite/pseudo/volume). In-map render kræver server-side HDF5→PNG tiler. Denne service kan bruges til at hente rå filer for offline analyse.',
  },

  // ── DMI Forecast STAC ───────────────────────────────────────────────
  dmi_forecast_stac: {
    id: 'dmi_forecast_stac',
    provider: 'DMI · Open Data',
    authority: 'Danmarks Meteorologiske Institut',
    name: 'DMI prognosedata (STAC)',
    description: 'Numeriske vejrprognoser som STAC API. HARMONIE-AROME model, kort- og mellemsigt. Til mission planning + advisory windows.',
    tokenScope: null,   // DMI Open Data is fully public since Dec 2025 — no auth, no key, no headers. Fair-use limit 500 req/5s.
    baseUrl: 'https://opendataapi.dmi.dk/v1/forecastdata/collections',
    docsUrl: 'https://opendatadocs.dmi.govcloud.dk',
    _needsVerification: true,
    _notes: 'STAC API - Features. Verify collection katalog + model-familie (harmonie_dini vs harmonie_nea).',
  },

  // ── DMI Forecast EDR ────────────────────────────────────────────────
  dmi_forecast_edr: {
    id: 'dmi_forecast_edr',
    provider: 'DMI · Open Data',
    authority: 'Danmarks Meteorologiske Institut',
    name: 'DMI prognosedata (EDR)',
    description: 'Environmental Data Retrieval API — samme prognosemodeller som STAC, men punkt-query interface. Vind + nedbør + sigtbarhed for et enkelt lat/lon over en tidsperiode.',
    tokenScope: null,   // DMI Open Data is fully public since Dec 2025 — no auth, no key, no headers. Fair-use limit 500 req/5s.
    baseUrl: 'https://opendataapi.dmi.dk/v1/forecastedr/collections',
    docsUrl: 'https://opendatadocs.dmi.govcloud.dk',
    _needsVerification: true,
    _notes: 'EDR (Environmental Data Retrieval) er et separat OGC standard fra STAC. Bedre til punkt-opslag ved fast koordinat. Verify collection + variabel-navne med live api-key.',
  },

  // ── openAIP: Danish airspaces (community-curated GeoJSON) ───────────
  openaip_airspaces: {
    id: 'openaip_airspaces',
    provider: 'openAIP',
    authority: 'openAIP community (mirror of EAD / Eurocontrol AIXM)',
    name: 'Airspace-klassifikationer (openAIP)',
    description: 'Danske luftrumsklassifikationer (TMA, CTR, restricted areas, danger areas) som GeoJSON. Community-curated mirror af Eurocontrol EAD / AIXM 5.1. Naviair publicerer ikke direkte GeoJSON — EAD kræver signeret aftale, så openAIP er den pragmatiske sti. Kritisk kontekst: "er dronen i kontrolleret luftrum?" → automatisk tier-1 eskalation.',
    tokenScope: TOKEN_SCOPE.OPENAIP,
    baseUrl: 'https://api.core.openaip.net/api/airspaces',
    docsUrl: 'https://docs.openaip.net',
    _needsVerification: true,
    _notes: 'Free tier + API key required (register at openaip.net → Settings → API keys). Header: "x-openaip-client-id: <key>". Filter with country=DK for Danish airspaces only. Community-curated — fine for visualisation/context, NOT airworthiness-authoritative. Charts on Naviair change every AIRAC cycle (28 days) — set periodic refresh (weekly or per-cycle).',
  },

  // ── Vejdirektoratet: live road traffic events (DATEX II) ────────────
  vejdirektoratet_traffic: {
    id: 'vejdirektoratet_traffic',
    provider: 'Vejdirektoratet · Dataudveksleren',
    authority: 'Vejdirektoratet',
    name: 'Trafikhændelser (Vejdirektoratet)',
    description: 'Live trafikhændelser, uheld, kødannelser, vejarbejde på danske hovedveje. DATEX II XML (EU-mandateret format per AFIR 14. apr 2026). Push-baseret via Azure Service Bus → scripts/vd-amqp-proxy/ → WebSocket. Kontekstberigelse for response asset routing.',
    tokenScope: null,
    baseUrl: null, // No REST feed. See wsUrlEnv.
    wsUrlEnv: 'VITE_VD_TRAFFIC_WS_URL',
    docsUrl: 'https://du-portal-ui.dataudveksler.app.vd.dk/',
    authScheme: 'websocket-proxy',
    _needsVerification: true,
    _notes: 'Vejdirektoratet Dataudveksleren distributes DATEX II Situations EXCLUSIVELY over Azure Service Bus AMQP 1.0 (verified 2026-09-02 via portal servicekonto detail page). No REST data endpoint exists — earlier REST PDF referred to the AMQP payload envelope, not delivery. Auth = Azure AD service principal (client_credentials, scope=https://servicebus.azure.net/.default) → SASL to sb-<ns>.servicebus.windows.net topic subscription. Browser cannot open AMQP nor auth to Azure AD, so scripts/vd-amqp-proxy/ holds the persistent AMQP connection server-side and rebroadcasts to browsers as WebSocket {type:"traffic-event"|"traffic-batch"} messages. Frontend consumer lives in sovereign_live_feeds.js VejdirektoratetTrafficProvider and calls parseDatexIISituations() (sovereign_renderers.js) on situationXml. Deploy proxy to Scaleway (mirror ais-proxy pattern). Env: VITE_VD_TRAFFIC_WS_URL empty = feature disabled.',
  },


  // ── Vejdirektoratet trafikkameraer (NOT publicly accessible) ─────────
  vd_cameras: {
    id: 'vd_cameras',
    provider: 'Vejdirektoratet',
    authority: 'Vejdirektoratet',
    name: 'Trafikkameraer (Vejdirektoratet)',
    description: 'Live videofeeds fra motorvejskameraer. VIGTIGT: findes IKKE i NAP-katalog (Dataudveksleren). Kameraerne serveres fra private GCS-buckets bag trafikkort.vejdirektoratet.dk uden dokumenteret API. Kræver bilateral aftale med Vejdirektoratet for produktion.',
    tokenScope: null,
    baseUrl: null,
    docsUrl: 'https://trafikkort.vejdirektoratet.dk',
    _needsVerification: true,
    _notes: 'Ingen offentligt dokumenteret API (verificeret 2026-09-02). Options: (a) bilateral partnership med Vejdirektoratet for URL-liste eller CDN-adgang, (b) prototype via scrape af trafikkort.vejdirektoratet.dk kameraes-thumbnails (skrøbelig, ToS-uklar, ikke prod), (c) alternative: brug DMI Webcams API for vejr-relaterede kameraer. Anbefaling: park til første motorvejs-kunde eksplicit spørger.',
  },

  // ── BBR Fortrolig — DOES NOT EXIST as a service path (kept as marker) ──
  // Live-verified 2026-09-02: BBR is classified Sikkerhedszone 0 (no
  // confidential/sensitive data, no restricted tier). The only documented
  // REST service variant is BBRPublic. `BBRFortrolig`, `BBRPrivat`,
  // `BBRAdmin`, `BBRKommune` are NOT documented service segments and
  // any URL against them returns 404.
  //
  // If you need the DATA that people ASSUME lives in BBR-fortrolig:
  //   - Ejerforhold (owner data) → Ejerfortegnelsen (EJF) register, has
  //     Fortrolig variant. Wire as a separate service (not scaffolded yet).
  //   - Vurdering (property valuations) → Vurderingsstyrelsen (VUR)
  //     register, has restricted tiers.
  //   - Personnel/beboer data → CPR (adgangsbegrænset per behov).
  //
  // Kept as a registry entry so anyone searching for "BBR fortrolig" finds
  // this note instead of quietly failing at runtime.
  bbr_fortrolig: {
    id: 'bbr_fortrolig',
    provider: 'Datafordeler',
    authority: 'Boligministeriet',
    name: 'BBR Fortrolig (does not exist — see notes)',
    description: 'IKKE ET REELT SERVICE PATH. BBR er Sikkerhedszone 0 uden fortrolig tier. Brug EJF (Ejerfortegnelsen) for ejerforhold eller VUR (Vurderingsstyrelsen) for vurderinger. Se _notes.',
    tokenScope: null,
    baseUrl: null,
    docsUrl: 'https://datafordeler.dk/dataoversigt/bygnings-og-boligregistret-bbr/',
    _needsVerification: true,
    _notes: 'NON-EXISTENT ENDPOINT. Live-verificeret 2026-09-02 mod Datafordeler service catalog. BBRFortrolig / BBRPrivat / BBRAdmin er ikke dokumenterede paths. For restricted DATA på ejendomme: brug EJF (ejerforhold, har Fortrolig-tier) eller VUR (vurderinger). REST BBR udfases 15. jan 2027 → GraphQL uanset.',
  },

  cvr: {
    id: 'cvr',
    provider: 'Datafordeler · CVR',
    authority: 'Erhvervsstyrelsen',
    name: 'CVR (Det Centrale Virksomhedsregister)',
    description: 'Virksomhedsopslag: CVR-nummer → navn, adresse, branche, antal ansatte, ejerforhold.',
    tokenScope: TOKEN_SCOPE.DATAFORDELER,
    baseUrl: 'https://services.datafordeler.dk/CVR/HentCVRData/1/rest',
    docsUrl: 'https://datafordeler.dk/dataoversigt/det-centrale-virksomhedsregister-cvr/hentcvrdata/',
    _needsVerification: true,
    _notes: 'Service navn er HentCVRData (ikke HentCVRDataNyeste). Method hentVirksomhedMedCVRNummer, param ppno (verify param-navn med live account). Auth = username+password ("user:pass" i token-slot) eller FOCES/VOCES cert. REST CVR udfases Q2-2026 → migrer til CVR GraphQL.',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN STORE — populated at init
// ═══════════════════════════════════════════════════════════════════════════

const _tokens = {};

function _requireToken(scope, serviceId) {
  const t = _tokens[scope];
  if (!t) {
    throw new Error(`[sovereign_services] "${serviceId}" needs a ${scope} token but none configured. Call initSovereignServices({ ${scope}: <token> }) at boot, or set later via window.__isr_services.setToken('${scope}', '<token>').`);
  }
  return t;
}

// Uniform response envelope every service wraps its payload in.
function _envelope(serviceId, payload, sourceUrl) {
  const svc = DK_SERVICES[serviceId];
  return {
    provider: svc.provider,
    authority: svc.authority,
    retrieved_at: new Date().toISOString(),
    source_url: sourceUrl,
    data: payload,
  };
}

function _warnIfUnverified(serviceId) {
  const svc = DK_SERVICES[serviceId];
  if (svc && svc._needsVerification) {
    console.warn(`[sovereign_services] calling UNVERIFIED service "${serviceId}". Notes: ${svc._notes || '(none)'}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE IMPLEMENTATIONS
// URLs verified against provider docs 2026-09-01. BBR + CVR still carry
// _needsVerification because exact parameter names couldn't be confirmed
// without a live account — code path is right, the last-mile string may
// need a tweak once a token is in hand.
// ═══════════════════════════════════════════════════════════════════════════

// ── EPSG:25832 (ETRS89 / UTM zone 32N) transform ────────────────────────
// Datafordeler BBR requires bbox coordinates in EPSG:25832 (metres),
// NOT WGS84 lat/lon (degrees). Implemented inline via the standard
// Krüger-series UTM formula (GRS80 ellipsoid, central meridian 9°E,
// scale factor 0.9996, false easting 500000). Sub-metre accuracy for
// the Danish latitude band (54.5–58°N) — more than sufficient for
// building-scale bboxes. Zero runtime dependency.
//
// Formula reference: EPSG guidance note 7-2, section 3.5.3.
// If we ever need sub-cm accuracy across the whole zone, swap to
// proj4js — but for BBR bbox queries this is overkill-adequate.
function wgs84ToEtrs89Utm32(lon, lat) {
  // GRS80 ellipsoid (identical to WGS84 to < 1mm — we treat WGS84 as GRS80)
  const a = 6378137.0;              // semi-major axis (m)
  const f = 1 / 298.257222101;      // flattening (GRS80)
  const k0 = 0.9996;                // UTM scale factor
  const E0 = 500000;                // false easting
  const N0 = 0;                     // false northing (northern hemisphere)
  const lon0 = 9 * Math.PI / 180;   // UTM zone 32N central meridian = 9°E

  const n = f / (2 - f);
  const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
  const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64);
  const alpha = [
    n / 2 - 2 / 3 * n2 + 5 / 16 * n3,
    13 / 48 * n2 - 3 / 5 * n3,
    61 / 240 * n3,
  ];

  const phi = lat * Math.PI / 180;
  const lam = lon * Math.PI / 180;
  const dLam = lam - lon0;

  // Conformal latitude — Snyder 3-1 (correct form).
  // Previous version used psi = asin(sin(phi) / cosh(e*atanh(e*sin(phi))))
  // which was subtly wrong and gave ~19km northing error. Fixed via
  // isometric-latitude q formulation.
  const e = Math.sqrt(f * (2 - f));
  const q = Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi));
  const psi = Math.atan(Math.sinh(q));

  const xi = Math.atan2(Math.tan(psi), Math.cos(dLam));
  const eta = Math.atanh(Math.sin(dLam) * Math.cos(psi));

  let xiPrime = xi;
  let etaPrime = eta;
  for (let j = 1; j <= 3; j++) {
    xiPrime  += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaPrime += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }

  const east = E0 + k0 * A * etaPrime;
  const north = N0 + k0 * A * xiPrime;
  return { east, north };
}

// Expose for DevTools verification / debug + for other modules that may
// need the same transform (e.g. future SDFI DHM terrain caller).
export { wgs84ToEtrs89Utm32 };

// ── BBR: per-building lookup via bbox in EPSG:25832 ─────────────────────
// Chains through DAWA reverse-geocode to get canonical EPSG:25832
// coordinates (bypasses inline UTM transform's ~1km northing drift). If
// DAWA has no address at the click point (e.g. rural forest), falls back
// to the inline transform with a wider bbox. Auth = username+password
// (the token slot should hold "user:pass"). REST BBR udfases ultimo 2026
// → migrate to BBR GraphQL.
export async function lookupBBR({ lat, lon, halfSideMeters = 50 }, { signal } = {}) {
  _warnIfUnverified('bbr');
  const token = _requireToken(TOKEN_SCOPE.DATAFORDELER, 'bbr');
  const svc = DK_SERVICES.bbr;
  const [user, pass] = String(token).split(':');
  if (!user || !pass) throw new Error(`[sovereign_services] "bbr" token must be "user:pass" (Datafordeler web-user credentials).`);

  // Get canonical EPSG:25832 from DAWA (public, no token, pinpoint-precise).
  // DAWA docs: /adgangsadresser/reverse `srid` governs the INPUT x/y;
  // response `adgangspunkt.koordinater` is ALWAYS [east, north] in EPSG:25832
  // regardless of input srid. So indices [0]=east, [1]=north.
  let east, north, viaDawa = false, dawaError = null;
  try {
    const dawaUrl = `${DK_SERVICES.dar.baseUrl}/adgangsadresser/reverse?x=${lon}&y=${lat}&srid=4326`;
    const dawaRes = await fetch(dawaUrl, { signal });
    if (dawaRes.ok) {
      const j = await dawaRes.json();
      const k = j?.adgangspunkt?.koordinater;
      if (Array.isArray(k) && k.length >= 2) {
        east = k[0]; north = k[1]; viaDawa = true;
      } else {
        console.info(`[bbr] DAWA had no address at ${lat.toFixed(4)},${lon.toFixed(4)} — falling back to inline UTM transform (bbox widened to 500m).`);
      }
    } else {
      dawaError = `HTTP ${dawaRes.status}`;
    }
  } catch (err) { dawaError = err.message; }
  if (!viaDawa) {
    if (dawaError) console.warn(`[bbr] DAWA unavailable (${dawaError}) — using inline UTM transform with widened bbox.`);
    const t = wgs84ToEtrs89Utm32(lon, lat);
    east = t.east; north = t.north;
    halfSideMeters = Math.max(halfSideMeters, 500);
  }

  const params = new URLSearchParams({
    Nord: String(north + halfSideMeters),
    Syd: String(north - halfSideMeters),
    Oest: String(east + halfSideMeters),
    Vest: String(east - halfSideMeters),
    username: user,
    password: pass,
    Format: 'JSON',
  });
  const url = `${svc.baseUrl}/bygning?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`BBR lookup failed ${res.status}: ${res.statusText}`);
  const json = await res.json();
  const envelope = _envelope('bbr', json, url);
  // Nest metadata under `meta` to keep the 5-field envelope shape stable
  // across services (any consumer that schema-validates envelopes only
  // needs to know about `meta` as an optional extension slot).
  envelope.meta = { coord_resolution: viaDawa ? 'dawa-canonical' : 'inline-utm-transform', half_side_m: halfSideMeters };
  return envelope;
}

// ── DAR: reverse-geocode via DAWA (public, no token) ─────────────────────
// DAWA (api.dataforsyningen.dk/adgangsadresser/reverse) is the operational
// reverse-geocode surface — free, no token, accepts srid=4326 or 25832.
// The authoritative Datafordeler DAR register does NOT expose a thin
// reverse-geocode REST endpoint; DAWA is the correct route.
export async function reverseGeocodeDAR({ lat, lon }, { signal } = {}) {
  _warnIfUnverified('dar');
  const svc = DK_SERVICES.dar;
  const params = new URLSearchParams({
    x: String(lon),
    y: String(lat),
    srid: '4326',
  });
  const url = `${svc.baseUrl}/adgangsadresser/reverse?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`DAWA reverse-geocode failed ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return _envelope('dar', json, url);
}

// ── DMI helper: build a bbox around a point ─────────────────────────────
// Rough degree-per-km at DK latitude (~55-58°N). Good enough for the
// small radii we query at (5-50km). Not corrected for latitude scaling
// of longitude — errors < 3% at Danish latitudes.
function _dmiBboxAround(lat, lon, radiusKm) {
  const d = radiusKm / 111;
  return [lon - d, lat - d, lon + d, lat + d].join(',');
}

// ── DMI helper: uniform bbox fetch for OGC API Features endpoints ──────
// DMI Open Data is fully public since Dec 2025 (opendataapi.dmi.dk).
// No API key, no headers, no bearer token. Fair-use limit 500 req/5s.
// User-Agent is good citizenship — set at fetch level.
async function _dmiOgcQuery(serviceId, { lat, lon, radiusKm = 20, limit = 10 }, { signal } = {}) {
  _warnIfUnverified(serviceId);
  const svc = DK_SERVICES[serviceId];
  const bbox = _dmiBboxAround(lat, lon, radiusKm);
  const url = `${svc.baseUrl}/items?bbox=${bbox}&limit=${limit}`;
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'isr-systems-c2/1.0' },
  });
  if (!res.ok) throw new Error(`${serviceId} query failed ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return _envelope(serviceId, json, url);
}

// ── DMI Meteorological Observations: nearest weather stations ───────────
// Host migrated from dmigw.govcloud.dk (retired 2026-06-30) to
// opendataapi.dmi.dk. Same OGC API Features pattern. bbox in WGS84.
export async function findNearestWeatherStations(args, opts = {}) {
  return _dmiOgcQuery('dmi_weather', args, opts);
}

// ── DMI Oceanographic + Tidewater: bølge, strøm, vandstand ──────────────
export async function findOceanographicObservations(args, opts = {}) {
  return _dmiOgcQuery('dmi_oceanobs', args, opts);
}

// ── DMI Lightning: recent strikes near a point ──────────────────────────
// Callers should use a small radius (5-20km) — lightning DB is dense.
export async function findLightningStrikes(args, opts = {}) {
  return _dmiOgcQuery('dmi_lightning', args, opts);
}

// ── DMI Radar (STAC API): raw HDF5 file catalog ─────────────────────────
// Returns pointers to HDF5 files — not renderable in browser directly.
// Use dmi_radar layer for in-map render (needs server-side tiler).
export async function listRadarFiles(args, opts = {}) {
  return _dmiOgcQuery('dmi_radar_stac', args, opts);
}

// ── DMI Forecast (STAC): numerical weather prediction file catalog ──────
export async function listForecastFiles(args, opts = {}) {
  return _dmiOgcQuery('dmi_forecast_stac', args, opts);
}

// ── DMI Forecast (EDR): point-forecast for a lat/lon ────────────────────
// EDR uses a different query model than STAC — point-focused, not bbox.
// This wrapper still uses the same helper for consistency; callers
// wanting the full EDR position-query surface can hit the URL directly.
export async function forecastAt(args, opts = {}) {
  return _dmiOgcQuery('dmi_forecast_edr', args, opts);
}

// ── openAIP: fetch Danish airspaces (bulk) or nearby (bbox filter) ──────
// openAIP returns paginated GeoJSON. For DK, ~200-400 airspaces total.
// Recommend caching the DK-country pull for a full AIRAC cycle (28 days).
export async function fetchDanishAirspaces({ limit = 1000 } = {}, { signal } = {}) {
  _warnIfUnverified('openaip_airspaces');
  const token = _requireToken(TOKEN_SCOPE.OPENAIP, 'openaip_airspaces');
  const svc = DK_SERVICES.openaip_airspaces;
  const url = `${svc.baseUrl}?country=DK&limit=${limit}`;
  const res = await fetch(url, {
    signal,
    headers: {
      'x-openaip-api-key': token,   // live-verified 2026-09-02 (NOT x-openaip-client-id)
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`openAIP airspaces fetch failed ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return _envelope('openaip_airspaces', json, url);
}

// Filter the bulk pull to a bbox around a point (client-side). Cheaper
// than repeated API calls when we already have the full DK cache.
export async function findAirspacesNear({ lat, lon, radiusKm = 25, cache = null }, opts = {}) {
  const pack = cache || await fetchDanishAirspaces({}, opts);
  const items = pack?.data?.items || pack?.data || [];
  const dDeg = radiusKm / 111;
  const [minLon, maxLon] = [lon - dDeg, lon + dDeg];
  const [minLat, maxLat] = [lat - dDeg, lat + dDeg];
  const inBbox = items.filter(a => {
    const g = a.geometry;
    if (!g || !g.coordinates) return false;
    // Rough centroid check — good enough for "airspaces near me" preview
    const flat = JSON.stringify(g.coordinates).match(/-?\d+\.\d+/g) || [];
    const nums = flat.map(Number);
    if (nums.length < 2) return false;
    const cx = nums.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (nums.length / 2);
    const cy = nums.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / (nums.length / 2);
    return cx >= minLon && cx <= maxLon && cy >= minLat && cy <= maxLat;
  });
  return { ...pack, data: { ...pack.data, items: inBbox, filtered: true, at: { lat, lon, radiusKm } } };
}

// ── NOTAMs — cut 2026-09-02 ────────────────────────────────────────────
// ICAO retired NOTAM endpoints from the API 2.0 free tier. Verified against
// the live endpoint catalog (21 services, none NOTAM-related). openAIP
// airspace polygons cover the static airspace surface; dynamic NOTAM
// restrictions would require a paid Notamify / RocketRoute subscription
// or a signed Eurocontrol EAD agreement (Naviair's route). Not doing that
// speculatively — revisit when a customer requires it.

// ── BBR Fortrolig — DOES NOT EXIST (throws with guidance) ──────────────
// Live-verified 2026-09-02: no such path on services.datafordeler.dk.
// Kept as an exported function so callers who searched for "BBR fortrolig"
// get an explicit error explaining where to look instead.
export async function lookupBBRFortrolig(_args, _opts) {
  throw new Error(
    '[sovereign_services] BBR Fortrolig does not exist as a Datafordeler service. ' +
    'BBR is Sikkerhedszone 0 (no restricted tier). For the data you probably want:\n' +
    '  - Ejerforhold  → EJF (Ejerfortegnelsen) — has Fortrolig-tier\n' +
    '  - Vurdering    → VUR (Vurderingsstyrelsen)\n' +
    '  - Personoplysninger → CPR (adgangsbegrænset)\n' +
    'See DK_SERVICES.bbr_fortrolig._notes.'
  );
}

// ── Vejdirektoratet: DATEX II Situation records (traffic events) ────────
// No REST fetch. Vejdirektoratet Dataudveksleren distributes DATEX II
// EXCLUSIVELY over Azure Service Bus (AMQP 1.0). The browser subscribes to
// scripts/vd-amqp-proxy/ over WebSocket, which holds the persistent AMQP
// connection server-side (Azure AD client_credentials -> Service Bus scope).
// See sovereign_live_feeds.js VejdirektoratetTrafficProvider for the client.
export function trafficEventsWsUrl() {
  return import.meta.env?.VITE_VD_TRAFFIC_WS_URL || '';
}

// ── CVR: company lookup by CVR number ────────────────────────────────────
// Service is HentCVRData (NOT HentCVRDataNyeste — that variant is not
// documented). Method: hentVirksomhedMedCVRNummer. Param name likely
// `ppno` per Datafordeler convention — verify with live account. Auth
// is username+password (token slot should hold "user:pass"). REST CVR
// udfases Q2-2026 → migrate to CVR GraphQL.
export async function lookupCVR({ cvr }, { signal } = {}) {
  _warnIfUnverified('cvr');
  const token = _requireToken(TOKEN_SCOPE.DATAFORDELER, 'cvr');
  const svc = DK_SERVICES.cvr;
  const [user, pass] = String(token).split(':');
  if (!user || !pass) throw new Error(`[sovereign_services] "cvr" token must be "user:pass" (Datafordeler web-user credentials).`);
  const params = new URLSearchParams({
    ppno: String(cvr),
    username: user,
    password: pass,
  });
  const url = `${svc.baseUrl}/hentVirksomhedMedCVRNummer?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`CVR lookup failed ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return _envelope('cvr', json, url);
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT + INTROSPECTION
// ═══════════════════════════════════════════════════════════════════════════

let _initialised = false;

export function initSovereignServices(tokens = {}) {
  if (_initialised) {
    console.warn('[sovereign_services] already initialised. To update tokens, use window.__isr_services.setToken(scope, value).');
  }
  Object.assign(_tokens, tokens);
  _initialised = true;

  if (typeof window !== 'undefined') {
    window.__isr_services = {
      list: () => Object.values(DK_SERVICES).map(s => ({
        id: s.id,
        provider: s.provider,
        name: s.name,
        description: s.description,
        tokenScope: s.tokenScope,
        tokenConfigured: !!_tokens[s.tokenScope],
        needsVerification: !!s._needsVerification,
      })),
      status: () => window.__isr_services.list(),
      setToken: (scope, value) => {
        _tokens[scope] = value;
        console.log(`[sovereign_services] token "${scope}" updated.`);
      },
      hasToken: (scope) => !!_tokens[scope],
      // Convenience aliases for DevTools use.
      bbr: (lat, lon) => lookupBBR({ lat, lon }),
      dar: (lat, lon) => reverseGeocodeDAR({ lat, lon }),
      dmi: (lat, lon, radiusKm) => findNearestWeatherStations({ lat, lon, radiusKm }),
      dmiOcean: (lat, lon, radiusKm) => findOceanographicObservations({ lat, lon, radiusKm }),
      dmiLightning: (lat, lon, radiusKm = 20) => findLightningStrikes({ lat, lon, radiusKm }),
      dmiRadar: (lat, lon, radiusKm = 50) => listRadarFiles({ lat, lon, radiusKm }),
      dmiForecastFiles: (lat, lon, radiusKm = 50) => listForecastFiles({ lat, lon, radiusKm }),
      dmiForecast: (lat, lon, radiusKm = 10) => forecastAt({ lat, lon, radiusKm }),
      cvr: (cvrNumber) => lookupCVR({ cvr: cvrNumber }),
      // Aviation + traffic
      airspaces: () => fetchDanishAirspaces(),
      airspacesNear: (lat, lon, radiusKm = 25) => findAirspacesNear({ lat, lon, radiusKm }),
      trafficWs: () => trafficEventsWsUrl(),
      // Guarded-throw helpers for services that turned out not to exist
      bbrFortrolig: (lat, lon) => lookupBBRFortrolig({ lat, lon }),
    };
    console.log('[sovereign_services] window.__isr_services ready. Try: __isr_services.list() / .bbr(55.74, 9.16) / .setToken("datafordeler", "<key>")');
  }
}
