// ═══════════════════════════════════════════════════════════════════
// Manhattan Skyscraper Demo — pure visual, throwaway
// ───────────────────────────────────────────────────────────────────
// Flies the camera to Midtown Manhattan, ensures Google Photoreal 3D
// Tiles are loaded (so skyscrapers actually render), and spawns a
// single quadcopter that flies a slow orbit around the Empire State
// Building at rooftop altitude. Camera chase-tracks the drone so you
// see the geometry sweep past.
//
// Not integrated with any platform state (no event, no sensor, no
// dispatch). Cleanup helper restores everything on exit.
//
// Console usage:
//   window.__isr_manhattan()      // start demo
//   window.__isr_manhattanExit()  // stop, remove drone, keep camera
// ═══════════════════════════════════════════════════════════════════

import * as Cesium from 'cesium';

// ── Constants ────────────────────────────────────────────────────
// Empire State Building rooftop is ~381m. Fly at 220m so the drone
// weaves BETWEEN neighbouring towers rather than orbiting above them.
const CENTER = { lat: 40.7484, lon: -73.9857 };   // Empire State Building
const ORBIT_RADIUS_M = 500;
const ORBIT_ALT_M = 220;
const ORBIT_PERIOD_MS = 45_000;   // one full lap every 45s

// ── State ────────────────────────────────────────────────────────
let _active = false;
let _droneEntity = null;
let _photorealTileset = null;   // only if WE loaded it (don't unload someone else's)
let _weLoadedPhotoreal = false;
let _cameraFollower = null;     // postRender remover
let _startTs = null;

