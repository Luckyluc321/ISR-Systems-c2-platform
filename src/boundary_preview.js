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
  1: { e: draw(TRACED_CLEAN, '#4ade80', 5), name: 'live in the platform' },
  2: { e: draw(TRACED_RAW, '#fbbf24', 3), name: 'previous working version' },
  3: { e: draw(PLATFORM_CURRENT, '#ef4444', 3), name: 'old OSM outline' },
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

// ── CLICK TO TRACE ──────────────────────────────────────────────────
//
// Some edges are not in any dataset: a moat, a ditch, a field boundary
// you can see in the imagery and nothing else knows about. Rather than
// guess at coordinates for a line nobody can query, click along it.
//
//   left click   drop a point
//   z            undo the last one
//   x            clear them all
//   c            print the run, ready to paste back
//
// Points are drawn as they go, joined by a cyan line, so the shape being
// traced is visible while it is being traced.
const capture = [];
const capEntities = [];
let capLine = null;

function redrawCapture() {
  if (capLine) { viewer.entities.remove(capLine); capLine = null; }
  if (capture.length < 2) return;
  const flat = [];
  for (const p of capture) flat.push(p.lon, p.lat);
  capLine = viewer.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(flat),
      width: 4, clampToGround: true,
      material: Cesium.Color.fromCssColorString('#22d3ee'),
    },
  });
}

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((click) => {
  const ray = viewer.camera.getPickRay(click.position);
  const cart = ray && viewer.scene.globe.pick(ray, viewer.scene);
  if (!cart) return;
  const c = Cesium.Cartographic.fromCartesian(cart);
  const lat = +Cesium.Math.toDegrees(c.latitude).toFixed(6);
  const lon = +Cesium.Math.toDegrees(c.longitude).toFixed(6);
  capture.push({ lat, lon });
  capEntities.push(viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    point: { pixelSize: 9, color: Cesium.Color.fromCssColorString('#22d3ee'),
             outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
             heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
             disableDepthTestDistance: Number.POSITIVE_INFINITY },
  }));
  redrawCapture();
  console.log(`[trace] ${capture.length}: ${lat}, ${lon}`);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'z' && capture.length) {
    capture.pop();
    viewer.entities.remove(capEntities.pop());
    redrawCapture();
    console.log(`[trace] undo, ${capture.length} left`);
  }
  if (ev.key === 'x') {
    capture.length = 0;
    capEntities.forEach(e => viewer.entities.remove(e));
    capEntities.length = 0;
    redrawCapture();
    console.log('[trace] cleared');
  }
  if (ev.key === 'c') {
    const out = capture.map(p => `  [${p.lon.toFixed(6)}, ${p.lat.toFixed(6)}],`).join('\n');
    console.log(`[trace] ${capture.length} points, lon/lat, paste this back:\n[\n${out}\n]`);
    try { navigator.clipboard.writeText(`[\n${out}\n]`); console.log('[trace] copied to clipboard'); }
    catch (_) { console.log('[trace] clipboard blocked, copy from above'); }
  }
});

console.log(`[boundary] raw ${TRACED_RAW.length}, cleaned ${TRACED_CLEAN.length},`
  + ` platform ${PLATFORM_CURRENT.length} vertices. This page writes nothing.`);
console.log('[trace] click to drop points, z undo, x clear, c copy the run.');
