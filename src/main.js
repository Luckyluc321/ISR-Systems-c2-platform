import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

// Cesium Ion access token — set via env var VITE_CESIUM_ION_TOKEN
// Get a free token at https://ion.cesium.com/tokens
Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || '';

const viewer = new Cesium.Viewer('cesiumContainer', {
  // Strip out default Cesium UI — we build our own
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

// Hide the default Cesium credit
viewer.cesiumWidget.creditContainer.style.display = 'none';

// ── NASA Black Marble (VIIRS Night Lights) — free, no API key ──
const blackMarble = new Cesium.WebMapTileServiceImageryProvider({
  url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2016-01-01/500m/{TileMatrix}/{TileRow}/{TileCol}.jpeg',
  layer: 'VIIRS_Black_Marble',
  style: 'default',
  tileMatrixSetID: '500m',
  maximumLevel: 8,
  tilingScheme: new Cesium.GeographicTilingScheme(),
  format: 'image/jpeg',
});
viewer.imageryLayers.addImageryProvider(blackMarble);

// ── CartoDB Dark Matter — free, no API key. Fades in when zoomed in ──
const darkMatter = new Cesium.UrlTemplateImageryProvider({
  url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
  subdomains: ['a', 'b', 'c'],
  minimumLevel: 0,
  maximumLevel: 19,
});
const darkMatterLayer = viewer.imageryLayers.addImageryProvider(darkMatter);
darkMatterLayer.alpha = 0;

// ── Auto-switch between Black Marble and Dark Matter based on zoom ──
viewer.scene.postRender.addEventListener(() => {
  const height = viewer.camera.positionCartographic.height;
  if (height > 500_000) {
    darkMatterLayer.alpha = 0;
  } else if (height < 100_000) {
    darkMatterLayer.alpha = 1;
  } else {
    darkMatterLayer.alpha = 1 - (height - 100_000) / 400_000;
  }
});

// ── Atmosphere + lighting styling ──
viewer.scene.skyAtmosphere.hueShift = -0.05;
viewer.scene.skyAtmosphere.saturationShift = 0.1;
viewer.scene.globe.enableLighting = false;

// ── Initial camera position — Denmark, altitude ~3000km ──
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(11.0, 56.0, 3_000_000),
});

// ── Camera state persistence ──
const CAM_KEY = 'isr-c2-camera';
const savedCam = localStorage.getItem(CAM_KEY);
if (savedCam) {
  try {
    const c = JSON.parse(savedCam);
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, c.height),
      orientation: { heading: c.heading, pitch: c.pitch, roll: c.roll },
    });
  } catch (e) {
    console.warn('Could not restore camera state:', e);
  }
}
viewer.camera.moveEnd.addEventListener(() => {
  const carto = viewer.camera.positionCartographic;
  localStorage.setItem(
    CAM_KEY,
    JSON.stringify({
      lon: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height,
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll,
    }),
  );
});

console.log('ISR C2 Platform initialized. Cesium Ion token:', Cesium.Ion.defaultAccessToken ? 'configured' : 'MISSING — add VITE_CESIUM_ION_TOKEN');
