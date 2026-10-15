// WITHOUT ISR — the whole scenario, in one deletable file.
//
// Delete this file and the line that loads it from index.html, and the
// platform is exactly as it was. Nothing here is referenced by main.js.
//
// WHY IT LIVES OUTSIDE main.js
// ----------------------------
// The first version of this put six guarded conditions into the tick: a
// flag on the event, an extra argument on _shouldAutoDetect, overrides
// on visibility and markers. Every one was inert without the flag and I
// verified that, but it still meant six places in shared code that a
// future change could collide with, for the sake of one demo clip.
//
// Lucas's call was to build it outside instead, and he was right. The
// trick that makes it possible is that the system ALREADY models a site
// with no detection: a sensor whose status is 'offline'. _sensorSeesPoint
// returns false for it, so _anySensorSeesPoint returns false, so
// _shouldAutoDetect returns false, and the entire chain follows on its
// own:
//
//   - `detected` never flips to true
//   - filteredEvents() therefore keeps the event out of the alert strip
//     and out of every receiver inbox
//   - no sensor is ever credited as contributing
//   - the DETECTED toast never fires
//   - no coverage markers, because nothing enters coverage
//
// None of that is faked. The site genuinely has no working sensors for
// the duration, which is precisely what the clip is about, so the data
// and the picture agree rather than one pretending for the other.
//
// WHAT IT COSTS OUTSIDE THIS FILE
// -------------------------------
// Two lines, both additive, neither changing behaviour:
//   index.html   loads this module
//   main.js      exposes the Cesium viewer read-only as window.__isr_viewer
//
// WHAT IT CANNOT DO FROM OUT HERE
// -------------------------------
// With no sensor seeing them, the sensors-observe-only rule hides the
// drones, and the clip needs them on screen. That cannot be configured
// from outside, only corrected after the fact, so this subscribes to the
// drone tick and re-shows them on the same update. Listeners run in
// registration order and main's is registered at boot, so ours runs
// after and the override lands before the frame is drawn.
//
// That is the one place this file reacts to main rather than configuring
// it, and it is the honest cost of not touching the tick.

import { SITES } from './sites_registry.js';
import { onDroneUpdate } from './drones.js';
import { EVENTS } from './events.js';
import { getActiveRole } from './roles.js';

const SITE_ID = 'cph';
const SWARM_KEY = 'cph_swarm_runway_incursion';
const JET_KEY = 'cph_jet_goaround_early';

// The aircraft spawns when the swarm's OWN clock reads this. Derived, not
// taste: the swarm is over the 04R threshold at its t = 409.9, the
// aircraft needs 371 s to reach its decision point, and the crew should
// commit about 8 s before the formation arrives so the break-off lands at
// 480 m of separation. 409.9 + 8 - 371 = 38, give or take the rounding.
const JET_AT_SWARM_TSEC = 38;

// From the cockpit the drones must read as objects, not map symbols. The
// models normally only draw within 250 m, and at break-off the formation
// is 480 m ahead, so without this they would be invisible at the moment
// that matters. Scoped to this scenario's own entities.
const MODEL_ALWAYS_M = 20000;

let _active = false;
let _sensorSnapshot = null;   // [{ sensor, status }]
let _entitySnapshot = [];     // [{ entity, show, billboardDdc, modelDdc }]
let _unsub = null;
let _leadEventId = null;
let _jetSpawned = false;
let _roleAtStart = null;

function _viewer() {
  return (typeof window !== 'undefined' && window.__isr_viewer) || null;
}

// ── sensors off ─────────────────────────────────────────────────────
// The entire detection suppression, in six lines. Everything downstream
// already knows what an offline sensor means.
function _sensorsOff() {
  const site = SITES[SITE_ID];
  if (!site?.sensors) return;
  _sensorSnapshot = site.sensors.map(s => ({ sensor: s, status: s.status }));
  for (const s of site.sensors) s.status = 'offline';
}

function _sensorsRestore() {
  if (!_sensorSnapshot) return;
  for (const { sensor, status } of _sensorSnapshot) sensor.status = status;
  _sensorSnapshot = null;
}

