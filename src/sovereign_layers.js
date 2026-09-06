// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN LAYERS — Danish geospatial data provider registry + manager
// ═══════════════════════════════════════════════════════════════════════════

// Import Cesium via ESM (matches main.js). window.Cesium is NOT set in
// Vite ESM builds — reaching for it gives undefined and every WMTS add
// fails with "Cannot read properties of undefined". Verified 2026-09-02.
import * as CesiumModule from 'cesium';

//
// Design principles:
//   1. DATA-DRIVEN. Every layer is a plain-object entry in SOVEREIGN_LAYERS.
//      Adding a new DK provider = add one entry. No conditionals scattered
//      across main.js.
//
//   2. GATED. Only initialised when render_profile === 'sovereign'. Photoreal
//      profile never touches this module — zero risk to demo/customer builds
//      that use Cesium Ion + Google 3D.
//
//   3. DEFAULT-OFF. Every layer defaults to hidden (enabledByDefault: false)
//      UNLESS explicitly promoted. This prevents accidental visual noise
//      when a new layer is added. Toggle via SovereignLayerManager.enable().
//
//   4. FEATURE-PRESERVING. Only touches Cesium's imagery/vector data
//      provider layer. Never touches:
//        - viewer.scene.globe.* properties
//        - viewer.scene.postProcessStages (bloom, etc.)
//        - canvas.style.filter
//        - clock / atmosphere / day-mode branches
//      Every sensor, site polygon, drone track, coverage circle, debrief
//      overlay, replay UI stays identical — they render in Cesium's entity
//      layer, above whatever imagery/vector this manager loads.
//
//   5. RUNTIME-INTROSPECTABLE. window.__isr_layers exposes list/enable/
//      disable/status so ops can flip layers in DevTools without a reload.
//
// Category taxonomy:
//   imagery   — WMTS/WMS raster imagery (ortho, topo, oblique)
//   vector    — WFS/GeoJSON polygons + lines (jurisdictions, boundaries)
//   overlay   — WMS overlays (weather radar, no-fly zones, hazards)
//
// Token convention: each entry declares `tokenScope` — the manager receives
// tokens keyed by scope at init and substitutes them into URLs. Multiple
// providers use different tokens (SDFI/Dataforsyningen, DMI Gov Cloud,
// Datafordeler REST) — this keeps them cleanly separated.
//
// Provenance convention: `provider`, `authority`, `docsUrl` on each entry
// so we can render "sourced from X" attribution + a link for future ops.
//
// Verification convention: entries whose exact endpoint I have NOT verified
// against live SDFI docs carry `_needsVerification: true` and a `_notes`
// field. These are wired but marked so Lucas / an ops engineer confirms
// before enabling in production. Prevents hallucinated URLs from silently
// 404-ing at customer sites.
// ═══════════════════════════════════════════════════════════════════════════

// ── Layer categories (for grouping in future UI) ──────────────────────────
export const LAYER_CATEGORY = Object.freeze({
  IMAGERY: 'imagery',
  VECTOR: 'vector',
  OVERLAY: 'overlay',
});

// ── Token scopes ──────────────────────────────────────────────────────────
// Each provider uses its own token/API-key. The manager receives them at
// init and substitutes them into URL templates via ${TOKEN}.
export const TOKEN_SCOPE = Object.freeze({
  SDFI: 'sdfi',              // dataforsyningen.dk token (single-token for
                             // Kortforsyningen + Dataforsyningen APIs)
  DMI: 'dmi',                // dmigw.govcloud.dk API key
  DATAFORDELER: 'datafordeler', // datafordeler.dk (BBR, DAR, CVR) — needs
                             // separate registration
});

