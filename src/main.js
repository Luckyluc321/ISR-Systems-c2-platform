import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

// Cesium Ion access token — set via env var VITE_CESIUM_ION_TOKEN
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

  // ── Bing Maps Aerial (asset 2) — daytime satellite base ──
  let bingLayer = null;
  try {
    const bing = await Cesium.IonImageryProvider.fromAssetId(2);
    bingLayer = viewer.imageryLayers.addImageryProvider(bing);
    console.log('✓ Bing Maps Aerial loaded (asset 2)');
  } catch (err) {
    console.error('Bing Maps Aerial failed:', err);
  }

  // ── Earth at Night (asset 3812) — city lights ──
  let earthAtNightLayer = null;
  try {
    const earthAtNight = await Cesium.IonImageryProvider.fromAssetId(3812);
    earthAtNightLayer = viewer.imageryLayers.addImageryProvider(earthAtNight);
    earthAtNightLayer.alpha = 1;
    console.log('✓ Earth at Night loaded (asset 3812)');
  } catch (err) {
    console.error('Earth at Night failed:', err);
  }

  // ── Cesium World Terrain (asset 1) — real 3D mountains ──
  try {
    viewer.terrainProvider = await Cesium.createWorldTerrainAsync({
      requestVertexNormals: true,
      requestWaterMask: true,
    });
    console.log('✓ Cesium World Terrain loaded');
  } catch (err) {
    console.warn('Terrain failed to load:', err);
  }

  // ── Google Photorealistic 3D Tiles (asset 2275207) — real 3D globe ──
  let googlePhotoreal = null;
  try {
    googlePhotoreal = await Cesium.Cesium3DTileset.fromIonAssetId(2275207);
    viewer.scene.primitives.add(googlePhotoreal);
    console.log('✓ Google Photorealistic 3D Tiles loaded');
  } catch (err) {
    console.warn('Google Photorealistic 3D Tiles failed:', err);
  }

  // ── Imagery mode: night, day, or auto ──
  let imageryMode = 'auto';

  function applyImageryMode() {
    console.log(`Imagery mode → ${imageryMode}`);

    if (imageryMode === 'night') {
      // Force night everywhere. Hide Bing + Google Photorealistic
      // (they're photo-textured day imagery)
      if (earthAtNightLayer) earthAtNightLayer.alpha = 1;
      if (bingLayer) bingLayer.alpha = 0;
      if (googlePhotoreal) googlePhotoreal.show = false;
    } else if (imageryMode === 'day') {
      // Force day. Hide Earth at Night. Show Bing + Google 3D
      if (earthAtNightLayer) earthAtNightLayer.alpha = 0;
      if (bingLayer) bingLayer.alpha = 1;
      if (googlePhotoreal) googlePhotoreal.show = true;
    } else {
      // Auto — Bing + Google 3D always on, Earth at Night fades based on altitude
      if (bingLayer) bingLayer.alpha = 1;
      if (googlePhotoreal) googlePhotoreal.show = true;
    }
  }

  viewer.scene.postRender.addEventListener(() => {
    if (!earthAtNightLayer || imageryMode !== 'auto') return;
    const height = viewer.camera.positionCartographic.height;
    if (height > 3_000_000) {
      earthAtNightLayer.alpha = 1;
    } else if (height < 500_000) {
      earthAtNightLayer.alpha = 0;
    } else {
      earthAtNightLayer.alpha = (height - 500_000) / 2_500_000;
    }
  });

  // ── Camera behavior ──
  const controller = viewer.scene.screenSpaceCameraController;
  controller.minimumZoomDistance = 50;
  controller.maximumZoomDistance = 20_000_000;
  controller.inertiaSpin = 0.7;
  controller.inertiaTranslate = 0.7;
  controller.inertiaZoom = 0.5;

  // ── Atmosphere + globe styling ──
  viewer.scene.skyAtmosphere.hueShift = -0.06;
  viewer.scene.skyAtmosphere.saturationShift = -0.1;
  viewer.scene.skyAtmosphere.brightnessShift = -0.15;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#06080b');
  viewer.scene.globe.enableLighting = false;
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.0001;

  localStorage.removeItem('isr-c2-camera');

  // ── Fly-to presets ──
  const FLY_TARGETS = {
    globe: {
      destination: Cesium.Cartesian3.fromDegrees(11.0, 40.0, 12_000_000),
      orientation: { heading: 0.0, pitch: Cesium.Math.toRadians(-90), roll: 0.0 },
      duration: 2.0,
    },
    denmark: {
      destination: Cesium.Cartesian3.fromDegrees(11.0, 55.0, 900_000),
      orientation: { heading: 0.0, pitch: Cesium.Math.toRadians(-55), roll: 0.0 },
      duration: 2.5,
    },
    cph: {
      destination: Cesium.Cartesian3.fromDegrees(12.647, 55.615, 2_500),
      orientation: { heading: Cesium.Math.toRadians(20), pitch: Cesium.Math.toRadians(-35), roll: 0.0 },
      duration: 3.0,
    },
    alps: {
      destination: Cesium.Cartesian3.fromDegrees(7.7, 45.95, 12_000),
      orientation: { heading: Cesium.Math.toRadians(30), pitch: Cesium.Math.toRadians(-25), roll: 0.0 },
      duration: 3.0,
    },
  };

  function flyTo(key) {
    const t = FLY_TARGETS[key];
    if (!t) return;
    console.log(`Flying to: ${key}`);
    viewer.camera.flyTo(t);
  }

  // ── Initial view — Denmark, tilted ──
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(11.0, 52.0, 5_000_000),
    orientation: {
      heading: 0.0,
      pitch: Cesium.Math.toRadians(-55),
      roll: 0.0,
    },
  });

  // Apply initial imagery mode after layers loaded
  applyImageryMode();

  // ── Wire up control panel ──
  document.querySelectorAll('#control-panel .cp-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#control-panel .cp-btn[data-mode]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      imageryMode = btn.dataset.mode;
      applyImageryMode();
    });
  });

  document.querySelectorAll('#control-panel .cp-btn[data-fly]').forEach((btn) => {
    btn.addEventListener('click', () => {
      flyTo(btn.dataset.fly);
    });
  });

  console.log('ISR C2 Platform initialized.');
}

main().catch((err) => {
  console.error('Fatal error initializing C2 platform:', err);
});
