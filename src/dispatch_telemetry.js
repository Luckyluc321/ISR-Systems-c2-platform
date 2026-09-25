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
// A REGISTRY, like every sibling seam. An adapter registers by name and
// gets back its own publish function. That name rides every payload, so
// on a multi-agency incident a bad position is attributable to one feed
// rather than to "live", and the counters can say which feed is broken.
//
// Pure and dependency-free so it loads under plain Node and can be
// tested without a browser. The subscriber that mutates live dispatch
// state lives in main.js, at the seam, like every other adapter here.
// ═══════════════════════════════════════════════════════════════════

// ── Registry ────────────────────────────────────────────────────────
// Same shape as nn_source, dispatch_source, escalation_source and
// cooperative_traffic_source: register by key, look up by key. A fix
// carries the provider that produced it, so on a multi-agency incident
// a bad position is attributable to one feed rather than to "live".
//
// Counters are per provider for the same reason. One aggregate number
// cannot tell you that the ambulance service's tracker is fine and the
// police one is rejecting everything.
const _adapters = new Map();

export function registerTelemetryAdapter(name, adapter) {
  if (!name || typeof name !== 'string') throw new Error('adapter name required');
  if (!adapter || typeof adapter.start !== 'function') {
    throw new Error(`telemetry adapter ${name} missing start(publish)`);
  }
  _adapters.set(name, { adapter, accepted: 0, rejected: 0, reasons: {} });
  return (fix) => publishDispatchFix(name, fix);
}

export function getTelemetryAdapter(name) {
  return _adapters.get(name)?.adapter || null;
}

export function listTelemetryAdapters() {
  return [..._adapters.keys()];
}

const _listeners = new Set();

// Register interest in position fixes. Returns an unsubscribe function.
// main.js is the only expected subscriber; adapters publish, they do
// not subscribe.
export function onDispatchFix(cb) {
  if (typeof cb === 'function') _listeners.add(cb);
  return () => _listeners.delete(cb);
}

// ── Altitude datum ──────────────────────────────────────────────────
// A tracker's altitude is meaningless without saying what it is
// measured from. Real vehicle trackers commonly report height above the
// WGS84 ellipsoid or above mean sea level; the renderer here treats a
// unit's altitude as metres above ground.
//
// Converting between them needs the terrain height under the vehicle,
// which is a Cesium sample and therefore not this module's job. Until a
// real tracker's spec says which it sends, the honest thing is to
// demand the fix declare it and to refuse to guess. A fix that declares
// a datum we cannot yet convert keeps its position and drops only its
// altitude, which is a visible gap rather than a silent 40 metre error.
export const ALT_DATUMS = new Set(['agl', 'msl', 'ellipsoid']);
export const CONVERTIBLE_ALT_DATUMS = new Set(['agl']);

// Is this a usable position?
//
// Rejected rather than clamped. A tracker reporting a malformed or
// out-of-range coordinate is reporting that something is wrong with it,
// and silently coercing that into a plausible position would put a
// vehicle somewhere it is not, on an operator's map, during an
// incident. Null Island is the classic version of this failure.
// Returns null when the fix is usable, otherwise a short machine
// readable reason. Named reasons rather than a bare false so a caller
// can tell an out-of-range coordinate from a missing dispatch id, and
// so the per-provider counters say WHY a feed is failing.
export function fixRejectionReason(fix) {
  if (!fix || typeof fix !== 'object') return 'not_an_object';
  if (typeof fix.dispatchId !== 'string' || !fix.dispatchId) return 'missing_dispatch_id';
  const { lat, lon } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'non_finite_coordinate';
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return 'coordinate_out_of_range';
  // Exactly 0,0 is overwhelmingly a missing-data sentinel rather than a
  // vehicle in the Gulf of Guinea.
  if (lat === 0 && lon === 0) return 'null_island';
  if (fix.alt != null) {
    if (!Number.isFinite(fix.alt)) return 'non_finite_altitude';
    if (fix.alt < -500 || fix.alt > 30000) return 'altitude_out_of_range';
    // An altitude with no datum is the silent-error case this check
    // exists to prevent.
    if (!ALT_DATUMS.has(fix.altDatum)) return 'missing_altitude_datum';
  }
  if (fix.heading != null) {
    if (!Number.isFinite(fix.heading)) return 'non_finite_heading';
    // Same doctrine as the coordinate range check. A tracker reporting
    // a heading of 720 is telling you something is wrong with it.
    if (fix.heading < 0 || fix.heading > 360) return 'heading_out_of_range';
  }
  return null;
}

export function isValidFix(fix) {
  return fixRejectionReason(fix) === null;
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
// Returns a result object rather than a bare boolean, matching the
// sibling adapter seams: a caller that cannot tell an out-of-range
// coordinate from an unknown dispatch cannot do anything useful about
// either. Invalid fixes are counted rather than thrown, because a
// telemetry stream must not be able to take down the tick loop and a
// stream quietly producing rubbish should be visible rather than fatal.
export function publishDispatchFix(provider, fix) {
  const stats = _adapters.get(provider);
  const timestamp = new Date().toISOString();
  if (!stats) {
    // Refusing an unregistered provider is the point. It is what makes
    // the provider on a payload mean something.
    return { status: 'rejected', reason: 'unknown_provider', provider, timestamp };
  }
  const reason = fixRejectionReason(fix);
  if (reason) {
    stats.rejected++;
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
    return { status: 'rejected', reason, provider, dispatchId: fix?.dispatchId ?? null, timestamp };
  }
  stats.accepted++;

  // Altitude is carried only when we can place it in the frame the
  // renderer uses. Anything else keeps its declared datum on the
  // payload and is left for a conversion that does not exist yet.
  const altUsable = fix.alt != null && CONVERTIBLE_ALT_DATUMS.has(fix.altDatum);

  const payload = {
    dispatchId: fix.dispatchId,
    lat: fix.lat,
    lon: fix.lon,
    alt: altUsable ? fix.alt : null,
    altRaw: fix.alt ?? null,
    altDatum: fix.alt != null ? fix.altDatum : null,
    heading: fix.heading ?? null,
    // Stamped here, by the receiving edge, never taken from the
    // payload. A feed does not get to describe its own data as
    // simulated, for the same reason the detection seam stamps its own
    // provenance.
    source: 'live',
    provider,
    receivedAt: timestamp,
    reportedAt: fix.reportedAt || null,
  };
  for (const cb of _listeners) {
    try { cb(payload); } catch (err) {
      console.warn('[dispatch_telemetry] listener failed:', err?.message || err);
    }
  }
  return {
    status: 'accepted',
    provider,
    dispatchId: fix.dispatchId,
    altitudeApplied: altUsable,
    timestamp,
  };
}

// Visibility for an operator or a developer asking whether a feed is
// actually delivering. A stream that is connected but rejecting every
// fix looks identical to no stream at all without this.
export function telemetryStats(provider) {
  if (provider) {
    const st = _adapters.get(provider);
    if (!st) return null;
    return { accepted: st.accepted, rejected: st.rejected, reasons: { ...st.reasons } };
  }
  const byProvider = {};
  let accepted = 0;
  let rejected = 0;
  for (const [name, st] of _adapters) {
    byProvider[name] = { accepted: st.accepted, rejected: st.rejected, reasons: { ...st.reasons } };
    accepted += st.accepted;
    rejected += st.rejected;
  }
  return { accepted, rejected, subscribers: _listeners.size, providers: byProvider };
}

export function _resetTelemetryForTest() {
  _listeners.clear();
  _adapters.clear();
}
