import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { SITES as SITES_CORE } from './sites.js';
import { ENERGINET_SITES } from './sites_energinet.js';
const SITES = { ...SITES_CORE, ...ENERGINET_SITES };
import {
  filteredEvents, getEvent, getSelectedEventId, selectEvent,
  onSelectionChange, setFilter, onFilterChange,
  siteName, registerSiteName, relativeTime, formatDuration,
  addNote, reclassifyEvent,
} from './events.js';
// Register every configured site's display name so siteName(siteId) resolves
// to the pretty label everywhere (was falling back to the raw ID for all
// non-CPH / non-Esbjerg sites, e.g. "energinet_kassoe" leaking into panels).
for (const sid of Object.keys(SITES)) {
  registerSiteName(sid, SITES[sid].name || sid);
}
import {
  TEMPLATES, addLiveTrack, markTrackClosed, removeLiveTrack, anyTrackLive,
  onDroneUpdate, distanceToPerimeter, pointInPolygon, makeSubstationThreats,
} from './drones.js';
// Register substation threat templates for each Energinet site (module init side effect)
Object.values(ENERGINET_SITES).forEach(site => {
  const sensorIds = site.sensors.map(s => s.id);
  const threats = makeSubstationThreats(site.id, site.name, site.coordinates.lat, site.coordinates.lon, sensorIds);
  Object.assign(TEMPLATES, threats);
});
import {
  EVENTS, addEvent, closeEvent, nextEventId, escalateEvent, updateEscalationStatus,
  respondToEscalation, eventsForDestinations,
} from './events.js';
import {
  destinationsForSite, getDestination, destinationTypeLabel,
  destinationParent, destinationShortLabel, groupByParent,
  addDestination, updateDestination, removeDestination,
  onDestinationsChange, resetDestinationsToDefault,
  CHANNEL_META, getDestinationGuidance, getAllDestinations,
} from './destinations.js';
import { renderDetectionBrief } from './summary.js';
import { contextForSite, nearestCriticalArea, dwellZonesAtPoint } from './site_context.js';
import { responseBundle, responseBundleForSubject, RESPONSE_OPTION_DETAILS, outcomesForKind } from './response_assets.js';
import { AIRCRAFT, aircraftAtBase, aircraftForResponseAsset } from './aircraft.js';
import { playbookFor } from './response_playbook.js';
import { ADMIN, OPERATORS, RECEIVERS, getActiveRole, setActiveRole, onRoleChange, getRoleChildren, getRoleDestinationIdsRolledUp } from './roles.js';
import { runbookFor } from './runbooks.js';
import { TARGETS as TARGETS_CORE } from './targets.js';
import { HV_SUBSTATION_TARGETS } from './targets_hv.js';
const TARGETS = [...TARGETS_CORE, ...HV_SUBSTATION_TARGETS];
import { getRules, onRulesChange, toggleRule, removeRule, upsertRule, resetRulesToDefault, ruleSummaryText } from './rules.js';
import { isMistralConfigured, streamCaseFileNarrative, streamDebriefNarrative } from './mistral.js';
import { fetchDrivingRoute, computeSegmentLengths, advanceAlongPolyline } from './routing.js';
import {
  CPH_RUNWAYS, CPH_PERIMETER_ROADS, CPH_TAXIWAYS, CPH_RAMP_SPOTS,
  DK_MOTORWAYS, CPH_ARTERIALS, CITY_GLOWS,
  interpolateSegment, interpolatePath,
} from './night_lighting.js';

Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || '';

async function main() {
  const viewer = new Cesium.Viewer('cesiumContainer', {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    baseLayer: false,
  });
  viewer.cesiumWidget.creditContainer.style.display = 'none';

  // ── Bing Maps Aerial (asset 2) ──
  let bingLayer = null;
  try {
    const bing = await Cesium.IonImageryProvider.fromAssetId(2);
    bingLayer = viewer.imageryLayers.addImageryProvider(bing);
  } catch (err) { console.error('Bing Aerial failed:', err); }

  // ── Earth at Night (asset 3812) ──
  let earthAtNightLayer = null;
  try {
    const earthAtNight = await Cesium.IonImageryProvider.fromAssetId(3812);
    earthAtNightLayer = viewer.imageryLayers.addImageryProvider(earthAtNight);
    // Sun-aware blending: city lights show ONLY on the dark side of Earth,
    // hidden on the sunlit side. Requires globe.enableLighting = true.
    // This is Cesium's native mechanism for day/night imagery.
    earthAtNightLayer.dayAlpha = 0.0;
    earthAtNightLayer.nightAlpha = 1.0;
  } catch (err) { console.error('Earth at Night failed:', err); }
  // Bing keeps its defaults (dayAlpha=1, nightAlpha=1). enableLighting
  // shades the night side of Bing automatically via sun-position math.
  if (bingLayer) {
    bingLayer.dayAlpha = 1.0;
    bingLayer.nightAlpha = 0.5;   // partly transparent on dark side so city lights show through
  }

  // ── Cesium World Terrain (asset 1) ──
  try {
    viewer.terrainProvider = await Cesium.createWorldTerrainAsync({
      requestVertexNormals: true,
      requestWaterMask: true,
    });
  } catch (err) { console.warn('Terrain failed:', err); }

  // ── Google Photorealistic 3D Tiles (asset 2275207) ──
  // Covers major cities (CPH, Aarhus, Aalborg, Odense). Sparse in rural DK.
  let googlePhotoreal = null;
  try {
    googlePhotoreal = await Cesium.Cesium3DTileset.fromIonAssetId(2275207);
    viewer.scene.primitives.add(googlePhotoreal);
  } catch (err) { console.warn('Google 3D Tiles failed:', err); }

  // ── Cesium OSM Buildings (asset 96188) — global extruded fallback ──
  // Covers rural sites (Energinet substations, remote infra) where Google 3D
  // doesn't reach. Extruded from OSM building footprints, less photorealistic
  // but always shows building geometry. Styled as tactical wire-frame with
  // subtle cyan tint so it reads as "geometry reference" not "broken photoreal".
  // Matches Palantir/Lattice pattern for uncovered areas.
  let osmBuildings = null;
  try {
    osmBuildings = await Cesium.Cesium3DTileset.fromIonAssetId(96188);
    osmBuildings.style = new Cesium.Cesium3DTileStyle({
      color: 'color("#1a2733", 0.85)',                       // dark blue-slate fill
    });
    viewer.scene.primitives.add(osmBuildings);
  } catch (err) { console.warn('OSM Buildings failed:', err); }

  // ── SDFI GeoDanmark Ortofoto (Denmark, sovereign, CC BY 4.0) ──
  // Danish state imagery, activated when SDFI_TOKEN is set. Used only in
  // the receiver workspace map mode, per project_map_architecture.md.
  // Register a free token at https://dataforsyningen.dk (My page → Token)
  // and paste it below. When null, the receiver map falls back to Bing.
  const SDFI_TOKEN = 'fe7ed3229a1eb8c87028a3640dc6b2f6';
  let sdfiLayer = null;
  if (SDFI_TOKEN) {
    try {
      const sdfi = new Cesium.WebMapTileServiceImageryProvider({
        url: `https://api.dataforsyningen.dk/orto_foraar_wmts_DAF?token=${SDFI_TOKEN}`,
        layer: 'orto_foraar_wmts',
        style: 'default',
        format: 'image/jpeg',
        tileMatrixSetID: 'KortforsyningTilingDK',
        maximumLevel: 17,
        credit: new Cesium.Credit('© GeoDanmark / Klimadatastyrelsen (CC BY 4.0)', true),
      });
      sdfiLayer = viewer.imageryLayers.addImageryProvider(sdfi);
      sdfiLayer.show = false;   // hidden by default, shown in workspace map mode
    } catch (err) { console.warn('SDFI GeoDanmark failed:', err); }
  }
  window.__isr_sdfiLayer = sdfiLayer;   // exposed for workspace map mode toggle

  // ── Imagery mode ──
  let imageryMode = 'day';   // default landing view — day mode

  // Kept for legacy — night mode no longer uses brightness dimming (was
  // crushing city lights). See the applyImageryMode('night') branch which
  // now uses dayAlpha/nightAlpha per Cesium's native day-night pattern.
  const nightBrightness = Cesium.PostProcessStageLibrary.createBrightnessStage();
  nightBrightness.uniforms.brightness = 1.0;
  nightBrightness.enabled = false;
  viewer.scene.postProcessStages.add(nightBrightness);

  // Bloom stage placeholder — DISABLED. Previous uniforms were crashing
  // input responsiveness. Left as a no-op object so the applyImageryMode
  // references (nightBloom.enabled = ...) don't throw.
  const nightBloom = { enabled: false };
  function applyImageryMode() {
    const canvas = viewer.scene.canvas;
    // Common — enableLighting always on. atmosphereLightIntensity is NOT set
    // here (it's per-mode) so day doesn't inherit night's dimmed sky.
    viewer.scene.globe.enableLighting = true;
    nightBrightness.enabled = false;
    canvas.style.filter = '';

    if (imageryMode === 'night') {
      // Clock at November evening over Denmark — sun below horizon. This
      // is what makes the sky dark and the terrain shading read as night.
      // Without this the clock inherits whatever the last mode set (e.g.
      // day's summer noon) and night looks like day.
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601('2026-11-15T20:00:00Z');
      viewer.clock.shouldAnimate = false;
      viewer.scene.globe.atmosphereLightIntensity = 3.0;   // dim sky for night
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.skyAtmosphere.brightnessShift = -0.4;
      viewer.scene.skyAtmosphere.saturationShift = -0.2;
      if (bingLayer) {
        bingLayer.show = true;
        bingLayer.brightness = 0.15;
        bingLayer.saturation = 0.6;
      }
      if (earthAtNightLayer) {
        earthAtNightLayer.show = true;
        earthAtNightLayer.alpha = 1.0;
        earthAtNightLayer.brightness = 1.0;
        earthAtNightLayer.dayAlpha = 1.0;
        earthAtNightLayer.nightAlpha = 1.0;
        // Punch out dark VIIRS pixels so only city lights remain visible.
        // Dark rural / ocean areas go transparent → darkened Bing shows
        // through. Cities stay as bright glows at ALL zoom levels.
        earthAtNightLayer.colorToAlpha = Cesium.Color.BLACK;
        earthAtNightLayer.colorToAlphaThreshold = 0.15;
      }
      if (googlePhotoreal) googlePhotoreal.show = false;
      if (osmBuildings) {
        osmBuildings.show = true;
        osmBuildings.lightColor = new Cesium.Cartesian3(0.20, 0.25, 0.35);
        if (osmBuildings.imageBasedLighting) {
          osmBuildings.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(0.0, 0.0);
        }
      }
      if (window.__isr_sdfiLayer) window.__isr_sdfiLayer.show = false;
      nightBloom.enabled = false;
    } else if (imageryMode === 'day') {
      // DAY MODE — restored to yesterday's state before the night-mode
      // rabbit hole. Flat lighting (enableLighting=false) so building faces
      // aren't sun-shaded to black. OSM tint removed so extrusions look
      // white/natural instead of dark blue. Cesium defaults for atmosphere.
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601('2026-06-15T11:00:00Z');
      viewer.clock.shouldAnimate = false;
      viewer.scene.globe.enableLighting = false;
      viewer.scene.globe.atmosphereLightIntensity = 10.0;
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.skyAtmosphere.brightnessShift = 0;
      viewer.scene.skyAtmosphere.saturationShift = 0;
      if (bingLayer) {
        bingLayer.show = true;
        bingLayer.alpha = 1.0;
        bingLayer.brightness = 1.0;
        bingLayer.saturation = 1.0;
      }
      if (earthAtNightLayer) {
        earthAtNightLayer.alpha = 0;
        earthAtNightLayer.brightness = 1.0;
        earthAtNightLayer.dayAlpha = 1.0;
        earthAtNightLayer.nightAlpha = 1.0;
      }
      if (googlePhotoreal) {
        googlePhotoreal.show = true;
        googlePhotoreal.lightColor = undefined;
        if (googlePhotoreal.imageBasedLighting) {
          googlePhotoreal.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(1.0, 1.0);
        }
      }
      if (osmBuildings) {
        osmBuildings.show = true;
        osmBuildings.lightColor = undefined;
        osmBuildings.style = undefined;    // remove the dark blue tint
        if (osmBuildings.imageBasedLighting) {
          osmBuildings.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(1.0, 1.0);
        }
      }
      nightBloom.enabled = false;
    } else {
      viewer.clock.currentTime = Cesium.JulianDate.now();
      viewer.clock.shouldAnimate = true;
      viewer.scene.globe.atmosphereLightIntensity = 10.0;
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.skyAtmosphere.brightnessShift = 0;
      viewer.scene.skyAtmosphere.saturationShift = 0;
      if (bingLayer) {
        bingLayer.show = true;
        bingLayer.alpha = 1.0;
        bingLayer.brightness = 1.0;
        bingLayer.saturation = 1.0;
      }
      if (earthAtNightLayer) {
        earthAtNightLayer.alpha = 0;
        earthAtNightLayer.brightness = 1.0;
        earthAtNightLayer.dayAlpha = 1.0;
        earthAtNightLayer.nightAlpha = 1.0;
      }
      if (googlePhotoreal) {
        googlePhotoreal.show = true;
        googlePhotoreal.lightColor = undefined;
        if (googlePhotoreal.imageBasedLighting) {
          googlePhotoreal.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(1.0, 1.0);
        }
      }
      if (osmBuildings) {
        osmBuildings.show = true;
        osmBuildings.lightColor = undefined;
        if (osmBuildings.imageBasedLighting) {
          osmBuildings.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(1.0, 1.0);
        }
      }
      nightBloom.enabled = false;
    }
    // Procedural night lights (runways, motorways, city glows) toggle
    // with the mode. DELIBERATELY does not touch any Cesium global state
    // (no bloom, no canvas filter, no globe/atmosphere/clock mutations,
    // no tile style changes). Those APIs leak internal state that
    // corrupts day mode rendering. Additive entities only.
    if (imageryMode === 'night') {
      _renderNightLights();
      // Trigger close-up check immediately after applyImageryMode
      // finishes its layer writes. If altitude < 50km, close-up config
      // takes over (day-lit ground, dark sky). Otherwise stays "night
      // from space" as applyImageryMode set it.
      requestAnimationFrame(() => _updateNightCloseUp());
    } else {
      _clearNightLights();
      _deactivateOverlayLights();
      const container = document.getElementById('cesiumContainer');
      if (container) container.classList.remove('night-closeup-darken');
      // If we were in close-up state, reset it so day/auto mode inherit
      // clean night-distant config (matches applyImageryMode expectations).
      if (_nightCloseUpActive) {
        _applyNightDistantConfig();
        _nightCloseUpActive = false;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Night-mode procedural lighting + altitude-driven imagery blend
  // ───────────────────────────────────────────────────────────────────
  // Runways / taxiways / arterials / motorway strings / city glows are
  // added as Cesium entities and removed when night mode is deactivated.
  // Imagery blend: at high altitude the darkened Bing + Earth-at-Night
  // reads as "night from space". At low altitude the SDFI Danish
  // orthophoto (day imagery, dimmed) fades in so the operator can see
  // real terrain detail — buildings, runways, waterways — as a
  // "night-lit terrain" view. Lights populated procedurally on top.
  // ═══════════════════════════════════════════════════════════════════
  const _nightLightEntities = [];

  function _clearNightLights() {
    for (const e of _nightLightEntities) viewer.entities.remove(e);
    _nightLightEntities.length = 0;
  }

  // Radial-gradient glow images for point lights. Cached per (color, size) so
  // we don't regenerate the canvas on every entity. White-hot core + colored
  // halo fading to transparent — reads as an actual glowing light source
  // instead of a flat colored disk (which is what Cesium `point` primitives
  // look like — hence the previous "vague yellow dots" appearance).
  const _lightGlowCache = new Map();
  function _lightGlowImage(colorHex) {
    if (_lightGlowCache.has(colorHex)) return _lightGlowCache.get(colorHex);
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const col = Cesium.Color.fromCssColorString(colorHex);
    const r = Math.round(col.red * 255);
    const g = Math.round(col.green * 255);
    const b = Math.round(col.blue * 255);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    grad.addColorStop(0.00, `rgba(255, 255, 255, 1.0)`);   // white-hot core
    grad.addColorStop(0.15, `rgba(255, 255, 255, 0.95)`);  // core spreads
    grad.addColorStop(0.30, `rgba(${r}, ${g}, ${b}, 0.85)`); // colored inner halo
    grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.35)`); // soft mid halo
    grad.addColorStop(0.80, `rgba(${r}, ${g}, ${b}, 0.10)`); // faint outer glow
    grad.addColorStop(1.00, `rgba(${r}, ${g}, ${b}, 0)`);    // fully transparent edge
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    _lightGlowCache.set(colorHex, c);
    return c;
  }

  function _addLightPoint(lat, lon, color, pixelSize, alpha = 1) {
    // Billboard-based light. Ground-clamped so it sits on actual terrain
    // (no more sea-level offset that made lights drift over planes when
    // camera tilts down). Depth test enabled so buildings/aircraft in front
    // of the light properly occlude it.
    return viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      billboard: {
        image: _lightGlowImage(color),
        // Billboard is a radial gradient — displayed size includes the halo,
        // so bump up ~2.5× the intended "hot core" pixel size so the visible
        // bright center matches the old point sizing while the halo extends
        // beyond it.
        width: pixelSize * 2.8,
        height: pixelSize * 2.8,
        color: Cesium.Color.WHITE.withAlpha(alpha),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      properties: { nightLight: true },
    });
  }

  function _addLightPolyline(path, color, width, alpha = 0.7) {
    // PolylineGlowMaterialProperty gives the road/runway line an actual
    // glowing bloom appearance (bright core, faded halo along the length)
    // instead of a flat colored stripe.
    const positions = Cesium.Cartesian3.fromDegreesArray(path.flatMap(p => [p[1], p[0]]));
    return viewer.entities.add({
      polyline: {
        positions,
        width,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.30,
          taperPower: 1.0,
          color: Cesium.Color.fromCssColorString(color).withAlpha(alpha),
        }),
        clampToGround: true,
      },
      properties: { nightLight: true },
    });
  }

  // Lazily-generated radial-gradient PNG for city glow billboards. Bright
  // amber center fading to fully transparent edge. Much softer than a
  // solid ellipse (which read as a flat orange disk). Sized in metres
  // per city via billboard `scale` at add time.
  let _cityGlowImage = null;
  function _cityGlowRadialImage() {
    if (_cityGlowImage) return _cityGlowImage;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 200, 120, 0.55)');
    g.addColorStop(0.3, 'rgba(255, 180, 100, 0.30)');
    g.addColorStop(0.6, 'rgba(255, 160, 80, 0.12)');
    g.addColorStop(1, 'rgba(255, 140, 60, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    _cityGlowImage = c;
    return c;
  }

  function _addCityGlow(lat, lon, radiusKm, intensity) {
    // Radial-gradient billboard with distance-display gating. Visible at
    // national/regional zoom (>15km altitude), hidden at close zoom so it
    // doesn't drown the airport view in orange soup. Scale in pixels sized
    // roughly to the glow radius at typical viewing altitude.
    return viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      billboard: {
        image: _cityGlowRadialImage(),
        // Billboard sizes in metres via `sizeInMeters` — makes glow scale
        // naturally as the camera moves closer or further
        sizeInMeters: true,
        width: radiusKm * 2000,   // diameter in metres
        height: radiusKm * 2000,
        color: Cesium.Color.WHITE.withAlpha(intensity),
        // Only render when camera altitude is between 15km and 5000km.
        // Hides the glow when zoomed in close (no orange soup) and when
        // zoomed way out (globe view).
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(15_000, 5_000_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { nightLight: true },
    });
  }

  function _renderNightLights() {
    _clearNightLights();
    // Sizes bumped substantially so lights survive the CSS filter
    // (brightness 0.16 = they need to be ~2× normal size to still read
    // as bright points against the darkened ground).
    for (const rw of CPH_RUNWAYS) {
      _nightLightEntities.push(_addLightPolyline(rw.path, rw.color, 4, 1.0));
      const densePoints = interpolatePath(rw.path, rw.light_spacing_m);
      for (const [lat, lon] of densePoints) {
        _nightLightEntities.push(_addLightPoint(lat, lon, rw.color, 6, 1.0));
      }
    }
    for (const road of CPH_PERIMETER_ROADS) {
      const [start, end] = road.endpoints;
      const points = interpolateSegment(start[0], start[1], end[0], end[1], road.light_spacing_m);
      for (const [lat, lon] of points) {
        _nightLightEntities.push(_addLightPoint(lat, lon, road.color, 4, 0.95));
      }
    }
    for (const tw of CPH_TAXIWAYS) {
      _nightLightEntities.push(_addLightPolyline(tw.path, '#ffcc88', 2.5, 0.95));
      const densePoints = interpolatePath(tw.path, 30);
      for (const [lat, lon] of densePoints) {
        _nightLightEntities.push(_addLightPoint(lat, lon, '#ffcc88', 5, 1.0));
      }
    }
    for (const spot of CPH_RAMP_SPOTS) {
      _nightLightEntities.push(_addLightPoint(spot.lat, spot.lon, '#ffe8a3', 10, 1.0));
    }
    // Motorways + arterials both bumped substantially so all Danish
    // roads visibly light up like the airport does.
    for (const mw of DK_MOTORWAYS) {
      _nightLightEntities.push(_addLightPolyline(mw.points, '#ffa040', 3.5, 1.0));
    }
    for (const art of CPH_ARTERIALS) {
      _nightLightEntities.push(_addLightPolyline(art.points, '#ffd28a', 3.0, 1.0));
    }
    // City glows — soft radial halos over major Danish population centres
    for (const c of CITY_GLOWS) {
      _nightLightEntities.push(_addCityGlow(c.lat, c.lon, c.radius_km, c.intensity));
    }
    console.log(`[Night lights] rendered ${_nightLightEntities.length} entities across airport, motorways, arterials, and city glows`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // HTML overlay lights — TRUE glowing lights OUTSIDE the CSS filter
  // ───────────────────────────────────────────────────────────────────
  // Cesium entities inside #cesiumContainer are dimmed by the
  // night-closeup-darken CSS filter (that's how the ground reads dark).
  // To make lights actually SHINE we render them to a canvas that lives
  // OUTSIDE #cesiumContainer (sibling element), unaffected by the filter.
  //
  // Per-frame: viewer.scene.postRender fires after Cesium draws. For each
  // 3D light position we project to 2D window coords and draw a radial
  // gradient. Occluded points (behind the earth) are skipped via
  // EllipsoidalOccluder. Additive blending ('lighter') sums brightness
  // where lights overlap — matches real bloom behaviour.
  //
  // Zero Cesium global state touched. Zero forbidden APIs. Additive-only.
  // ═══════════════════════════════════════════════════════════════════
  let _overlayCanvas = null;
  let _overlayCtx = null;
  let _overlayLights = [];
  let _overlayPostRenderCb = null;
  let _overlayResizeCb = null;

  // Small deterministic PRNG so per-light jitter is stable across reloads
  // (no flicker on rebuild). Seed = light index.
  function _lightRand(seed) {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  // Per-category ground heights matched to real-world terrain +
  // googlePhotoreal rendering. Numbers picked so lights sit ON the
  // visible ground plane at drone POV, minimizing parallax drift as
  // camera tilts. Won't be perfect everywhere (real elevations vary
  // by tens of meters across DK), but eliminates airport-area drift
  // which is the demo money shot. NEVER use clampToHeightMostDetailed
  // (that's what froze the browser previously — banned).
  const GROUND_H_CPH_AIRPORT = 8;    // CPH ~5m real + safety, photoreal ~5-8m
  const GROUND_H_CPH_DOWNTOWN = 12;  // Copenhagen inner-city arterials
  const GROUND_H_MOTORWAY = 10;      // DK motorway average (varies 0-50m)
  const GROUND_H_GLOW = 8;           // City glows — height doesn't matter much

  function _pushJitteredLight(lat, lon, color, baseSize, baseAlpha, groundH, extra = {}) {
    const idx = _overlayLights.length;
    const jLat = (_lightRand(idx * 3.1) - 0.5) * 0.00006;
    const jLon = (_lightRand(idx * 5.7) - 0.5) * 0.00006;
    const sizeVar = 0.7 + _lightRand(idx * 7.3) * 0.6;   // 0.7 - 1.3
    const alphaVar = 0.65 + _lightRand(idx * 11.1) * 0.35; // 0.65 - 1.0
    _overlayLights.push({
      cart3: Cesium.Cartesian3.fromDegrees(lon + jLon, lat + jLat, groundH),
      color, size: baseSize * sizeVar, alpha: Math.min(1, baseAlpha * alphaVar),
      ...extra,
    });
  }

  function _buildOverlayLights() {
    _overlayLights = [];
    for (const rw of CPH_RUNWAYS) {
      const points = interpolatePath(rw.path, rw.light_spacing_m);
      for (const [lat, lon] of points) {
        _pushJitteredLight(lat, lon, rw.color, 3, 1.0, GROUND_H_CPH_AIRPORT);
      }
    }
    for (const road of CPH_PERIMETER_ROADS) {
      const [start, end] = road.endpoints;
      const points = interpolateSegment(start[0], start[1], end[0], end[1], Math.max(road.light_spacing_m, 90));
      for (const [lat, lon] of points) {
        _pushJitteredLight(lat, lon, road.color, 2, 0.85, GROUND_H_CPH_AIRPORT);
      }
    }
    for (const tw of CPH_TAXIWAYS) {
      const points = interpolatePath(tw.path, 55);
      for (const [lat, lon] of points) {
        _pushJitteredLight(lat, lon, '#ffcc88', 2, 0.9, GROUND_H_CPH_AIRPORT);
      }
    }
    for (const spot of CPH_RAMP_SPOTS) {
      _pushJitteredLight(spot.lat, spot.lon, '#ffe8a3', 5, 1.0, GROUND_H_CPH_AIRPORT);
    }
    for (const mw of DK_MOTORWAYS) {
      const points = interpolatePath(mw.points, 60);
      for (const [lat, lon] of points) {
        _pushJitteredLight(lat, lon, '#ffa040', 2.5, 0.9, GROUND_H_MOTORWAY);
      }
    }
    for (const art of CPH_ARTERIALS) {
      const points = interpolatePath(art.points, 40);
      for (const [lat, lon] of points) {
        _pushJitteredLight(lat, lon, '#ffd28a', 2, 0.85, GROUND_H_CPH_DOWNTOWN);
      }
    }
    for (const c of CITY_GLOWS) {
      _overlayLights.push({
        cart3: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, GROUND_H_GLOW),
        color: '#ffc080', size: 40, alpha: 0.55 * c.intensity,
        isGlow: true, glowRadiusKm: c.radius_km,
      });
    }
    console.log(`[Overlay lights] precomputed ${_overlayLights.length} jittered light points`);
  }

  function _ensureOverlayCanvas() {
    if (_overlayCanvas) return;
    _overlayCanvas = document.getElementById('night-light-overlay-canvas');
    if (!_overlayCanvas) return;
    _overlayCtx = _overlayCanvas.getContext('2d');
    _resizeOverlayCanvas();
  }

  function _resizeOverlayCanvas() {
    if (!_overlayCanvas || !_overlayCtx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    _overlayCanvas.width = Math.round(w * dpr);
    _overlayCanvas.height = Math.round(h * dpr);
    _overlayCanvas.style.width = w + 'px';
    _overlayCanvas.style.height = h + 'px';
    _overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // One-shot async: sample REAL Cesium World Terrain elevation at every
  // light position, replace each light's cart3 with (terrain height +
  // 0.5m safety lift). Same API pattern the sensor terrain-anchor pass
  // uses (line ~1067). sampleTerrainMostDetailed loads terrain tiles
  // ONLY (lightweight, not the 3D-tile depth readback that froze earlier).
  // Result: lights anchored to actual DK terrain elevation, drift
  // dramatically reduced at drone POV.
  let _overlayLightsTerrainSampled = false;
  async function _sampleOverlayLightsTerrain() {
    if (_overlayLightsTerrainSampled) return;
    if (!viewer.terrainProvider) return;
    if (typeof Cesium.sampleTerrainMostDetailed !== 'function') return;
    _overlayLightsTerrainSampled = true;
    try {
      const carts = _overlayLights.map(l => {
        const c = Cesium.Cartographic.fromCartesian(l.cart3);
        return Cesium.Cartographic.fromRadians(c.longitude, c.latitude);
      });
      const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, carts);
      const LIFT_M = 0.5;
      let ok = 0;
      sampled.forEach((cart, i) => {
        if (cart && cart.height != null && !isNaN(cart.height)) {
          const light = _overlayLights[i];
          light.cart3 = Cesium.Cartesian3.fromRadians(
            cart.longitude, cart.latitude, cart.height + LIFT_M
          );
          ok++;
        }
      });
      console.log(`[Overlay lights] terrain-anchored ${ok}/${sampled.length} lights (real DK elevation)`);
      viewer.scene.requestRender();
    } catch (err) {
      console.warn('[Overlay lights] terrain sample failed:', err);
      _overlayLightsTerrainSampled = false; // allow retry
    }
  }

  function _activateOverlayLights() {
    _ensureOverlayCanvas();
    if (!_overlayCanvas) return;
    if (_overlayLights.length === 0) _buildOverlayLights();
    _overlayCanvas.classList.add('active');
    if (!_overlayPostRenderCb) {
      _overlayPostRenderCb = () => _drawOverlayLights();
      viewer.scene.postRender.addEventListener(_overlayPostRenderCb);
    }
    if (!_overlayResizeCb) {
      _overlayResizeCb = () => { _resizeOverlayCanvas(); viewer.scene.requestRender(); };
      window.addEventListener('resize', _overlayResizeCb);
    }
    viewer.scene.requestRender();
    // Kick off terrain anchor. Runs once, then lights are frozen at real
    // Danish terrain elevation forever (survives POV changes, tilts, etc).
    _sampleOverlayLightsTerrain();
  }

  function _deactivateOverlayLights() {
    if (_overlayCanvas) {
      _overlayCanvas.classList.remove('active');
      if (_overlayCtx) {
        _overlayCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }
    if (_overlayPostRenderCb) {
      viewer.scene.postRender.removeEventListener(_overlayPostRenderCb);
      _overlayPostRenderCb = null;
    }
    if (_overlayResizeCb) {
      window.removeEventListener('resize', _overlayResizeCb);
      _overlayResizeCb = null;
    }
  }

  const _overlayScratch2 = new Cesium.Cartesian2();
  function _drawOverlayLights() {
    if (!_overlayCtx || !_overlayCanvas) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    _overlayCtx.clearRect(0, 0, w, h);

    const cameraPos = viewer.camera.positionWC;
    const cameraAlt = viewer.camera.positionCartographic?.height || 100000;
    const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, cameraPos);
    const scene = viewer.scene;

    // Additive blend — overlapping lights sum brightness (real bloom look)
    _overlayCtx.globalCompositeOperation = 'lighter';

    for (const light of _overlayLights) {
      if (!occluder.isPointVisible(light.cart3)) continue;
      // worldToWindowCoordinates is the newer API; fall back to wgs84 name for older builds
      const winPos = (Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates)
                       .call(Cesium.SceneTransforms, scene, light.cart3, _overlayScratch2);
      if (!winPos) continue;
      const x = winPos.x;
      const y = winPos.y;
      if (x < -100 || x > w + 100 || y < -100 || y > h + 100) continue;

      let renderSize = light.size;
      if (light.isGlow) {
        // City halo — scale down as camera zooms in (soft ambient sky glow at distance)
        renderSize = Math.min(220, 6000 * light.glowRadiusKm / Math.max(cameraAlt, 20000));
      }
      _drawGlowPoint(_overlayCtx, x, y, renderSize, light.color, light.alpha);
    }

    _overlayCtx.globalCompositeOperation = 'source-over';
  }

  function _drawGlowPoint(ctx, x, y, size, colorHex, alpha) {
    const col = Cesium.Color.fromCssColorString(colorHex);
    const r = Math.round(col.red * 255);
    const g = Math.round(col.green * 255);
    const b = Math.round(col.blue * 255);
    // Halo width tightened from 3.5× to 2.4× base size. Same brightness
    // + saturation — only the OUTER falloff is narrowed so lights read as
    // distinct points instead of merging into a yellow blob mid-runway.
    const halo = size * 2.4;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, halo);
    grad.addColorStop(0.00, `rgba(255,255,255,${(0.95 * alpha).toFixed(3)})`);
    grad.addColorStop(0.08, `rgba(255,255,255,${(0.80 * alpha).toFixed(3)})`);
    grad.addColorStop(0.22, `rgba(${r},${g},${b},${(0.65 * alpha).toFixed(3)})`);
    grad.addColorStop(0.50, `rgba(${r},${g},${b},${(0.22 * alpha).toFixed(3)})`);
    grad.addColorStop(0.80, `rgba(${r},${g},${b},${(0.05 * alpha).toFixed(3)})`);
    grad.addColorStop(1.00, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - halo, y - halo, halo * 2, halo * 2);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Night close-up mode (safe retry — DOM-only darken)
  // ───────────────────────────────────────────────────────────────────
  // When night mode is active AND camera altitude < 15km, apply:
  //   1. Imagery layer alpha/brightness/show toggles for Bing / SDFI /
  //      EarthAtNight — these are the SAME properties applyImageryMode
  //      already flips per mode, so they self-heal on any user toggle.
  //   2. CSS filter on #cesiumContainer wrapper (NOT the canvas, NOT
  //      via any Cesium API) — purely browser-compositor darkening.
  // Buildings kept dark (their init-time tint + IBL stay untouched).
  //
  // Explicitly NEVER touching: bloom, canvas.style.filter, tile styles,
  // osmBuildings.lightColor/IBL, globe.enableLighting/atmosphere/clock.
  // Those APIs leaked corruption into day mode in previous attempts.
  //
  // Reset happens automatically when user toggles day/auto — applyImageryMode
  // fully resets Bing/SDFI/EarthAtNight to that mode's values.
  // ═══════════════════════════════════════════════════════════════════
  // Night close-up (STEP 1): below 50km altitude in night mode, render
  // buildings + ground exactly like day mode does. Sky stays night-dark
  // (via skyAtmosphere brightness + night clock). Procedural lights
  // continue on top. NO darkening filter yet — that's step 2 once this
  // baseline is confirmed working.
  //
  // The trick to "dark sky + lit ground": night clock (sun below horizon
  // → dark sky) + enableLighting=false (globe surface flat-lit, ignores
  // sun position → ground fully visible).
  //
  // Every write has a paired reverse in _applyNightDistantConfig().
  // NEVER touches bloom (was corruption source) or canvas.style.filter.
  let _nightCloseUpActive = false;
  function _updateNightCloseUp() {
    if (imageryMode !== 'night') {
      if (_nightCloseUpActive) {
        _applyNightDistantConfig();
        _nightCloseUpActive = false;
      }
      const container = document.getElementById('cesiumContainer');
      if (container) container.classList.remove('night-closeup-darken');
      _deactivateOverlayLights();
      return;
    }
    const h = viewer.camera.positionCartographic?.height || 0;
    const closeUp = h < 50_000;
    const container = document.getElementById('cesiumContainer');
    if (closeUp && !_nightCloseUpActive) {
      _applyNightCloseUpConfig();
      _nightCloseUpActive = true;
      if (container) container.classList.add('night-closeup-darken');
      _activateOverlayLights();
    } else if (!closeUp && _nightCloseUpActive) {
      _applyNightDistantConfig();
      _nightCloseUpActive = false;
      if (container) container.classList.remove('night-closeup-darken');
      _deactivateOverlayLights();
    }
  }

  function _applyNightCloseUpConfig() {
    // Replicates EVERY visual property day mode uses, INLINE (does not
    // call applyImageryMode) so future day-mode edits don't propagate
    // here and vice versa. Sky pushed EXTRA dark here (below night's
    // baseline -0.4) so it reads as fully-night at close-up in
    // combination with the DOM darken filter. Reversed in distant.
    viewer.scene.globe.enableLighting = false;
    viewer.scene.skyAtmosphere.brightnessShift = -0.85;   // was -0.4 (night baseline)
    viewer.scene.skyAtmosphere.saturationShift = -0.4;    // was -0.2
    viewer.scene.globe.atmosphereLightIntensity = 1.0;    // was 3.0
    // Imagery brightness = darken THE IMAGERY LAYER at the GPU level
    // (BEFORE Cesium composites entities on top). Result: ground reads as
    // night-dark, but our light entities (points/polylines/billboards)
    // draw at full brightness on top → real "lights punching through
    // dark ground" effect. No CSS filter needed.
    // Imagery layers back to day-full brightness. CSS filter on the
    // container does the visual darkening (safer — cannot corrupt tile
    // state the way osmBuildings IBL toggling did).
    if (bingLayer) {
      bingLayer.show = true;
      bingLayer.alpha = 1.0;
      bingLayer.brightness = 1.0;
      bingLayer.saturation = 1.0;
    }
    if (earthAtNightLayer) {
      earthAtNightLayer.show = false;
      earthAtNightLayer.alpha = 0;
      earthAtNightLayer.brightness = 1.0;
      earthAtNightLayer.dayAlpha = 1.0;
      earthAtNightLayer.nightAlpha = 1.0;
    }
    if (window.__isr_sdfiLayer) {
      window.__isr_sdfiLayer.show = true;
      window.__isr_sdfiLayer.alpha = 1.0;
      window.__isr_sdfiLayer.brightness = 1.0;
    }
    if (googlePhotoreal) {
      googlePhotoreal.show = true;
      googlePhotoreal.lightColor = undefined;
      if (googlePhotoreal.imageBasedLighting) {
        googlePhotoreal.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(1.0, 1.0);
      }
    }
    // osmBuildings deliberately NOT touched. Toggling its
    // imageBasedLighting / lightColor across mode transitions is what
    // corrupted the tileset (parts of buildings rendering as white
    // untextured shells). Left at whatever state applyImageryMode set.
    // Hide the city-glow BILLBOARDS at close zoom — they were the "big
    // orange blubber" showing up over the day-rendered ground at
    // intermediate zoom (distance-display 15km threshold wasn't enough).
    for (const e of _nightLightEntities) {
      if (e.billboard && e.properties?.getValue?.()?.nightLight) {
        e.show = false;
      }
    }
  }

  function _applyNightDistantConfig() {
    // Every close-up write above reversed to original night config.
    // osmBuildings deliberately NOT touched (see close-up config note).
    viewer.scene.globe.enableLighting = true;
    viewer.scene.skyAtmosphere.brightnessShift = -0.4;    // night baseline
    viewer.scene.skyAtmosphere.saturationShift = -0.2;
    viewer.scene.globe.atmosphereLightIntensity = 3.0;
    if (bingLayer) bingLayer.brightness = 0.15;
    if (earthAtNightLayer) {
      earthAtNightLayer.show = true;
      earthAtNightLayer.alpha = 1.0;
    }
    if (window.__isr_sdfiLayer) window.__isr_sdfiLayer.show = false;
    if (googlePhotoreal) {
      googlePhotoreal.show = false;
    }
    // Restore city glow billboard visibility for the distant view
    for (const e of _nightLightEntities) {
      if (e.billboard && e.properties?.getValue?.()?.nightLight) {
        e.show = true;
      }
    }
  }
  viewer.camera.moveEnd.addEventListener(() => _updateNightCloseUp());

  viewer.scene.postRender.addEventListener(() => {
    if (imageryMode !== 'auto') return;
    const height = viewer.camera.positionCartographic.height;
    const canvas = viewer.scene.canvas;
    if (earthAtNightLayer) {
      if (height > 3_000_000) earthAtNightLayer.alpha = 0.65;
      else if (height < 500_000) earthAtNightLayer.alpha = 0;
      else earthAtNightLayer.alpha = 0.65 * (height - 500_000) / 2_500_000;
    }
    if (height > 1_500_000) {
      canvas.style.filter = 'brightness(0.5) contrast(1.3) saturate(0.6) hue-rotate(-8deg)';
    } else if (height < 50_000) {
      canvas.style.filter = 'saturate(0.95) contrast(1.05) hue-rotate(-3deg)';
    } else {
      const t = 1 - (height - 50_000) / 1_450_000;
      canvas.style.filter = `brightness(${0.5 + t * 0.45}) contrast(${1.3 - t * 0.25}) saturate(${0.6 + t * 0.35}) hue-rotate(-3deg)`;
    }
  });

  // Night mode Earth-at-Night stays at alpha 1.0 at all zoom levels.
  // colorToAlpha makes dark VIIRS pixels transparent so the "blobby ugly"
  // pixelation over rural areas vanishes — only bright city glows remain.
  // No altitude fade needed; the transparency handles zoom-in cleanly.

  // ── Night vision post-process (drone POV / thermal vibe) ──
  // Cesium's built-in NVG shader — green tint + noise grain + vignette.
  // Toggled globally with keyboard 'N'. Off by default so it doesn't fight
  // the astronomical night lighting on the platform overview. Ideal for
  // drone POV camera views where the scene should read as low-light IR feed.
  const nvgStage = Cesium.PostProcessStageLibrary.createNightVisionStage();
  nvgStage.enabled = false;
  viewer.scene.postProcessStages.add(nvgStage);
  window.__isr_nvgStage = nvgStage;
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'n' || ev.key === 'N') {
      if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
      nvgStage.enabled = !nvgStage.enabled;
    }
  });

  // ── Real astronomical lighting ──
  // Sun position drives terrain shading and the day/night terminator across
  // the globe. Cesium computes solar position from viewer.clock.currentTime,
  // so setting the clock to a specific evening freezes the light at the
  // most cinematic moment: dusk over Denmark with the terminator sweeping
  // NW→SE across Europe, city lights starting to appear on the dark side.
  // Sensors float on ground-relative positions so vertical exaggeration
  // stays at 1.0 (was tried at 1.4, broke placement).
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601('2026-11-15T17:30:00Z');
  viewer.clock.shouldAnimate = false;   // freeze the moment; flip to true if we want live sun movement

  // ── Camera + scene styling ──
  const controller = viewer.scene.screenSpaceCameraController;
  controller.minimumZoomDistance = 50;
  controller.maximumZoomDistance = 20_000_000;
  controller.inertiaSpin = 0.7;
  controller.inertiaTranslate = 0.7;
  controller.inertiaZoom = 0.5;
  viewer.scene.skyAtmosphere.hueShift = -0.06;
  // NOTE: skyAtmosphere brightnessShift + saturationShift are now managed
  // per-mode by applyImageryMode() so they don't fight the day/night toggle.
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#06080b');
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.0001;
  localStorage.removeItem('isr-c2-camera');

  // ══════════════════════════════════════════
  // SITE RENDERING
  // ══════════════════════════════════════════

  function renderSite(site) {
    // Outer site boundary — dashed cyan line, slightly thicker than sub-areas
    if (site.siteBoundary && site.siteBoundary.length > 0) {
      viewer.entities.add({
        id: `${site.id}-site-boundary`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([
            ...site.siteBoundary.flat(),
            site.siteBoundary[0][0], site.siteBoundary[0][1],
          ]),
          width: 2.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.7),
            dashLength: 14,
          }),
          clampToGround: true,
        },
      });
    }

    // Sub-area polygons — thinner dashed outline, subtle fill.
    // Sites may have zero, one, or multiple sub-area polygons.
    if (site.perimeter && site.perimeter.length > 0) {
      const polygons = Array.isArray(site.perimeter[0][0])
        ? site.perimeter
        : [site.perimeter];

      polygons.forEach((polygon, i) => {
        // Fill
        viewer.entities.add({
          id: `${site.id}-perimeter-${i}`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(polygon.flat()),
            material: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.12),
            outline: false,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });
        // Dashed outline — matches CPH airport siteBoundary weight for
        // consistent site-boundary reading across all site types.
        viewer.entities.add({
          id: `${site.id}-perimeter-outline-${i}`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray([
              ...polygon.flat(),
              polygon[0][0], polygon[0][1],
            ]),
            width: 2.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.75),
              dashLength: 14,
            }),
            clampToGround: true,
          },
        });
      });
    }

    // Sub-area lines — hand-traced quay/kaj edges, thin dashed
    if (site.subLines && site.subLines.length > 0) {
      site.subLines.forEach((line, i) => {
        viewer.entities.add({
          id: `${site.id}-subline-${i}`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(line.flat()),
            width: 1.0,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.5),
              dashLength: 10,
            }),
            clampToGround: true,
          },
        });
      });
    }

    // Sensor dots — clamped to ground via Cesium's heightReference so they
    // always sit ON terrain regardless of camera angle or building geometry.
    // Previous approach (absolute height + disableDepthTestDistance:Infinity)
    // caused rooftop-labelled sensors to appear "hovering" above buildings
    // because the point rendered on top of everything at sea-level height.
    // CLAMP_TO_GROUND makes Cesium re-compute per frame — natural placement.
    for (const sensor of site.sensors) {
      const color = sensor.status === 'online'
        ? Cesium.Color.fromCssColorString('#4dff9c')
        : sensor.status === 'degraded'
          ? Cesium.Color.fromCssColorString('#ff8c3d')
          : Cesium.Color.fromCssColorString('#ff3838');

      viewer.entities.add({
        id: `sensor-${site.id}-${sensor.id}`,
        position: Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, 0),
        point: {
          pixelSize: sensor.isCore ? 11 : 8,
          color: color,
          outlineColor: color.withAlpha(0.4),
          outlineWidth: sensor.isCore ? 5 : 3,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          type: 'sensor',
          siteId: site.id,
          sensorId: sensor.id,
        },
      });

      // Coverage ring — hidden by default. Revealed only when the site is
      // active (clicked sensor OR flown-to via control panel). Palantir /
      // Anduril pattern: clean global view, detail on demand. Rings for the
      // whole site show together, not per-sensor — one click gives complete
      // coverage context. Offline sensors get no ring so operators see the gap.
      if (sensor.status !== 'offline') {
        viewer.entities.add({
          id: `sensor-cov-${site.id}-${sensor.id}`,
          show: false,
          position: Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, 0),
          ellipse: {
            semiMajorAxis: sensor.coverageRadius,
            semiMinorAxis: sensor.coverageRadius,
            material: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.06),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.35),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: {
            type: 'sensor-coverage',
            siteId: site.id,
          },
        });
      }
    }
  }

  // Render all sites
  for (const siteKey of Object.keys(SITES)) {
    renderSite(SITES[siteKey]);
  }

  // ── Lock all sensor positions to absolute Cartesian3 ──
  // Sample terrain height once, then set entity positions with a small
  // above-ground offset. Sensors then never move as the camera pans / tracks
  // a threat — they behave like real fixed hardware.
  (async () => {
    try {
      const allSensors = [];
      const carts = [];
      for (const sid of Object.keys(SITES)) {
        for (const s of SITES[sid].sensors) {
          allSensors.push({ sid, s });
          carts.push(Cesium.Cartographic.fromDegrees(s.lon, s.lat));
        }
      }
      const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, carts);
      const OFFSET_M = 3; // small offset above ground so the point isn't buried in terrain
      sampled.forEach((cart, i) => {
        const { sid, s } = allSensors[i];
        const height = (cart.height || 0) + OFFSET_M;
        const entity = viewer.entities.getById(`sensor-${sid}-${s.id}`);
        if (entity) {
          entity.position = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, height);
        }
      });
    } catch (err) {
      console.warn('Sensor terrain sampling failed, sensors will use default altitude:', err);
    }
  })();

  // ── Overlay visibility state (labels + icons + projections toggles in control panel) ──
  const overlayState = { labels: true, icons: true, projections: true };
  function applyOverlayVisibility() {
    const entities = viewer.entities.values;
    for (const e of entities) {
      const t = e.properties && e.properties.type && e.properties.type.getValue
        ? e.properties.type.getValue()
        : null;
      if (t !== 'target' && t !== 'site-rollup') continue;
      if (e.label)     e.label.show     = overlayState.labels;
      if (e.billboard) e.billboard.show = overlayState.icons;
      if (e.point)     e.point.show     = overlayState.icons;
      if (e.ellipse)   e.ellipse.show   = overlayState.icons;
    }
    // Projections toggle: if off, remove existing trajectory entities.
    // They'll be recreated next tick if projections goes back on.
    if (!overlayState.projections) {
      for (const eid of Array.from(projectedTrajectoryEntities.keys())) {
        removeProjectedTrajectoryEntity(eid);
      }
    }
  }

  // ── Multi-site rollup markers (visible at country zoom, click to fly-in) ──
  const rollupEntities = new Map();
  function rollupState(siteId) {
    const active = EVENTS.filter(e => e.siteId === siteId && e.status === 'active');
    const hasHostile = active.some(e => e.classification === 'hostile');
    const color = hasHostile ? '#ff3838' : active.length ? '#ffb84d' : '#4dff9c';
    return { count: active.length, color, hasHostile };
  }
  function renderRollupMarkers() {
    for (const entity of rollupEntities.values()) viewer.entities.remove(entity);
    rollupEntities.clear();
    for (const siteId of Object.keys(SITES)) {
      const site = SITES[siteId];
      const s = rollupState(siteId);
      const label = s.count ? `${site.name}  ·  ${s.count} live` : site.name;
      const entity = viewer.entities.add({
        id: `site-rollup-${siteId}`,
        position: Cesium.Cartesian3.fromDegrees(site.coordinates.lon, site.coordinates.lat, 200),
        point: {
          pixelSize: s.hasHostile ? 20 : 16,
          color: Cesium.Color.fromCssColorString(s.color),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.NONE,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(30000, 5_000_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: label,
          font: '600 12px "IBM Plex Sans", sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(7, 4),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(30000, 5_000_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: 'site-rollup', siteId },
      });
      rollupEntities.set(siteId, entity);
    }
    if (typeof applyOverlayVisibility === 'function') applyOverlayVisibility();
  }
  renderRollupMarkers();
  onSelectionChange(() => renderRollupMarkers());
  // NOTE: intentionally NOT resetting _selectedSwarmIndex on selection change.
  // The bounds check at the top of renderDetailPanel handles stale indices.
  // Resetting here was clobbering the click-set index due to synchronous
  // listener firing in selectEvent — see events.js selectEvent implementation.

  // ── Protected critical-infrastructure target markers ──
  // Not sensor sites, just assets the platform is aware of and can flag
  // when a drone trajectory intersects their protection zone.
  function targetIcon(kindHex) {
    // Render at 3x for retina + Cesium billboard scaling
    const S = 3, W = 40 * S, H = 40 * S;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.scale(S, S);
    ctx.beginPath();
    ctx.moveTo(20, 4);
    ctx.lineTo(34, 10);
    ctx.lineTo(34, 22);
    ctx.quadraticCurveTo(34, 33, 20, 36);
    ctx.quadraticCurveTo(6, 33, 6, 22);
    ctx.lineTo(6, 10);
    ctx.closePath();
    ctx.fillStyle = kindHex;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(20, 12); ctx.lineTo(20, 28);
    ctx.moveTo(13, 20); ctx.lineTo(27, 20);
    ctx.stroke();
    return c;
  }
  const TARGET_COLORS = {
    royal:        '#a56dff',
    government:   '#4dd2ff',
    military:     '#ff8c3d',
    transport:    '#7fd6ff',
    energy:       '#ffd24d',
    'data-centre': '#5dffd6',
    healthcare:   '#4dff9c',
    broadcasting: '#ff9cf0',
    financial:    '#ffe97a',
    embassy:      '#ffa07a',
    stadium:      '#ff6b9d',
  };
  const TARGET_KIND_LABEL = {
    royal:        'Royal Residence',
    government:   'Government',
    military:     'Military Installation',
    transport:    'Transport Infrastructure',
    energy:       'Energy Infrastructure',
    'data-centre': 'Data Centre',
    healthcare:   'Healthcare',
    broadcasting: 'Broadcasting',
    financial:    'Financial Infrastructure',
    embassy:      'Foreign Embassy',
    stadium:      'Mass Gathering Venue',
  };
  for (const t of TARGETS) {
    const color = TARGET_COLORS[t.kind] || '#4dd2ff';
    viewer.entities.add({
      id: `target-${t.id}`,
      position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, 100),
      billboard: {
        image: targetIcon(color),
        width: 26, height: 26,
        heightReference: Cesium.HeightReference.NONE,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${t.name}  ·  ${t.subtitle}`,
        font: '600 11px "IBM Plex Sans", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { type: 'target', targetId: t.id },
    });
  }

  // ══════════════════════════════════════════
  // DRONE PLAYBACK — spawn on demand, run to completion, auto-close, cleanup
  // Three platform icons: quadcopter (X + rotors), fixed wing (plane silhouette), jet
  // Color = classification (hostile red pulses, friendly green, unknown amber)
  // ══════════════════════════════════════════

  const CLASS_COLORS = { hostile: '#ff3838', unknown: '#ff8c3d', friendly: '#4dff9c' };

  // ── Platform icons (top-down silhouettes, nose points up in canvas y) ──
  function quadcopterIcon(hex) {
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');
    // 4 arms in X
    ctx.strokeStyle = hex;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(12, 12); ctx.lineTo(44, 44);
    ctx.moveTo(44, 12); ctx.lineTo(12, 44);
    ctx.stroke();
    // 4 rotor circles at arm tips
    ctx.fillStyle = hex;
    [[12,12],[44,12],[12,44],[44,44]].forEach(([x,y]) => {
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI*2); ctx.fill();
    });
    // Rotor inner ring (contrast)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    [[12,12],[44,12],[12,44],[44,44]].forEach(([x,y]) => {
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI*2); ctx.stroke();
    });
    // Central body
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(28, 28, 5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = hex;
    ctx.beginPath(); ctx.arc(28, 28, 3.5, 0, Math.PI*2); ctx.fill();
    // Small nose indicator (forward direction)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(28, 20); ctx.lineTo(31, 26); ctx.lineTo(25, 26); ctx.closePath();
    ctx.fill();
    return c;
  }

  function fixedWingIcon(hex) {
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    // Fuselage
    ctx.beginPath();
    ctx.moveTo(28, 6);
    ctx.lineTo(31, 12);
    ctx.lineTo(31, 42);
    ctx.lineTo(28, 48);
    ctx.lineTo(25, 42);
    ctx.lineTo(25, 12);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Main wings (straight, wide)
    ctx.beginPath();
    ctx.moveTo(4, 26);
    ctx.lineTo(52, 26);
    ctx.lineTo(50, 30);
    ctx.lineTo(6, 30);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Tail stabilizer (small, near back)
    ctx.beginPath();
    ctx.moveTo(19, 40);
    ctx.lineTo(37, 40);
    ctx.lineTo(35, 43);
    ctx.lineTo(21, 43);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    return c;
  }

  function jetIcon(hex) {
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    // Sharp nose + fuselage
    ctx.beginPath();
    ctx.moveTo(28, 4);
    ctx.lineTo(32, 18);
    ctx.lineTo(32, 40);
    ctx.lineTo(28, 50);
    ctx.lineTo(24, 40);
    ctx.lineTo(24, 18);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Swept-back main wings (diamond/delta)
    ctx.beginPath();
    ctx.moveTo(28, 20);
    ctx.lineTo(52, 40);
    ctx.lineTo(48, 42);
    ctx.lineTo(28, 32);
    ctx.lineTo(8, 42);
    ctx.lineTo(4, 40);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Small tail fins (swept)
    ctx.beginPath();
    ctx.moveTo(28, 42);
    ctx.lineTo(38, 50);
    ctx.lineTo(36, 51);
    ctx.lineTo(28, 46);
    ctx.lineTo(20, 51);
    ctx.lineTo(18, 50);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    return c;
  }

  function missileIcon(hex) {
    // Aggressive, elongated projectile shape (pointed nose, cylindrical body, fin tail)
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    // Sharp pointed nose + narrow cylindrical body
    ctx.beginPath();
    ctx.moveTo(28, 2);
    ctx.lineTo(32, 12);
    ctx.lineTo(32, 44);
    ctx.lineTo(28, 48);
    ctx.lineTo(24, 44);
    ctx.lineTo(24, 12);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Aft fins (X-shape at rear)
    ctx.beginPath();
    ctx.moveTo(28, 40);
    ctx.lineTo(38, 52);
    ctx.lineTo(35, 54);
    ctx.lineTo(28, 46);
    ctx.lineTo(21, 54);
    ctx.lineTo(18, 52);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Exhaust glow (small dot at back)
    ctx.beginPath();
    ctx.arc(28, 50, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    return c;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Non-identifiable contact symbol
  // ───────────────────────────────────────────────────────────────────
  // Rendered when sensors register a contact but cannot classify the
  // platform (RF signature unmatched, no visual/acoustic confirmation,
  // or single-modality detection with insufficient confidence).
  // NATO-inspired: dashed diamond outline (pending-ID convention) with
  // a bold "?" glyph. Deliberately non-silhouette so it never reads as
  // any of the 4 known platform types (quadcopter/fixed-wing/jet/missile).
  // ═══════════════════════════════════════════════════════════════════
  function nonIdentifiableIcon(hex) {
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');
    // Dashed diamond outline (pending-identification convention)
    ctx.strokeStyle = hex;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 3]);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(28, 4);
    ctx.lineTo(52, 28);
    ctx.lineTo(28, 52);
    ctx.lineTo(4, 28);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // Semi-transparent interior fill for depth
    ctx.fillStyle = hex + '33';
    ctx.fill();
    // Bold "?" glyph centred
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText('?', 28, 30);
    ctx.fillText('?', 28, 30);
    return c;
  }

  // ── Counter-response icons (green-tinted friendly asset symbols) ──
  // Used for the graduated-response render (helicopter intercept,
  // counter-drones, ground C-UAS jammers). Passing GREEN_COUNTER_HEX
  // gives the recognisable "friendly counter-asset" cue on the map.
  // Counter-drones re-use quadcopterIcon / fixedWingIcon with green hex
  // per Lucas's spec — no new symbols needed there.
  const GREEN_COUNTER_HEX = '#4dff9c';

  function helicopterIcon(hex) {
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');

    // Main rotor disc — 4-blade rotor, top-down view
    ctx.strokeStyle = hex;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(4, 22); ctx.lineTo(52, 22);
    ctx.moveTo(22, 4); ctx.lineTo(22, 44);
    ctx.stroke();
    // Rotor hub
    ctx.fillStyle = hex;
    ctx.beginPath(); ctx.arc(22, 22, 4, 0, Math.PI * 2); ctx.fill();

    // Fuselage (offset from rotor centre for clarity)
    ctx.fillStyle = hex;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(22, 22, 6, 10, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Tail boom running down-right
    ctx.beginPath();
    ctx.moveTo(22, 30);
    ctx.lineTo(24, 30);
    ctx.lineTo(46, 46);
    ctx.lineTo(44, 48);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Tail rotor
    ctx.beginPath();
    ctx.arc(46, 46, 4, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = hex;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(42, 46); ctx.lineTo(50, 46);
    ctx.moveTo(46, 42); ctx.lineTo(46, 50);
    ctx.stroke();

    return c;
  }

  function jammerIcon(hex) {
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');

    // Base plate (ground-mounted equipment)
    ctx.fillStyle = hex;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(18, 40, 20, 6);
    ctx.fill(); ctx.stroke();

    // Antenna mast (vertical)
    ctx.strokeStyle = hex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(28, 40); ctx.lineTo(28, 22);
    ctx.stroke();

    // Antenna crossbar (dipole)
    ctx.beginPath();
    ctx.moveTo(22, 22); ctx.lineTo(34, 22);
    ctx.stroke();

    // Radiating jamming waves (arcs emanating from top)
    ctx.strokeStyle = hex;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(28, 22, 8, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(28, 22, 13, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(28, 22, 18, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    return c;
  }

  function policeVehicleIcon(hex) {
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');

    // Vehicle body (top-down)
    ctx.fillStyle = hex;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(16, 12, 24, 34, 3);
    ctx.fill(); ctx.stroke();

    // Windshield (dark)
    ctx.fillStyle = 'rgba(6, 8, 11, 0.55)';
    ctx.beginPath();
    ctx.roundRect(19, 15, 18, 6, 1);
    ctx.fill();
    // Rear window
    ctx.beginPath();
    ctx.roundRect(19, 37, 18, 6, 1);
    ctx.fill();

    // Roof light bar
    ctx.fillStyle = '#4dd2ff';
    ctx.fillRect(20, 25, 7, 3);
    ctx.fillStyle = '#ff5a5a';
    ctx.fillRect(29, 25, 7, 3);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(20, 25, 16, 3);

    // Antenna (jammer) rising from roof (indicates C-UAS capability)
    ctx.strokeStyle = hex;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(28, 12); ctx.lineTo(28, 6);
    ctx.stroke();
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(28, 5, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Wheels
    ctx.fillStyle = 'rgba(6, 8, 11, 0.8)';
    ctx.fillRect(13, 17, 4, 6);
    ctx.fillRect(13, 35, 4, 6);
    ctx.fillRect(39, 17, 4, 6);
    ctx.fillRect(39, 35, 4, 6);

    return c;
  }

  // Counter-drone interceptor icon. Distinct from generic quadcopter:
  // slimmer body, forward-swept arms, subtle "muzzle" indicator to read
  // as kinetic-capable. Green for friendly counter-response.
  function interceptorDroneIcon(hex) {
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');
    // Forward-swept X arms (tips angled toward nose)
    ctx.strokeStyle = hex;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(28, 28); ctx.lineTo(10, 12);
    ctx.moveTo(28, 28); ctx.lineTo(46, 12);
    ctx.moveTo(28, 28); ctx.lineTo(14, 46);
    ctx.moveTo(28, 28); ctx.lineTo(42, 46);
    ctx.stroke();
    // Rotor discs at arm tips
    ctx.fillStyle = hex;
    [[10, 12], [46, 12], [14, 46], [42, 46]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.8;
    [[10, 12], [46, 12], [14, 46], [42, 46]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.stroke();
    });
    // Elongated central body (points forward)
    ctx.fillStyle = hex;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(28, 12);
    ctx.lineTo(33, 22);
    ctx.lineTo(33, 34);
    ctx.lineTo(28, 40);
    ctx.lineTo(23, 34);
    ctx.lineTo(23, 22);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Muzzle indicator (forward, small red dot to read as armed)
    ctx.fillStyle = '#ff5a5a';
    ctx.beginPath(); ctx.arc(28, 11, 1.8, 0, Math.PI * 2); ctx.fill();
    return c;
  }

  function sofIcon(hex) {
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d');
    // Filled triangle base (tactical unit convention)
    ctx.fillStyle = hex;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(28, 6);
    ctx.lineTo(52, 46);
    ctx.lineTo(4, 46);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Inner white star (SOF glyph)
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = hex;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const cx = 28, cy = 32, r = 10;
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 === 0 ? r : r / 2.5;
      const x = cx + rr * Math.cos(angle);
      const y = cy + rr * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    return c;
  }

  // Counter-asset icon by response kind. Green tint for friendly
  // dispatched assets. Reuses existing quad/fixed-wing symbols for
  // counter-drones per Lucas's spec.
  function counterAssetIcon(responseKind) {
    switch (responseKind) {
      case 'helicopter-intercept': return helicopterIcon(GREEN_COUNTER_HEX);
      case 'army-c-uas':
      case 'police-c-uas':         return jammerIcon(GREEN_COUNTER_HEX);
      case 'army-isr-drone':       return quadcopterIcon(GREEN_COUNTER_HEX);
      case 'sof-tactical':         return sofIcon(GREEN_COUNTER_HEX);
      default:                     return null;
    }
  }

  function platformIcon(platform, hex) {
    if (platform === 'fixed-wing') return fixedWingIcon(hex);
    if (platform === 'jet') return jetIcon(hex);
    if (platform === 'missile') return missileIcon(hex);
    if (platform === 'non-identifiable') return nonIdentifiableIcon(hex);
    return quadcopterIcon(hex); // default = quadcopter
  }

  function ringIcon() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.strokeStyle = '#4dd2ff';
    ctx.lineWidth = 3;
    ctx.stroke();
    return c;
  }

  function crossingMarkerIcon(colorHex) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(4, 4, 24, 24);
    ctx.beginPath();
    ctx.arc(16, 16, 2, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.fill();
    return c;
  }

  // ── Drone entity lifecycle ──
  const droneState = new Map(); // eventId -> { billboard, trail, shadow, trailPositions, shadowPositions, entryDropped, entryMarker, exitDropped, exitMarker, wasInside, wasInCoverage, closedAt }
  // Which drone within a swarm event is the "primary" for the detail panel.
  // 0 = lead, 1..N-1 = swarm members. Reset to 0 whenever a different event
  // is selected so we don't carry a stale index into a non-swarm case.
  let _selectedSwarmIndex = 0;

  // ── Cross-cueing helpers ──────────────────────────────────────
  // Extrapolate the track's heading forward and detect which critical infra
  // (targets or sites) fall within a corridor along the projected path.
  const projectedTrajectoryEntities = new Map(); // eventId -> { line, impactRings: [] }
  const PROJECTION_KM = 300;   // long enough to reach Copenhagen from South Jutland
  const CORRIDOR_M = 1500;     // half-width of the "in path" corridor

  // Sample a quadratic Bezier curve between two lat/lon points with a
  // perpendicular midpoint offset. Produces a visible sideways bow — proper
  // trajectory arc rather than a ruler-straight line.
  //
  // Perpendicular rotation of vector (dLat, dLon) by 90° left = (-dLon, dLat).
  // side = +1 for left, -1 for right.
  function sampleBezierArc(lat1, lon1, lat2, lon2, steps = 24, offsetFrac = 0.12, side = 1) {
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;
    const kmPerLat = 111;
    const kmPerLon = 111 * Math.cos((midLat * Math.PI) / 180);
    const dLatKm = (lat2 - lat1) * kmPerLat;
    const dLonKm = (lon2 - lon1) * kmPerLon;
    const lengthKm = Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm) || 1;
    // Perpendicular unit vector (left of travel direction): (-dLon, dLat) normalised
    const perpLatKm =  side * -dLonKm / lengthKm;
    const perpLonKm =  side *  dLatKm / lengthKm;
    const offsetKm = lengthKm * offsetFrac;
    const controlLat = midLat + (perpLatKm * offsetKm) / kmPerLat;
    const controlLon = midLon + (perpLonKm * offsetKm) / kmPerLon;
    const positions = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const oneMinusT = 1 - t;
      const lat = oneMinusT * oneMinusT * lat1 + 2 * oneMinusT * t * controlLat + t * t * lat2;
      const lon = oneMinusT * oneMinusT * lon1 + 2 * oneMinusT * t * controlLon + t * t * lon2;
      positions.push(Cesium.Cartesian3.fromDegrees(lon, lat));
    }
    return positions;
  }

  function bearingOffsetLL(lat, lon, bearingDeg, distanceKm) {
    const R = 6371;
    const b = bearingDeg * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const d = distanceKm / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
    const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
  }

  // Perpendicular distance in meters from point P to great-circle line A→B (flat approx OK for ~100km).
  function pointToLineDistM(pLat, pLon, aLat, aLon, bLat, bLon) {
    const kmPerLatDeg = 111;
    const kmPerLonDeg = 111 * Math.cos((aLat * Math.PI) / 180);
    const ax = 0, ay = 0;
    const bx = (bLon - aLon) * kmPerLonDeg, by = (bLat - aLat) * kmPerLatDeg;
    const px = (pLon - aLon) * kmPerLonDeg, py = (pLat - aLat) * kmPerLatDeg;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.sqrt(px * px + py * py) * 1000;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) * 1000;
  }

  function projectImpacts(p, originSiteId) {
    if (p.speed == null || p.speed <= 0 || p.heading == null) return null;
    const endPt = bearingOffsetLL(p.lat, p.lon, p.heading, PROJECTION_KM);
    const speedKmh = p.speed * 3.6;
    const impacts = [];
    // Candidate assets: all TARGETS + all SITES except origin
    const candidates = [
      ...TARGETS.map(t => ({ id: t.id, name: t.name, kind: 'target', lat: t.lat, lon: t.lon, subtitle: t.subtitle })),
      ...Object.values(SITES)
        .filter(s => s.id !== originSiteId)
        .map(s => ({ id: s.id, name: s.name, kind: 'site', lat: s.coordinates.lat, lon: s.coordinates.lon, subtitle: s.subtitle || s.code })),
    ];
    for (const c of candidates) {
      const perpDist = pointToLineDistM(c.lat, c.lon, p.lat, p.lon, endPt.lat, endPt.lon);
      if (perpDist > CORRIDOR_M) continue;
      // Forward distance from threat to asset (haversine, only accept if actually ahead)
      const forwardKm = haversineM(p.lat, p.lon, c.lat, c.lon) / 1000;
      // Reject if the asset is behind the threat (perp closer to endpoint than start)
      // Approximate by requiring the asset's projection along heading > 0
      const kmPerLatDeg = 111;
      const kmPerLonDeg = 111 * Math.cos((p.lat * Math.PI) / 180);
      const dx = (endPt.lon - p.lon) * kmPerLonDeg;
      const dy = (endPt.lat - p.lat) * kmPerLatDeg;
      const px = (c.lon - p.lon) * kmPerLonDeg;
      const py = (c.lat - p.lat) * kmPerLatDeg;
      const along = (px * dx + py * dy) / Math.sqrt(dx * dx + dy * dy);
      if (along < 0.5) continue; // behind or beside the threat
      const etaMin = Math.round((forwardKm / speedKmh) * 60);
      impacts.push({
        id: c.id, name: c.name, kind: c.kind, subtitle: c.subtitle,
        lat: c.lat, lon: c.lon,
        distanceKm: Math.round(forwardKm * 10) / 10,
        perpM: Math.round(perpDist),
        etaMin,
      });
    }
    // Dedup by normalized name — some assets exist in both TARGETS
    // (e.g. HV substations in targets_hv.js) and SITES (as monitored
    // sites in sites_energinet.js). Keep the closest hit per name.
    const nameKey = (n) => (n || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const bestByName = new Map();
    for (const imp of impacts) {
      const k = nameKey(imp.name);
      if (!k) continue;
      const existing = bestByName.get(k);
      // Prefer 'site' kind over 'target' when both exist (sites carry
      // sensor context; targets are just points). Otherwise closest wins.
      if (!existing
          || (imp.kind === 'site' && existing.kind !== 'site')
          || (imp.kind === existing.kind && imp.distanceKm < existing.distanceKm)) {
        bestByName.set(k, imp);
      }
    }
    const deduped = Array.from(bestByName.values());
    deduped.sort((a, b) => a.etaMin - b.etaMin);
    return {
      from: { lat: p.lat, lon: p.lon },
      to: endPt,
      speedKmh: Math.round(speedKmh),
      impacts: deduped,
    };
  }

  function updateProjectedTrajectoryEntity(event) {
    const pp = event.projectedPath;
    if (!pp) { removeProjectedTrajectoryEntity(event.id); return; }
    if (!overlayState.projections) { removeProjectedTrajectoryEntity(event.id); return; }
    let entities = projectedTrajectoryEntities.get(event.id);
    if (!entities) {
      // Primary heading line — yellow, visibly curved via quadratic Bezier
      // with perpendicular midpoint offset. Extends to the FARTHEST impact
      // target when impacts exist (reaches Copenhagen from South Jutland when
      // Kassø threats project there), otherwise uses the fixed projection
      // distance along heading.
      // Sample the bezier arc with altitude (500m) so the polyline is a
      // real 3D polyline instead of a ground primitive. Ground primitives
      // get culled by Cesium at high camera altitudes (Denmark-wide zoom
      // makes the line vanish); a 3D polyline stays visible at any zoom.
      const sampleWithAlt = (aLat, aLon, bLat, bLon) => {
        const raw = sampleBezierArc(aLat, aLon, bLat, bLon, 40, 0.15, 1);
        return raw.map(p => {
          const c = Cesium.Cartographic.fromCartesian(p);
          return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 500);
        });
      };
      const line = viewer.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const pp2 = event.projectedPath;
            if (!pp2) return [];
            const endPt2 = pp2.impacts && pp2.impacts.length
              ? pp2.impacts[pp2.impacts.length - 1]
              : pp2.to;
            return sampleWithAlt(pp2.from.lat, pp2.from.lon, endPt2.lat, endPt2.lon);
          }, false),
          width: 3,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#ffe600').withAlpha(0.85),
            dashLength: 16,
          }),
          arcType: Cesium.ArcType.GEODESIC,
        },
      });
      entities = { line, impactRings: [], secondaryLines: [] };
      projectedTrajectoryEntities.set(event.id, entities);
    }
    // Rebuild impact rings + secondary target lines each tick
    entities.impactRings.forEach(e => viewer.entities.remove(e));
    entities.secondaryLines.forEach(e => viewer.entities.remove(e));
    entities.impactRings = [];
    entities.secondaryLines = [];

    // Impact color scale: nearest = magenta, further = fade
    const impactColors = ['#ff3d9c', '#c93dff', '#7d3dff'];
    pp.impacts.slice(0, 5).forEach((imp, i) => {
      const color = impactColors[Math.min(i, impactColors.length - 1)];
      // Secondary line from threat → impact target — Bezier arc, alternating
      // side per index so multiple candidate lines fan out visually rather
      // than overlapping. Deflection tighter than primary (5% vs 8%).
      const side = i % 2 === 0 ? 1 : -1;
      const offset = 0.06 + (i * 0.02);  // spread out more per index to reduce line overlap
      entities.secondaryLines.push(viewer.entities.add({
        polyline: {
          positions: sampleBezierArc(pp.from.lat, pp.from.lon, imp.lat, imp.lon, 22, offset, side),
          width: 1.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(color).withAlpha(0.55 - i * 0.08),
            dashLength: 10,
          }),
          clampToGround: true,
        },
      }));
      // Impact ring at target. Only the top-2 (nearest ETA) get a text label
      // to avoid label pile-up when many downstream targets cluster (e.g.
      // Copenhagen infra with 10+ hits). The rest are ring-only on the map;
      // full list still visible in the operator Detail panel Projected Path.
      const showLabel = i < 2;
      const labelOffsetY = 18 + (i * 12);  // stagger just in case
      entities.impactRings.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(imp.lon, imp.lat, 20),
        point: {
          pixelSize: 14,
          color: Cesium.Color.TRANSPARENT,
          outlineColor: Cesium.Color.fromCssColorString(color),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        ...(showLabel ? { label: {
          text: `${imp.name} · ${imp.etaMin}min`,
          font: '10px "IBM Plex Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, labelOffsetY),
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } } : {}),
      }));
    });
  }

  function removeProjectedTrajectoryEntity(eventId) {
    const e = projectedTrajectoryEntities.get(eventId);
    if (!e) return;
    if (e.line) viewer.entities.remove(e.line);
    e.impactRings.forEach(r => viewer.entities.remove(r));
    if (e.secondaryLines) e.secondaryLines.forEach(l => viewer.entities.remove(l));
    projectedTrajectoryEntities.delete(eventId);
  }

  // ── Auto QRA scramble + intercept + NEUTRALIZED terminal outcome ──
  // Doctrine: any missile-class signature auto-scrambles Flyvevåbnet QRA at
  // Skrydstrup the moment classification is confirmed — no operator gate.
  // This mirrors real NATO QRA doctrine where a cruise-missile signature
  // triggers scramble automatically. The demo compresses real flight time
  // (~14 min from Skrydstrup to Copenhagen at Mach 1.5) into demo seconds.
  //
  // Intercept point = a fixed geographic point on the projected trajectory,
  // 2km before the nearest critical Copenhagen infra. Missile is neutralised
  // when it reaches that point (position-based, not timer-based).
  const SKRYDSTRUP = { lat: 55.2210, lon: 9.2640 };

  // ── Session-wide F-35 state ──────────────────────────────────
  // Only one F-35 in the air at any time. Dispatch happens ONCE in the demo
  // (usually at the first missile detection). Same F-35 covers all subsequent
  // missile events until neutralisation.
  // F-35 state. Two modes:
  //   'cruise' — dispatched from Skrydstrup on a fixed NE heading, no target
  //              yet. Just flies forward at cruise speed.
  //   'chase'  — cross cued by Bjæverskov re-acquisition. Now knows exactly
  //              where the missile is; heads directly for it every frame.
  // Position advances per rAF from _f35.curLat/curLon so the icon always
  // matches state. No precomputed flight path, no arrival timing.
  const F35_CRUISE_BEARING_DEG = 68;   // NE, aimed at Bjæverskov corridor
  const F35_CRUISE_SPEED_MS = 750;     // 0.75 km/s (~subsonic cruise x3 compression)
  const F35_CHASE_SPEED_MS = 900;      // 0.90 km/s (~15% faster than cruise missile)
  const _f35 = {
    airborne: false,
    mode: 'cruise',                    // 'cruise' | 'chase'
    dispatchTs: 0,
    dispatchedForEventId: null,
    targetEventId: null,               // set when mode flips to chase
    curLat: 0, curLon: 0,              // live position, updated every frame
    heading: 0,                        // radians, from north
    lastFrameTs: 0,
    rafId: null,
    jetEntity: null,
    trailEntity: null,
    trailPositions: [],
  };

  // Green fighter-jet icon (F-35) rendered as data URI canvas
  function f35Icon() {
    const c = document.createElement('canvas');
    c.width = 40; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4dff9c';
    ctx.strokeStyle = '#06080b';
    ctx.lineWidth = 1;
    // Fuselage nose-up triangle
    ctx.beginPath();
    ctx.moveTo(20, 4);
    ctx.lineTo(24, 16);
    ctx.lineTo(24, 30);
    ctx.lineTo(22, 34);
    ctx.lineTo(18, 34);
    ctx.lineTo(16, 30);
    ctx.lineTo(16, 16);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Wings (delta)
    ctx.beginPath();
    ctx.moveTo(20, 14);
    ctx.lineTo(36, 28);
    ctx.lineTo(24, 24);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(20, 14);
    ctx.lineTo(4, 28);
    ctx.lineTo(16, 24);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Tail
    ctx.beginPath();
    ctx.moveTo(20, 30);
    ctx.lineTo(24, 38);
    ctx.lineTo(16, 38);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    return c.toDataURL();
  }
  const F35_ICON = f35Icon();

  // Friendly air to air interceptor. SAME silhouette as the threat cruise
  // missile — just rendered green so the difference is clean: red = threat,
  // green = friendly, identical form factor so the pairing reads at a glance.
  const FRIENDLY_MISSILE_ICON = missileIcon('#4dff9c').toDataURL();

  // Ring canvas used by the neutralisation burst. Drawn once, scaled per
  // frame via billboard.scale so the geometry itself never changes shape.
  function _burstRingCanvas(colorHex, lineWidth) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.stroke();
    return c;
  }
  const _RING_GREEN = _burstRingCanvas('#4dff9c', 4);
  const _RING_BLUE = _burstRingCanvas('#4dd2ff', 3);

  // Neutralisation burst — pure billboard animation. Two rings scale from
  // small → large over ~1.6 s with alpha fading, plus a bright central flash.
  // No ellipse geometry (which used to throw tessellation errors on rapid
  // callback-driven shape changes). Auto-cleans after the animation window.
  // The lingering flash + label are tagged as 'neutralised' so clicking
  // them selects the parent event (opens the Post-Incident Report).
  function _spawnNeutralisationBurst(lat, lon, eventId) {
    const startTs = Date.now();
    const DURATION_MS = 1600;
    const RING_START_PX = 20;
    const RING_END_PX = 220;

    const ringEntity = (image, delayMs, alphaScale) => viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      billboard: {
        image,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        width: new Cesium.CallbackProperty(() => {
          const t = Math.min(1, Math.max(0, (Date.now() - startTs - delayMs) / DURATION_MS));
          return RING_START_PX + t * (RING_END_PX - RING_START_PX);
        }, false),
        height: new Cesium.CallbackProperty(() => {
          const t = Math.min(1, Math.max(0, (Date.now() - startTs - delayMs) / DURATION_MS));
          return RING_START_PX + t * (RING_END_PX - RING_START_PX);
        }, false),
        color: new Cesium.CallbackProperty(() => {
          const t = Math.min(1, Math.max(0, (Date.now() - startTs - delayMs) / DURATION_MS));
          return Cesium.Color.WHITE.withAlpha(alphaScale * (1 - t));
        }, false),
      },
    });
    const ring1 = ringEntity(_RING_GREEN, 0, 1.0);
    const ring2 = ringEntity(_RING_BLUE, 300, 0.85);

    const flash = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: {
        pixelSize: new Cesium.CallbackProperty(() => {
          const t = Math.min(1, (Date.now() - startTs) / 600);
          const bell = Math.sin(Math.min(1, t) * Math.PI);
          return Math.max(0, 28 * bell);
        }, false),
        color: new Cesium.CallbackProperty(() => {
          const t = Math.min(1, (Date.now() - startTs) / 600);
          return Cesium.Color.fromCssColorString('#eafff4').withAlpha(Math.max(0, 1 - t));
        }, false),
        outlineWidth: 0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `Target Neutralised · ${new Date().toISOString().slice(11,19)}Z`,
        font: '11px "IBM Plex Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString('#4dff9c'),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -34),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.85),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: eventId ? { type: 'neutralised', eventId } : undefined,
    });

    setTimeout(() => {
      viewer.entities.remove(ring1);
      viewer.entities.remove(ring2);
    }, DURATION_MS + 400);
    setTimeout(() => {
      viewer.entities.remove(flash);
    }, 10000);
  }

  // Friendly interceptor state — one per session
  const _friendlyMissile = {
    active: false,
    fromLat: 0, fromLon: 0,       // launch origin
    curLat: 0, curLon: 0,         // current interpolated position (updated per frame)
    heading: 0,                   // current bearing (degrees) for icon rotation
    spawnTs: 0,                   // launch timestamp
    lastFrameTs: 0,               // previous rAF frame time
    targetEventId: null,
    entity: null,
    rafId: null,                  // raf loop handle
    impacted: false,              // set true once within kill radius
  };
  const FRIENDLY_SPEED_MS = 1500;   // ~2x cruise missile → visible chase, not instant kill
  const FRIENDLY_KILL_RADIUS_M = 250;

  // Dispatch F-35 — session-wide, ONE per demo. Second click on any event
  // is a no-op because _f35.airborne is already true.
  //
  // Cruise vector is computed from the missile's INITIAL trajectory at
  // dispatch (position + heading captured at first detection). F-35 aims
  // at a projected point ~180 km down that vector — realistic dead
  // reckoning intercept, using only the initial cross cue. F-35 does NOT
  // know the missile's live position in cruise mode. On downstream sensor
  // re-acquisition, _fireReacquisition flips mode to 'chase' and the jet
  // gets real time coordinates.
  function triggerQraIntercept(eventId) {
    const event = getEvent(eventId);
    if (!event) return;
    event.awaitingNeutralization = true;
    if (_f35.airborne) return;

    // Project the missile forward from the last known point along its
    // heading — this becomes F-35's initial aim point.
    const lastPos = event.lastPosition || {};
    const missileLat = lastPos.lat ?? SKRYDSTRUP.lat;
    const missileLon = lastPos.lon ?? SKRYDSTRUP.lon;
    const missileHdgDeg = lastPos.heading ?? 68;
    const PROJECT_KM = 180;
    const projLat = missileLat + (PROJECT_KM * Math.cos(missileHdgDeg * Math.PI / 180)) / 111;
    const projLon = missileLon + (PROJECT_KM * Math.sin(missileHdgDeg * Math.PI / 180)) /
                                 (111 * Math.cos(missileLat * Math.PI / 180));
    // Bearing from Skrydstrup to that projected point
    const dLat = projLat - SKRYDSTRUP.lat;
    const dLon = projLon - SKRYDSTRUP.lon;
    const cruiseBearing = Math.atan2(dLon, dLat);   // radians, from north

    // Dynamic cruise speed: F-35 always reaches its aim point exactly when
    // Bjæverskov detects (~t=240 from missile spawn). If operator dispatches
    // early, cruise at baseline 750 m/s. If dispatched late, F-35 speeds up
    // (capped at 1500 m/s = supersonic dash) so it makes up the lost time.
    // Widens the practical dispatch window from ~30 s to ~2 min.
    const BJ_DETECT_SEC = 240;
    const aimDistM = haversineM(SKRYDSTRUP.lat, SKRYDSTRUP.lon, projLat, projLon);
    const missileElapsedSec = event.spawnTs ? (Date.now() - event.spawnTs) / 1000 : 0;
    const timeToBjDetect = Math.max(30, BJ_DETECT_SEC - missileElapsedSec);
    const requiredCruiseSpeed = aimDistM / timeToBjDetect;
    _f35.cruiseSpeed = Math.min(1500, Math.max(750, requiredCruiseSpeed));

    _f35.airborne = true;
    _f35.mode = 'cruise';
    _f35.dispatchTs = Date.now();
    _f35.lastFrameTs = Date.now();
    _f35.dispatchedForEventId = eventId;
    _f35.targetEventId = null;
    _f35.cruiseBearing = cruiseBearing;
    _f35.curLat = SKRYDSTRUP.lat;
    _f35.curLon = SKRYDSTRUP.lon;
    _f35.heading = cruiseBearing;
    _f35.trailPositions = [Cesium.Cartesian3.fromDegrees(SKRYDSTRUP.lon, SKRYDSTRUP.lat, 0)];
    _createF35Entities();
    _startF35Loop();
    toast('Fighter dispatched. F-35 airborne from Skrydstrup on projected intercept vector. Chase engages when downstream sensors reacquire.', 'info');
    if (getActiveRole().kind === 'receiver') renderReceiverView();
  }

  // ══════════════════════════════════════════════════════════════════
  // COUNTER-RESPONSE DISPATCH (P87 · Level 3)
  // ══════════════════════════════════════════════════════════════════
  // Multi-instance dispatch of graduated counter-response assets. Unlike
  // the singleton F-35 QRA (session-wide, one-shot), each counter asset
  // dispatched here runs an independent en_route → engaging → complete
  // state machine with its own Cesium billboard, trail, and (for ground
  // jammers) a pulsing radiation cone. Multiple dispatches per event
  // are supported. The first non-visual dispatch that completes marks
  // the event outcome as neutralised.

  const _counterDispatches = new Map();   // dispatchId -> dispatch state
  let _cdRafId = null;

  // Per-kind kinematic + engagement profile. Real doctrine would come
  // from response_assets.js RESPONSE_PROFILE + a doctrine lookup, but
  // demo profiles are tuned for readable pacing (~10 s per engagement).
  const CD_PROFILE = {
    'helicopter-intercept': {
      cruiseKmh: 250, arriveAtM: 500, engageSec: 8,
      icon: 'helicopter', trail: true, airborne: true,
      label: 'Helicopter intercept',
    },
    'army-c-uas': {
      cruiseKmh: 0, arriveAtM: null, engageSec: 12,
      icon: 'jammer', trail: false, airborne: false, radiationCone: true,
      label: 'Army Counter-Drone Jammer',
    },
    'police-c-uas': {
      cruiseKmh: 80, arriveAtM: 500, engageSec: 10,
      icon: 'police-vehicle', trail: false, airborne: false, radiationCone: true,
      useRoadRouting: true,   // ground vehicle → follow real streets via OSRM
      label: 'Police Counter-Drone Patrol',
    },
    'army-isr-drone': {
      cruiseKmh: 60, arriveAtM: 300, engageSec: 6,
      icon: 'quadcopter', trail: true, airborne: true,
      visualVerifyOnly: true,   // does NOT neutralise on its own
      label: 'ISR drone (visual verify)',
    },
    'sof-tactical': {
      cruiseKmh: 200, arriveAtM: 400, engageSec: 15,
      icon: 'sof', trail: true, airborne: true,
      label: 'SOF tactical response',
    },
    'wildlife-response': {
      cruiseKmh: 20, arriveAtM: 200, engageSec: 4,
      icon: 'sof', trail: false, airborne: false,
      label: 'Wildlife management',
    },
    'counter-drone-swarm': {
      cruiseKmh: 120, arriveAtM: 100, engageSec: 4,
      icon: 'counter-drone-interceptor', trail: true, airborne: true,
      swarmSize: 3,             // 3 interceptor drones per dispatch
      swarmSpacingM: 35,        // wider triangle so 3 icons don't overlap
      billboardScale: 0.5,      // smaller icon so pack reads as swarm not one blob
      supportsRTB: true,        // late-dispatch return-to-base behaviour
      firesTracer: true,        // renders small-arms tracer + downed state on engage
      label: 'Interceptor Swarm',
    },
  };

  function _bearingRad(lat1, lon1, lat2, lon2) {
    return Math.atan2(lon2 - lon1, lat2 - lat1);
  }

  function _counterDispatchIcon(iconKind) {
    switch (iconKind) {
      case 'helicopter':               return helicopterIcon(GREEN_COUNTER_HEX);
      case 'jammer':                   return jammerIcon(GREEN_COUNTER_HEX);
      case 'police-vehicle':           return policeVehicleIcon(GREEN_COUNTER_HEX);
      case 'quadcopter':               return quadcopterIcon(GREEN_COUNTER_HEX);
      case 'sof':                      return sofIcon(GREEN_COUNTER_HEX);
      case 'counter-drone-interceptor':return interceptorDroneIcon(GREEN_COUNTER_HEX);
      default:                         return null;
    }
  }

  // Public entry point. Called by the Dispatch button in the Response
  // Overlay assetRow. asset is a response_assets bundle entry with
  // {id, name, kind, lat, lon, etaLabel, distanceKm, ...}. If the
  // profile has swarmSize > 1, spawns that many instances offset in
  // a small formation around the asset origin. All members share a
  // dispatchGroupId so Steps 3+4 can group them in the UI.
  function dispatchCounterResponse(eventId, asset, opts = {}) {
    const event = getEvent(eventId);
    if (!event) return;
    const profile = CD_PROFILE[asset.kind];
    if (!profile) {
      toast(`No dispatch profile for ${asset.kind}`, 'warn');
      return;
    }
    // Dedup: already dispatched this asset for this event?
    for (const [, d] of _counterDispatches) {
      if (d.eventId === eventId && d.assetId === asset.id && d.state !== 'complete') {
        toast(`${asset.name} already dispatched.`, 'info');
        return;
      }
    }
    const threatLat = event.lastPosition?.lat ?? event.entry?.lat;
    const threatLon = event.lastPosition?.lon ?? event.entry?.lon;
    if (threatLat == null || threatLon == null) return;

    const swarmSize = Math.max(1, opts.swarmSize || profile.swarmSize || 1);
    const groupId = `cdg-${eventId}-${asset.id}-${Date.now()}`;
    const variantId = opts.variantId || 'default';

    // Formation offsets — triangle at origin, radius from profile
    // (default 15m for legacy, wider for interceptor swarms so 3
    // small icons read as a distinct pack, not one blob).
    const spacingM = profile.swarmSpacingM || 15;
    const offsets = _swarmFormationOffsets(swarmSize, spacingM);

    for (let i = 0; i < swarmSize; i++) {
      _spawnDispatchInstance(event, asset, profile, {
        groupId, memberIndex: i, memberCount: swarmSize, variantId,
        originOffset: offsets[i],
        threatLat, threatLon,
      });
    }

    const originLabel = profile.cruiseKmh === 0 ? `activated at ${asset.name}` : `dispatched from ${asset.name}`;
    const countStr = swarmSize > 1 ? `${swarmSize} interceptors ` : '';
    toast(`${countStr}${profile.label} ${originLabel}.`, 'info');
    if (getActiveRole().kind === 'receiver') renderReceiverView();
  }

  // Compute small formation offsets (metres NE/SW/etc.) so N swarm
  // members don't stack pixel-perfectly at the origin. Triangle for 3,
  // line for 2, single for 1, hexagon for 6+.
  function _swarmFormationOffsets(n, radius = 15) {
    if (n <= 1) return [{ dNorth: 0, dEast: 0 }];
    const offsets = [];
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n;
      offsets.push({ dNorth: radius * Math.cos(angle), dEast: radius * Math.sin(angle) });
    }
    return offsets;
  }

  // Spawn a single dispatch instance. Called once per member for
  // single-drone dispatches, N times for swarm dispatches.
  function _spawnDispatchInstance(event, asset, profile, memberOpts) {
    const { groupId, memberIndex, memberCount, variantId, originOffset, threatLat, threatLon } = memberOpts;
    const dispatchId = `cd-${event.id}-${asset.id}-${memberIndex}-${Date.now()}`;
    const isStatic = profile.cruiseKmh === 0;

    // Apply origin offset in degrees (rough flat-earth conversion)
    const originLat = asset.lat + (originOffset?.dNorth || 0) / 111000;
    const originLon = asset.lon + (originOffset?.dEast || 0) / (111000 * Math.cos(asset.lat * Math.PI / 180));

    const d = {
      id: dispatchId,
      groupId,
      memberIndex,
      memberCount,
      variantId,
      eventId: event.id,
      assetId: asset.id,
      assetName: memberCount > 1 ? `${asset.name} · Unit ${memberIndex + 1}/${memberCount}` : asset.name,
      groupName: asset.name,
      kind: asset.kind,
      profile,
      state: isStatic ? 'engaging' : 'en_route',
      dispatchedTs: Date.now(),
      lastFrameTs: Date.now(),
      arrivedTs: isStatic ? Date.now() : null,
      engageStartTs: isStatic ? Date.now() : null,
      curLat: originLat, curLon: originLon,
      originLat, originLon,
      targetLat: threatLat, targetLon: threatLon,
      heading: _bearingRad(originLat, originLon, threatLat, threatLon),
      entity: null, trail: null, trailPositions: [], radiationEntity: null,
    };
    _counterDispatches.set(dispatchId, d);
    _createCounterDispatchEntities(d);
    if (isStatic && profile.radiationCone) _createRadiationEntity(d);
    _startCounterDispatchLoop();

    // Async street-network route fetch for ground vehicles
    if (profile.useRoadRouting) {
      fetchDrivingRoute({ lat: originLat, lon: originLon }, { lat: threatLat, lon: threatLon })
        .then(positions => {
          if (!positions || positions.length < 2) return;
          if (!_counterDispatches.has(dispatchId)) return;
          d.routePositions = positions;
          d.routeSegmentLengths = computeSegmentLengths(positions);
          d.routeSegIdx = 0;
          d.routeSegProgress = 0;
          _createRouteVisual(d);
        });
    }

    // Track on event (one record per group member for audit + Step 3 UI)
    if (!Array.isArray(event.counterDispatches)) event.counterDispatches = [];
    event.counterDispatches.push({
      dispatchId, groupId, memberIndex, memberCount, variantId,
      assetId: asset.id, assetName: d.assetName, groupName: asset.name,
      kind: asset.kind, dispatchedTs: d.dispatchedTs,
    });
  }

  // Subtle dashed green polyline showing the OSRM-computed route the
  // vehicle will follow. Ground-clamped, thin, low opacity so it's a
  // hint not a distraction.
  function _createRouteVisual(d) {
    if (!d.routePositions?.length) return;
    d.routeEntity = viewer.entities.add({
      polyline: {
        positions: d.routePositions.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)),
        width: 2.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#4dff9c').withAlpha(0.55),
          dashLength: 12,
        }),
        clampToGround: true,
      },
    });
  }

  function _createCounterDispatchEntities(d) {
    const iconCanvas = _counterDispatchIcon(d.profile.icon);
    if (!iconCanvas) return;
    const iconUrl = iconCanvas.toDataURL();
    d.entity = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => (
        Cesium.Cartesian3.fromDegrees(d.curLon, d.curLat, 0)
      ), false),
      billboard: {
        image: iconUrl,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        // Per-profile scale override (interceptor swarm is 0.5 so 3
        // small icons read as a pack, not one blob). Default 0.85.
        scale: d.profile.billboardScale ?? 0.85,
        // Keep the icon visible at Denmark-wide zoom (up to ~500km eye
        // distance). Without this, the 56x56 canvas is <1px when zoomed
        // out and the operator can't see the dispatch happen.
        scaleByDistance: new Cesium.NearFarScalar(1000, 1.4, 500000, 0.7),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: new Cesium.CallbackProperty(() => {
          const suffix = d.state === 'en_route' ? ' · en route'
                       : d.state === 'engaging' ? ' · engaging'
                       : d.state === 'complete' ? ' · complete'
                       : '';
          return d.assetName + suffix;
        }, false),
        font: '11px system-ui',
        fillColor: Cesium.Color.fromCssColorString('#4dff9c'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -28),
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(8, 11, 16, 0.85)'),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    if (d.profile.trail) {
      d.trail = viewer.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => d.trailPositions, false),
          width: 2,
          material: Cesium.Color.fromCssColorString('#4dff9c').withAlpha(0.55),
          clampToGround: true,
        },
      });
    }
  }

  function _createRadiationEntity(d) {
    // Pulsing green cone/ellipse emanating from the jammer position
    // toward the threat. Animated via CallbackProperty per frame.
    d.radiationEntity = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => (
        Cesium.Cartesian3.fromDegrees(d.curLon, d.curLat, 0)
      ), false),
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => {
          const t = ((Date.now() - d.engageStartTs) / 1500) % 1;
          return 500 + t * 900;
        }, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => {
          const t = ((Date.now() - d.engageStartTs) / 1500) % 1;
          return 500 + t * 900;
        }, false),
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => {
          const t = ((Date.now() - d.engageStartTs) / 1500) % 1;
          return Cesium.Color.fromCssColorString('#4dff9c').withAlpha(0.22 * (1 - t));
        }, false)),
        outline: true,
        outlineColor: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => {
          const t = ((Date.now() - d.engageStartTs) / 1500) % 1;
          return Cesium.Color.fromCssColorString('#4dff9c').withAlpha(0.55 * (1 - t));
        }, false)),
        outlineWidth: 2,
        height: 0,
      },
    });
  }

  function _startCounterDispatchLoop() {
    if (_cdRafId) return;
    const tick = () => {
      const now = Date.now();
      for (const [, d] of _counterDispatches) {
        _tickCounterDispatch(d, now);
      }
      if (_counterDispatches.size > 0) {
        _cdRafId = requestAnimationFrame(tick);
      } else {
        _cdRafId = null;
      }
    };
    _cdRafId = requestAnimationFrame(tick);
  }

  function _tickCounterDispatch(d, now) {
    // Live target update — if threat is still moving, track it
    const event = getEvent(d.eventId);
    if (event?.lastPosition) {
      d.targetLat = event.lastPosition.lat;
      d.targetLon = event.lastPosition.lon;
    }

    if (d.state === 'en_route') {
      const dtSec = (now - d.lastFrameTs) / 1000;
      d.lastFrameTs = now;
      if (dtSec <= 0) return;
      const speedMps = (d.profile.cruiseKmh * 1000) / 3600;
      const stepM = speedMps * dtSec;

      if (d.routePositions && d.routeSegmentLengths) {
        // Follow OSRM street network route
        const step = advanceAlongPolyline(
          d.routePositions, d.routeSegmentLengths,
          d.routeSegIdx, d.routeSegProgress, stepM
        );
        d.curLat = step.lat;
        d.curLon = step.lon;
        d.routeSegIdx = step.segIdx;
        d.routeSegProgress = step.segProgress;
        d.heading = step.headingRad;
        if (step.isEnd) {
          d.state = 'engaging';
          d.arrivedTs = now;
          d.engageStartTs = now;
          if (d.profile.radiationCone) _createRadiationEntity(d);
          if (getActiveRole().kind === 'receiver') renderReceiverView();
          toast(`${d.assetName} on station. Engaging.`, 'info');
        }
      } else {
        // Straight-line fallback (used pre-route-fetch or on OSRM fail)
        const brng = _bearingRad(d.curLat, d.curLon, d.targetLat, d.targetLon);
        d.heading = brng;
        const stepDegLat = (stepM * Math.cos(brng)) / 111000;
        const stepDegLon = (stepM * Math.sin(brng)) / (111000 * Math.cos(d.curLat * Math.PI / 180));
        d.curLat += stepDegLat;
        d.curLon += stepDegLon;
        if (d.profile.trail) {
          d.trailPositions.push(Cesium.Cartesian3.fromDegrees(d.curLon, d.curLat, 0));
          if (d.trailPositions.length > 500) d.trailPositions.shift();
        }
        const distM = haversineM(d.curLat, d.curLon, d.targetLat, d.targetLon);
        if (distM <= d.profile.arriveAtM) {
          d.state = 'engaging';
          d.arrivedTs = now;
          d.engageStartTs = now;
          if (d.profile.radiationCone) _createRadiationEntity(d);
          if (d.profile.firesTracer) _fireTracerEffect(d);
          if (getActiveRole().kind === 'receiver') renderReceiverView();
          toast(`${d.assetName} on station. Engaging.`, 'info');
        }
      }
    } else if (d.state === 'engaging') {
      const engageDur = (now - d.engageStartTs) / 1000;
      // For interceptor swarms, fire additional tracer bursts every ~1.2s
      // during engagement to visually communicate sustained kinetic action
      if (d.profile.firesTracer && !d._nextTracerTs) d._nextTracerTs = d.engageStartTs + 1200;
      if (d.profile.firesTracer && now >= d._nextTracerTs) {
        _fireTracerEffect(d);
        d._nextTracerTs = now + 1200;
      }
      if (engageDur >= d.profile.engageSec) {
        d.state = 'complete';
        _resolveEngagement(d);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE C · Interception visual effects
  // ══════════════════════════════════════════════════════════════════
  // Small-arms tracer + flash at target. Deliberately restrained — no
  // explosion sphere, no missile arc. Green tracer polyline flashes
  // briefly (400ms fade) from interceptor to target coord. Fits the
  // Palantir aesthetic (understated action).
  function _fireTracerEffect(d) {
    const startTs = Date.now();
    const durMs = 450;
    const tracerEntity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => [
          Cesium.Cartesian3.fromDegrees(d.curLon, d.curLat, 8),
          Cesium.Cartesian3.fromDegrees(d.targetLon, d.targetLat, 8),
        ], false),
        width: 2.5,
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => {
          const t = (Date.now() - startTs) / durMs;
          const alpha = Math.max(0, 1 - t);
          return Cesium.Color.fromCssColorString('#4dff9c').withAlpha(alpha);
        }, false)),
        arcType: Cesium.ArcType.NONE,
      },
    });
    // Small flash entity at target position (expanding then fading)
    const flashEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(d.targetLon, d.targetLat, 8),
      point: {
        pixelSize: new Cesium.CallbackProperty(() => {
          const t = (Date.now() - startTs) / durMs;
          return 6 + t * 18;
        }, false),
        color: new Cesium.CallbackProperty(() => {
          const t = (Date.now() - startTs) / durMs;
          const alpha = Math.max(0, 1 - t);
          return Cesium.Color.fromCssColorString('#ffdb4d').withAlpha(alpha * 0.85);
        }, false),
        outlineColor: Cesium.Color.fromCssColorString('#4dff9c'),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    // Retire both entities after fade
    setTimeout(() => {
      if (tracerEntity) viewer.entities.remove(tracerEntity);
      if (flashEntity) viewer.entities.remove(flashEntity);
    }, durMs + 50);
  }

  function _resolveEngagement(d) {
    const event = getEvent(d.eventId);
    if (event && !d.profile.visualVerifyOnly) {
      if (!event.outcome || event.outcome === 'awaiting_neutralization') {
        event.outcome = 'neutralized';
        event.neutralisedByDispatchId = d.id;
        event.neutralisedAt = new Date().toISOString();
        toast(`Threat neutralised. ${d.assetName} confirmed disruption.`, 'ok');
      }
    } else if (d.profile.visualVerifyOnly) {
      toast(`${d.assetName} visual verify complete. Standing by.`, 'info');
    }
    if (getActiveRole().kind === 'receiver') renderReceiverView();

    // Graceful fade-out instead of instant hard remove. Interceptor
    // billboards fade over 1.5s so they don't just pop off the map.
    // Full removal at 5s after fade completes.
    const fadeStartTs = Date.now();
    const fadeDurMs = 1500;
    if (d.entity?.billboard) {
      d.entity.billboard.color = new Cesium.CallbackProperty(() => {
        const t = Math.min(1, (Date.now() - fadeStartTs) / fadeDurMs);
        return Cesium.Color.WHITE.withAlpha(1 - t * 0.9);
      }, false);
    }
    setTimeout(() => {
      if (d.entity) { viewer.entities.remove(d.entity); d.entity = null; }
      if (d.trail) { viewer.entities.remove(d.trail); d.trail = null; }
      if (d.radiationEntity) { viewer.entities.remove(d.radiationEntity); d.radiationEntity = null; }
      if (d.routeEntity) { viewer.entities.remove(d.routeEntity); d.routeEntity = null; }
      _counterDispatches.delete(d.id);
    }, 5000);
  }

  // Lookup: has this asset been dispatched for this event? Returns
  // the dispatch state string or null.
  function counterDispatchStateFor(eventId, assetId) {
    for (const [, d] of _counterDispatches) {
      if (d.eventId === eventId && d.assetId === assetId) return d.state;
    }
    const event = getEvent(eventId);
    if (event?.counterDispatches?.some(cd => cd.assetId === assetId)) return 'complete';
    return null;
  }

  // Post incident responders = the subset of a site's destinations that make
  // sense for ground response AFTER the airborne threat is neutralised.
  //   - Local Politi (tier 2 agency, name starts with "Politi ")
  //   - Beredskabsstyrelsen (national fire and emergency)
  //   - Site internal fire and rescue (tier 1 internal)
  //   - Coast guard for maritime sites (tier 4 agency, Kystvagten)
  //   - Hjemmeværnet regional for critical infrastructure (tier 4 territorial)
  function postIncidentResponders(siteId) {
    if (!siteId) return [];
    const all = destinationsForSite(siteId);
    return all.filter(d => {
      // Local Politi districts. Danish district names vary: "Politi København",
      // "Nordsjællands Politi", "Syd- og Sønderjyllands Politi", etc.
      // Match any tier 2 agency with "Politi" in the name, excluding PET.
      if (d.tier === 2 && d.type === 'agency' && /\bPoliti\b/.test(d.name) && !/PET|Efterretning/.test(d.name)) return true;
      if (/Beredskabsstyrelsen/.test(d.name)) return true;
      if (d.tier === 1 && d.type === 'internal' && /Fire\s+and\s+Rescue/i.test(d.name)) return true;
      if (/Kystvagten/.test(d.name)) return true;
      if (/^Hjemmev[æa]rnet/.test(d.name)) return true;
      return false;
    });
  }

  // Contextual toast messages by responder type. Falls back to a generic line.
  function postIncidentToast(dest) {
    const n = dest.name;
    if (/\bPoliti\b/.test(n) && !/PET|Efterretning/.test(n)) return `${n} dispatched. Ground cordon, evidence recovery, and civilian safety in progress.`;
    if (/Beredskabsstyrelsen/.test(n)) return `${n} dispatched. Hazmat, fire, and casualty response teams en route to impact site.`;
    if (/Fire\s+and\s+Rescue/i.test(n)) return `${n} dispatched. On site fire suppression and rescue teams responding.`;
    if (/Kystvagten/.test(n)) return `${n} dispatched. Maritime debris recovery and shipping lane clearance underway.`;
    if (/^Hjemmev[æa]rnet/.test(n)) return `${n} dispatched. Regional territorial guard reinforcing site perimeter.`;
    return `${n} dispatched.`;
  }

  function dispatchPostIncident(eventId, destId) {
    const event = getEvent(eventId);
    if (!event) return;
    // Gate relaxed for P97 Step 5 flow: post-incident handoff is
    // available once at least one dispatch outcome has been confirmed
    // (event.dispatchOutcomes populated) OR the legacy neutralized
    // pathway triggered. Prevents blocking Step 5 for outcomes like
    // "operator detained" or "link disrupted" that aren't literal
    // neutralisations but still warrant ground handoff.
    const outcomeConfirmed = event.dispatchOutcomes && Object.keys(event.dispatchOutcomes).length > 0;
    if (event.outcome !== 'neutralized' && !outcomeConfirmed) return;
    const dest = getDestination(destId);
    if (!dest) return;
    if (!Array.isArray(event.postIncidentDispatched)) event.postIncidentDispatched = [];
    if (event.postIncidentDispatched.includes(destId)) return;
    event.postIncidentDispatched.push(destId);
    toast(postIncidentToast(dest), 'ok');
  }

  function closePostIncidentEvent(eventId) {
    const event = getEvent(eventId);
    if (!event) return;
    event.outcome = 'closed';
    event.closedAt = new Date().toISOString();
    toast('Event closed. Full incident record archived to history.', 'ok');
    _selectedReceiverEventId = null;
  }

  // Post-Incident Report actions — fired by the detail panel's PIR CTAs.
  // Records dispatch by tag (rather than destination id) since these are
  // higher level command handoffs, not per-agency notifications.
  function dispatchPostIncidentAction(eventId, tag) {
    const event = getEvent(eventId);
    if (!event) return;
    if (event.outcome !== 'neutralized') return;
    if (!Array.isArray(event.postIncidentDispatched)) event.postIncidentDispatched = [];
    if (event.postIncidentDispatched.includes(tag)) return;
    event.postIncidentDispatched.push(tag);
    const msg = tag === 'vera'
      ? 'Full incident package dispatched to Verá command layer. Cross platform handoff acknowledged.'
      : tag === 'cordon'
        ? 'Politi mass dispatch confirmed. Området afspærret. Perimeter cordon deployed around impact zone.'
        : tag === 'beredskab-mass'
          ? 'Beredskabsstyrelsen full deployment inbound. Hazmat, fire, and casualty triage teams en route.'
          : 'Dispatched.';
    toast(msg, 'ok');
    renderDetailPanel();
  }

  // Brief incident report — for non-missile hostile tracks (drones, etc)
  // that overflew a site but did not require kinetic response. Handed to
  // intelligence agencies so they can run their own downstream operations
  // (pattern-of-life analysis, operator attribution, subsequent surveillance).
  function sendBriefToIntelligence(eventId) {
    const event = getEvent(eventId);
    if (!event) return;
    if (!Array.isArray(event.postIncidentDispatched)) event.postIncidentDispatched = [];
    if (event.postIncidentDispatched.includes('intel-brief')) return;
    event.postIncidentDispatched.push('intel-brief');
    toast('Brief incident summary dispatched to PET · FE · Rigspoliti for downstream operations.', 'ok');
    renderDetailPanel();
  }

  function generateBriefReport(eventId) {
    const e = getEvent(eventId);
    if (!e) return;
    const entryTime = e.entry ? e.entry.timestamp.slice(11,19) + 'Z' : '—';
    const exitTime = e.exit ? e.exit.timestamp.slice(11,19) + 'Z' : '—';
    const entryCoord = e.entry ? `${e.entry.lat.toFixed(4)}°N ${e.entry.lon.toFixed(4)}°E` : '—';
    const exitCoord = e.exit ? `${e.exit.lat.toFixed(4)}°N ${e.exit.lon.toFixed(4)}°E` : '—';
    const sensorRows = (e.contributingSensors || []).map(s => `
      <tr><td>${s.id}</td><td>${s.offline ? 'OFFLINE' : 'ONLINE'}</td><td>${s.offline ? '—' : s.confidence.toFixed(2)}</td></tr>`).join('');
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Brief Incident Summary · ${e.id}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; margin: 40px; line-height: 1.5; }
  .hdr { border-bottom: 3px solid #111; padding-bottom: 14px; margin-bottom: 24px; }
  .hdr .brand { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; color: #666; text-transform: uppercase; }
  .hdr h1 { font-size: 20px; margin: 6px 0 4px; letter-spacing: 0.02em; }
  .hdr .sub { font-family: 'Courier New', monospace; font-size: 11px; color: #444; }
  .classification { background: #444; color: #fff; padding: 4px 10px; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.2em; display: inline-block; text-transform: uppercase; margin-top: 8px; }
  h2 { font-size: 11px; font-family: 'Courier New', monospace; letter-spacing: 0.2em; color: #444; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 22px 0 8px; }
  .exec { font-size: 12px; line-height: 1.7; padding: 10px 12px; background: #f5f5f5; border-left: 3px solid #666; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #ddd; }
  th { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.14em; color: #666; text-transform: uppercase; background: #f9f9f9; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-top: 6px; }
  .kv { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dotted #ddd; font-size: 12px; }
  .kv .k { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.14em; color: #666; text-transform: uppercase; padding-top: 2px; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10px; color: #666; font-family: 'Courier New', monospace; text-align: center; letter-spacing: 0.14em; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
  <div class="hdr">
    <div class="brand">ISR SYSTEMS · SITE OVERFLIGHT BRIEF</div>
    <h1>Brief Incident Summary · ${e.id}</h1>
    <div class="sub">Generated ${new Date().toISOString().slice(0,19).replace('T',' ')}Z · For intelligence handoff</div>
    <div class="classification">${(e.threat || 'MEDIUM').toUpperCase()} · ${(e.classification || 'UNKNOWN').toUpperCase()}</div>
  </div>

  <h2>Summary</h2>
  <div class="exec">
    ${e.droneType} entered ${siteName(e.siteId)} perimeter at ${entryTime}
    and departed at ${exitTime}. Total site dwell ${formatDuration(e.duration)}.
    Detection confidence ${e.confidence.toFixed(2)}. No kinetic response asset was
    dispatched. Track terminated on exit from sensor coverage. Handed to
    intelligence agencies for downstream operations (pattern of life analysis,
    operator attribution, subsequent surveillance).
  </div>

  <h2>Track Metadata</h2>
  <div class="grid">
    <div class="kv"><span class="k">Event ID</span><span>${e.id}</span></div>
    <div class="kv"><span class="k">Platform</span><span>${e.platform}</span></div>
    <div class="kv"><span class="k">Type</span><span>${e.droneType}</span></div>
    <div class="kv"><span class="k">Classification</span><span>${(e.classification || '').toUpperCase()}</span></div>
    <div class="kv"><span class="k">Site</span><span>${siteName(e.siteId)}</span></div>
    <div class="kv"><span class="k">Confidence</span><span>${e.confidence.toFixed(2)}</span></div>
  </div>

  <h2>Perimeter Transit</h2>
  <div class="grid">
    <div class="kv"><span class="k">Entry time</span><span>${entryTime}</span></div>
    <div class="kv"><span class="k">Entry point</span><span>${entryCoord}</span></div>
    <div class="kv"><span class="k">Exit time</span><span>${exitTime}</span></div>
    <div class="kv"><span class="k">Exit point</span><span>${exitCoord}</span></div>
    <div class="kv"><span class="k">Site dwell</span><span>${formatDuration(e.duration)}</span></div>
  </div>

  <h2>Contributing Sensors</h2>
  <table>
    <thead><tr><th>Sensor ID</th><th>Status</th><th>Confidence</th></tr></thead>
    <tbody>${sensorRows}</tbody>
  </table>

  <h2>Intelligence Handoff</h2>
  <div class="grid">
    <div class="kv"><span class="k">Delivered to</span><span>PET · FE · Rigspoliti</span></div>
    <div class="kv"><span class="k">Purpose</span><span>Pattern of life · Attribution · Follow on surveillance</span></div>
    <div class="kv"><span class="k">Delivery status</span><span>${(e.postIncidentDispatched || []).includes('intel-brief') ? 'DISPATCHED' : 'PENDING'}</span></div>
  </div>

  <div class="footer">END OF BRIEF · ISR SYSTEMS · CONFIDENTIAL</div>

  <script>window.onload = function() { setTimeout(function() { window.print(); }, 300); };</script>
</body>
</html>`;
    const win = window.open('', '_blank');
    if (!win) { toast('Popup blocked. Enable popups to generate the brief.', 'err'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
    toast('Brief generated. Save as PDF from the print dialog.', 'ok');
  }

  // Print-ready incident report. Opens a new window with formatted HTML
  // and triggers the browser print dialog — operator saves as PDF from
  // there. Zero external dependencies.
  function generatePirReport(eventId) {
    const e = getEvent(eventId);
    if (!e) return;
    const sitesTouched = new Set();
    if (e.siteId) sitesTouched.add(e.siteId);
    if (e._reacquiredSites) e._reacquiredSites.forEach(s => sitesTouched.add(s));
    const siteChain = Array.from(sitesTouched).map(sid => SITES[sid]?.name || sid);
    const lk = e.lastKnownPosition;
    const impact = lk ? `${lk.lat.toFixed(4)}°N ${lk.lon.toFixed(4)}°E` : '—';
    const impactSite = lk ? (SITES[lk.siteId]?.name || lk.siteId) : '—';
    const evasion = e.projectionSnapshot && lk
      ? Math.round(Math.abs(lk.heading - e.projectionSnapshot.heading))
      : 0;
    const escalations = (e.escalations || []).map(esc => `
      <tr>
        <td>${(esc.timestamp || '').slice(11,19)}Z</td>
        <td>${esc.destinationId || esc.destination?.name || '—'}</td>
        <td>${esc.status || '—'}</td>
        <td>${(esc.message || '').replace(/</g, '&lt;').slice(0, 140)}</td>
      </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:#666;">No escalations recorded</td></tr>';
    const sensorRows = (e.contributingSensors || []).map(s => `
      <tr><td>${s.id}</td><td>${s.offline ? 'OFFLINE' : 'ONLINE'}</td><td>${s.offline ? '—' : s.confidence.toFixed(2)}</td></tr>`).join('');
    // Available Danish + regional NATO air defense assets, computed relative
    // to the impact zone. Deliberately factual: Denmark does not operate
    // Patriot, so those are cross border via NATINAMDS. NASAMS is Danish
    // and currently fielding (Kongsberg contract, 2024).
    const impactLat = lk?.lat ?? SKRYDSTRUP.lat;
    const impactLon = lk?.lon ?? SKRYDSTRUP.lon;
    const airDefenseAssets = [
      { name: 'Flyvestation Skrydstrup',           operator: 'Flyvevåbnet',            role: 'F-35 QRA',                   lat: 55.221, lon: 9.264,  status: (e.awaitingNeutralization || e.outcome === 'neutralized') ? 'DISPATCHED' : 'AVAILABLE' },
      { name: 'NASAMS battery (CPH sector)',       operator: 'Flyvevåbnet',            role: 'Medium range SAM',           lat: 55.618, lon: 12.647, status: 'FIELDING · 2025 to 2028' },
      { name: 'NASAMS battery (Aalborg sector)',   operator: 'Flyvevåbnet',            role: 'Medium range SAM',           lat: 57.092, lon: 9.849,  status: 'FIELDING · 2025 to 2028' },
      { name: 'German Patriot (northern Germany)', operator: 'Bundeswehr · NATINAMDS', role: 'Long range SAM',             lat: 54.310, lon: 9.550,  status: 'CUEABLE' },
      { name: 'IRIS T SLM (northern Germany)',     operator: 'Bundeswehr · NATINAMDS', role: 'Medium range SAM',           lat: 54.500, lon: 9.500,  status: 'CUEABLE' },
      { name: 'Nordic Air Policing (Ronneby)',     operator: 'Rotational · NATINAMDS', role: 'Fighter surge (Baltic QRA)', lat: 56.267, lon: 15.267, status: 'AVAILABLE' },
    ];
    const airDefenseRows = airDefenseAssets.map(a => {
      const distKm = Math.round(haversineM(impactLat, impactLon, a.lat, a.lon) / 1000);
      return `<tr><td>${a.name}</td><td>${a.operator}</td><td>${a.role}</td><td style="text-align:right;">${distKm} km</td><td>${a.status}</td></tr>`;
    }).join('');
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Incident Report · ${e.id}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; margin: 40px; line-height: 1.5; }
  .hdr { border-bottom: 3px solid #111; padding-bottom: 14px; margin-bottom: 24px; }
  .hdr .brand { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; color: #666; text-transform: uppercase; }
  .hdr h1 { font-size: 22px; margin: 6px 0 4px; letter-spacing: 0.02em; }
  .hdr .sub { font-family: 'Courier New', monospace; font-size: 11px; color: #444; }
  .classification { background: #111; color: #fff; padding: 4px 10px; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.2em; display: inline-block; text-transform: uppercase; margin-top: 8px; }
  h2 { font-size: 12px; font-family: 'Courier New', monospace; letter-spacing: 0.2em; color: #444; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 28px 0 10px; }
  .exec { font-size: 13px; line-height: 1.7; padding: 12px 14px; background: #f5f5f5; border-left: 3px solid #111; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; }
  th { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.14em; color: #666; text-transform: uppercase; background: #f9f9f9; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; margin-top: 6px; }
  .kv { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #ddd; font-size: 12px; }
  .kv .k { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.14em; color: #666; text-transform: uppercase; padding-top: 2px; }
  .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 10px; color: #666; font-family: 'Courier New', monospace; text-align: center; letter-spacing: 0.14em; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
  <div class="hdr">
    <div class="brand">ISR SYSTEMS · CROSS-SITE INCIDENT AUDIT</div>
    <h1>Post Incident Report · ${e.id}</h1>
    <div class="sub">Generated ${new Date().toISOString().slice(0,19).replace('T',' ')}Z</div>
    <div class="classification">SEVERITY · ${(e.threat || 'HIGH').toUpperCase()} · ${(e.classification || 'HOSTILE').toUpperCase()}</div>
  </div>

  <h2>Executive Summary</h2>
  <div class="exec">
    Cruise missile signature originated south west of Kassø and was detected by
    ${sitesTouched.size} independent sensor sites (${siteChain.join(' → ')}).
    Initial heading captured at Kassø indicated projected impact vector
    diverging from the missile's true course. Evasion course correction of
    ${evasion}° was recorded post Kassø exit and confirmed on re-acquisition.
    Threat was neutralised by ${e.neutralizedBy || 'Flyvevåbnet fighter response'}
    at ${impact} (${impactSite}), well clear of inner Copenhagen. Post-incident
    civil response was dispatched immediately following neutralisation.
  </div>

  <h2>Track Metadata</h2>
  <div class="grid">
    <div class="kv"><span class="k">Event ID</span><span>${e.id}</span></div>
    <div class="kv"><span class="k">Platform</span><span>${e.platform}</span></div>
    <div class="kv"><span class="k">Type</span><span>${e.droneType}</span></div>
    <div class="kv"><span class="k">Classification</span><span>${(e.classification || '').toUpperCase()}</span></div>
    <div class="kv"><span class="k">Threat level</span><span>${(e.threat || '').toUpperCase()}</span></div>
    <div class="kv"><span class="k">Confidence</span><span>${e.confidence.toFixed(2)} · ${e.confidenceTrend || ''}</span></div>
    <div class="kv"><span class="k">First detect</span><span>${e.startTime.slice(11,19)}Z · ${siteName(e.siteId)}</span></div>
    <div class="kv"><span class="k">Duration</span><span>${formatDuration(e.duration)}</span></div>
  </div>

  <h2>Sensor Path (Cross Cueing)</h2>
  <div class="grid">
    <div class="kv"><span class="k">Sites cross cued</span><span>${sitesTouched.size}</span></div>
    <div class="kv"><span class="k">Chain</span><span>${siteChain.join(' → ')}</span></div>
    <div class="kv"><span class="k">Initial site</span><span>${siteName(e.siteId)}</span></div>
    <div class="kv"><span class="k">Last confirmed</span><span>${impactSite}</span></div>
    <div class="kv"><span class="k">Evasion recorded</span><span>${evasion > 8 ? evasion + '° course change post Kassø exit' : 'None'}</span></div>
  </div>

  <h2>Contributing Sensors</h2>
  <table>
    <thead><tr><th>Sensor ID</th><th>Status</th><th>Confidence</th></tr></thead>
    <tbody>${sensorRows}</tbody>
  </table>

  <h2>Escalation Log</h2>
  <table>
    <thead><tr><th>Time</th><th>Destination</th><th>Status</th><th>Message</th></tr></thead>
    <tbody>${escalations}</tbody>
  </table>

  <h2>Response Action</h2>
  <div class="grid">
    <div class="kv"><span class="k">Responder</span><span>${e.neutralizedBy || 'Flyvevåbnet Fighter Response'}</span></div>
    <div class="kv"><span class="k">Weapon</span><span>AIM-120 AMRAAM (air to air)</span></div>
    <div class="kv"><span class="k">Neutralised at</span><span>${e.neutralizedAt ? e.neutralizedAt.slice(11,19) + 'Z' : '—'}</span></div>
    <div class="kv"><span class="k">Impact coordinates</span><span>${impact}</span></div>
    <div class="kv"><span class="k">Impact zone</span><span>${impactSite}</span></div>
    <div class="kv"><span class="k">Outcome</span><span>${(e.outcome || '').toUpperCase()}</span></div>
  </div>

  <h2>Available Air Defense Assets</h2>
  <table>
    <thead><tr><th>Asset</th><th>Operator</th><th>Role</th><th style="text-align:right;">Distance to Impact</th><th>Status</th></tr></thead>
    <tbody>${airDefenseRows}</tbody>
  </table>

  <h2>Post Incident Dispatch</h2>
  <table>
    <thead><tr><th>Handoff</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>Verá command layer</td><td>${(e.postIncidentDispatched || []).includes('vera') ? 'DISPATCHED' : 'PENDING'}</td></tr>
      <tr><td>Politi cordon (afspærring)</td><td>${(e.postIncidentDispatched || []).includes('cordon') ? 'DEPLOYED' : 'PENDING'}</td></tr>
      <tr><td>Beredskabsstyrelsen full deployment</td><td>${(e.postIncidentDispatched || []).includes('beredskab-mass') ? 'INBOUND' : 'PENDING'}</td></tr>
    </tbody>
  </table>

  <div class="footer">END OF REPORT · ISR SYSTEMS · CONFIDENTIAL</div>

  <script>window.onload = function() { setTimeout(function() { window.print(); }, 300); };</script>
</body>
</html>`;
    const win = window.open('', '_blank');
    if (!win) { toast('Popup blocked. Enable popups to generate the PDF report.', 'err'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
    toast('Incident report generated. Save as PDF from the print dialog.', 'ok');
  }

  function _createF35Entities() {
    // Live trail — dashed polyline that grows behind the jet each frame.
    _f35.trailEntity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => _f35.trailPositions, false),
        width: 2.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.85),
          dashLength: 12,
        }),
        clampToGround: true,
      },
    });
    _f35.jetEntity = viewer.entities.add({
      position: new Cesium.CallbackProperty(
        () => Cesium.Cartesian3.fromDegrees(_f35.curLon, _f35.curLat, 0),
        false,
      ),
      label: {
        text: new Cesium.CallbackProperty(() => {
          if (_f35.mode === 'chase') return 'F-35 · Chasing · Cross cued from Bjæverskov';
          return 'F-35 · Cruise Vector NE · Awaiting downstream cross cue';
        }, false),
        font: '10px "IBM Plex Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString('#4dff9c'),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(24, 0),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.8),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      billboard: {
        image: F35_ICON,
        width: 32, height: 32,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        rotation: new Cesium.CallbackProperty(() => -_f35.heading, false),
      },
    });
  }

  // Per frame: advance F-35 position based on mode. cruise = straight NE at
  // cruise speed. chase = read live cruise missile position, head straight
  // for it at chase speed. Heading updated so the icon rotation matches.
  function _startF35Loop() {
    const step = () => {
      if (!_f35.airborne) return;
      const now = Date.now();
      const dt = Math.max(0, (now - _f35.lastFrameTs) / 1000);
      _f35.lastFrameTs = now;

      let bearingRad = _f35.heading;
      // Cruise speed is dynamic (set at dispatch based on missile elapsed
      // time) so late dispatches make up lost time; chase speed constant.
      let speed = _f35.cruiseSpeed || F35_CRUISE_SPEED_MS;

      if (_f35.mode === 'chase' && _f35.targetEventId) {
        const target = getEvent(_f35.targetEventId);
        const tp = target?.lastPosition;
        if (tp) {
          const dLat = tp.lat - _f35.curLat;
          const dLon = tp.lon - _f35.curLon;
          const distM = haversineM(_f35.curLat, _f35.curLon, tp.lat, tp.lon);
          if (distM > 1) {
            bearingRad = Math.atan2(dLon, dLat);
            speed = F35_CHASE_SPEED_MS;
          }
        }
      } else {
        bearingRad = F35_CRUISE_BEARING_DEG * Math.PI / 180;
      }
      _f35.heading = bearingRad;

      // Advance in metres → degrees using flat-earth approximation
      const stepM = speed * dt;
      const stepLatDeg = (stepM * Math.cos(bearingRad)) / 111000;
      const stepLonDeg = (stepM * Math.sin(bearingRad)) / (111000 * Math.cos(_f35.curLat * Math.PI / 180));
      _f35.curLat += stepLatDeg;
      _f35.curLon += stepLonDeg;

      // Append to trail every ~10 frames to keep polyline short
      if (!_f35._trailCounter) _f35._trailCounter = 0;
      _f35._trailCounter++;
      if (_f35._trailCounter % 10 === 0) {
        _f35.trailPositions.push(Cesium.Cartesian3.fromDegrees(_f35.curLon, _f35.curLat, 0));
        if (_f35.trailPositions.length > 400) _f35.trailPositions.shift();
      }

      _f35.rafId = requestAnimationFrame(step);
    };
    _f35.rafId = requestAnimationFrame(step);
  }

  // Re-acquisition: fired when a continuous multi-site track re-enters
  // coverage at a NEW site. Handles auto-escalation to that site's national
  // receivers + camera fly to. The visual ENTRY marker is dropped separately
  // by processPerSiteMarkers to avoid duplicating labels at the same spot.
  const _reacquiredMarkers = new Map();
  function _fireReacquisition(event, siteId) {
    if (event._reacquiredSites && event._reacquiredSites.has(siteId)) return;
    event._reacquiredSites = event._reacquiredSites || new Set();
    event._reacquiredSites.add(siteId);
    const site = SITES[siteId];
    // Auto-escalate to the re-acquiring site's national tier destinations so
    // their receivers' advisory strip upgrades to a full escalation card.
    const autoDests = destinationsForSite(siteId)
      .filter(d => d.type === 'agency' && d.tier >= 2 && d.tier <= 4)
      .map(d => d.id);
    if (autoDests.length) {
      const records = escalateEvent(event.id, {
        destinationIds: autoDests,
        payload: 'summary',
        message: `AUTO — track reacquired at ${site ? site.name : siteId} sensor coverage. Escalating to national tiers.`,
      });
      records.forEach((r, idx) => {
        setTimeout(() => updateEscalationStatus(event.id, r.id, 'delivered'), 800 + idx * 200);
        setTimeout(() => updateEscalationStatus(event.id, r.id, 'read'), 2500 + idx * 300);
      });
      toast(`Auto escalated · reacquired at ${site ? site.name : siteId}`, 'ok');
    }
    // Evasion detection: if the newly captured heading differs materially
    // from the previously snapshotted heading (from an earlier sensor), the
    // missile changed course while off-grid. Toast is deliberately delayed
    // 2.2 s so it lands AFTER the camera fly-to settles and the projection
    // line has visibly jumped — reads as "we just saw this happen" not as
    // a prediction of what's about to change.
    const prevSnap = event.projectionSnapshot;
    const nowHeading = event.lastPosition?.heading;
    if (prevSnap && nowHeading != null) {
      let delta = Math.abs(nowHeading - prevSnap.heading);
      if (delta > 180) delta = 360 - delta;
      if (delta >= 8) {
        setTimeout(() => {
          toast(`EVASION CONFIRMED · course change ${Math.round(delta)}° captured at ${site ? site.name : siteId}. Missile diverged from Kassø projection during sensor gap.`, 'warn');
        }, 6000);
      }
    }
    // Auto-fly camera to the re-acquisition site so the audience sees the
    // action without having to navigate manually.
    if (siteId && FLY_TARGETS[siteId]) {
      setTimeout(() => flyTo(siteId), 400);
    }
    // Cross-cue the F-35: it now has a live track and flips from cruise
    // heading to chase mode on this event. Only fires if the airborne
    // fighter isn't already chasing something.
    if (_f35.airborne && _f35.mode !== 'chase') {
      _f35.mode = 'chase';
      _f35.targetEventId = event.id;
      toast(`F-35 cross cued from ${site ? site.name : siteId}. Chase pattern engaged.`, 'ok');
    }
  }

  function _removeF35Entities() {
    if (_f35.rafId) { cancelAnimationFrame(_f35.rafId); _f35.rafId = null; }
    if (_f35.trailEntity) { viewer.entities.remove(_f35.trailEntity); _f35.trailEntity = null; }
    if (_f35.jetEntity) { viewer.entities.remove(_f35.jetEntity); _f35.jetEntity = null; }
    _f35.trailPositions = [];
    _f35.mode = 'cruise';
    _f35.targetEventId = null;
  }

  // Heat seeking air to air interceptor. Every animation frame:
  //   1. Read the cruise missile's live position (event.lastPosition)
  //   2. Compute bearing from friendly's CURRENT position to target
  //   3. Advance friendly by (FRIENDLY_SPEED_MS * dt) along that bearing
  //   4. When within FRIENDLY_KILL_RADIUS_M, mark impacted (main tick then
  //      finalises the neutralisation animation + event outcome)
  // Position is stored on _friendlyMissile itself; the CallbackProperty just
  // reads it, so target movement is chased in real time instead of a static
  // interpolation between launch point and first seen target.
  function _launchFriendlyMissile(fromLat, fromLon, targetEventId) {
    if (_friendlyMissile.active) return;
    _friendlyMissile.active = true;
    _friendlyMissile.fromLat = fromLat;
    _friendlyMissile.fromLon = fromLon;
    _friendlyMissile.curLat = fromLat;
    _friendlyMissile.curLon = fromLon;
    _friendlyMissile.heading = 0;
    _friendlyMissile.headingInit = false;
    _friendlyMissile.spawnTs = Date.now();
    _friendlyMissile.lastFrameTs = Date.now();
    _friendlyMissile.targetEventId = targetEventId;
    _friendlyMissile.impacted = false;

    const advance = () => {
      if (!_friendlyMissile.active) return;
      const now = Date.now();
      const dt = Math.max(0, (now - _friendlyMissile.lastFrameTs) / 1000);
      _friendlyMissile.lastFrameTs = now;

      const target = getEvent(_friendlyMissile.targetEventId);
      const tp = target?.lastPosition;
      if (tp) {
        const dLat = tp.lat - _friendlyMissile.curLat;
        const dLon = tp.lon - _friendlyMissile.curLon;
        // Great-circle distance to target
        const distM = haversineM(_friendlyMissile.curLat, _friendlyMissile.curLon, tp.lat, tp.lon);
        if (distM > 0) {
          // Bearing for icon rotation (radians, north-referenced), smoothed
          // with wrap-aware exponential lerp so the heat seeker's chase arc
          // resolves over multiple frames (curving path look, not snap).
          const target = Math.atan2(dLon, dLat);
          if (_friendlyMissile.headingInit) {
            let delta = target - _friendlyMissile.heading;
            while (delta > Math.PI) delta -= 2 * Math.PI;
            while (delta < -Math.PI) delta += 2 * Math.PI;
            _friendlyMissile.heading += delta * 0.06;
          } else {
            _friendlyMissile.heading = target;
            _friendlyMissile.headingInit = true;
          }
          // Advance in metres this frame
          const stepM = FRIENDLY_SPEED_MS * dt;
          if (stepM >= distM) {
            _friendlyMissile.curLat = tp.lat;
            _friendlyMissile.curLon = tp.lon;
          } else {
            const frac = stepM / distM;
            _friendlyMissile.curLat += dLat * frac;
            _friendlyMissile.curLon += dLon * frac;
          }
        }
        if (distM <= FRIENDLY_KILL_RADIUS_M && !_friendlyMissile.impacted) {
          _friendlyMissile.impacted = true;
          // Main tick's tryNeutralize sees impacted=true and drops the
          // shockwave + finalises event outcome. No work here.
        }
      }
      _friendlyMissile.rafId = requestAnimationFrame(advance);
    };
    _friendlyMissile.rafId = requestAnimationFrame(advance);

    _friendlyMissile.entity = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        return Cesium.Cartesian3.fromDegrees(
          _friendlyMissile.curLon,
          _friendlyMissile.curLat,
          200,
        );
      }, false),
      billboard: {
        image: FRIENDLY_MISSILE_ICON,
        width: 28, height: 28,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        rotation: new Cesium.CallbackProperty(() => -_friendlyMissile.heading, false),
      },
      label: {
        // NATO brevity call sequence:
        //   0-1.5 s   Fox 3      → active radar missile launched
        //   1.5 s+    Pit Bull   → missile has gone active with its own
        //                          radar seeker, terminal homing mode,
        //                          maximum acceleration/velocity phase
        text: new Cesium.CallbackProperty(() => {
          const elapsed = (Date.now() - _friendlyMissile.spawnTs) / 1000;
          if (elapsed < 1.5) return 'AIM-120 AMRAAM · FOX 3 · Launched';
          return 'AIM-120 AMRAAM · PIT BULL · Active Homing (Terminal)';
        }, false),
        font: '10px "IBM Plex Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString('#4dff9c'),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(18, 0),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.8),
        backgroundPadding: new Cesium.Cartesian2(5, 2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    toast('F-35 called FOX 3 · AIM-120 AMRAAM launched. Missile will go PIT BULL on terminal handoff.', 'ok');
    setTimeout(() => {
      if (_friendlyMissile.active) {
        toast('PIT BULL · AIM-120 active radar homing. Terminal phase, max velocity.', 'warn');
      }
    }, 1500);
  }

  function _removeFriendlyMissile() {
    if (_friendlyMissile.rafId) {
      cancelAnimationFrame(_friendlyMissile.rafId);
      _friendlyMissile.rafId = null;
    }
    if (_friendlyMissile.entity) {
      viewer.entities.remove(_friendlyMissile.entity);
      _friendlyMissile.entity = null;
    }
    _friendlyMissile.active = false;
    _friendlyMissile.impacted = false;
  }

  function tryNeutralize(eventId, p) {
    // Neutralisation sequence:
    //   1. F-35 in 'chase' mode AND cruise missile within engagement range →
    //      launch AIM-120 class heat seeker from F-35's LIVE position.
    //   2. Heat seeker tracks cruise missile every frame, closes at
    //      FRIENDLY_SPEED_MS; sets impacted=true on kill radius.
    //   3. Impact → animated shockwave, F-35 + friendly dissolve, event
    //      marked neutralised.
    if (!_f35.airborne || _f35.mode !== 'chase') return false;
    const event = getEvent(eventId);
    if (!event || event.outcome === 'neutralized') return false;
    if (_f35.targetEventId !== eventId) return false;
    const dist = haversineM(p.lat, p.lon, _f35.curLat, _f35.curLon);
    // 15 km engagement envelope (AIM-120 within-visual-range, demo-scaled).
    const ENGAGEMENT_RANGE_M = 15000;
    if (!_friendlyMissile.active && dist < ENGAGEMENT_RANGE_M) {
      _launchFriendlyMissile(_f35.curLat, _f35.curLon, eventId);
      return false;   // heat seeker takes over from here
    }
    // Heat seeker chases the cruise missile in real time. It sets
    // impacted=true when it enters kill radius; only then do we finalise.
    if (!_friendlyMissile.active || !_friendlyMissile.impacted) return false;

    // ─── Impact: animated shockwave + fading burst ───────
    // Two rings expand outward over 1.6 sec, alpha fades from 1 → 0.
    // A central burst puffs briefly (scale 0 → 1 → 0). No sudden pop.
    _spawnNeutralisationBurst(p.lat, p.lon, eventId);
    // Update event record
    event.outcome = 'neutralized';
    event.neutralizedAt = new Date().toISOString();
    event.neutralizedBy = 'Flyvevåbnet Fighter Response, Skrydstrup';
    event.projectedPath = null;
    event.needsPostIncident = true;   // triggers post incident action panel
    // Dissolve F-35 + friendly missile — mission complete
    _removeF35Entities();
    _removeFriendlyMissile();
    _f35.airborne = false;
    removeProjectedTrajectoryEntity(eventId);
    if (getActiveRole().kind === 'receiver') renderReceiverView();
    return true;
  }

  function removeInterceptEntity(eventId) {
    // Session-wide state — no per-event teardown needed. Kept as a no-op so
    // legacy call sites don't crash.
    // eslint-disable-next-line no-unused-vars
    return eventId;
  }

  // Distance in meters between two lat/lon points (haversine).
  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp/2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  // Find the closest online sensor for the site and whether the point is inside its coverage.
  // Compute intersection point of segment (aLat,aLon → bLat,bLon) with the
  // FIRST polygon edge it crosses. Returns {lat, lon} or null if no crossing.
  // Uses flat-earth approximation — fine at Denmark latitudes over segment
  // lengths < 100 m (per-tick missile hops).
  function _segmentPolygonIntersection(aLat, aLon, bLat, bLon, perim) {
    for (let i = 0; i < perim.length - 1; i++) {
      const [c1lon, c1lat] = perim[i];
      const [c2lon, c2lat] = perim[i + 1];
      const denom = (c2lat - c1lat) * (bLon - aLon) - (c2lon - c1lon) * (bLat - aLat);
      if (Math.abs(denom) < 1e-12) continue;
      const ua = ((c2lon - c1lon) * (aLat - c1lat) - (c2lat - c1lat) * (aLon - c1lon)) / denom;
      const ub = ((bLon - aLon) * (aLat - c1lat) - (bLat - aLat) * (aLon - c1lon)) / denom;
      if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
        return { lat: aLat + ua * (bLat - aLat), lon: aLon + ua * (bLon - aLon) };
      }
    }
    return null;
  }

  // Multi-site ENTRY/EXIT/OOR markers indexed by eventId so we can
  // hide/remove them when the user "exits" the event view. Previously
  // these were fire-and-forget entities that persisted on the map
  // forever after the drone was cleaned up.
  const _perEventMarkers = new Map(); // eventId → Cesium.Entity[]

  function _dropMarker(lat, lon, colorHex, labelText, eventId = null) {
    const ent = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      billboard: {
        image: crossingMarkerIcon(colorHex),
        width: 24, height: 24,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: labelText,
        font: '9px "IBM Plex Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString(colorHex),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(5, 2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { markerEventId: eventId || 'orphan' },
    });
    if (eventId) {
      if (!_perEventMarkers.has(eventId)) _perEventMarkers.set(eventId, []);
      _perEventMarkers.get(eventId).push(ent);
    }
    return ent;
  }

  function _setEventMarkersVisibility(eventId, show) {
    const list = _perEventMarkers.get(eventId);
    if (!list) return;
    const val = !!show; // coerce so undefined → false (was defaulting to visible)
    for (const ent of list) {
      if (ent.billboard) ent.billboard.show = val;
      if (ent.label) ent.label.show = val;
    }
  }

  function _removeEventMarkers(eventId) {
    const list = _perEventMarkers.get(eventId);
    if (!list) return;
    for (const ent of list) {
      try { viewer.entities.remove(ent); } catch (_) {}
    }
    _perEventMarkers.delete(eventId);
  }

  // For multi-site tracks: drop ENTRY / EXIT / OUT OF RANGE markers per
  // site the missile transits. Uses the site's actual perimeter polygon
  // (not sensor coverage circles) so markers land ON the perimeter where
  // the flight path crosses it. Segment-polygon intersection is computed
  // between the previous tick position and the current position, giving
  // pixel-accurate placement even at high update rates.
  function processPerSiteMarkers(state, p, eventId = null) {
    // Persist per-site crossings ONTO the event so we can re-render them
    // on re-select (multi-site events don't populate event.entry/exit/OOR
    // — those are single-site only).
    const _persistCrossing = (kind, lat, lon, color, label) => {
      if (!eventId) return;
      const ev = getEvent(eventId);
      if (!ev) return;
      if (!ev.perSiteCrossings) ev.perSiteCrossings = [];
      ev.perSiteCrossings.push({ kind, lat, lon, color, label, timestamp: new Date().toISOString() });
    };
    // Store previous tick position so we can intersect the segment with
    // each polygon edge.
    const prev = state.lastTickPos || { lat: p.lat, lon: p.lon };
    for (const sid of Object.keys(SITES)) {
      const site = SITES[sid];
      // Prefer sub-area `perimeter` if defined; fall back to outer `siteBoundary`.
      // Esbjerg has siteBoundary (15-vertex outer polygon) but perimeter=[]
      // (sub-areas never filled). Without this fallback Esbjerg never fires
      // entry/exit/OOR markers.
      const perim = site?.perimeter?.length ? site.perimeter
                  : (site?.siteBoundary?.length ? site.siteBoundary : null);
      if (!perim) continue;   // only sites with a footprint polygon get markers
      const nowInside = pointInPolygon(p.lat, p.lon, perim);
      let ps = state.perSite.get(sid);
      const relevant = nowInside || ps;
      if (!relevant) continue;
      if (!ps) {
        ps = { entryDropped: false, exitDropped: false, oorDropped: false, wasInside: false };
        state.perSite.set(sid, ps);
      }
      const now = new Date().toISOString();
      // ENTRY: perimeter crossing INBOUND — segment goes from outside to inside
      if (nowInside && !ps.wasInside && !ps.entryDropped) {
        ps.entryDropped = true;
        const hit = _segmentPolygonIntersection(prev.lat, prev.lon, p.lat, p.lon, perim)
                 || { lat: p.lat, lon: p.lon };
        const lbl = `ENTRY ${now.slice(11,19)}Z · ${site.name || sid}`;
        _dropMarker(hit.lat, hit.lon, '#4dd2ff', lbl, eventId);
        _persistCrossing('entry', hit.lat, hit.lon, '#4dd2ff', lbl);
      }
      // EXIT: perimeter crossing OUTBOUND — inside to outside
      if (!nowInside && ps.wasInside && !ps.exitDropped) {
        ps.exitDropped = true;
        const hit = _segmentPolygonIntersection(prev.lat, prev.lon, p.lat, p.lon, perim)
                 || { lat: p.lat, lon: p.lon };
        const lbl = `EXIT ${now.slice(11,19)}Z · ${site.name || sid}`;
        _dropMarker(hit.lat, hit.lon, '#ffb84d', lbl, eventId);
        _persistCrossing('exit', hit.lat, hit.lon, '#ffb84d', lbl);
      }
      ps.wasInside = nowInside;
      // OUT OF RANGE: track has exited perimeter and no sensor at this
      // site can currently detect it. Uses cov.inCoverage which aggregates
      // EVERY sensor's individual coverageRadius from metadata — if any
      // sensor covers the position, still in range. No hardcoded thresholds.
      if (ps.exitDropped && !ps.oorDropped) {
        const cov = nearestSensorInCoverage(p, site);
        if (cov?.nearest && !cov.inCoverage) {
          ps.oorDropped = true;
          const lbl = `OUT OF RANGE ${now.slice(11,19)}Z · ${site.name || sid} signal lost`;
          _dropMarker(p.lat, p.lon, '#ff5a5a', lbl, eventId);
          _persistCrossing('oor', p.lat, p.lon, '#ff5a5a', lbl);
        }
      }
    }
    state.lastTickPos = { lat: p.lat, lon: p.lon };
  }

  function nearestSensorInCoverage(p, site) {
    if (!site || !site.sensors || !site.sensors.length) return null;
    let nearest = null, minDist = Infinity, inCoverage = false;
    for (const s of site.sensors) {
      if (s.status === 'offline') continue;
      const d = haversineM(p.lat, p.lon, s.lat, s.lon);
      if (d < minDist) { minDist = d; nearest = s; }
      if (d <= s.coverageRadius) inCoverage = true;
    }
    return { nearest, minDist, inCoverage };
  }

  // Global coverage check: is a lat/lon inside ANY site's sensor coverage?
  // Used for per-drone visibility gating in swarm scenarios where each
  // drone is independently checked (not just derived from lead's coverage).
  function _anySensorSeesPoint(lat, lon) {
    for (const sid of Object.keys(SITES)) {
      const site = SITES[sid];
      if (!site?.sensors) continue;
      for (const s of site.sensors) {
        if (s.status === 'offline') continue;
        if (haversineM(lat, lon, s.lat, s.lon) <= s.coverageRadius) return true;
      }
    }
    return false;
  }

  // Per-site coverage check: returns the Set of siteIds where any online
  // sensor of that site currently sees the given point. Used by the
  // per-site event lifecycle handler to determine which sites a threat
  // group is currently touching.
  function _sitesSeeingPoint(lat, lon) {
    const hits = new Set();
    for (const sid of Object.keys(SITES)) {
      const site = SITES[sid];
      if (!site?.sensors) continue;
      for (const s of site.sensors) {
        if (s.status === 'offline') continue;
        if (haversineM(lat, lon, s.lat, s.lon) <= s.coverageRadius) {
          hits.add(sid);
          break;
        }
      }
    }
    return hits;
  }

  // ═══════════════════════════════════════════════════════════════════
  // P68 · Dynamic contributingSensors — real geospatial detection
  // ───────────────────────────────────────────────────────────────────
  // Given a drone position, adds every sensor whose coverage the drone
  // is currently inside to the responsible event's contributingSensors
  // list. Confidence scaled by proximity (closer = higher, capped 0.55-
  // 0.98). Handles multi-site scenarios: iterates ALL sites the point
  // is inside coverage of, and routes each site's sensors to the event
  // responsible for that site — primary event if siteId matches, else
  // the linked/shadow event whose siteId matches (fixes AMK shadow
  // showing zero data because its template.contributingSensors were
  // pinned to CPH sensor IDs and never got updated).
  // ═══════════════════════════════════════════════════════════════════
  function _updateContributingSensorsForPosition(event, lat, lon) {
    try {
      const hitSites = _sitesSeeingPoint(lat, lon);
      for (const sid of hitSites) {
        let targetEvent = event;
        if (event.siteId !== sid) {
          const linkedIds = event.linkedEventIds || [];
          let matched = null;
          for (const lid of linkedIds) {
            const le = getEvent(lid);
            if (le && le.siteId === sid) { matched = le; break; }
          }
          if (!matched) continue;
          targetEvent = matched;
        }
        const siteObj = SITES[sid];
        if (!siteObj?.sensors) continue;
        if (!targetEvent.contributingSensors) targetEvent.contributingSensors = [];
        for (const sensor of siteObj.sensors) {
          if (sensor.status === 'offline') continue;
          const dist = haversineM(lat, lon, sensor.lat, sensor.lon);
          if (dist > sensor.coverageRadius) continue;
          const newConf = Math.min(0.98, Math.max(0.55, 1 - dist / sensor.coverageRadius));
          const existing = targetEvent.contributingSensors.find(s => s.id === sensor.id);
          if (!existing) {
            targetEvent.contributingSensors.push({ id: sensor.id, confidence: +newConf.toFixed(2) });
          } else if (!existing.offline && newConf > (existing.confidence || 0)) {
            existing.confidence = +newConf.toFixed(2);
          }
        }
      }
    } catch (_) { /* silent — never break the tick */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // P21 · Universal per-site event lifecycle
  // ───────────────────────────────────────────────────────────────────
  // For every ACTIVE event, each tick:
  //   1. Compute the set of sites the threat group is currently touching
  //      (any drone inside any online sensor of that site).
  //   2. Diff vs last tick's set to detect ENTRY (new site touched) and
  //      EXIT (previously-touched site no longer touched).
  //   3. On EXIT from event.siteId → close that event, generate summary.
  //      On EXIT from a linked-event's siteId → close that linked event.
  //   4. On ENTRY to a site that has NO active event for this threat →
  //      spawn a fresh event for that site, cross-linked back via the
  //      correlator. Same as the manual secondEvent pattern but data-
  //      driven (works for any scenario, not just swarm_recon_cph_amk).
  //
  // Rules:
  //   - "Threat group" = the primary event's whole track: for a swarm,
  //     that means ALL drones (lead + wingmen). Site "in coverage" if
  //     ANY drone touches it; "out of coverage" only when ALL drones
  //     leave. Matches operational reality of swarm-as-single-target.
  //   - Same-site re-entry (was in → out → in again) reactivates the
  //     existing linked event rather than spawning yet another.
  //   - Single-site events (drone stays inside its site the whole flight)
  //     already close on waypoint completion; this handler is idempotent
  //     for them.
  // ═══════════════════════════════════════════════════════════════════
  function _aggregateGroupSites(dronePositions) {
    const hits = new Set();
    for (const p of dronePositions) {
      if (p?.lat == null || p?.lon == null) continue;
      const s = _sitesSeeingPoint(p.lat, p.lon);
      for (const sid of s) hits.add(sid);
    }
    return hits;
  }

  // Find the event that represents this threat at siteId (either the
  // primary event or one of its linked/shadow events).
  function _findGroupEventForSite(primaryEvent, siteId) {
    if (primaryEvent.siteId === siteId) return primaryEvent;
    for (const lid of (primaryEvent.linkedEventIds || [])) {
      const le = getEvent(lid);
      if (le && le.siteId === siteId) return le;
    }
    return null;
  }

  function _handlePerSiteLifecycle(primaryEvent, state, currentSites) {
    if (!primaryEvent.multiSiteTrack) return; // single-site path already handled elsewhere
    const prev = state._prevSitesInCov || new Set();
    // ENTRIES: sites now in coverage that weren't before
    for (const sid of currentSites) {
      if (prev.has(sid)) continue;
      // Site just came into coverage. Find or spawn event for it.
      const existing = _findGroupEventForSite(primaryEvent, sid);
      if (existing) {
        // Already have an event for this site — mark detected/re-acquired
        if (existing.detected === false) {
          existing.detected = true;
          const siteName_ = SITES[sid]?.name || sid;
          toast(`DETECTED · ${primaryEvent.droneType} within ${siteName_} sensor range.`, 'warn');
          renderAlertStrip();
        }
        if (existing.status === 'closed') {
          // Re-entry after close — reactivate. Rare but supported.
          existing.status = 'active';
          existing.endTime = null;
          addNote(existing.id, `Track re-acquired at ${SITES[sid]?.name || sid}. Event reactivated.`, 'AUTO-CORRELATOR');
        }
      } else {
        // No event yet for this site → spawn one with correlator link
        const spawnedId = _spawnLinkedSiteEvent(primaryEvent, sid);
        if (spawnedId) console.log(`[P21] site entry: spawned ${spawnedId} for ${sid} (from ${primaryEvent.id})`);
      }
    }
    // EXITS: sites in previous set that are no longer in current
    for (const sid of prev) {
      if (currentSites.has(sid)) continue;
      const ev = _findGroupEventForSite(primaryEvent, sid);
      if (ev && ev.status === 'active') {
        // Last drone of the group exited this site → close its event.
        ev.status = 'closed';
        ev.endTime = new Date().toISOString();
        addNote(ev.id, `All tracked drones exited ${SITES[sid]?.name || sid} sensor coverage. Event closed.`, 'AUTO-CORRELATOR');
        renderAlertStrip();
        if (getSelectedEventId() === ev.id) renderDetailPanel();
        console.log(`[P21] site exit: closed ${ev.id} at ${sid}`);
      }
    }
    state._prevSitesInCov = currentSites;
  }

  function _spawnLinkedSiteEvent(primary, siteId) {
    const spawnedId = nextEventId();
    const spawned = {
      id: spawnedId,
      siteId,
      classification: primary.classification,
      threat: primary.threat,
      droneType: primary.droneType,
      platform: primary.platform,
      confidence: primary.confidence,
      confidenceTrend: primary.confidenceTrend,
      status: 'active',
      startTime: new Date().toISOString(),
      endTime: null,
      duration: 0,
      entry: null, exit: null, lastPosition: null,
      // Start EMPTY — dynamic P68 population fills with the actual sensors
      // at THIS site (primary's list was pinned to CPH IDs which meant AMK
      // shadow always displayed CPH sensor rows — completely wrong).
      contributingSensors: [],
      evidence: primary.evidence,
      notes: [{
        timestamp: new Date().toISOString(),
        author: 'System · Site-lifecycle',
        text: `Threat group re-acquired at ${SITES[siteId]?.name || siteId}. Cross-cued from ${primary.id}.`,
      }],
      templateKey: null,
      multiSiteTrack: true,
      detected: true,
      spawnTs: Date.now(),
      linkedEventId: primary.id,
      shadowOfEventId: primary.id,
    };
    addEvent(spawned);
    if (!primary.linkedEventIds) primary.linkedEventIds = [];
    primary.linkedEventIds.push(spawnedId);
    // Correlator validates the link with signature match audit note
    _autoCorrelate(spawned);
    renderAlertStrip();
    return spawnedId;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SYSTEM RULE — Auto-detect
  // ───────────────────────────────────────────────────────────────────
  // Any object whose position falls inside ANY online sensor's coverage
  // is automatically flagged as detected. Applies uniformly across all
  // sites, sensor types, and object platforms. This is the top-level
  // detection contract; downstream logic (identification, classification,
  // threat assessment) sits ABOVE this rule.
  //
  // Detected but unidentifiable → platform = 'non-identifiable' (see
  // nonIdentifiableIcon). The rule guarantees such a contact still gets
  // a billboard, a track, and an evidence recording — even if the
  // sensors cannot resolve what it is.
  //
  // Kept as a thin wrapper today (== _anySensorSeesPoint) so the rule
  // can be extended later (altitude gates, multi-sensor confirmation,
  // modality quorum, drone-vs-bird discriminators) in one place without
  // hunting call sites.
  // ═══════════════════════════════════════════════════════════════════
  function _shouldAutoDetect(lat, lon) {
    return _anySensorSeesPoint(lat, lon);
  }

  // Generate an INDEPENDENT waypoint list for one swarm-member drone from
  // the master template waypoints + formation slot offset + per-waypoint
  // random perturbation. Result is a genuinely per-drone trajectory: the
  // drone follows the formation intent but with real independent noise on
  // position/altitude/timing — same as GPS-guided autopilots in reality.
  function _generatePerDroneWaypoints(masterWaypoints, slot) {
    const M_PER_DEG_LAT = 111320;
    const fwd = slot?.offset?.forward || 0;
    const rgt = slot?.offset?.right || 0;
    const upBase = slot?.offset?.up || 0;
    const isOverwatch = slot?.role === 'overwatch';
    const wps = [];
    for (let i = 0; i < masterWaypoints.length; i++) {
      const mw = masterWaypoints[i];
      const M_PER_DEG_LON = 111320 * Math.cos(mw.lat * Math.PI / 180);
      // Segment heading — use motion vector to next waypoint (or prev if last)
      let hdgRad;
      if (i < masterWaypoints.length - 1) {
        const nw = masterWaypoints[i + 1];
        hdgRad = Math.atan2((nw.lon - mw.lon) * M_PER_DEG_LON, (nw.lat - mw.lat) * M_PER_DEG_LAT);
      } else if (i > 0) {
        const pw = masterWaypoints[i - 1];
        hdgRad = Math.atan2((mw.lon - pw.lon) * M_PER_DEG_LON, (mw.lat - pw.lat) * M_PER_DEG_LAT);
      } else {
        hdgRad = 0;
      }
      const s = Math.sin(hdgRad), c = Math.cos(hdgRad);
      // Formation offset rotated into East/North
      const slotDE = fwd * s + rgt * c;
      const slotDN = fwd * c - rgt * s;
      // Independent random perturbation per waypoint (real autopilot noise)
      const noiseE = (Math.random() - 0.5) * 40;   // ±20 m E-W jitter
      const noiseN = (Math.random() - 0.5) * 40;   // ±20 m N-S jitter
      const noiseAlt = (Math.random() - 0.5) * 10; // ±5 m altitude noise
      const noiseTSec = (Math.random() - 0.5) * 4; // ±2 s timing skew
      // Overwatch-only altitude climb: periodic +40-70m spikes above the
      // base offset so this one drone visibly hangs 50-100% higher than
      // the pack "at times" (Lucas's ask). Pure sine over tSec so it
      // rises + drops smoothly. Other roles get 0m extra so the pack
      // stays tight and the post-debrief doesn't read as chaotic.
      const overwatchExtra = isOverwatch
        ? 40 + 30 * Math.sin(mw.tSec / 22)
        : 0;
      wps.push({
        lat: mw.lat + (slotDN + noiseN) / M_PER_DEG_LAT,
        lon: mw.lon + (slotDE + noiseE) / M_PER_DEG_LON,
        alt: (mw.alt || 100) + upBase + overwatchExtra + noiseAlt,
        heading: mw.heading,
        tSec: mw.tSec + noiseTSec,
      });
    }
    // Ensure monotonic time (sort by tSec) so interpolation is well-defined
    wps.sort((a, b) => a.tSec - b.tSec);
    return wps;
  }

  // Linear interpolation of position along a waypoint list at time t (seconds).
  // Returns { lat, lon, alt } or null if t is past the end.
  function _interpolateWaypoints(wps, t) {
    if (!wps || wps.length === 0) return null;
    if (t <= wps[0].tSec) return { lat: wps[0].lat, lon: wps[0].lon, alt: wps[0].alt };
    const last = wps[wps.length - 1];
    if (t >= last.tSec) return null;
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i + 1];
      if (t >= a.tSec && t < b.tSec) {
        const alpha = (t - a.tSec) / (b.tSec - a.tSec);
        return {
          lat: a.lat + (b.lat - a.lat) * alpha,
          lon: a.lon + (b.lon - a.lon) * alpha,
          alt: a.alt + (b.alt - a.alt) * alpha,
        };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // P5A · Time-series recorder
  // ───────────────────────────────────────────────────────────────────
  // Per-drone hybrid trajectory capture at 2 Hz. Sampled continuously
  // (including sensor gaps for demo replay) with a detection_state tag so
  // Agent B analytics can filter to only-detected rows for production truth.
  // Persisted to localStorage per event ID. Download via console:
  //   window.__isr_downloadRecording(eventId)
  // ═══════════════════════════════════════════════════════════════════
  // Adaptive sampling — interval is decided ONCE per event based on the
  // event's platform (single source of truth, so all drones in a swarm
  // sample at the same rate — no lead-vs-wingmen asymmetry from lead
  // reading p.speed while wingmen compute from position deltas).
  //   missile              → 100 ms (10 Hz)  — cruise missile at Mach 0.8
  //   fixed-wing           → 250 ms (4 Hz)   — reconnaissance / high-speed
  //   quadcopter (default) → 500 ms (2 Hz)   — swarm / loiter
  function _sampleIntervalForEvent(event) {
    const platform = (event?.platform || 'quadcopter').toLowerCase();
    if (platform === 'missile') return 100;
    if (platform === 'fixed-wing' || platform === 'fixed_wing') return 250;
    return 500;
  }
  const _SAMPLE_INTERVAL_MS = 500;   // legacy fallback
  const _P5A_STORAGE_PREFIX = 'isr_trajectory_';
  const _P5A_MAX_STORED_RECORDINGS = 5;   // FIFO eviction cap

  function _computeSensorsDetecting(lat, lon) {
    const result = [];
    for (const sid of Object.keys(SITES)) {
      const site = SITES[sid];
      if (!site?.sensors) continue;
      for (const s of site.sensors) {
        if (s.status === 'offline') continue;
        const d = haversineM(lat, lon, s.lat, s.lon);
        if (d <= s.coverageRadius) {
          result.push({
            sensor_id: s.id,
            site_id: sid,
            confidence: +Math.max(0.5, 1 - d / s.coverageRadius).toFixed(3),
            range_m: Math.round(d),
            modalities: s.modalities || ['RF'],
          });
        }
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════
  // P8 · Detection-similarity correlator
  // ───────────────────────────────────────────────────────────────────
  // When a new event spawns, compare its RF signature, kinematic state,
  // and temporal proximity against active + recently-closed events. If
  // composite similarity >= threshold, auto-link bidirectionally and
  // append an audit note. This is what lets the system distinguish
  // "same threat continuing across sites" (swarm crossing CPH → AMK)
  // from "two different threats simultaneously". Replaces the hardcoded
  // linkage the swarm's manual secondEvent used to establish.
  //
  // If a manual link already exists (secondEvent case), the correlator
  // VALIDATES rather than duplicates ("Correlator confirmed manual link
  // at 92% signature match"). Manual scenario triggers still fire the
  // event; the correlator answers whether the pairing is data-defensible.
  // ═══════════════════════════════════════════════════════════════════
  const _CORRELATION_THRESHOLD = 0.65;
  const _CORRELATION_LOOKBACK_MIN = 15;

  function _rfFamilyOf(text) {
    const t = String(text || '').toLowerCase();
    if (t.includes('ofdm')) return 'ofdm';
    if (t.includes('fhss')) return 'fhss';
    if (t.includes('lora')) return 'lora';
    if (t.includes('ads-b')) return 'adsb';
    if (t.includes('satcom')) return 'satcom';
    if (t.includes('pcl')) return 'pcl';
    return 'unknown';
  }

  function _extractRFSignature(event) {
    const ev = event?.evidence || {};
    const carrier = String(ev.rfCarrier || '');
    const bandwidth = String(ev.rfBandwidth || '');
    const match = String(ev.rfMatch || '');
    // Parse all frequencies (MHz + GHz→MHz conversion)
    const freqs = [];
    const freqRe = /(\d+(?:\.\d+)?)\s*(GHz|MHz)/gi;
    let m;
    while ((m = freqRe.exec(carrier)) !== null) {
      const val = parseFloat(m[1]);
      freqs.push(m[2].toLowerCase() === 'ghz' ? val * 1000 : val);
    }
    return {
      freqs,
      family: _rfFamilyOf(bandwidth || carrier),
      label: match.toLowerCase().replace(/\d+%/g, '').replace(/\s+/g, ' ').trim(),
      isPassive: /passive/i.test(carrier),
    };
  }

  function _scoreRFSimilarity(a, b) {
    // Passive vs active are fundamentally different profiles
    if (a.isPassive !== b.isPassive) return 0;
    if (a.isPassive && b.isPassive) {
      return (a.label && b.label && a.label === b.label) ? 0.7 : 0.3;
    }
    // Frequency: nearest pair distance
    let freqScore = 0;
    if (a.freqs.length && b.freqs.length) {
      let bestGap = Infinity;
      for (const fa of a.freqs) for (const fb of b.freqs) {
        bestGap = Math.min(bestGap, Math.abs(fa - fb));
      }
      if (bestGap <= 5) freqScore = 1.0;
      else if (bestGap <= 20) freqScore = 0.7;
      else if (bestGap <= 100) freqScore = 0.4;
    }
    // Modulation family
    let familyScore = 0;
    if (a.family === 'unknown' || b.family === 'unknown') familyScore = 0.3;
    else if (a.family === b.family) familyScore = 1.0;
    // Signature label (manufacturer/model match)
    let labelScore = 0;
    if (a.label && b.label) {
      if (a.label === b.label) labelScore = 1.0;
      else if (a.label.includes(b.label) || b.label.includes(a.label)) labelScore = 0.7;
      else {
        const wordsA = new Set(a.label.split(/\s+/).filter(w => w.length >= 3));
        const overlap = b.label.split(/\s+/).filter(w => w.length >= 3).filter(w => wordsA.has(w)).length;
        labelScore = overlap > 0 ? Math.min(0.7, overlap * 0.35) : 0;
      }
    }
    return 0.45 * freqScore + 0.25 * familyScore + 0.30 * labelScore;
  }

  function _scoreKinematicContinuity(prior, newEvent, newTemplate) {
    const priorPos = prior.lastPosition || prior.lastKnownPosition || prior.exit;
    if (!priorPos || priorPos.lat == null) return 0;
    // Position-hierarchy fallback for the new event: template waypoint 0
    // is the ideal (real ingress point), then any position already logged
    // on the event, then site centre as a coarse proxy. Manually-spawned
    // events (swarm secondEvent) hit the site-centre branch.
    let newPos = null;
    const wps = newTemplate?.waypoints;
    if (wps && wps.length) {
      newPos = { lat: wps[0].lat, lon: wps[0].lon, heading: wps[0].heading };
    } else if (newEvent.entry?.lat != null) {
      newPos = { lat: newEvent.entry.lat, lon: newEvent.entry.lon, heading: newEvent.entry.heading };
    } else if (newEvent.lastPosition?.lat != null) {
      newPos = { lat: newEvent.lastPosition.lat, lon: newEvent.lastPosition.lon, heading: newEvent.lastPosition.heading };
    } else if (newEvent.siteId && SITES[newEvent.siteId]?.coordinates) {
      const c = SITES[newEvent.siteId].coordinates;
      newPos = { lat: c.lat, lon: c.lon, heading: null };
    }
    if (!newPos) return 0;
    // Distance
    const distKm = haversineM(priorPos.lat, priorPos.lon, newPos.lat, newPos.lon) / 1000;
    let distScore = 0;
    if (distKm <= 5) distScore = 1.0;
    else if (distKm <= 15) distScore = 1 - (distKm - 5) / 10 * 0.5;
    else if (distKm <= 50) distScore = 0.5 - (distKm - 15) / 35 * 0.5;
    // Heading delta — if either side is unknown, treat as neutral 0.7
    // (so a decent distance match isn't fully cancelled by missing heading)
    let hdgScore = 0.7;
    if (priorPos.heading != null && newPos.heading != null) {
      let delta = Math.abs(priorPos.heading - newPos.heading);
      if (delta > 180) delta = 360 - delta;
      if (delta <= 30) hdgScore = 1.0;
      else if (delta <= 90) hdgScore = 1 - (delta - 30) / 60;
      else hdgScore = 0;
    }
    // MULTIPLICATIVE: both distance AND heading must agree for continuity.
    // Same-type threats at different sites → distScore=0 → kinematic=0
    // → correlator refuses to auto-link (see hard gate in _autoCorrelate).
    return distScore * hdgScore;
  }

  function _scoreTemporalProximity(prior, newEvent) {
    const priorEndMs = prior.endTime
      ? new Date(prior.endTime).getTime()
      : (prior.startTime ? new Date(prior.startTime).getTime() : null);
    if (priorEndMs == null) return 0;
    const gapMin = (new Date(newEvent.startTime).getTime() - priorEndMs) / 60000;
    if (gapMin < -1) return 0;
    if (gapMin <= 2) return 1.0;
    if (gapMin <= 5) return 0.8;
    if (gapMin <= 10) return 0.5;
    if (gapMin <= 20) return 0.2;
    return 0;
  }

  function _autoCorrelate(event) {
    // Template optional: manually-spawned events (e.g. swarm secondEvent
    // bypassing spawnFromTemplate) have no templateKey. Kinematic scoring
    // gracefully returns 0 in that case, correlator still runs on RF +
    // temporal signal, and any manual linkage present gets validated.
    const template = TEMPLATES[event.templateKey] || null;
    const sigNew = _extractRFSignature(event);
    const nowMs = new Date(event.startTime).getTime();
    const candidates = EVENTS.filter(e => {
      if (e.id === event.id) return false;
      if (e.status === 'closed') {
        if (!e.endTime) return false;
        return (nowMs - new Date(e.endTime).getTime()) <= _CORRELATION_LOOKBACK_MIN * 60 * 1000;
      }
      return e.status === 'active';
    });
    let best = null;
    for (const prior of candidates) {
      const sigPrior = _extractRFSignature(prior);
      const rf = _scoreRFSimilarity(sigNew, sigPrior);
      const kin = _scoreKinematicContinuity(prior, event, template);
      const tmp = _scoreTemporalProximity(prior, event);
      const composite = 0.50 * rf + 0.30 * kin + 0.20 * tmp;
      if (best == null || composite > best.score) {
        best = { prior, score: composite, rf, kin, tmp };
      }
    }
    if (!best) return null;
    const pctStr = (v) => `${(v * 100).toFixed(0)}%`;
    const alreadyLinked =
      (event.linkedEventIds && event.linkedEventIds.includes(best.prior.id)) ||
      event.linkedEventId === best.prior.id;
    // MANUAL LINK VALIDATION — always record correlator verdict, even if
    // signal is weak (operator sees "manual link with no kinematic support"
    // and can judge). Never overrides operator intent.
    if (alreadyLinked) {
      addNote(event.id,
        `Correlator ${best.score >= _CORRELATION_THRESHOLD ? 'confirmed' : 'weak-signal on'} manual link to ${best.prior.id} (composite ${pctStr(best.score)}: RF ${pctStr(best.rf)}, kinematic ${pctStr(best.kin)}, temporal ${pctStr(best.tmp)}).`,
        'AUTO-CORRELATOR');
      event.correlationScore = +best.score.toFixed(3);
      return best;
    }
    // AUTO-LINK GATE — kinematic continuity is REQUIRED. Two same-type
    // threats at different sites (both DJI M300s, one at CPH one at Kassø)
    // will match on RF alone but must not auto-link — they're two separate
    // pilots, not the same threat continuing. Kinematic >= 0.3 filters this.
    if (best.score < _CORRELATION_THRESHOLD || best.kin < 0.3) return null;
    // Auto-link bidirectionally
    if (!event.linkedEventIds) event.linkedEventIds = [];
    if (!event.linkedEventIds.includes(best.prior.id)) event.linkedEventIds.push(best.prior.id);
    if (!best.prior.linkedEventIds) best.prior.linkedEventIds = [];
    if (!best.prior.linkedEventIds.includes(event.id)) best.prior.linkedEventIds.push(event.id);
    event.correlationScore = +best.score.toFixed(3);
    addNote(event.id,
      `Auto-linked to ${best.prior.id} by signature match (composite ${pctStr(best.score)}: RF ${pctStr(best.rf)}, kinematic ${pctStr(best.kin)}, temporal ${pctStr(best.tmp)}). Same threat continuing across events.`,
      'AUTO-CORRELATOR');
    addNote(best.prior.id,
      `Continuation detected: ${event.id} auto-linked (${pctStr(best.score)} similarity). Threat re-emerged at ${siteName(event.siteId)}.`,
      'AUTO-CORRELATOR');
    return best;
  }

  // ═══════════════════════════════════════════════════════════════════
  // P2 · Mission Console — Agent B narrative generator (mock)
  // ───────────────────────────────────────────────────────────────────
  // Correlates a live event's trajectory against Agent A's site context
  // to produce a plain-English insight: nearest critical asset, dwell
  // heatmap over pre-registered critical zones, triggered pattern flags,
  // and behavioural classification (reconnaissance / continuation /
  // targeting / non-identifiable). This is the mock; post-demo replaces
  // this function with a Mistral call carrying the same inputs on EU
  // sovereign inference (Scaleway / OVH).
  // ═══════════════════════════════════════════════════════════════════
  function _generateAgentBNarrative(event) {
    const siteContext = contextForSite(event.siteId);
    if (!siteContext) return null;
    const recording = window.__isr_getRecording?.(event.id);
    const hasTimeseries = !!(recording?.timeseries?.length);
    // Reference position for nearest-critical-asset query
    const refPos = event.lastPosition || event.lastKnownPosition;
    let nearest = null;
    if (refPos?.lat != null) {
      nearest = nearestCriticalArea(event.siteId, refPos.lat, refPos.lon, 3);
    }
    // Dwell analysis — count DETECTED samples inside each dwell zone
    const dwellCounts = {};
    let detectedSamples = 0;
    if (hasTimeseries) {
      for (const s of recording.timeseries) {
        if (s.detection_state !== 'detected') continue;
        detectedSamples++;
        const hits = dwellZonesAtPoint(event.siteId, s.lat, s.lon);
        for (const h of hits) {
          dwellCounts[h.zone.name] = (dwellCounts[h.zone.name] || 0) + 1;
        }
      }
    }
    const dwellRanked = Object.entries(dwellCounts)
      .map(([name, count]) => ({ name, pct: detectedSamples ? Math.round(count / detectedSamples * 100) : 0 }))
      .filter(d => d.pct > 0)
      .sort((a, b) => b.pct - a.pct);
    // Pattern flags (heuristic — Mistral would produce narrative flags)
    const flags = [];
    if (dwellRanked.length && dwellRanked[0].pct >= 20) {
      flags.push(`Sustained dwell (${dwellRanked[0].pct}%) over ${dwellRanked[0].name}`);
    }
    if (event.linkedEventIds?.length) {
      const scoreStr = event.correlationScore
        ? `${(event.correlationScore * 100).toFixed(0)}% signature match`
        : 'operator-confirmed';
      flags.push(`Cross-linked to ${event.linkedEventIds.length} event(s) · ${scoreStr}`);
    }
    if (event.platform === 'non-identifiable') {
      flags.push('RF signature unmatched against known threat library');
    }
    if (event.platform === 'missile') {
      flags.push('Missile signature — kinetic targeting profile');
    }
    if (event.classification === 'hostile' && event.threat === 'high') {
      flags.push('High-threat classification confirmed by sensor fusion');
    }
    // Behavioural pattern classification
    let pattern, confidence;
    if (event.platform === 'missile') {
      pattern = 'Targeting profile. Direct trajectory toward high-value asset. Kinetic engagement authorised per doctrine.';
      confidence = 'HIGH';
    } else if (event.linkedEventIds?.length && (event.correlationScore || 0) >= 0.75) {
      pattern = 'Continuation surveillance. Same threat re-emerged at this site after prior detection. Signature and kinematic continuity consistent with peer-competitor / state-actor reconnaissance doctrine.';
      confidence = 'HIGH';
    } else if (dwellRanked.length >= 2) {
      pattern = 'Reconnaissance profile. Multiple critical zones observed within single loiter. Behaviour consistent with intelligence-gathering rather than opportunistic overflight.';
      confidence = 'MEDIUM';
    } else if (event.platform === 'non-identifiable') {
      pattern = 'Unclear pattern. Contact registered but platform not identified. Analyst review required before intent assessment.';
      confidence = 'LOW';
    } else if (dwellRanked.length === 1 && dwellRanked[0].pct >= 40) {
      pattern = `Focused observation of ${dwellRanked[0].name}. Behaviour consistent with pre-planned reconnaissance of a specific asset.`;
      confidence = 'MEDIUM';
    } else if (nearest) {
      pattern = `Track passing within ${nearest.dist.toFixed(2)} km of ${nearest.area.name}. Insufficient trajectory data for behavioural classification.`;
      confidence = 'LOW';
    } else {
      pattern = 'Insufficient data for behavioural classification.';
      confidence = 'LOW';
    }
    return { siteContext, nearest, dwellRanked, flags, pattern, confidence, hasTimeseries, detectedSamples };
  }

  function _buildDroneSample({ event, droneId, droneIdx, model, role, pos, hdgDeg, speedMs, conf, rfMHz, inCov, tipInCov, tSec }) {
    const sensors = _computeSensorsDetecting(pos.lat, pos.lon);
    const detState = inCov ? 'detected' : (tipInCov ? 'tip_cued' : (tSec < 5 ? 'pre_ingress' : 'sensor_gap'));
    return {
      droneId,
      timestamp_utc: new Date().toISOString(),
      t_sec_from_event: +tSec.toFixed(2),
      lat: +pos.lat.toFixed(6),
      lon: +pos.lon.toFixed(6),
      altitude_agl_m: +pos.alt.toFixed(1),
      altitude_msl_m: +pos.alt.toFixed(1),
      speed_ms: +speedMs.toFixed(2),
      heading_deg: +hdgDeg.toFixed(1),
      climb_rate_ms: 0,
      classification: event.classification,
      confidence: +(conf || event.confidence).toFixed(3),
      threat_level: event.threat,
      rf_carrier_mhz: rfMHz,
      rf_power_dbm: -68 + (droneIdx * -2),
      rf_carrier_type: rfMHz > 5000 ? 'OFDM 5.8 GHz' : 'OFDM 2.4 GHz',
      rf_bandwidth_mhz: 20,
      rf_match_signature: 'DJI OcuSync',
      rf_match_confidence: 0.89,
      acoustic_peak_db: +(58 + (droneIdx * 1.2)).toFixed(1),
      acoustic_dominant_hz: 220,
      acoustic_signature: 'quadcopter-brushless',
      visual_match_model: model,
      visual_match_confidence: 0.85,
      sensors_detecting: sensors,
      drone_model: model,
      formation_role: role,
      event_id: event.id,
      site_id: event.siteId,
      detection_state: detState,
    };
  }

  function _initRecording(event, state, template) {
    const drones = [{ id: 'DJI-1', model: template.swarm.formation[0]?.model || 'DJI Matrice 300 RTK', role: 'lead' }];
    template.swarm.formation.slice(1).forEach((slot, idx) => {
      drones.push({ id: `DJI-${idx + 2}`, model: slot.model || 'DJI Matrice 300', role: slot.role });
    });
    state.recording = {
      meta: {
        event_id: event.id,
        event_type: template.swarm ? 'swarm' : (event.platform || 'single'),
        template_key: event.templateKey,
        classification: event.classification,
        threat_level: event.threat,
        drone_type: event.droneType,
        primary_site_id: event.siteId,
        linked_events: [],
        started_at_utc: event.startTime,
        ended_at_utc: null,
        duration_sec: null,
        drones_count: drones.length,
        drones,
        recorder_version: '1.0',
        sample_interval_ms: _SAMPLE_INTERVAL_MS,
      },
      timeseries: [],
    };
  }

  // P55: init recording for non-swarm events (fixed-wing, jet, missile).
  // Additive path parallel to _initRecording. NEVER call this on swarm
  // events — they use _initRecording. The two paths write to the same
  // state.recording structure so _persistRecording, replay, and debrief
  // all work identically for both.
  function _initSingleDroneRecording(event, state, template) {
    const platform = (event.platform || 'quadcopter').toLowerCase();
    // Sensible model names per platform. Not authoritative — just a label
    // for the recording meta. Real hardware model lookup is post-demo work.
    const modelByPlatform = {
      'quadcopter': 'DJI Matrice 300 RTK',
      'fixed-wing': 'Fixed-wing UAS',
      'fixed_wing': 'Fixed-wing UAS',
      'jet': 'Jet platform',
      'missile': 'Cruise/ballistic missile',
      'non-identifiable': 'Non-identified platform',
    };
    const drones = [{
      id: platform === 'missile' ? 'MSL-1' : 'UAS-1',
      model: modelByPlatform[platform] || (event.droneType || 'Unknown platform'),
      role: 'lead',
    }];
    state.recording = {
      meta: {
        event_id: event.id,
        event_type: platform,
        template_key: event.templateKey,
        classification: event.classification,
        threat_level: event.threat,
        drone_type: event.droneType,
        primary_site_id: event.siteId,
        linked_events: [],
        started_at_utc: event.startTime,
        ended_at_utc: null,
        duration_sec: null,
        drones_count: drones.length,
        drones,
        recorder_version: '1.0',
        sample_interval_ms: _SAMPLE_INTERVAL_MS,
      },
      timeseries: [],
    };
  }

  function _persistRecording(eventId) {
    const st = droneState.get(eventId);
    if (!st?.recording) return;
    try {
      localStorage.setItem(_P5A_STORAGE_PREFIX + eventId, JSON.stringify(st.recording));
      _evictOldestRecordings();
    } catch (err) {
      // localStorage may throw QuotaExceededError — try eviction and retry once
      console.warn('[P5A] localStorage write failed, evicting + retry', err);
      _evictOldestRecordings(true);
      try {
        localStorage.setItem(_P5A_STORAGE_PREFIX + eventId, JSON.stringify(st.recording));
      } catch (err2) { console.warn('[P5A] retry also failed', err2); }
    }
  }

  // FIFO retention: keep only the most-recent N recordings. Event IDs are
  // timestamp-prefixed so sorting alphabetically gives chronological order.
  function _evictOldestRecordings(aggressive = false) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(_P5A_STORAGE_PREFIX)) keys.push(k);
    }
    keys.sort();   // oldest first (timestamp-prefixed IDs)
    const cap = aggressive ? Math.max(1, _P5A_MAX_STORED_RECORDINGS - 2) : _P5A_MAX_STORED_RECORDINGS;
    while (keys.length > cap) {
      const oldest = keys.shift();
      localStorage.removeItem(oldest);
      console.log(`[P5A] evicted oldest recording: ${oldest}`);
    }
  }

  window.__isr_getRecording = (eventId) => {
    const st = droneState.get(eventId);
    if (st?.recording) return st.recording;
    try {
      const raw = localStorage.getItem(_P5A_STORAGE_PREFIX + eventId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  window.__isr_downloadRecording = (eventId) => {
    const rec = window.__isr_getRecording(eventId);
    if (!rec) { console.warn('[P5A] no recording for', eventId); return; }
    const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `isr_trajectory_${eventId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  // P5C: CSV export for analyst tooling (Excel, Python, R). Flattens the
  // per-drone timeseries into rows. sensors_detecting is pipe-encoded per
  // sensor as "SENSOR_ID:CONFIDENCE:RANGE_M" so external tools can split
  // the field. Meta rows omitted (they'd break the tabular contract).
  window.__isr_downloadRecordingCSV = (eventId) => {
    const rec = window.__isr_getRecording(eventId);
    if (!rec || !rec.timeseries?.length) { console.warn('[P5C] no recording for', eventId); return; }
    const cols = [
      'droneId', 'timestamp_utc', 't_sec_from_event',
      'lat', 'lon', 'altitude_agl_m', 'altitude_msl_m',
      'speed_ms', 'heading_deg', 'climb_rate_ms',
      'classification', 'confidence', 'threat_level',
      'rf_carrier_mhz', 'rf_power_dbm', 'rf_carrier_type', 'rf_bandwidth_mhz',
      'rf_match_signature', 'rf_match_confidence',
      'acoustic_peak_db', 'acoustic_dominant_hz', 'acoustic_signature',
      'visual_match_model', 'visual_match_confidence',
      'drone_model', 'formation_role',
      'event_id', 'site_id', 'detection_state', 'sensors_detecting',
    ];
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v);
      // RFC 4180: wrap fields containing comma, quote, or newline
      if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows = [cols.join(',')];
    for (const s of rec.timeseries) {
      const sensorsStr = Array.isArray(s.sensors_detecting)
        ? s.sensors_detecting.map(x => `${x.sensor_id}:${x.confidence}:${x.range_m}`).join('|')
        : '';
      rows.push(cols.map(c => escape(c === 'sensors_detecting' ? sensorsStr : s[c])).join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `isr_trajectory_${eventId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  window.__isr_listRecordings = () => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(_P5A_STORAGE_PREFIX)) keys.push(k.slice(_P5A_STORAGE_PREFIX.length));
    }
    return keys;
  };

  // ═══════════════════════════════════════════════════════════════════
  // P23 · Map-based debrief mode
  // ───────────────────────────────────────────────────────────────────
  // Post-detection analysis view for CLOSED events. Extends the closed
  // Palantir panel with a "Debrief on map" CTA. When triggered:
  //   1. Camera flies to the event's site.
  //   2. Every critical_area / high_value_asset the drone came within
  //      500 m of gets highlighted with a glow ring + label.
  //   3. Trajectory redrawn as a polyline with time-labeled markers at
  //      key moments (entry, peak dwell, closest approach, exit).
  //   4. Floating narrative panel appears with a plain-English story
  //      derived from Agent A context + trajectory analysis.
  //   5. "Exit debrief" removes all annotations and restores map state.
  //
  // Designed for a non-technical viewer: no telemetry dumps, just the
  // story. Uses the recording timeseries when available, falls back to
  // template waypoints for events without a recording.
  // ═══════════════════════════════════════════════════════════════════
  let _debriefState = null;   // { eventId, entities: [], narrativeEl, ... }

  // Build a synthetic "terminal" sample from event.outOfRange (preferred)
  // or event.exit so the debrief line ALWAYS reaches the saved exit
  // coordinates, not wherever the recording's last periodic sample
  // happened to land (which could be 100-500ms before the actual exit).
  function _synthTerminalSample(event, lastSample) {
    const term = event.outOfRange || event.exit;
    if (!term?.lat || !term?.lon) return null;
    const base = lastSample || {};
    const lastTs = base.timestamp_utc ? new Date(base.timestamp_utc).getTime() : new Date(event.startTime).getTime();
    const termTs = term.timestamp ? new Date(term.timestamp).getTime() : lastTs + 100;
    return {
      ...base,
      timestamp_utc: term.timestamp || new Date(termTs).toISOString(),
      t_sec_from_event: base.t_sec_from_event != null
        ? base.t_sec_from_event + Math.max(0.1, (termTs - lastTs) / 1000)
        : 0,
      lat: +term.lat.toFixed(6),
      lon: +term.lon.toFixed(6),
      altitude_agl_m: +(term.alt || base.altitude_agl_m || 100).toFixed(1),
      altitude_msl_m: +(term.alt || base.altitude_msl_m || 100).toFixed(1),
      confidence: base.confidence || event.confidence || 0.7,
      detection_state: 'sensor_gap',
      droneId: base.droneId || 'terminal',
    };
  }
  function _appendTerminalIfMissing(event, samples) {
    if (!samples?.length) return samples;
    const term = event.outOfRange || event.exit;
    if (!term?.lat || !term?.lon) return samples;
    const last = samples[samples.length - 1];
    const distDeg = Math.hypot(last.lat - term.lat, last.lon - term.lon);
    // ~0.00003° ≈ 3m — only append if the terminal coord is meaningfully
    // beyond the last recorded sample.
    if (distDeg < 0.00003) return samples;
    const synth = _synthTerminalSample(event, last);
    return synth ? [...samples, synth] : samples;
  }

  function _debriefResolveSamples(event) {
    // Prefer this event's own recording; fall back to primary's recording
    // filtered to this event's time window; last resort: template waypoints.
    const own = window.__isr_getRecording?.(event.id);
    if (own?.timeseries?.length) {
      return { source: 'recording', samples: _appendTerminalIfMissing(event, own.timeseries) };
    }
    const primaryId = event.linkedEventId || event.shadowOfEventId;
    if (primaryId) {
      const primary = window.__isr_getRecording?.(primaryId);
      if (primary?.timeseries?.length) {
        // Filter to this event's active window
        const startMs = new Date(event.startTime).getTime();
        const endMs = event.endTime ? new Date(event.endTime).getTime() : Date.now();
        const filtered = primary.timeseries.filter(s => {
          const t = new Date(s.timestamp_utc).getTime();
          return t >= startMs && t <= endMs;
        });
        if (filtered.length) return { source: 'linked_recording', samples: _appendTerminalIfMissing(event, filtered) };
      }
    }
    const template = TEMPLATES[event.templateKey];
    if (template?.waypoints?.length) {
      // Synthesize sample-shaped rows from waypoints so downstream logic
      // (position, confidence-band colouring) has a uniform interface.
      const wps = template.waypoints.map(w => ({
        lat: w.lat, lon: w.lon, altitude_agl_m: w.alt || 100,
        heading_deg: w.heading || 0, confidence: event.confidence || 0.7,
        t_sec_from_event: w.tSec,
        timestamp_utc: new Date(new Date(event.startTime).getTime() + w.tSec * 1000).toISOString(),
        droneId: 'derived-waypoint',
      }));
      return { source: 'waypoints', samples: wps };
    }
    return null;
  }

  // Per-asset-type dwell radius. Buildings tight, aprons wider, aircraft
  // narrow. Applied when deriving dwell zones from real asset coordinates
  // so we correlate against actual site geography, not a separate list.
  const _DWELL_RADIUS_BY_TYPE = {
    // critical_areas
    area: 300, terminal: 250, pier: 220, runway: 300, apron: 350, cargo: 220,
    // high_value_assets
    atc_control_tower: 150, ils_ground_installation: 200, nav_broadcast: 150,
    maintenance_facility: 180, fuel_storage: 250, fuel_infrastructure: 200,
    ground_power: 150, emergency_response: 200,
    vip_state_terminal: 200, restricted_facility: 180,
    // response
    cuas_staging: 200, cuas_fixed: 150, overwatch: 150, qra_relay: 150,
    // aircraft (very tight — the stand itself)
    aircraft: 100,
    default: 220,
  };
  function _radiusForAsset(a) {
    if (a.cat === 'aircraft') return _DWELL_RADIUS_BY_TYPE.aircraft;
    if (a.asset_type && _DWELL_RADIUS_BY_TYPE[a.asset_type] != null) return _DWELL_RADIUS_BY_TYPE[a.asset_type];
    if (a.cat === 'area') {
      const id = (a.id || '').toLowerCase();
      if (id.includes('runway') || id.includes('apron')) return _DWELL_RADIUS_BY_TYPE.apron;
      if (id.includes('pier')) return _DWELL_RADIUS_BY_TYPE.pier;
      if (id.includes('terminal')) return _DWELL_RADIUS_BY_TYPE.terminal;
      if (id.includes('cargo')) return _DWELL_RADIUS_BY_TYPE.cargo;
    }
    return _DWELL_RADIUS_BY_TYPE.default;
  }

  function _debriefAnalyzeAssets(event, samples) {
    const ctx = contextForSite(event.siteId);
    if (!ctx) return { touched: [], dwellZones: [] };
    // Unified asset list — every entry has {name, pos, cat, radius}.
    // Dwell zones are derived FROM THIS LIST, not from a separate
    // correlator_hints table, so any pier / cargo terminal / aircraft
    // added to site_context.js automatically gets dwell coverage.
    const assets = [
      ...(ctx.critical_areas || [])
        .filter(a => a.status !== 'inactive')
        .map(a => ({ id: a.id, name: a.name, criticality: a.criticality, cat: 'area', pos: a.center })),
      ...(ctx.high_value_assets || [])
        .map(a => ({ id: a.id, name: a.name, criticality: a.criticality, cat: 'asset', asset_type: a.asset_type, pos: a.location })),
      ...(ctx.response_asset_positions || [])
        .map(a => ({ id: a.id, name: a.name, criticality: a.criticality, cat: 'response', asset_type: a.asset_type, pos: a.location })),
      ...(ctx.aircraft_of_interest || [])
        .map(a => ({ id: a.id, name: `${a.callsign} (${a.aircraft})`, criticality: 'high', cat: 'aircraft', pos: a.location, aircraft_meta: a })),
    ].filter(a => a.pos?.lat != null)
     .map(a => ({ ...a, radius_m: _radiusForAsset(a) }));

    // Closest-approach + dwell in one pass — for each asset, find the
    // min distance from ANY sample, and count how many samples fall
    // inside the asset's dwell radius.
    const touched = [];
    const dwellZones = [];
    for (const a of assets) {
      let minDist = Infinity;
      let momentSample = null;
      let hitCount = 0;
      let firstHitT = null;
      let lastHitT = null;
      for (const s of samples) {
        const d = haversineM(a.pos.lat, a.pos.lon, s.lat, s.lon);
        if (d < minDist) { minDist = d; momentSample = s; }
        if (d <= a.radius_m) {
          hitCount++;
          if (firstHitT == null) firstHitT = s.t_sec_from_event;
          lastHitT = s.t_sec_from_event;
        }
      }
      if (minDist <= 500) {
        touched.push({ ...a, minDistM: Math.round(minDist), momentSample });
      }
      if (hitCount > 0) {
        dwellZones.push({
          id: a.id,
          name: a.name,
          center: a.pos,
          radius_m: a.radius_m,
          criticality: a.criticality,
          cat: a.cat,
          sampleCount: hitCount,
          durationSec: firstHitT != null ? Math.round(lastHitT - firstHitT) : 0,
          pctOfFlight: samples.length ? Math.round(hitCount / samples.length * 100) : 0,
        });
      }
    }
    touched.sort((a, b) => a.minDistM - b.minDistM);
    dwellZones.sort((a, b) => b.pctOfFlight - a.pctOfFlight);
    return { touched, dwellZones };
  }

  // Dwell threshold for annotating "meaningful" behaviour on the map.
  // Anything below this is a brief pass, not meaningful loiter — it stays
  // in the underlying data but is not surfaced as a headline moment.
  const _DEBRIEF_MEANINGFUL_DWELL_PCT = 20;
  const _DEBRIEF_MEANINGFUL_DWELL_SEC = 8;

  function _debriefExtractMoments(samples, analysis) {
    // Key moments to annotate on the map. Kept SMALL so the view stays
    // readable — only zones the drone genuinely dwelled over, only the
    // single closest approach, plus entry/exit. Ordered chronologically.
    const moments = [];
    if (!samples.length) return moments;
    // First sensor contact = first sample where at least one sensor was
    // actually detecting the drone. Previously used samples[0] which for
    // multi-site cruise-missile tracks landed 200km east of any sensor
    // (spawn point, not detection point). Fall back to samples[0] only if
    // no sample ever records a sensor hit (recording-less fixture case).
    const firstDetected = samples.find(s => (s.sensors_detecting?.length > 0) || s.detection_state === 'detected');
    const entrySample = firstDetected || samples[0];
    moments.push({
      t: entrySample.t_sec_from_event, pos: entrySample, kind: 'entry',
      label: 'DETECTED', color: '#4dd2ff',
      note: firstDetected ? 'First sensor contact' : 'Track spawn',
    });
    // Meaningful dwell zones only (≥ threshold pct AND ≥ threshold sec).
    // Top 2 max — beyond that the map gets crowded.
    const meaningful = (analysis.dwellZones || [])
      .filter(d => d.pctOfFlight >= _DEBRIEF_MEANINGFUL_DWELL_PCT
                && d.durationSec >= _DEBRIEF_MEANINGFUL_DWELL_SEC);
    for (const d of meaningful.slice(0, 2)) {
      const midT = samples[Math.floor(samples.length / 2)].t_sec_from_event;
      const midSample = samples.reduce((best, s) =>
        Math.abs(s.t_sec_from_event - midT) < Math.abs(best.t_sec_from_event - midT) ? s : best,
        samples[0]);
      moments.push({
        t: midT, pos: { lat: d.center.lat, lon: d.center.lon, altitude_agl_m: midSample.altitude_agl_m },
        kind: 'dwell', label: 'LOITER', color: '#ffb84d',
        note: `${d.durationSec}s over ${d.name}`,
      });
    }
    // Closest approach to the SINGLE closest asset (if within 200m —
    // tighter than before, only truly close approaches deserve a marker)
    const closest = (analysis.touched || [])[0];
    if (closest && closest.minDistM <= 200 && closest.momentSample) {
      moments.push({
        t: closest.momentSample.t_sec_from_event, pos: closest.momentSample,
        kind: 'approach', label: 'CLOSEST APPROACH', color: '#ff5a5a',
        note: `${closest.minDistM}m from ${closest.name}`,
      });
    }
    // Level flyby detection — drone altitude matches the typical rooftop
    // height of a touched asset AND horizontal distance is close. Flags
    // "flying at building-height around Terminal 2" style behaviour that
    // a human analyst would notice but the raw stats miss.
    const TYPICAL_H_BY_ASSET_TYPE = {
      atc_control_tower: 80,
      maintenance_facility: 24,      // hangar roof
      vip_state_terminal: 15,
      cuas_fixed: 22,                 // rooftop CUAS position
      ils_ground_installation: 12,
      fuel_storage: 15,
      fuel_infrastructure: 8,
      ground_power: 7,
      emergency_response: 12,
      nav_broadcast: 20,
    };
    const TYPICAL_H_BY_CAT = { area: 22, asset: 15, response: 10, aircraft: 12 };
    const TYPICAL_H_BY_NAME_KEYWORD = [
      { re: /terminal/i, h: 25 },
      { re: /pier|finger/i, h: 20 },
      { re: /hangar/i, h: 24 },
      { re: /tower/i, h: 80 },
      { re: /control/i, h: 40 },
    ];
    function _assetTypicalHeight(a) {
      if (a.asset_type && TYPICAL_H_BY_ASSET_TYPE[a.asset_type] != null) return TYPICAL_H_BY_ASSET_TYPE[a.asset_type];
      for (const rule of TYPICAL_H_BY_NAME_KEYWORD) {
        if (rule.re.test(a.name || '')) return rule.h;
      }
      if (a.cat && TYPICAL_H_BY_CAT[a.cat] != null) return TYPICAL_H_BY_CAT[a.cat];
      return null;
    }
    // Skip the closest-approach asset (already flagged). Look at NEXT
    // touched asset that has a typical height + close horizontal + drone
    // altitude near that height (±10m).
    let levelFlyby = null;
    for (const a of (analysis.touched || []).slice(1)) {
      if (a.minDistM > 180 || !a.momentSample) continue;
      const h = _assetTypicalHeight(a);
      if (h == null) continue;
      const droneAlt = a.momentSample.altitude_agl_m || 0;
      if (Math.abs(droneAlt - h) <= 12) {
        levelFlyby = { asset: a, height: h, droneAlt };
        break;
      }
    }
    if (levelFlyby) {
      const a = levelFlyby.asset;
      moments.push({
        t: a.momentSample.t_sec_from_event, pos: a.momentSample,
        kind: 'level-flyby', label: 'LEVEL FLYBY', color: '#c084fc',
        note: `Circled ${a.name} at rooftop height (${Math.round(levelFlyby.droneAlt)}m, matches structure)`,
      });
    }
    // Exit — last sample where drone was actually detected (mirrors the
    // first-detection logic above). Falls back to final sample if no
    // detection state is available.
    let lastDetected = null;
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i];
      if ((s.sensors_detecting?.length > 0) || s.detection_state === 'detected') {
        lastDetected = s; break;
      }
    }
    const last = lastDetected || samples[samples.length - 1];
    moments.push({
      t: last.t_sec_from_event, pos: last, kind: 'exit',
      label: 'TRACK LOST', color: '#8b8f9a',
      note: lastDetected ? 'Last confirmed sensor contact' : 'End of tracked path',
    });
    moments.sort((a, b) => a.t - b.t);
    return moments;
  }

  function _debriefBuildNarrative(event, samples, analysis) {
    const ctx = contextForSite(event.siteId);
    const siteN = ctx?.name || siteName(event.siteId);
    const dur = samples.length ? Math.round(samples[samples.length - 1].t_sec_from_event - samples[0].t_sec_from_event) : 0;
    const droneN = event.droneType || 'Contact';
    const parts = [];
    parts.push(`<b>${droneN}</b> was tracked across <b>${siteN}</b> for <b>${dur}s</b>.`);

    // Tiered dwell language. NEVER call ≤ 20% "meaningful" — that reads as
    // marketing spin over data. Split zones into primary (≥ 40%), notable
    // (20-40%), and brief passes (< 20%).
    const primary = analysis.dwellZones.filter(d => d.pctOfFlight >= 40);
    const notable = analysis.dwellZones.filter(d => d.pctOfFlight >= 20 && d.pctOfFlight < 40);
    const brief = analysis.dwellZones.filter(d => d.pctOfFlight < 20 && d.durationSec >= 3);

    // Narrative focuses on ONE dominant asset rather than diluting across
    // several similar-percentage zones. Prior version listed "also
    // concentrated over X" which read as "20% at 4 assets" — no clear
    // story pointer. Now leads with the single top zone; secondary zones
    // are still visible in the dwell breakdown UI below.
    if (primary.length) {
      const p = primary[0];
      parts.push(`Behaviour focused on <b>${p.name}</b>, sustained for <b>${p.durationSec}s</b> (${p.pctOfFlight}% of the entire flight).`);
    } else if (notable.length) {
      const n = notable[0];
      parts.push(`Highest dwell concentration was over <b>${n.name}</b> (${n.durationSec}s, ${n.pctOfFlight}% of the flight). Remainder read as transit.`);
    } else if (brief.length) {
      const names = brief.slice(0, 3).map(b => b.name).join(', ');
      parts.push(`Track transited briefly over <b>${brief.length}</b> asset${brief.length === 1 ? '' : 's'}${brief.length <= 3 ? ` (${names})` : ''} with no sustained loiter.`);
    } else {
      parts.push(`Track did not loiter over any single asset — behaviour reads as a transit rather than reconnaissance.`);
    }

    if (analysis.touched.length) {
      const closest = analysis.touched[0];
      const closestLbl = closest.minDistM < 100 ? 'Very close approach' : closest.minDistM < 200 ? 'Closest approach' : 'Nearest asset';
      parts.push(`${closestLbl}: <b>${closest.minDistM}m</b> from <b>${closest.name}</b>.`);
    }
    if (event.linkedEventIds?.length) {
      parts.push(`Signature correlator linked this to <b>${event.linkedEventIds.length}</b> related detection${event.linkedEventIds.length === 1 ? '' : 's'} at other sites.`);
    }

    // Per-drone outlier detection — for multi-drone events, compute mean
    // confidence per drone and flag any that ran significantly weaker than
    // the pack. Doesn't name the type/model (RF fingerprint stays in the
    // Intelligence section), just calls out the ROLE + weak confidence so
    // the post-summary reads as analyst insight. Fully data-driven from
    // the recording — auto-surfaces whenever a swarm has a real outlier.
    try {
      const droneStats = new Map();
      for (const s of samples) {
        if (!s.droneId) continue;
        if (!droneStats.has(s.droneId)) {
          droneStats.set(s.droneId, { role: s.formation_role, confSum: 0, count: 0, altSum: 0 });
        }
        const d = droneStats.get(s.droneId);
        d.confSum += (s.confidence || 0);
        d.altSum += (s.altitude_agl_m || 0);
        d.count++;
      }
      if (droneStats.size >= 2) {
        const rows = Array.from(droneStats.values()).map(d => ({
          role: d.role,
          meanConf: d.confSum / d.count,
          meanAlt: d.altSum / d.count,
        }));
        const packMean = rows.reduce((sum, r) => sum + r.meanConf, 0) / rows.length;
        const outlier = rows.find(r => (packMean - r.meanConf) > 0.15);   // 15+ pts weaker
        if (outlier && outlier.role) {
          const packAvg = Math.round(packMean * 100);
          const outAvg = Math.round(outlier.meanConf * 100);
          const altNote = outlier.meanAlt > 0
            ? ` and averaged <b>${Math.round(outlier.meanAlt)}m</b> altitude`
            : '';
          parts.push(`One airframe held a distinct <b>${outlier.role}</b> pattern${altNote}, with detection confidence consistently weaker than the pack (${outAvg}% vs ${packAvg}%). Flagged for post-incident review.`);
        }
      }
    } catch (_) { /* silent — never break narrative */ }

    if (event.classification === 'hostile') {
      parts.push(`Classification remained <b style="color:#ff8a8a;">HOSTILE</b> throughout. ${event.outcome === 'neutralized' ? 'Target neutralised by fighter response.' : 'No neutralisation dispatched.'}`);
    } else if (event.platform === 'non-identifiable') {
      parts.push(`Contact was <b>never positively identified</b>. Analyst review outstanding.`);
    }
    return parts.join(' ');
  }

  function _debriefRenderAssetHighlights(touched) {
    // Rings ONLY — no anchor dots, no labels. Per Lucas feedback, the
    // debrief was rendering 20+ dots (one per touched asset) that
    // cluttered the view. Callouts + dots belong exclusively to the
    // KEY MOMENTS layer (_debriefRenderMoments) so the operator sees a
    // small, curated set of annotations instead of a scattered dot soup.
    // Rings still show "these are the assets the drone flew over" as
    // ambient context.
    const entities = [];
    for (const a of touched) {
      const critical = a.criticality === 'critical' || a.criticality === 'high';
      const isAircraft = a.cat === 'aircraft';
      const ringColor = isAircraft
        ? Cesium.Color.fromCssColorString('#a3e635').withAlpha(0.75)
        : critical
          ? Cesium.Color.fromCssColorString('#ff5a5a').withAlpha(0.70)
          : Cesium.Color.fromCssColorString('#ffb84d').withAlpha(0.60);
      const fillColor = isAircraft
        ? Cesium.Color.fromCssColorString('#a3e635').withAlpha(0.08)
        : critical
          ? Cesium.Color.fromCssColorString('#ff5a5a').withAlpha(0.05)
          : Cesium.Color.fromCssColorString('#ffb84d').withAlpha(0.03);
      const ringRadius = isAircraft ? 40 : Math.max(60, a.radius_m || 200);
      entities.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(a.pos.lon, a.pos.lat),
        ellipse: {
          semiMajorAxis: ringRadius,
          semiMinorAxis: ringRadius,
          material: fillColor,
          outline: true,
          outlineColor: ringColor,
          outlineWidth: isAircraft ? 2.5 : 2,
          height: 0,
        },
        properties: { debrief: true },
      }));
    }
    return entities;
  }

  function _debriefRenderTrajectory(samples) {
    if (samples.length < 2) return [];
    // Reuse the confidence-band + confirmed/projected segment logic from
    // replay. Confirmed = solid, projected = dashed at 60% alpha. Tells
    // the viewer at a glance which parts of the path are sensor-observed
    // vs reconstructed from context.
    const segments = _replayBuildTrailSegments(samples);
    const entities = [];
    for (const seg of segments) {
      if (seg.positions.length < 2) continue;
      const flat = seg.positions.flat();
      const color = _confidenceColor(seg.avgConf);
      const material = seg.confirmed
        ? color
        : new Cesium.PolylineDashMaterialProperty({
            color: color.withAlpha(0.55),
            dashLength: 14,
          });
      entities.push(viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat),
          width: seg.confirmed ? 4 : 2.5,
          material,
          clampToGround: false,
        },
        properties: { debrief: true, confirmed: seg.confirmed },
      }));
    }
    return entities;
  }

  // Debrief callouts — HTML overlay + SVG leader lines. Cesium labels
  // proved unreliable (some moments rendered blank on the map when
  // occluded by tiles OR when the label position projected off-frustum).
  // HTML gives us full CSS control, guaranteed rendering, non-overlap
  // stacking, and a proper Palantir-esque look.
  let _debriefCalloutState = null;
  function _debriefRenderMoments(moments) {
    const entities = [];
    const capped = moments.slice(0, 10);
    const layer = document.getElementById('debrief-callout-layer');
    const svg = document.getElementById('debrief-callout-svg');
    if (!layer || !svg) return entities;
    // Clear any prior callouts/lines
    layer.querySelectorAll('.dbc-callout,.dbc-dot-shadow').forEach(n => n.remove());
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    layer.style.display = 'block';

    // 1) Ground-clamped Cesium dots (stuck to real coords)
    const dotAnchors = [];
    for (const m of capped) {
      const dot = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(m.pos.lon, m.pos.lat, 0),
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString(m.color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { debrief: true },
      });
      entities.push(dot);
      dotAnchors.push(m);
    }

    // 2) HTML callout elements + SVG leader line placeholders
    const calloutEls = [];
    const lineEls = [];
    for (let i = 0; i < capped.length; i++) {
      const m = capped[i];
      const cb = document.createElement('div');
      cb.className = 'dbc-callout';
      cb.style.setProperty('--dbc-color', m.color);
      cb.innerHTML = `
        <div class="dbc-tag">${m.label}</div>
        <div class="dbc-note">${m.note}</div>`;
      layer.appendChild(cb);
      calloutEls.push(cb);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', m.color);
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '4 4');
      line.setAttribute('opacity', '0.75');
      svg.appendChild(line);
      lineEls.push(line);
    }

    // 3) Per-frame position update: project 3D dot → 2D screen, place
    //    callout above with vertical stagger, draw leader line.
    const scratch = new Cesium.Cartesian2();
    function _updatePositions() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      // Build (screen-x, callout-y) list, sort by x so stacking respects layout
      const positioned = [];
      for (let i = 0; i < capped.length; i++) {
        const m = capped[i];
        const world = Cesium.Cartesian3.fromDegrees(m.pos.lon, m.pos.lat, 0);
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, world, scratch);
        positioned.push({ idx: i, m, win: win ? { x: win.x, y: win.y } : null });
      }
      // Assign each callout a Y position. Stack above the dot by default.
      // TOP_LIMIT keeps callouts BELOW the top bar (0-62px) so they never
      // spill over the site header. If stacking upward would push a
      // callout above the limit, flip it below the dot instead.
      const BASE_OFFSET = 140;   // px above the dot for first callout
      const STAGGER = 100;        // px extra offset per additional moment
      const TOP_LIMIT = 80;       // top-bar clearance (top-bar ~ 62px + margin)
      const BOTTOM_LIMIT = window.innerHeight - 40;
      for (const p of positioned) {
        const cb = calloutEls[p.idx];
        const line = lineEls[p.idx];
        if (!p.win || p.win.x < -200 || p.win.x > (window.innerWidth + 200) || p.win.y < -200 || p.win.y > (window.innerHeight + 200)) {
          cb.style.opacity = '0';
          line.setAttribute('opacity', '0');
          continue;
        }
        const cbH = cb.offsetHeight || 70;
        let calloutY = p.win.y - BASE_OFFSET - (p.idx * STAGGER);
        // If stacking upward pushes above top bar, flip below the dot
        if (calloutY < TOP_LIMIT) {
          calloutY = p.win.y + 30 + (p.idx * (cbH + 12));
        }
        // Never let callout run off bottom either
        if (calloutY + cbH > BOTTOM_LIMIT) calloutY = BOTTOM_LIMIT - cbH;
        cb.style.left = `${p.win.x}px`;
        cb.style.top = `${calloutY}px`;
        cb.style.opacity = '1';
        // Leader line: connect the near edge of the callout to the dot
        const isAbove = (calloutY + cbH) < p.win.y;
        const lineY = isAbove ? (calloutY + cbH) : calloutY;
        const dotY = isAbove ? (p.win.y - 8) : (p.win.y + 8);
        line.setAttribute('x1', String(p.win.x));
        line.setAttribute('y1', String(lineY));
        line.setAttribute('x2', String(p.win.x));
        line.setAttribute('y2', String(dotY));
        line.setAttribute('opacity', '0.75');
      }
    }
    viewer.scene.postRender.addEventListener(_updatePositions);
    _updatePositions();

    _debriefCalloutState = { layer, svg, updateFn: _updatePositions, calloutEls, lineEls };
    return entities;
  }

  function _clearDebriefCallouts() {
    if (!_debriefCalloutState) return;
    const { layer, svg, updateFn } = _debriefCalloutState;
    try { viewer.scene.postRender.removeEventListener(updateFn); } catch (_) {}
    if (layer) {
      layer.querySelectorAll('.dbc-callout,.dbc-dot-shadow').forEach(n => n.remove());
      layer.style.display = 'none';
    }
    if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);
    _debriefCalloutState = null;
  }

  function _debriefBuildNarrativePanel(event, narrativeHtml, moments) {
    const wrap = document.createElement('div');
    wrap.id = 'debrief-narrative';
    wrap.className = 'debrief-narrative';
    const momentsList = (moments && moments.length) ? `
      <div class="dbn-moments">
        ${moments.map(m => `
          <div class="dbn-moment">
            <span class="dbn-moment-dot" style="background:${m.color}"></span>
            <span class="dbn-moment-label">${m.label}</span>
            <span class="dbn-moment-note">${m.note}</span>
          </div>`).join('')}
      </div>` : '';
    const modelSubtitle = isMistralConfigured()
      ? 'Analysis derived from linked recordings + site context. Streaming from Mistral Large 2 · sovereign EU inference.'
      : `Analysis derived from ${event.linkedEventIds?.length ? 'linked recordings + ' : ''}site context. Mistral not configured — showing deterministic synthesis.`;
    wrap.innerHTML = `
      <div class="dbn-header">
        <span class="dbn-badge">DEBRIEF</span>
        <span class="dbn-eid pl-mono">${event.id}</span>
        <button class="dbn-close" id="debrief-close-btn">Exit debrief</button>
      </div>
      <div class="dbn-body" data-debrief-body="${event.id}" data-debrief-reco="${event.id}">${narrativeHtml}</div>
      ${momentsList}
      <div class="dbn-footer" data-debrief-foot="${event.id}">${modelSubtitle}</div>
    `;
    document.body.appendChild(wrap);
    document.getElementById('debrief-close-btn').addEventListener('click', stopDebrief);
    return wrap;
  }

  function startDebrief(eventId) {
    const event = getEvent(eventId);
    if (!event) return;
    if (_debriefState) stopDebrief();
    // Dim base map + entities so the debrief callouts + trajectory pop.
    // CSS class on <body> is picked up by style.css rules that reduce
    // imagery brightness for the Cesium wrapper.
    document.body.classList.add('mode-analysis');
    const resolved = _debriefResolveSamples(event);
    if (!resolved || !resolved.samples.length) {
      toast('No trajectory data for this event — debrief unavailable.', 'info');
      return;
    }
    const samples = resolved.samples;
    const analysis = _debriefAnalyzeAssets(event, samples);
    const moments = _debriefExtractMoments(samples, analysis);
    const narrativeHtml = _debriefBuildNarrative(event, samples, analysis);
    // Fly camera to site, then release the fixed reference frame so the
    // operator can pan / translate freely instead of only pivoting around
    // the initial focus point. Cesium's flyToBoundingSphere locks the
    // camera to a lookAt transform after arrival; the setTimeout gives
    // the flight time to finish before we release it.
    if (event.siteId) {
      flyTo(event.siteId);
      setTimeout(() => {
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      }, 2500);
    }
    // Render map annotations
    const entities = [
      ..._debriefRenderAssetHighlights(analysis.touched),
      ..._debriefRenderTrajectory(samples),
      ..._debriefRenderMoments(moments),
    ];
    const narrativeEl = _debriefBuildNarrativePanel(event, narrativeHtml, moments);
    _debriefState = { eventId, entities, narrativeEl, sourceMode: resolved.source };
    _fireMistralDebrief(event, samples, analysis);
    toast(`Debrief on map · ${analysis.touched.length} assets touched, ${analysis.dwellZones.length} dwell zones triggered`, 'ok');
  }

  // Fires the Mistral streaming call for the currently-mounted debrief.
  // The deterministic narrative is already in the DOM. Tokens replace it
  // as they arrive. On error the deterministic narrative stays.
  let _mistralDebriefGen = 0;
  function _fireMistralDebrief(event, samples, analysis) {
    if (!isMistralConfigured() || !event) return;
    const gen = ++_mistralDebriefGen;
    const bodyEl = document.querySelector(`[data-debrief-body="${event.id}"]`);
    const footEl = document.querySelector(`[data-debrief-foot="${event.id}"]`);
    if (!bodyEl) return;

    let hasReplacedBody = false;
    let latestBody = '';
    let latestReco = '';
    const paint = () => {
      const bodyHtml = `<p>${latestBody}</p>`;
      const recoHtml = latestReco ? `<p class="dbn-analyst-take" style="margin-top:12px;padding-left:10px;border-left:2px solid var(--accent);color:var(--text-primary);font-weight:500;">${latestReco}</p>` : '';
      bodyEl.innerHTML = bodyHtml + recoHtml;
    };
    streamDebriefNarrative(event, samples, analysis, {
      onBodyDelta: (text) => {
        if (gen !== _mistralDebriefGen) return;
        if (!hasReplacedBody) { bodyEl.textContent = ''; hasReplacedBody = true; }
        latestBody = text.trim();
        paint();
      },
      onRecoDelta: (text) => {
        if (gen !== _mistralDebriefGen) return;
        latestReco = text.trim();
        paint();
      },
      onDone: (result) => {
        if (gen !== _mistralDebriefGen) return;
        if (footEl) footEl.textContent = `Generated just now · Sovereign EU inference · Model: ${result.model_version}`;
      },
      onError: (err) => {
        if (gen !== _mistralDebriefGen) return;
        console.warn('[mistral debrief] falling back to deterministic:', err.message);
        if (footEl) footEl.textContent = `Mistral unreachable · showing deterministic synthesis · ${err.message.slice(0, 80)}`;
      },
    });
  }

  function stopDebrief() {
    if (!_debriefState) return;
    for (const ent of _debriefState.entities) viewer.entities.remove(ent);
    if (_debriefState.narrativeEl?.parentNode) _debriefState.narrativeEl.remove();
    _clearDebriefCallouts();
    _debriefState = null;
    document.body.classList.remove('mode-analysis');
  }
  window.__isr_startDebrief = startDebrief;
  window.__isr_stopDebrief = stopDebrief;

  // ═══════════════════════════════════════════════════════════════════
  // P5B · Trajectory replay engine
  // ───────────────────────────────────────────────────────────────────
  // Replays a closed event's recorded per-drone trajectory as ghost
  // billboards on the live map, with a confidence-coloured trail split
  // into contiguous same-band segments (red < 0.5, amber < 0.7, lime
  // < 0.85, green >= 0.85). Playback controls overlay the map: play/
  // pause, timeline scrubber, speed selector (0.5x/1x/2x/4x), close.
  //
  // Ghost billboards reuse platformIcon at 55% alpha so they're clearly
  // distinct from live billboards. Trail polylines carry a small alpha
  // so the underlying imagery remains readable.
  // ═══════════════════════════════════════════════════════════════════
  let _replayState = null;   // { eventId, samples, drones, entities, tCurrentSec, ... }

  function _confidenceColor(conf) {
    if (conf < 0.5)  return Cesium.Color.fromCssColorString('#ff5a5a').withAlpha(0.65);
    if (conf < 0.7)  return Cesium.Color.fromCssColorString('#ff8c3d').withAlpha(0.65);
    if (conf < 0.85) return Cesium.Color.fromCssColorString('#a3e635').withAlpha(0.65);
    return Cesium.Color.fromCssColorString('#4dff9c').withAlpha(0.65);
  }

  // Classify a sample as "confirmed" (sensor-observed) or "projected"
  // (inferred / pre-detection / sensor gap). Confirmed samples render as
  // solid confidence-coloured polylines; projected samples render as
  // DASHED, dimmer polylines so the viewer instantly knows which parts
  // of the trajectory are real sensor data vs simulation reconstruction.
  function _sampleIsConfirmed(s) {
    // Recording samples have detection_state; waypoint-derived samples
    // (no recording available) have no state → treat as projected since
    // we're rebuilding from the template, not from real sensor hits.
    return s.detection_state === 'detected';
  }

  // Trail altitude — REVERTED. The clamp desynced trails from drone
  // positions (drones at 50m, trails at 100m = visually detached).
  // Passthrough helper kept so callers don't need to change.
  function _safeTrailAlt(alt) { return alt || 0; }

  function _replayBuildTrailSegments(samples) {
    // Group into contiguous same-band, same-confirmed-status segments so
    // each polyline is a uniform style and colour.
    const bandOf = (c) => c < 0.5 ? 0 : c < 0.7 ? 1 : c < 0.85 ? 2 : 3;
    const segments = [];
    let current = null;
    for (const s of samples) {
      const b = bandOf(s.confidence || 0);
      const confirmed = _sampleIsConfirmed(s);
      if (!current || current.band !== b || current.confirmed !== confirmed) {
        if (current) current.positions.push([s.lon, s.lat, s.altitude_agl_m]);
        current = { band: b, confirmed, avgConf: s.confidence || 0, positions: [] };
        segments.push(current);
      }
      current.positions.push([s.lon, s.lat, s.altitude_agl_m]);
    }
    return segments;
  }

  function _replayRenderTrails(droneEntries) {
    const trailEntities = [];
    for (const [droneId, samples] of droneEntries) {
      const segments = _replayBuildTrailSegments(samples);
      for (const seg of segments) {
        if (seg.positions.length < 2) continue;
        const flat = seg.positions.flat();
        const color = _confidenceColor(seg.avgConf);
        // Confirmed = solid, full width, full alpha.
        // Projected = dashed, dimmer, thinner. Visually says "we
        // reconstructed this from context, sensors didn't see it live".
        const material = seg.confirmed
          ? color
          : new Cesium.PolylineDashMaterialProperty({
              color: color.withAlpha(0.5),
              dashLength: 12,
            });
        const ent = viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat),
            width: seg.confirmed ? 3 : 2,
            material,
            clampToGround: false,
          },
        });
        ent._replayDroneId = droneId;
        ent._replayConfirmed = seg.confirmed;
        trailEntities.push(ent);
      }
    }
    return trailEntities;
  }

  function _replayInterpolate(samples, tSec) {
    if (!samples?.length) return null;
    if (tSec <= samples[0].t_sec_from_event) {
      const s = samples[0];
      return { lat: s.lat, lon: s.lon, alt: s.altitude_agl_m, hdg: s.heading_deg, conf: s.confidence };
    }
    const last = samples[samples.length - 1];
    if (tSec >= last.t_sec_from_event) {
      return { lat: last.lat, lon: last.lon, alt: last.altitude_agl_m, hdg: last.heading_deg, conf: last.confidence };
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      if (tSec >= a.t_sec_from_event && tSec < b.t_sec_from_event) {
        const dt = b.t_sec_from_event - a.t_sec_from_event;
        const alpha = dt > 0 ? (tSec - a.t_sec_from_event) / dt : 0;
        return {
          lat: a.lat + (b.lat - a.lat) * alpha,
          lon: a.lon + (b.lon - a.lon) * alpha,
          alt: a.altitude_agl_m + (b.altitude_agl_m - a.altitude_agl_m) * alpha,
          hdg: a.heading_deg,
          conf: a.confidence + (b.confidence - a.confidence) * alpha,
        };
      }
    }
    return null;
  }

  function _replayTick() {
    if (!_replayState || !_replayState.playing) {
      _replayState && (_replayState._rafId = requestAnimationFrame(_replayTick));
      return;
    }
    const st = _replayState;
    const nowMs = performance.now();
    const dtSec = (nowMs - (st._lastFrameMs || nowMs)) / 1000;
    st._lastFrameMs = nowMs;
    st.tCurrentSec = Math.min(st.durationSec, st.tCurrentSec + dtSec * st.speed);
    for (const [droneId, entry] of st.droneEntries) {
      const pos = _replayInterpolate(entry, st.tCurrentSec);
      if (!pos) continue;
      const ent = st.droneEntities.get(droneId);
      if (ent) ent.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt);
    }
    _replayUpdateUI();
    if (st.tCurrentSec >= st.durationSec) st.playing = false;   // auto-pause at end
    st._rafId = requestAnimationFrame(_replayTick);
  }

  function _replayUpdateUI() {
    if (!_replayState) return;
    const st = _replayState;
    const scrub = document.getElementById('replay-scrub');
    const timeLabel = document.getElementById('replay-time');
    const playBtn = document.getElementById('replay-play');
    if (scrub) scrub.value = String(st.tCurrentSec);
    if (timeLabel) timeLabel.textContent = `${st.tCurrentSec.toFixed(1)}s / ${st.durationSec.toFixed(1)}s`;
    if (playBtn) playBtn.textContent = st.playing ? '⏸' : '▶';
  }

  function _replayBuildUI() {
    const wrap = document.createElement('div');
    wrap.id = 'replay-overlay';
    wrap.className = 'replay-overlay';
    wrap.innerHTML = `
      <div class="replay-header" id="replay-drag-handle" title="Drag to move">
        <span class="replay-grip">⋮⋮</span>
        <span class="replay-title">TRAJECTORY REPLAY</span>
        <span class="replay-event mono" id="replay-event-id">—</span>
        <span class="replay-legend" title="Trail colour = detection confidence: red < 0.50, amber 0.50–0.70, lime 0.70–0.85, green ≥ 0.85">
          <span class="rl-sw" style="background:#ff5a5a"></span>
          <span class="rl-sw" style="background:#ff8c3d"></span>
          <span class="rl-sw" style="background:#a3e635"></span>
          <span class="rl-sw" style="background:#4dff9c"></span>
          <span class="rl-lbl">confidence</span>
        </span>
        <button class="btn small" id="replay-close">Close</button>
      </div>
      <div class="replay-controls">
        <button class="btn primary" id="replay-play" aria-label="Play/Pause">▶</button>
        <input type="range" id="replay-scrub" min="0" max="100" step="0.1" value="0" />
        <span class="mono" id="replay-time">0.0s / 0.0s</span>
        <div class="replay-speeds">
          <button class="btn small" data-speed="0.5">0.5x</button>
          <button class="btn small active" data-speed="1">1x</button>
          <button class="btn small" data-speed="2">2x</button>
          <button class="btn small" data-speed="4">4x</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    // Restore last-known position (persisted across sessions)
    try {
      const saved = JSON.parse(localStorage.getItem('isr_replay_overlay_pos') || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        // Clamp to current viewport in case window shrank since save
        const maxLeft = Math.max(0, window.innerWidth - 200);
        const maxTop = Math.max(0, window.innerHeight - 60);
        wrap.style.left = `${Math.min(Math.max(0, saved.left), maxLeft)}px`;
        wrap.style.top = `${Math.min(Math.max(0, saved.top), maxTop)}px`;
        wrap.style.right = 'auto';
        wrap.style.bottom = 'auto';
        wrap.style.transform = 'none';
      }
    } catch (e) { /* ignore */ }
    // Drag by header. Only the handle triggers drag, so buttons inside
    // the header (Close) still receive clicks normally.
    const handle = document.getElementById('replay-drag-handle');
    let drag = null;
    handle.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('button')) return; // don't hijack Close clicks
      const rect = wrap.getBoundingClientRect();
      drag = { offX: ev.clientX - rect.left, offY: ev.clientY - rect.top };
      wrap.classList.add('dragging');
      document.body.classList.add('replay-dragging');
      ev.preventDefault();
    });
    window.addEventListener('mousemove', (ev) => {
      if (!drag) return;
      const maxLeft = Math.max(0, window.innerWidth - wrap.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - wrap.offsetHeight);
      const left = Math.min(Math.max(0, ev.clientX - drag.offX), maxLeft);
      const top = Math.min(Math.max(0, ev.clientY - drag.offY), maxTop);
      wrap.style.left = `${left}px`;
      wrap.style.top = `${top}px`;
      wrap.style.right = 'auto';
      wrap.style.bottom = 'auto';
      wrap.style.transform = 'none';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      wrap.classList.remove('dragging');
      document.body.classList.remove('replay-dragging');
      const rect = wrap.getBoundingClientRect();
      try { localStorage.setItem('isr_replay_overlay_pos', JSON.stringify({ left: rect.left, top: rect.top })); } catch (e) { /* ignore */ }
    });
    document.getElementById('replay-play').addEventListener('click', () => {
      if (!_replayState) return;
      if (_replayState.tCurrentSec >= _replayState.durationSec) _replayState.tCurrentSec = 0;
      _replayState.playing = !_replayState.playing;
      _replayState._lastFrameMs = performance.now();
      _replayUpdateUI();
    });
    document.getElementById('replay-close').addEventListener('click', () => stopReplay());
    document.getElementById('replay-scrub').addEventListener('input', (ev) => {
      if (!_replayState) return;
      _replayState.tCurrentSec = parseFloat(ev.target.value) || 0;
      // Force one-frame position update while paused
      if (!_replayState.playing) {
        for (const [droneId, entry] of _replayState.droneEntries) {
          const pos = _replayInterpolate(entry, _replayState.tCurrentSec);
          const ent = _replayState.droneEntities.get(droneId);
          if (pos && ent) ent.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt);
        }
      }
      _replayUpdateUI();
    });
    wrap.querySelectorAll('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_replayState) return;
        _replayState.speed = parseFloat(btn.dataset.speed);
        wrap.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    return wrap;
  }

  function startReplay(eventId) {
    const rec = window.__isr_getRecording(eventId);
    if (!rec || !rec.timeseries?.length) {
      toast('No trajectory recording available for this event.', 'info');
      return;
    }
    if (_replayState) stopReplay();
    document.body.classList.add('mode-analysis');
    // Group timeseries by droneId, preserve chronological order per drone
    const droneEntries = new Map();
    for (const s of rec.timeseries) {
      if (!droneEntries.has(s.droneId)) droneEntries.set(s.droneId, []);
      droneEntries.get(s.droneId).push(s);
    }
    for (const [, arr] of droneEntries) arr.sort((a, b) => a.t_sec_from_event - b.t_sec_from_event);
    // Confidence-coloured trails (all drones, static)
    const trailEntities = _replayRenderTrails(droneEntries);
    // Ghost billboards — one per drone, translucent variant of platformIcon
    const event = getEvent(eventId);
    const platform = event?.platform || rec.meta?.event_type || 'quadcopter';
    const color = CLASS_COLORS[event?.classification] || CLASS_COLORS.unknown;
    const droneEntities = new Map();
    for (const [droneId, samples] of droneEntries) {
      const first = samples[0];
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(first.lon, first.lat, first.altitude_agl_m),
        billboard: {
          image: platformIcon(platform, color),
          scale: 0.6,
          color: Cesium.Color.WHITE.withAlpha(0.55),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${droneId} · REPLAY`,
          font: '10px system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE.withAlpha(0.75),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      ent._replayDroneId = droneId;
      droneEntities.set(droneId, ent);
    }
    const durationSec = rec.timeseries[rec.timeseries.length - 1].t_sec_from_event;
    _replayState = {
      eventId,
      droneEntries,
      droneEntities,
      trailEntities,
      tCurrentSec: 0,
      durationSec,
      speed: 1,
      playing: true,
      _lastFrameMs: performance.now(),
    };
    _replayBuildUI();
    const scrub = document.getElementById('replay-scrub');
    if (scrub) scrub.max = String(durationSec);
    const idLabel = document.getElementById('replay-event-id');
    if (idLabel) idLabel.textContent = eventId;
    _replayUpdateUI();
    _replayState._rafId = requestAnimationFrame(_replayTick);
    toast(`Replay started (${droneEntries.size} drone${droneEntries.size === 1 ? '' : 's'}, ${durationSec.toFixed(0)}s)`, 'ok');
  }

  function stopReplay() {
    if (!_replayState) return;
    cancelAnimationFrame(_replayState._rafId);
    for (const ent of _replayState.droneEntities.values()) viewer.entities.remove(ent);
    for (const ent of _replayState.trailEntities) viewer.entities.remove(ent);
    const ui = document.getElementById('replay-overlay');
    if (ui) ui.remove();
    _replayState = null;
    // Only lift the analysis mask if debrief isn't also running
    if (!_debriefState) document.body.classList.remove('mode-analysis');
  }

  window.__isr_startReplay = startReplay;
  window.__isr_stopReplay = stopReplay;

  function createDroneEntities(event) {
    const platform = event.platform || 'quadcopter';
    const color = CLASS_COLORS[event.classification] || CLASS_COLORS.unknown;
    // Use the template's first waypoint as spawn position when there is no
    // recorded entry/lastPosition yet. Prevents the entity from being added
    // at (0,0) — the Gulf of Guinea — for one frame before the first tick.
    const wp0 = TEMPLATES[event.templateKey]?.waypoints?.[0];
    const startPos = event.entry
      ? [event.entry.lon, event.entry.lat, 100]
      : event.lastPosition
        ? [event.lastPosition.lon, event.lastPosition.lat, 100]
        : wp0
          ? [wp0.lon, wp0.lat, wp0.alt || 100]
          : [0, 0, 100];

    const trailPositions = [];
    const shadowPositions = [];

    const trail = viewer.entities.add({
      id: `drone-trail-${event.id}`,
      polyline: {
        positions: new Cesium.CallbackProperty(() => trailPositions, false),
        width: 2.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString(color).withAlpha(0.75),
          dashLength: 8,
        }),
      },
    });

    const shadow = viewer.entities.add({
      id: `drone-shadow-${event.id}`,
      polyline: {
        positions: new Cesium.CallbackProperty(() => shadowPositions, false),
        width: 1,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.WHITE.withAlpha(0.35),
          dashLength: 6,
        }),
      },
    });

    // Rotation is a CallbackProperty so it re-evaluates every render frame
    // — matches AMRAAM smoothness. The tick loop writes `state.headingRad`
    // continuously; the billboard reads it here.
    const stateHolder = { headingRad: 0 };
    const billboard = viewer.entities.add({
      id: `drone-${event.id}`,
      position: Cesium.Cartesian3.fromDegrees(...startPos),
      billboard: {
        image: platformIcon(platform, color),
        width: 32, height: 32,
        rotation: new Cesium.CallbackProperty(() => stateHolder.headingRad, false),
        color: event.classification === 'hostile'
          ? new Cesium.CallbackProperty(() => {
              const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 200);
              return Cesium.Color.WHITE.withAlpha(pulse);
            }, false)
          : Cesium.Color.WHITE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: event.droneType,
        font: '11px "IBM Plex Mono", monospace',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -32),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { type: 'drone', eventId: event.id },
    });

    // Swarm formation — if the template declares template.swarm.formation
    // with size > 1, spawn additional billboards for the non-lead slots.
    // Each slot has { role, offset: { forward, right } } in metres. Positions
    // are updated in the tick loop from the lead position + rotated offset.
    const template = TEMPLATES[event.templateKey];
    const swarmBillboards = [];
    if (template?.swarm?.formation && template.swarm.formation.length > 1) {
      for (let i = 1; i < template.swarm.formation.length; i++) {
        const slot = template.swarm.formation[i];
        const swarmBb = viewer.entities.add({
          id: `drone-${event.id}-swarm-${i}`,
          position: Cesium.Cartesian3.fromDegrees(...startPos),
          billboard: {
            image: platformIcon(platform, color),
            width: 26, height: 26,   // slightly smaller than lead for visual hierarchy
            rotation: new Cesium.CallbackProperty(() => stateHolder.headingRad, false),
            color: event.classification === 'hostile'
              ? new Cesium.CallbackProperty(() => {
                  const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 200);
                  return Cesium.Color.WHITE.withAlpha(pulse);
                }, false)
              : Cesium.Color.WHITE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { type: 'drone', eventId: event.id, swarmIndex: i, swarmRole: slot.role },
        });
        // Per-drone TRAIL (red dashed, past track) — grows behind the drone
        // while inside sensor coverage, freezes when out.
        const trailPositions = [];
        const trailLine = viewer.entities.add({
          id: `drone-${event.id}-swarm-${i}-trail`,
          polyline: {
            positions: new Cesium.CallbackProperty(() => trailPositions, false),
            width: 2,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#ff3d3d').withAlpha(0.7),
              dashLength: 10,
            }),
          },
        });
        // Per-drone PROJECTION (red dashed, future intent) — visible ONLY
        // when the drone is out of sensor coverage. Shows each drone's
        // intended path forward from its current position along its heading.
        const projPositions = [];
        const projLine = viewer.entities.add({
          id: `drone-${event.id}-swarm-${i}-proj`,
          polyline: {
            positions: new Cesium.CallbackProperty(() => projPositions, false),
            width: 1.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#ff3d3d').withAlpha(0.55),
              dashLength: 12,
            }),
          },
        });
        // Generate this drone's INDEPENDENT waypoint list. From now on the
        // drone flies its own path — no more deriving from lead position.
        // Recording / replay / exports all read this per-drone trajectory.
        const droneWaypoints = template?.waypoints
          ? _generatePerDroneWaypoints(template.waypoints, slot)
          : [];
        swarmBillboards.push({
          billboard: swarmBb,
          waypoints: droneWaypoints,   // OWN trajectory, independent of lead
          prevPos: null, prevTs: null, // motion tracking for heading + speed
          trailLine, trailPositions,
          projLine, projPositions,
          offset: slot.offset,
          role: slot.role,
          model: slot.model || 'DJI Matrice 300',
          rfMHz: slot.rfMHz || 2412,
          jitter: {
            phaseE: Math.random() * Math.PI * 2,
            phaseN: Math.random() * Math.PI * 2,
            phaseZ: Math.random() * Math.PI * 2,
            freqE: 0.10 + Math.random() * 0.08,
            freqN: 0.10 + Math.random() * 0.08,
            freqZ: 0.07 + Math.random() * 0.05,
          },
        });
      }
    }

    droneState.set(event.id, {
      billboard, trail, shadow,
      swarmBillboards,   // [] or [{ billboard, waypoints, offset, role, ... }]
      spawnMs: performance.now(),   // shared timing reference for swarm interpolation
      trailPositions, shadowPositions,
      stateHolder,      // { headingRad } — updated in tick, read by billboard rotation callback
      entryDropped: false, entryMarker: null,
      exitDropped: false, exitMarker: null, wasInCoverage: false,
      outOfRangeDropped: false, outOfRangeMarker: null,
      wasInside: false, closedAt: null,
      // Per-site marker state for multi-site tracks. Keyed by siteId.
      // Each entry: { entryDropped, exitDropped, oorDropped, wasInCoverage }
      perSite: new Map(),
    });
  }

  function removeDroneEntities(eventId) {
    const state = droneState.get(eventId);
    if (!state) return;
    viewer.entities.remove(state.billboard);
    viewer.entities.remove(state.trail);
    viewer.entities.remove(state.shadow);
    if (state.swarmBillboards) {
      for (const sw of state.swarmBillboards) {
        viewer.entities.remove(sw.billboard);
        if (sw.trailLine) viewer.entities.remove(sw.trailLine);
        if (sw.projLine) viewer.entities.remove(sw.projLine);
      }
    }
    if (state.entryMarker) viewer.entities.remove(state.entryMarker);
    if (state.exitMarker) viewer.entities.remove(state.exitMarker);
    if (state.outOfRangeMarker) viewer.entities.remove(state.outOfRangeMarker);
    removeProjectedTrajectoryEntity(eventId);
    removeInterceptEntity(eventId);
    const reMarker = _reacquiredMarkers.get(eventId);
    if (reMarker) { viewer.entities.remove(reMarker); _reacquiredMarkers.delete(eventId); }
    // Per-site multi-track markers: remove permanently unless the user is
    // currently viewing this event (in which case keep them until they
    // navigate away — onSelectionChange will hide/remove then).
    if (getSelectedEventId() !== eventId) {
      _removeEventMarkers(eventId);
    }
    droneState.delete(eventId);
  }

  let _lastPanelRefresh = 0;
  let _trailAppendCounter = 0;
  const GHOST_MS = 15000; // markers + trail linger 15s after close

  function onDroneTick(positions) {
    positions.forEach(p => {
      const state = droneState.get(p.eventId);
      if (!state) return;
      const event = getEvent(p.eventId);
      if (!event) return;

      // QRA intercept dispatch is now MANUAL — Flyvevåbnet receiver clicks
      // "Dispatch F-35" in their Response Overlay to trigger the scramble.
      // This makes the multi-role flow explicit in the demo: operator escalates,
      // Air Force receives + dispatches.

      // QRA intercept check runs BEFORE the visible/hidden branch so it fires
      // even if trajectory has completed (missile went off-screen). Uses last
      // known position from event.
      // Any hostile missile event may be neutralised once F-35 is airborne
      // and has arrived at the intercept station.
      if (_f35.airborne && event.platform === 'missile' && event.classification === 'hostile' && !state.closedAt && event.lastPosition) {
        const neutralized = tryNeutralize(event.id, event.lastPosition);
        if (neutralized) {
          state.closedAt = performance.now();
          markTrackClosed(p.eventId);
          closeEvent(p.eventId, event.exit || null);
          if (state.billboard) state.billboard.show = false;
          if (state.trail) state.trail.show = false;
          if (state.shadow) state.shadow.show = false;
          if (state.swarmBillboards) {
            for (const sw of state.swarmBillboards) sw.billboard.show = false;
          }
          updateContributingRings();
          renderAlertStrip();
          if (getSelectedEventId() === p.eventId) renderDetailPanelThrottled();
        }
      }

      // Multi-site coverage check: iterate every online sensor across ALL
      // sites, find the closest, and compute whether the missile is inside
      // (coverageRadius + VIS_BUFFER_M) of it. VIS_BUFFER_M matches the
      // visible sensor bubble radius exactly (0 buffer) so the icon vanishes
      // the moment the missile crosses the on-map coverage ring — no ghost
      // "still detected" state that the operator can't see the source of.
      const VIS_BUFFER_M = 0;
      let inAnyCoverage = null;
      if (event.multiSiteTrack || event.templateKey === 'cruise_missile_to_amalienborg') {
        inAnyCoverage = false;
        let bestSid = null;
        let bestDist = Infinity;
        let bestRadius = 1000;
        for (const sid of Object.keys(SITES)) {
          const site = SITES[sid];
          if (!site?.sensors?.length) continue;
          for (const s of site.sensors) {
            if (s.status === 'offline') continue;
            const d = haversineM(p.lat, p.lon, s.lat, s.lon);
            if (d < bestDist) {
              bestDist = d;
              bestSid = sid;
              bestRadius = s.coverageRadius;
            }
          }
        }
        if (bestSid && bestDist <= bestRadius + VIS_BUFFER_M) {
          inAnyCoverage = true;
          // Freeze a snapshot of live telemetry each tick we're in
          // coverage — the detail panel shows THIS when the missile
          // subsequently drops out of range (no fabricated live coords).
          event.lastKnownPosition = {
            lat: p.lat, lon: p.lon, alt: Math.round(p.alt),
            speed: p.speed, heading: Math.round(p.heading),
            siteId: bestSid, timestamp: new Date().toISOString(),
          };
          // First ever entry into any sensor coverage → this is THE
          // detection moment. Promote event from pre-detection to detected
          // so the receiver inbox + alert strip surface it.
          if (event.detected === false) {
            event.detected = true;
            const site = SITES[bestSid];
            toast(`DETECTED · ${event.droneType} within ${site?.name || bestSid} sensor range.`, 'warn');
            renderAlertStrip();
          }
          if (
            event._prevInCoverage === false &&
            event._prevCoverageSite !== undefined &&
            bestSid !== event._prevCoverageSite
          ) {
            _fireReacquisition(event, bestSid);
          }
          event._prevCoverageSite = bestSid;
        }
        event._prevInCoverage = inAnyCoverage;
        event.currentlyInCoverage = inAnyCoverage;
      }

      // Update position + rotation + label (still visible after close during ghost)
      if (p.visible) {
        // Multi-site tracks: billboard visible only while in coverage. Once
        // the F-35 has launched a heat seeker at this event the target is
        // continuously tracked by the fighter's onboard sensors, so the
        // icon stays visible through the terminal chase even outside ground
        // sensor coverage. If the track was neutralised, keep it hidden —
        // don't let the position update override the kill teardown.
        const beingChased = _friendlyMissile.active && _friendlyMissile.targetEventId === event.id;
        const shouldShow = state.closedAt
          ? false
          : (inAnyCoverage === null ? true : (inAnyCoverage || beingChased));
        state.billboard.show = shouldShow;
        state.shadow.show = shouldShow;
        // Multi-site tracks fire ENTRY / EXIT / OUT OF RANGE markers per
        // site as the missile transits each coverage zone.
        if (event.multiSiteTrack || event.templateKey === 'cruise_missile_to_amalienborg') {
          processPerSiteMarkers(state, p, event.id);
        }
        state.billboard.position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt);

        // ── P68: dynamic contributingSensors population (real geospatial)
        // As the drone flies, add any sensor whose coverage the drone is
        // currently inside to the responsible event's contributingSensors.
        // Applies to primary AND linked/shadow events at other sites
        // (fixes: AMK shadow event had zero sensor data because template's
        // contributingSensors were CPH's — no dynamic update ever ran).
        _updateContributingSensorsForPosition(event, p.lat, p.lon);

        // ── P55: single-drone recording capture (fixed-wing / jet / missile)
        // Additive path. If the event has NO swarm formation and no recording
        // yet, init one now. Then capture a sample per tick at the same
        // adaptive interval swarm events use. Both paths write to the same
        // state.recording, so _persistRecording, replay, and debrief work
        // uniformly. Zero effect on swarm events — they use the existing
        // _initRecording + swarm-loop capture below.
        try {
          const _tpl_single = TEMPLATES[event.templateKey];
          if (_tpl_single && !_tpl_single.swarm) {
            if (!state.recording) {
              _initSingleDroneRecording(event, state, _tpl_single);
            }
            const _nowMs_single = performance.now();
            const _interval_single = _sampleIntervalForEvent(event);
            if (!state._singleLastSampleMs || (_nowMs_single - state._singleLastSampleMs) >= _interval_single) {
              const _drone0 = state.recording.meta.drones[0];
              state.recording.timeseries.push(_buildDroneSample({
                event,
                droneId: _drone0.id,
                droneIdx: 0,
                model: _drone0.model,
                role: 'lead',
                pos: { lat: p.lat, lon: p.lon, alt: p.alt },
                hdgDeg: p.heading || 0,
                speedMs: p.speed || 0,
                conf: event.confidence,
                rfMHz: event.platform === 'missile' ? 0 : 2412,
                inCov: (inAnyCoverage === null ? true : inAnyCoverage) || false,
                tipInCov: false,
                tSec: p.tSec,
              }));
              state._singleLastSampleMs = _nowMs_single;
            }
          }
        } catch (err) { /* silent — never break the tick */ }

        // Icon rotation with wrap-aware exponential smoothing. Target = actual
        // motion vector this frame. Small lerp factor (0.06) means waypoint
        // pivots resolve over ~15 render frames = visible curving turn like
        // the AMRAAM's homing arc, instead of an instant snap.
        if (state.prevLat !== undefined) {
          const dLat = p.lat - state.prevLat;
          const dLon = p.lon - state.prevLon;
          if (Math.abs(dLat) > 1e-9 || Math.abs(dLon) > 1e-9) {
            const target = -Math.atan2(dLon, dLat);
            if (state.stateHolder.headingInit) {
              let delta = target - state.stateHolder.headingRad;
              while (delta > Math.PI) delta -= 2 * Math.PI;
              while (delta < -Math.PI) delta += 2 * Math.PI;
              state.stateHolder.headingRad += delta * 0.06;
            } else {
              state.stateHolder.headingRad = target;
              state.stateHolder.headingInit = true;
            }
          }
        }
        state.prevLat = p.lat;
        state.prevLon = p.lon;
        state.billboard.label.text = `${event.droneType} · ${Math.round(p.alt)}m · ${Math.round(p.heading)}°`;

        state.shadowPositions.length = 0;
        state.shadowPositions.push(
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt),
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0),
        );

        _trailAppendCounter++;
        if (_trailAppendCounter % 3 === 0) {
          state.trailPositions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, _safeTrailAlt(p.alt)));
          if (state.trailPositions.length > 180) state.trailPositions.shift();
        }

        // Perimeter crossing detection — fall back to outer siteBoundary if
        // sub-area `perimeter` is empty (Esbjerg case, boundary lives there).
        const site = SITES[p.siteId];
        const perim = site?.perimeter?.length ? site.perimeter
                    : (site?.siteBoundary?.length ? site.siteBoundary : null);
        const rangeM = perim ? distanceToPerimeter(p.lat, p.lon, perim) : null;
        const isInside = perim ? pointInPolygon(p.lat, p.lon, perim) : false;

        event.lastPosition = {
          lat: p.lat, lon: p.lon, alt: Math.round(p.alt),
          speed: p.speed, heading: Math.round(p.heading),
          rangeToPerim: rangeM, eta: null,
        };
        event.duration = Math.round(p.tSec);

        // ── Cross cueing: project trajectory forward, find impacted infra.
        // Snapshot the projection input (lat/lon/heading/speed) each time
        // the track is in live coverage. When the missile enters a sensor
        // gap, the projection line FREEZES at the last snapshot instead of
        // hiding — narratively: this is the last confirmed heading and it
        // stays on the map for operators to reason about. When the next
        // site re-acquires with a new heading, the snapshot updates and the
        // line JUMPS to the new direction, revealing that the missile's
        // real course diverges from the initial projection.
        const hasLiveContact = inAnyCoverage === null ? true : inAnyCoverage;
        if (event.classification === 'hostile' && event.status === 'active' && p.speed > 0) {
          if (hasLiveContact) {
            event.projectionSnapshot = { lat: p.lat, lon: p.lon, heading: p.heading, speed: p.speed };
          }
          if (event.projectionSnapshot) {
            event.projectedPath = projectImpacts(event.projectionSnapshot, event.siteId);
            updateProjectedTrajectoryEntity(event);
          }
        } else {
          event.projectedPath = null;
          removeProjectedTrajectoryEntity(event.id);
        }


        // ENTRY marker on first inside crossing. Multi-site tracks use
        // processPerSiteMarkers for all sites (including origin) so this
        // legacy origin-only path is skipped for them to avoid duplicates.
        if (isInside && !state.entryDropped && !event.multiSiteTrack) {
          state.entryDropped = true;
          state.wasInside = true;
          const entryTime = new Date().toISOString().slice(11, 19);
          event.entry = { lat: p.lat, lon: p.lon, alt: Math.round(p.alt), timestamp: new Date().toISOString(), heading: Math.round(p.heading), sensorIds: event.contributingSensors.map(s => s.id) };
          // Route via _dropMarker so it lands in _perEventMarkers for
          // selection-driven hide/show (matches multi-site marker path).
          state.entryMarker = _dropMarker(p.lat, p.lon, '#4dd2ff', `ENTRY ${entryTime}Z`, event.id);
        }

        // Coverage-based tracking: nearest sensor + whether threat is inside its coverage
        const cov = nearestSensorInCoverage(p, site);
        if (cov?.inCoverage) state.wasInCoverage = true;

        // EXIT marker fires on EITHER perimeter outbound crossing OR loss of sensor coverage.
        // Marker drops but track continues playing — we still have a fading signal.
        const perimeterExit = state.wasInside && !isInside;
        const coverageExit  = state.wasInCoverage && cov && !cov.inCoverage;
        if ((perimeterExit || coverageExit) && !state.exitDropped && !event.multiSiteTrack) {
          state.exitDropped = true;
          const exitTime = new Date().toISOString().slice(11, 19);
          const lastSensor = cov?.nearest?.id || (event.contributingSensors[0]?.id) || '';
          const exitLabel = coverageExit && lastSensor ? `EXIT ${exitTime}Z · cleared ${lastSensor}` : `EXIT ${exitTime}Z`;
          const exitPoint = { lat: p.lat, lon: p.lon, alt: Math.round(p.alt), timestamp: new Date().toISOString(), heading: Math.round(p.heading), leftCoverageOf: coverageExit ? lastSensor : null };
          state.exitMarker = _dropMarker(p.lat, p.lon, '#ffb84d', exitLabel, event.id);
          event.exit = exitPoint;
          // If intercept is pending, don't force-close on coverage exit — let
          // the missile keep playing until QRA neutralizes it.
          if (event.awaitingNeutralization) {
            // no-op; keep track alive
          }
        }

        // OUT OF RANGE (terminal) — fires the instant no sensor at this
        // site can detect the missile. cov.inCoverage aggregates every
        // sensor's individual coverageRadius from metadata; if any sensor
        // still covers the position we stay in range. No hardcoded buffer.
        if (state.exitDropped && !state.outOfRangeDropped && cov?.nearest && !event.multiSiteTrack) {
          if (!cov.inCoverage) {
            state.outOfRangeDropped = true;
            const oorTime = new Date().toISOString().slice(11, 19);
            state.outOfRangeMarker = _dropMarker(p.lat, p.lon, '#ff5a5a', `OUT OF RANGE ${oorTime}Z · signal lost`, event.id);
            event.outOfRange = { lat: p.lat, lon: p.lon, alt: Math.round(p.alt), timestamp: new Date().toISOString() };
            if (!state.closedAt && !event.awaitingNeutralization && !event.multiSiteTrack) {
              state.closedAt = performance.now();
              markTrackClosed(p.eventId);
              closeEvent(p.eventId, event.exit || null);
              updateContributingRings();
              renderAlertStrip();
              if (getSelectedEventId() === p.eventId) renderDetailPanel();
            }
          }
        }
      } else {
        // Off-map: hide LEAD drone (swarm handled by its own loop below).
        state.billboard.show = false;
        state.shadow.show = false;
      }

      // ── Swarm INDEPENDENT per-drone tick ─────────────────────────────
      // Wrapped in try/catch so a rendering error elsewhere in the tick
      // can't strand drones with stale positions (was causing static
      // "point to Africa" lines when panel render threw).
      try { if (state.swarmBillboards && state.swarmBillboards.length > 0) {
        // P5A: init recording on first swarm tick (once per event)
        const _template_for_rec = TEMPLATES[event.templateKey];
        if (!state.recording && _template_for_rec?.swarm) {
          _initRecording(event, state, _template_for_rec);
        }
        const nowMs = performance.now();
        const tSec = (nowMs - (state.spawnMs || nowMs)) / 1000;
        const M_PER_DEG_LAT = 111320;

        // NOTE: the old hardcoded `secondEvent` trigger (`template.secondEvent`
        // fires at fixed tSec) has been removed. Per-site event spawning is
        // now handled dynamically by `_handlePerSiteLifecycle` at the end of
        // this block — spawn on real sensor entry, close on real sensor exit,
        // scenario-agnostic. See P21.

        // Lead heading estimate — for leadStats display only
        let leadHdgDeg = state._lastLeadHdg || 0;
        if (state.prevLat !== undefined && p) {
          const M_PER_DEG_LON_L = 111320 * Math.cos(p.lat * Math.PI / 180);
          const dLat = p.lat - state.prevLat, dLon = p.lon - state.prevLon;
          if (Math.abs(dLat) > 1e-9 || Math.abs(dLon) > 1e-9) {
            leadHdgDeg = ((Math.atan2(dLon * M_PER_DEG_LON_L, dLat * M_PER_DEG_LAT) * 180 / Math.PI) + 360) % 360;
            state._lastLeadHdg = leadHdgDeg;
          }
        }
        if (p) {
          state.leadStats = {
            lat: p.lat, lon: p.lon, alt: p.alt,
            heading: leadHdgDeg, speed: p.speed || 25,
          };
          // P5A: adaptive sample capture for the lead (same event-driven interval as wingmen)
          if (state.recording && (!state._leadLastSampleMs || (nowMs - state._leadLastSampleMs) >= _sampleIntervalForEvent(event))) {
            const _template_lead = TEMPLATES[event.templateKey];
            const _leadSlot = _template_lead?.swarm?.formation?.[0] || {};
            const _leadInCov = _shouldAutoDetect(p.lat, p.lon);
            state.recording.timeseries.push(_buildDroneSample({
              event, droneId: 'DJI-1', droneIdx: 0,
              model: _leadSlot.model || 'DJI Matrice 300 RTK',
              role: 'lead',
              pos: { lat: p.lat, lon: p.lon, alt: p.alt },
              hdgDeg: leadHdgDeg,
              speedMs: p.speed || 25,
              conf: event.confidence,
              rfMHz: _leadSlot.rfMHz || 2412,
              inCov: _leadInCov, tipInCov: false, tSec,
            }));
            state._leadLastSampleMs = nowMs;
          }
        }
        for (let i = 0; i < state.swarmBillboards.length; i++) {
          const sw = state.swarmBillboards[i];
          const pos = _interpolateWaypoints(sw.waypoints, tSec);
          if (!pos) {
            sw.billboard.show = false;
            if (sw.projLine) sw.projLine.show = false;
            continue;
          }
          const M_PER_DEG_LON = 111320 * Math.cos(pos.lat * Math.PI / 180);
          // Heading + speed from this drone's own motion
          let hdgDeg = state._lastLeadHdg || 0;
          let speedMs = 25;
          if (sw.prevPos && sw.prevTs) {
            const dEast = (pos.lon - sw.prevPos.lon) * M_PER_DEG_LON;
            const dNorth = (pos.lat - sw.prevPos.lat) * M_PER_DEG_LAT;
            if (Math.abs(dEast) > 0.05 || Math.abs(dNorth) > 0.05) {
              hdgDeg = ((Math.atan2(dEast, dNorth) * 180 / Math.PI) + 360) % 360;
            }
            const dt = (nowMs - sw.prevTs) / 1000;
            if (dt > 0.02) speedMs = Math.hypot(dEast, dNorth) / dt;
          }
          // Per-drone coverage check. Pre-detection dashed line now TRAILS
          // the drone (points to where it CAME from), not forward. The
          // tip-cue calculation below uses the drone's own position for
          // coverage entry, no forward projection needed.
          const inCov = _shouldAutoDetect(pos.lat, pos.lon);
          // tipInCov retained for compatibility with the recording sample
          // schema (detection_state 'tip_cued'); zero now that we no longer
          // draw a forward tip. Post-demo: replace with an "approaching"
          // heuristic based on sensor-proximity rather than tip cueing.
          const tipInCov = false;
          const swShouldShow = event.multiSiteTrack ? (inCov || tipInCov) : true;
          sw.billboard.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt);
          sw.billboard.show = swShouldShow;
          // Rogue-drone tag: any wingman whose model is NOT a DJI platform
          // is treated as an unknown-provenance emitter. Its confidence is
          // held in the WEAK band (0.35-0.55) so its trail colour-codes
          // red/yellow in replay + debrief — surfaces the "one drone we
          // never IDed" story exactly as a real analyst would flag it.
          const _isRogue = sw.model && !/^DJI/i.test(sw.model);
          sw.stats = {
            lat: pos.lat, lon: pos.lon, alt: pos.alt,
            heading: hdgDeg, speed: speedMs,
            rfCarrierMHz: sw.rfMHz || (2412 + (i % 3) * 5),
            rfPower_dBm: -68 + (i * -2),
            model: sw.model,
            confidence: _isRogue
              ? Math.max(0.32, Math.min(0.55, 0.44 + Math.sin(tSec * 0.4 + i * 1.7) * 0.10))
              : Math.max(0.4, Math.min(0.98, 0.75 + (i * 0.04) + Math.sin(tSec * 0.3 + i * 1.7) * 0.08)),
          };
          // P68: dynamic contributingSensors for the WINGMAN's position too
          _updateContributingSensorsForPosition(event, pos.lat, pos.lon);
          // P5A: adaptive sample capture (interval decided ONCE per event by platform)
          if (state.recording && (!sw._lastSampleMs || (nowMs - sw._lastSampleMs) >= _sampleIntervalForEvent(event))) {
            state.recording.timeseries.push(_buildDroneSample({
              event, droneId: `DJI-${i + 2}`, droneIdx: i + 1,
              model: sw.model, role: sw.role,
              pos, hdgDeg, speedMs,
              conf: sw.stats.confidence,
              rfMHz: sw.rfMHz || 2412,
              inCov, tipInCov, tSec,
            }));
            sw._lastSampleMs = nowMs;
          }
          // DIAGNOSTIC — expose live per-drone snapshot on window so we can
          // verify from browser console: `console.table(window.__swarmDebug)`
          if (!window.__swarmDebug) window.__swarmDebug = {};
          window.__swarmDebug[`DJI-${i + 2}`] = {
            model: sw.model,
            lat: pos.lat.toFixed(6), lon: pos.lon.toFixed(6),
            alt: pos.alt.toFixed(1),
            hdg: hdgDeg.toFixed(1), spd: speedMs.toFixed(2),
            rf: sw.rfMHz,
            wpCount: sw.waypoints.length,
            wp0: `${sw.waypoints[0]?.lat.toFixed(4)},${sw.waypoints[0]?.lon.toFixed(4)}`,
            tSec: tSec.toFixed(2),
          };
          // Pre-detection: dashed line TRAILS behind the drone, growing
          // organically as the drone flies. Shows where it came from, not
          // where it's going (per operator feedback — forward projection
          // read as "we know its intent" which we don't pre-detection).
          // Post-detection: trail switches to the solid confirmed-path
          // polyline and the dashed trailing line is hidden.
          if (inCov) {
            sw.trailPositions.push(Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, _safeTrailAlt(pos.alt)));
            if (sw.trailPositions.length > 400) sw.trailPositions.shift();
            sw.projLine.show = false;
          } else {
            sw.projPositions.push(Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt));
            if (sw.projPositions.length > 300) sw.projPositions.shift();
            sw.projLine.show = sw.projPositions.length >= 2;
          }
          sw.prevPos = { lat: pos.lat, lon: pos.lon };
          sw.prevTs = nowMs;
        }
        // P21: universal per-site event lifecycle. Aggregate all drone
        // positions in the group (lead + swarm members), compute which
        // sites currently see any of them, and diff vs last tick to
        // trigger spawn-on-entry / close-on-exit per site.
        const groupPositions = [];
        if (p?.lat != null) groupPositions.push({ lat: p.lat, lon: p.lon });
        for (const sw of state.swarmBillboards || []) {
          if (sw.stats?.lat != null) groupPositions.push({ lat: sw.stats.lat, lon: sw.stats.lon });
        }
        const currentGroupSites = _aggregateGroupSites(groupPositions);
        _handlePerSiteLifecycle(event, state, currentGroupSites);
      } } catch (err) { console.error('[SWARM tick error]', err); }

      // On track completion: close event, start ghost timer for entity
      // cleanup. Multi-site tracks (swarm, cruise) also close here when
      // ALL waypoints are exhausted — the drone has finished its full
      // path across every site. Previously excluded, which left swarm
      // billboards + trails lingering on the map after the simulation
      // ended. `awaitingNeutralization` still exempts events under
      // active F-35 pursuit so they close on interception, not on
      // waypoint end.
      if (p.completed && !state.closedAt && !event.awaitingNeutralization) {
        state.closedAt = performance.now();
        markTrackClosed(p.eventId);
        closeEvent(p.eventId, event.exit || null);
        // Also close any linked/secondary events (e.g. swarm's shadow
        // event at AMK) so they don't linger as active in the inbox.
        const linkedIds = event.linkedEventIds || [];
        for (const lid of linkedIds) {
          const le = getEvent(lid);
          if (le && le.status === 'active') closeEvent(lid, le.exit || null);
        }
        updateContributingRings();
        renderAlertStrip();
        if (getSelectedEventId() === p.eventId) renderDetailPanel();
        // P5A: finalize + persist trajectory recording
        if (state.recording) {
          state.recording.meta.ended_at_utc = new Date().toISOString();
          state.recording.meta.duration_sec = event.duration || null;
          _persistRecording(p.eventId);
          console.log(`[P5A] recording persisted: isr_trajectory_${p.eventId} (${state.recording.timeseries.length} samples)`);
        }
      }

      // P5A: periodic in-flight persistence every 30 s (crash safety)
      if (state.recording && (!state._lastPersistMs || performance.now() - state._lastPersistMs >= 30000)) {
        _persistRecording(p.eventId);
        state._lastPersistMs = performance.now();
      }

      // Ghost period: keep markers + trail visible for GHOST_MS, then remove
      if (state.closedAt && performance.now() - state.closedAt > GHOST_MS) {
        removeDroneEntities(p.eventId);
        removeLiveTrack(p.eventId);
        updateSimButton();
      }
    });

    // Detail Panel refresh for live selected event — routes through the
    // hover-aware throttled variant so the render pauses while the
    // operator is interacting with the panel (P15 fix). The 400ms outer
    // gate here just prevents queue spam on very high tick rates; the
    // throttle inside enforces the actual 500ms floor.
    if (Date.now() - _lastPanelRefresh > 400) {
      const sel = getSelectedEventId();
      if (sel && positions.some(p => p.eventId === sel && !p.completed) && !document.querySelector('.dp-form')) {
        renderDetailPanelThrottled();
      }
      _lastPanelRefresh = Date.now();
    }
    // Receiver view refresh is NOT tied to the tick — it re-renders only
    // on real state transitions (new event, ack, dispatch, neutralisation)
    // to eliminate the flickering the 400ms rebuild was causing.
  }

  // Contributing sensor pulsing rings (cyan) around each contributing sensor of any live event
  let contributingRingEntities = [];
  function updateContributingRings() {
    contributingRingEntities.forEach(e => viewer.entities.remove(e));
    contributingRingEntities = [];
    for (const [eventId] of droneState) {
      const event = getEvent(eventId);
      if (!event || event.status !== 'active') continue;
      const site = SITES[event.siteId];
      if (!site) continue;
      event.contributingSensors.filter(s => !s.offline).forEach(s => {
        const sensor = site.sensors.find(x => x.id === s.id);
        if (!sensor) return;
        // Ring visibility is dynamic: only shown when a threat associated
        // with this event is CURRENTLY inside this sensor's coverage
        // radius. Prior behaviour left every contributing-sensor's ring
        // pulsing forever, even after the drone had moved 800m away.
        const _eventId = eventId;
        const _sensorLat = sensor.lat, _sensorLon = sensor.lon, _covR = sensor.coverageRadius;
        const _showInRange = new Cesium.CallbackProperty(() => {
          const evt = getEvent(_eventId);
          if (!evt || evt.status !== 'active') return false;
          const st = droneState.get(_eventId);
          // Aggregate all drone positions currently tracked for this event
          // (lead position from event.lastPosition + every swarm wingman)
          if (evt.lastPosition?.lat != null) {
            if (haversineM(evt.lastPosition.lat, evt.lastPosition.lon, _sensorLat, _sensorLon) <= _covR) return true;
          }
          if (st?.swarmBillboards) {
            for (const sw of st.swarmBillboards) {
              if (sw.stats?.lat != null
                  && haversineM(sw.stats.lat, sw.stats.lon, _sensorLat, _sensorLon) <= _covR) {
                return true;
              }
            }
          }
          return false;
        }, false);
        contributingRingEntities.push(viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, 2),
          billboard: {
            image: ringIcon(),
            width: 26, height: 26,
            show: _showInRange,
            scale: new Cesium.CallbackProperty(() => 1.0 + 0.18 * Math.sin(performance.now() / 250), false),
            color: new Cesium.CallbackProperty(() => {
              const pulse = 0.35 + 0.40 * Math.sin(performance.now() / 250);
              return Cesium.Color.WHITE.withAlpha(pulse);
            }, false),
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }));
      });
    }
  }

  // ── Spawn API — button click hooks into this ──
  function spawnFromTemplate(templateKey) {
    if (anyTrackLive()) return; // one at a time
    const template = TEMPLATES[templateKey];
    if (!template) return;
    const eventId = nextEventId();
    const event = {
      id: eventId,
      siteId: template.siteId,
      classification: template.classification,
      threat: template.threat,
      droneType: template.droneType,
      platform: template.platform,
      confidence: template.confidence,
      confidenceTrend: template.confidenceTrend,
      status: 'active',
      startTime: new Date().toISOString(),
      endTime: null,
      duration: 0,
      entry: null, exit: null, lastPosition: null,
      contributingSensors: template.contributingSensors,
      evidence: template.evidence,
      notes: [],
      templateKey,
      // multiSiteTrack: object is invisible outside sensor coverage, visible
      // only when inside a sensor ring. Set by template.multiSite OR the
      // legacy cruise missile key. Any multi-site scenario (swarm, missile)
      // should declare template.multiSite = true.
      multiSiteTrack: !!template.multiSite || templateKey === 'cruise_missile_to_amalienborg',
      // For multi-site tracks: hold detection state until the tick loop
      // confirms the object has entered a sensor's coverage. Single-site
      // events fire immediately (spawned inside their site's coverage).
      detected: (!!template.multiSite || templateKey === 'cruise_missile_to_amalienborg') ? false : true,
      spawnTs: Date.now(),
    };
    addEvent(event);
    // P8: run detection-similarity correlator against active + recently
    // closed events. Auto-populates linkedEventIds bidirectionally + adds
    // audit note if the composite score >= threshold.
    _autoCorrelate(event);
    addLiveTrack(eventId, template);
    createDroneEntities(event);
    updateContributingRings();
    selectEvent(eventId);
    updateSimButton();
  }

  function updateSimButton() {
    const live = anyTrackLive();
    document.querySelectorAll('.sim-btn[data-threat]').forEach(btn => {
      btn.disabled = live;
      btn.classList.toggle('is-active', live);
    });
    const cancelBtn = document.getElementById('cancel-threat');
    if (cancelBtn) cancelBtn.style.display = live ? 'block' : 'none';
  }

  function cancelActiveThreats() {
    // Force-close every live drone track. Delegates entity cleanup to
    // removeDroneEntities() so swarm billboards, trails, projection lines,
    // and per-site markers are all handled uniformly.
    const droneStateIds = Array.from(droneState.keys());
    for (const eventId of droneStateIds) {
      const event = getEvent(eventId);
      if (event && event.status === 'active') closeEvent(eventId, event.exit || null);
      if (event) event.projectedPath = null;
      markTrackClosed(eventId);
      removeLiveTrack(eventId);
      removeDroneEntities(eventId);   // handles primary + swarm + markers + projections
    }
    // Also sweep any active event that had no droneState entry — this covers
    // linked/shadow events spawned by P21 (e.g. the AMK event when the swarm
    // enters Amager). Without this, AMK stays "active" in the inbox after
    // the user cancels the primary CPH scenario.
    for (const event of EVENTS) {
      if (event.status === 'active') closeEvent(event.id, event.exit || null);
    }
    droneState.clear();
    // Sweep any orphaned projection entities
    for (const eid of Array.from(projectedTrajectoryEntities.keys())) {
      removeProjectedTrajectoryEntity(eid);
    }
    updateContributingRings();
    updateSimButton();
    renderAlertStrip();
    if (getSelectedEventId()) renderDetailPanel();
  }

  onDroneUpdate(onDroneTick);
  // Expose spawn function to the sim button (wired below in control panel section)
  window.__spawnDrone = spawnFromTemplate;
  window.__updateSimButton = updateSimButton;

  // ── Sensor + drone click handling ──
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    if (picked && picked.id && picked.id.properties) {
      const type = picked.id.properties.type?.getValue?.();
      if (type === 'sensor') {
        const siteId = picked.id.properties.siteId.getValue();
        const sensorId = picked.id.properties.sensorId.getValue();
        setActiveSite(siteId);   // reveal the whole site's coverage rings
        showSensorPopup(siteId, sensorId);
        return;
      }
      if (type === 'drone') {
        const eventId = picked.id.properties.eventId.getValue();
        const swIdx = picked.id.properties.swarmIndex?.getValue?.() ?? 0;
        // selectEvent must run FIRST — it triggers onSelectionChange which
        // resets _selectedSwarmIndex to 0. Setting the index AFTER means it
        // survives the reset and the header shows the correct focused drone.
        selectEvent(eventId);
        _selectedSwarmIndex = swIdx;
        renderDetailPanel();
        return;
      }
      if (type === 'neutralised') {
        const eventId = picked.id.properties.eventId.getValue();
        selectEvent(eventId);
        // Scroll the detail panel to the post-incident report once render
        // has committed the new selection.
        setTimeout(() => {
          const pir = document.querySelector('.dp-pir');
          if (pir) pir.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
        return;
      }
      if (type === 'site-rollup') {
        const siteId = picked.id.properties.siteId.getValue();
        flyTo(siteId);
        return;
      }
      if (type === 'target') {
        const targetId = picked.id.properties.targetId.getValue();
        selectTarget(targetId);
        return;
      }
    }
    // Empty click (or clicked something non-interactive) — deselect the
    // active site so its coverage rings hide. Palantir-style "click away
    // to clear" for a clean overview.
    hideSensorPopup();
    setActiveSite(null);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ── Sensor popup ──
  const popup = document.getElementById('sensor-popup');
  let activePopupSensor = null;
  let activeCoverageEntity = null;

  function showSensorPopup(siteId, sensorId) {
    const site = SITES[siteId];
    const sensor = site.sensors.find((s) => s.id === sensorId);
    if (!sensor) return;

    // Clear any previously shown coverage circle
    if (activeCoverageEntity) {
      viewer.entities.remove(activeCoverageEntity);
      activeCoverageEntity = null;
    }

    // Show this sensor's coverage circle (cyan, semi-translucent, dashed outline)
    activeCoverageEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, 0),
      ellipse: {
        semiMajorAxis: sensor.coverageRadius || 500,
        semiMinorAxis: sensor.coverageRadius || 500,
        material: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.12),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.6),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });

    activePopupSensor = { siteId, sensorId };

    popup.innerHTML = `
      <div class="pop-hdr">
        <span class="pop-id">${sensor.id}</span>
        <span class="pop-status pop-status-${sensor.status}">${sensor.status.toUpperCase()}</span>
      </div>
      <div class="pop-label">${sensor.label}</div>

      <div class="pop-section">
        <div class="pop-k">Hardware</div>
        <div class="pop-v">${sensor.hardware}</div>
      </div>
      <div class="pop-section">
        <div class="pop-k">Modalities</div>
        <div class="pop-v">${sensor.modalities.join(' · ')}</div>
      </div>
      <div class="pop-section">
        <div class="pop-k">Coverage radius</div>
        <div class="pop-v">${sensor.coverageRadius} m</div>
      </div>
      <div class="pop-section">
        <div class="pop-k">Detections (last 24h)</div>
        <div class="pop-v accent">${sensor.detectionsLast24h}</div>
      </div>
      ${sensor.issues ? `
      <div class="pop-issues">
        <div class="pop-k pop-k-warn">Active Issue</div>
        <div class="pop-issue-txt">${sensor.issues}</div>
      </div>` : ''}
      <div class="pop-pov">
        <button class="pop-pov-btn" data-pov-sensor="${siteId}|${sensor.id}">Enter Sensor POV</button>
        <div class="pop-pov-meta">${_inferSensorMount(sensor).describe}</div>
      </div>
    `;

    popup.style.display = 'block';
    popup.style.pointerEvents = 'auto';
    const povBtn = popup.querySelector('.pop-pov-btn');
    if (povBtn) {
      povBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const [sid, senid] = povBtn.dataset.povSensor.split('|');
        _enterSensorPOV(sid, senid);
      });
    }
    updatePopupPosition();
  }

  function hideSensorPopup() {
    popup.style.display = 'none';
    popup.style.pointerEvents = 'none';
    activePopupSensor = null;
    if (activeCoverageEntity) {
      viewer.entities.remove(activeCoverageEntity);
      activeCoverageEntity = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Sensor POV camera mode
  // ───────────────────────────────────────────────────────────────────
  // Click "Enter Sensor POV" in the sensor popup → camera flies to the
  // sensor's physical position (at eye/mast/roof height) looking slightly
  // upward. Simulates standing at the sensor. Normal camera controls stay
  // active so operator can tilt/rotate. Exit button flies back.
  //
  // Mount height inferred from label keywords when sensor lacks explicit
  // mountType/mountHeightM. This lets every site work without hand-editing
  // every sensor definition (Lucas: "all sites, when possible above ground").
  // ═══════════════════════════════════════════════════════════════════
  function _inferSensorMount(sensor) {
    // Explicit override wins
    if (sensor.mountType && sensor.mountHeightM != null) {
      return {
        type: sensor.mountType,
        heightM: sensor.mountHeightM,
        describe: `Mount · ${sensor.mountType} · ${sensor.mountHeightM}m AGL`,
      };
    }
    const label = (sensor.label || '').toLowerCase();
    // Order matters — most specific first
    if (label.includes('tower') || label.includes('atc')) {
      return { type: 'mast', heightM: 60, describe: 'Mount · ATC tower · ~60m AGL' };
    }
    if (label.includes('rooftop')) {
      return { type: 'roof', heightM: 22, describe: 'Mount · rooftop · ~22m AGL' };
    }
    if (label.includes('hangar')) {
      return { type: 'roof', heightM: 16, describe: 'Mount · hangar roof · ~16m AGL' };
    }
    if (label.includes('perimeter') || label.includes('bulge') || label.includes('corner')) {
      return { type: 'mast', heightM: 10, describe: 'Mount · perimeter pole · ~10m AGL' };
    }
    // Default airside / apron / approach — perimeter mast
    return { type: 'mast', heightM: 12, describe: 'Mount · airside mast · ~12m AGL' };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Sensor POV — P47 restoration
  // ───────────────────────────────────────────────────────────────────
  // Reverting to the approach that Lucas confirmed "amazing" in P47:
  // flyTo with orientation for entry, swap Cesium's event types so
  // LEFT_DRAG = LOOK (first-person head turn), and on exit force Cesium
  // 3D defaults. NO custom mouse handlers, NO enableInputs toggling —
  // those attempts introduced worse regressions than what they solved.
  // ═══════════════════════════════════════════════════════════════════
  let _povActive = false;
  let _povPriorCameraState = null;
  const povControls = document.getElementById('sensor-pov-controls');
  const povLabel = document.getElementById('pov-label');
  const povExitBtn = document.getElementById('pov-exit-btn');

  function _enterSensorPOV(siteId, sensorId) {
    const site = SITES[siteId];
    if (!site) return;
    const sensor = site.sensors.find((s) => s.id === sensorId);
    if (!sensor) return;
    const mount = _inferSensorMount(sensor);
    // Save ONLY the site key — on exit we fly back to that site's overview
    // via flyTo(siteId) which is guaranteed valid. Previously saved a
    // cloned camera.position which sometimes captured a mid-fly transient
    // state, sending the exit fly into the earth core.
    _povPriorCameraState = { siteId };
    const cart = Cesium.Cartographic.fromDegrees(sensor.lon, sensor.lat);
    let groundH = 0;
    try {
      const gh = viewer.scene.globe.getHeight(cart);
      if (gh != null && !isNaN(gh)) groundH = gh;
    } catch (e) { /* fall through */ }
    const destAlt = groundH + mount.heightM + 2;
    const dest = Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, destAlt);
    const heading = Cesium.Math.toRadians(sensor.aimHeading != null ? sensor.aimHeading : 0);
    const pitch = Cesium.Math.toRadians(5);
    // Lower near clipping plane so nearby geometry isn't sliced through.
    viewer.scene.camera.frustum.near = 0.1;
    // Swap Cesium's event types so LEFT_DRAG = LOOK (first-person head
    // turn, camera stays put) instead of the default "rotate globe around
    // reference point" (which flies you across the airport into the
    // ocean). Wheel/zoom stays default.
    const ctrl = viewer.scene.screenSpaceCameraController;
    ctrl.enableCollisionDetection = false;
    ctrl.minimumZoomDistance = 0.5;
    ctrl.rotateEventTypes = [];
    ctrl.translateEventTypes = [];
    ctrl.lookEventTypes = [Cesium.CameraEventType.LEFT_DRAG];
    ctrl.tiltEventTypes = [
      { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.SHIFT },
      Cesium.CameraEventType.MIDDLE_DRAG,
    ];
    // flyTo with orientation — the P47 approach Lucas confirmed worked.
    viewer.camera.flyTo({
      destination: dest,
      orientation: { heading, pitch, roll: 0 },
      duration: 1.6,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
    _povActive = true;
    if (povControls) povControls.classList.add('active');
    if (povLabel) povLabel.textContent = `${sensor.id} · ${sensor.label}`;
    _povIsolateRing(siteId, sensorId);
    hideSensorPopup();
  }

  // Cesium 3D scene default event bindings. Used to force-reset on exit
  // rather than trying to save/restore (that path was flaky).
  function _resetCameraControllerToDefaults(ctrl) {
    ctrl.enableCollisionDetection = true;
    ctrl.minimumZoomDistance = 1.0;
    ctrl.rotateEventTypes = Cesium.CameraEventType.LEFT_DRAG;
    ctrl.translateEventTypes = Cesium.CameraEventType.LEFT_DRAG;
    ctrl.zoomEventTypes = [
      Cesium.CameraEventType.RIGHT_DRAG,
      Cesium.CameraEventType.WHEEL,
      Cesium.CameraEventType.PINCH,
    ];
    ctrl.tiltEventTypes = [
      Cesium.CameraEventType.MIDDLE_DRAG,
      Cesium.CameraEventType.PINCH,
      { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
      { eventType: Cesium.CameraEventType.RIGHT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
    ];
    ctrl.lookEventTypes = { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.SHIFT };
  }

  function _exitSensorPOV() {
    const ctrl = viewer.scene.screenSpaceCameraController;
    const saved = _povPriorCameraState;
    _povActive = false;
    _povPriorCameraState = null;
    if (povControls) povControls.classList.remove('active');
    viewer.camera.cancelFlight();
    // Toggle enableInputs OFF → reset defaults → toggle back ON. This
    // FORCES Cesium's ScreenSpaceEventAggregator to re-register the event
    // handlers with the new event types. Setting rotate/look/tilt props
    // alone doesn't trigger re-registration on all Cesium versions, which
    // is why the exit was leaving LEFT_DRAG stuck as LOOK.
    ctrl.enableInputs = false;
    _resetCameraControllerToDefaults(ctrl);
    ctrl.enableInputs = true;
    // Restore near-plane (fix half-blue/grey crashed screen)
    viewer.scene.camera.frustum.near = 1.0;
    _povRestoreAllRings();
    // Fly back to the site overview via the known-good flyTo(siteId) path,
    // NOT to a saved camera.position (which could have been captured mid-
    // fly and sent the exit into the earth core).
    if (saved?.siteId && FLY_TARGETS[saved.siteId]) {
      flyTo(saved.siteId);
    }
  }

  // Hide every sensor-coverage ring EXCEPT the active POV sensor's ring.
  // Called on POV enter. In POV mode you're INSIDE the site with only a
  // narrow FOV, so seeing 22 rings scattered across the airport (each
  // 500-1000m radius, most disconnected from any visible sensor icon
  // because sensors are small/occluded by buildings) reads as visual
  // noise. Just show the active sensor's ring.
  let _povHiddenRingIds = [];
  function _povIsolateRing(siteId, sensorId) {
    _povHiddenRingIds = [];
    const activeRingId = `sensor-cov-${siteId}-${sensorId}`;
    for (const ent of viewer.entities.values) {
      const t = ent.properties?.type?.getValue?.();
      if (t !== 'sensor-coverage') continue;
      if (ent.id === activeRingId) {
        // Ensure the active sensor's ring IS visible even if the site
        // toggle would normally hide it.
        ent.show = true;
      } else if (ent.show) {
        // Remember which rings were visible so we can restore on exit.
        _povHiddenRingIds.push(ent.id);
        ent.show = false;
      }
    }
  }
  function _povRestoreAllRings() {
    for (const id of _povHiddenRingIds) {
      const ent = viewer.entities.getById(id);
      if (ent) ent.show = true;
    }
    _povHiddenRingIds = [];
  }

  if (povExitBtn) povExitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _exitSensorPOV();
  });

  function updatePopupPosition() {
    if (!activePopupSensor) return;
    const site = SITES[activePopupSensor.siteId];
    const sensor = site.sensors.find((s) => s.id === activePopupSensor.sensorId);
    if (!sensor) return;

    const world = Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, 40);
    const window = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, world);
    if (!window) { popup.style.display = 'none'; return; }

    // Position popup to the upper-right of the sensor
    popup.style.left = `${window.x + 12}px`;
    popup.style.top = `${window.y - popup.offsetHeight / 2}px`;
  }

  viewer.scene.postRender.addEventListener(updatePopupPosition);

  // ══════════════════════════════════════════
  // SITE OVERVIEW PANEL (bottom-left card)
  // ══════════════════════════════════════════
  const overviewCard = document.getElementById('site-overview');
  const overviewToggle = document.getElementById('site-overview-toggle');
  const overviewName = document.getElementById('site-overview-name');
  const overviewStats = document.getElementById('site-overview-stats');
  let overviewExpanded = true;

  let _currentSiteScope = null;
  function setActiveSite(siteId) {
    _currentSiteScope = siteId;
    updateStatusBar(siteId);
    // Reveal only the coverage rings for the newly-active site; hide all
    // others. Rings default to show=false at creation. This gives the
    // "clean overview, detail on click" pattern — Palantir/Anduril feel.
    for (const ent of viewer.entities.values) {
      const t = ent.properties?.type?.getValue?.();
      if (t === 'sensor-coverage') {
        const ringSite = ent.properties.siteId.getValue();
        ent.show = (siteId != null && ringSite === siteId);
      }
    }
    if (!siteId) {
      overviewCard.style.display = 'none';
      return;
    }
    const site = SITES[siteId];
    if (!site) return;

    overviewCard.style.display = 'flex';
    overviewName.textContent = site.name;

    overviewStats.innerHTML = `
      <div class="stat">
        <div class="stat-v">${site.stats.sensorsOnline}<span class="stat-total">/${site.stats.sensorsTotal}</span></div>
        <div class="stat-k">Sensors Online</div>
      </div>
      <div class="stat">
        <div class="stat-v">${site.stats.flaggedEvents24h}</div>
        <div class="stat-k">Flagged (24h)</div>
      </div>
      <div class="stat">
        <div class="stat-v accent-hostile">${site.stats.hostileEvents24h}</div>
        <div class="stat-k">Hostile (24h)</div>
      </div>
    `;
  }

  // Compute per-site or all-sites sensor stats and update the bottom status bar.
  function updateStatusBar(siteId) {
    const sbSensors = document.getElementById('sb-sensors');
    const sbScope = document.getElementById('sb-site-scope');
    if (!sbSensors || !sbScope) return;
    let online = 0, degraded = 0, offline = 0, total = 0, scopeLabel = 'All sites';
    if (siteId && SITES[siteId]) {
      const site = SITES[siteId];
      site.sensors.forEach(s => {
        total++;
        if (s.status === 'online') online++;
        else if (s.status === 'degraded') degraded++;
        else if (s.status === 'offline') offline++;
      });
      scopeLabel = site.name;
    } else {
      Object.values(SITES).forEach(site => {
        site.sensors.forEach(s => {
          total++;
          if (s.status === 'online') online++;
          else if (s.status === 'degraded') degraded++;
          else if (s.status === 'offline') offline++;
        });
      });
    }
    const dotClass = offline > 0 ? 'err' : degraded > 0 ? 'warn' : 'ok';
    const parts = [`${online}/${total} online`];
    if (degraded) parts.push(`${degraded} degraded`);
    if (offline) parts.push(`${offline} offline`);
    sbSensors.innerHTML = `<span class="sb-dot ${dotClass}"></span>Sensors <b>${parts.join(' · ')}</b>`;
    sbScope.innerHTML = `Scope <b>${scopeLabel}</b>`;
  }

  overviewToggle.addEventListener('click', () => {
    overviewExpanded = !overviewExpanded;
    overviewCard.classList.toggle('collapsed', !overviewExpanded);
    overviewToggle.textContent = overviewExpanded ? '−' : '+';
  });

  // ══════════════════════════════════════════
  // FLY-TO
  // ══════════════════════════════════════════

  // Fly-to presets — for site targets, use flyToBoundingSphere so the camera
  // actually looks AT the site center instead of missing it.
  const FLY_TARGETS = {
    globe: {
      type: 'flyTo',
      destination: Cesium.Cartesian3.fromDegrees(11.0, 40.0, 12_000_000),
      orientation: { heading: 0.0, pitch: Cesium.Math.toRadians(-90), roll: 0.0 },
      duration: 2.0,
      siteId: null,
    },
    denmark: {
      type: 'flyTo',
      destination: Cesium.Cartesian3.fromDegrees(11.0, 55.0, 900_000),
      orientation: { heading: 0.0, pitch: Cesium.Math.toRadians(-55), roll: 0.0 },
      duration: 2.5,
      siteId: null,
    },
    cph: {
      type: 'site',
      siteId: 'cph',
      centerLon: 12.6350,
      centerLat: 55.6085,
      range: 7500,
      heading: 15,
      pitch: -45,
      duration: 3.0,
    },
    esbjerg: {
      type: 'site',
      siteId: 'esbjerg',
      centerLon: 8.4530,
      centerLat: 55.4645,
      range: 9500,
      heading: 20,
      pitch: -45,
      duration: 3.0,
    },
    // Energinet substations — tight zoom, small footprint (~300m)
    energinet_hovegaard: { type: 'site', siteId: 'energinet_hovegaard', centerLon: 12.23379, centerLat: 55.73231, range: 1400, heading: 0, pitch: -55, duration: 2.5 },
    energinet_bjaeverskov: { type: 'site', siteId: 'energinet_bjaeverskov', centerLon: 12.00729, centerLat: 55.45151, range: 1600, heading: 0, pitch: -55, duration: 2.5 },
    energinet_landerupgaard: { type: 'site', siteId: 'energinet_landerupgaard', centerLon: 9.54762, centerLat: 55.56398, range: 2200, heading: 0, pitch: -55, duration: 2.5 },
    energinet_kassoe: { type: 'site', siteId: 'energinet_kassoe', centerLon: 9.26960, centerLat: 55.03682, range: 1800, heading: 0, pitch: -55, duration: 2.5 },
    energinet_ferslev: { type: 'site', siteId: 'energinet_ferslev', centerLon: 9.87916, centerLat: 56.95650, range: 1200, heading: 0, pitch: -55, duration: 2.5 },
    energinet_amager_koblingsstation: { type: 'site', siteId: 'energinet_amager_koblingsstation', centerLon: 12.6088, centerLat: 55.6410, range: 1500, heading: 0, pitch: -55, duration: 2.5 },
  };

  function flyTo(key) {
    const t = FLY_TARGETS[key];
    if (!t) return;
    hideSensorPopup();
    setActiveSite(t.siteId);

    if (t.type === 'site') {
      // flyToBoundingSphere ensures the camera looks at the sphere center
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(t.centerLon, t.centerLat, 0),
          t.range * 0.6,
        ),
        {
          duration: t.duration,
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(t.heading),
            Cesium.Math.toRadians(t.pitch),
            t.range,
          ),
        },
      );
    } else {
      viewer.camera.flyTo({
        destination: t.destination,
        orientation: t.orientation,
        duration: t.duration,
      });
    }
  }

  // ── Initial view — Earth centered, straight down, whole planet visible ──
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(11.0, 25.0, 18_000_000),
    orientation: { heading: 0.0, pitch: Cesium.Math.toRadians(-90), roll: 0.0 },
  });
  applyImageryMode();
  // Re-assert only enableLighting (belt + braces). Do NOT reset the clock
  // here — applyImageryMode() sets clock per mode (summer noon for day,
  // November evening for night, real time for auto). An override here would
  // stomp day mode's clock and give the wrong sun position → dark day sky.
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  setActiveSite(null);

  // ── Wire up controls ──
  document.querySelectorAll('#control-panel .cp-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#control-panel .cp-btn[data-mode]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      imageryMode = btn.dataset.mode;
      applyImageryMode();
    });
  });
  const cpMasterToggle = document.getElementById('cp-master-toggle');
  if (cpMasterToggle) {
    cpMasterToggle.addEventListener('click', () => {
      const panel = document.getElementById('control-panel');
      const collapsed = panel.classList.toggle('collapsed');
      cpMasterToggle.textContent = collapsed ? '+' : '−';
      cpMasterToggle.title = collapsed ? 'Expand' : 'Collapse';
    });
  }
  document.querySelectorAll('.cp-collapse[data-cp-collapse]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = document.getElementById(btn.dataset.cpCollapse);
      if (!section) return;
      const collapsed = section.classList.toggle('collapsed');
      btn.textContent = collapsed ? '+' : '−';
    });
  });

  document.querySelectorAll('#control-panel .cp-btn[data-overlay]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.overlay;
      overlayState[key] = !overlayState[key];
      btn.classList.toggle('active', overlayState[key]);
      applyOverlayVisibility();
    });
  });
  document.querySelectorAll('#control-panel .cp-btn[data-fly]').forEach((btn) => {
    btn.addEventListener('click', () => flyTo(btn.dataset.fly));
  });
  // Fly-to expandable group toggle (e.g. Energinet → 5 substations)
  document.querySelectorAll('[data-fly-expand]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.flyExpand;
      const body = document.getElementById(`fly-group-${key}-body`);
      const caret = btn.querySelector('.fly-caret');
      if (!body) return;
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'flex';
      if (caret) caret.textContent = isOpen ? '▸' : '▾';
      btn.classList.toggle('expanded', !isOpen);
    });
  });
  // Threat simulator: site dropdown drives which threat set is available
  const simSelect = document.getElementById('sim-site-select');
  const simPanel = document.getElementById('sim-panel-active');
  const THREAT_MENU = {
    cph: [
      { key: 'cph_quad_hostile', label: 'Quadcopter, hostile' },
      { key: 'cph_fixedwing_hostile', label: 'Fixed wing, hostile' },
      { key: 'cph_recon_hostile', label: 'Reconnaissance drone (HALE), hostile', cls: 'recon' },
      { key: 'cph_jet_friendly', label: 'Jet (SAS 743), friendly', cls: 'friendly' },
      { key: 'cph_missile_hostile', label: 'Cruise missile, critical', cls: 'critical' },
      { key: 'cph_missile_inbound_sw', label: 'Cruise missile inbound from SW (continuation)', cls: 'critical' },
      { key: 'swarm_recon_cph_amk', label: 'SWARM · 5-drone recon (CPH → Amager)', cls: 'critical' },
      { key: 'cph_unknown_contact', label: 'Non-identifiable contact (N perimeter)', cls: 'recon' },
    ],
    esbjerg: [
      { key: 'esbjerg_quad_hostile', label: 'Quadcopter, hostile' },
      { key: 'esbjerg_usv_hostile', label: 'USV (surface drone), hostile' },
      { key: 'esbjerg_fixedwing_hostile', label: 'Fixed wing reconnaissance, hostile' },
      { key: 'esbjerg_missile_hostile', label: 'Cruise missile from sea, critical', cls: 'critical' },
    ],
  };
  // Auto-generate for Energinet sites (3 threats each)
  Object.keys(ENERGINET_SITES).forEach(sid => {
    THREAT_MENU[sid] = [
      { key: `${sid}_quad_hostile`, label: 'Quadcopter, hostile' },
      { key: `${sid}_fixedwing_hostile`, label: 'Fixed wing reconnaissance, hostile' },
      { key: `${sid}_missile_hostile`, label: 'Cruise missile, critical', cls: 'critical' },
    ];
  });
  // Two-tier scenario option — appears on Kassø as the origin site
  THREAT_MENU['energinet_kassoe'].push({
    key: 'cruise_missile_to_amalienborg',
    label: 'TWO-TIER · Cruise missile → Amalienborg',
    cls: 'critical',
  });
  function renderSimPanel() {
    if (!simSelect || !simPanel) return;
    const site = simSelect.value;
    const menu = THREAT_MENU[site] || [];
    simPanel.innerHTML = menu.map(t =>
      `<button class="cp-btn wide sim-btn ${t.cls || ''}" data-threat="${t.key}" data-site="${site}">${t.label}</button>`
    ).join('');
    simPanel.querySelectorAll('.sim-btn[data-threat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (anyTrackLive()) return;
        const key = btn.dataset.threat;
        const s = btn.dataset.site || 'cph';
        flyTo(s);
        setTimeout(() => window.__spawnDrone(key), 1500);
      });
    });
  }
  if (simSelect) {
    simSelect.addEventListener('change', renderSimPanel);
    renderSimPanel();
  }
  const cancelBtn = document.getElementById('cancel-threat');
  if (cancelBtn) cancelBtn.addEventListener('click', () => cancelActiveThreats());
  window.__updateSimButton();

  // ══════════════════════════════════════════
  // CONFIG MODAL, destination editor (Phase 1)
  // ══════════════════════════════════════════
  const configBackdrop = document.getElementById('config-modal');
  const configCard = document.getElementById('config-modal-card');
  let _configSiteId = 'cph';
  let _editingId = null; // null = list view, 'new' = add form, '<id>' = edit form

  function closeConfig() { configBackdrop.style.display = 'none'; _editingId = null; }

  function toast(msg, kind = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast toast-${kind}`;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 2600);
  }

  function renderConfig() {
    if (configBackdrop.style.display === 'none') return;
    const dests = destinationsForSite(_configSiteId);
    const byTier = dests.reduce((acc, d) => { (acc[d.tier] = acc[d.tier] || []).push(d); return acc; }, {});

    const editingDest = _editingId && _editingId !== 'new' ? getDestination(_editingId) : null;
    const formOpen = _editingId !== null;

    const tabHtml = Object.keys(SITES).map(sid => `
      <button class="cfg-tab ${sid === _configSiteId ? 'on' : ''}" data-site="${sid}">
        ${siteName(sid)}
      </button>`).join('');

    const listHtml = Object.keys(byTier).sort().map(tier => `
      <div class="cfg-tier">
        <div class="cfg-tier-hdr">Tier ${tier}</div>
        ${byTier[tier].map(d => `
          <div class="cfg-row">
            <div class="cfg-row-main">
              <div class="cfg-row-name">${d.name}</div>
              <div class="cfg-row-meta">${destinationTypeLabel(d.type)} · ${d.contactMethods.join(', ')} · <span class="esc-avail esc-avail-${d.availabilityStatus === 'on-shift' ? 'on' : d.availabilityStatus === 'off-hours' ? 'off' : 'idle'}">${d.availabilityStatus === 'on-shift' ? 'On shift' : d.availabilityStatus === 'off-hours' ? 'Off hours' : 'Standby'}</span></div>
            </div>
            <div class="cfg-row-actions">
              <button class="mini-btn" data-cfg="test" data-id="${d.id}">Test</button>
              <button class="mini-btn" data-cfg="edit" data-id="${d.id}">Edit</button>
              <button class="mini-btn danger" data-cfg="delete" data-id="${d.id}">Delete</button>
            </div>
          </div>`).join('')}
      </div>`).join('');

    const formHtml = formOpen ? (() => {
      const d = editingDest || { name:'', tier:1, type:'internal', contactMethods:['in-app'], availabilityStatus:'on-shift' };
      const isNew = _editingId === 'new';
      return `
        <div class="cfg-form">
          <div class="cfg-form-title">${isNew ? 'Add destination' : 'Edit destination'}</div>
          <label class="cfg-label">Name</label>
          <input class="cfg-input" id="cfg-name" value="${d.name.replace(/"/g,'&quot;')}" placeholder="e.g. CPH Airport Fire & Rescue" />
          <div class="cfg-2col">
            <div>
              <label class="cfg-label">Tier</label>
              <select class="cfg-input" id="cfg-tier">
                ${[1,2,3,4,5].map(t => `<option value="${t}" ${t===d.tier?'selected':''}>Tier ${t}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="cfg-label">Type</label>
              <select class="cfg-input" id="cfg-type">
                <option value="internal" ${d.type==='internal'?'selected':''}>Internal</option>
                <option value="agency" ${d.type==='agency'?'selected':''}>External Agency</option>
                <option value="system" ${d.type==='system'?'selected':''}>External System</option>
              </select>
            </div>
          </div>
          <label class="cfg-label">Contact methods</label>
          <div class="cfg-methods">
            ${['in-app','sms','phone','encrypted-email','webhook','mqtt','api'].map(m => `
              <label class="cfg-check"><input type="checkbox" name="cfg-method" value="${m}" ${d.contactMethods.includes(m)?'checked':''}/> ${m}</label>
            `).join('')}
          </div>
          <label class="cfg-label">Availability</label>
          <select class="cfg-input" id="cfg-avail">
            <option value="on-shift" ${d.availabilityStatus==='on-shift'?'selected':''}>On shift (24/7)</option>
            <option value="off-hours" ${d.availabilityStatus==='off-hours'?'selected':''}>Off hours (business only)</option>
            <option value="standby" ${d.availabilityStatus==='standby'?'selected':''}>Standby</option>
          </select>
          <div class="cfg-form-actions">
            <button class="btn" data-cfg="cancel-form">Cancel</button>
            <button class="btn primary" data-cfg="save-form">${isNew ? 'Add' : 'Save'}</button>
          </div>
        </div>`;
    })() : '';

    configCard.innerHTML = `
      <div class="modal-hdr">
        <div class="modal-title">Destinations Editor</div>
        <button class="modal-x" data-cfg="close">×</button>
      </div>
      <div class="cfg-tabs">${tabHtml}</div>
      <div class="cfg-body">
        <div class="cfg-list-hdr">
          <span>${dests.length} destinations for ${siteName(_configSiteId)}</span>
          <button class="btn primary" data-cfg="add">+ Add destination</button>
        </div>
        ${listHtml}
      </div>
      ${formHtml}
    `;

    configCard.querySelectorAll('[data-cfg]').forEach(el => {
      el.addEventListener('click', () => handleConfigAction(el.dataset.cfg, el.dataset.id));
    });
    configCard.querySelectorAll('.cfg-tab').forEach(tab => {
      tab.addEventListener('click', () => { _configSiteId = tab.dataset.site; _editingId = null; renderConfig(); });
    });
  }

  function handleConfigAction(action, id) {
    if (action === 'close') return closeConfig();
    if (action === 'add') { _editingId = 'new'; renderConfig(); return; }
    if (action === 'edit') { _editingId = id; renderConfig(); return; }
    if (action === 'cancel-form') { _editingId = null; renderConfig(); return; }
    if (action === 'delete') {
      const d = getDestination(id);
      if (!d) return;
      if (!confirm(`Delete destination "${d.name}"?`)) return;
      removeDestination(id);
      toast(`Deleted ${d.name}`, 'info');
      renderConfig();
      return;
    }
    if (action === 'test') {
      const d = getDestination(id);
      if (!d) return;
      // Mock test-send: pretend it went, ack after 1.5s
      toast(`Sending test to ${d.name} via ${d.contactMethods[0]}...`, 'info');
      setTimeout(() => toast(`✓ ${d.name} acknowledged test`, 'ok'), 1500);
      return;
    }
    if (action === 'save-form') {
      const name = document.getElementById('cfg-name').value.trim();
      if (!name) { toast('Name required', 'err'); return; }
      const tier = parseInt(document.getElementById('cfg-tier').value, 10);
      const type = document.getElementById('cfg-type').value;
      const availabilityStatus = document.getElementById('cfg-avail').value;
      const methods = [...configCard.querySelectorAll('input[name="cfg-method"]:checked')].map(i => i.value);
      if (!methods.length) { toast('At least one contact method required', 'err'); return; }
      const payload = { name, tier, type, contactMethods: methods, availabilityStatus, siteId: _configSiteId };
      if (_editingId === 'new') {
        addDestination(payload);
        toast(`Added ${name}`, 'ok');
        _editingId = null;
      } else {
        updateDestination(_editingId, payload);
        toast(`Updated ${name}`, 'ok');
        _editingId = null;
      }
      renderConfig();
      return;
    }
  }

  window.__openConfigModal = () => {
    configBackdrop.style.display = 'flex';
    renderConfig();
  };

  // ── Rules modal (auto-escalation rules editor) ──
  const rulesBackdrop = document.getElementById('rules-modal');
  const rulesCard = document.getElementById('rules-modal-card');
  let _editingRuleId = null;

  function closeRules() { rulesBackdrop.style.display = 'none'; _editingRuleId = null; }

  function renderRules() {
    if (rulesBackdrop.style.display === 'none') return;
    const rules = getRules();
    const editing = _editingRuleId ? rules.find(r => r.id === _editingRuleId) : null;
    const isNew = _editingRuleId === 'new';
    const form = (_editingRuleId !== null) ? (() => {
      const r = editing || { name:'', siteId:'all', enabled:true, when:{}, then:{ escalateToTiers:[1], payload:'summary', message:'', delaySec:0 } };
      return `
        <div class="rules-form">
          <div class="rules-form-title">${isNew ? 'Add rule' : 'Edit rule'}</div>
          <label class="cfg-label">Rule name</label>
          <input class="cfg-input" id="rule-name" value="${(r.name || '').replace(/"/g,'&quot;')}" placeholder="e.g. Hostile quad in inner perimeter → notify Politi" />
          <div class="cfg-2col">
            <div>
              <label class="cfg-label">Site scope</label>
              <select class="cfg-input" id="rule-site">
                <option value="all" ${r.siteId==='all'?'selected':''}>All sites</option>
                <option value="cph" ${r.siteId==='cph'?'selected':''}>CPH Airport only</option>
                <option value="esbjerg" ${r.siteId==='esbjerg'?'selected':''}>Esbjerg Harbour only</option>
              </select>
            </div>
            <div>
              <label class="cfg-label">Enabled</label>
              <select class="cfg-input" id="rule-enabled">
                <option value="true"  ${r.enabled?'selected':''}>Yes, active</option>
                <option value="false" ${!r.enabled?'selected':''}>No, disabled</option>
              </select>
            </div>
          </div>
          <div class="rules-form-hdr">When ALL of these match:</div>
          <div class="cfg-2col">
            <div>
              <label class="cfg-label">Platform</label>
              <select class="cfg-input" id="rule-platform">
                <option value="" ${!r.when.platform?'selected':''}>Any</option>
                <option value="quadcopter"  ${r.when.platform==='quadcopter'?'selected':''}>Quadcopter</option>
                <option value="fixed-wing"  ${r.when.platform==='fixed-wing'?'selected':''}>Fixed wing</option>
                <option value="jet"         ${r.when.platform==='jet'?'selected':''}>Jet</option>
                <option value="missile"     ${r.when.platform==='missile'?'selected':''}>Missile</option>
              </select>
            </div>
            <div>
              <label class="cfg-label">Classification</label>
              <select class="cfg-input" id="rule-cls">
                <option value="" ${!r.when.classification?'selected':''}>Any</option>
                <option value="hostile"  ${r.when.classification==='hostile'?'selected':''}>Hostile</option>
                <option value="friendly" ${r.when.classification==='friendly'?'selected':''}>Friendly</option>
                <option value="unknown"  ${r.when.classification==='unknown'?'selected':''}>Unknown</option>
              </select>
            </div>
            <div>
              <label class="cfg-label">Threat level</label>
              <select class="cfg-input" id="rule-threat">
                <option value="" ${!r.when.threat?'selected':''}>Any</option>
                <option value="high"   ${r.when.threat==='high'?'selected':''}>High</option>
                <option value="medium" ${r.when.threat==='medium'?'selected':''}>Medium</option>
                <option value="low"    ${r.when.threat==='low'?'selected':''}>Low</option>
              </select>
            </div>
            <div>
              <label class="cfg-label">Min. confidence</label>
              <input class="cfg-input" id="rule-conf" type="number" step="0.05" min="0" max="1" value="${r.when.minConfidence != null ? r.when.minConfidence : ''}" placeholder="0.75" />
            </div>
          </div>
          <div class="rules-form-hdr">Then dispatch:</div>
          <label class="cfg-label">Tier(s) to escalate to</label>
          <div class="rules-tier-checks">
            ${[1,2,3,4,5].map(t => `
              <label class="cfg-check"><input type="checkbox" name="rule-tier" value="${t}" ${r.then.escalateToTiers.includes(t)?'checked':''}/> Tier ${t}</label>
            `).join('')}
          </div>
          <div class="cfg-2col">
            <div>
              <label class="cfg-label">Payload</label>
              <select class="cfg-input" id="rule-payload">
                <option value="summary"   ${r.then.payload==='summary'?'selected':''}>Detection Brief (PDF)</option>
                <option value="full"      ${r.then.payload==='full'?'selected':''}>Full evidence pack (ZIP)</option>
                <option value="live-link" ${r.then.payload==='live-link'?'selected':''}>Live view link</option>
              </select>
            </div>
            <div>
              <label class="cfg-label">Delay before firing (seconds)</label>
              <input class="cfg-input" id="rule-delay" type="number" min="0" step="5" value="${r.then.delaySec || 0}" />
            </div>
          </div>
          <label class="cfg-label">Message sent with dispatch (optional)</label>
          <textarea class="cfg-input" id="rule-msg" rows="2" placeholder="e.g. Auto-dispatched by rule: confirmed threat.">${r.then.message || ''}</textarea>
          <div class="cfg-form-actions">
            <button class="btn" data-rules="cancel-form">Cancel</button>
            <button class="btn primary" data-rules="save-form">${isNew ? 'Add rule' : 'Save changes'}</button>
          </div>
        </div>`;
    })() : '';

    rulesCard.innerHTML = `
      <div class="modal-hdr">
        <div class="modal-title">Auto-Escalation Rules</div>
        <button class="modal-x" data-rules="close">×</button>
      </div>
      <div class="cfg-body">
        <div class="cfg-list-hdr">
          <span>${rules.length} rules · ${rules.filter(r => r.enabled).length} active</span>
          <div style="display:flex; gap:6px;">
            <button class="btn" data-rules="reset">Reset to defaults</button>
            <button class="btn primary" data-rules="add">+ Add rule</button>
          </div>
        </div>
        ${rules.map(r => `
          <div class="rules-row ${r.enabled ? '' : 'is-disabled'}">
            <label class="rules-toggle">
              <input type="checkbox" data-rules="toggle" data-id="${r.id}" ${r.enabled ? 'checked' : ''}/>
            </label>
            <div class="rules-row-body">
              <div class="rules-row-name">${r.name}</div>
              <div class="rules-row-summary">${ruleSummaryText(r)}</div>
              <div class="rules-row-scope">Scope: ${r.siteId === 'all' ? 'All sites' : siteName(r.siteId)}</div>
            </div>
            <div class="rules-row-actions">
              <button class="mini-btn" data-rules="edit" data-id="${r.id}">Edit</button>
              <button class="mini-btn danger" data-rules="delete" data-id="${r.id}">Delete</button>
            </div>
          </div>`).join('')}
      </div>
      ${form}
    `;

    rulesCard.querySelectorAll('[data-rules]').forEach(el => {
      el.addEventListener('click', () => {
        const a = el.dataset.rules;
        const id = el.dataset.id;
        if (a === 'close') return closeRules();
        if (a === 'add') { _editingRuleId = 'new'; renderRules(); return; }
        if (a === 'edit') { _editingRuleId = id; renderRules(); return; }
        if (a === 'cancel-form') { _editingRuleId = null; renderRules(); return; }
        if (a === 'reset') { if (!confirm('Reset all rules to defaults? Your custom rules will be removed.')) return; resetRulesToDefault(); toast('Rules reset to defaults', 'info'); return; }
        if (a === 'delete') {
          const rule = getRules().find(r => r.id === id);
          if (!rule) return;
          if (!confirm(`Delete rule "${rule.name}"?`)) return;
          removeRule(id); toast('Rule deleted', 'info'); return;
        }
        if (a === 'toggle') { toggleRule(id); return; }
        if (a === 'save-form') {
          const name = document.getElementById('rule-name').value.trim();
          if (!name) { toast('Rule name required', 'err'); return; }
          const tiers = [...rulesCard.querySelectorAll('input[name="rule-tier"]:checked')].map(i => parseInt(i.value, 10));
          if (!tiers.length) { toast('At least one tier required', 'err'); return; }
          const rule = {
            id: (_editingRuleId === 'new') ? undefined : _editingRuleId,
            name,
            siteId: document.getElementById('rule-site').value,
            enabled: document.getElementById('rule-enabled').value === 'true',
            when: {
              platform: document.getElementById('rule-platform').value || undefined,
              classification: document.getElementById('rule-cls').value || undefined,
              threat: document.getElementById('rule-threat').value || undefined,
              minConfidence: parseFloat(document.getElementById('rule-conf').value) || undefined,
            },
            then: {
              escalateToTiers: tiers,
              payload: document.getElementById('rule-payload').value,
              delaySec: parseInt(document.getElementById('rule-delay').value, 10) || 0,
              message: document.getElementById('rule-msg').value.trim(),
            },
          };
          upsertRule(rule);
          toast(_editingRuleId === 'new' ? `Added rule: ${name}` : `Updated rule: ${name}`, 'ok');
          _editingRuleId = null;
          renderRules();
        }
      });
    });
  }

  window.__openRulesModal = () => {
    rulesBackdrop.style.display = 'flex';
    renderRules();
  };
  rulesBackdrop.addEventListener('click', (e) => { if (e.target === rulesBackdrop) closeRules(); });
  onRulesChange(() => { if (rulesBackdrop.style.display !== 'none') renderRules(); });

  configBackdrop.addEventListener('click', (e) => { if (e.target === configBackdrop) closeConfig(); });
  onDestinationsChange(() => { if (configBackdrop.style.display !== 'none') renderConfig(); });
  window.__resetDestinations = () => { resetDestinationsToDefault(); location.reload(); };

  // ══════════════════════════════════════════
  // EVENT LEDGER (left panel) + DETAIL PANEL (right panel)
  // ══════════════════════════════════════════

  const alertListEl = document.getElementById('alert-list');
  const alertCountEl = document.getElementById('alert-count');
  const alertFiltersEl = document.getElementById('alert-filters');
  const detailEmptyEl = document.getElementById('detail-empty');
  const detailBodyEl = document.getElementById('detail-body');

  const classLabel = (e) => {
    if (e.classification === 'hostile')  return `Hostile · ${e.threat === 'high' ? 'High' : e.threat === 'medium' ? 'Med' : 'Low'}`;
    if (e.classification === 'friendly') return 'Friendly ID';
    if (e.classification === 'resolved') return 'Resolved · False+';
    return 'Unknown';
  };

  function renderAlertStrip() {
    const events = filteredEvents();
    const selectedId = getSelectedEventId();
    alertCountEl.textContent = String(events.length).padStart(2, '0');

    alertListEl.innerHTML = events.map(e => {
      const isSel = e.id === selectedId ? 'selected' : '';
      const isActive = e.status === 'active';
      const activeBadge = isActive ? '<span class="alert-live">● LIVE</span>' : '';
      const escBadge = (e.escalations && e.escalations.length) ? `<span class="alert-esc">ESCALATED · ${e.escalations.length}</span>` : '';
      // Response-received chip — surfaces when any receiver has replied
      // to at least one of this event's escalations. Persistent visual
      // cue on the ledger card so the operator sees inbound responses
      // without having to open the detail panel.
      const respCount = (e.escalations || []).filter(esc => esc.response && esc.response.text).length;
      const respBadge = respCount > 0 ? `<span class="alert-resp" title="${respCount} response${respCount === 1 ? '' : 's'} received">↩ ${respCount}</span>` : '';
      const timeStr = isActive ? 'now' : relativeTime(e.startTime);
      const rangeLine = isActive && e.lastPosition
        ? `<div class="alert-line"><span>Range</span><b>${e.lastPosition.rangeToPerim} m</b></div>`
        : `<div class="alert-line"><span>Duration</span><b>${formatDuration(e.duration)}</b></div>`;
      // Operator alert card actions. Acknowledge is a RECEIVER action
      // (confirming they received the brief), not an operator one — the
      // operator's action set is Escalate + Reclassify + Note, all wired
      // in the detail panel. Non-functional Acknowledge stub removed.
      const actions = isActive
        ? `<div class="alert-actions"><button class="mini-btn danger" data-action="escalate">Escalate</button></div>`
        : '';
      return `
        <div class="alert-card ${e.classification} ${isSel} ${isActive ? 'is-active' : ''}" data-event-id="${e.id}">
          <div class="alert-stripe"></div>
          <div class="alert-head">
            <span class="alert-class">${classLabel(e)} ${activeBadge}</span>
            <span class="alert-conf">${e.confidence.toFixed(2)}</span>
          </div>
          <div class="alert-id">${e.id} ${escBadge} ${respBadge}</div>
          <div class="alert-line"><span>Site</span><b>${siteName(e.siteId)}</b></div>
          <div class="alert-line"><span>Drone</span><b>${e.droneType}</b></div>
          ${rangeLine}
          <div class="alert-line"><span>${isActive ? 'Started' : 'When'}</span><b>${timeStr}</b></div>
          ${actions}
        </div>
      `;
    }).join('');

    alertListEl.querySelectorAll('.alert-card').forEach(card => {
      card.addEventListener('click', () => selectEvent(card.dataset.eventId));
    });
  }

  // Target selection state, orthogonal to event selection.
  // When a target is picked, the detail panel shows target info instead of the empty state.
  let _selectedTargetId = null;

  // Detail-panel back-navigation stack. Populated when the user clicks a
  // linked-event chip in the panel (so we remember where they came from).
  // Back button pops the top and re-selects that event. History persists
  // across other selection changes so a user who navigates away can still
  // trace back through their linked-event chain.
  const _eventNavHistory = [];
  function selectTarget(targetId) {
    _selectedTargetId = targetId;
    selectEvent(null);   // clear event selection so panel shows target info
    renderDetailPanel();
  }

  function renderTargetInPanel(t) {
    const color = TARGET_COLORS[t.kind] || '#4dd2ff';
    const kindLabel = TARGET_KIND_LABEL[t.kind] || t.kind;
    detailEmptyEl.style.display = 'none';
    detailBodyEl.style.display = 'block';
    detailBodyEl.innerHTML = `
      <div class="dp-hdr">
        <div class="dp-id">TARGET · ${t.id.toUpperCase()}</div>
        <div class="dp-class">
          <span class="dp-class-dot" style="background:${color};box-shadow:0 0 10px ${color}80;"></span>
          <span class="dp-class-txt" style="color:${color};">${kindLabel}</span>
        </div>
        <div class="dp-drone">${t.name}</div>
        <div class="dp-times"><span>${t.subtitle}</span></div>
      </div>

      <div class="dp-section">
        <div class="dp-section-title">Coverage Status</div>
        <div class="dp-note">
          Not a sensor site. ISR does not have detection hardware installed here.
          Coverage of this asset is provided indirectly via trajectory prediction from
          nearby sensor meshes (e.g. CPH Airport). If a track from a sensor site
          is predicted to enter this asset's protection zone, alerts fire automatically.
        </div>
      </div>

      <div class="dp-section">
        <div class="dp-section-title">Location</div>
        <div class="kv-grid">
          <div class="kv"><div class="kv-k">Latitude</div><div class="kv-v">${t.lat.toFixed(4)}°N</div></div>
          <div class="kv"><div class="kv-k">Longitude</div><div class="kv-v">${t.lon.toFixed(4)}°E</div></div>
          <div class="kv"><div class="kv-k">Category</div><div class="kv-v">${kindLabel}</div></div>
        </div>
      </div>

      <div class="dp-section">
        <div class="dp-section-title">Response Model</div>
        <div class="dp-note">
          ISR provides detection and intelligence only. If a threat is flagged against this target,
          the platform notifies the responsible authorities (Politi, Forsvaret, PET) who then decide
          and execute the response. ISR does not operate any kinetic or countermeasure system.
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════
  // P9 · Palantir-style closed-event panel
  // ───────────────────────────────────────────────────────────────────
  // For CLOSED (past) incidents. Replaces the dense telemetry stack
  // with a summary + severity chip + four collapsible sections. Active
  // events keep their live dense layout since operators need every field
  // visible during response.
  // ═══════════════════════════════════════════════════════════════════
  // Per-event section toggle state for the Palantir closed panel.
  // Map key "eventId::sectionKey" → true (user opened) | false (user closed).
  // Absence of a key means "use the section's defaultOpen setting".
  // Explicit user actions always override defaults, so a Details section
  // marked defaultOpen actually closes when the user clicks its caret.
  const _plToggled = new Map();
  function _isPlOpen(eventId, key, defaultOpen) {
    const k = `${eventId}::${key}`;
    if (_plToggled.has(k)) return _plToggled.get(k);
    return !!defaultOpen;
  }

  function _relativeTimeShort(iso) {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '—';
    const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    const mRem = min % 60;
    if (hr < 24) return mRem ? `${hr}h ${mRem}m ago` : `${hr}h ago`;
    const day = Math.floor(hr / 24);
    const hRem = hr % 24;
    return hRem ? `${day}d ${hRem}h ago` : `${day}d ago`;
  }

  function _severityForEvent(e) {
    // Muted severity mapping. Colours defined in CSS as .pl-sev-{key}.
    if (e.classification === 'hostile' && e.threat === 'high') return { key: 'critical', label: 'CRITICAL' };
    if (e.classification === 'hostile' && e.threat === 'medium') return { key: 'high', label: 'HIGH' };
    if (e.classification === 'hostile' && e.threat === 'low') return { key: 'medium', label: 'MEDIUM' };
    if (e.classification === 'friendly') return { key: 'resolved', label: 'FRIENDLY' };
    if (e.classification === 'unknown') return { key: 'pending', label: 'PENDING' };
    if (e.classification === 'resolved') return { key: 'closed', label: 'RESOLVED' };
    return { key: 'pending', label: 'UNCLASSIFIED' };
  }

  // Deterministic title + 2-line narrative from event data. Reads like
  // Agent A output. Replaced by Mistral post-demo (same input, dynamic
  // generation). Never uses semicolons, em-dashes, or bullet symbols.
  function _generateClosedEventSummary(e) {
    const siteN = siteName(e.siteId);
    const template = TEMPLATES[e.templateKey];
    const isSwarm = !!template?.swarm;
    const swarmSize = template?.swarm?.size || 0;
    const linkedCount = e.linkedEventIds?.length || 0;
    const outcome = e.outcome;

    let title;
    if (isSwarm) {
      title = `${swarmSize}-drone formation over ${siteN}`;
    } else if (e.platform === 'missile') {
      title = `Cruise missile trajectory inbound ${siteN}`;
    } else if (e.platform === 'non-identifiable') {
      title = `Non-identifiable contact at ${siteN}`;
    } else if (e.platform === 'fixed-wing') {
      title = `Fixed-wing reconnaissance over ${siteN}`;
    } else if (e.platform === 'jet') {
      title = `Jet aircraft ${siteN}`;
    } else {
      title = `${(e.droneType || 'Airborne contact')} at ${siteN}`;
    }

    const linkedPhrase = linkedCount
      ? ` Cross-linked to ${linkedCount} related event${linkedCount === 1 ? '' : 's'}${e.correlationScore ? ` at ${Math.round(e.correlationScore * 100)}% signature match` : ''}.`
      : '';
    const outcomePhrase = outcome === 'neutralized'
      ? ' Target neutralised by fighter response.'
      : (e.classification === 'friendly' ? ' Non-threat confirmed and logged.' : '');

    let core;
    if (isSwarm) {
      core = `Coordinated formation observed on E-W transit across sensor coverage.${linkedPhrase}${outcomePhrase}`;
    } else if (e.platform === 'missile') {
      core = `Passive detection on inbound trajectory. Fighter dispatch executed under Mach 0.8 doctrine.${outcomePhrase}`;
    } else if (e.platform === 'non-identifiable') {
      core = `RF energy detected without signature lock. Analyst review pending on platform identification.${linkedPhrase}`;
    } else {
      const evNote = e.evidence?.note || '';
      const short = evNote ? evNote.split(/\.\s+/)[0] + '.' : `Track observed across ${siteN} sensor coverage.`;
      core = `${short}${linkedPhrase}${outcomePhrase}`;
    }

    return { title, summary: core };
  }

  function renderPalantirClosedPanel(e) {
    const sev = _severityForEvent(e);
    const { title, summary } = _generateClosedEventSummary(e);
    const createdRel = _relativeTimeShort(e.startTime);
    const durLabel = formatDuration(e.duration);

    // Section content builders
    const insight = _generateAgentBNarrative(e);
    const recording = window.__isr_getRecording?.(e.id);
    const hasRecording = !!(recording?.timeseries?.length);
    const isNeutralised = e.outcome === 'neutralized';

    // Timeline: notes + startTime + endTime, chronological
    const timelineItems = [];
    timelineItems.push({ ts: e.startTime, kind: 'spawn', text: 'Event opened' });
    (e.notes || []).forEach(n => timelineItems.push({ ts: n.timestamp, kind: n.type || 'note', text: `${n.author}: ${n.text}` }));
    if (e.endTime) timelineItems.push({ ts: e.endTime, kind: 'close', text: 'Event closed' });
    timelineItems.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    // Intelligence content
    const sensors = (e.contributingSensors || []).filter(s => !s.offline).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const topSensors = sensors.slice(0, 6);
    const linkedIds = e.linkedEventIds || [];

    const sec = (key, label, body, defaultOpen = false) => {
      const openSelf = _isPlOpen(e.id, key, defaultOpen);
      return `
        <div class="pl-section ${openSelf ? 'expanded' : ''}" data-pl-section="${key}" data-event-id="${e.id}">
          <button class="pl-section-header" data-pl-toggle="${key}" data-event-id="${e.id}" data-default-open="${defaultOpen ? '1' : '0'}">
            <span class="pl-caret">${openSelf ? '▾' : '▸'}</span>
            <span class="pl-section-title">${label}</span>
          </button>
          <div class="pl-section-body" style="${openSelf ? '' : 'display:none;'}">${body}</div>
        </div>`;
    };

    const detailsBody = `
      <div class="pl-kv">
        <div class="pl-k">Analysis</div>
        <div class="pl-v">${insight?.pattern || 'Analysis unavailable for this event.'}</div>
      </div>
      ${insight ? `<div class="pl-kv">
        <div class="pl-k">Confidence</div>
        <div class="pl-v"><span class="pl-conf pl-conf-${insight.confidence.toLowerCase()}">${insight.confidence}</span></div>
      </div>` : ''}
      ${insight?.dwellRanked?.length ? `<div class="pl-kv">
        <div class="pl-k">Dwell zones</div>
        <div class="pl-v">${insight.dwellRanked.slice(0, 3).map(d => `<div class="pl-inline-row"><span>${d.name}</span><span class="pl-mono">${d.pct}%</span></div>`).join('')}</div>
      </div>` : ''}
      <div class="pl-kv">
        <div class="pl-k">Site</div>
        <div class="pl-v">${siteName(e.siteId)}</div>
      </div>
      <div class="pl-kv">
        <div class="pl-k">Duration</div>
        <div class="pl-v">${durLabel}</div>
      </div>
      ${isNeutralised ? `<div class="pl-kv">
        <div class="pl-k">Outcome</div>
        <div class="pl-v">Neutralised by ${e.neutralizedBy || 'Fighter Response'} at ${(e.neutralizedAt || '').slice(11, 19)}Z</div>
      </div>` : ''}
      ${timelineItems.length ? `<div class="pl-subsection">
        <div class="pl-subsection-title">Timeline</div>
        ${timelineItems.map(t => `<div class="pl-timeline-row"><span class="pl-timeline-time pl-mono">${(t.ts || '').slice(11, 19)}Z</span><span class="pl-timeline-kind pl-kind-${t.kind}">${t.kind}</span><span class="pl-timeline-text">${t.text}</span></div>`).join('')}
      </div>` : ''}
      ${isNeutralised ? `<div class="pl-subsection">
        <div class="pl-subsection-title">Post-incident report</div>
        <button class="pl-inline-btn" data-action="pl-open-pdf" data-id="${e.id}">Open PDF report</button>
      </div>` : ''}
      ${hasRecording ? `<div class="pl-subsection">
        <div class="pl-subsection-title">Trajectory legend</div>
        <div class="pl-legend">
          <span class="pl-legend-swatch" style="background:#ff5a5a"></span><span class="pl-legend-lbl">Weak &lt; 0.50</span>
          <span class="pl-legend-swatch" style="background:#ff8c3d"></span><span class="pl-legend-lbl">Moderate 0.50 to 0.70</span>
          <span class="pl-legend-swatch" style="background:#a3e635"></span><span class="pl-legend-lbl">Strong 0.70 to 0.85</span>
          <span class="pl-legend-swatch" style="background:#4dff9c"></span><span class="pl-legend-lbl">High ≥ 0.85</span>
        </div>
        <div class="pl-legend-style-note">
          <span class="pl-legend-line pl-legend-line-solid"></span>
          <span class="pl-legend-lbl">Solid: sensor-confirmed</span>
          <span class="pl-legend-line pl-legend-line-dashed"></span>
          <span class="pl-legend-lbl">Dashed: projected / pre-detection</span>
        </div>
        <div class="pl-legend-note">Trajectory colour = detection confidence at each sample. Solid lines are where a sensor confirmed the drone; dashed lines are reconstructed from context (sensors did not see the drone at that moment).</div>
      </div>` : ''}
    `;

    const intelligenceBody = `
      ${e.evidence?.rfCarrier ? `<div class="pl-kv">
        <div class="pl-k">RF fingerprint</div>
        <div class="pl-v">
          <div class="pl-inline-row"><span>Carrier</span><span class="pl-mono">${e.evidence.rfCarrier}</span></div>
          ${e.evidence.rfBandwidth ? `<div class="pl-inline-row"><span>Bandwidth</span><span class="pl-mono">${e.evidence.rfBandwidth}</span></div>` : ''}
          ${e.evidence.rfMatch ? `<div class="pl-inline-row"><span>Match</span><span class="pl-mono">${e.evidence.rfMatch}</span></div>` : ''}
          ${e.evidence.modality ? `<div class="pl-inline-row"><span>Modality</span><span class="pl-mono">${e.evidence.modality}</span></div>` : ''}
        </div>
      </div>` : ''}
      ${topSensors.length ? `<div class="pl-kv">
        <div class="pl-k">Contributing sensors</div>
        <div class="pl-v">
          ${topSensors.map(s => `<div class="pl-inline-row"><span class="pl-mono">${s.id}</span><span class="pl-mono">${Math.round((s.confidence || 0) * 100)}%</span></div>`).join('')}
          ${sensors.length > topSensors.length ? `<div class="pl-inline-row pl-dim"><span>+ ${sensors.length - topSensors.length} more</span></div>` : ''}
        </div>
      </div>` : ''}
      ${linkedIds.length ? `<div class="pl-kv">
        <div class="pl-k">Linked events</div>
        <div class="pl-v">
          ${linkedIds.map(lid => {
            const le = getEvent(lid);
            return `<div class="pl-inline-row pl-linked" data-linked-id="${lid}"><span class="pl-mono">${lid}</span><span>${le ? siteName(le.siteId) : 'unavailable'}</span></div>`;
          }).join('')}
          ${e.correlationScore ? `<div class="pl-inline-row pl-dim"><span>Composite similarity</span><span class="pl-mono">${Math.round(e.correlationScore * 100)}%</span></div>` : ''}
        </div>
      </div>` : ''}
      ${insight?.flags?.length ? `<div class="pl-kv">
        <div class="pl-k">Pattern flags</div>
        <div class="pl-v">${insight.flags.map(f => `<div class="pl-flag">${f}</div>`).join('')}</div>
      </div>` : ''}
      ${!e.evidence?.rfCarrier && !topSensors.length && !linkedIds.length ? `<div class="pl-empty">No intelligence available for this event.</div>` : ''}
    `;

    // Debrief-eligible if we have EITHER a recording (own or linked) OR a
    // template with waypoints — matches _debriefResolveSamples() fallback.
    const linkedPrimaryId = e.linkedEventId || e.shadowOfEventId;
    const hasDebriefData = hasRecording
      || !!(linkedPrimaryId && window.__isr_getRecording?.(linkedPrimaryId))
      || !!(TEMPLATES[e.templateKey]?.waypoints?.length);

    // Situation Activity CTAs - centered, subtle, no bullet symbols
    const activityBody = `
      <div class="pl-cta-grid">
        ${hasDebriefData ? `<button class="pl-cta" data-action="debrief" data-id="${e.id}">Debrief on map</button>` : ''}
        ${hasRecording ? `<button class="pl-cta" data-action="replay" data-id="${e.id}">Replay flight</button>` : ''}
        <button class="pl-cta" data-action="escalate">Escalate response</button>
        <button class="pl-cta" data-action="runbook">Response playbook</button>
        <button class="pl-cta" data-action="reclassify">Reclassify</button>
        <button class="pl-cta" data-action="note">Add note</button>
        ${isNeutralised ? `
        <button class="pl-cta pl-cta-secondary" data-pir="dispatch-vera">Dispatch to Verá</button>
        <button class="pl-cta pl-cta-secondary" data-pir="cordon">Cordon area</button>` : ''}
      </div>
    `;

    // Downloads
    const downloadBody = `
      <div class="pl-cta-grid">
        <button class="pl-cta" data-action="download-evidence" data-id="${e.id}">Evidence JSON</button>
        <button class="pl-cta" data-action="download-evidence-csv" data-id="${e.id}">Evidence CSV</button>
        ${isNeutralised ? `<button class="pl-cta" data-pir="pdf-report">Full PDF report</button>` : ''}
      </div>
    `;

    const backBtnHtml = _eventNavHistory.length > 0
      ? `<button class="pl-back-btn" id="pl-back-btn" title="Back to previous event">← Back</button>`
      : '';
    const exitBtnHtml = `<button class="pl-exit-btn" id="pl-exit-btn" title="Clear event view">Exit event</button>`;
    detailBodyEl.innerHTML = `
      <div class="pl-panel">
        <div class="pl-header">
          <div class="pl-header-nav">
            ${backBtnHtml}
            ${exitBtnHtml}
          </div>
          <div class="pl-title">${title}</div>
          <div class="pl-eid pl-mono">${e.id}</div>
          <div class="pl-summary">${summary}</div>
          <div class="pl-chips">
            <div class="pl-chip pl-chip-time">
              <div class="pl-chip-label">Created</div>
              <div class="pl-chip-value pl-mono">${createdRel}</div>
            </div>
            <div class="pl-chip pl-sev pl-sev-${sev.key}">
              <div class="pl-chip-label">Severity</div>
              <div class="pl-chip-value">${sev.label}</div>
            </div>
          </div>
        </div>
        ${sec('details', 'Details', detailsBody, true)}
        ${sec('intelligence', 'Intelligence', intelligenceBody)}
        ${sec('activity', 'Possible situation activity', activityBody)}
        ${sec('download', 'Download data', downloadBody)}
        <!-- Reclassify + Add Note forms render into this slot. Empty until
             a form is opened; refilled by openReclassifyForm / openNoteForm.
             Without this element, those CTAs silently no-op'd. -->
        <div id="dp-actions-area" class="pl-form-slot"></div>
      </div>
    `;

    // Section toggle handlers — flip the explicit toggle state so user
    // action always overrides the section's defaultOpen setting.
    detailBodyEl.querySelectorAll('[data-pl-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.plToggle;
        const evId = btn.dataset.eventId;
        const defaultOpen = btn.dataset.defaultOpen === '1';
        const currentlyOpen = _isPlOpen(evId, key, defaultOpen);
        _plToggled.set(`${evId}::${key}`, !currentlyOpen);
        renderPalantirClosedPanel(e);
      });
    });

    // Reuse the existing action handlers (same data-action names as legacy panel)
    detailBodyEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        // Release focus so browser's :focus ring doesn't linger on the
        // button after click, making it look "stuck pressed" (Lucas: the
        // debrief button stayed visually clicked after exit).
        btn.blur();
        const a = btn.dataset.action;
        if (a === 'reclassify') openReclassifyForm(e.id);
        else if (a === 'note') openNoteForm(e.id);
        else if (a === 'escalate') openEscalateModal(e.id);
        else if (a === 'runbook') openRunbookDrawer(e.id);
        else if (a === 'replay') startReplay(btn.dataset.id || e.id);
        else if (a === 'debrief') startDebrief(btn.dataset.id || e.id);
        else if (a === 'download-evidence') {
          const rec = window.__isr_getRecording(btn.dataset.id || e.id);
          if (!rec) return toast('No trajectory recording available.', 'info');
          window.__isr_downloadRecording(btn.dataset.id || e.id);
          toast(`JSON evidence downloaded (${rec.timeseries.length} samples)`, 'ok');
        }
        else if (a === 'download-evidence-csv') {
          const rec = window.__isr_getRecording(btn.dataset.id || e.id);
          if (!rec) return toast('No trajectory recording available.', 'info');
          window.__isr_downloadRecordingCSV(btn.dataset.id || e.id);
          toast(`CSV evidence downloaded (${rec.timeseries.length} rows)`, 'ok');
        }
        else if (a === 'pl-open-pdf') generatePirReport(e.id);
      });
    });
    detailBodyEl.querySelectorAll('[data-pir]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pir = btn.dataset.pir;
        if (pir === 'dispatch-vera') dispatchPostIncidentAction(e.id, 'vera');
        else if (pir === 'cordon') dispatchPostIncidentAction(e.id, 'cordon');
        else if (pir === 'beredskab-mass') dispatchPostIncidentAction(e.id, 'beredskab-mass');
        else if (pir === 'pdf-report') generatePirReport(e.id);
      });
    });
    // Linked event chip navigation — push current event onto nav history
    // so the pivoted event's Back button can return here.
    detailBodyEl.querySelectorAll('[data-linked-id]').forEach(row => {
      row.addEventListener('click', () => {
        const lid = row.dataset.linkedId;
        if (lid && getEvent(lid) && lid !== e.id) {
          _eventNavHistory.push(e.id);
          selectEvent(lid);
        }
      });
    });
    // Back button — pop nav stack and re-select previous event.
    const backBtn = document.getElementById('pl-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        backBtn.blur();
        const prevId = _eventNavHistory.pop();
        if (prevId && getEvent(prevId)) selectEvent(prevId);
      });
    }
    // Exit event button — clear selection so the detail panel + on-map
    // ENTRY/EXIT/OUT-OF-RANGE markers all go away, freeing the operator
    // to continue using the platform without a page reload.
    const exitBtn = document.getElementById('pl-exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        exitBtn.blur();
        _eventNavHistory.length = 0;
        selectEvent(null);
      });
    }
  }

  // Tick-driven detail-panel refresh — hover-aware + throttled.
  //
  // Root problem: drone tick loops call renderDetailPanel many times per
  // second, replacing detailBodyEl.innerHTML wholesale. That kills hover
  // state (mouseleave → mouseenter flicker on every rebuild) and eats
  // clicks (mousedown + mouseup land on different DOM instances).
  //
  // Fix: defer any tick-triggered render while the pointer is inside the
  // panel. The moment the pointer leaves, the queued render fires. So
  // interactive elements (collapse arrows, chips, buttons) never blink
  // or swallow clicks while the operator is actually looking at them,
  // and values update the instant attention moves elsewhere. Plus a
  // 500 ms lower-bound throttle so background rebuild rate is sane even
  // when the pointer isn't over the panel.
  let _rdpLastMs = 0;
  let _rdpPending = null;
  let _dpHovering = false;
  const _RDP_MIN_INTERVAL = 500;
  function renderDetailPanelThrottled() {
    // If the operator is actively interacting with the panel, mark the
    // render as pending. The mouseleave handler will flush it.
    if (_dpHovering) {
      _rdpPending = _rdpPending || true;
      return;
    }
    const now = performance.now();
    const elapsed = now - _rdpLastMs;
    if (elapsed >= _RDP_MIN_INTERVAL) {
      _rdpLastMs = now;
      _rdpPending = null;
      renderDetailPanel();
      return;
    }
    if (_rdpPending && _rdpPending !== true) return;
    _rdpPending = setTimeout(() => {
      _rdpPending = null;
      _rdpLastMs = performance.now();
      if (!_dpHovering) renderDetailPanel();
      else _rdpPending = true; // still hovering; wait for mouseleave
    }, _RDP_MIN_INTERVAL - elapsed);
  }
  // Bind hover state to the detail panel container so tick-driven renders
  // pause while the operator is looking at / clicking on anything inside.
  (function _wireDpHoverGate() {
    const panel = document.getElementById('detail-panel');
    if (!panel) return;
    panel.addEventListener('mouseenter', () => { _dpHovering = true; });
    panel.addEventListener('mouseleave', () => {
      _dpHovering = false;
      // Flush any deferred tick render immediately
      if (_rdpPending) {
        if (typeof _rdpPending !== 'boolean') clearTimeout(_rdpPending);
        _rdpPending = null;
        _rdpLastMs = performance.now();
        renderDetailPanel();
      }
    });
  })();

  // ═══════════════════════════════════════════════════════════════════
  // Live-telemetry surgical DOM patcher
  // ───────────────────────────────────────────────────────────────────
  // renderDetailPanelThrottled blocks re-renders while cursor is over
  // the panel (hover gate). When operator clicks a swarm drone to focus
  // it, cursor is over the panel → panel freezes → telemetry coords
  // appear static. This patcher runs on interval regardless of hover
  // state and writes JUST the live-value cells via .textContent (no
  // innerHTML thrash, no layout shift). Cells are found via the
  // data-live="*" attributes added in renderDetailPanel.
  // ═══════════════════════════════════════════════════════════════════
  function _patchLiveTelemetry() {
    const eventId = getSelectedEventId();
    if (!eventId) return;
    const event = getEvent(eventId);
    if (!event) return;
    const state = droneState.get(eventId);
    const template = TEMPLATES[event.templateKey];

    // Resolve the current stats source (swarm-focused OR event.lastPosition)
    let stats = null;
    let focusedId = null;
    if (template?.swarm && state?.swarmBillboards) {
      if (_selectedSwarmIndex === 0) {
        stats = state.leadStats;
        focusedId = 'DJI-1';
      } else if (state.swarmBillboards[_selectedSwarmIndex - 1]) {
        stats = state.swarmBillboards[_selectedSwarmIndex - 1].stats;
        focusedId = `DJI-${_selectedSwarmIndex + 1}`;
      }
    }
    if (!stats && event.lastPosition) stats = event.lastPosition;
    if (!stats) return;

    // Patch top telemetry cells
    const section = document.querySelector('[data-live-telemetry="1"]');
    if (section) {
      const set = (sel, val) => { const el = section.querySelector(sel); if (el) el.innerHTML = val; };
      const setTxt = (sel, val) => { const el = section.querySelector(sel); if (el) el.textContent = val; };
      // NOTE: intentionally NOT patching [data-live="title"] here — it
      // contains a dynamically-inserted collapse caret (▸/▾) added by
      // _decorateActiveSectionsCollapsible. Using .textContent would
      // wipe the caret every 250ms, causing it to flicker back-and-forth
      // as re-decorate + patcher fought each other. Title only changes
      // on drone-focus switch (handled by full re-render), so no need
      // to live-patch it.
      set('[data-live="pos"]', `${(stats.lat).toFixed(4)}°N<br/>${(stats.lon).toFixed(4)}°E`);
      setTxt('[data-live="alt"]', `${Math.round(stats.alt || 0)} m AGL`);
      setTxt('[data-live="spd"]', `${(stats.speed || 0).toFixed(1)} m/s`);
      setTxt('[data-live="hdg"]', `${Math.round(stats.heading || 0)}° · Inbound`);
      // Range / ETA only exist for non-swarm view (lastPosition source)
      if (event.lastPosition?.rangeToPerim != null) {
        setTxt('[data-live="range"]', `${event.lastPosition.rangeToPerim} m`);
      }
      // Confidence
      const conf = stats.confidence ?? event.confidence ?? 0;
      const fill = section.querySelector('[data-live="confFill"]');
      if (fill) fill.style.width = `${Math.round(conf * 100)}%`;
      setTxt('[data-live="confTxt"]', `${conf.toFixed(2)} · ${event.confidenceTrend || ''}`);
    }

    // Patch swarm roster rows (all rows update, not just focused)
    if (template?.swarm && state?.swarmBillboards) {
      document.querySelectorAll('.dp-swarm-row').forEach((row, idx) => {
        let rowStats;
        if (idx === 0) rowStats = state.leadStats;
        else if (state.swarmBillboards[idx - 1]) rowStats = state.swarmBillboards[idx - 1].stats;
        if (!rowStats || rowStats.lat == null) return;
        const posSpan = row.querySelector('.dp-swarm-pos');
        const altSpan = row.querySelector('.dp-swarm-alt');
        const hdgSpan = row.querySelector('.dp-swarm-hdg');
        const spdSpan = row.querySelector('.dp-swarm-spd');
        const confSpan = row.querySelector('.dp-swarm-conf');
        if (posSpan) posSpan.textContent = `${rowStats.lat.toFixed(4)}°N ${rowStats.lon.toFixed(4)}°E`;
        if (altSpan) altSpan.textContent = `${Math.round(rowStats.alt || 0)} m`;
        if (hdgSpan) hdgSpan.textContent = `${Math.round(rowStats.heading || 0)}°`;
        if (spdSpan) spdSpan.textContent = `${(rowStats.speed || 0).toFixed(1)} m/s`;
        if (confSpan) confSpan.textContent = `${Math.round((rowStats.confidence || 0) * 100)}%`;
      });
    }
  }
  setInterval(_patchLiveTelemetry, 250);

  // Per-event collapsed state for ACTIVE detail-panel sections. Empty by
  // default (all sections open). Set entry format: "eventId::sectionKey".
  // sectionKey derives from the section's title text so it's stable
  // across re-renders even when section ordering shifts (e.g. swarm
  // roster appearing when a swarm goes live).
  const _dpCollapsed = new Set();
  // Per-event "sensors expanded" state — false = top 5, true = full list.
  const _dpSensorsExpanded = new Set();
  function _dpSectionKey(titleEl) {
    // Strip counts/dots so "Contributing Sensors · 6 / 8" and
    // "Contributing Sensors · 7 / 8" both key on "contributing-sensors".
    const raw = (titleEl?.textContent || '').split('·')[0].trim();
    return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function _decorateActiveSectionsCollapsible(eventId) {
    detailBodyEl.querySelectorAll('.dp-section').forEach((section) => {
      const titleEl = section.querySelector('.dp-section-title');
      if (!titleEl || section.dataset.dpCollapsibleWired === '1') return;
      const key = _dpSectionKey(titleEl);
      if (!key) return;
      const stateKey = `${eventId}::${key}`;
      // Insert a caret at the start of the title (idempotent guard above)
      const caret = document.createElement('span');
      caret.className = 'dp-coll-caret';
      const currentlyCollapsed = _dpCollapsed.has(stateKey);
      caret.textContent = currentlyCollapsed ? '▸' : '▾';
      titleEl.insertBefore(caret, titleEl.firstChild);
      titleEl.classList.add('dp-coll-title');
      section.dataset.dpCollapsibleWired = '1';
      // Apply initial collapsed state — hide all children except title
      if (currentlyCollapsed) section.classList.add('dp-section-collapsed');
      // Click title (excluding interactive children) → toggle
      titleEl.addEventListener('click', (ev) => {
        // Don't hijack clicks on nested actionable elements
        if (ev.target !== titleEl && ev.target !== caret) {
          const closest = ev.target.closest('button, a, input');
          if (closest) return;
        }
        const nowCollapsed = section.classList.toggle('dp-section-collapsed');
        caret.textContent = nowCollapsed ? '▸' : '▾';
        if (nowCollapsed) _dpCollapsed.add(stateKey);
        else _dpCollapsed.delete(stateKey);
      });
    });
  }

  function renderDetailPanel() {
    const id = getSelectedEventId();
    if (!id) {
      // If no event selected, check for a target
      if (_selectedTargetId) {
        const t = TARGETS.find(x => x.id === _selectedTargetId);
        if (t) return renderTargetInPanel(t);
      }
      detailEmptyEl.style.display = 'flex';
      detailBodyEl.style.display = 'none';
      return;
    }
    // Event selected takes priority, clear any lingering target
    _selectedTargetId = null;
    const e = getEvent(id);
    if (!e) {
      detailEmptyEl.style.display = 'flex';
      detailBodyEl.style.display = 'none';
      return;
    }
    detailEmptyEl.style.display = 'none';
    detailBodyEl.style.display = 'block';

    const isActive = e.status === 'active';
    // Route CLOSED events to the new Palantir-style panel. Active events
    // keep the legacy dense telemetry layout since live response needs
    // every field visible without a click.
    if (!isActive) return renderPalantirClosedPanel(e);
    const first = e.startTime.slice(11, 19) + 'Z';
    const last = (e.endTime || e.startTime).slice(11, 19) + 'Z';
    const dur = formatDuration(e.duration);

    // Swarm focused-drone override — computed EARLY so the telemetry section
    // below can read it without hitting a temporal-dead-zone ReferenceError.
    // The roster HTML is still built later in the function.
    let swarmPrimaryOverride = null;
    const _swarmStateEarly = droneState.get(e.id);
    const _templateEarly = TEMPLATES[e.templateKey];
    if (_templateEarly?.swarm && _swarmStateEarly?.swarmBillboards) {
      const _leadSlotEarly = _templateEarly.swarm.formation[0] || {};
      const _earlyList = [];
      _earlyList.push({
        id: 'DJI-1',
        model: _leadSlotEarly.model || 'DJI Matrice 300 RTK',
        role: 'lead',
        stats: _swarmStateEarly.leadStats,
        conf: e.confidence,
        hasLiveTelemetry: !!_swarmStateEarly.leadStats,
      });
      _swarmStateEarly.swarmBillboards.forEach((sw, idx) => {
        _earlyList.push({
          id: `DJI-${idx + 2}`,
          model: sw.model || 'DJI Matrice 300',
          role: sw.role,
          stats: sw.stats,
          conf: sw.stats?.confidence || 0,
          hasLiveTelemetry: !!sw.stats,
        });
      });
      if (_earlyList[_selectedSwarmIndex]) {
        swarmPrimaryOverride = _earlyList[_selectedSwarmIndex];
      }
    }

    // For multi-site tracks: if event is active AND currently OUT of any
    // sensor coverage, we cannot honestly claim live telemetry. Swap in a
    // defense-style "SIGNAL LOST" panel that freezes the last confirmed
    // snapshot and offers a View Summary CTA.
    const outOfRange = e.multiSiteTrack && e.detected && isActive
                       && e.currentlyInCoverage === false;
    // PRE-INGRESS: event has spawned + is being tracked internally, but no
    // sensor has confirmed detection yet. Realistic behaviour: we cannot
    // show live telemetry we have not sensed. Blocks the telemetry section
    // for multi-site tracks (swarm, cruise missile) that spawn off-map.
    const preIngress = e.multiSiteTrack && !e.detected && isActive;
    let telemetry = '';
    if (preIngress) {
      telemetry = `
        <div class="dp-section dp-pre-ingress">
          <div class="dp-pre-hdr">
            <span class="dp-pre-pulse"></span>
            <span class="dp-pre-title">PRE-INGRESS · AWAITING SENSOR CONTACT</span>
          </div>
          <div class="dp-pre-sub">Track inferred from cross-cue but not yet inside sensor coverage. Live telemetry populates once the first sensor confirms detection.</div>
        </div>`;
    } else if (outOfRange && e.lastKnownPosition) {
      const lk = e.lastKnownPosition;
      const siteName = SITES[lk.siteId]?.name || lk.siteId || 'Unknown site';
      const stamp = lk.timestamp ? lk.timestamp.slice(11,19) + 'Z' : '';
      telemetry = `
        <div class="dp-section dp-oor">
          <div class="dp-oor-hdr">
            <span class="dp-oor-pulse"></span>
            <span class="dp-oor-title">SIGNAL LOST · TRACK OUT OF SENSOR RANGE</span>
          </div>
          <div class="dp-oor-sub">Last confirmed contact at ${siteName} · ${stamp}. Live coordinates suppressed. Waiting for downstream cross cue.</div>
          <div class="dp-oor-grid">
            <div class="dp-oor-kv"><span class="dp-oor-k">LAST SITE</span><span class="dp-oor-v">${siteName}</span></div>
            <div class="dp-oor-kv"><span class="dp-oor-k">LAST FIX</span><span class="dp-oor-v mono">${lk.lat.toFixed(4)}°N ${lk.lon.toFixed(4)}°E</span></div>
            <div class="dp-oor-kv"><span class="dp-oor-k">LAST HEADING</span><span class="dp-oor-v mono">${lk.heading}°</span></div>
            <div class="dp-oor-kv"><span class="dp-oor-k">LAST SPEED</span><span class="dp-oor-v mono">${lk.speed} m/s</span></div>
            <div class="dp-oor-kv"><span class="dp-oor-k">LAST ALT</span><span class="dp-oor-v mono">${lk.alt} m AGL</span></div>
            <div class="dp-oor-kv"><span class="dp-oor-k">TIMESTAMP</span><span class="dp-oor-v mono">${stamp}</span></div>
          </div>
          <button class="dp-oor-cta" data-action="view-summary" data-id="${e.id}">View Detection Summary</button>
        </div>`;
    } else if (e.lastPosition) {
      // Swarm focused-drone override: only kicks in when override + stats
      // are fully valid numbers. Every branch guarded so no .toFixed() ever
      // hits undefined — that was the crash last time.
      const useSwarm = !!(swarmPrimaryOverride
        && swarmPrimaryOverride.hasLiveTelemetry
        && swarmPrimaryOverride.stats
        && typeof swarmPrimaryOverride.stats.lat === 'number'
        && typeof swarmPrimaryOverride.stats.lon === 'number'
        && !Number.isNaN(swarmPrimaryOverride.stats.lat));
      const telemLat = useSwarm ? swarmPrimaryOverride.stats.lat : e.lastPosition.lat;
      const telemLon = useSwarm ? swarmPrimaryOverride.stats.lon : e.lastPosition.lon;
      const telemAlt = useSwarm ? Math.round(swarmPrimaryOverride.stats.alt || 0) : e.lastPosition.alt;
      const telemSpeed = useSwarm
        ? (swarmPrimaryOverride.stats.speed || 0).toFixed(1)
        : e.lastPosition.speed;
      const telemHeading = useSwarm
        ? Math.round(swarmPrimaryOverride.stats.heading || 0)
        : e.lastPosition.heading;
      const telemTitle = useSwarm
        ? `${swarmPrimaryOverride.id} · Live Telemetry`
        : (isActive ? 'Live Telemetry' : 'Last Known Telemetry');
      const telemConf = useSwarm ? (swarmPrimaryOverride.conf || 0) : e.confidence;
      telemetry = `
      <div class="dp-section" data-live-telemetry="1">
        <div class="dp-section-title" data-live="title">${telemTitle}</div>
        <div class="kv-grid">
          <div class="kv"><div class="kv-k">Position</div><div class="kv-v" data-live="pos">${telemLat.toFixed(4)}°N<br/>${telemLon.toFixed(4)}°E</div></div>
          <div class="kv"><div class="kv-k">Altitude</div><div class="kv-v accent" data-live="alt">${telemAlt} m AGL</div></div>
          <div class="kv"><div class="kv-k">Ground Speed</div><div class="kv-v accent" data-live="spd">${telemSpeed} m/s</div></div>
          <div class="kv"><div class="kv-k">Heading</div><div class="kv-v" data-live="hdg">${telemHeading}° · ${isActive ? 'Inbound' : ''}</div></div>
          ${!useSwarm && e.lastPosition.rangeToPerim != null ? `<div class="kv"><div class="kv-k">Range to Perim</div><div class="kv-v accent" data-live="range">${e.lastPosition.rangeToPerim} m</div></div>` : ''}
          ${!useSwarm && e.lastPosition.eta != null ? `<div class="kv"><div class="kv-k">ETA</div><div class="kv-v" data-live="eta">${e.lastPosition.eta} s</div></div>` : ''}
        </div>
        <div class="conf-wrap">
          <div class="kv-k">Detection Confidence</div>
          <div class="conf-bar"><div class="conf-fill" data-live="confFill" style="width:${Math.round(telemConf*100)}%;"></div></div>
          <div class="conf-txt" data-live="confTxt">${telemConf.toFixed(2)} · ${e.confidenceTrend || ''}</div>
        </div>
      </div>`;
    }

    // Contributing sensors: sort by proximity to current threat position
    // (falls back to confidence when threat position unknown or event
    // closed). Show top 5 by relevance; toggle button reveals the rest.
    const _siteMeta = SITES[e.siteId];
    const _threatLat = e.lastPosition?.lat;
    const _threatLon = e.lastPosition?.lon;
    const _enrichedSensors = (e.contributingSensors || []).map(s => {
      const meta = _siteMeta?.sensors?.find(x => x.id === s.id);
      const dist = (meta && _threatLat != null)
        ? haversineM(_threatLat, _threatLon, meta.lat, meta.lon)
        : Infinity;
      return { ...s, dist, hasCoords: !!meta };
    });
    _enrichedSensors.sort((a, b) => {
      // Online first, then closest to threat (or highest confidence if no dist)
      if (!!a.offline !== !!b.offline) return a.offline ? 1 : -1;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return (b.confidence || 0) - (a.confidence || 0);
    });
    const _sensorsExpanded = _dpSensorsExpanded.has(e.id);
    const _sensorTotal = _enrichedSensors.length;
    const _sensorVisible = (_sensorsExpanded || _sensorTotal <= 5) ? _enrichedSensors : _enrichedSensors.slice(0, 5);
    const _sensorToggleHtml = _sensorTotal > 5 ? `
      <button class="dp-sensor-toggle" data-dp-sensor-toggle="${e.id}">
        ${_sensorsExpanded ? `Show top 5 only` : `See all ${_sensorTotal} sensors`}
      </button>` : '';
    const sensors = e.contributingSensors && e.contributingSensors.length ? `
      <div class="dp-section">
        <div class="dp-section-title">Contributing Sensors · ${e.contributingSensors.filter(s => !s.offline).length} / ${_sensorTotal}${_sensorTotal > 5 && !_sensorsExpanded ? ' · showing top 5 by proximity' : ''}</div>
        ${_sensorVisible.map(s => `
          <div class="sensor-row ${s.offline ? 'off' : ''}">
            <span class="s-lbl">${s.id}</span>
            <div class="s-bar"><div class="s-fill" style="width:${Math.round(s.confidence*100)}%;"></div></div>
            <span class="s-val">${s.offline ? 'off' : s.confidence.toFixed(2)}</span>
          </div>`).join('')}
        ${_sensorToggleHtml}
      </div>` : '';

    // Brief Incident Summary — for non-missile hostile tracks that entered
    // and exited a site without being neutralised (drone overflights, etc).
    // Deliverable to intelligence agencies (PET, FE, Rigspoliti) for their
    // own downstream operations. Minimal — the deep report is reserved for
    // full neutralisation events.
    const briefSum = (e.platform !== 'missile' && e.entry && e.exit && e.outcome !== 'neutralized') ? `
      <div class="dp-section dp-brief">
        <div class="dp-brief-hdr">
          <div class="dp-brief-badge">BRIEF INCIDENT SUMMARY</div>
        </div>
        <div class="dp-brief-body">
          ${e.droneType} entered ${siteName(e.siteId)} perimeter at ${e.entry.timestamp.slice(11,19)}Z,
          departed at ${e.exit.timestamp.slice(11,19)}Z. Total site dwell ${formatDuration(e.duration)}.
          Classification ${(e.classification || '').toUpperCase()}, confidence ${e.confidence.toFixed(2)}.
          No response asset dispatched. Track lost on exit.
        </div>
        <div class="dp-brief-cta-row">
          <button class="dp-brief-cta" data-brief="intel" data-id="${e.id}">Send to Intelligence (PET · FE · Rigspoliti)</button>
          <button class="dp-brief-cta doc" data-brief="pdf" data-id="${e.id}">Download Brief (PDF)</button>
        </div>
      </div>` : '';

    // Swarm roster + primary-drone focus.
    // _selectedSwarmIndex picks which drone is the "primary" — its stats
    // override the header line so the panel reads as "DJI-3 · wingman-BR"
    // when a wingman is focused. Roster rows are clickable to swap focus.
    let swarmRoster = '';
    // NOTE: swarmPrimaryOverride is declared + populated earlier in the
    // function so the telemetry section can read it. Don't redeclare here.
    const _swarmState = droneState.get(e.id);
    const _template = TEMPLATES[e.templateKey];
    if (_template?.swarm && _swarmState?.swarmBillboards) {
      // Build a STABLE 5-slot droneList indexed 0..4. Even if some stats
      // are momentarily null (tick hasn't run yet), the slot exists with
      // a placeholder — so clicking a row always resolves the same drone
      // and the header override doesn't fall through to e.droneType.
      const droneList = [];
      const leadSlot = _template.swarm.formation[0] || {};
      droneList.push({
        id: 'DJI-1',
        model: leadSlot.model || 'DJI Matrice 300 RTK',
        role: 'lead',
        stats: _swarmState.leadStats || { lat: 0, lon: 0, alt: 0, heading: 0, speed: 0, rfCarrierMHz: leadSlot.rfMHz || 2412 },
        conf: e.confidence,
        hasLiveTelemetry: !!_swarmState.leadStats,
      });
      _swarmState.swarmBillboards.forEach((sw, idx) => {
        droneList.push({
          id: `DJI-${idx + 2}`,
          model: sw.model || 'DJI Matrice 300',
          role: sw.role,
          stats: sw.stats || { lat: 0, lon: 0, alt: 0, heading: 0, speed: 0, rfCarrierMHz: sw.rfMHz || 2412 },
          conf: sw.stats?.confidence || 0,
          hasLiveTelemetry: !!sw.stats,
        });
      });

      // NEVER reset _selectedSwarmIndex from within render. If it's beyond
      // the current droneList (transient state), just fall back to null
      // override — but leave the module variable intact so the next render
      // with a full droneList picks the correct drone. Any clamp/reset here
      // would destroy the user's click intent between renders.
      swarmPrimaryOverride = droneList[_selectedSwarmIndex] || null;

      // DIAGNOSTIC — expose live state so we can verify from browser console
      window.__headerDebug = {
        selectedIdx: _selectedSwarmIndex,
        overrideId: swarmPrimaryOverride?.id,
        overrideModel: swarmPrimaryOverride?.model,
        overrideLat: swarmPrimaryOverride?.stats?.lat?.toFixed(4),
        overrideAlt: swarmPrimaryOverride?.stats?.alt?.toFixed(0),
        droneListLength: droneList.length,
        droneListIds: droneList.map(d => d.id).join(','),
      };

      // Note: reassign totalDrones for roster rendering below
      var totalDrones = droneList.length;

      const fmtRow = (d, idx) => `
        <div class="dp-swarm-row ${idx === _selectedSwarmIndex ? 'is-focused' : ''}" data-swarm-idx="${idx}" title="Click to focus ${d.id} (${d.model})">
          <span class="dp-swarm-id">${d.id}</span>
          <span class="dp-swarm-model">${d.model}</span>
          <span class="dp-swarm-role">${d.role}</span>
          <span class="dp-swarm-pos mono">${d.stats.lat.toFixed(4)}°N ${d.stats.lon.toFixed(4)}°E</span>
          <span class="dp-swarm-alt mono">${Math.round(d.stats.alt)} m</span>
          <span class="dp-swarm-hdg mono">${Math.round(d.stats.heading)}°</span>
          <span class="dp-swarm-spd mono">${(d.stats.speed || 0).toFixed(1)} m/s</span>
          <span class="dp-swarm-rf mono">${d.stats.rfCarrierMHz || 2412} MHz</span>
          <span class="dp-swarm-conf mono">${Math.round((d.conf || 0) * 100)}%</span>
        </div>`;
      swarmRoster = `
        <div class="dp-section dp-swarm">
          <div class="dp-section-title">Swarm Roster · ${totalDrones} drones detected · click a row to focus</div>
          <div class="dp-swarm-rows">${droneList.map(fmtRow).join('')}</div>
        </div>`;
    } else if (e.lastPosition && !preIngress && !outOfRange) {
      // Non-swarm platforms — fixed-wing, jet, missile, SAS commercial,
      // non-identifiable — get the SAME roster UI with a single row so
      // every event type has the platform-card treatment (was previously
      // quadcopter-swarm only). Reuses the dp-swarm-* CSS classes.
      const _platformId = ({
        'missile': 'MSL-1',
        'fixed-wing': 'FW-1',
        'fixed_wing': 'FW-1',
        'jet': 'JET-1',
        'non-identifiable': 'NID-1',
      })[e.platform] || 'UAS-1';
      const _platformModel = e.droneType
        || ({
          'missile': 'Cruise / ballistic missile',
          'fixed-wing': 'Fixed-wing UAS',
          'jet': 'Jet aircraft',
          'non-identifiable': 'Non-identified platform',
        })[e.platform]
        || 'Airborne platform';
      // Parse RF carrier MHz from evidence string (e.g. "2.412 GHz" → 2412).
      // Passive tracks (missile) show "Passive" instead of an MHz number.
      const _rfRaw = e.evidence?.rfCarrier || '';
      let _rfLabel = 'N/A';
      const _ghz = _rfRaw.match(/([\d.]+)\s*GHz/i);
      const _mhz = _rfRaw.match(/(\d+)\s*MHz/i);
      if (_ghz) _rfLabel = `${Math.round(parseFloat(_ghz[1]) * 1000)} MHz`;
      else if (_mhz) _rfLabel = `${_mhz[1]} MHz`;
      else if (/passive/i.test(_rfRaw)) _rfLabel = 'Passive';
      const soloRow = `
        <div class="dp-swarm-row is-focused" data-swarm-idx="0" title="${_platformId} (${_platformModel})">
          <span class="dp-swarm-id">${_platformId}</span>
          <span class="dp-swarm-model">${_platformModel}</span>
          <span class="dp-swarm-role">lead</span>
          <span class="dp-swarm-pos mono">${e.lastPosition.lat.toFixed(4)}°N ${e.lastPosition.lon.toFixed(4)}°E</span>
          <span class="dp-swarm-alt mono">${e.lastPosition.alt} m</span>
          <span class="dp-swarm-hdg mono">${e.lastPosition.heading}°</span>
          <span class="dp-swarm-spd mono">${(e.lastPosition.speed || 0).toFixed(1)} m/s</span>
          <span class="dp-swarm-rf mono">${_rfLabel}</span>
          <span class="dp-swarm-conf mono">${Math.round((e.confidence || 0) * 100)}%</span>
        </div>`;
      swarmRoster = `
        <div class="dp-section dp-swarm">
          <div class="dp-section-title">Platform · ${_platformModel}</div>
          <div class="dp-swarm-rows">${soloRow}</div>
        </div>`;
    }

    const perimeter = (e.entry || e.exit) ? `
      <div class="dp-section">
        <div class="dp-section-title">Perimeter Crossings</div>
        ${e.entry ? `<div class="pc-row pc-entry"><span class="pc-tag">ENTRY</span><span class="pc-time">${e.entry.timestamp.slice(11,19)}Z</span><span class="pc-coord">${e.entry.lat.toFixed(4)}°N ${e.entry.lon.toFixed(4)}°E</span></div>` : ''}
        ${e.exit ? `<div class="pc-row pc-exit"><span class="pc-tag">EXIT</span><span class="pc-time">${e.exit.timestamp.slice(11,19)}Z</span><span class="pc-coord">${e.exit.lat.toFixed(4)}°N ${e.exit.lon.toFixed(4)}°E</span></div>` : ''}
      </div>` : '';

    // Mission Console — Agent B narrative (mock; Mistral post-demo).
    // Correlates the event's site context (Agent A) with the recorded
    // trajectory to produce dwell heatmap, pattern flags, behavioural
    // classification. Renders on every active event; degrades gracefully
    // for events without a recording (dwell section omitted).
    const missionConsole = (() => {
      const insight = _generateAgentBNarrative(e);
      if (!insight) return '';
      const { nearest, dwellRanked, flags, pattern, confidence, hasTimeseries } = insight;
      const confCls = confidence.toLowerCase();
      const nearestBlock = nearest ? `
        <div class="mc-row">
          <div class="mc-k">Nearest critical asset</div>
          <div class="mc-v"><b>${nearest.area.name}</b> · ${nearest.dist.toFixed(2)} km</div>
        </div>` : '';
      const dwellBlock = dwellRanked.length ? `
        <div class="mc-row">
          <div class="mc-k">Dwell analysis</div>
          <div class="mc-v mc-dwell">
            ${dwellRanked.slice(0, 4).map(d =>
              `<div class="mc-dwell-row"><span class="mc-dwell-name">${d.name}</span><span class="mc-dwell-bar-wrap"><span class="mc-dwell-bar" style="width:${d.pct}%"></span></span><span class="mc-dwell-pct">${d.pct}%</span></div>`
            ).join('')}
          </div>
        </div>` : (hasTimeseries ? '' : `
        <div class="mc-row">
          <div class="mc-k">Dwell analysis</div>
          <div class="mc-v mc-dim">No trajectory recording. Post-demo retrofit will backfill for all event types.</div>
        </div>`);
      const flagsBlock = flags.length ? `
        <div class="mc-row">
          <div class="mc-k">Pattern flags</div>
          <div class="mc-v">${flags.map(f => `<div class="mc-flag">${f}</div>`).join('')}</div>
        </div>` : '';
      return `
        <div class="dp-section dp-mission-console">
          <div class="dp-section-title mc-title">
            <span class="mc-badge">AGENT B</span>
            Mission Console · Correlated insight
          </div>
          ${nearestBlock}
          ${dwellBlock}
          ${flagsBlock}
          <div class="mc-row mc-verdict">
            <div class="mc-k">Assessed pattern</div>
            <div class="mc-v">
              <div class="mc-pattern">${pattern}</div>
              <div class="mc-conf mc-conf-${confCls}">Confidence · ${confidence}</div>
            </div>
          </div>
          <div class="mc-footer">Agent B mock output. Live Mistral inference post-demo (Scaleway / OVH sovereign EU).</div>
        </div>`;
    })();

    // Linked Events section: renders auto-correlated OR manually-linked
    // events. Clicking a chip jumps to that event's report. The correlation
    // score badge appears when the correlator established (or confirmed) the
    // link — absent when the link is purely a scenario-scripted secondEvent.
    const linkedIds = Array.isArray(e.linkedEventIds) ? e.linkedEventIds : [];
    const linkedEvents = linkedIds.length ? `
      <div class="dp-section dp-linked">
        <div class="dp-section-title">Linked Events · ${linkedIds.length}${e.correlationScore ? ` · <span class="dp-corr-score">${(e.correlationScore * 100).toFixed(0)}% signature match</span>` : ''}</div>
        <div class="dp-linked-rows">
          ${linkedIds.map(lid => {
            const le = getEvent(lid);
            const siteN = le ? siteName(le.siteId) : '—';
            const type = le ? (le.droneType || le.platform || 'unknown') : 'unavailable';
            const badge = le?.correlationScore
              ? `<span class="dp-linked-badge auto">AUTO ${(le.correlationScore * 100).toFixed(0)}%</span>`
              : `<span class="dp-linked-badge manual">LINKED</span>`;
            return `<div class="dp-linked-row" data-linked-id="${lid}">
              <span class="dp-linked-id mono">${lid}</span>
              <span class="dp-linked-site">${siteN}</span>
              <span class="dp-linked-type">${type}</span>
              ${badge}
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    const outcome = e.outcome === 'neutralized' ? `
      <div class="dp-section dp-outcome">
        <div class="dp-section-title" style="color:#4dff9c;">Target Neutralised</div>
        <div class="dp-outcome-row">
          <span class="dp-outcome-k">Responder</span><span class="dp-outcome-v">${e.neutralizedBy || 'Flyvevåbnet Fighter Response'}</span>
        </div>
        <div class="dp-outcome-row">
          <span class="dp-outcome-k">Time</span><span class="dp-outcome-v mono">${e.neutralizedAt ? e.neutralizedAt.slice(11,19) : '-'}</span>
        </div>
      </div>` : '';

    // Post-Incident Report — appears once the target is neutralised. Full
    // audit trail of the multi-site detection + response, with CTAs for
    // the next phase: command-layer handoff (Verá), civil protection (mass
    // Politi cordon + Beredskabsstyrelsen), and a printable PDF report.
    const pir = e.outcome === 'neutralized' ? (() => {
      const sitesTouched = new Set();
      if (e.siteId) sitesTouched.add(e.siteId);
      if (e._reacquiredSites) e._reacquiredSites.forEach(s => sitesTouched.add(s));
      const siteChain = Array.from(sitesTouched).map(sid => SITES[sid]?.name || sid).join(' → ');
      const lk = e.lastKnownPosition;
      const impact = lk ? `${lk.lat.toFixed(4)}°N ${lk.lon.toFixed(4)}°E` : '—';
      const impactSite = lk ? (SITES[lk.siteId]?.name || lk.siteId) : '—';
      const evasion = e.projectionSnapshot && lk
        ? Math.round(Math.abs(lk.heading - e.projectionSnapshot.heading))
        : 0;
      const escCount = (e.escalations || []).length;
      const dispatchedFlags = e.postIncidentDispatched || [];
      const veraDispatched = dispatchedFlags.includes('vera');
      const cordonDispatched = dispatchedFlags.includes('cordon');
      const beredskabDispatched = dispatchedFlags.includes('beredskab-mass');
      return `
      <div class="dp-section dp-pir">
        <div class="dp-pir-hdr">
          <div class="dp-pir-badge">POST INCIDENT</div>
          <div class="dp-pir-title">Full Incident Report</div>
        </div>
        <div class="dp-pir-exec">
          Cruise missile signature originated south west of Kassø on bearing 62°.
          Detected by ${sitesTouched.size} independent sensor sites (${siteChain}).
          Evasion course correction of ${evasion}° recorded post Kassø exit.
          Neutralised by ${e.neutralizedBy || 'Flyvevåbnet fighter response'} at ${impact} (${impactSite}).
          Impact avoided over inner Copenhagen.
        </div>
        <div class="dp-pir-grid">
          <div class="dp-pir-kv"><span class="k">FIRST DETECT</span><span class="v mono">${e.startTime.slice(11,19)}Z · ${siteName(e.siteId)}</span></div>
          <div class="dp-pir-kv"><span class="k">SITES CROSS CUED</span><span class="v mono">${sitesTouched.size}</span></div>
          <div class="dp-pir-kv"><span class="k">EVASION</span><span class="v mono">${evasion > 8 ? evasion + '° course change' : 'None recorded'}</span></div>
          <div class="dp-pir-kv"><span class="k">ESCALATIONS</span><span class="v mono">${escCount}</span></div>
          <div class="dp-pir-kv"><span class="k">RESPONDER</span><span class="v mono">${e.neutralizedBy || 'Flyvevåbnet'}</span></div>
          <div class="dp-pir-kv"><span class="k">NEUTRALISED</span><span class="v mono">${e.neutralizedAt ? e.neutralizedAt.slice(11,19) + 'Z' : '—'}</span></div>
          <div class="dp-pir-kv"><span class="k">IMPACT ZONE</span><span class="v mono">${impactSite}</span></div>
          <div class="dp-pir-kv"><span class="k">CLASSIFICATION</span><span class="v mono">${(e.classification || '').toUpperCase()} · ${e.threat?.toUpperCase() || 'HIGH'}</span></div>
        </div>
        <div class="dp-pir-cta-hdr">Command Handoff</div>
        <button class="dp-pir-cta ${veraDispatched ? 'done' : 'primary'}" data-pir="dispatch-vera" data-id="${e.id}" ${veraDispatched ? 'disabled' : ''}>
          ${veraDispatched ? 'Dispatched · Verá command layer' : 'Dispatch full incident to Verá'}
        </button>
        <div class="dp-pir-cta-hdr">Civil Response</div>
        <button class="dp-pir-cta ${cordonDispatched ? 'done' : ''}" data-pir="cordon" data-id="${e.id}" ${cordonDispatched ? 'disabled' : ''}>
          ${cordonDispatched ? 'Cordon deployed · Politi København' : 'Afspær området · Politi cordon (mass dispatch)'}
        </button>
        <button class="dp-pir-cta ${beredskabDispatched ? 'done' : ''}" data-pir="beredskab-mass" data-id="${e.id}" ${beredskabDispatched ? 'disabled' : ''}>
          ${beredskabDispatched ? 'Beredskabsstyrelsen inbound · full deployment' : 'Alert Beredskabsstyrelsen · full civil deployment'}
        </button>
        <div class="dp-pir-cta-hdr">Documentation</div>
        <button class="dp-pir-cta doc" data-pir="pdf-report" data-id="${e.id}">
          Generate PDF Incident Report
        </button>
      </div>`;
    })() : '';

    // Same missile banner for continuous multi site tracks. Shown when the
    // missile has been re-detected at a new site after a sensor gap.
    const reacquired = (e._reacquiredSites && e._reacquiredSites.size > 0 && e.outcome !== 'neutralized') ? `
      <div class="dp-section dp-reacq">
        <div class="dp-section-title" style="color:#4dff9c;">Track Continuous · Same Missile</div>
        <div class="dp-reacq-body">
          This is the same track first detected at ${siteName(e.siteId)}.
          Signal reacquired by ${Array.from(e._reacquiredSites).map(sid => SITES[sid]?.name || sid).join(', ')} sensors.
          ${_f35.airborne ? 'Fighter aircraft already airborne from earlier scramble. No new dispatch required.' : ''}
        </div>
      </div>` : '';

    const projected = (e.projectedPath && e.projectedPath.impacts && e.projectedPath.impacts.length) ? `
      <div class="dp-section">
        <div class="dp-section-title">Projected Path · ${e.projectedPath.impacts.length} downstream</div>
        <div class="pp-list">
          ${e.projectedPath.impacts.slice(0, 6).map((imp, i) => `
            <div class="pp-row">
              <span class="pp-idx">${String(i + 1).padStart(2, '0')}</span>
              <span class="pp-name">${imp.name}</span>
              <span class="pp-dist">${imp.distanceKm} km</span>
              <span class="pp-eta">${imp.etaMin} min</span>
            </div>`).join('')}
        </div>
      </div>` : '';

    const evidence = e.evidence ? `
      <div class="dp-section">
        <div class="dp-section-title">Signal Evidence · ${e.evidence.modality || ''}</div>
        <div class="kv-grid">
          ${e.evidence.rfCarrier ? `<div class="kv"><div class="kv-k">Carrier</div><div class="kv-v">${e.evidence.rfCarrier}</div></div>` : ''}
          ${e.evidence.rfBandwidth ? `<div class="kv"><div class="kv-k">Bandwidth</div><div class="kv-v">${e.evidence.rfBandwidth}</div></div>` : ''}
          ${e.evidence.rfMatch ? `<div class="kv"><div class="kv-k">Match</div><div class="kv-v accent">${e.evidence.rfMatch}</div></div>` : ''}
          ${e.evidence.evidenceSize ? `<div class="kv"><div class="kv-k">Evidence Pack</div><div class="kv-v">${e.evidence.evidenceSize}</div></div>` : ''}
        </div>
        ${e.evidence.note ? `<div class="dp-note">${e.evidence.note}</div>` : ''}
      </div>` : '';

    const notes = (e.notes && e.notes.length) ? `
      <div class="dp-section">
        <div class="dp-section-title">Operator Notes · ${e.notes.length}</div>
        ${e.notes.map(n => `
          <div class="dp-note-row ${n.type === 'reclassification' ? 'is-reclass' : ''}">
            <div class="dp-note-meta">
              <span class="dp-note-author">${n.author}</span>
              <span class="dp-note-time">${n.timestamp.slice(11,19)}Z · ${n.timestamp.slice(0,10)}</span>
              ${n.type === 'reclassification' ? '<span class="dp-note-badge">RECLASSIFY</span>' : ''}
            </div>
            <div class="dp-note-text">${n.text}</div>
          </div>`).join('')}
      </div>` : '';

    const escStatusLabel = (s) => ({ sent: 'SENT', delivered: 'DELIVERED', read: 'READ', acknowledged: 'ACKNOWLEDGED', failed: 'FAILED' }[s] || s.toUpperCase());
    const escalationLog = (e.escalations && e.escalations.length) ? `
      <div class="dp-section">
        <div class="dp-section-title">Escalation Log · ${e.escalations.length}</div>
        ${e.escalations.map(esc => {
          const dest = getDestination(esc.destinationId);
          const destName = dest ? dest.name : esc.destinationId;
          const destType = dest ? destinationTypeLabel(dest.type) : '';
          const statusChain = esc.statusHistory.map(h => `${escStatusLabel(h.status)} ${h.timestamp.slice(11,19)}Z`).join(' → ');
          const response = esc.response ? `
            <div class="esc-response">
              <div class="esc-response-hdr">Response · ${esc.response.respondedBy} · ${esc.response.receivedAt.slice(11,19)}Z</div>
              <div class="esc-response-text">${esc.response.text}</div>
            </div>` : '';
          return `
            <div class="esc-row esc-status-${esc.status}">
              <div class="esc-hdr">
                <span class="esc-dest">${destName}</span>
                <span class="esc-type">${destType}</span>
                <span class="esc-status">${escStatusLabel(esc.status)}</span>
              </div>
              <div class="esc-meta">${esc.payload.toUpperCase()} · by ${esc.initiatedBy}</div>
              ${esc.message ? `<div class="esc-msg">"${esc.message}"</div>` : ''}
              <div class="esc-chain">${statusChain}</div>
              ${response}
            </div>`;
        }).join('')}
      </div>` : '';

    const actionsBlock = isActive ? `
      <div class="dp-actions">
        <button class="btn danger" data-action="escalate">Escalate</button>
      </div>
      <div class="dp-actions">
        <button class="btn" data-action="runbook">Response Playbook</button>
        <button class="btn" data-action="download-evidence" data-id="${e.id}">Evidence · JSON</button>
        <button class="btn" data-action="download-evidence-csv" data-id="${e.id}">Evidence · CSV</button>
      </div>
      <div class="dp-actions">
        <button class="btn" data-action="reclassify">Re-classify</button>
        <button class="btn" data-action="note">Add Note</button>
      </div>` : `
      <div class="dp-actions">
        <button class="btn danger" data-action="escalate">Escalate</button>
        <button class="btn" data-action="runbook">Response Playbook</button>
      </div>
      <div class="dp-actions">
        <button class="btn" data-action="reclassify">Re-classify</button>
        <button class="btn" data-action="note">Add Note</button>
      </div>
      <div class="dp-actions">
        <button class="btn" data-action="replay" data-id="${e.id}">Replay Flight</button>
      </div>
      <div class="dp-actions">
        <button class="btn" data-action="download-evidence" data-id="${e.id}">Evidence · JSON</button>
        <button class="btn" data-action="download-evidence-csv" data-id="${e.id}">Evidence · CSV</button>
      </div>`;

    // Header — when a swarm drone is focused, show that specific drone's
    // identity + live stats instead of the aggregate event droneType.
    const headerDroneLine = swarmPrimaryOverride
      ? `<div class="dp-drone">
          <b>${swarmPrimaryOverride.id}</b> · ${swarmPrimaryOverride.model} · ${swarmPrimaryOverride.role}
          <span class="dim">(${Math.round((swarmPrimaryOverride.conf || 0) * 100)}%)</span>
        </div>
        <div class="dp-drone-stats mono">
          ${swarmPrimaryOverride.stats.lat.toFixed(4)}°N ${swarmPrimaryOverride.stats.lon.toFixed(4)}°E ·
          alt ${Math.round(swarmPrimaryOverride.stats.alt)}m ·
          hdg ${Math.round(swarmPrimaryOverride.stats.heading)}° ·
          ${(swarmPrimaryOverride.stats.speed || 0).toFixed(1)} m/s ·
          ${swarmPrimaryOverride.stats.rfCarrierMHz || 2412} MHz
        </div>`
      : `<div class="dp-drone">${e.droneType} <span class="dim">(${Math.round(e.confidence*100)}%)</span></div>`;

    detailBodyEl.innerHTML = `
      <div class="dp-hdr">
        <div class="dp-id">${e.id}${isActive ? ' <span class="dp-live">● LIVE</span>' : ''}</div>
        <div class="dp-class">
          <span class="dp-class-dot dp-class-${e.classification}"></span>
          <span class="dp-class-txt">${classLabel(e)}</span>
        </div>
        ${headerDroneLine}
        <div class="dp-times">
          <span>FIRST <b>${first}</b></span>
          <span>LAST <b>${last}</b></span>
          <span>DUR <b>${dur}</b></span>
        </div>
      </div>
      ${telemetry}
      ${preIngress ? '' : missionConsole}
      ${preIngress ? '' : linkedEvents}
      ${preIngress ? '' : outcome}
      ${preIngress ? '' : pir}
      ${preIngress ? '' : briefSum}
      ${preIngress ? '' : swarmRoster}
      ${preIngress ? '' : reacquired}
      ${preIngress ? '' : sensors}
      ${preIngress ? '' : perimeter}
      ${preIngress ? '' : projected}
      ${preIngress ? '' : evidence}
      ${preIngress ? '' : escalationLog}
      ${notes}
      <div id="dp-actions-area">${actionsBlock}</div>
    `;

    // Decorate every dp-section with a collapse caret so operators can
    // hide individual sections. State keyed by (eventId, sectionIndex) so
    // choices persist across re-renders while an event is being viewed.
    // Default OPEN so the live-response density stays visible; user
    // opts in to collapse. Solves the scroll-jump problem when the
    // projected-path list constantly updates its length.
    _decorateActiveSectionsCollapsible(e.id);

    // Wire swarm roster row clicks → swap primary drone focus
    detailBodyEl.querySelectorAll('[data-swarm-idx]').forEach(row => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.swarmIdx);
        if (!Number.isNaN(idx)) {
          _selectedSwarmIndex = idx;
          window.__selectedSwarmIndex = idx;   // diagnostic exposure
          console.log('[SWARM] roster row clicked → focused index', idx);
          renderDetailPanel();
        }
      });
    });

    // Wire contributing-sensors "See all / Show top 5" toggle
    detailBodyEl.querySelectorAll('[data-dp-sensor-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.blur();
        const evId = btn.dataset.dpSensorToggle;
        if (_dpSensorsExpanded.has(evId)) _dpSensorsExpanded.delete(evId);
        else _dpSensorsExpanded.add(evId);
        renderDetailPanel();
      });
    });

    // Wire linked-event chip clicks → jump to that event's report
    detailBodyEl.querySelectorAll('[data-linked-id]').forEach(row => {
      row.addEventListener('click', () => {
        const lid = row.dataset.linkedId;
        if (lid && getEvent(lid)) selectEvent(lid);
      });
    });

    // Wire up Re-classify + Add Note + Escalate + Runbook buttons
    detailBodyEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'reclassify') openReclassifyForm(e.id);
        if (btn.dataset.action === 'note') openNoteForm(e.id);
        if (btn.dataset.action === 'escalate') openEscalateModal(e.id);
        if (btn.dataset.action === 'runbook') openRunbookDrawer(e.id);
        if (btn.dataset.action === 'view-summary') openDetectionSummary(btn.dataset.id || e.id);
        if (btn.dataset.action === 'download-evidence') {
          // P5A evidence pack: full recorded time-series JSON for this event.
          // Includes per-drone position, kinematics, RF, acoustic, visual,
          // per-sensor detection state at every sample. Feeds Agent B, KML
          // export, replay, and any external analyst tooling.
          const rec = window.__isr_getRecording(btn.dataset.id || e.id);
          if (!rec) {
            toast('No recorded trajectory for this event (recording only spawned for swarm events).', 'info');
          } else {
            window.__isr_downloadRecording(btn.dataset.id || e.id);
            toast(`JSON evidence downloaded (${rec.timeseries.length} samples across ${rec.meta.drones_count} drones)`, 'ok');
          }
        }
        if (btn.dataset.action === 'replay') {
          // P5B: opens the trajectory replay overlay with ghost billboards
          // + confidence-coloured trail. Available on any event with a
          // recording (currently swarm events only; post-demo retrofit
          // widens to missile + drone).
          startReplay(btn.dataset.id || e.id);
        }
        if (btn.dataset.action === 'download-evidence-csv') {
          // P5C: flattened per-sample CSV for analyst tooling (Excel,
          // Python, R). Same underlying data as JSON export, tabular shape.
          const rec = window.__isr_getRecording(btn.dataset.id || e.id);
          if (!rec) {
            toast('No recorded trajectory for this event.', 'info');
          } else {
            window.__isr_downloadRecordingCSV(btn.dataset.id || e.id);
            toast(`CSV evidence downloaded (${rec.timeseries.length} rows)`, 'ok');
          }
        }
      });
    });
    // Post-Incident Report CTAs
    detailBodyEl.querySelectorAll('[data-pir]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pir = btn.dataset.pir;
        if (pir === 'dispatch-vera') dispatchPostIncidentAction(e.id, 'vera');
        else if (pir === 'cordon') dispatchPostIncidentAction(e.id, 'cordon');
        else if (pir === 'beredskab-mass') dispatchPostIncidentAction(e.id, 'beredskab-mass');
        else if (pir === 'pdf-report') generatePirReport(e.id);
      });
    });
    // Brief Incident Summary CTAs (quadcopter / non-missile events)
    detailBodyEl.querySelectorAll('[data-brief]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.brief;
        if (kind === 'intel') sendBriefToIntelligence(e.id);
        else if (kind === 'pdf') generateBriefReport(e.id);
      });
    });
  }

  // ── Runbook drawer (slides in from right, contextual per event) ──
  const runbookDrawer = document.getElementById('runbook-drawer');
  // Lazy-create the fullscreen backdrop that blocks the underlying UI
  // while the runbook drawer is open. Ensures the detail panel behind
  // is not visible or interactable during playbook review.
  let runbookBackdrop = document.getElementById('runbook-backdrop');
  if (!runbookBackdrop) {
    runbookBackdrop = document.createElement('div');
    runbookBackdrop.id = 'runbook-backdrop';
    runbookBackdrop.style.display = 'none';
    document.body.appendChild(runbookBackdrop);
  }
  function closeRunbookDrawer() {
    runbookDrawer.classList.remove('open');
    runbookBackdrop.classList.remove('open');
    setTimeout(() => {
      runbookDrawer.style.display = 'none';
      runbookBackdrop.style.display = 'none';
    }, 250);
  }
  // Playbook step-completion state — persists per (eventId, stepIndex) to
  // localStorage so operator progress survives modal close/reopen and page
  // reload. When ALL steps are marked complete, a "playbook complete"
  // audit note is auto-appended to the event's timeline once.
  const _RB_STORAGE_KEY = 'isr_rb_completed_steps';
  function _rbReadCompleted() {
    try { return JSON.parse(localStorage.getItem(_RB_STORAGE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function _rbWriteCompleted(obj) {
    try { localStorage.setItem(_RB_STORAGE_KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
  function _rbIsStepDone(eventId, stepIdx) {
    const all = _rbReadCompleted();
    return !!(all[eventId] && all[eventId][stepIdx]);
  }
  function _rbSetStepDone(eventId, stepIdx, done) {
    const all = _rbReadCompleted();
    if (!all[eventId]) all[eventId] = {};
    if (done) all[eventId][stepIdx] = true;
    else delete all[eventId][stepIdx];
    _rbWriteCompleted(all);
  }
  function _rbCountDone(eventId, totalSteps) {
    const all = _rbReadCompleted();
    if (!all[eventId]) return 0;
    let n = 0;
    for (let i = 0; i < totalSteps; i++) if (all[eventId][i]) n++;
    return n;
  }
  function _rbCompletionNoted(eventId) {
    const all = _rbReadCompleted();
    return !!(all[eventId] && all[eventId].__completionNoted);
  }
  function _rbMarkCompletionNoted(eventId) {
    const all = _rbReadCompleted();
    if (!all[eventId]) all[eventId] = {};
    all[eventId].__completionNoted = true;
    _rbWriteCompleted(all);
  }

  function openRunbookDrawer(eventId) {
    const e = getEvent(eventId);
    if (!e) return;
    const rb = runbookFor(e);
    const doneCount = _rbCountDone(e.id, rb.steps.length);
    const allDone = doneCount === rb.steps.length;
    runbookDrawer.innerHTML = `
      <div class="rb-hdr rb-urgency-${rb.urgency}">
        <button class="rb-back" data-rb="back">← Back</button>
        <div class="rb-hdr-title">
          <div class="rb-tag">Response Playbook</div>
          <div class="rb-title">${rb.title}</div>
          <div class="rb-meta">${e.id}  ·  ${e.droneType}  ·  Est. resolution ${rb.estMinutes} min</div>
        </div>
        <button class="modal-x" data-rb="close">×</button>
      </div>
      <div class="rb-progress-bar">
        <div class="rb-progress-label">
          <span id="rb-progress-count">${doneCount} / ${rb.steps.length} steps complete</span>
          <button class="rb-reset" data-rb="reset" ${doneCount === 0 ? 'style="visibility:hidden"' : ''}>Reset checklist</button>
        </div>
        <div class="rb-progress-track">
          <div class="rb-progress-fill" id="rb-progress-fill" style="width:${(doneCount / rb.steps.length) * 100}%"></div>
        </div>
      </div>
      <ol class="rb-steps">
        ${rb.steps.map((s, idx) => {
          const done = _rbIsStepDone(e.id, idx);
          return `
          <li class="rb-step ${done ? 'rb-step-done' : ''}" data-rb-step-idx="${idx}">
            <div class="rb-step-n">${s.n}</div>
            <div class="rb-step-body">
              <div class="rb-step-action">${s.action}</div>
              <div class="rb-step-detail">${s.detail}</div>
              <label class="rb-step-check">
                <input type="checkbox" data-rb-step-check="${idx}" ${done ? 'checked' : ''} />
                <span>${done ? 'Complete' : 'Mark complete'}</span>
              </label>
            </div>
          </li>`;
        }).join('')}
      </ol>
      <div class="rb-complete-banner ${allDone ? 'shown' : ''}" id="rb-complete-banner">
        Playbook complete. All ${rb.steps.length} response steps executed. Logged to event timeline.
      </div>
      <div class="rb-footer">
        <div class="rb-footer-note">Progress persists per event and per operator. Customer-editable in Config module (roadmap).</div>
      </div>
    `;
    runbookDrawer.querySelector('[data-rb="close"]').addEventListener('click', closeRunbookDrawer);
    runbookDrawer.querySelector('[data-rb="back"]').addEventListener('click', closeRunbookDrawer);
    runbookDrawer.querySelector('[data-rb="reset"]').addEventListener('click', () => {
      const all = _rbReadCompleted();
      delete all[e.id];
      _rbWriteCompleted(all);
      openRunbookDrawer(eventId); // re-render
    });
    // Step checkbox handlers — toggle persistence, refresh progress bar,
    // and fire the audit note the first time the checklist hits 100%.
    runbookDrawer.querySelectorAll('[data-rb-step-check]').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.rbStepCheck, 10);
        _rbSetStepDone(e.id, idx, cb.checked);
        const nowDone = _rbCountDone(e.id, rb.steps.length);
        const nowAll = nowDone === rb.steps.length;
        // Update UI in place (no full re-render → checkbox click doesn't lose focus)
        const li = runbookDrawer.querySelector(`[data-rb-step-idx="${idx}"]`);
        if (li) li.classList.toggle('rb-step-done', cb.checked);
        const lbl = cb.parentElement.querySelector('span');
        if (lbl) lbl.textContent = cb.checked ? 'Complete' : 'Mark complete';
        const pc = document.getElementById('rb-progress-count');
        if (pc) pc.textContent = `${nowDone} / ${rb.steps.length} steps complete`;
        const pf = document.getElementById('rb-progress-fill');
        if (pf) pf.style.width = `${(nowDone / rb.steps.length) * 100}%`;
        const banner = document.getElementById('rb-complete-banner');
        if (banner) banner.classList.toggle('shown', nowAll);
        const resetBtn = runbookDrawer.querySelector('[data-rb="reset"]');
        if (resetBtn) resetBtn.style.visibility = nowDone === 0 ? 'hidden' : 'visible';
        // Fire audit note ONCE per event when the checklist first completes
        if (nowAll && !_rbCompletionNoted(e.id)) {
          _rbMarkCompletionNoted(e.id);
          addNote(e.id, `Response playbook complete. All ${rb.steps.length} steps executed for "${rb.title}".`, 'PLAYBOOK');
          toast('Playbook complete — logged to event timeline', 'ok');
        }
      });
    });
    runbookBackdrop.style.display = 'block';
    runbookDrawer.style.display = 'block';
    requestAnimationFrame(() => {
      runbookBackdrop.classList.add('open');
      runbookDrawer.classList.add('open');
    });
  }

  // ── Escalate modal (overlay) ──
  const modalBackdrop = document.getElementById('escalate-modal');
  const modalCard = document.getElementById('escalate-modal-card');

  function closeEscalateModal() {
    modalBackdrop.style.display = 'none';
    modalCard.innerHTML = '';
  }

  // ── Brief preview modal (nested inside escalate flow) ──
  const briefBackdrop = document.getElementById('brief-modal');
  const briefCard = document.getElementById('brief-modal-card');
  function closeBriefPreview() {
    briefBackdrop.style.display = 'none';
    briefCard.innerHTML = '';
  }
  function openBriefPreview(eventId, onSend) {
    const e = getEvent(eventId);
    if (!e) return;
    const briefHtml = renderDetectionBrief(e);
    briefCard.innerHTML = `
      <div class="brief-modal-hdr">
        <div class="brief-modal-title">Detection Brief · Preview</div>
        <div class="brief-modal-tools">
          <button class="mini-btn" data-brief="download">Download PDF</button>
          <button class="mini-btn" data-brief="back">Back</button>
          <button class="mini-btn primary" data-brief="send">Send now</button>
          <button class="modal-x" data-brief="close">×</button>
        </div>
      </div>
      <div class="brief-modal-body" id="brief-print-area">${briefHtml}</div>
    `;
    briefCard.querySelector('[data-brief="close"]').addEventListener('click', closeBriefPreview);
    briefCard.querySelector('[data-brief="back"]').addEventListener('click', closeBriefPreview);
    briefCard.querySelector('[data-brief="send"]').addEventListener('click', () => { if (onSend) onSend(); });
    briefCard.querySelector('[data-brief="download"]').addEventListener('click', () => {
      // Toggle a body class that hides everything except .brief-modal-body, then print
      document.body.classList.add('print-brief-only');
      window.print();
      setTimeout(() => document.body.classList.remove('print-brief-only'), 500);
    });
    briefBackdrop.addEventListener('click', (ev) => { if (ev.target === briefBackdrop) closeBriefPreview(); }, { once: true });
    briefBackdrop.style.display = 'flex';
  }

  // Threat-type → recommended escalation preset
  function recommendationFor(event) {
    const cls = event.classification;
    const platform = event.platform || 'quadcopter';
    const threat = event.threat;
    if (cls === 'friendly') return { tiers:[1], text:'Non-threat identification. Log to Tier 1 for audit record.', urgency:'low' };
    if (cls === 'resolved') return { tiers:[], text:'Already dismissed. No action required.', urgency:'low' };
    if (platform === 'missile') return { tiers:[1,2,3,4,5], text:'Missile signature confirmed. Dispatch all response tiers immediately. Radio silence protocol takes effect on Tier 4 dispatch.', urgency:'critical' };
    if (cls === 'hostile' && threat === 'high') return { tiers:[1,2,3], text:'High-threat classification. Dispatch Tier 1 and Tier 2 immediately. Escalate to Tier 3 within 60 seconds if unresolved.', urgency:'high' };
    if (cls === 'hostile' && threat === 'medium') return { tiers:[1,2], text:'Confirmed threat. Dispatch Tier 1 and Tier 2.', urgency:'med' };
    if (platform === 'fixed-wing') return { tiers:[1,2,3], text:'Fixed wing platform detected. Include Tier 3 with local response.', urgency:'high' };
    if (platform === 'non-identifiable') return { tiers:[1,2], text:'Non-identifiable contact detected. Dispatch Tier 1 for visual acquisition and Tier 2 for signature analysis. Escalate on ID confirmation.', urgency:'med' };
    if (cls === 'unknown') return { tiers:[1], text:'Classification pending. Dispatch Tier 1. Escalate as characteristics develop.', urgency:'med' };
    return { tiers:[1], text:'Dispatch Tier 1. Escalate as required.', urgency:'med' };
  }

  // Per-destination selected channels state, keyed by dest ID
  let _selectedChannels = {}; // { destId: Set([...methods]) }
  let _expanded = new Set(); // dest IDs currently expanded
  // legacy _escView removed with the P19 Palantir redesign (list-view only)
  const TIER_LABELS = {
    1: 'Tier 1  ·  First responders on site',
    2: 'Tier 2  ·  Local authorities',
    3: 'Tier 3  ·  National agencies',
    4: 'Tier 4  ·  Military response',
    5: 'Tier 5  ·  International partners',
  };

  function openEscalateModal(eventId) {
    const e = getEvent(eventId);
    if (!e) return;
    const rec = recommendationFor(e);
    const dests = destinationsForSite(e.siteId);
    const destsByTier = dests.reduce((acc, d) => { (acc[d.tier] = acc[d.tier] || []).push(d); return acc; }, {});
    // Preselect destinations matching recommendation tiers
    const preselected = new Set(dests.filter(d => rec.tiers.includes(d.tier)).map(d => d.id));
    // Default channel selection: primary method for each preselected destination
    _selectedChannels = {};
    dests.forEach(d => { _selectedChannels[d.id] = new Set(preselected.has(d.id) ? [d.contactMethods[0]] : []); });
    _expanded = new Set();

    const renderModal = () => {
      // Preserve scroll position across re-renders. Every interaction
      // (check/uncheck destination, expand/collapse agency, toggle channel
      // chip) triggers a full innerHTML replace which resets scrollTop
      // to 0 — user gets teleported to the top of the modal, has to
      // re-find where they were. Capture before replace, restore after.
      const _priorScroll = (() => {
        const scrollers = modalCard.querySelectorAll('.escp-section');
        const arr = [];
        scrollers.forEach((el, i) => arr.push(el.scrollTop));
        return arr;
      })();
      const sev = _severityForEvent(e);
      const createdRel = _relativeTimeShort(e.startTime);
      const totalPicked = Object.values(_selectedChannels).filter(s => s && s.size > 0).length;

      const destRow = (d, opts = {}) => {
        const availClass = d.availabilityStatus === 'on-shift' ? 'on' : d.availabilityStatus === 'off-hours' ? 'off' : 'idle';
        const availLabel = d.availabilityStatus === 'on-shift' ? 'On shift' : d.availabilityStatus === 'off-hours' ? 'Off hours' : 'Standby';
        const selChans = _selectedChannels[d.id] || new Set();
        const isSelected = selChans.size > 0;
        const isExpanded = _expanded.has(d.id);
        const guidance = getDestinationGuidance(d);
        // Displayed name: agencyLabel (single-department flatten) → parent
        // OR withinAgency (multi-dept dropdown) → department short label
        // OR default → full destination name.
        const displayName = opts.agencyLabel
          ? opts.agencyLabel
          : (opts.withinAgency ? destinationShortLabel(d) : d.name);
        const channelChips = d.contactMethods.map(m => {
          const meta = CHANNEL_META[m] || { icon:'•', label:m, latency:'?', fmt:'', urgency:'sys' };
          const on = selChans.has(m);
          return `<button class="escp-chip ${on ? 'on' : ''}" data-esc="ch" data-id="${d.id}" data-m="${m}" title="${meta.fmt}">
            <span class="escp-chip-ic">${meta.icon}</span><span class="escp-chip-lbl">${meta.label}</span><span class="escp-chip-lat">${meta.latency}</span>
          </button>`;
        }).join('');
        const expandedBody = isExpanded ? `
          <div class="escp-dest-detail">
            <div class="escp-guide-block">
              <div class="escp-guide-title">Typical use cases</div>
              <ul class="escp-guide-list">${guidance.useCases.map(u => `<li>${u}</li>`).join('')}</ul>
            </div>
            ${guidance.notAppropriate.length ? `
              <div class="escp-guide-block">
                <div class="escp-guide-title">Not appropriate for</div>
                <ul class="escp-guide-list escp-guide-neg">${guidance.notAppropriate.map(u => `<li>${u}</li>`).join('')}</ul>
              </div>` : ''}
            <div class="escp-guide-block">
              <div class="escp-guide-title">Notes</div>
              <div class="escp-guide-notes">${guidance.notes}</div>
            </div>
          </div>` : '';
        return `
          <div class="escp-dest ${isSelected ? 'is-selected' : ''} ${isExpanded ? 'is-expanded' : ''} ${opts.withinAgency ? 'is-within-agency' : ''}">
            <label class="escp-dest-head">
              <input type="checkbox" class="escp-dest-check" data-esc="pick" data-id="${d.id}" ${isSelected ? 'checked' : ''} />
              <div class="escp-dest-body">
                <div class="escp-dest-name">${displayName}</div>
                <div class="escp-dest-meta">
                  <span>${destinationTypeLabel(d.type)}</span>
                  <span class="escp-avail escp-avail-${availClass}">${availLabel}</span>
                </div>
              </div>
              <button class="escp-dest-expand" data-esc="toggle" data-id="${d.id}" title="Details">${isExpanded ? '▾' : '▸'}</button>
            </label>
            <div class="escp-chip-row">${channelChips}</div>
            ${expandedBody}
          </div>`;
      };

      const tierBlocks = Object.keys(destsByTier).sort().map(tier => {
        const isRec = rec.tiers.includes(parseInt(tier));
        // Group tier's destinations by parent agency. Single-department
        // parents render as one flat row; multi-department parents render
        // as an agency header + indented dropdown of departments.
        const parentGroups = groupByParent(destsByTier[tier]);
        const groupsHtml = parentGroups.map(g => {
          if (g.departments.length === 1) {
            // Single department — flatten to one row using the parent
            // agency name as the display label (destinationShortLabel of
            // the single department preserves internal wording where useful).
            const d = g.departments[0];
            return destRow(d, { agencyLabel: g.parent });
          }
          // Multi-department agency — collapsible group
          const groupKey = `agency:${tier}:${g.parent}`;
          const isOpen = _expanded.has(groupKey);
          const allChans = g.departments.reduce((sum, d) => sum + ((_selectedChannels[d.id] && _selectedChannels[d.id].size) || 0), 0);
          const someSelected = allChans > 0;
          return `
            <div class="escp-agency ${someSelected ? 'is-selected' : ''} ${isOpen ? 'is-open' : ''}">
              <button class="escp-agency-hdr" data-esc="toggle" data-id="${groupKey}">
                <span class="escp-agency-caret">${isOpen ? '▾' : '▸'}</span>
                <span class="escp-agency-name">${g.parent}</span>
                <span class="escp-agency-count">${g.departments.length} departments</span>
              </button>
              ${isOpen ? `<div class="escp-agency-body">${g.departments.map(d => destRow(d, { withinAgency: true })).join('')}</div>` : ''}
            </div>`;
        }).join('');
        return `
          <div class="escp-tier">
            <div class="escp-tier-hdr">
              <span class="escp-tier-lbl">${TIER_LABELS[tier] || 'Tier ' + tier}</span>
              ${isRec ? `<span class="escp-tier-rec">Recommended</span>` : ''}
            </div>
            <div class="escp-tier-body">
              ${groupsHtml}
            </div>
          </div>`;
      }).join('');

      modalCard.innerHTML = `
        <div class="escp-modal">
          <div class="escp-header">
            <div class="escp-header-row">
              <div class="escp-title">Escalate event</div>
              <button class="escp-x" data-modal="cancel" aria-label="Close">×</button>
            </div>
            <div class="escp-eid pl-mono">${e.id}</div>
            <div class="escp-summary">${e.droneType} at ${siteName(e.siteId)}. ${Math.round(e.confidence * 100)}% detection confidence.</div>
            <div class="escp-chips">
              <div class="escp-chip-box">
                <div class="escp-chip-box-k">Created</div>
                <div class="escp-chip-box-v pl-mono">${createdRel}</div>
              </div>
              <div class="escp-chip-box pl-sev-${sev.key}">
                <div class="escp-chip-box-k">Severity</div>
                <div class="escp-chip-box-v">${sev.label}</div>
              </div>
              <div class="escp-chip-box">
                <div class="escp-chip-box-k">Selected</div>
                <div class="escp-chip-box-v pl-mono">${totalPicked} / ${dests.length}</div>
              </div>
            </div>
          </div>

          <div class="escp-section">
            <div class="escp-section-hdr">
              <span class="escp-section-title">Recommendation</span>
              <button class="escp-inline-btn" data-esc="apply-rec">Apply recommended</button>
            </div>
            <div class="escp-rec escp-rec-${rec.urgency}">${rec.text}</div>
          </div>

          <div class="escp-section">
            <div class="escp-section-hdr">
              <span class="escp-section-title">Destinations</span>
              <span class="escp-section-hint">Tap ▸ for use-case detail</span>
            </div>
            ${tierBlocks}
          </div>

          <div class="escp-section">
            <div class="escp-section-hdr">
              <span class="escp-section-title">Payload</span>
              <button class="escp-inline-btn" data-esc="preview-brief">Preview brief</button>
            </div>
            <div class="escp-radio-group">
              <label class="escp-radio"><input type="radio" name="payload" value="summary" checked /><span class="escp-radio-lbl">Detection brief PDF</span></label>
              <label class="escp-radio"><input type="radio" name="payload" value="full" /><span class="escp-radio-lbl">Full evidence pack ZIP</span></label>
              <label class="escp-radio"><input type="radio" name="payload" value="live-link" /><span class="escp-radio-lbl">Live view link, tokenised 24 hours</span></label>
            </div>
          </div>

          <div class="escp-section">
            <div class="escp-section-hdr">
              <span class="escp-section-title">Operator message</span>
              <span class="escp-section-hint">Optional</span>
            </div>
            <textarea id="esc-message" class="escp-textarea" rows="3" placeholder="Context for the recipient"></textarea>
          </div>

          <div class="escp-actions">
            <button class="escp-cta" data-modal="cancel">Cancel</button>
            <button class="escp-cta escp-cta-primary" data-modal="send">Send escalation</button>
          </div>
        </div>
      `;

      modalCard.classList.remove('flow-active');   // legacy — no longer used

      // Restore scroll position on each scroll container (see _priorScroll
      // capture at top of renderModal). requestAnimationFrame so the
      // new DOM is laid out before we scroll.
      requestAnimationFrame(() => {
        const scrollers = modalCard.querySelectorAll('.escp-section');
        scrollers.forEach((el, i) => {
          if (_priorScroll[i] != null) el.scrollTop = _priorScroll[i];
        });
      });

      // (Flow-view + view-toggle wires removed with the P19 redesign; the
      // Palantir-style redesign is single-view. If a flow visualisation is
      // requested later it will be a separate side view, not a toggle.)

      // Wire interactions
      modalCard.querySelectorAll('[data-modal="cancel"]').forEach(el => el.addEventListener('click', closeEscalateModal));
      modalCard.querySelectorAll('[data-esc="toggle"]').forEach(el => el.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const id = el.dataset.id;
        if (_expanded.has(id)) _expanded.delete(id); else _expanded.add(id);
        renderModal();
      }));
      modalCard.querySelectorAll('[data-esc="pick"]').forEach(el => el.addEventListener('change', () => {
        const id = el.dataset.id;
        const d = getDestination(id);
        if (!d) return;
        if (el.checked) {
          if (!_selectedChannels[id] || _selectedChannels[id].size === 0) _selectedChannels[id] = new Set([d.contactMethods[0]]);
        } else {
          _selectedChannels[id] = new Set();
        }
        renderModal();
      }));
      modalCard.querySelectorAll('[data-esc="ch"]').forEach(el => el.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const id = el.dataset.id;
        const m = el.dataset.m;
        if (!_selectedChannels[id]) _selectedChannels[id] = new Set();
        if (_selectedChannels[id].has(m)) _selectedChannels[id].delete(m);
        else _selectedChannels[id].add(m);
        renderModal();
      }));
      modalCard.querySelector('[data-esc="apply-rec"]').addEventListener('click', () => {
        _selectedChannels = {};
        dests.forEach(d => { _selectedChannels[d.id] = new Set(rec.tiers.includes(d.tier) ? [d.contactMethods[0]] : []); });
        renderModal();
      });
      const previewBtn = modalCard.querySelector('[data-esc="preview-brief"]');
      if (previewBtn) previewBtn.addEventListener('click', () => openBriefPreview(eventId, () => {
        // "Send from preview" fires the escalation using currently selected channels
        const activeDests = Object.keys(_selectedChannels).filter(id => _selectedChannels[id].size > 0);
        if (!activeDests.length) { toast('Select at least one destination first', 'err'); return; }
        const payload = modalCard.querySelector('input[name="payload"]:checked').value;
        const message = document.getElementById('esc-message').value;
        const records = escalateEvent(eventId, { destinationIds: activeDests, payload, message });
        closeBriefPreview();
        closeEscalateModal();
        records.forEach((r, idx) => {
          setTimeout(() => updateEscalationStatus(eventId, r.id, 'delivered'), 1500 + idx * 300);
          setTimeout(() => updateEscalationStatus(eventId, r.id, 'read'), 4500 + idx * 500);
          if (Math.random() < 0.6 || getDestination(r.destinationId)?.type === 'internal') {
            setTimeout(() => updateEscalationStatus(eventId, r.id, 'acknowledged'), 8000 + idx * 800);
          }
        });
      }));
      modalCard.querySelector('[data-modal="send"]').addEventListener('click', () => {
        const activeDests = Object.keys(_selectedChannels).filter(id => _selectedChannels[id].size > 0);
        if (!activeDests.length) { toast('Select at least one destination', 'err'); return; }
        const payload = modalCard.querySelector('input[name="payload"]:checked').value;
        const message = document.getElementById('esc-message').value;
        const records = escalateEvent(eventId, { destinationIds: activeDests, payload, message });
        closeEscalateModal();
        records.forEach((r, idx) => {
          setTimeout(() => updateEscalationStatus(eventId, r.id, 'delivered'), 1500 + idx * 300);
          setTimeout(() => updateEscalationStatus(eventId, r.id, 'read'), 4500 + idx * 500);
          if (Math.random() < 0.6 || getDestination(r.destinationId)?.type === 'internal') {
            setTimeout(() => updateEscalationStatus(eventId, r.id, 'acknowledged'), 8000 + idx * 800);
          }
        });
      });
    };
    renderModal();
    modalBackdrop.addEventListener('click', (ev) => { if (ev.target === modalBackdrop) closeEscalateModal(); }, { once: true });
    modalBackdrop.style.display = 'flex';
  }

  // ── Detection Summary modal ──
  // Shown when operator clicks "View Detection Summary" on the SIGNAL LOST
  // panel. Consolidates every confirmed sensor detection this event has
  // produced (Kassø → Bjæverskov → CPH), so the operator sees a full
  // audit trail of the track's confirmed observations without any
  // fabricated live coordinates.
  function openDetectionSummary(eventId) {
    const e = getEvent(eventId);
    if (!e) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'det-summary-backdrop';
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(); });

    const lk = e.lastKnownPosition;
    // Initial site = origin (where first detection happened, always Kassø
    // for the cruise missile scenario). Last site = most recent detection
    // (updates automatically as Bjæverskov and CPH re-acquire the track).
    const lkSite = lk ? (SITES[lk.siteId]?.name || lk.siteId) : (SITES[e.siteId]?.name || e.siteId);
    const entrySite = SITES[e.siteId]?.name || e.siteId || 'Origin site';
    const reacquired = e.multiSiteTrack && e._reacquiredSites
      ? Array.from(e._reacquiredSites).map(sid => SITES[sid]?.name || sid).join(' · ')
      : 'None';
    const escalationCount = (e.escalations || []).length;
    const dispatched = e.awaitingNeutralization || e.outcome === 'neutralized' ? 'Yes · Flyvevåbnet QRA' : 'No';
    const evasion = e.projectionSnapshot && lk && Math.abs(lk.heading - e.projectionSnapshot.heading) > 8
      ? `Detected · ${Math.round(Math.abs(lk.heading - e.projectionSnapshot.heading))}° course change`
      : 'None recorded';

    backdrop.innerHTML = `
      <div class="det-summary-modal" role="dialog" aria-modal="true">
        <div class="det-summary-hdr">
          <div class="det-summary-title">Detection Summary · ${e.id}</div>
          <button class="det-summary-close" data-close>Close</button>
        </div>
        <div class="det-summary-section">
          <div class="det-summary-h">Track</div>
          <div class="det-summary-row"><span class="lbl">Type</span><span class="val">${e.droneType}</span></div>
          <div class="det-summary-row"><span class="lbl">Class</span><span class="val">${(e.classification || '').toUpperCase()}</span></div>
          <div class="det-summary-row"><span class="lbl">First seen</span><span class="val mono">${e.startTime.slice(11,19)}Z</span></div>
          <div class="det-summary-row"><span class="lbl">Duration</span><span class="val mono">${formatDuration(e.duration)}</span></div>
          <div class="det-summary-row"><span class="lbl">Confidence</span><span class="val mono">${e.confidence.toFixed(2)}</span></div>
        </div>
        <div class="det-summary-section">
          <div class="det-summary-h">Sensor Path</div>
          <div class="det-summary-row"><span class="lbl">Initial site</span><span class="val">${entrySite}</span></div>
          <div class="det-summary-row"><span class="lbl">Reacquired</span><span class="val">${reacquired}</span></div>
          <div class="det-summary-row"><span class="lbl">Last site</span><span class="val">${lkSite}</span></div>
        </div>
        ${lk ? `
        <div class="det-summary-section">
          <div class="det-summary-h">Last Confirmed Fix</div>
          <div class="det-summary-row"><span class="lbl">Position</span><span class="val mono">${lk.lat.toFixed(4)}°N ${lk.lon.toFixed(4)}°E</span></div>
          <div class="det-summary-row"><span class="lbl">Altitude</span><span class="val mono">${lk.alt} m AGL</span></div>
          <div class="det-summary-row"><span class="lbl">Speed</span><span class="val mono">${lk.speed} m/s</span></div>
          <div class="det-summary-row"><span class="lbl">Heading</span><span class="val mono">${lk.heading}°</span></div>
          <div class="det-summary-row"><span class="lbl">Timestamp</span><span class="val mono">${lk.timestamp ? lk.timestamp.slice(11,19) + 'Z' : '—'}</span></div>
        </div>` : ''}
        <div class="det-summary-section">
          <div class="det-summary-h">Response</div>
          <div class="det-summary-row"><span class="lbl">Escalations</span><span class="val">${escalationCount}</span></div>
          <div class="det-summary-row"><span class="lbl">Fighter dispatched</span><span class="val">${dispatched}</span></div>
          <div class="det-summary-row"><span class="lbl">Evasion</span><span class="val">${evasion}</span></div>
          <div class="det-summary-row"><span class="lbl">Outcome</span><span class="val">${e.outcome === 'neutralized' ? 'Neutralised · ' + (e.neutralizedAt ? e.neutralizedAt.slice(11,19) + 'Z' : '') : 'Active — awaiting cross cue'}</span></div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-close]').addEventListener('click', close);
  }

  // ── Aircraft info popup ──────────────────────────────────────────
  // Universal modal opened from any info icon anywhere in the app (dispatch
  // card, tactical assets, PDF preview, fleet browser). Renders the SVG
  // silhouette on a branded dark panel + full specs grid. Palantir style.
  function openAircraftInfo(aircraftId) {
    const a = AIRCRAFT[aircraftId];
    if (!a) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'acinfo-backdrop';
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(); });
    const escHandler = (ev) => { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    backdrop.innerHTML = `
      <div class="acinfo-modal" role="dialog" aria-modal="true">
        <button class="acinfo-close" data-close aria-label="Close">×</button>
        <div class="acinfo-hero">
          ${a.image
            ? `<img class="acinfo-hero-img" src="${a.image}" alt="${a.designation}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling && (this.nextElementSibling.style.display='block')"/>
               <div class="acinfo-hero-svg" style="display:none">${a.svg}</div>`
            : `<div class="acinfo-hero-svg">${a.svg}</div>`}
        </div>
        <div class="acinfo-body">
          <div class="acinfo-eyebrow">Airframe · ${a.baseName || a.baseId || '—'}</div>
          <div class="acinfo-name">${a.designation}</div>
          <div class="acinfo-role">${a.role}</div>
          <div class="acinfo-grid">
            ${[
              { k: 'Inventory',        v: a.inventory,      mono: true,  wide: false },
              { k: 'Crew',             v: a.crew,           mono: true,  wide: false },
              { k: 'Max speed',        v: a.maxSpeed,       mono: true,  wide: false },
              { k: 'Cruise speed',     v: a.cruiseSpeed,    mono: true,  wide: false },
              { k: 'Combat radius',    v: a.combatRadius,   mono: true,  wide: false },
              { k: 'Range',            v: a.range,          mono: true,  wide: false },
              { k: 'Ceiling',          v: a.ceiling,        mono: true,  wide: false },
              { k: 'Max G',            v: a.maxG,           mono: true,  wide: false },
              { k: 'Internal fuel',    v: a.internalFuel,   mono: true,  wide: false },
              { k: 'Propulsion',       v: a.propulsion,     mono: false, wide: true  },
              { k: 'Thrust',           v: a.thrust,         mono: true,  wide: true  },
              { k: 'Armament',         v: a.armament,       mono: false, wide: true  },
              { k: 'Payload',          v: a.payload,        mono: false, wide: true  },
              { k: 'Dimensions',       v: a.dimensions,     mono: true,  wide: true  },
            ].filter(row => row.v != null && row.v !== '').map(row =>
              `<div class="acinfo-kv${row.wide ? ' wide' : ''}"><span class="k">${row.k}</span><span class="v${row.mono ? ' mono' : ''}">${row.v}</span></div>`
            ).join('')}
          </div>
          ${a.specSource ? `<div class="acinfo-spec-src">Source: ${a.specSource}</div>` : ''}
          <div class="acinfo-section">
            <div class="acinfo-h">Best For</div>
            <div class="acinfo-p">${a.bestFor || '—'}</div>
          </div>
          ${a.notAppropriate ? `
          <div class="acinfo-section">
            <div class="acinfo-h dim">Not Appropriate</div>
            <div class="acinfo-p dim">${a.notAppropriate}</div>
          </div>` : ''}
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-close]').addEventListener('click', close);
  }

  // Global delegated handler for [data-aircraft-info] triggers anywhere.
  document.addEventListener('click', (ev) => {
    const trigger = ev.target.closest?.('[data-aircraft-info]');
    if (trigger) {
      ev.stopPropagation();
      openAircraftInfo(trigger.dataset.aircraftInfo);
    }
  });

  // ── Inline forms for Re-classify + Add Note ──
  function openReclassifyForm(eventId) {
    const area = document.getElementById('dp-actions-area');
    if (!area) return;
    const e = getEvent(eventId);
    const currentKey = e.classification === 'hostile'
      ? `hostile-${e.threat || 'medium'}`
      : e.classification;
    area.innerHTML = `
      <div class="dp-form">
        <div class="dp-form-title">Reclassify Event</div>
        <select class="dp-form-select" id="reclass-select">
          <option value="hostile-high"   ${currentKey==='hostile-high'?'selected':''}>Hostile, High Threat</option>
          <option value="hostile-medium" ${currentKey==='hostile-medium'?'selected':''}>Hostile, Medium Threat</option>
          <option value="hostile-low"    ${currentKey==='hostile-low'?'selected':''}>Hostile, Low Threat</option>
          <option value="friendly"       ${currentKey==='friendly'?'selected':''}>Friendly ID</option>
          <option value="resolved"       ${currentKey==='resolved'?'selected':''}>Resolved, False Positive</option>
          <option value="unknown"        ${currentKey==='unknown'?'selected':''}>Unknown, Under Review</option>
        </select>
        <textarea class="dp-form-text" id="reclass-reason" rows="2" placeholder="Reason (optional)"></textarea>
        <div class="dp-form-actions">
          <button class="btn" data-form="cancel">Cancel</button>
          <button class="btn primary" data-form="save-reclass">Save</button>
        </div>
      </div>`;
    area.querySelector('[data-form="cancel"]').addEventListener('click', renderDetailPanel);
    area.querySelector('[data-form="save-reclass"]').addEventListener('click', () => {
      const val = document.getElementById('reclass-select').value;
      const reason = document.getElementById('reclass-reason').value;
      let classification = val, threat = null;
      if (val.startsWith('hostile-')) { classification = 'hostile'; threat = val.split('-')[1]; }
      reclassifyEvent(eventId, { classification, threat, reason });
    });
  }

  function openNoteForm(eventId) {
    const area = document.getElementById('dp-actions-area');
    if (!area) return;
    area.innerHTML = `
      <div class="dp-form">
        <div class="dp-form-title">Add Operator Note</div>
        <textarea class="dp-form-text" id="note-text" rows="4" placeholder="Note text..." autofocus></textarea>
        <div class="dp-form-actions">
          <button class="btn" data-form="cancel">Cancel</button>
          <button class="btn primary" data-form="save-note">Save</button>
        </div>
      </div>`;
    area.querySelector('[data-form="cancel"]').addEventListener('click', renderDetailPanel);
    area.querySelector('[data-form="save-note"]').addEventListener('click', () => {
      const txt = document.getElementById('note-text').value;
      if (!txt.trim()) return;
      addNote(eventId, txt);
    });
    setTimeout(() => document.getElementById('note-text')?.focus(), 20);
  }

  // ── Filter chip clicks ──
  alertFiltersEl.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      setFilter(chip.dataset.filter);
      alertFiltersEl.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.filter === chip.dataset.filter));
    });
  });

  // ── Re-render on state changes ──
  // Per-event ENTRY/EXIT/OOR markers are visible for a given event only
  // when that event is either selected OR still live (drone active).
  // Prevents old-event markers from lingering forever after the drone is
  // gone, while keeping live events visible even if the operator hasn't
  // clicked them in the ledger.
  // If an event has entry/exit/OOR data saved but its markers were cleaned
  // up (drone finished + GHOST_MS elapsed), recreate them from data. Lets
  // re-selecting an old event from the ledger re-show its key coordinates.
  function _ensureEventMarkersFromData(eventId) {
    if (!eventId) return;
    const list = _perEventMarkers.get(eventId);
    if (list && list.length > 0) return;   // already exist
    const event = getEvent(eventId);
    if (!event) return;
    const tstamp = (iso) => (iso || new Date().toISOString()).slice(11, 19);
    let recreated = 0;
    // Single-site path — event.entry / .exit / .outOfRange
    if (event.entry?.lat != null) {
      _dropMarker(event.entry.lat, event.entry.lon, '#4dd2ff', `ENTRY ${tstamp(event.entry.timestamp)}Z`, eventId);
      recreated++;
    }
    if (event.exit?.lat != null) {
      const label = event.exit.leftCoverageOf
        ? `EXIT ${tstamp(event.exit.timestamp)}Z · cleared ${event.exit.leftCoverageOf}`
        : `EXIT ${tstamp(event.exit.timestamp)}Z`;
      _dropMarker(event.exit.lat, event.exit.lon, '#ffb84d', label, eventId);
      recreated++;
    }
    if (event.outOfRange?.lat != null) {
      _dropMarker(event.outOfRange.lat, event.outOfRange.lon, '#ff5a5a', `OUT OF RANGE ${tstamp(event.outOfRange.timestamp)}Z · signal lost`, eventId);
      recreated++;
    }
    // Multi-site path — event.perSiteCrossings array (populated by
    // processPerSiteMarkers for cruise-missile / cross-site tracks)
    if (Array.isArray(event.perSiteCrossings)) {
      for (const c of event.perSiteCrossings) {
        if (c.lat == null || c.lon == null) continue;
        _dropMarker(c.lat, c.lon, c.color || '#4dd2ff', c.label || c.kind || 'crossing', eventId);
        recreated++;
      }
    }
    if (recreated > 0) {
      console.log(`[markers] recreated ${recreated} markers for event ${eventId} from saved data`);
    }
  }

  function _refreshEventMarkerVisibility() {
    const selected = getSelectedEventId();
    // Ensure markers exist for the newly-selected event (re-create from
    // event data if the live entities were already cleaned up)
    if (selected) _ensureEventMarkersFromData(selected);
    // Iterate a snapshot — we may mutate the map inside the loop
    const eventIds = Array.from(_perEventMarkers.keys());
    for (const eventId of eventIds) {
      const st = droneState.get(eventId);
      const isLive = !!(st && !st.closedAt);
      const isSelected = eventId === selected;
      if (isSelected || isLive) {
        _setEventMarkersVisibility(eventId, true);
      } else {
        // REMOVE (not just hide) — hidden entities were still leaking
        // stale references AND Cesium's Property.show=undefined defaulted
        // to visible on some builds, keeping markers on-map after Exit.
        _removeEventMarkers(eventId);
      }
    }
    viewer.scene.requestRender();
  }
  onSelectionChange(() => {
    renderAlertStrip();
    renderDetailPanel();
    updateContributingRings();
    _refreshEventMarkerVisibility();
  });
  onFilterChange(() => renderAlertStrip());

  // Initial render
  renderAlertStrip();
  renderDetailPanel();

  // ── Panel collapse toggles ──
  const alertToggle = document.getElementById('alert-strip-toggle');
  const alertStrip = document.getElementById('alert-strip');
  const detailToggle = document.getElementById('detail-panel-toggle');
  const detailPanel = document.getElementById('detail-panel');

  alertToggle.addEventListener('click', () => {
    const collapsed = alertStrip.classList.toggle('collapsed');
    alertToggle.classList.toggle('collapsed', collapsed);
    alertToggle.textContent = collapsed ? '›' : '‹';
    document.body.classList.toggle('alerts-collapsed', collapsed);
  });
  detailToggle.addEventListener('click', () => {
    const collapsed = detailPanel.classList.toggle('collapsed');
    detailToggle.classList.toggle('collapsed', collapsed);
    detailToggle.textContent = collapsed ? '‹' : '›';
    document.body.classList.toggle('details-collapsed', collapsed);
    // Sync anchored elements. When collapsed, clear inline `right` so the
    // CSS `.collapsed { right: 0 }` rule wins. When expanded, reapply the
    // inline right based on current panel width.
    const cp = document.getElementById('control-panel');
    if (collapsed) {
      if (cp) cp.style.right = '';
      detailToggle.style.right = '';
    } else {
      const w = Math.round(detailPanel.getBoundingClientRect().width);
      if (cp) cp.style.right = `${w + 12}px`;
      detailToggle.style.right = `${w}px`;
    }
  });
  // Resize handle on the left edge — drag to widen/shrink the detail
  // panel. Width persisted to localStorage so it survives reloads.
  // The control panel (map imagery/overlay toggles) and the collapse
  // toggle button both anchor to the detail panel's left edge and are
  // synced live during drag.
  const detailResizeHandle = document.getElementById('detail-resize-handle');
  const DP_WIDTH_KEY = 'isr_detail_panel_width_px';
  const DP_MIN = 380, DP_MAX = 900;
  const _syncDpAnchoredElements = (widthPx) => {
    if (document.body.classList.contains('details-collapsed')) return;
    const cp = document.getElementById('control-panel');
    const tg = document.getElementById('detail-panel-toggle');
    if (cp) cp.style.right = `${widthPx + 12}px`;
    if (tg) tg.style.right = `${widthPx}px`;
  };
  const savedWidth = parseInt(localStorage.getItem(DP_WIDTH_KEY) || '', 10);
  if (savedWidth >= DP_MIN && savedWidth <= DP_MAX) {
    detailPanel.style.width = `${savedWidth}px`;
    _syncDpAnchoredElements(savedWidth);
  }
  if (detailResizeHandle) {
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    detailResizeHandle.addEventListener('mousedown', (ev) => {
      dragging = true;
      startX = ev.clientX;
      startWidth = detailPanel.getBoundingClientRect().width;
      detailResizeHandle.classList.add('dragging');
      document.body.classList.add('dp-resizing');
      ev.preventDefault();
    });
    window.addEventListener('mousemove', (ev) => {
      if (!dragging) return;
      // Panel is anchored right → dragging left INCREASES width
      const dx = startX - ev.clientX;
      const next = Math.max(DP_MIN, Math.min(DP_MAX, startWidth + dx));
      detailPanel.style.width = `${next}px`;
      _syncDpAnchoredElements(next);
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      detailResizeHandle.classList.remove('dragging');
      document.body.classList.remove('dp-resizing');
      const w = Math.round(detailPanel.getBoundingClientRect().width);
      localStorage.setItem(DP_WIDTH_KEY, String(w));
    });
  }

  // ── Live clocks ──
  const utcEl = document.getElementById('clock-utc');
  const localEl = document.getElementById('clock-local');
  const pad = (n) => String(n).padStart(2, '0');
  function tickClocks() {
    const now = new Date();
    if (utcEl) utcEl.textContent = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    if (localEl) localEl.textContent = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  tickClocks();
  setInterval(tickClocks, 1000);

  // ══════════════════════════════════════════
  // TOP BAR VIEW SWITCHER (Live Ops / History / Fleet)
  // ══════════════════════════════════════════
  let _activeView = 'live';
  const historyView = document.getElementById('history-view');
  const fleetView = document.getElementById('fleet-view');
  let _historyFilters = { site: 'all', class: 'all', search: '' };
  let _historyEventId = null;

  const configView = document.getElementById('config-view');
  function setActiveView(view) {
    _activeView = view;
    document.querySelectorAll('.tb-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    document.body.classList.toggle('view-history', view === 'history');
    document.body.classList.toggle('view-fleet', view === 'fleet');
    document.body.classList.toggle('view-config', view === 'config');
    document.body.classList.toggle('view-live', view === 'live');
    historyView.style.display = view === 'history' ? 'block' : 'none';
    fleetView.style.display = view === 'fleet' ? 'block' : 'none';
    if (configView) configView.style.display = view === 'config' ? 'block' : 'none';
    if (view === 'history') { renderHistory(); updateStatusBar(null); }
    else if (view === 'fleet') { renderFleet(); updateStatusBar(null); }
    else if (view === 'config') { renderConfigView(); updateStatusBar(null); }
    else updateStatusBar(_currentSiteScope);
  }
  document.querySelectorAll('.tb-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveView(btn.dataset.view));
  });
  const brandLogo = document.querySelector('.tb-brand .brand-logo');
  if (brandLogo) {
    brandLogo.style.cursor = 'pointer';
    brandLogo.title = 'Back to Live Ops';
    brandLogo.addEventListener('click', () => setActiveView('live'));
  }

  // ── History view ──
  function renderHistory() {
    if (_activeView !== 'history') return;
    const allEvents = [...EVENTS].sort((a, b) => b.startTime.localeCompare(a.startTime));
    const filtered = allEvents.filter(e => {
      if (_historyFilters.site !== 'all' && e.siteId !== _historyFilters.site) return false;
      if (_historyFilters.class !== 'all' && e.classification !== _historyFilters.class) return false;
      if (_historyFilters.search) {
        const q = _historyFilters.search.toLowerCase();
        if (!e.id.toLowerCase().includes(q) && !(e.droneType || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const selectedEv = _historyEventId ? filtered.find(e => e.id === _historyEventId) : null;

    const list = filtered.length ? filtered.map(e => {
      const isActive = e.status === 'active';
      const isSel = e.id === _historyEventId;
      return `
        <div class="hst-row ${e.classification} ${isSel ? 'is-selected' : ''}" data-hst="pick" data-id="${e.id}">
          <div class="hst-row-time">
            <div class="hst-row-date">${e.startTime.slice(0,10)}</div>
            <div class="hst-row-hm">${e.startTime.slice(11,16)}Z</div>
          </div>
          <div class="hst-row-body">
            <div class="hst-row-hdr">
              <span class="rcv-card-cls rcv-cls-${e.classification}">${(e.classification || '').toUpperCase()}</span>
              ${isActive ? '<span class="alert-live">● LIVE</span>' : ''}
              <span class="hst-row-conf">${Math.round(e.confidence * 100)}%</span>
            </div>
            <div class="hst-row-drone">${e.droneType}</div>
            <div class="hst-row-meta">${e.id}  ·  ${siteName(e.siteId)}  ·  ${formatDuration(e.duration)}</div>
          </div>
        </div>`;
    }).join('') : `<div class="rcv-empty">No events match the current filters.</div>`;

    const detail = selectedEv ? `
      <div class="hst-detail-hdr">
        <div>
          <div class="hst-detail-eid">${selectedEv.id}</div>
          <div class="hst-detail-drone">${selectedEv.droneType}</div>
          <div class="hst-detail-meta">${siteName(selectedEv.siteId)}  ·  ${selectedEv.startTime.slice(0,10)}  ·  ${selectedEv.startTime.slice(11,19)}Z to ${(selectedEv.endTime || selectedEv.startTime).slice(11,19)}Z  ·  ${formatDuration(selectedEv.duration)}</div>
        </div>
      </div>
      <div class="hst-brief-wrap">${renderDetectionBrief(selectedEv)}</div>
      ${selectedEv.escalations && selectedEv.escalations.length ? `
        <div class="hst-esc-section">
          <div class="hst-section-hdr">Escalation Log · ${selectedEv.escalations.length}</div>
          ${selectedEv.escalations.map(esc => `
            <div class="hst-esc-row">
              <b>${getDestination(esc.destinationId)?.name || esc.destinationId}</b>
              <span class="hst-esc-status">${(esc.status || '').toUpperCase()}</span>
              <span class="hst-esc-time">${esc.initiatedAt.slice(11,19)}Z</span>
              ${esc.response ? `<div class="hst-esc-response">Response by ${esc.response.respondedBy}: "${esc.response.text}"</div>` : ''}
            </div>`).join('')}
        </div>` : ''}
      ${selectedEv.notes && selectedEv.notes.length ? `
        <div class="hst-esc-section">
          <div class="hst-section-hdr">Operator Notes · ${selectedEv.notes.length}</div>
          ${selectedEv.notes.map(n => `
            <div class="hst-note">
              <div class="hst-note-meta">${n.author}  ·  ${n.timestamp.slice(11,19)}Z  ${n.type === 'reclassification' ? '<span class="dp-note-badge">RECLASSIFY</span>' : ''}${n.type === 'escalation' ? '<span class="dp-note-badge">ESCALATION</span>' : ''}</div>
              <div class="hst-note-text">${n.text}</div>
            </div>`).join('')}
        </div>` : ''}
    ` : `<div class="rcv-empty rcv-empty-detail">Select an event on the left to view the full record.</div>`;

    historyView.innerHTML = `
      <aside class="hst-list">
        <div class="hst-filters">
          <div class="hst-filter-row">
            <input type="search" class="cfg-input" id="hst-search" placeholder="Search event ID or drone type..." value="${_historyFilters.search}" />
          </div>
          <div class="hst-filter-row">
            <select class="cfg-input" id="hst-site">
              <option value="all"      ${_historyFilters.site==='all'?'selected':''}>All sites</option>
              <option value="cph"      ${_historyFilters.site==='cph'?'selected':''}>CPH Airport</option>
              <option value="esbjerg"  ${_historyFilters.site==='esbjerg'?'selected':''}>Esbjerg Harbour</option>
            </select>
            <select class="cfg-input" id="hst-class">
              <option value="all"       ${_historyFilters.class==='all'?'selected':''}>All classes</option>
              <option value="hostile"   ${_historyFilters.class==='hostile'?'selected':''}>Hostile</option>
              <option value="friendly"  ${_historyFilters.class==='friendly'?'selected':''}>Friendly</option>
              <option value="resolved"  ${_historyFilters.class==='resolved'?'selected':''}>Resolved</option>
              <option value="unknown"   ${_historyFilters.class==='unknown'?'selected':''}>Unknown</option>
            </select>
          </div>
        </div>
        <div class="hst-list-count">${filtered.length} events</div>
        <div class="rcv-list-body">${list}</div>
      </aside>
      <main class="hst-detail">${detail}</main>
    `;

    historyView.style.display = 'flex';
    historyView.querySelector('#hst-search').addEventListener('input', (ev) => { _historyFilters.search = ev.target.value; renderHistory(); });
    historyView.querySelector('#hst-site').addEventListener('change', (ev) => { _historyFilters.site = ev.target.value; renderHistory(); });
    historyView.querySelector('#hst-class').addEventListener('change', (ev) => { _historyFilters.class = ev.target.value; renderHistory(); });
    historyView.querySelectorAll('[data-hst="pick"]').forEach(el => el.addEventListener('click', () => { _historyEventId = el.dataset.id; renderHistory(); }));
  }

  // ── Fleet view (sensor health across all sites) ──
  function renderFleet() {
    if (_activeView !== 'fleet') return;
    const sites = Object.values(SITES);
    fleetView.innerHTML = `
      <div class="flt-hdr">
        <div class="flt-hdr-title">Sensor Fleet</div>
        <div class="flt-hdr-meta">${sites.length} sites  ·  ${sites.reduce((n, s) => n + s.sensors.length, 0)} sensors total</div>
      </div>
      ${sites.map(site => {
        const online = site.sensors.filter(s => s.status === 'online').length;
        const degraded = site.sensors.filter(s => s.status === 'degraded').length;
        const offline = site.sensors.filter(s => s.status === 'offline').length;
        return `
          <section class="flt-site">
            <div class="flt-site-hdr">
              <span class="flt-site-name">${site.name}</span>
              <span class="flt-site-summary">
                <span class="flt-badge flt-badge-online">${online} online</span>
                ${degraded ? `<span class="flt-badge flt-badge-degraded">${degraded} degraded</span>` : ''}
                ${offline ? `<span class="flt-badge flt-badge-offline">${offline} offline</span>` : ''}
              </span>
            </div>
            <table class="flt-table">
              <thead>
                <tr>
                  <th>Node</th><th>Label</th><th>Hardware</th><th>Modalities</th>
                  <th style="text-align:right;">Coverage</th><th style="text-align:right;">24h detections</th>
                  <th>Status</th><th>Issue</th>
                </tr>
              </thead>
              <tbody>
                ${site.sensors.map(s => `
                  <tr class="flt-row flt-${s.status}">
                    <td class="mono">${s.id}${s.isCore ? ' <span class="flt-core">CORE</span>' : ''}</td>
                    <td>${s.label}</td>
                    <td class="mono dim">${s.hardware}</td>
                    <td class="mono dim">${(s.modalities || []).join(', ')}</td>
                    <td style="text-align:right;" class="mono">${s.coverageRadius} m</td>
                    <td style="text-align:right;" class="mono">${s.detectionsLast24h}</td>
                    <td><span class="flt-status flt-status-${s.status}">${s.status.toUpperCase()}</span></td>
                    <td class="dim">${s.issues || ''}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </section>`;
      }).join('')}
    `;
    fleetView.style.display = 'block';
  }

  onSelectionChange(() => { if (_activeView === 'history') renderHistory(); });

  // ── Config view (top-nav tab) ──
  function renderConfigView() {
    if (!configView) return;
    const dests = getAllDestinations();
    const rules = getRules();
    const activeRulesCount = rules.filter(r => r.enabled).length;
    const destBySite = dests.reduce((m, d) => { m[d.siteId] = (m[d.siteId] || 0) + 1; return m; }, {});
    const siteRows = Object.keys(SITES).map(sid => {
      const s = SITES[sid];
      return `<div class="cfg-site-row"><span>${s.name}</span><span class="mono dim">${destBySite[sid] || 0} destinations</span></div>`;
    }).join('');
    configView.innerHTML = `
      <div class="cfg-hdr">
        <div class="cfg-hdr-t">Configuration</div>
        <div class="cfg-hdr-sub">Destinations, escalation rules, and per-site setup. Not a live-ops surface. Changes take effect immediately.</div>
      </div>
      <div class="cfg-grid">
        <section class="cfg-card">
          <div class="cfg-card-hdr">
            <div class="cfg-card-t">Destinations</div>
            <div class="cfg-card-meta">${dests.length} total across ${Object.keys(destBySite).length} sites</div>
          </div>
          <div class="cfg-card-body">
            <p class="cfg-desc">Escalation endpoints. Each destination has a tier (T1/T2/T3/T4), channel (email, SMS, Signal, radio, MIP), and receiver mapping. Operators dispatch here.</p>
            <div class="cfg-site-list">${siteRows}</div>
            <button class="cp-btn wide primary" id="cfg-open-dest">Open Destinations Editor</button>
          </div>
        </section>
        <section class="cfg-card">
          <div class="cfg-card-hdr">
            <div class="cfg-card-t">Auto-Escalation Rules</div>
            <div class="cfg-card-meta">${activeRulesCount} active / ${rules.length} total</div>
          </div>
          <div class="cfg-card-body">
            <p class="cfg-desc">Rule conditions that auto fire escalations without operator input. E.g. missile → all tiers, hostile fixed wing after 60s → +T3.</p>
            <ul class="cfg-rule-list">${rules.slice(0, 6).map(r => `<li><span class="cfg-rule-dot ${r.enabled ? 'on' : 'off'}"></span>${r.name || ruleSummaryText(r)}</li>`).join('')}</ul>
            <button class="cp-btn wide primary" id="cfg-open-rules">Open Rules Editor</button>
          </div>
        </section>
      </div>
    `;
    const openDest = configView.querySelector('#cfg-open-dest');
    const openRules = configView.querySelector('#cfg-open-rules');
    if (openDest) openDest.addEventListener('click', () => window.__openConfigModal && window.__openConfigModal());
    if (openRules) openRules.addEventListener('click', () => window.__openRulesModal && window.__openRulesModal());
  }
  onDestinationsChange(() => { if (_activeView === 'config') renderConfigView(); });
  onRulesChange(() => { if (_activeView === 'config') renderConfigView(); });

  // ══════════════════════════════════════════
  // ROLE SWITCHER + RECEIVER DASHBOARD (Phase 2)
  // ══════════════════════════════════════════
  const tbOperator = document.getElementById('tb-operator');
  const roleMenu = document.getElementById('role-menu');
  const opAvatarEl = document.getElementById('op-avatar');
  const opNameEl = document.getElementById('op-name');
  const opRoleEl = document.getElementById('op-role');
  const receiverView = document.getElementById('receiver-view');
  let _selectedReceiverEventId = null;
  let _respondingEscId = null;
  // Event Workspace state — when set, receiver view switches from inbox
  // to workspace mode (top bar + center + right pillar). Mode toggles
  // between 'report' (case-file layout) and 'map' (full Cesium focus).
  let _workspaceEventId = null;
  let _workspaceMode = 'report';   // 'report' | 'map'

  function renderRoleMenu() {
    const active = getActiveRole();
    const opCard = (o) => `
      <button class="acct-card op ${o.id === active.id ? 'on' : ''}" data-role="${o.id}">
        <span class="acct-logo">${o.logo ? `<img src="${o.logo}" alt="${o.org}" />` : `<span class="acct-mark" style="background:${o.brandTint};">${o.initials}</span>`}</span>
        <span class="acct-body">
          <span class="acct-top">
            <span class="acct-name">${o.org}</span>
            <span class="acct-badge ${o.isMultiSite ? 'multi' : 'single'}">${o.isMultiSite ? 'Multi-site' : 'Single-site'}</span>
          </span>
          <span class="acct-desc">${o.description}</span>
          <span class="acct-meta">
            <span>${o.siteIds.length} site${o.siteIds.length === 1 ? '' : 's'}</span>
            <span class="acct-dot">·</span>
            <span>${o.sensorCount} sensors</span>
            <span class="acct-dot">·</span>
            <span>${o.sector}</span>
          </span>
        </span>
      </button>`;
    const rxCard = (r) => `
      <button class="acct-card rx ${r.id === active.id ? 'on' : ''}" data-role="${r.id}">
        <span class="acct-mark rx-tone">${r.initials}</span>
        <span class="acct-body">
          <span class="acct-top">
            <span class="acct-name">${r.org}</span>
            <span class="acct-badge scope">${r.scope}</span>
          </span>
          <span class="acct-desc">${r.description}</span>
        </span>
      </button>`;
    const adminCard = (a) => `
      <button class="acct-card admin ${a.id === active.id ? 'on' : ''}" data-role="${a.id}">
        <span class="acct-logo">${a.logo ? `<img src="${a.logo}" alt="${a.org}" />` : `<span class="acct-mark admin-tone">${a.initials}</span>`}</span>
        <span class="acct-body">
          <span class="acct-top">
            <span class="acct-name">${a.org}</span>
            <span class="acct-badge admin-badge">Full access</span>
          </span>
          <span class="acct-desc">${a.description}</span>
        </span>
      </button>`;

    roleMenu.innerHTML = `
      <div class="acct-hdr">
        <span class="acct-hdr-t">Switch Account</span>
        <span class="acct-hdr-note">Testing mode. Prod is login-based.</span>
      </div>

      <div class="acct-group">
        <div class="acct-group-lbl">Operator accounts</div>
        ${OPERATORS.map(opCard).join('')}
      </div>

      <div class="acct-group">
        <div class="acct-group-lbl">Receiver accounts</div>
        ${RECEIVERS.map(rxCard).join('')}
      </div>

      <div class="acct-group">
        <div class="acct-group-lbl">Admin</div>
        ${adminCard(ADMIN)}
      </div>`;

    roleMenu.querySelectorAll('[data-role]').forEach(btn => {
      btn.addEventListener('click', () => { setActiveRole(btn.dataset.role); roleMenu.style.display = 'none'; });
    });
  }

  function updateOperatorChip() {
    const r = getActiveRole();
    // If the account has a brand logo, render it in the chip. Otherwise fall
    // back to initials.
    if (r.logo) {
      opAvatarEl.innerHTML = `<img src="${r.logo}" alt="${r.org}" />`;
      opAvatarEl.classList.add('with-logo');
    } else {
      opAvatarEl.innerHTML = '';
      opAvatarEl.textContent = r.initials;
      opAvatarEl.classList.remove('with-logo');
    }
    opNameEl.textContent = r.person;
    const roleLabel =
      r.kind === 'admin'    ? `Admin · ${r.org}` :
      r.kind === 'operator' ? `Operator · ${r.org}` :
      r.kind === 'receiver' ? `Receiver · ${r.org}` :
      r.label;
    opRoleEl.textContent = roleLabel;
    document.body.classList.toggle('mode-receiver', r.kind === 'receiver');
    document.body.classList.toggle('mode-operator', r.kind === 'operator');
    document.body.classList.toggle('mode-admin', r.kind === 'admin');
    if (r.kind === 'receiver') renderReceiverView(); else receiverView.style.display = 'none';
  }

  // ══════════════════════════════════════════════════════════════════
  // P95 · Workspace Mission Console (lean right panel for case-file)
  // ══════════════════════════════════════════════════════════════════
  // Purpose-built for the workspace aside. Shows the DetectionSubject
  // one-liner, the graduated-response rationale, dispatch buttons
  // scoped to the current role, and live status of any active
  // dispatches for this event. Deliberately excludes the SVG scramble
  // cockpit, Flyvevåbnet-specific dispatch block, and other content
  // from the inbox-side Response Overlay to avoid the layout collision
  // that broke the workspace during the P89 attempt.
  function renderWorkspaceMissionConsole(event) {
    const activeRole = getActiveRole();
    const threatLat = event.lastPosition?.lat ?? event.entry?.lat;
    const threatLon = event.lastPosition?.lon ?? event.entry?.lon;
    if (threatLat == null || threatLon == null) {
      return `
        <div class="c-panel">
          <div class="c-section-eyebrow">Mission Console</div>
          <p style="color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.55; margin-top: var(--space-3);">Awaiting first sensor fix for this event.</p>
        </div>`;
    }
    const bundle = event.subject
      ? responseBundleForSubject(event.subject, threatLat, threatLon)
      : responseBundle(threatLat, threatLon);

    // Role-scoping (P90) — restricted to this role's jurisdictional
    // asset kinds. Other roles' assets show as "OTHER AGENCY" label
    // so the operator sees full picture of who is on the case.
    const DISPATCHABLE_KINDS_MC = new Set([
      'helicopter-intercept', 'army-c-uas', 'police-c-uas',
      'army-isr-drone', 'sof-tactical', 'wildlife-response', 'counter-drone-swarm',
    ]);
    const ROLE_SCOPE_MC = {
      'flv-skrydstrup': new Set(['helicopter-intercept']),
      'flv-karup':      new Set(['helicopter-intercept']),
      'haer-slagelse':  new Set(['army-c-uas', 'army-isr-drone']),
      'haer-hovelte':   new Set(['army-ground']),
      'haer-varde':     new Set(['army-isr-drone', 'army-c-uas', 'counter-drone-swarm']),
      'haer-bornholm':  new Set(['army-c-uas']),
      'haer-oksbol':    new Set(['army-c-uas']),
      'sok-aalborg':    new Set(['sof-tactical']),
      'forsvarskmd':    new Set(['helicopter-intercept', 'army-c-uas', 'army-isr-drone', 'army-ground', 'sof-tactical', 'counter-drone-swarm']),
      'fe':             new Set(['army-isr-drone']),
      'rigspoliti':     new Set(['police-c-uas', 'counter-drone-swarm']),
      'politi-kbh':     new Set(['police-c-uas']),
      'politi-sydvest': new Set(['police-c-uas']),
      'op-cph-airports':new Set(['wildlife-response']),
      'op-esbjerg-port':new Set(['wildlife-response']),
      'op-energinet':   new Set([]),
      'flv-qra':        new Set(['helicopter-intercept']),   // legacy alias
    };
    const roleScopeMc = ROLE_SCOPE_MC[activeRole?.id] || null;
    const canDispatchMc = (kind) => (activeRole?.kind === 'admin')
      || (roleScopeMc ? roleScopeMc.has(kind) : false);

    // Subject one-liner for orientation
    const subj = event.subject;
    const subjectLine = subj
      ? `${subj.class.replace(/_/g, ' ')} · ${subj.cardinality?.kind || 'single'} · ${Math.round((subj.class_confidence || 0) * 100)}% confidence`
      : `${event.platform || 'unknown'} · ${Math.round((event.confidence || 0) * 100)}% confidence`;

    // Assets to show: tactical bundle, split into dispatchable-by-me
    // and other-agency lists.
    const tactical = bundle.tactical || [];
    const mineList = tactical.filter(a => DISPATCHABLE_KINDS_MC.has(a.kind) && canDispatchMc(a.kind));
    const otherList = tactical.filter(a => DISPATCHABLE_KINDS_MC.has(a.kind) && !canDispatchMc(a.kind));

    // Rich response option card. Shows what the option INCLUDES, what
    // it's typically DEPLOYED FOR, and its TRADEOFFS — before the duty
    // officer commits. Metadata sourced from RESPONSE_OPTION_DETAILS in
    // response_assets.js (doctrine layer, config-driven).
    // The first item in mineList is the closest asset by ETA (bundle
    // is already sorted). Flag it as Recommended so operators see the
    // graduated-response system's top pick at a glance.
    const dispatchRow = (a, idx) => {
      const cdState = counterDispatchStateFor(event.id, a.id);
      const stateLabel = { en_route: 'EN ROUTE', engaging: 'ENGAGING', complete: 'COMPLETE' }[cdState];
      const stateColor = cdState === 'complete' ? '#6b7280' : cdState === 'engaging' ? '#ffb84d' : '#4dd2ff';
      const details = RESPONSE_OPTION_DETAILS[a.kind] || {};
      const recommendedBadge = idx === 0
        ? `<span style="display: inline-flex; align-items: center; padding: 2px 8px; background: rgba(77, 210, 255, 0.12); border: 1px solid rgba(77, 210, 255, 0.5); color: var(--accent); font-family: var(--font-mono); font-size: var(--fs-2xs); letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; border-radius: 2px;">◆ Recommended</span>`
        : '';
      const ctaBlock = cdState
        ? `<div style="display: inline-flex; align-items: center; padding: 7px 14px; background: rgba(255,255,255,0.02); border: 1px solid ${stateColor}66; border-left: 2px solid ${stateColor}; border-radius: 2px; font-size: var(--fs-2xs); color: ${stateColor}; font-family: var(--font-mono); letter-spacing: 0.18em; font-weight: 600; text-transform: uppercase;">${stateLabel}</div>`
        : `<button class="pl-dispatch-btn" style="padding: 8px 16px; font-size: var(--fs-2xs); background: rgba(77, 255, 156, 0.06); color: #4dff9c; border: 1px solid rgba(77, 255, 156, 0.35); border-left: 2px solid #4dff9c; border-radius: 2px; cursor: pointer; font-weight: 600; letter-spacing: 0.20em; text-transform: uppercase; font-family: var(--font-mono); transition: background 120ms, border-color 120ms;" data-rcv="counter-dispatch" data-id="${event.id}" data-asset-id="${a.id}">Dispatch</button>`;

      const includesHtml = (details.includes || []).length
        ? `<div style="margin-top: var(--space-3);">
             <div class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); font-size: var(--fs-2xs); margin-bottom: var(--space-1);">Includes</div>
             <ul style="margin: 0; padding-left: 18px; font-size: var(--fs-xs); color: var(--text); line-height: 1.6;">
               ${details.includes.map(i => `<li>${i}</li>`).join('')}
             </ul>
           </div>`
        : '';
      const deployedForHtml = details.deployedFor
        ? `<div style="margin-top: var(--space-3);">
             <div class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); font-size: var(--fs-2xs); margin-bottom: var(--space-1);">Usually deployed for</div>
             <div style="font-size: var(--fs-xs); color: var(--text); line-height: 1.6;">${details.deployedFor}</div>
           </div>`
        : '';
      const tradeoffsHtml = details.tradeoffs
        ? `<div style="margin-top: var(--space-3); padding: var(--space-2) var(--space-3); background: rgba(255, 184, 77, 0.06); border-left: 2px solid #ffb84d; border-radius: 2px;">
             <div class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: #ffb84d; font-size: var(--fs-2xs); margin-bottom: var(--space-1);">Tradeoffs</div>
             <div style="font-size: var(--fs-xs); color: var(--text); line-height: 1.55;">${details.tradeoffs}</div>
           </div>`
        : '';

      return `
        <article style="padding: var(--space-4); border: 1px solid ${idx === 0 ? 'rgba(77, 210, 255, 0.3)' : 'var(--border)'}; border-left: ${idx === 0 ? '2px' : '1px'} solid ${idx === 0 ? 'var(--accent)' : 'var(--border)'}; border-radius: var(--radius); background: var(--surface-panel); margin-bottom: var(--space-3);">
          <header style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-2);">
            <div style="flex: 1 1 auto; min-width: 0;">
              <div class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); font-size: var(--fs-2xs); margin-bottom: 2px;">${details.displayName || a.name}</div>
              <div style="font-size: var(--fs-sm); color: var(--text); font-weight: 500;">${a.name}</div>
              <div class="c-label" style="margin-top: 2px; color: var(--text-dim);">${a.etaLabel} · ${a.distanceKm} km</div>
            </div>
            ${recommendedBadge}
          </header>
          ${includesHtml}
          ${deployedForHtml}
          ${tradeoffsHtml}
          <div style="margin-top: var(--space-3); display: flex; justify-content: flex-end;">${ctaBlock}</div>
        </article>`;
    };

    const otherRow = (a) => {
      const cdState = counterDispatchStateFor(event.id, a.id);
      const stateLabel = cdState
        ? { en_route: 'EN ROUTE', engaging: 'ENGAGING', complete: 'COMPLETE' }[cdState]
        : 'OTHER AGENCY';
      return `
        <div class="c-row" style="align-items: flex-start; opacity: 0.7;">
          <div style="flex: 1 1 auto; min-width: 0;">
            <div style="font-size: var(--fs-sm); color: var(--text-dim); font-weight: 500;">${a.name}</div>
            <div class="c-label" style="margin-top: 2px;">${a.response}</div>
          </div>
          <div style="font-size: var(--fs-2xs); color: var(--text-dim); font-family: var(--font-mono); letter-spacing: 0.08em; padding-left: var(--space-2);">${stateLabel}</div>
        </div>`;
    };

    // Acknowledgment gate — options unlock only after this role has
    // acked. Mirrors real command-room doctrine: read, ack, deliberate,
    // then commit. Uses the same rec lookup as renderEventReport.
    const roleDestSet = new Set(activeRole?.destinationIds || []);
    const rec = (event.escalations || []).find(r => roleDestSet.has(r.destinationId));
    const ackTs = rec?.statusHistory?.find(h => h.status === 'acknowledged')?.timestamp;
    const isAcked = !!ackTs;

    // Step 1 gate: point the operator at the canonical Acknowledge
    // Receipt button in the case-file's Your Response section rather
    // than duplicating it here. Two ack buttons for the same action was
    // confusing UX. This block just tells them WHERE to look.
    const ackGateHtml = !isAcked && rec ? `
      <div class="c-panel" style="border-top: 3px solid #ffb84d;">
        <div class="c-panel-title" style="margin-bottom: var(--space-2); color: #ffb84d;">Step 1 · Acknowledge receipt</div>
        <div style="font-size: var(--fs-xs); color: var(--text); line-height: 1.55;">Click <b style="color: #4dff9c;">Acknowledge receipt</b> in the case-file to the left. Response options unlock once acknowledged.</div>
      </div>` : '';

    const ackedBadge = isAcked ? `<span style="font-size: var(--fs-2xs); color: var(--ok); letter-spacing: 0.10em; text-transform: uppercase; font-family: var(--font-mono);">✓ Acked ${ackTs ? ackTs.slice(11,19) + 'Z' : ''}</span>` : '';

    return `
      <div class="c-panel">
        <div class="c-section-eyebrow">Mission Console</div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-2);">
          <div class="c-section-title">Recommended Response</div>
          ${ackedBadge}
        </div>
        <div class="c-label" style="margin-bottom: var(--space-3); text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs); color: var(--text-dim);">${subjectLine}</div>
        <div style="padding: var(--space-2) var(--space-3); background: rgba(77, 210, 255, 0.05); border-left: 2px solid var(--accent); margin-bottom: var(--space-3); font-size: var(--fs-xs); color: var(--text); line-height: 1.55;">${bundle.tacticalRationale || 'Graduated response computed from live subject.'}</div>
      </div>

      ${ackGateHtml}

      ${isAcked || !rec ? (mineList.length ? `
        <div class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">${isAcked ? 'Step 2 · Select response option' : 'Your Response Options'}</div>
          <div class="c-label" style="text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.55; margin-bottom: var(--space-3);">${mineList.length} option${mineList.length === 1 ? '' : 's'} available. Multiple can be dispatched concurrently. Recommended pick is the closest by ETA.</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: var(--space-3);">
            ${mineList.map((a, i) => `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: ${i === 0 ? 'rgba(77, 210, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)'}; border: 1px solid ${i === 0 ? 'rgba(77, 210, 255, 0.35)' : 'var(--border)'}; border-radius: 2px; font-family: var(--font-mono); font-size: var(--fs-2xs); letter-spacing: 0.10em; text-transform: uppercase; color: ${i === 0 ? 'var(--accent)' : 'var(--text-dim)'};">${i === 0 ? '◆' : '○'} ${(RESPONSE_OPTION_DETAILS[a.kind]?.displayName || a.kind).split(' ').slice(0, 3).join(' ')}</span>`).join('')}
          </div>
          ${mineList.map((a, i) => dispatchRow(a, i)).join('')}
        </div>` : `
        <div class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">Response Options</div>
          <div class="c-label" style="text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.55;">No assets under your jurisdiction match this threat class. Other agencies below can act.</div>
        </div>`) : ''}

      ${_renderStep3ActiveEngagement(event, activeRole)}
      ${_renderStep4OutcomeConfirm(event, activeRole)}
      ${_renderStep5PostIncidentHandoff(event, activeRole)}
      ${_renderStep6CloseEvent(event, activeRole)}

      ${otherList.length ? `
        <div class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">Other Agencies On Case</div>
          ${otherList.map(otherRow).join('')}
        </div>` : ''}
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // STEP 3 · Monitor engagement
  // ══════════════════════════════════════════════════════════════════
  // Shown when at least one counter-response dispatch has been fired by
  // this role. Lists every dispatch with its live state chip so the
  // duty officer sees the whole engagement picture at once.
  function _renderStep3ActiveEngagement(event, activeRole) {
    const dispatches = (event.counterDispatches || []).filter(cd => {
      // Only show dispatches this role owns (issued from their scope)
      const scope = _ROLE_DISPATCH_SCOPE_LOOKUP[activeRole?.id];
      return activeRole?.kind === 'admin' || (scope && scope.has(cd.kind));
    });
    if (!dispatches.length) return '';
    const rows = dispatches.map(cd => {
      const state = counterDispatchStateFor(event.id, cd.assetId) || 'complete';
      const stateColor = state === 'complete' ? '#6b7280' : state === 'engaging' ? '#ffb84d' : '#4dd2ff';
      const stateLabel = { en_route: 'EN ROUTE', engaging: 'ENGAGING', complete: 'COMPLETE' }[state] || state.toUpperCase();
      const elapsedSec = Math.max(0, Math.floor((Date.now() - cd.dispatchedTs) / 1000));
      const elapsedStr = elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;
      const kindLabel = RESPONSE_OPTION_DETAILS[cd.kind]?.displayName || cd.kind;
      return `
        <div style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-top: 1px solid var(--border);">
          <div style="flex: 1 1 auto; min-width: 0;">
            <div style="font-size: var(--fs-sm); color: var(--text); font-weight: 500;">${cd.assetName}</div>
            <div class="c-label" style="margin-top: 2px; color: var(--text-dim);">${kindLabel} · Elapsed ${elapsedStr}</div>
          </div>
          <div style="display: inline-flex; align-items: center; padding: 4px 10px; background: rgba(255,255,255,0.02); border: 1px solid ${stateColor}66; border-left: 2px solid ${stateColor}; border-radius: 2px; font-size: var(--fs-2xs); color: ${stateColor}; font-family: var(--font-mono); letter-spacing: 0.16em; font-weight: 600; text-transform: uppercase;">${stateLabel}</div>
        </div>`;
    }).join('');
    return `
      <div class="c-panel" style="border-top: 3px solid var(--accent);">
        <div class="c-panel-title" style="margin-bottom: var(--space-2); color: var(--accent);">Step 3 · Monitor engagement</div>
        <div class="c-label" style="text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.55; margin-bottom: var(--space-1);">${dispatches.length} dispatch${dispatches.length === 1 ? '' : 'es'} tracked. Live state above updates as assets progress.</div>
        ${rows}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // STEP 4 · Confirm outcome
  // ══════════════════════════════════════════════════════════════════
  // Shown when at least one dispatch has completed AND is awaiting an
  // outcome confirmation from the operator. Per-dispatch outcome
  // selector uses formal operational vocabulary from
  // RESPONSE_OPTION_DETAILS[kind].outcomes (not slang, not "kill/
  // neutralise" for cases where the real outcome is "identified" or
  // "tracked to origin").
  function _renderStep4OutcomeConfirm(event, activeRole) {
    const outcomes = event.dispatchOutcomes || {};
    const dispatches = (event.counterDispatches || []).filter(cd => {
      if (outcomes[cd.dispatchId]) return false;   // already confirmed
      const state = counterDispatchStateFor(event.id, cd.assetId);
      // Include completed dispatches OR dispatches whose entities have
      // already been retired (state lookup returns 'complete' from the
      // event's counterDispatches trail even after entities are gone).
      if (state && state !== 'complete') return false;
      const scope = _ROLE_DISPATCH_SCOPE_LOOKUP[activeRole?.id];
      return activeRole?.kind === 'admin' || (scope && scope.has(cd.kind));
    });
    if (!dispatches.length) return '';
    const blocks = dispatches.map(cd => {
      const outcomeOptions = outcomesForKind(cd.kind);
      const optionsHtml = outcomeOptions.length
        ? outcomeOptions.map(o => `<option value="${o.id}">${o.label}</option>`).join('')
        : '<option value="complete">Engagement complete</option>';
      const kindLabel = RESPONSE_OPTION_DETAILS[cd.kind]?.displayName || cd.kind;
      return `
        <article style="padding: var(--space-3); border: 1px solid var(--border); border-left: 2px solid #ffb84d; border-radius: var(--radius); background: var(--surface-panel); margin-bottom: var(--space-3);">
          <div class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: #ffb84d; font-size: var(--fs-2xs); margin-bottom: 4px;">${kindLabel}</div>
          <div style="font-size: var(--fs-sm); color: var(--text); font-weight: 500; margin-bottom: var(--space-2);">${cd.assetName}</div>
          <label class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); font-size: var(--fs-2xs); display: block; margin-bottom: 4px;">Outcome</label>
          <select data-outcome-select="${cd.dispatchId}" style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 2px; color: var(--text); font-family: var(--font-body); font-size: var(--fs-sm); margin-bottom: var(--space-2);">
            <option value="">Select outcome...</option>
            ${optionsHtml}
          </select>
          <label class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); font-size: var(--fs-2xs); display: block; margin-bottom: 4px;">Analyst notes (optional)</label>
          <textarea data-outcome-notes="${cd.dispatchId}" rows="2" placeholder="Free-text observations..." style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 2px; color: var(--text); font-family: var(--font-body); font-size: var(--fs-sm); resize: vertical; box-sizing: border-box; margin-bottom: var(--space-2);"></textarea>
          <div style="display: flex; justify-content: flex-end;">
            <button class="pl-dispatch-btn" style="padding: 6px 14px; font-size: var(--fs-2xs); background: rgba(255, 184, 77, 0.08); color: #ffb84d; border: 1px solid rgba(255, 184, 77, 0.4); border-left: 2px solid #ffb84d; border-radius: 2px; cursor: pointer; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; font-family: var(--font-mono);" data-rcv="confirm-outcome" data-dispatch-id="${cd.dispatchId}" data-event-id="${event.id}">Confirm outcome</button>
          </div>
        </article>`;
    }).join('');
    return `
      <div class="c-panel" style="border-top: 3px solid #ffb84d;">
        <div class="c-panel-title" style="margin-bottom: var(--space-2); color: #ffb84d;">Step 4 · Confirm outcome</div>
        <div class="c-label" style="text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.55; margin-bottom: var(--space-3);">${dispatches.length} completed dispatch${dispatches.length === 1 ? '' : 'es'} awaiting formal outcome. Outcomes lock into the audit trail and unlock handoff options.</div>
        ${blocks}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // STEP 5 · Post-incident handoff
  // ══════════════════════════════════════════════════════════════════
  // Shown when at least one outcome has been confirmed AND there are
  // applicable ground-response destinations that haven't been notified
  // yet. Reuses postIncidentResponders + dispatchPostIncident wiring.
  function _renderStep5PostIncidentHandoff(event, activeRole) {
    const outcomes = event.dispatchOutcomes || {};
    if (!Object.keys(outcomes).length) return '';
    const responders = postIncidentResponders(event.siteId);
    if (!responders.length) return '';
    const dispatched = new Set(event.postIncidentDispatched || []);
    const pending = responders.filter(r => !dispatched.has(r.id));
    if (!pending.length) return '';
    const rows = pending.map(r => `
      <div style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-top: 1px solid var(--border);">
        <div style="flex: 1 1 auto; min-width: 0;">
          <div style="font-size: var(--fs-sm); color: var(--text); font-weight: 500;">${r.name}</div>
          <div class="c-label" style="margin-top: 2px; color: var(--text-dim);">Tier ${r.tier} · ${r.type}</div>
        </div>
        <button class="pl-dispatch-btn" style="padding: 6px 12px; font-size: var(--fs-2xs); background: rgba(77, 210, 255, 0.06); color: var(--accent); border: 1px solid rgba(77, 210, 255, 0.4); border-left: 2px solid var(--accent); border-radius: 2px; cursor: pointer; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; font-family: var(--font-mono);" data-rcv="dispatch-postinc" data-id="${event.id}" data-dest="${r.id}">Dispatch</button>
      </div>
    `).join('');
    return `
      <div class="c-panel" style="border-top: 3px solid #4dd2ff;">
        <div class="c-panel-title" style="margin-bottom: var(--space-2); color: #4dd2ff;">Step 5 · Post-incident handoff</div>
        <div class="c-label" style="text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.55; margin-bottom: var(--space-1);">${pending.length} ground-response destination${pending.length === 1 ? '' : 's'} available for cordon, evidence recovery, and civil handoff.</div>
        ${rows}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // STEP 6 · Close event
  // ══════════════════════════════════════════════════════════════════
  // Shown when all outcomes are confirmed AND all applicable handoffs
  // have been dispatched (or there were none applicable). Final formal
  // step. Marks the event closed and archives to history.
  function _renderStep6CloseEvent(event, activeRole) {
    const outcomes = event.dispatchOutcomes || {};
    if (!Object.keys(outcomes).length) return '';
    if (event.status === 'closed' || event.outcome === 'closed') {
      return `
        <div class="c-panel" style="border-top: 3px solid var(--ok);">
          <div class="c-panel-title" style="margin-bottom: var(--space-2); color: var(--ok);">Step 6 · Event closed</div>
          <div class="c-label" style="text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.55;">Event archived to history. Full incident record retained for audit.</div>
        </div>`;
    }
    const responders = postIncidentResponders(event.siteId);
    const dispatched = new Set(event.postIncidentDispatched || []);
    const handoffPending = responders.filter(r => !dispatched.has(r.id));
    if (handoffPending.length) return '';   // Step 5 still active
    return `
      <div class="c-panel" style="border-top: 3px solid var(--ok);">
        <div class="c-panel-title" style="margin-bottom: var(--space-2); color: var(--ok);">Step 6 · Close event</div>
        <div class="c-label" style="text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.55; margin-bottom: var(--space-3);">All outcomes confirmed. All applicable handoffs dispatched. Event ready for formal closure and archive.</div>
        <div style="display: flex; justify-content: flex-end;">
          <button class="pl-dispatch-btn" style="padding: 8px 16px; font-size: var(--fs-2xs); background: rgba(77, 255, 156, 0.08); color: var(--ok); border: 1px solid rgba(77, 255, 156, 0.4); border-left: 2px solid var(--ok); border-radius: 2px; cursor: pointer; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; font-family: var(--font-mono);" data-rcv="close-event" data-id="${event.id}">Close event</button>
      </div>
      </div>`;
  }

  // Shared lookup for the ROLE_DISPATCH_SCOPE map, used by Steps 3+4
  // to filter dispatches by "did this role own it". Kept as module
  // scope so all step renderers reference the same source of truth.
  const _ROLE_DISPATCH_SCOPE_LOOKUP = {
    'flv-skrydstrup': new Set(['helicopter-intercept']),
    'flv-karup':      new Set(['helicopter-intercept']),
    'haer-slagelse':  new Set(['army-c-uas', 'army-isr-drone']),
    'haer-hovelte':   new Set(['army-ground']),
    'haer-varde':     new Set(['army-isr-drone', 'army-c-uas', 'counter-drone-swarm']),
    'haer-bornholm':  new Set(['army-c-uas']),
    'haer-oksbol':    new Set(['army-c-uas']),
    'sok-aalborg':    new Set(['sof-tactical']),
    'forsvarskmd':    new Set(['helicopter-intercept', 'army-c-uas', 'army-isr-drone', 'army-ground', 'sof-tactical', 'counter-drone-swarm']),
    'fe':             new Set(['army-isr-drone']),
    'rigspoliti':     new Set(['police-c-uas', 'counter-drone-swarm']),
    'politi-kbh':     new Set(['police-c-uas']),
    'politi-sydvest': new Set(['police-c-uas']),
    'op-cph-airports':new Set(['wildlife-response']),
    'op-esbjerg-port':new Set(['wildlife-response']),
    'op-energinet':   new Set([]),
    'flv-qra':        new Set(['helicopter-intercept']),
  };

  // ── Response Overlay (right-side slide-in panel on receiver dashboard) ──
  // Categorized asset table: tactical intercept (real response), ground coordination
  // (police, cordon, evidence), civil consequence (emergency + reinforcement).
  // Tactical map with real trajectory, threat forecast, reach rings, target site.
  function renderResponseOverlay(event) {
    const threatLat = event.lastPosition?.lat || event.entry?.lat;
    const threatLon = event.lastPosition?.lon || event.entry?.lon;
    if (threatLat == null || threatLon == null) return '';
    // Subject-aware bundle. Falls back to legacy proximity-based bundle
    // for events without a subject (defensive; every event via addEvent
    // has event.subject attached by events.js).
    const bundle = event.subject
      ? responseBundleForSubject(event.subject, threatLat, threatLon)
      : responseBundle(threatLat, threatLon);
    const pb = playbookFor(event);
    const severity = pb?.severity || 'medium';
    const site = SITES[event.siteId];
    const heading = event.lastPosition?.heading;
    const speedKmh = (event.lastPosition?.speed || 40) * 3.6;
    const kindIcon = (k) => ({
      // Legacy kinds
      'police': '⚑', 'police-national': '⚑',
      'air-force-qra': '✈', 'air-force': '✈',
      'navy': '⚓', 'coast-guard': '⚓',
      'home-guard': '◼', 'emergency': '✚',
      'defence-command': '◉',
      // New counter-response kinds (P85)
      'army-isr-drone': '◈',
      'army-c-uas': '≋',
      'army-ground': '⚒',
      'police-c-uas': '⇉',
      'helicopter-intercept': '⌂',
      'sof-tactical': '★',
      'wildlife-response': '◇',
      'counter-drone-swarm': '⚔',
    }[k] || '●');
    const kindColor = (k) => ({
      // Legacy: air = blue, police/emergency mixed
      'air-force-qra': '#4dd2ff', 'air-force': '#4dd2ff',
      'navy': '#4dd2ff', 'coast-guard': '#4dd2ff',
      'police': '#4dff9c', 'police-national': '#4dff9c',
      'emergency': '#ffb84d', 'home-guard': '#ffb84d',
      // Counter-response (friendly-dispatched) = green
      'army-isr-drone': '#4dff9c',
      'army-c-uas': '#4dff9c',
      'army-ground': '#4dff9c',
      'police-c-uas': '#4dff9c',
      'helicopter-intercept': '#4dff9c',
      'sof-tactical': '#4dff9c',
      'wildlife-response': '#e6ecf0',
      'counter-drone-swarm': '#4dff9c',
    }[k] || '#e6ecf0');

    // ── Scramble decision cockpit ─────────────────────────────────
    // One screen, one question: "If I scramble the F-35 right now,
    // will it get there in time?" — everything else is stripped.
    //
    // Renders: threat (live pulsing) with heading vector + projected
    // path to target · Skrydstrup origin · projected intercept point
    // (F-35 + threat convergence given both speeds) · numeric readout
    // block. No ground assets, no unrelated bases, no legend chrome.

    const SKRYDSTRUP_POS = { lat: 55.221, lon: 9.264, name: 'Skrydstrup' };
    const F35_CRUISE_KMH = 1100;   // Mach 0.9 realistic subsonic cruise
    const targetPos = site ? { lat: site.coordinates.lat, lon: site.coordinates.lon, name: site.name } : null;

    // Layout: fit threat, skrydstrup, target into a padded square
    const layoutPts = [
      { lat: threatLat, lon: threatLon },
      { lat: SKRYDSTRUP_POS.lat, lon: SKRYDSTRUP_POS.lon },
      ...(targetPos ? [{ lat: targetPos.lat, lon: targetPos.lon }] : []),
    ];
    let latMin = Math.min(...layoutPts.map(p => p.lat));
    let latMax = Math.max(...layoutPts.map(p => p.lat));
    let lonMin = Math.min(...layoutPts.map(p => p.lon));
    let lonMax = Math.max(...layoutPts.map(p => p.lon));
    const pad = 0.30;
    const dLat = Math.max(0.05, latMax - latMin) * (1 + pad * 2);
    const dLon = Math.max(0.08, lonMax - lonMin) * (1 + pad * 2);
    const cLat = (latMin + latMax) / 2, cLon = (lonMin + lonMax) / 2;
    const W = 360, H = 300;
    const px = (lon) => W * ((lon - (cLon - dLon/2)) / dLon);
    const py = (lat) => H - H * ((lat - (cLat - dLat/2)) / dLat);
    const kmPerLat = 111;
    const kmPerLon = 111 * Math.cos(cLat * Math.PI / 180);
    const kmToPx = ((H / dLat) / kmPerLat + (W / dLon) / kmPerLon) / 2;
    const tx = px(threatLon), ty = py(threatLat);
    const sx = px(SKRYDSTRUP_POS.lon), sy = py(SKRYDSTRUP_POS.lat);

    // Tighter grid — 6x6 subtle lines, faded
    const gridSvg = [];
    for (let i = 1; i < 6; i++) {
      const x = (W / 6) * i;
      const y = (H / 6) * i;
      gridSvg.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(255,255,255,0.035)" stroke-width="1"/>`);
      gridSvg.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(255,255,255,0.035)" stroke-width="1"/>`);
    }

    // ── Compute threat time to target + F-35 time to intercept + margin ──
    const distToTargetKm = targetPos
      ? haversineM(threatLat, threatLon, targetPos.lat, targetPos.lon) / 1000
      : null;
    const timeToTargetMin = distToTargetKm != null && speedKmh > 0
      ? distToTargetKm / speedKmh * 60
      : null;

    // Lead pursuit: find point P on threat trajectory where F-35 from
    // Skrydstrup arrives at the same time as the threat. Numeric solve.
    let interceptPos = null;
    let interceptTimeMin = null;
    if (heading != null && speedKmh > 0) {
      const headingRad = heading * Math.PI / 180;
      let best = null;
      for (let tMin = 1; tMin <= 30; tMin += 0.5) {
        const distThreatKm = speedKmh * (tMin / 60);
        // Advance threat along heading (bearing from north, clockwise)
        const dLatKm = distThreatKm * Math.cos(headingRad);
        const dLonKm = distThreatKm * Math.sin(headingRad);
        const projLat = threatLat + dLatKm / kmPerLat;
        const projLon = threatLon + dLonKm / kmPerLon;
        const distFromSkrKm = haversineM(SKRYDSTRUP_POS.lat, SKRYDSTRUP_POS.lon, projLat, projLon) / 1000;
        const f35TimeMin = distFromSkrKm / F35_CRUISE_KMH * 60;
        const diff = Math.abs(f35TimeMin - tMin);
        if (!best || diff < best.diff) {
          best = { tMin, lat: projLat, lon: projLon, f35TimeMin, diff };
        }
      }
      if (best && best.diff < 2) {
        interceptPos = { lat: best.lat, lon: best.lon };
        interceptTimeMin = best.tMin;
      }
    }

    // Threat trajectory line — from threat forward to intercept (or target)
    let trajSvg = '';
    if (heading != null && speedKmh > 0) {
      const headingRad = heading * Math.PI / 180;
      // Extend forward to the target if we have one, else 15 min out
      const forwardKm = distToTargetKm != null ? distToTargetKm * 1.05 : speedKmh * 0.25;
      const dLatKm = forwardKm * Math.cos(headingRad);
      const dLonKm = forwardKm * Math.sin(headingRad);
      const fLat = threatLat + dLatKm / kmPerLat;
      const fLon = threatLon + dLonKm / kmPerLon;
      const fx = px(fLon), fy = py(fLat);
      trajSvg += `<line x1="${tx}" y1="${ty}" x2="${fx}" y2="${fy}" stroke="rgba(255,90,90,0.55)" stroke-width="1.2" stroke-dasharray="5,4"/>`;
      // Heading arrow tick at threat (short bold)
      const tickKm = 2;
      const tLatKm = tickKm * Math.cos(headingRad);
      const tLonKm = tickKm * Math.sin(headingRad);
      const ttx = px(threatLon + tLonKm / kmPerLon);
      const tty = py(threatLat + tLatKm / kmPerLat);
      trajSvg += `<line x1="${tx}" y1="${ty}" x2="${ttx}" y2="${tty}" stroke="#ff5a5a" stroke-width="2.2"/>`;
    }

    // Target marker
    let targetSvg = '';
    if (targetPos) {
      const gx = px(targetPos.lon), gy = py(targetPos.lat);
      targetSvg = `
        <circle cx="${gx}" cy="${gy}" r="14" fill="none" stroke="rgba(255,184,77,0.4)" stroke-width="1">
          <animate attributeName="r" values="10;20;10" dur="2.4s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.7;0;0.7" dur="2.4s" repeatCount="indefinite"/>
        </circle>
        <rect x="${gx-5}" y="${gy-5}" width="10" height="10" fill="none" stroke="#ffb84d" stroke-width="1.5"/>
        <circle cx="${gx}" cy="${gy}" r="2" fill="#ffb84d"/>
        <text x="${gx + 8}" y="${gy + 3}" font-family="'SF Mono', Menlo, monospace" font-size="8" fill="#ffb84d" letter-spacing="0.08em">TARGET · ${targetPos.name.toUpperCase()}</text>
      `;
    }

    // Skrydstrup origin marker
    const skrydstrupSvg = `
      <polygon points="${sx},${sy-6} ${sx+6},${sy} ${sx},${sy+6} ${sx-6},${sy}" fill="#4dd2ff" stroke="#06080b" stroke-width="1.5"/>
      <text x="${sx + 9}" y="${sy + 3}" font-family="'SF Mono', Menlo, monospace" font-size="8" fill="#4dd2ff" letter-spacing="0.08em">SKRYDSTRUP · F-35 QRA</text>
    `;

    // Intercept point (if F-35 dispatched now)
    let interceptSvg = '';
    if (interceptPos && interceptTimeMin != null) {
      const ix = px(interceptPos.lon), iy = py(interceptPos.lat);
      // Line from Skrydstrup to intercept
      interceptSvg += `<line x1="${sx}" y1="${sy}" x2="${ix}" y2="${iy}" stroke="rgba(77,210,255,0.45)" stroke-width="1" stroke-dasharray="4,3"/>`;
      // Intercept diamond
      interceptSvg += `
        <polygon points="${ix},${iy-5} ${ix+5},${iy} ${ix},${iy+5} ${ix-5},${iy}" fill="none" stroke="#4dd2ff" stroke-width="1.5"/>
        <circle cx="${ix}" cy="${iy}" r="1.5" fill="#4dd2ff"/>
        <text x="${ix + 7}" y="${iy - 5}" font-family="'SF Mono', Menlo, monospace" font-size="8" fill="#4dd2ff" letter-spacing="0.08em">INTERCEPT · T+${interceptTimeMin.toFixed(1)} MIN</text>
      `;
    }

    // Threat marker (pulsing, dominant)
    const threatSvg = `
      <circle cx="${tx}" cy="${ty}" r="12" fill="none" stroke="rgba(255,90,90,0.55)" stroke-width="1.5">
        <animate attributeName="r" values="8;22;8" dur="1.8s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.9;0;0.9" dur="1.8s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${tx}" cy="${ty}" r="6" fill="#ff5a5a" stroke="#06080b" stroke-width="1.5"/>
    `;

    // Scale bar
    const scaleKm = kmToPx > 5 ? 5 : kmToPx > 1 ? 10 : 25;
    const scalePx = scaleKm * kmToPx;
    const scaleSvg = `
      <g transform="translate(${W - scalePx - 14}, ${H - 16})">
        <line x1="0" y1="0" x2="${scalePx}" y2="0" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
        <line x1="0" y1="-3" x2="0" y2="3" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
        <line x1="${scalePx}" y1="-3" x2="${scalePx}" y2="3" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
        <text x="${scalePx/2}" y="-4" font-family="'SF Mono', Menlo, monospace" font-size="8" fill="rgba(255,255,255,0.6)" text-anchor="middle" letter-spacing="0.08em">${scaleKm} KM</text>
      </g>`;

    // Decision numbers computed as plain values — rendered as HTML stat
    // cards ABOVE the SVG, not baked into the map. Typography lives in CSS
    // where it belongs, not stuffed inside SVG text elements.
    const marginMin = timeToTargetMin != null && interceptTimeMin != null
      ? timeToTargetMin - interceptTimeMin
      : null;
    const marginOk = marginMin != null && marginMin > 0;
    // Inside-SVG readout is now minimal: just threat coord/vector so operators
    // reading the map itself have the raw numbers in eye view.
    const readoutSvg = `
      <g transform="translate(12, 16)">
        <text font-family="'SF Mono', Menlo, monospace" font-size="8" fill="rgba(255,255,255,0.35)" letter-spacing="0.16em">THREAT</text>
        <text y="12" font-family="'SF Mono', Menlo, monospace" font-size="9" fill="rgba(230,236,240,0.85)" letter-spacing="0.04em">${threatLat.toFixed(3)}°N ${threatLon.toFixed(3)}°E · ${Math.round(speedKmh)} km/h</text>
      </g>
    `;

    // ── Decision feasibility (for the readout block below the map) ──
    let feasibility = null;
    if (interceptTimeMin != null && timeToTargetMin != null) {
      feasibility = {
        assetName: 'F-35A · Skrydstrup',
        assetEta: interceptTimeMin.toFixed(1),
        threatEta: timeToTargetMin.toFixed(1),
        marginMin: marginMin.toFixed(1),
        canIntercept: marginOk,
      };
    }

    const severityColor = { info: '#4dff9c', low: '#4dff9c', medium: '#ffb84d', high: '#ff8c3d', critical: '#ff5a5a' }[severity] || '#ffb84d';

    // ── Asset row renderer ──
    // Air bases carry an info icon per airframe assigned to them (F-35 at
    // Skrydstrup, helos at Karup, transports at Aalborg). Click opens the
    // universal aircraft info popup. Ground / consequence assets get no
    // airframe icons since they aren't air platforms.
    // Kinds that can be dispatched via the counter-response Level 3
    // visualisation. F-35 QRA uses its own dedicated dispatch flow
    // (session-wide singleton), so excluded here.
    const DISPATCHABLE_KINDS = new Set([
      'helicopter-intercept', 'army-c-uas', 'police-c-uas',
      'army-isr-drone', 'sof-tactical', 'wildlife-response', 'counter-drone-swarm',
    ]);

    // Role-scoping (P90 + P92): which receiver roles have jurisdiction
    // to dispatch which asset kinds. Now covers the P92 per-base leaves.
    // Only these roles see a live Dispatch button; others see the asset
    // row for situational awareness only. Admin sees all.
    const ROLE_DISPATCH_SCOPE = {
      // Air Force bases
      'flv-skrydstrup': new Set(['helicopter-intercept']),
      'flv-karup':      new Set(['helicopter-intercept']),
      // Army bases
      'haer-slagelse':  new Set(['army-c-uas', 'army-isr-drone']),
      'haer-hovelte':   new Set(['army-ground']),
      'haer-varde':     new Set(['army-isr-drone', 'army-c-uas', 'counter-drone-swarm']),
      'haer-bornholm':  new Set(['army-c-uas']),
      'haer-oksbol':    new Set(['army-c-uas']),
      // SOF
      'sok-aalborg':    new Set(['sof-tactical']),
      // Command HQ (sees all military dispatch)
      'forsvarskmd':    new Set(['helicopter-intercept', 'army-c-uas', 'army-isr-drone', 'army-ground', 'sof-tactical', 'counter-drone-swarm']),
      // Intelligence
      'fe':             new Set(['army-isr-drone']),
      // Police
      'rigspoliti':     new Set(['police-c-uas', 'counter-drone-swarm']),
      'politi-kbh':     new Set(['police-c-uas']),
      'politi-sydvest': new Set(['police-c-uas']),
      // Operators (wildlife on site)
      'op-cph-airports':new Set(['wildlife-response']),
      'op-esbjerg-port':new Set(['wildlife-response']),
      'op-energinet':   new Set([]),
      // Legacy alias (still respected while call sites migrate)
      'flv-qra':        new Set(['helicopter-intercept']),
    };
    const roleScope = ROLE_DISPATCH_SCOPE[activeRole?.id] || null;
    const canDispatch = (kind) => (activeRole?.kind === 'admin')
      || (roleScope ? roleScope.has(kind) : false);

    const assetRow = (a, isTactical) => {
      const airframes = aircraftForResponseAsset(a.id);
      const airframeChips = airframes.map(af => {
        const id = Object.keys(AIRCRAFT).find(k => AIRCRAFT[k].designation === af.designation);
        return `<button class="c-chip accent" style="cursor: pointer; padding: 3px 6px 3px 8px; gap: 5px;" data-aircraft-info="${id}" aria-label="${af.designation} info">${af.designation.split(' ')[0]}<span style="font-style: italic; opacity: 0.7;">i</span></button>`;
      }).join('');

      // Dispatch button — only for tactical counter-response assets
      // AND only when the current role has jurisdictional scope.
      // Other roles still see the asset row (situational awareness),
      // but no dispatch action. State-aware button: Dispatch → En route
      // → Engaging → Complete.
      let dispatchBtn = '';
      if (isTactical && DISPATCHABLE_KINDS.has(a.kind) && canDispatch(a.kind)) {
        const cdState = counterDispatchStateFor(event.id, a.id);
        const stateLabel = { en_route: 'En route', engaging: 'Engaging', complete: 'Complete' }[cdState];
        if (cdState) {
          const stateColor = cdState === 'complete' ? '#6b7280' : cdState === 'engaging' ? '#ffb84d' : '#4dd2ff';
          dispatchBtn = `<div style="margin-top: 4px; font-size: var(--fs-xs); color: ${stateColor}; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase;">${stateLabel}</div>`;
        } else {
          dispatchBtn = `<button class="pl-dispatch-btn" style="margin-top: 4px; padding: 5px 12px; font-size: var(--fs-2xs); background: rgba(77, 255, 156, 0.06); color: #4dff9c; border: 1px solid rgba(77, 255, 156, 0.35); border-left: 2px solid #4dff9c; border-radius: 2px; cursor: pointer; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; font-family: var(--font-mono);" data-rcv="counter-dispatch" data-id="${event.id}" data-asset-id="${a.id}">Dispatch</button>`;
        }
      } else if (isTactical && DISPATCHABLE_KINDS.has(a.kind)) {
        // Asset is dispatchable but this role doesn't have jurisdiction —
        // show the state as an unclickable label so operator sees another
        // agency is handling / can handle it.
        const cdState = counterDispatchStateFor(event.id, a.id);
        if (cdState) {
          const stateLabel = { en_route: 'En route', engaging: 'Engaging', complete: 'Complete' }[cdState];
          const stateColor = cdState === 'complete' ? '#6b7280' : cdState === 'engaging' ? '#ffb84d' : '#4dd2ff';
          dispatchBtn = `<div style="margin-top: 4px; font-size: var(--fs-xs); color: ${stateColor}; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase;">${stateLabel}</div>`;
        } else {
          dispatchBtn = `<div style="margin-top: 4px; font-size: var(--fs-2xs); color: var(--text-dim); font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase;">Other agency</div>`;
        }
      }

      return `
      <div class="c-row">
        <div style="color: ${kindColor(a.kind)}; font-size: 14px; line-height: 1; width: 20px; text-align: center; flex: 0 0 20px;">${kindIcon(a.kind)}</div>
        <div style="flex: 1 1 auto; min-width: 0;">
          <div style="font-size: var(--fs-base); color: var(--text); font-weight: 500; letter-spacing: var(--ls-body);">${a.name}</div>
          <div class="c-label" style="margin-top: 2px;">${a.response}</div>
          ${airframeChips ? `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--space-2);">${airframeChips}</div>` : ''}
        </div>
        <div style="text-align: right; white-space: nowrap; flex: 0 0 auto;">
          <div style="color: ${kindColor(a.kind)}; font-family: var(--font-mono); font-size: var(--fs-sm); font-weight: 600; letter-spacing: var(--ls-body); font-variant-numeric: tabular-nums;">${a.etaLabel}</div>
          <div class="c-label" style="margin-top: 2px;">${a.distanceKm} km</div>
          ${dispatchBtn}
        </div>
      </div>`;
    };

    // Dispatch block — Air Force sees the Dispatch button (or airborne status).
    // Other receivers see a read only Fighter Status card when fighter is airborne.
    const activeRole = getActiveRole();
    const isFlyvevaabnet = activeRole.id === 'flv-qra';
    const isMissile = event.platform === 'missile' && event.classification === 'hostile';
    // Airframe row generator — shared across all dispatch states. Every
    // asset row carries a compact info icon that opens the full spec
    // popup (aircraft.js). Info popup is intentionally unchanged.
    const airframeIdOf = (a) => Object.keys(AIRCRAFT).find(k => AIRCRAFT[k].designation === a.designation);
    const airframeRow = (a) => `
      <div class="c-row">
        <div style="flex:1 1 auto; min-width:0;">
          <div style="font-size: var(--fs-base); font-weight: 600; color: var(--text); letter-spacing: var(--ls-body);">${a.designation}</div>
          <div class="c-label" style="margin-top: 2px;">${a.role}</div>
        </div>
        <button class="c-btn-icon info" data-aircraft-info="${airframeIdOf(a)}" aria-label="${a.designation} info">i</button>
      </div>`;
    const airframeList = (heading, aircraftIds) => `
      <div style="margin: var(--space-3) 0;">
        <div class="c-label-lg" style="margin-bottom: var(--space-1);">${heading}</div>
        <div style="border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);">
          ${aircraftIds.map(airframeRow).join('')}
        </div>
      </div>`;

    let dispatchBlock = '';
    if (event.outcome === 'neutralized') {
      const impactSite = event._prevCoverageSite || event.siteId;
      const responders = postIncidentResponders(impactSite);
      const dispatched = event.postIncidentDispatched || [];
      const allDone = responders.length > 0 && responders.every(r => dispatched.includes(r.id));
      const responderButtons = responders.length === 0
        ? `<div class="c-label" style="padding: var(--space-2) 0;">No post incident responders configured for this site.</div>`
        : responders.map(r => {
            const done = dispatched.includes(r.id);
            return `
              <button class="c-btn wide ${done ? 'done' : ''}" style="justify-content: space-between; margin-bottom: var(--space-1);" data-rcv="dispatch-postinc" data-id="${event.id}" data-dest="${r.id}" ${done ? 'disabled' : ''}>
                <span>${done ? r.name + ' Dispatched' : 'Dispatch ' + r.name}</span>
                <span class="c-chip">Tier ${r.tier}</span>
              </button>`;
          }).join('');
      dispatchBlock = `
        <section class="c-panel">
          <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2);">
            <span class="c-chip ok">Target Neutralised</span>
            <span class="c-label">${event.neutralizedAt ? event.neutralizedAt.slice(11,19) + 'Z' : ''}</span>
          </div>
          <div style="font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.55;">${event.neutralizedBy || 'Flyvevåbnet Fighter Response'}</div>
        </section>
        <section class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">Post Incident Response</div>
          <div style="font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.55; margin-bottom: var(--space-3);">Impact site: ${SITES[impactSite]?.name || impactSite || 'Unknown'}. Ground response required for cordon, evidence recovery, and civilian safety.</div>
          ${responderButtons}
          ${allDone ? `
            <button class="c-btn solid ok wide" style="justify-content: center; margin-top: var(--space-2);" data-rcv="close-event" data-id="${event.id}">
              Close Event
            </button>` : ''}
        </section>`;
    } else if (isFlyvevaabnet && isMissile) {
      const skrydstrupList = aircraftAtBase('skrydstrup');
      if (!_f35.airborne) {
        // P91 fix: wrap the chip in a flex column with align-items:
        // flex-start so it can never stretch to fill the parent's width
        // (previous yellow-pillar bug in Flyvevåbnet view).
        dispatchBlock = `
          <section class="c-panel">
            <div style="display: flex; flex-direction: column; align-items: flex-start;">
              <span class="c-chip warn" style="align-self: flex-start; max-width: max-content;">Awaiting Dispatch</span>
            </div>
            <div style="font-size: var(--fs-base); color: var(--text); line-height: 1.55; margin-top: var(--space-3);">Confirmed cruise missile signature. Airborne intercept authorised on scramble.</div>
            ${airframeList('Available airframes · Skrydstrup', skrydstrupList)}
            <button class="c-btn solid ok wide" style="justify-content: center;" data-rcv="qra-dispatch" data-id="${event.id}">
              Scramble F-35
            </button>
          </section>`;
      } else {
        dispatchBlock = `
          <section class="c-panel">
            <span class="c-chip accent">F-35 Airborne · Tracking</span>
            <div style="font-size: var(--fs-base); color: var(--text); line-height: 1.55; margin-top: var(--space-3);">Single airframe in the air from earlier scramble. Same aircraft covers this event. Neutralisation triggers on intercept.</div>
            ${airframeList('Airborne asset', skrydstrupList)}
          </section>`;
      }
    } else if (isMissile && _f35.airborne) {
      const skrydstrupList = aircraftAtBase('skrydstrup');
      dispatchBlock = `
        <section class="c-panel">
          <span class="c-chip accent">Flyvevåbnet Airborne</span>
          <div style="font-size: var(--fs-base); color: var(--text); line-height: 1.55; margin-top: var(--space-3);">F-35 scrambled from Skrydstrup. Intercept station near Copenhagen approach. Fighter response covers this event.</div>
          ${airframeList('Airborne asset', skrydstrupList)}
        </section>`;
    }

    // Severity → chip variant. Info/low = ok, medium = warn, high/critical = danger.
    const severityChipClass = { info: 'ok', low: 'ok', medium: 'warn', high: 'danger', critical: 'danger' }[severity] || 'warn';

    return `
      <aside class="rcv-response-overlay">
        <section class="c-panel">
          <div class="c-section-eyebrow">Response Overlay</div>
          <div class="c-section-title" style="margin-bottom: var(--space-3);">${pb?.title || 'Response'}</div>
          <span class="c-chip ${severityChipClass}">Severity · ${severity.toUpperCase()}</span>
        </section>

        ${dispatchBlock}

        <section class="c-panel">
          <div class="c-panel-hdr" style="border-bottom: none; padding-bottom: 0; margin-bottom: var(--space-3);">
            <span class="c-panel-title">Scramble Decision</span>
            ${marginMin != null ? `<span class="c-chip ${marginOk ? 'ok' : 'danger'}">${marginOk ? 'Intercept Feasible' : 'Margin Lost'}</span>` : ''}
          </div>
          <div class="c-stat-grid" style="margin-bottom: var(--space-3);">
            <div class="c-stat danger">
              <div class="c-stat-lbl">Threat to target</div>
              <div class="c-stat-val">${timeToTargetMin != null ? timeToTargetMin.toFixed(1) : '—'}<span class="c-stat-unit">min</span></div>
            </div>
            <div class="c-stat accent">
              <div class="c-stat-lbl">F-35 to intercept</div>
              <div class="c-stat-val">${interceptTimeMin != null ? interceptTimeMin.toFixed(1) : '—'}<span class="c-stat-unit">min</span></div>
            </div>
            <div class="c-stat ${marginOk ? 'ok' : 'danger'}">
              <div class="c-stat-lbl">Margin</div>
              <div class="c-stat-val">${marginMin != null ? (marginOk ? '+' : '') + marginMin.toFixed(1) : '—'}<span class="c-stat-unit">min</span></div>
            </div>
          </div>
          <svg viewBox="0 0 ${W} ${H}" class="rro-map" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; display: block; border: 1px solid var(--border);">
            <rect x="0" y="0" width="${W}" height="${H}" fill="var(--surface-bg)"/>
            ${gridSvg.join('')}
            ${targetSvg}
            ${trajSvg}
            ${interceptSvg}
            ${skrydstrupSvg}
            ${threatSvg}
            ${scaleSvg}
            ${readoutSvg}
          </svg>
          <div style="display: flex; gap: var(--space-4); margin-top: var(--space-2);">
            <span class="c-label">ALT ${event.lastPosition?.alt || '?'}m</span>
            <span class="c-label">HDG ${heading != null ? Math.round(heading) + '°' : '?'}</span>
            <span class="c-label" style="margin-left: auto; color: var(--accent);">Live · Bjæverskov cross cue</span>
          </div>
        </section>

        ${bundle.tactical.length ? `
        <section class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">Tactical Assets</div>
          <div>${bundle.tactical.map(a => assetRow(a, true)).join('')}</div>
          <div class="c-label" style="margin-top: var(--space-2); line-height: 1.5; text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs);">${bundle.tacticalRationale || 'Airborne + maritime. Only these can act on the threat in flight.'}</div>
        </section>` : (bundle.tacticalRationale ? `
        <section class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">Tactical Assets</div>
          <div class="c-label" style="line-height: 1.5; text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs);">${bundle.tacticalRationale}</div>
        </section>` : '')}

        ${bundle.ground.length ? `
        <section class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">Ground Coordination</div>
          <div>${bundle.ground.map(a => assetRow(a, false)).join('')}</div>
          <div class="c-label" style="margin-top: var(--space-2); line-height: 1.5; text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs);">Perimeter cordon, evidence, operator arrest.</div>
        </section>` : ''}

        ${bundle.consequence.length ? `
        <section class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">Consequence + Reinforcement</div>
          <div>${bundle.consequence.map(a => assetRow(a, false)).join('')}</div>
          <div class="c-label" style="margin-top: var(--space-2); line-height: 1.5; text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs);">Civil emergency, mass alert, reinforcement.</div>
        </section>` : ''}

        <section class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-3);">Playbook · Full Response Chain</div>
          <ol style="padding-left: 0; margin: 0; list-style: none; counter-reset: rro-step;">
            ${(pb?.immediateActions || []).map(a => `
              <li style="display: grid; grid-template-columns: 24px 1fr; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); counter-increment: rro-step; font-size: var(--fs-sm); line-height: 1.55; color: var(--text);">
                <span class="c-label" style="text-align: right;">${'0' + (pb.immediateActions.indexOf(a) + 1)}</span>
                <span>${a}</span>
              </li>`).join('')}
          </ol>
        </section>

        ${pb?.coordination?.length ? `
        <section class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">Coordination</div>
          <ul style="padding-left: var(--space-4); margin: 0; font-size: var(--fs-sm); color: var(--text); line-height: 1.6;">
            ${pb.coordination.map(a => `<li style="margin-bottom: var(--space-1);">${a}</li>`).join('')}
          </ul>
        </section>` : ''}

        ${pb?.handoffTo?.length ? `
        <section class="c-panel">
          <div class="c-panel-title" style="margin-bottom: var(--space-2);">Handoff</div>
          <div style="display: flex; flex-wrap: wrap; gap: var(--space-1);">
            ${pb.handoffTo.map(h => `<span class="c-chip">${h}</span>`).join('')}
          </div>
        </section>` : ''}
      </aside>
    `;
  }

  // ── Event Workspace ─────────────────────────────────────────────
  // Full-screen surface opened when receiver clicks Open Report or
  // Open Live Map from the inbox. Structure:
  //   TOP BAR:  back arrow · event ID + type · mode toggle · close
  //   CENTER:   Report (case-file) OR Live Map (Cesium focus mode)
  //   RIGHT:    Mission Console (recommendation, COAs, authorize, journal)
  // Sub-phases 3.2/3.3/3.4 fill in the Mission Console + Report + Map
  // content. This is the shell + routing only.
  function renderEventWorkspace(event) {
    const role = getActiveRole();
    const typeLabel = event.droneType || event.classification || 'Event';
    const isMap = _workspaceMode === 'map';
    return `
      <div class="rcv-workspace ${isMap ? 'is-map-mode' : ''}">
        <header class="rws-topbar">
          <button class="c-btn-icon" data-rcv="workspace-back" aria-label="Back to inbox" title="Back to inbox">←</button>
          <div class="rws-ident">
            <span class="rws-ident-id">${event.id}</span>
            <span class="rws-ident-sep">·</span>
            <span class="rws-ident-type">${typeLabel}</span>
          </div>
          <div class="rws-mode-toggle" role="tablist">
            <button class="rws-mode ${_workspaceMode === 'report' ? 'active' : ''}" data-rcv="workspace-mode" data-mode="report" role="tab" aria-selected="${_workspaceMode === 'report'}">Report</button>
            <button class="rws-mode ${_workspaceMode === 'map' ? 'active' : ''}" data-rcv="workspace-mode" data-mode="map" role="tab" aria-selected="${_workspaceMode === 'map'}">Live Map</button>
          </div>
          <div class="rws-role-chip">${role.label}</div>
          <button class="c-btn-icon" data-rcv="workspace-close" aria-label="Close workspace" title="Close">×</button>
        </header>
        <div class="rws-body">
          <main class="rws-center rws-center-${_workspaceMode}">
            ${_workspaceMode === 'report'
              ? renderEventReport(event)
              : renderEventMapOverlay(event)}
          </main>
          <aside class="rws-console">${renderWorkspaceMissionConsole(event)}</aside>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────
  // PHASE 3.4 · Live Map overlay (Cesium behind, HUD in front)
  // ─────────────────────────────────────────────────────────────
  // The receiver workspace map mode overlays the existing platform
  // Cesium viewer. The workspace center is transparent so the map
  // shows through. HUD elements (layer toggle, coordinate readout,
  // fly-to hint) float on top. Camera is flown to the event on entry
  // and restored on exit.
  //
  // Layer toggle carries both 2D (SDFI GeoDanmark, default) and 3D
  // (disabled for this demo, per project_map_architecture.md — 3D
  // ships after paid EU provider selection is contract-supported).
  function renderEventMapOverlay(event) {
    const pos = _eventFocusCoords(event);
    const posLabel = pos
      ? `${pos.lat.toFixed(5)}° N, ${pos.lon.toFixed(5)}° E`
      : 'Position unknown';
    const insideCph = pos && _isInsideCphBbox(pos.lat, pos.lon);
    const threeDTip = insideCph
      ? 'Copenhagen 3D city model (free, sovereign). Coming after demo.'
      : 'Paid EU 3D provider (Hexagon or Airbus). Coming after contract.';
    return `
      <div class="rws-map-shell">
        <div class="rws-map-hud-top">
          <div class="rws-map-hud-chip">
            <span class="rws-map-hud-dot"></span>
            <span class="rws-map-hud-label">TRACKING</span>
            <span class="rws-map-hud-value">${event.id}</span>
          </div>
          <div class="rws-map-hud-chip mono">
            <span class="rws-map-hud-label">POSITION</span>
            <span class="rws-map-hud-value">${posLabel}</span>
          </div>
        </div>
        <div class="rws-map-layers">
          <div class="rws-map-layers-hdr">Basemap</div>
          <button class="rws-map-layer active" data-rcv="map-layer" data-layer="2d" title="SDFI GeoDanmark 12.5 cm orthophoto (nationwide, sovereign)">
            <span class="rws-map-layer-glyph">2D</span>
            <span class="rws-map-layer-body">
              <span class="rws-map-layer-label">Orthophoto (2D)</span>
              <span class="rws-map-layer-sub">SDFI GeoDanmark · Sovereign DK</span>
            </span>
            <span class="rws-map-layer-tick">●</span>
          </button>
          <button class="rws-map-layer disabled" data-rcv="map-layer-locked" data-layer="3d" title="${threeDTip}" aria-disabled="true">
            <span class="rws-map-layer-glyph">3D</span>
            <span class="rws-map-layer-body">
              <span class="rws-map-layer-label">Photorealistic (3D)</span>
              <span class="rws-map-layer-sub">${insideCph ? 'CPH city model' : 'Paid EU provider'} · Locked</span>
            </span>
            <span class="rws-map-layer-lock">🔒</span>
          </button>
        </div>
      </div>
    `;
  }

  // Extract flyable coordinates for the event. The SITE is the stable
  // anchor for a case view (matches Palantir/Anduril pattern — critical
  // infrastructure being defended, not the moving threat). Missile /
  // tracked-object position is visible as an entity within the frame
  // but does not drive camera position. This keeps the substation in
  // view even when the missile has moved on to the next sensor site.
  // Falls through to live position if the site is not defined.
  function _eventFocusCoords(event) {
    // Priority: actual THREAT position (live or last-known) → site center as
    // fallback. Was inverted — always centered on site centroid, so a
    // threat coming in from the east of CPH landed the camera on the
    // airport middle and the operator saw nothing at the threat itself.
    const live = event.lastKnownPosition || event.lastPosition;
    if (live && live.lat != null && live.lon != null) {
      return { lat: live.lat, lon: live.lon, alt: live.alt || 100 };
    }
    if (event.entry && event.entry.lat != null) {
      return { lat: event.entry.lat, lon: event.entry.lon, alt: event.entry.alt || 100 };
    }
    const site = SITES[event.siteId];
    if (site?.coordinates) {
      return { lat: site.coordinates.lat, lon: site.coordinates.lon, alt: 200 };
    }
    return null;
  }

  // CPH bbox per project_map_architecture.md. Point-in-rectangle.
  function _isInsideCphBbox(lat, lon) {
    return lat >= 55.45 && lat <= 56.05 && lon >= 12.05 && lon <= 12.85;
  }

  // Resolve an event by id from either the receiver's inbox or the
  // full events store. Needed by router actions that don't already
  // have the event object in scope.
  function _lookupWorkspaceEvent(id) {
    if (!id) return null;
    const role = getActiveRole();
    if (role.kind === 'receiver') {
      const inbox = eventsForDestinations(role.destinationIds);
      const hit = inbox.find(e => e.id === id);
      if (hit) return hit;
    }
    return EVENTS.find(e => e.id === id) || null;
  }

  // Camera state save/restore across mode transitions. Stored as
  // module-local so multiple entries/exits work.
  let _preWorkspaceCameraState = null;
  function _saveCameraState() {
    _preWorkspaceCameraState = {
      destination: viewer.camera.position.clone(),
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll,
    };
  }
  function _restoreCameraState() {
    if (!_preWorkspaceCameraState) return;
    viewer.camera.flyTo({
      destination: _preWorkspaceCameraState.destination,
      orientation: {
        heading: _preWorkspaceCameraState.heading,
        pitch: _preWorkspaceCameraState.pitch,
        roll: _preWorkspaceCameraState.roll,
      },
      duration: 1.2,
    });
    _preWorkspaceCameraState = null;
  }

  // Enter map mode: unhide Cesium behind the workspace, save camera,
  // fly to the event with a cinematic 2s ease. Called on workspace-mode
  // transitions and initial workspace entry when default mode is map.
  function _enterMapMode(event) {
    document.body.classList.add('workspace-map-active');
    // Swap to sovereign SDFI imagery over Denmark if the token was
    // provided at platform init. Bing stays loaded but is hidden while
    // the receiver is in workspace map mode.
    const sdfi = window.__isr_sdfiLayer;
    if (sdfi) {
      sdfi.show = true;
      if (bingLayer) bingLayer.alpha = 0;
    }
    if (!_preWorkspaceCameraState) _saveCameraState();
    const pos = _eventFocusCoords(event);
    if (!pos) return;
    // Use flyToBoundingSphere so the threat is CENTERED on screen, not
    // offset by camera pitch. Previous flyTo with pitch=-55° placed the
    // destination point off-center (target visible in front-of-camera
    // rather than centered). Bounding sphere pins the target under the
    // camera reticle regardless of pitch.
    const bigSite = event.siteId === 'cph' || event.siteId === 'esbjerg';
    const range = bigSite ? 2200 : 1100;   // metres pulled back
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 0), 150),
      {
        duration: 2.0,
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-55),
          range,
        ),
      }
    );
  }
  function _exitMapMode() {
    document.body.classList.remove('workspace-map-active');
    const sdfi = window.__isr_sdfiLayer;
    if (sdfi) {
      sdfi.show = false;
      if (bingLayer) bingLayer.alpha = 1;
    }
    _restoreCameraState();
  }

  // ─────────────────────────────────────────────────────────────
  // PHASE 3.3 · Live Event Report (case-file center pane)
  // ─────────────────────────────────────────────────────────────
  // Case-file layout for Report mode. Six sections top-to-bottom:
  //   1. Case header  — identity + status at a glance
  //   2. AI synthesis — Mistral summary placeholder + recommendation
  //   3. Recommended actions — CTA rail wired to real handlers
  //   4. Detection ground truth — existing renderDetectionBrief
  //   5. Situational context — available assets + pattern match (stubs)
  //   6. Audit trail — timestamped journal from event history
  //
  // AI synthesis and situational context use realistic mock data with
  // clear "PLACEHOLDER" affordances until the Mistral integration and
  // asset/pattern services land. CTAs wire into the same handlers the
  // legacy right-pane used, so no backend logic is duplicated.
  function renderEventReport(event) {
    const role = getActiveRole();
    const roleDestSet = new Set(role.destinationIds || []);
    const rec = event.escalations.find(r => roleDestSet.has(r.destinationId));
    const site = SITES[event.siteId];
    const isActive = event.status === 'active';
    const dispatchTs = rec?.statusHistory?.[0]?.timestamp;
    const dispatchAge = dispatchTs ? _secSince(dispatchTs) : null;
    const ackTs = rec?.statusHistory?.find(h => h.status === 'acknowledged')?.timestamp;
    const isAcked = !!ackTs;

    const platformLabel = (event.platform || 'unknown').replace(/-/g, ' ');
    const confPct = Math.round((event.confidence || 0) * 100);
    const clsChip = `<span class="rer-cls rer-cls-${event.classification}">${(event.classification || '').toUpperCase()}</span>`;
    const threatChip = event.threat ? `<span class="rer-threat rer-threat-${event.threat}">${event.threat.toUpperCase()} THREAT</span>` : '';

    // ── 1. Case header ─────────────────────────────────────────
    const header = `
      <section class="rer-header">
        <div class="rer-header-top">
          ${clsChip}
          ${threatChip}
          ${isActive ? '<span class="rer-live">● LIVE</span>' : '<span class="rer-closed">CLOSED</span>'}
          <span class="rer-conf">Confidence ${confPct}%</span>
        </div>
        <h1 class="rer-title">${event.droneType || 'Unknown platform'}</h1>
        <div class="rer-header-meta">
          <span class="rer-meta-item"><span class="rer-meta-k">Case</span><span class="rer-meta-v">${event.id}</span></span>
          <span class="rer-meta-item"><span class="rer-meta-k">Site</span><span class="rer-meta-v">${site?.name || event.siteId}</span></span>
          <span class="rer-meta-item"><span class="rer-meta-k">Platform</span><span class="rer-meta-v">${platformLabel}</span></span>
          <span class="rer-meta-item"><span class="rer-meta-k">Dispatched</span><span class="rer-meta-v">${dispatchAge != null ? _fmtAge(dispatchAge) + ' ago' : '—'}</span></span>
          <span class="rer-meta-item"><span class="rer-meta-k">Status</span><span class="rer-meta-v">${isAcked ? 'Acknowledged' : (rec?.status || 'pending').toUpperCase()}</span></span>
        </div>
      </section>`;

    // ── 2. AI Synthesis (Agent 3 · Narrative) ──────────────────
    // Deterministic mock renders synchronously as immediate placeholder.
    // If Mistral is configured, streamCaseFileNarrative fires after the
    // workspace mounts and streams real tokens into the same DOM nodes.
    // Fall-through on any error means the mock text stays visible.
    const aiSummary = _mockAiSynthesis(event, site);
    const modelLabel = isMistralConfigured() ? 'Mistral Large 2' : 'Mock synthesis (Mistral not configured)';
    const ai = `
      <section class="rer-section rer-ai">
        <div class="rer-section-hdr">
          <div class="c-section-eyebrow rer-eyebrow-accent">AI Synthesis · ${modelLabel}</div>
          <button class="c-btn-icon rer-ai-refresh" data-rcv="ai-refresh" title="Regenerate summary" aria-label="Regenerate">↻</button>
        </div>
        <p class="rer-ai-body" data-ai-body="${event.id}">${aiSummary.body}</p>
        <div class="rer-ai-reco">
          <span class="rer-ai-reco-label">Recommendation</span>
          <span class="rer-ai-reco-text" data-ai-reco="${event.id}">${aiSummary.recommendation}</span>
        </div>
        <div class="rer-ai-foot" data-ai-foot="${event.id}">Generated ${aiSummary.generatedAgo}s ago · Sovereign EU inference · Model: mock-v1</div>
      </section>`;

    // ── 3. Your response (this receiver's actions) ─────────────
    const ctas = _buildRecommendedCtas(event, rec, isAcked, isActive);
    // Response composer — appears inline when "Respond to operator" is
    // clicked. Sends a text message back to the operator inbox, threaded
    // on this escalation. Previously only rendered in inbox split view,
    // making the workspace "Respond" button appear to do nothing.
    const isResponding = rec && _respondingEscId === rec.id;
    const composerHtml = isResponding ? `
      <div class="rer-composer" style="margin-top: var(--space-3); padding: var(--space-3); background: rgba(77, 210, 255, 0.05); border-left: 2px solid var(--accent); border-radius: 2px;">
        <div class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); font-size: var(--fs-2xs); margin-bottom: var(--space-2);">Response to operator</div>
        <textarea id="rcv-response-text" rows="3" placeholder="Type your response here. Delivered to the operator inbox with your role and timestamp." style="width: 100%; padding: var(--space-2); background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 2px; color: var(--text); font-family: var(--font-body); font-size: var(--fs-sm); line-height: 1.5; resize: vertical; box-sizing: border-box;"></textarea>
        <div style="margin-top: var(--space-2); display: flex; gap: var(--space-2); justify-content: flex-end;">
          <button class="c-btn" data-rcv="respond-cancel">Cancel</button>
          <button class="c-btn primary" data-rcv="respond-send" data-esc="${rec.id}">Send response</button>
        </div>
      </div>` : '';
    // Sent-response display: if the operator has already responded to
    // this receiver's message, show the reply thread inline.
    const sentHtml = rec?.response ? `
      <div style="margin-top: var(--space-3); padding: var(--space-3); background: rgba(77, 255, 156, 0.05); border-left: 2px solid var(--ok); border-radius: 2px;">
        <div class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: var(--ok); font-size: var(--fs-2xs); margin-bottom: var(--space-1);">Your response sent ${rec.response.receivedAt ? rec.response.receivedAt.slice(11,19) + 'Z' : ''}</div>
        <div style="font-size: var(--fs-sm); color: var(--text); line-height: 1.5;">${rec.response.text}</div>
      </div>` : '';
    const actions = `
      <section class="rer-section rer-actions">
        <div class="c-section-eyebrow">Your Response · ${role.name || 'Receiver'}</div>
        <div class="rer-cta-rail">
          ${ctas.map(c => `
            <button class="rer-cta ${c.tone}" data-rcv="${c.action}" data-id="${event.id}" ${c.esc ? `data-esc="${c.esc}"` : ''} title="${c.tooltip}" ${c.disabled ? 'disabled' : ''}>
              <span class="rer-cta-icon">${c.icon}</span>
              <span class="rer-cta-body">
                <span class="rer-cta-label">${c.label}</span>
                <span class="rer-cta-sub">${c.sub}</span>
              </span>
            </button>`).join('')}
        </div>
        ${composerHtml}
        ${sentHtml}
      </section>`;

    // ── 4. Detection ground truth ──────────────────────────────
    const brief = `
      <section class="rer-section rer-brief">
        <div class="c-section-eyebrow">Detection ground truth</div>
        <div class="rcv-brief-wrap">${renderDetectionBrief(event)}</div>
      </section>`;

    // ── 5. Historical context (real EVENTS query, no more hardcoded stubs) ──
    // "Available assets" card removed entirely — was mock ("2 QRA / 4 Politi
    // / DEMA 45 min") duplicating the Response Overlay's real distance-sorted
    // bundle. Pattern-match card kept but now computed from the actual
    // EVENTS array — same platform in 30d, same site in 90d, correlated
    // advisories from linkedEventIds.
    const pattern = _computeReceiverPatternMatch(event);
    const context = `
      <section class="rer-section rer-context">
        <div class="c-section-eyebrow">Historical context</div>
        <div class="rer-ctx-card rer-ctx-single">
          <div class="rer-ctx-hdr">Pattern match</div>
          <div class="rer-ctx-rows">
            <div class="rer-ctx-row"><span class="rer-ctx-k">Similar platform, last 30 days</span><span class="rer-ctx-v">${pattern.samePlatform30d} event${pattern.samePlatform30d === 1 ? '' : 's'}</span></div>
            <div class="rer-ctx-row"><span class="rer-ctx-k">This site, last 90 days</span><span class="rer-ctx-v">${pattern.sameSite90d} incursion${pattern.sameSite90d === 1 ? '' : 's'}</span></div>
            <div class="rer-ctx-row"><span class="rer-ctx-k">Same site + same platform, 90d</span><span class="rer-ctx-v">${pattern.sameBoth90d}</span></div>
            <div class="rer-ctx-row"><span class="rer-ctx-k">Correlated advisories</span><span class="rer-ctx-v">${pattern.correlated > 0 ? pattern.correlated + ' active link' + (pattern.correlated === 1 ? '' : 's') : 'None active'}</span></div>
          </div>
          <div class="rer-ctx-foot">Computed from live event registry · Tactical assets in Response Overlay →</div>
        </div>
      </section>`;

    // ── 6. Audit trail ─────────────────────────────────────────
    const journalEntries = _buildAuditJournal(event, rec);
    const audit = `
      <section class="rer-section rer-audit">
        <div class="c-section-eyebrow">Audit trail</div>
        <ol class="rer-journal">
          ${journalEntries.map(j => `
            <li class="rer-journal-row">
              <span class="rer-journal-ts">${j.ts}</span>
              <span class="rer-journal-dot"></span>
              <span class="rer-journal-body">
                <span class="rer-journal-title">${j.title}</span>
                ${j.detail ? `<span class="rer-journal-detail">${j.detail}</span>` : ''}
                <span class="rer-journal-actor">${j.actor}</span>
              </span>
            </li>`).join('')}
        </ol>
        <div class="rer-audit-foot">Append-only record. Retained for compliance.</div>
      </section>`;

    return `
      <article class="rer-report">
        ${header}
        ${ai}
        ${actions}
        ${brief}
        ${context}
        ${audit}
      </article>`;
  }

  // Deterministic mock AI synthesis. Uses real event fields so the text
  // varies believably per case. Replaced by Mistral streaming later.
  // Real-data pattern match — filters the live EVENTS registry by
  // platform / site / time window. Replaces the hardcoded stub values
  // ("3 events / 7 incursions / 11 nationwide") with actual counts.
  function _computeReceiverPatternMatch(event) {
    const nowMs = Date.now();
    const D30 = 30 * 86400 * 1000;
    const D90 = 90 * 86400 * 1000;
    const startMs = (e) => { try { return new Date(e.startTime).getTime(); } catch { return 0; } };
    let samePlatform30d = 0, sameSite90d = 0, sameBoth90d = 0;
    for (const e of EVENTS) {
      if (e.id === event.id) continue;
      const ageMs = nowMs - startMs(e);
      if (ageMs < 0) continue;
      const platMatch = e.platform === event.platform;
      const siteMatch = e.siteId === event.siteId;
      if (platMatch && ageMs <= D30) samePlatform30d++;
      if (siteMatch && ageMs <= D90) sameSite90d++;
      if (platMatch && siteMatch && ageMs <= D90) sameBoth90d++;
    }
    const correlated = (event.linkedEventIds || []).length;
    return { samePlatform30d, sameSite90d, sameBoth90d, correlated };
  }

  // Fires the Mistral streaming call for the currently-mounted case-file.
  // The mock summary is already in the DOM as a placeholder. Tokens replace
  // it as they arrive. On error the mock stays visible.
  //
  // DEDUP INVARIANT: renderReceiverView runs on ~15 triggers (tick loops,
  // ack, respond, filter changes). We must NOT re-fire Mistral on every
  // render or we blink the UI and slam the rate limit. Track which event
  // last fired; skip if the workspace is still on the same event. Only
  // force re-fire on ai-refresh (bypasses dedup) or workspace change.
  // 429 backoff parks the event in a cooldown window that expires after
  // MISTRAL_COOLDOWN_MS so retries stop until the demo tier resets.
  let _mistralCaseFileGen = 0;
  let _mistralFiredForEvent = null;   // event.id we last fired for
  const _mistralCooldownUntil = new Map();   // event.id -> Date.now() cooldown expiry
  const _mistralResultCache = new Map();   // event.id -> {body, recommendation, model_version, generated_at}
  const MISTRAL_COOLDOWN_MS = 45 * 1000;   // 45s cooldown on 429

  function _fireMistralCaseFile(event, opts = {}) {
    if (!isMistralConfigured() || !event) return;
    const { force = false } = opts;

    const bodyEl = document.querySelector(`[data-ai-body="${event.id}"]`);
    const recoEl = document.querySelector(`[data-ai-reco="${event.id}"]`);
    const footEl = document.querySelector(`[data-ai-foot="${event.id}"]`);
    if (!bodyEl || !recoEl) return;

    // Cache restore: if we already generated a Mistral summary for this
    // event, paint it back immediately after the re-render wiped the
    // DOM. Prevents "blinking" where Mistral text is lost every time
    // an escalation status changes and triggers a re-render.
    if (!force) {
      const cached = _mistralResultCache.get(event.id);
      if (cached) {
        bodyEl.textContent = cached.body;
        recoEl.textContent = cached.recommendation;
        if (footEl) footEl.textContent = `Generated ${_ageString(cached.generated_at)} ago · Sovereign EU inference · Model: ${cached.model_version}`;
        return;   // cached restore, no new stream
      }
    }

    // Cooldown check: if we recently 429'd for this event, hold on mock
    const cooldownExp = _mistralCooldownUntil.get(event.id) || 0;
    if (!force && Date.now() < cooldownExp) return;
    if (force) { _mistralCooldownUntil.delete(event.id); _mistralResultCache.delete(event.id); }

    // Dedup: same event as last fire? Skip. On force (ai-refresh) or new
    // event, proceed and set the fired-for tracker.
    if (!force && _mistralFiredForEvent === event.id) return;
    _mistralFiredForEvent = event.id;

    const gen = ++_mistralCaseFileGen;

    // Show "generating" state on the foot so the operator knows the
    // real model is being invoked over the mock placeholder.
    if (footEl) footEl.textContent = 'Streaming from Mistral Large 2 · sovereign EU inference...';

    const site = SITES[event.siteId];
    let hasReplacedBody = false;
    streamCaseFileNarrative(event, site, {
      onBodyDelta: (text) => {
        if (gen !== _mistralCaseFileGen) return;
        if (!hasReplacedBody) { bodyEl.textContent = ''; hasReplacedBody = true; }
        bodyEl.textContent = text.trim();
      },
      onRecoDelta: (text) => {
        if (gen !== _mistralCaseFileGen) return;
        recoEl.textContent = text.trim();
      },
      onDone: (result) => {
        if (gen !== _mistralCaseFileGen) return;
        // Cache the completed result so future re-renders restore it
        // from cache instead of re-firing (kills the "blink").
        _mistralResultCache.set(event.id, {
          body: result.body,
          recommendation: result.recommendation,
          model_version: result.model_version,
          generated_at: Date.now(),
        });
        if (footEl) footEl.textContent = `Generated just now · Sovereign EU inference · Model: ${result.model_version} · Verify against ground truth`;
      },
      onError: (err) => {
        if (gen !== _mistralCaseFileGen) return;
        console.warn('[mistral case-file] falling back to mock:', err.message);
        // 429 = rate limit. Park this event in cooldown so we don't
        // hammer the endpoint on every subsequent render.
        if (/429|Rate limit/i.test(err.message)) {
          _mistralCooldownUntil.set(event.id, Date.now() + MISTRAL_COOLDOWN_MS);
          if (footEl) footEl.textContent = `Mistral rate-limited. Showing mock synthesis. Retry available in ${Math.round(MISTRAL_COOLDOWN_MS / 1000)}s or click regenerate.`;
        } else {
          if (footEl) footEl.textContent = `Mistral unreachable · showing mock synthesis · ${err.message.slice(0, 80)}`;
        }
      },
    });
  }

  // Compact "N sec ago" / "N min ago" formatter for cached Mistral timestamps
  function _ageString(ts) {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)} min`;
    return `${Math.floor(sec / 3600)}h`;
  }

  function _mockAiSynthesis(event, site) {
    const cls = event.classification || 'unknown';
    const platform = (event.platform || 'unknown').replace(/-/g, ' ');
    const siteName = site?.name || event.siteId;
    const conf = Math.round((event.confidence || 0) * 100);
    const isHostile = cls === 'hostile';
    const isFriendly = cls === 'friendly';
    const isMissile = event.platform === 'missile';

    let body, recommendation;
    if (isMissile) {
      body = `Track ${event.id} classified as cruise missile signature with ${conf}% confidence, projecting toward ${siteName}. RF, acoustic, and visual modalities in agreement across ${event.sensorsTop?.length || 3} sensors. No matching flight plan on file. Trajectory consistent with terrain-following ingress from the southwest. Estimated time to inner perimeter: sub-minute.`;
      recommendation = `Immediate national escalation. Air Force dispatch QRA. All lower tiers acknowledge and prepare shelter posture.`;
    } else if (isHostile) {
      body = `Track ${event.id} classified as hostile ${platform} at ${siteName} with ${conf}% confidence. Fused RF, acoustic, and visual signals show consistent classification across ${event.sensorsTop?.length || 3} sensors. No corresponding transponder or flight plan match. Behavior pattern indicates deliberate incursion rather than off-course commercial traffic.`;
      recommendation = `Dispatch site security immediately. Recommend Politi coordination within 90 seconds. Consider FE notification if platform capability suggests strategic intent.`;
    } else if (isFriendly) {
      body = `Track ${event.id} classified as friendly ${platform} at ${siteName} with ${conf}% confidence. Signature matches registered internal inspection asset. Cross-referenced with active flight plan and operator schedule.`;
      recommendation = `Log for audit record. No response action required. Continue passive monitoring.`;
    } else {
      body = `Track ${event.id} at ${siteName} with ${conf}% confidence. Platform classification ambiguous based on current sensor return. Fused RF, acoustic, and visual signals show partial agreement.`;
      recommendation = `Hold classification for additional sensor confirmation. Consider requesting supplemental optics if track persists beyond 60 seconds.`;
    }
    return { body, recommendation, generatedAgo: 4 };
  }

  // Build the CTA rail. Deduplicates on role scope + current escalation
  // state. Each CTA has: label, sub, tooltip, action (matches router),
  // tone ('primary' | 'accent' | 'neutral' | 'danger'), icon.
  function _buildRecommendedCtas(event, rec, isAcked, isActive) {
    const ctas = [];
    if (rec && !isAcked) {
      ctas.push({
        label: 'Acknowledge receipt', sub: 'Confirm you have the case', icon: '✓', tone: 'primary',
        action: 'ack', esc: rec.id,
        tooltip: 'Sends acknowledgement to the operator. Records the acknowledgement in the audit trail.',
      });
    }
    if (isActive && event.platform === 'missile') {
      ctas.push({
        label: 'Dispatch QRA fighter', sub: 'Skrydstrup, 15 min alert', icon: '✈', tone: 'accent',
        action: 'qra-dispatch',
        tooltip: 'Requests QRA intercept from Air Force. Only available while the event is active.',
      });
    }
    if (isActive) {
      ctas.push({
        label: 'Cascade to FE / PET', sub: 'Strategic intelligence', icon: '⇧', tone: 'neutral',
        action: 'cascade-fe-pet',
        tooltip: 'Cascades this event to Forsvarets Efterretningstjeneste (FE) + Politiets Efterretningstjeneste (PET). Records the cascade in the operator audit trail with your role as initiator.',
      });
      ctas.push({
        label: 'Cascade to local Politi', sub: 'Politikreds coordination', icon: '⚑', tone: 'neutral',
        action: 'cascade-politi',
        tooltip: 'Cascades this event to the local Politikreds responsible for this site. Operator sees the new escalation record with your role attribution.',
      });
    }
    if (rec) {
      ctas.push({
        label: 'Respond to operator', sub: 'Send back to source', icon: '↩', tone: 'neutral',
        action: 'respond-open', esc: rec.id,
        tooltip: 'Opens the response composer. Reply is delivered to the operator inbox.',
      });
    }
    return ctas;
  }

  // Build audit trail from event + escalation history.
  function _buildAuditJournal(event, rec) {
    const entries = [];
    if (event.createdAt) {
      entries.push({
        ts: _fmtTs(event.createdAt),
        title: 'Event detected',
        detail: `${event.droneType || 'Unknown'} classified as ${event.classification}`,
        actor: 'ISR C2 Platform',
      });
    }
    if (rec?.statusHistory) {
      rec.statusHistory.forEach(h => {
        entries.push({
          ts: _fmtTs(h.timestamp),
          title: h.status === 'sent' ? 'Dispatched to your inbox'
               : h.status === 'delivered' ? 'Delivery confirmed'
               : h.status === 'read' ? 'Marked as read'
               : h.status === 'acknowledged' ? 'Acknowledgement sent'
               : `Status: ${h.status}`,
          detail: '',
          actor: h.status === 'acknowledged' ? `${getActiveRole().person || 'You'}` : 'System',
        });
      });
    }
    if (rec?.response) {
      entries.push({
        ts: _fmtTs(rec.response.receivedAt),
        title: 'Response sent to operator',
        detail: rec.response.text.length > 90 ? rec.response.text.slice(0, 90) + '…' : rec.response.text,
        actor: rec.response.respondedBy || 'You',
      });
    }
    if (event.closedAt) {
      entries.push({
        ts: _fmtTs(event.closedAt),
        title: 'Event closed',
        detail: '',
        actor: 'ISR C2 Platform',
      });
    }
    return entries.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  function _secSince(iso) {
    try { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); }
    catch (e) { return null; }
  }
  function _fmtAge(sec) {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    return `${Math.round(sec / 3600)}h`;
  }
  function _fmtTs(iso) {
    try { return iso.slice(11, 19) + 'Z'; } catch (e) { return iso; }
  }

  // ══════════════════════════════════════════════════════════════════
  // P92 · Parent landing page — hierarchical role selection
  // ══════════════════════════════════════════════════════════════════
  // When a receiver logs in as a parent (Forsvaret, Hæren, Politi,
  // etc.), they land on a tile grid of children instead of an inbox.
  // Each tile shows the child org, roll-up active event count,
  // description, and a "Drill in" affordance. Clicking sets the child
  // as the active role and renders the normal receiver view.
  function renderReceiverParentLanding(role, children) {
    const tiles = children.map(child => {
      const dests = child.destinationIds || getRoleDestinationIdsRolledUp(child.id);
      const activeEvents = eventsForDestinations(dests).filter(e => e.status === 'active');
      const badge = activeEvents.length
        ? `<span class="c-chip warn" style="align-self: flex-start; max-width: max-content;">${activeEvents.length} ACTIVE</span>`
        : `<span class="c-chip ok" style="align-self: flex-start; max-width: max-content;">No active events</span>`;
      const isParent = child.type === 'parent';
      const grandchildCount = isParent && child.childrenIds ? child.childrenIds.length : 0;
      return `
        <button class="rcv-parent-tile" data-parent-pick="${child.id}" style="
          text-align: left; padding: var(--space-4); border-radius: var(--radius);
          background: var(--surface-panel); border: 1px solid var(--border);
          cursor: pointer; display: flex; flex-direction: column; gap: var(--space-2);
          transition: border-color 120ms, background 120ms;
        ">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);">
            <div>
              <div class="c-label" style="text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); font-size: var(--fs-2xs);">${isParent ? 'BRANCH' : 'BASE'}</div>
              <div style="font-size: var(--fs-lg); color: var(--text); font-weight: 600; margin-top: 2px;">${child.org}</div>
            </div>
            ${badge}
          </div>
          <div class="c-label" style="text-transform: none; letter-spacing: var(--ls-body); font-family: var(--font-body); font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.55;">${child.description || ''}</div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding-top: var(--space-2); border-top: 1px solid var(--border);">
            <div class="c-label" style="color: var(--text-dim);">
              ${isParent ? `${grandchildCount} sub-unit${grandchildCount === 1 ? '' : 's'}` : (child.person || 'Duty officer')}
            </div>
            <div class="c-label" style="color: var(--accent);">Drill in →</div>
          </div>
        </button>`;
    }).join('');

    return `
      <div class="rcv-parent-landing" style="padding: var(--space-6); max-width: 1200px; margin: 0 auto;">
        <div style="margin-bottom: var(--space-5);">
          <div class="c-label" style="text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-dim); font-size: var(--fs-2xs);">Logged in as</div>
          <h1 style="font-size: var(--fs-2xl); color: var(--text); margin: var(--space-1) 0 var(--space-2); font-weight: 600;">${role.label}</h1>
          <p style="color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.55; max-width: 720px;">${role.description || 'Select a sub-unit to drill in.'}</p>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-3);">
          ${tiles}
        </div>
      </div>
      <style>
        .rcv-parent-tile:hover { border-color: var(--accent) !important; background: rgba(77, 210, 255, 0.04) !important; }
      </style>
    `;
  }

  function _bindReceiverParentActions() {
    receiverView.querySelectorAll('[data-parent-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const childId = btn.dataset.parentPick;
        const child = RECEIVERS.find(r => r.id === childId);
        if (!child) return;
        _lastReceiverViewSig = null;   // force full re-render on role change
        setActiveRole(childId);
      });
    });
  }

  // P94: Memoize renderReceiverView. Rebuilding receiverView.innerHTML on
  // every _listeners fire (escalation status transitions, addNote,
  // reacquisition auto-escalations) caused visible full-DOM blink every
  // time an event mutated. Compute a signature of the render inputs. If
  // unchanged, skip the innerHTML replace and reuse the existing DOM.
  // Live values (positions, ETAs, confidences) update via _patchLiveTelemetry
  // separately without needing a full re-render.
  let _lastReceiverViewSig = null;
  function _receiverViewSignature(role, wsEvent, selectedEvId, receivedEvents) {
    // Include the latest status of every escalation on the workspace
    // event so ack / delivered / read / responded transitions actually
    // trigger a re-render (previously the sig stayed the same and Step
    // 2 in the Mission Console never unlocked after ack).
    const escStatusHash = wsEvent
      ? (wsEvent.escalations || []).map(e =>
          `${e.id}:${e.statusHistory?.[e.statusHistory.length - 1]?.status || 'pending'}:${e.response ? 'r' : 'nr'}`
        ).join(',')
      : '';
    const parts = [
      role?.id || 'no-role',
      _workspaceEventId || 'no-ws',
      _workspaceMode || 'inbox',
      selectedEvId || 'no-sel',
      _respondingEscId || 'no-resp',
      // Workspace-event specific: escalation count + outcome + status +
      // active dispatch count + confirmed outcomes + handoffs done so
      // Steps 3→4→5→6 transitions all trigger a re-render.
      wsEvent ? `${wsEvent.id}:${(wsEvent.escalations || []).length}:${wsEvent.outcome || 'n'}:${wsEvent.status}:${(wsEvent.counterDispatches || []).length}:o${Object.keys(wsEvent.dispatchOutcomes || {}).length}:h${(wsEvent.postIncidentDispatched || []).length}` : 'no-wsev',
      // Ack + response state per escalation
      escStatusHash,
      // Inbox-mode: cardinality of visible events so ledger updates re-render.
      `evc:${receivedEvents.length}`,
    ];
    return parts.join('|');
  }

  function renderReceiverView(opts = {}) {
    const role = getActiveRole();
    if (role.kind !== 'receiver') { receiverView.style.display = 'none'; _lastReceiverViewSig = null; return; }

    // P92: Parent roles land on a chooser tile grid (Forsvaret →
    // branches, Hæren → bases, Politi → districts). Leaf roles get the
    // normal inbox flow below. Signature includes children active-count
    // so newly incoming events refresh the tile counts.
    if (role.type === 'parent') {
      const children = getRoleChildren(role.id);
      const sig = `parent:${role.id}:${children.map(c => eventsForDestinations(c.destinationIds || getRoleDestinationIdsRolledUp(c.id)).length).join(',')}`;
      if (!opts.force && sig === _lastReceiverViewSig) return;
      _lastReceiverViewSig = sig;
      receiverView.innerHTML = renderReceiverParentLanding(role, children);
      receiverView.style.display = 'block';
      _bindReceiverParentActions();
      return;
    }

    const receivedEvents = eventsForDestinations(role.destinationIds);

    // Workspace mode takes over the entire receiver surface. Inbox and
    // response overlay are hidden while the operator is investigating a
    // specific event in Report or Live Map mode.
    if (_workspaceEventId) {
      const wsEvent = receivedEvents.find(e => e.id === _workspaceEventId)
                    || EVENTS.find(e => e.id === _workspaceEventId);
      if (wsEvent) {
        const sig = _receiverViewSignature(role, wsEvent, null, receivedEvents);
        if (!opts.force && sig === _lastReceiverViewSig) return;   // memoized, skip
        _lastReceiverViewSig = sig;
        receiverView.innerHTML = renderEventWorkspace(wsEvent);
        receiverView.style.display = 'block';
        _bindReceiverActions();
        _fireMistralCaseFile(wsEvent);
        return;
      }
      _workspaceEventId = null;   // event vanished, fall through to inbox
    }

    const selectedEv = _selectedReceiverEventId ? receivedEvents.find(e => e.id === _selectedReceiverEventId) : null;
    // Filter to escalations addressed to THIS role
    const roleDestSet = new Set(role.destinationIds);

    // ── Cross-cueing advisories ─────────────────────────────────
    // Any active hostile event NOT already escalated to this receiver, but whose
    // projected path intersects a SITE this receiver has destinations for.
    const receiverSites = new Set();
    role.destinationIds.forEach(did => {
      const d = getDestination(did);
      if (d && d.siteId) receiverSites.add(d.siteId);
    });
    const receivedEventIds = new Set(receivedEvents.map(e => e.id));
    const advisories = EVENTS.filter(ev => {
      if (ev.status !== 'active') return false;
      if (receivedEventIds.has(ev.id)) return false;
      if (!ev.projectedPath || !ev.projectedPath.impacts) return false;
      return ev.projectedPath.impacts.some(imp => imp.kind === 'site' && receiverSites.has(imp.id));
    }).map(ev => {
      const relevantImpact = ev.projectedPath.impacts.find(imp => imp.kind === 'site' && receiverSites.has(imp.id));
      const originSite = SITES[ev.siteId];
      return { ev, impact: relevantImpact, originName: originSite ? originSite.name : ev.siteId };
    });

    const advisoryStrip = advisories.length ? advisories.map(({ ev, impact, originName }) => `
      <div class="rcv-advisory" data-rcv="advisory-view" data-id="${ev.id}">
        <div class="rcv-adv-tag">Projected Threat · Advisory</div>
        <div class="rcv-adv-body">
          <div class="rcv-adv-line">
            <span class="rcv-adv-k">Origin</span><span class="rcv-adv-v">${originName}</span>
            <span class="rcv-adv-k">Toward</span><span class="rcv-adv-v">${impact.name}</span>
          </div>
          <div class="rcv-adv-line">
            <span class="rcv-adv-k">Track</span><span class="rcv-adv-v mono">${ev.id}</span>
            <span class="rcv-adv-k">ETA</span><span class="rcv-adv-v strong">${impact.etaMin} min</span>
            <span class="rcv-adv-k">Dist</span><span class="rcv-adv-v">${impact.distanceKm} km</span>
          </div>
        </div>
      </div>`).join('') : '';

    const list = receivedEvents.length ? receivedEvents.map(e => {
      const rec = e.escalations.find(r => roleDestSet.has(r.destinationId));
      const isActive = e.status === 'active';
      const cls = e.classification;
      return `
        <div class="rcv-card ${cls} ${isActive ? 'is-live' : ''}" data-rcv="open-report" data-id="${e.id}" role="button" tabindex="0" title="Open case workspace">
          <div class="rcv-card-hdr">
            <span class="rcv-card-cls rcv-cls-${cls}">${(cls || '').toUpperCase()}</span>
            ${isActive ? '<span class="alert-live">● LIVE</span>' : ''}
            <span class="rcv-card-conf">${Math.round(e.confidence * 100)}%</span>
          </div>
          <div class="rcv-card-drone">${e.droneType}</div>
          <div class="rcv-card-meta">${e.id}  ·  ${SITES[e.siteId]?.name || e.siteId}</div>
          <div class="rcv-card-status">Dispatched: <b>${rec.statusHistory[0].timestamp.slice(11,19)}Z</b>  ·  Status: <b>${(rec.status || '').toUpperCase()}</b></div>
          <div class="rcv-card-actions">
            <button class="c-btn compact" data-rcv="open-map" data-id="${e.id}" title="Skip to Live Map">Open on map →</button>
          </div>
        </div>`;
    }).join('') : `<div class="rcv-empty">No events currently dispatched to ${role.label}.</div>`;

    const selectedRec = selectedEv ? selectedEv.escalations.find(r => roleDestSet.has(r.destinationId)) : null;
    const isResponding = _respondingEscId === (selectedRec && selectedRec.id);
    const detail = selectedEv ? `
      <div class="rcv-detail-hdr">
        <div class="rcv-detail-title">Incoming intelligence</div>
        <div class="rcv-detail-actions">
          ${selectedRec.status !== 'acknowledged' ? `<button class="btn primary" data-rcv="ack" data-esc="${selectedRec.id}">Acknowledge</button>` : `<span class="rcv-acked">Acknowledged at ${selectedRec.statusHistory.filter(h => h.status === 'acknowledged')[0]?.timestamp.slice(11,19) || ''}Z</span>`}
          <button class="btn" data-rcv="respond-open" data-esc="${selectedRec.id}">Send response</button>
        </div>
      </div>
      ${isResponding ? `
        <div class="rcv-respond">
          <textarea id="rcv-response-text" rows="3" placeholder="Response to operator..."></textarea>
          <div class="rcv-respond-actions">
            <button class="btn" data-rcv="respond-cancel">Cancel</button>
            <button class="btn primary" data-rcv="respond-send" data-esc="${selectedRec.id}">Send response</button>
          </div>
        </div>` : ''}
      ${selectedRec.response ? `
        <div class="rcv-response-sent">
          <div class="rcv-response-hdr">Your response sent ${selectedRec.response.receivedAt.slice(11,19)}Z</div>
          <div class="rcv-response-text">${selectedRec.response.text}</div>
        </div>` : ''}
      <div class="rcv-brief-wrap">${renderDetectionBrief(selectedEv)}</div>
    ` : `<div class="rcv-empty rcv-empty-detail">Select an incoming event on the left to view the detection brief.</div>`;

    const overlay = selectedEv ? renderResponseOverlay(selectedEv) : '';

    // P94 memoization guard for inbox mode
    const sig = _receiverViewSignature(role, null, _selectedReceiverEventId, receivedEvents);
    if (!opts.force && sig === _lastReceiverViewSig) return;
    _lastReceiverViewSig = sig;

    receiverView.innerHTML = `
      <aside class="rcv-list ${selectedEv ? '' : 'rcv-list--full'}">
        <div class="rcv-list-hdr">
          <span class="rcv-list-title">Inbox</span>
          <span class="rcv-list-count">${receivedEvents.length}</span>
        </div>
        <div class="rcv-list-scope">${role.label} · Scope: ${role.scope === 'all-sites' ? 'All sites, Denmark' : role.scope === 'cph-only' ? 'CPH Airport only' : role.scope === 'esbjerg-only' ? 'Esbjerg Harbour only' : role.scope}</div>
        ${advisoryStrip}
        <div class="rcv-list-body">${list}</div>
      </aside>
      ${selectedEv ? `<main class="rcv-detail">${detail}</main>` : ''}
      ${overlay}
    `;

    receiverView.style.display = 'flex';
    _bindReceiverActions();
  }

  // Shared click delegation. Runs after every render (inbox view OR
  // workspace view) so buttons in either surface are wired.
  function _bindReceiverActions() {
    receiverView.querySelectorAll('[data-rcv]').forEach(el => el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const action = el.dataset.rcv;
      const id = el.dataset.id;
      const escId = el.dataset.esc;
      if (action === 'pick') { _selectedReceiverEventId = id; _respondingEscId = null; renderReceiverView(); }
      else if (action === 'ack') { updateEscalationStatus(_selectedReceiverEventId, escId, 'acknowledged'); toast('Acknowledgment sent to operator', 'ok'); renderReceiverView(); }
      else if (action === 'advisory-view') { toast(`Advisory only: track ${id} is projecting toward your site. Full escalation not yet sent.`, 'info'); }
      else if (action === 'qra-dispatch') { triggerQraIntercept(id); renderReceiverView(); }
      else if (action === 'confirm-outcome') {
        // Step 4 handler: read outcome select + notes, save to
        // event.dispatchOutcomes[dispatchId], trigger re-render so
        // Step 5 (post-incident handoff) can appear.
        const dispatchId = el.dataset.dispatchId;
        const eventId = el.dataset.eventId;
        const ev = getEvent(eventId);
        if (!ev || !dispatchId) return;
        const selectEl = document.querySelector(`[data-outcome-select="${dispatchId}"]`);
        const notesEl = document.querySelector(`[data-outcome-notes="${dispatchId}"]`);
        const outcomeId = selectEl?.value;
        if (!outcomeId) { toast('Select an outcome before confirming', 'warn'); return; }
        const cd = (ev.counterDispatches || []).find(c => c.dispatchId === dispatchId);
        const outcomes = outcomesForKind(cd?.kind || '');
        const outcomeDef = outcomes.find(o => o.id === outcomeId);
        if (!ev.dispatchOutcomes) ev.dispatchOutcomes = {};
        ev.dispatchOutcomes[dispatchId] = {
          outcomeId,
          outcomeLabel: outcomeDef?.label || outcomeId,
          notes: notesEl?.value || '',
          confirmedAt: new Date().toISOString(),
          confirmedBy: getActiveRole()?.id || 'unknown',
        };
        toast(`Outcome confirmed: ${outcomeDef?.label || outcomeId}`, 'ok');
        _lastReceiverViewSig = null;   // force re-render so Step 5 unlocks
        renderReceiverView();
      }
      else if (action === 'counter-dispatch') {
        // Level 3 counter-response dispatch. Uses the current event's
        // subject-derived response bundle to find the asset by id, then
        // fires dispatchCounterResponse which handles state machine +
        // Cesium visuals + engagement resolution.
        const assetId = el.dataset.assetId;
        const ev = getEvent(id);
        if (!ev || !assetId) return;
        const threatLat = ev.lastPosition?.lat ?? ev.entry?.lat;
        const threatLon = ev.lastPosition?.lon ?? ev.entry?.lon;
        if (threatLat == null) { toast('No threat position available', 'err'); return; }
        const bundle = ev.subject
          ? responseBundleForSubject(ev.subject, threatLat, threatLon)
          : responseBundle(threatLat, threatLon);
        const asset = [...bundle.tactical, ...bundle.ground, ...bundle.consequence].find(a => a.id === assetId);
        if (!asset) { toast('Asset not found in response bundle', 'err'); return; }
        dispatchCounterResponse(id, asset);
      }
      else if (action === 'cascade-fe-pet') {
        // Receiver-initiated cascade to FE + PET tier-3 destinations.
        // Uses the same escalateEvent path the operator uses; dedupe in
        // events.js prevents adding records for destinations already
        // escalated. Provenance is stamped in `operator` field so the
        // operator's audit trail shows WHO initiated the cascade.
        const eventId = _selectedReceiverEventId || _workspaceEventId;
        const ev = getEvent(eventId);
        if (!ev) { toast('Event not found', 'err'); return; }
        const dests = destinationsForSite(ev.siteId);
        const targetIds = dests.filter(d => d.tier === 3 && (destinationParent(d) === 'FE' || destinationParent(d) === 'PET')).map(d => d.id);
        if (!targetIds.length) { toast('No FE/PET destinations configured for this site', 'err'); return; }
        const role = getActiveRole();
        const records = escalateEvent(eventId, {
          destinationIds: targetIds,
          payload: 'summary',
          message: `Strategic cascade requested from ${role.name || 'Receiver'} — event ${eventId}`,
          operator: `Receiver · ${role.name || role.org || role.person || 'Unknown'}`,
        });
        if (records.length === 0) toast('FE / PET already notified for this event', 'info');
        else toast(`Cascaded to ${records.length} strategic intel destination${records.length === 1 ? '' : 's'}`, 'ok');
        renderReceiverView();
      }
      else if (action === 'cascade-politi') {
        // Cascades to the LOCAL politikreds for this event's site.
        // Uses destinationParent === 'Politi' to find the tier-2 entry.
        const eventId = _selectedReceiverEventId || _workspaceEventId;
        const ev = getEvent(eventId);
        if (!ev) { toast('Event not found', 'err'); return; }
        const dests = destinationsForSite(ev.siteId);
        const politiIds = dests.filter(d => d.tier === 2 && destinationParent(d) === 'Politi').map(d => d.id);
        if (!politiIds.length) { toast('No local Politi destination configured', 'err'); return; }
        const role = getActiveRole();
        const records = escalateEvent(eventId, {
          destinationIds: politiIds,
          payload: 'summary',
          message: `Politi coordination requested from ${role.name || 'Receiver'} — event ${eventId}`,
          operator: `Receiver · ${role.name || role.org || role.person || 'Unknown'}`,
        });
        if (records.length === 0) toast('Local Politi already coordinated for this event', 'info');
        else toast(`Cascaded to local Politikreds (${dests.find(d => d.id === politiIds[0])?.name || 'Politi'})`, 'ok');
        renderReceiverView();
      }
      else if (action === 'dispatch-postinc') { dispatchPostIncident(id, el.dataset.dest); renderReceiverView(); }
      else if (action === 'close-event') { closePostIncidentEvent(id); renderReceiverView(); }
      else if (action === 'respond-open') { _respondingEscId = escId; renderReceiverView(); setTimeout(() => document.getElementById('rcv-response-text')?.focus(), 20); }
      else if (action === 'respond-cancel') { _respondingEscId = null; renderReceiverView(); }
      else if (action === 'respond-send') {
        const txt = document.getElementById('rcv-response-text').value;
        if (!txt.trim()) { toast('Response cannot be empty', 'err'); return; }
        respondToEscalation(_selectedReceiverEventId, escId, txt, `${getActiveRole().person} (${getActiveRole().org})`);
        _respondingEscId = null;
        toast('Response sent to operator', 'ok');
        renderReceiverView();
      }
      // ── Event Workspace routing ─────────────────────────────
      else if (action === 'open-report') { _workspaceEventId = id; _workspaceMode = 'report'; _exitMapMode(); renderReceiverView(); }
      else if (action === 'open-map')    {
        _workspaceEventId = id; _workspaceMode = 'map';
        const ev = _lookupWorkspaceEvent(id);
        if (ev) _enterMapMode(ev);
        renderReceiverView();
      }
      else if (action === 'workspace-back' || action === 'workspace-close') { _workspaceEventId = null; _mistralFiredForEvent = null; _exitMapMode(); renderReceiverView(); }
      else if (action === 'workspace-mode') {
        _workspaceMode = el.dataset.mode;
        const ev = _lookupWorkspaceEvent(_workspaceEventId);
        if (_workspaceMode === 'map' && ev) _enterMapMode(ev);
        else _exitMapMode();
        renderReceiverView();
      }
      else if (action === 'ai-refresh') {
        if (!isMistralConfigured()) { toast('Mistral API key not configured (set VITE_MISTRAL_API_TOKEN)', 'warn'); }
        else {
          const ev = EVENTS.find(e => e.id === _workspaceEventId);
          if (ev) { _fireMistralCaseFile(ev, { force: true }); toast('Regenerating synthesis via Mistral Large 2', 'info'); }
        }
      }
      else if (action === 'map-layer-locked') { toast('3D layer is disabled for this demo. See project map architecture for the sovereign rollout plan.', 'info'); }
      else if (action === 'map-layer') { /* 2D active — no-op */ }
    }));
  }

  tbOperator.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (roleMenu.style.display === 'block') { roleMenu.style.display = 'none'; return; }
    renderRoleMenu();
    roleMenu.style.display = 'block';
  });
  document.addEventListener('click', (ev) => {
    if (!roleMenu.contains(ev.target) && ev.target !== tbOperator) roleMenu.style.display = 'none';
  });
  onRoleChange(() => { updateOperatorChip(); _selectedReceiverEventId = null; _respondingEscId = null; _workspaceEventId = null; _workspaceMode = 'report'; });
  onSelectionChange(() => { if (getActiveRole().kind === 'receiver') renderReceiverView(); });
  updateOperatorChip();

  console.log('ISR C2 Platform initialized.');
}

main().catch((err) => console.error('Fatal error:', err));