// ═══════════════════════════════════════════════════════════════════════════
// LAYER REGISTRY — the single source of truth
// ═══════════════════════════════════════════════════════════════════════════
export const SOVEREIGN_LAYERS = [

  // ══════════════════════════════════════════════════════════════════════
  // IMAGERY LAYERS (raster tiles)
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'sdfi_ortho_spring',
    category: LAYER_CATEGORY.IMAGERY,
    provider: 'SDFI',
    authority: 'Klimadatastyrelsen',
    name: 'GeoDanmark Ortofoto (forår)',
    description: 'Nationale luftfotos taget forår (blad-på). Opdateres årligt. Primær sovereign imagery.',
    type: 'wmts',
    tokenScope: TOKEN_SCOPE.SDFI,
    url: 'https://api.dataforsyningen.dk/orto_foraar_wmts_DAF?token=${TOKEN}',
    wmts: {
      layer: 'orto_foraar_wmts',
      style: 'default',
      format: 'image/jpeg',
      tileMatrixSetID: 'KortforsyningTilingDK',
      maximumLevel: 17,
    },
    credit: '© GeoDanmark / Klimadatastyrelsen (CC BY 4.0)',
    docsUrl: 'https://dataforsyningen.dk',
    enabledByDefault: true,   // primary sovereign imagery
    _managedElsewhere: true,  // main.js already loads this as sdfiLayer —
                              // registered here for the roadmap but not
                              // re-added by the manager. Set to false only
                              // if you refactor main.js to defer to us.
  },

  {
    id: 'sdfi_ortho_autumn',
    category: LAYER_CATEGORY.IMAGERY,
    provider: 'SDFI',
    authority: 'Klimadatastyrelsen',
    name: 'GeoDanmark Ortofoto (efterår)',
    description: 'Nationale luftfotos taget efterår (blad-af). Bedre til strukturidentifikation.',
    type: 'wmts',
    tokenScope: TOKEN_SCOPE.SDFI,
    url: 'https://api.dataforsyningen.dk/orto_efteraar_wmts_DAF?token=${TOKEN}',
    wmts: {
      layer: 'orto_efteraar_wmts',
      style: 'default',
      format: 'image/jpeg',
      tileMatrixSetID: 'KortforsyningTilingDK',
      maximumLevel: 17,
    },
    credit: '© GeoDanmark / Klimadatastyrelsen (CC BY 4.0)',
    docsUrl: 'https://dataforsyningen.dk',
    enabledByDefault: false,
    _needsVerification: true,
    _hidden: true, // SDFI uses EPSG:25832 tile matrix Cesium can't consume natively. Requires custom TilingScheme. Registered but hidden from UI to prevent broken toggles.
    _notes: 'Verify exact WMTS layer name matches SDFI capabilities before promotion. Mirrors ortho_spring URL pattern; endpoint documented but not live-tested from this stack.',
  },

  {
    id: 'sdfi_topo_skaermkort',
    category: LAYER_CATEGORY.IMAGERY,
    provider: 'SDFI',
    authority: 'SDFI',
    name: 'Skærmkort (topografisk basiskort)',
    description: 'Renderet dansk topografisk basiskort. God erstatning for ortofoto ved briefings hvor abstraktion foretrækkes.',
    type: 'wmts',
    tokenScope: TOKEN_SCOPE.SDFI,
    url: 'https://api.dataforsyningen.dk/topo_skaermkort_DAF?token=${TOKEN}',
    wmts: {
      layer: 'topo_skaermkort',
      style: 'default',
      format: 'image/png',
      tileMatrixSetID: 'KortforsyningTilingDK',
      maximumLevel: 17,
    },
    credit: '© SDFI (CC BY 4.0)',
    docsUrl: 'https://dataforsyningen.dk',
    enabledByDefault: false,
    _needsVerification: true,
    _hidden: true, // EPSG:25832 tile matrix; needs custom TilingScheme.
    _notes: 'Datafordeler publicerer Skærmkortet Klassisk WMTS + Skærmkortet Dæmpet WMTS. Aktuelt DAF proxy-navn er topo_skaermkort_DAF. GetCapabilities kræver gyldig token — verify with live token before demo.',
  },

  {
    id: 'sdfi_dhm_skyggekort',
    category: LAYER_CATEGORY.IMAGERY,
    provider: 'SDFI · DHM',
    authority: 'Klimadatastyrelsen',
    name: 'DHM Skyggekort (hillshade)',
    description: 'Pre-renderet skygge-relief fra Danmarks Højdemodel (DHM/Terræn). Giver "3D-følelse" af landskabet uden fuld quantized-mesh terrain-pipeline. Interim visual boost mens scripts/dhm-pipeline/ ikke er kørt endnu.',
    type: 'wmts',
    tokenScope: TOKEN_SCOPE.SDFI,
    url: 'https://api.dataforsyningen.dk/dhm_terraen_skyggekort_DAF?token=${TOKEN}',
    wmts: {
      layer: 'dhm_terraen_skyggekort',
      style: 'default',
      format: 'image/png',
      tileMatrixSetID: 'KortforsyningTilingDK',
      maximumLevel: 15,
    },
    credit: '© Klimadatastyrelsen · DHM/Terræn (CC BY 4.0)',
    docsUrl: 'https://dataforsyningen.dk/data/928',
    enabledByDefault: false,
    _needsVerification: true,
    _hidden: true, // EPSG:25832 tile matrix; live-verified 2026-09-02 that requests 400 with unprefixed matrix ids. Needs custom TilingScheme.
    _notes: 'Interim løsning indtil scripts/dhm-pipeline/ producerer quantized-mesh terrain. Skyggekort er en 2D-billede overlay der visuelt viser terræn-relief (LiDAR-baseret), ikke rigtig 3D. Kan blandes med SDFI ortho for at give topografisk kontekst.',
  },

  {
    id: 'sdfi_skraafoto',
    category: LAYER_CATEGORY.IMAGERY,
    provider: 'SDFI',
    authority: 'SDFI',
    name: 'Skråfoto (oblique)',
    description: 'Skråfotografier fra 4 verdenshjørner. Giver facadesyn på bygninger — værdifuldt for konstruktions- og trusselskontekst.',
    type: 'external-viewer',   // Cesium can't natively consume the tiled
                                // oblique format — needs a separate iframe
                                // viewer or a custom Cesium primitive.
    tokenScope: TOKEN_SCOPE.SDFI,
    url: 'https://skraafoto.dataforsyningen.dk',
    docsUrl: 'https://sdfi.dk/vaerktoejer-og-services/skraafoto',
    enabledByDefault: false,
    _needsVerification: true,
    _hidden: true, // external-viewer: not a map overlay. Needs separate "Open Skråfoto" button, not a layer checkbox. Toggling it just logs a warning.
    _notes: 'Skråfoto er ikke en standard WMTS. Kræver enten (a) iframe embed når bruger klikker på lokation, (b) SDFI Skråfoto API + custom Cesium primitiv, eller (c) prebuilt tileset. Tier A stub — implementation deferred to sprint hvor UI-panel wires det op.',
  },

  // ══════════════════════════════════════════════════════════════════════
  // VECTOR JURISDICTIONS (WFS → GeoJSON)
  // These feed the geospatial escalation routing story: point-in-polygon
  // → auto-select police district / kommune / region / beredskabsområde
  // for any site coordinate.
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'dagi_kommunegraenser',
    category: LAYER_CATEGORY.VECTOR,
    provider: 'Datafordeler · DAGI',
    authority: 'Klimadatastyrelsen',
    name: 'Kommunegrænser (98)',
    description: 'DAGI (Danmarks Administrative Geografiske Inddeling). Alle 98 kommunegrænser. Grundlag for auto-routing kommune-tier eskalationer.',
    type: 'geojson',
    tokenScope: TOKEN_SCOPE.DATAFORDELER,
    url: 'https://wfs.datafordeler.dk/DAGI/DAGI_WFS/1.0.0/WFS?service=WFS&version=2.0.0&request=GetFeature&typenames=dagi_v001:kommuneinddeling_current&outputFormat=application/json&srsname=EPSG:4326&username=${USER}&password=${PASS}',
    style: {
      stroke: 'rgba(77, 210, 255, 0.35)',
      strokeWidth: 1.0,
      fill: 'rgba(77, 210, 255, 0.0)',
    },
    credit: '© Klimadatastyrelsen · DAGI',
    docsUrl: 'https://datafordeler.dk/dataoversigt/danmarks-administrative-geografiske-inddeling-dagi/',
    enabledByDefault: false,
    _needsVerification: false,
    _notes: 'LIVE-VERIFICERET 2026-09-02. Direct Datafordeler WFS via wfs.datafordeler.dk/DAGI/DAGI_WFS/1.0.0/WFS. Typename dagi_v001:kommuneinddeling_current. Auth = tjenestebruger username+password. srsname=EPSG:4326 giver WGS84 direkte til Cesium. Bemærk: SDFI proxy (api.dataforsyningen.dk/DAGI_10MULTIGEOM_GMLSFP_DAF) fungerer ikke pålideligt uden separat DAGI-adgang på SDFI-token. Direct Datafordeler er den anbefalede vej. REST DAGI udfases 15. jan 2026 → migrer til GraphQL. Payload ~30MB fuld dansk kommunegrænse — bør caches client-side.',
  },

  {
    id: 'dagi_politikredse',
    category: LAYER_CATEGORY.VECTOR,
    provider: 'Datafordeler · DAGI',
    authority: 'Klimadatastyrelsen',
    name: 'Politikredse (12)',
    description: 'Grænser for de 12 danske politikredse. Grundlag for auto-routing politi-tier eskalationer.',
    type: 'geojson',
    tokenScope: TOKEN_SCOPE.DATAFORDELER,
    url: 'https://wfs.datafordeler.dk/DAGI/DAGI_WFS/1.0.0/WFS?service=WFS&version=2.0.0&request=GetFeature&typenames=dagi_v001:politikreds_current&outputFormat=application/json&srsname=EPSG:4326&username=${USER}&password=${PASS}',
    style: {
      stroke: 'rgba(255, 184, 77, 0.45)',
      strokeWidth: 1.4,
      fill: 'rgba(255, 184, 77, 0.0)',
    },
    credit: '© Klimadatastyrelsen · DAGI',
    docsUrl: 'https://datafordeler.dk/dataoversigt/danmarks-administrative-geografiske-inddeling-dagi/',
    enabledByDefault: false,
    _needsVerification: false,
    _notes: 'LIVE-VERIFICERET 2026-09-02. Alle 12 politikredse returneret med rigtige navne (Bornholms Politi, Fyns Politi, Københavns Politi, Nordsjællands Politi, Syd- og Sønderjyllands Politi etc). Matcher taksonomien i roles.js præcist. Payload ~28MB fuld politikreds-set.',
  },

  {
    id: 'dagi_regionsgraenser',
    category: LAYER_CATEGORY.VECTOR,
    provider: 'Datafordeler · DAGI',
    authority: 'Klimadatastyrelsen',
    name: 'Regionsgrænser (5)',
    description: 'Grænser for de 5 danske regioner. Grundlag for auto-routing region-/AMK-tier eskalationer.',
    type: 'geojson',
    tokenScope: TOKEN_SCOPE.DATAFORDELER,
    url: 'https://wfs.datafordeler.dk/DAGI/DAGI_WFS/1.0.0/WFS?service=WFS&version=2.0.0&request=GetFeature&typenames=dagi_v001:regionsinddeling_current&outputFormat=application/json&srsname=EPSG:4326&username=${USER}&password=${PASS}',
    style: {
      stroke: 'rgba(180, 200, 220, 0.35)',
      strokeWidth: 1.6,
      fill: 'rgba(180, 200, 220, 0.0)',
    },
    credit: '© Klimadatastyrelsen · DAGI',
    docsUrl: 'https://datafordeler.dk/dataoversigt/danmarks-administrative-geografiske-inddeling-dagi/',
    enabledByDefault: false,
    _needsVerification: false,
    _notes: 'DAGI Level 1 typename Regionsinddeling. Verify.',
  },

  {
    id: 'beredskab_omraader',
    category: LAYER_CATEGORY.VECTOR,
    provider: 'Beredskabsstyrelsen',
    authority: 'Beredskabsstyrelsen',
    name: 'Beredskabsområder (§60)',
    description: 'Grænser for de kommunale §60-beredskaber. Grundlag for auto-routing beredskab-tier eskalationer.',
    type: 'geojson',
    tokenScope: null,  // typically served without token from BRS or via SDFI mirror
    url: null,          // TODO: locate canonical endpoint
    style: {
      stroke: 'rgba(255, 100, 100, 0.35)',
      strokeWidth: 1.2,
      fill: 'rgba(255, 100, 100, 0.0)',
    },
    credit: '© Beredskabsstyrelsen',
    docsUrl: 'https://brs.dk',
    enabledByDefault: false,
    _needsVerification: true,
    _notes: 'Ingen offentligt serveret GeoJSON/WFS for §60-beredskaber (verificeret 2026-09-01). Danske Beredskabers Grunddatamodel v1.1 (2018) er datamodel, ikke endpoint. Skal bygges ved at joine DAGI kommunegrænser med §60-beredskabsmedlemsskab (24 §60-beredskaber, mapping fra BRS årsrapport). Alternativt: partnership med Danske Beredskaber for GIS-eksport.',
  },

  // ══════════════════════════════════════════════════════════════════════
  // OVERLAYS (weather, no-fly, hazard)
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 'droneluftrum_no_fly',
    category: LAYER_CATEGORY.OVERLAY,
    provider: 'Trafikstyrelsen · dronezoner.dk',
    authority: 'Trafikstyrelsen',
    name: 'Drone no-fly zoner',
    description: 'Aktuelle no-fly zoner for droner i Danmark. Grundlag for regel-baseret alarm-kontekst.',
    type: 'geojson',
    tokenScope: null,
    url: null,
    style: {
      stroke: 'rgba(255, 77, 77, 0.55)',
      strokeWidth: 1.5,
      fill: 'rgba(255, 77, 77, 0.10)',
    },
    credit: '© Trafikstyrelsen',
    docsUrl: 'https://dronezoner.dk',
    enabledByDefault: false,
    _needsVerification: true,
    _hidden: true, // No public endpoint exists as of 2026-09-02 — toggle does nothing. Hidden until Trafikstyrelsen partnership lands.
    _notes: 'droneluftrum.dk retired 2026-07-01. Replacement dronezoner.dk (Trafikstyrelsen + GisVision) har ingen offentligt dokumenteret GeoJSON/WFS/REST API. Kræver enten Trafikstyrelsen-partnership eller manual scrape af Leaflet/Cesium-viewer tiles.',
  },

  {
    id: 'dmi_radar',
    category: LAYER_CATEGORY.OVERLAY,
    provider: 'DMI',
    authority: 'Danmarks Meteorologiske Institut',
    name: 'DMI Vejrradar (nedbør)',
    description: 'Realtids nedbørsradar fra DMI. Vigtig for at reducere false positives i RF-detektion under kraftig nedbør.',
    type: 'external-processing-required',
    tokenScope: null,   // DMI Open Data is public since Dec 2025 — no auth
    url: null,
    credit: '© DMI (CC BY 4.0)',
    docsUrl: 'https://opendatadocs.dmi.govcloud.dk/APIs/Radar_Data_API',
    enabledByDefault: false,
    _needsVerification: true,
    _hidden: true, // DMI radar is HDF5 STAC — needs server-side HDF5→PNG tiler before Cesium can consume it. Toggle does nothing today.
    _notes: 'DMI radar er STAC API - Features (HDF5-filer), ikke WMS. Endpoint: opendataapi.dmi.dk/v1/radardata/collections/{composite|pseudo|volume}/items. dmigw.govcloud.dk retired 2026-06-30. In-map render kræver server-side HDF5→PNG tiler — ingen drop-in Cesium provider.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// MANAGER — encapsulates all Cesium interactions
// ═══════════════════════════════════════════════════════════════════════════

class SovereignLayerManager {
  constructor(viewer, tokens) {
    this.viewer = viewer;
    this.tokens = tokens || {};
    this._loaded = new Map();  // layerId → {entry, cesiumRef}
    // window.Cesium is undefined in Vite ESM builds; use the imported
    // module. Kept as `this._Cesium` so all existing call sites work.
    this._Cesium = CesiumModule;
  }

  // Substitute credentials in URL template using the token scope for this
  // entry. Two placeholder conventions:
  //   ${TOKEN}         — simple string token (SDFI, DMI)
  //   ${USER}/${PASS}  — split "user:pass" pair (DATAFORDELER tjenestebruger)
  _resolveUrl(entry) {
    if (!entry.url) return null;
    if (!entry.tokenScope) return entry.url;
    const token = this.tokens[entry.tokenScope];
    if (!token) {
      console.warn(`[sovereign_layers] "${entry.id}" needs ${entry.tokenScope} token but none configured. Skipping.`);
      return null;
    }
    // Datafordeler auth = username+password pair (split on colon)
    if (entry.tokenScope === TOKEN_SCOPE.DATAFORDELER) {
      const [user, pass] = String(token).split(':');
      if (!user || !pass) {
        console.warn(`[sovereign_layers] "${entry.id}" datafordeler token must be "user:pass". Skipping.`);
        return null;
      }
      return entry.url
        .replace('${USER}', encodeURIComponent(user))
        .replace('${PASS}', encodeURIComponent(pass));
    }
    return entry.url.replace('${TOKEN}', encodeURIComponent(token));
  }

  // Add a WMTS imagery layer. Returns Cesium ImageryLayer or null.
  _addWmts(entry) {
    const url = this._resolveUrl(entry);
    if (!url) return null;
    try {
      const provider = new this._Cesium.WebMapTileServiceImageryProvider({
        url,
        layer: entry.wmts.layer,
        style: entry.wmts.style || 'default',
        format: entry.wmts.format || 'image/jpeg',
        tileMatrixSetID: entry.wmts.tileMatrixSetID,
        maximumLevel: entry.wmts.maximumLevel || 17,
        credit: new this._Cesium.Credit(entry.credit || '', true),
      });
      return this.viewer.imageryLayers.addImageryProvider(provider);
    } catch (err) {
      console.warn(`[sovereign_layers] WMTS add failed for "${entry.id}":`, err);
      return null;
    }
  }

  // Add a WMS overlay. Returns Cesium ImageryLayer or null.
  _addWms(entry) {
    const url = this._resolveUrl(entry);
    if (!url) return null;
    try {
      const provider = new this._Cesium.WebMapServiceImageryProvider({
        url,
        layers: entry.wms.layers,
        parameters: {
          format: entry.wms.format || 'image/png',
          transparent: entry.wms.transparent === false ? false : true,
        },
        credit: new this._Cesium.Credit(entry.credit || '', true),
      });
      return this.viewer.imageryLayers.addImageryProvider(provider);
    } catch (err) {
      console.warn(`[sovereign_layers] WMS add failed for "${entry.id}":`, err);
      return null;
    }
  }

  // Load a GeoJSON layer as a DataSource. Returns Promise<DataSource | null>.
  async _addGeoJson(entry) {
    const url = this._resolveUrl(entry);
    if (!url) return null;
    try {
      const style = entry.style || {};
      const ds = await this._Cesium.GeoJsonDataSource.load(url, {
        stroke: style.stroke ? this._Cesium.Color.fromCssColorString(style.stroke) : this._Cesium.Color.WHITE.withAlpha(0.4),
        strokeWidth: style.strokeWidth || 1.0,
        fill: style.fill ? this._Cesium.Color.fromCssColorString(style.fill) : this._Cesium.Color.WHITE.withAlpha(0.0),
        clampToGround: true,
        credit: entry.credit || '',
      });
      await this.viewer.dataSources.add(ds);
      return ds;
    } catch (err) {
      console.warn(`[sovereign_layers] GeoJSON add failed for "${entry.id}":`, err);
      return null;
    }
  }

  // Enable a layer by id. Idempotent.
  async enable(layerId) {
    if (this._loaded.has(layerId)) return this._loaded.get(layerId).cesiumRef;
    const entry = SOVEREIGN_LAYERS.find(l => l.id === layerId);
    if (!entry) { console.warn(`[sovereign_layers] no such layer: "${layerId}"`); return null; }
    if (entry._managedElsewhere) {
      console.log(`[sovereign_layers] "${layerId}" is managed elsewhere (main.js). Not adding.`);
      return null;
    }
    if (entry._needsVerification) {
      console.warn(`[sovereign_layers] enabling UNVERIFIED layer "${layerId}". Notes: ${entry._notes || '(none)'}`);
    }
    let ref = null;
    if (entry.type === 'wmts') ref = this._addWmts(entry);
    else if (entry.type === 'wms') ref = this._addWms(entry);
    else if (entry.type === 'geojson') ref = await this._addGeoJson(entry);
    else if (entry.type === 'external-viewer') {
      console.log(`[sovereign_layers] "${layerId}" is external-viewer type — no in-map render, use entry.url in a companion panel.`);
      return null;
    }
    else if (entry.type === 'external-processing-required') {
      console.log(`[sovereign_layers] "${layerId}" requires a server-side tiler before it can render in Cesium (see entry._notes for pipeline). Skipping in-map load.`);
      return null;
    }
    else { console.warn(`[sovereign_layers] unknown type "${entry.type}" for "${layerId}"`); return null; }

    if (ref) {
      this._loaded.set(layerId, { entry, cesiumRef: ref });
      console.log(`[sovereign_layers] enabled "${layerId}" (${entry.provider}).`);
    }
    return ref;
  }

  // Disable a layer by id.
  disable(layerId) {
    const rec = this._loaded.get(layerId);
    if (!rec) return false;
    try {
      if (rec.entry.type === 'wmts' || rec.entry.type === 'wms') {
        this.viewer.imageryLayers.remove(rec.cesiumRef, false);
      } else if (rec.entry.type === 'geojson') {
        this.viewer.dataSources.remove(rec.cesiumRef, true);
      }
    } catch (err) { console.warn(`[sovereign_layers] disable failed for "${layerId}":`, err); }
    this._loaded.delete(layerId);
    console.log(`[sovereign_layers] disabled "${layerId}".`);
    return true;
  }

  // Introspection helpers for DevTools + future UI.
  list() {
    return SOVEREIGN_LAYERS.map(l => ({
      id: l.id,
      category: l.category,
      provider: l.provider,
      name: l.name,
      description: l.description,
      enabled: this._loaded.has(l.id) || l._managedElsewhere === true,
      managedElsewhere: !!l._managedElsewhere,
      hidden: !!l._hidden,
      needsVerification: !!l._needsVerification,
    }));
  }
  status() { return this.list(); }
  isEnabled(id) { return this._loaded.has(id); }
}

// ═══════════════════════════════════════════════════════════════════════════
// Init — call from main.js after viewer is constructed AND after imagery
// layers are added (so DAGI vector overlays sit above base imagery).
// Tokens: { sdfi, dmi, datafordeler } — pass what you have.
// ═══════════════════════════════════════════════════════════════════════════
let _instance = null;

export async function initSovereignLayers(viewer, tokens = {}) {
  if (_instance) { console.warn('[sovereign_layers] already initialised — returning existing instance.'); return _instance; }
  _instance = new SovereignLayerManager(viewer, tokens);

  // Auto-enable any layer marked enabledByDefault (that isn't already
  // managed elsewhere). Currently the only such layer is sdfi_ortho_spring
  // which IS managed by main.js — so this loop no-ops today. Kept for
  // forward-compatibility.
  for (const entry of SOVEREIGN_LAYERS) {
    if (entry.enabledByDefault && !entry._managedElsewhere) {
      await _instance.enable(entry.id);
    }
  }

  if (typeof window !== 'undefined') {
    window.__isr_layers = _instance;
    console.log('[sovereign_layers] window.__isr_layers ready. Try: __isr_layers.list() / .enable("dagi_kommunegraenser") / .disable(...)');
  }

  return _instance;
}

export function getSovereignLayerManager() { return _instance; }
