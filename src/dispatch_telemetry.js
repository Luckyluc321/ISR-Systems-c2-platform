// ═══════════════════════════════════════════════════════════════════
// Dispatch telemetry — where a responding unit's POSITION comes from
// ───────────────────────────────────────────────────────────────────
// The inbound counterpart to dispatch_source.js. That module carries an
// operator's decision OUT to an agency; this one carries an agency's
// vehicle position back IN.
//
// In the simulation environment a police car moves because the tick
// loop integrates physics for it. In a real deployment it moves because
// a real officer drove it, and its position arrives from the agency's
// own tracker. The platform does not model the vehicle; it tracks it.
//
// WHAT A FIX MAY SET, and what it may not:
//
//   May:  lat, lon, alt, heading. Where the unit physically is.
//   Not:  state. Whether a unit has arrived, is engaging or is heading
//         home stays derived from geometry against its assigned target,
//         so one state machine serves both environments. A live feed
//         that also dictated state would fork the lifecycle in two and
//         every downstream consumer would have to know which it was
//         looking at.
//
// SELF-CONFIGURING. There is no per-site switch to forget. A dispatch
// is simulated until a real fix arrives for it, and the first fix flips
// it. No feed means nothing changes, which is why wiring this cannot
// disturb the simulation environment.
//
// POSITION AUTHORITY IS LEVEL-TRIGGERED, not a set of guards.
// Gating each place that writes a position was the first attempt and it
// was wrong: the tick loop writes position from four states, a fifth
// block interpolates altitude ahead of all of them, and any physics
// added later would have had to remember to opt out. Instead the last
// accepted fix is re-asserted after the whole tick. Whatever the
// simulation computed for a live unit is simply overwritten, including
// physics nobody has written yet.
//
// Pure and dependency-free so it loads under plain Node and can be
// tested without a browser. The subscriber that mutates live dispatch
// state lives in main.js, at the seam, like every other adapter here.
// ═══════════════════════════════════════════════════════════════════

const _listeners = new Set();

// Register interest in position fixes. Returns an unsubscribe function.
// main.js is the only expected subscriber; adapters publish, they do
// not subscribe.
export function onDispatchFix(cb) {
  if (typeof cb === 'function') _listeners.add(cb);
  return () => _listeners.delete(cb);
}

// Is this a usable position?
//
// Rejected rather than clamped. A tracker reporting a malformed or
// out-of-range coordinate is reporting that something is wrong with it,
// and silently coercing that into a plausible position would put a
// vehicle somewhere it is not, on an operator's map, during an
// incident. Null Island is the classic version of this failure.
export function isValidFix(fix) {
  if (!fix || typeof fix !== 'object') return false;
  if (typeof fix.dispatchId !== 'string' || !fix.dispatchId) return false;
  const { lat, lon } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  // Exactly 0,0 is overwhelmingly a missing-data sentinel rather than a
  // vehicle in the Gulf of Guinea.
  if (lat === 0 && lon === 0) return false;
  if (fix.alt != null && !Number.isFinite(fix.alt)) return false;
  if (fix.alt != null && (fix.alt < -500 || fix.alt > 30000)) return false;
  if (fix.heading != null && !Number.isFinite(fix.heading)) return false;
  // Same doctrine as the coordinate range check. A tracker reporting a
  // heading of 720 is telling you something is wrong with it.
  if (fix.heading != null && (fix.heading < 0 || fix.heading > 360)) return false;
  return true;
}

// Bearing from one point to the next, in radians, matching the
// convention the renderer already uses for a unit's heading.
function bearingRad(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad)
    - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return Math.atan2(y, x);
}

// How long a unit may go without a fix before it is treated as stale.
//
// A live unit that stops reporting keeps its last known position and
// stops moving, which is the truth. But "stopped moving" must not read
// as "still driving toward the scene", or an event can never close and
// the record can end up claiming the unit lost its target.
export const TELEMETRY_STALE_SEC = 90;

export function isTelemetryStale(unit, now) {
  if (!unit || unit.telemetrySource !== 'live') return false;
  const at = unit._liveFix?.at;
  if (!at) return false;
  return (now - at) / 1000 > TELEMETRY_STALE_SEC;
}

// Record a fix against a dispatch unit and flip it to live.
//
// Heading is derived from the bearing between consecutive fixes when
// the feed omits it. A tracker that reports position but not heading is
// common, and without this the airframe would point at the bearing it
// was given on dispatch for the rest of the incident.
export function applyFixToUnit(unit, fix) {
  if (!unit || !fix) return false;
  const prev = unit._liveFix;
  let heading = fix.heading != null ? fix.heading * Math.PI / 180 : null;
  if (heading == null && prev && (prev.lat !== fix.lat || prev.lon !== fix.lon)) {
    heading = bearingRad(prev.lat, prev.lon, fix.lat, fix.lon);
  }
  unit._liveFix = {
    lat: fix.lat,
    lon: fix.lon,
    alt: fix.alt ?? prev?.alt ?? null,
    heading: heading ?? prev?.heading ?? null,
    at: Date.parse(fix.receivedAt) || 0,
  };
  const wasLive = unit.telemetrySource === 'live';
  unit.telemetrySource = 'live';
  reassertLivePosition(unit);
  return !wasLive;   // true only on the transition, for logging
}

// Re-assert the last accepted fix. Called after the tick has run, so
// this is what makes the real position win over anything the
// simulation computed for this unit.
//
// Returns true if it wrote, which the caller uses to decide whether to
// extend the unit's trail.
export function reassertLivePosition(unit) {
  if (!unit || unit.telemetrySource !== 'live') return false;
  const f = unit._liveFix;
  if (!f) return false;
  unit.curLat = f.lat;
  unit.curLon = f.lon;
  if (f.alt != null) unit.curAlt = f.alt;
  if (f.heading != null) unit.heading = f.heading;
  return true;
}

// An adapter calls this when its agency reports a vehicle position.
//
// Returns true if the fix was accepted and published. Invalid fixes are
// dropped and counted rather than thrown: a telemetry stream must not
// be able to take down the tick loop, and a stream that is quietly
// producing rubbish should be visible rather than fatal.
let _rejected = 0;
let _accepted = 0;

export function publishDispatchFix(fix) {
  if (!isValidFix(fix)) { _rejected++; return false; }
  _accepted++;
  const payload = {
    dispatchId: fix.dispatchId,
    lat: fix.lat,
    lon: fix.lon,
    alt: fix.alt ?? null,
    heading: fix.heading ?? null,
    // Stamped here, by the receiving edge, never taken from the
    // payload. A feed does not get to describe its own data as
    // simulated, for the same reason the detection seam stamps its own
    // provenance.
    source: 'live',
    receivedAt: new Date().toISOString(),
    reportedAt: fix.reportedAt || null,
  };
  for (const cb of _listeners) {
    try { cb(payload); } catch (err) {
      console.warn('[dispatch_telemetry] listener failed:', err?.message || err);
    }
  }
  return true;
}

// Visibility for an operator or a developer asking whether a feed is
// actually delivering. A stream that is connected but rejecting every
// fix looks identical to no stream at all without this.
export function telemetryStats() {
  return { accepted: _accepted, rejected: _rejected, subscribers: _listeners.size };
}

export function _resetTelemetryForTest() {
  _listeners.clear();
  _accepted = 0;
  _rejected = 0;
}