// ── the sensor layer, hidden ────────────────────────────────────────
// Dots and coverage rings only. The perimeter is deliberately left alone
// so the viewer still knows which site they are looking at. Matching on
// "sensor-" covers both, verified against the only two places in main.js
// that mint those ids.
// SCOPED TO CPH. The ids embed the site, `sensor-<siteId>-<id>` and
// `sensor-cov-<siteId>-<id>`, and every site is drawn regardless of who
// is signed in. A bare /^sensor-/ hid 130 sensors across ten sites
// instead of this site's 35, which is the one thing this scenario must
// never do.
const _SENSOR_RE = new RegExp(`^sensor-(cov-)?${SITE_ID}-`);

function _hideSensorEntities() {
  const v = _viewer();
  if (!v) return 0;
  let n = 0;
  for (const e of v.entities.values) {
    if (!_SENSOR_RE.test(String(e.id || ''))) continue;
    _entitySnapshot.push({ entity: e, show: e.show });
    e.show = false;
    n++;
  }
  return n;
}

// ── the swarm's own entities ────────────────────────────────────────
function _isSwarmEntity(id, eventId) {
  if (!eventId) return false;
  const s = String(id || '');
  return s === `drone-${eventId}`
      || s.startsWith(`drone-${eventId}-swarm-`)
      || s === `drone-trail-${eventId}`
      || s === `drone-shadow-${eventId}`;
}

// Symbols off, models on. Done once when the entities first appear
// rather than every frame, because a DistanceDisplayCondition is a
// property and not a per-tick decision.
function _suppressSymbols(eventId) {
  const v = _viewer();
  if (!v || !window.Cesium) return;
  const C = window.Cesium;
  for (const e of v.entities.values) {
    if (!_isSwarmEntity(e.id, eventId)) continue;
    if (e._wiOverridden) continue;
    e._wiOverridden = true;
    _entitySnapshot.push({
      entity: e,
      show: e.show,
      billboardDdc: e.billboard ? e.billboard.distanceDisplayCondition : undefined,
      modelDdc: e.model ? e.model.distanceDisplayCondition : undefined,
      hadOverride: true,
    });
    // Push the billboard's visible band past any camera distance, which
    // removes the map symbol without removing the entity.
    if (e.billboard) {
      e.billboard.distanceDisplayCondition =
        new C.DistanceDisplayCondition(1e9, 1e9 + 1);
    }
    // And let the model draw at any range the camera actually uses.
    if (e.model) {
      e.model.distanceDisplayCondition =
        new C.DistanceDisplayCondition(0, MODEL_ALWAYS_M);
    }
  }
}

// ── keeping them on screen ──────────────────────────────────────────
// The one thing that has to happen every tick. Nothing detects them, so
// the coverage rule hides them, so we show them again.
function _forceVisible(eventId) {
  const v = _viewer();
  if (!v) return;
  for (const e of v.entities.values) {
    if (!_isSwarmEntity(e.id, eventId)) continue;
    // Trails are a CONFIRMED-path artefact. An undetected track has no
    // confirmed path, so they stay hidden on purpose.
    // Trails and forward projections are both path artefacts. A trail
    // asserts a CONFIRMED path and the red dashed line asserts intent,
    // and an undetected track has produced neither. Main would draw the
    // projection anyway when out of coverage, so hiding it here is not a
    // regression, it is the same rule applied consistently.
    const _id = String(e.id);
    if (_id.endsWith('-trail') || _id.endsWith('-proj') || _id.startsWith('drone-trail-')) {
      e.show = false;
      continue;
    }
    if (e.show !== true) e.show = true;
  }
}


