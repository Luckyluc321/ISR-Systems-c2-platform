// Standalone CPH boundary preview.
//
// A page that draws nothing but the coordinates. No sensors, no
// scenarios, no site logic, no platform. It exists so an outline can be
// judged on its own before anything is written to sites/cph.yaml.
//
//   npm run dev   then open  /boundary.html
//
// Serving it on another port would not have isolated an edit to the site
// file, because every instance reads the same one. A separate PAGE does.
import * as Cesium from 'cesium';
import { TRACED_RAW, TRACED_CLEAN, PLATFORM_CURRENT } from './boundary_sets.js';

Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || '';

const viewer = new Cesium.Viewer('c', {
  animation: false, timeline: false, baseLayerPicker: false,
  geocoder: false, homeButton: false, sceneModePicker: false,
  navigationHelpButton: false, fullscreenButton: false, infoBox: false,
  selectionIndicator: false,
});
viewer.scene.globe.enableLighting = false;

const draw = (pts, css, width) => {
  const flat = [];
  for (const [lon, lat] of pts) flat.push(lon, lat);
  flat.push(pts[0][0], pts[0][1]);          // close it
  return viewer.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(flat),
      width, clampToGround: true,
      material: Cesium.Color.fromCssColorString(css),
    },
  });
};

const layers = {
  1: { e: draw(TRACED_CLEAN, '#4ade80', 5), name: 'traced, cleaned' },
  2: { e: draw(TRACED_RAW, '#fbbf24', 3), name: 'traced, raw' },
  3: { e: draw(PLATFORM_CURRENT, '#ef4444', 3), name: 'platform today' },
};
layers[2].e.show = false;                    // raw off by default

// Mark every point of the cleaned outline, so sparse stretches and
// doubled-back stretches are both obvious.
for (const [lon, lat] of TRACED_CLEAN) {
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    point: { pixelSize: 5, color: Cesium.Color.fromCssColorString('#4ade80'),
             heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
             disableDepthTestDistance: Number.POSITIVE_INFINITY },
  });
}

const home = () => viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(12.6405, 55.6, 11000),
  orientation: { heading: 0, pitch: Cesium.Math.toRadians(-70), roll: 0 },
  duration: 0,
});
home();

window.addEventListener('keydown', (ev) => {
  if (ev.key === '0') return home();
  const l = layers[ev.key];
  if (!l) return;
  l.e.show = !l.e.show;
  console.log(`[boundary] ${l.name}: ${l.e.show ? 'shown' : 'hidden'}`);
});

console.log(`[boundary] raw ${TRACED_RAW.length}, cleaned ${TRACED_CLEAN.length},`
  + ` platform ${PLATFORM_CURRENT.length} vertices. This page writes nothing.`);