// ── Simple quadcopter icon (32x32 canvas) ────────────────────────
function _droneIcon() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  // body
  ctx.fillStyle = '#4dd2ff';
  ctx.fillRect(14, 14, 4, 4);
  // arms
  ctx.strokeStyle = '#4dd2ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(6, 6); ctx.lineTo(26, 26);
  ctx.moveTo(26, 6); ctx.lineTo(6, 26);
  ctx.stroke();
  // rotors
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  [[6,6],[26,6],[6,26],[26,26]].forEach(([x,y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  return c.toDataURL();
}

// ── Position callback: circular orbit at CENTER, radius ORBIT_RADIUS_M ──
function _dronePosition() {
  const t = ((Date.now() - _startTs) % ORBIT_PERIOD_MS) / ORBIT_PERIOD_MS;
  const theta = t * Math.PI * 2;
  // meters-per-degree conversions at Manhattan latitude
  const M_PER_DEG_LAT = 111320;
  const M_PER_DEG_LON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);
  const dLat = (ORBIT_RADIUS_M * Math.sin(theta)) / M_PER_DEG_LAT;
  const dLon = (ORBIT_RADIUS_M * Math.cos(theta)) / M_PER_DEG_LON;
  return Cesium.Cartesian3.fromDegrees(
    CENTER.lon + dLon,
    CENTER.lat + dLat,
    ORBIT_ALT_M,
  );
}

// ── Ensure Google Photoreal 3D Tiles are loaded ──────────────────
// If main.js already loaded Photoreal (typical: photoreal profile or
// sovereign-without-city-tiles), we skip. Otherwise we load a private
// tileset just for the demo and unload it on exit.
async function _ensurePhotoreal(viewer) {
  // Detect existing Photoreal by scanning primitives for a 3DTileset
  // with Google's asset id in its resource URL.
  const primitives = viewer.scene.primitives;
  for (let i = 0; i < primitives.length; i++) {
    const p = primitives.get(i);
    if (p instanceof Cesium.Cesium3DTileset) {
      const url = p.resource?.url || '';
      if (url.includes('2275207') || url.includes('tile.googleapis.com')) {
        return null;   // already loaded, not ours to manage
      }
    }
  }
  // Load it ourselves
  try {
    const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(2275207);
    viewer.scene.primitives.add(tileset);
    _photorealTileset = tileset;
    _weLoadedPhotoreal = true;
    console.log('[manhattan_demo] loaded Google Photoreal 3D Tiles for the demo');
    return tileset;
  } catch (err) {
    console.warn('[manhattan_demo] Photoreal failed to load — skyscrapers will not render:', err);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────
export async function activateManhattanDemo(viewer) {
  if (_active) {
    console.log('[manhattan_demo] already active. Call __isr_manhattanExit() first.');
    return;
  }
  _active = true;
  _startTs = Date.now();

  await _ensurePhotoreal(viewer);

  // Spawn the drone
  _droneEntity = viewer.entities.add({
    id: '__manhattan_demo_drone',
    position: new Cesium.CallbackProperty(_dronePosition, false),
    billboard: {
      image: _droneIcon(),
      scale: 1.0,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.NONE,
    },
    label: {
      text: 'DEMO · Manhattan orbit',
      font: '10px system-ui',
      fillColor: Cesium.Color.fromCssColorString('#4dd2ff'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  // Fly to Manhattan from wherever the camera currently is.
  // Destination: south of the orbit centre, looking north-ish so the
  // Empire State Building silhouette sits mid-frame and the drone
  // sweeps across it.
  const heading = Cesium.Math.toRadians(15);   // just off due north
  const pitch = Cesium.Math.toRadians(-8);
  const range = 900;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      CENTER.lon - 0.005,
      CENTER.lat - 0.008,
      ORBIT_ALT_M + 40,
    ),
    orientation: { heading, pitch, roll: 0 },
    duration: 3.0,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });

  // Optional chase cam — pan camera slowly to keep the drone in
  // frame. Disabled by default so the operator can just watch. Enable
  // via __isr_manhattanChase(true).
  console.log('[manhattan_demo] active. Drone orbiting Empire State Building.');
  console.log('[manhattan_demo] enable chase-cam with __isr_manhattanChase(true).');
  console.log('[manhattan_demo] stop with __isr_manhattanExit().');
}

export function deactivateManhattanDemo(viewer) {
  if (!_active) return;
  _active = false;

  if (_cameraFollower) {
    _cameraFollower();
    _cameraFollower = null;
  }
  if (_droneEntity) {
    viewer.entities.remove(_droneEntity);
    _droneEntity = null;
  }
  if (_weLoadedPhotoreal && _photorealTileset) {
    try {
      viewer.scene.primitives.remove(_photorealTileset);
    } catch (_) { /* fine */ }
    _photorealTileset = null;
    _weLoadedPhotoreal = false;
  }
  _startTs = null;
  console.log('[manhattan_demo] stopped. Camera stays where you left it.');
}

export function setManhattanChase(viewer, enabled) {
  if (!_active) {
    console.log('[manhattan_demo] activate first via __isr_manhattan()');
    return;
  }
  if (enabled && !_cameraFollower) {
    _cameraFollower = viewer.scene.postRender.addEventListener(() => {
      if (!_active || !_droneEntity) return;
      const pos = _droneEntity.position?.getValue?.(Cesium.JulianDate.now());
      if (!pos) return;
      // Position camera 300m behind the drone (opposite the current
      // theta) and 60m above. Look at the drone.
      const t = ((Date.now() - _startTs) % ORBIT_PERIOD_MS) / ORBIT_PERIOD_MS;
      const theta = t * Math.PI * 2;
      const M_PER_DEG_LAT = 111320;
      const M_PER_DEG_LON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);
      const chaseR = ORBIT_RADIUS_M + 200;
      const dLat = (chaseR * Math.sin(theta - 0.6)) / M_PER_DEG_LAT;
      const dLon = (chaseR * Math.cos(theta - 0.6)) / M_PER_DEG_LON;
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          CENTER.lon + dLon,
          CENTER.lat + dLat,
          ORBIT_ALT_M + 60,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(((-theta * 180 / Math.PI) + 90 + 360) % 360),
          pitch: Cesium.Math.toRadians(-15),
          roll: 0,
        },
      });
    });
    console.log('[manhattan_demo] chase-cam ON');
  } else if (!enabled && _cameraFollower) {
    _cameraFollower();
    _cameraFollower = null;
    console.log('[manhattan_demo] chase-cam OFF');
  }
}