// ── run ─────────────────────────────────────────────────────────────
export function startWithoutIsr() {
  if (_active) { console.warn('[without-isr] already running'); return; }
  if (!_viewer()) {
    console.error('[without-isr] window.__isr_viewer is not available, cannot run');
    return;
  }
  if (typeof window.__spawnDrone !== 'function') {
    console.error('[without-isr] window.__spawnDrone is not available, cannot run');
    return;
  }
  _active = true;
  _entitySnapshot = [];
  _jetSpawned = false;
  _leadEventId = null;

  _roleAtStart = (() => { try { return getActiveRole()?.id || null; } catch (_) { return null; } })();

  try {
    _sensorsOff();
    const hidden = _hideSensorEntities();
    console.log(`[without-isr] ${SITES[SITE_ID].sensors.length} sensors offline, ${hidden} entities hidden`);

    // A NEW event, not merely the newest one. spawnFromTemplate returns
    // silently when a track is already live, and _newestEventFor would
    // then hand back a STALE event from a previous run: the abort below
    // would not fire, the aircraft would never spawn, and the sensors
    // would stay off. Diffing ids is the only way to know a spawn
    // actually happened.
    const before = new Set(EVENTS.map(e => e.id));
    window.__spawnDrone(SWARM_KEY);
    const ev = EVENTS.find(e => e.templateKey === SWARM_KEY && !before.has(e.id));
    if (!ev) {
      console.error('[without-isr] swarm did not spawn. Cancel any running scenario first.');
      stopWithoutIsr();
      return;
    }
      console.log(`[without-isr] swarm ${_leadEventId} running, aircraft at swarm t=${JET_AT_SWARM_TSEC}s`);

    _unsub = onDroneUpdate((ups) => {
      if (!_active) return;
      _suppressSymbols(_leadEventId);
      _forceVisible(_leadEventId);
      if (_jetSpawned) return;
      const lead = ups.find(u => u.eventId === _leadEventId);
      if (!lead || lead.tSec < JET_AT_SWARM_TSEC) return;
      _jetSpawned = true;
      // allowConcurrent, because the swarm is still live and
      // spawnFromTemplate refuses a second track without it.
      window.__spawnDrone(JET_KEY, { allowConcurrent: true });
      console.log(`[without-isr] aircraft spawned at swarm t=${Math.round(lead.tSec)}s`);
    });
  } catch (err) {
    // Sensors must never be left offline because something threw on the
    // way up. Nothing persists SITES, so the blast radius is one page,
    // but one page is still the demo.
    console.error('[without-isr] start failed, rolling back:', err);
    stopWithoutIsr();
  }
}

export function stopWithoutIsr() {
  if (!_active) return;
  _active = false;
  if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
  // IF THE ACCOUNT CHANGED, DO NOT RESTORE VISIBILITY.
  //
  // The snapshot was taken under the role that started the run.
  // applySiteScopeVisibility sets show from _roleCanSeeSite on every
  // account switch, so writing a stale `true` back would put this site's
  // sensors on screen for an operator who is not allowed to see them.
  // Leaving them hidden is the safe failure: the next account switch
  // re-derives it correctly.
  const _roleNow = (() => { try { return getActiveRole()?.id || null; } catch (_) { return null; } })();
  const _roleSame = _roleNow === _roleAtStart;
  if (!_roleSame) {
    console.warn('[without-isr] account changed during the run, leaving sensor visibility to the role scope rather than restoring a stale value');
  }
  for (const snap of _entitySnapshot) {
    const e = snap.entity;
    try {
      if (_roleSame) e.show = snap.show;
      if (snap.hadOverride) {
        if (e.billboard) e.billboard.distanceDisplayCondition = snap.billboardDdc;
        if (e.model) e.model.distanceDisplayCondition = snap.modelDdc;
        delete e._wiOverridden;
      }
    } catch (_) { /* entity already removed, nothing to restore */ }
  }
  _entitySnapshot = [];
  _sensorsRestore();
  _leadEventId = null;
  _jetSpawned = false;
  console.log('[without-isr] stopped, sensors and entities restored');
}

if (typeof window !== 'undefined') {
  window.__isr_withoutIsr = { start: startWithoutIsr, stop: stopWithoutIsr };

  // NO BUTTON. It was floating over the status bar in the normal UI and
  // had no business being on screen during ordinary work. Console only:
  //
  //   __isr_withoutIsr.start()
  //   __isr_withoutIsr.stop()
}
