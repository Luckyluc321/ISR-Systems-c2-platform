// ═══════════════════════════════════════════════════════════════════
// Track Source — where an object's IDENTITY comes from
// ───────────────────────────────────────────────────────────────────
// A sensor sees a blip. A second later it sees another blip. Nothing
// in a detection says those two blips are the same aircraft.
//
// In the simulation environment that question never comes up, because
// a drone IS an object: the tick loop holds it, moves it, and then
// asks the detection seam what confidence a sensor would have had at
// that point. The detection is downstream of the object.
//
// In a real deployment it is the other way round. Detections arrive
// first, from many sensors, many times a second, carrying no identity.
// Something has to decide which of them are one aircraft, assign it a
// stable id, and keep that id attached as it crosses between sensors.
//
// THAT SOMETHING IS NOT THIS PLATFORM. It belongs at the edge, with
// the raw signal, microsecond timestamps and per-modality features
// that never reach a browser. This module is the seam where a finished
// track arrives. C2 consumes identity. It never mints it.
//
// ── The contract is SAPIENT, and we already committed to it ─────────
//
// docs/idd-integration-brief.md already states that our detection
// output aligns to the SAPIENT interface control document, published
// as BSI Flex 335 v2.0. SAPIENT is Dstl-owned, UK MOD adopted and in
// NATO ratification as the sensor-to-C2 standard for this exact
// problem. Its message definitions are openly published.
//
// So the identity model here is not invented. It is lifted from
// SAPIENT's DetectionReport:
//
//   object_id              ULID for the object detected in the
//                          environment. The stable identity.
//   associated_detection[] Other SAPIENT detections associated with
//                          this one, each carrying the node that
//                          produced it and how it relates:
//                          PARENT / CHILD / SIBLING / NO_RELATION.
//   state                  Whether a special case is in effect,
//                          for example the object being lost.
//
// Using the standard's own field names, rather than a paraphrase of
// them, is the point. It means an edge node that conforms to a
// published NATO-track standard plugs in with no translation layer,
// and it means the ask to whoever builds the edge is "conform to
// BSI Flex 335", not "implement our bespoke format".
//
// ── Two things SAPIENT gets right that we should not re-litigate ────
//
// POSITION IS A ONEOF. A track carries EITHER a location (x, y, z with
// per-axis error) OR a range and bearing from the reporting node, with
// range OPTIONAL and its own separate range_error. That second case is
// not an afterthought. A radio-frequency sensor commonly gives a
// direction and no distance at all, and a model that forces every
// observation into a latitude and longitude would make such a sensor
// fabricate a range it never measured.
//
// DATUM IS MANDATORY. An altitude means nothing without saying what it
// is measured from. SAPIENT refuses to let a message omit it. We
// reached the same conclusion independently on the dispatch telemetry
// seam and aligned the enum names here rather than keeping our own.
//
// Pure and dependency-free so it loads under plain Node and can be
// tested without a browser. The subscriber that mutates platform state
// lives in main.js, at the seam, because src/events.js owns event
// writes and the mutation gate enforces it.
// ═══════════════════════════════════════════════════════════════════

// ── SAPIENT enums, verbatim from BSI Flex 335 v2.0 ──────────────────
// Names match the standard so a conforming producer needs no mapping.

export const ASSOCIATION_RELATION = Object.freeze({
  UNSPECIFIED: 'ASSOCIATION_RELATION_UNSPECIFIED',
  NO_RELATION: 'ASSOCIATION_RELATION_NO_RELATION',
  PARENT: 'ASSOCIATION_RELATION_PARENT',
  CHILD: 'ASSOCIATION_RELATION_CHILD',
  SIBLING: 'ASSOCIATION_RELATION_SIBLING',
});

export const LOCATION_DATUM = Object.freeze({
  UNSPECIFIED: 'LOCATION_DATUM_UNSPECIFIED',
  WGS84_E: 'LOCATION_DATUM_WGS84_E',   // ellipsoid height
  WGS84_G: 'LOCATION_DATUM_WGS84_G',   // geoid, i.e. roughly mean sea level
});

export const LOCATION_COORDINATE_SYSTEM = Object.freeze({
  UNSPECIFIED: 'LOCATION_COORDINATE_SYSTEM_UNSPECIFIED',
  LAT_LNG_DEG_M: 'LOCATION_COORDINATE_SYSTEM_LAT_LNG_DEG_M',
  LAT_LNG_RAD_M: 'LOCATION_COORDINATE_SYSTEM_LAT_LNG_RAD_M',
  UTM_M: 'LOCATION_COORDINATE_SYSTEM_UTM_M',
});

// The renderer places a drone at a height above ground. Neither SAPIENT
// datum is that, and converting needs the terrain height beneath the
// aircraft. So altitude is carried with its declared datum and left
// unconverted, exactly as on the dispatch telemetry seam: a visible gap
// rather than a silent error the size of the local terrain.
//
// Deliberately empty. When a conversion is written against a real
// producer's spec, the datum it handles goes in here and nothing else
// in this file changes.
export const CONVERTIBLE_LOCATION_DATUMS = Object.freeze(new Set());

// ── Registry ────────────────────────────────────────────────────────
// Same shape as cooperative_traffic_source, dispatch_source,
// escalation_source and dispatch_telemetry: register by key, look up by
// key. Modelled on dispatch_telemetry specifically, because it is the
// only existing seam that ingests externally identified, externally
// positioned objects and therefore already solved the problems this one
// has: refusing unregistered providers, rejecting rather than clamping,
// stamping its own provenance, and counting failures per feed.

const _adapters = new Map();

export function registerTrackAdapter(name, adapter) {
  if (!name || typeof name !== 'string') throw new Error('adapter name required');
  if (!adapter || typeof adapter.start !== 'function') {
    throw new Error(`track adapter ${name} missing start(publish)`);
  }
  // PROVENANCE IS DECLARED AT REGISTRATION, not carried on a payload.
  //
  // The distinction matters. Registration happens in this repository's
  // own code, which is trusted; a payload arrives over a wire, which is
  // not. So an adapter must say once, up front, whether it produces
  // real observations or simulated ones, and every track it publishes
  // is stamped from that declaration. A feed still cannot describe its
  // own data, because the field it would have to lie in is not read.
  //
  // Same rule as nn_source.js, where the mock source declares 'sim' and
  // the websocket source declares 'live' in their constructors.
  if (adapter.source !== 'sim' && adapter.source !== 'live') {
    throw new Error(
      `track adapter ${name} must declare source: 'sim' or 'live'. `
      + 'A track with no provenance is unattributable once real and simulated data mix.',
    );
  }
  _adapters.set(name, {
    adapter, source: adapter.source, accepted: 0, rejected: 0, reasons: {},
  });
  return (track) => publishTrack(name, track);
}

export function getTrackAdapter(name) {
  return _adapters.get(name)?.adapter || null;
}

export function listTrackAdapters() {
  return [..._adapters.keys()];
}

const _listeners = new Set();

// Register interest in tracks. Returns an unsubscribe function. main.js
// is the only expected subscriber; adapters publish, they do not
// subscribe.
export function onTrack(cb) {
  if (typeof cb === 'function') _listeners.add(cb);
  return () => _listeners.delete(cb);
}

// ── Validation ──────────────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

// Returns null when the track is usable, otherwise a short machine
// readable reason. Named reasons rather than a bare false so a caller
// can tell a missing identity from a bad coordinate, and so the
// per-provider counters can say WHY a feed is failing.
export function trackRejectionReason(track) {
  if (!track || typeof track !== 'object') return 'not_an_object';

  // THE CENTRAL INVARIANT. A track with no object_id is not a track,
  // it is a detection. Accepting one and generating an id here would
  // make this platform the thing that decides what is one aircraft,
  // which is the job it is explicitly not doing.
  if (!isNonEmptyString(track.object_id)) return 'missing_object_id';
  if (!isNonEmptyString(track.node_id)) return 'missing_node_id';

  const hasLocation = track.location != null;
  const hasRangeBearing = track.range_bearing != null;
  // SAPIENT models these as a mandatory oneof. Both is ambiguous about
  // which the producer actually measured.
  if (hasLocation && hasRangeBearing) return 'ambiguous_position';
  if (!hasLocation && !hasRangeBearing) return 'missing_position';

  if (hasLocation) {
    const { x, y, z, coordinate_system: cs, datum } = track.location;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 'non_finite_coordinate';
    if (cs !== LOCATION_COORDINATE_SYSTEM.LAT_LNG_DEG_M) return 'unsupported_coordinate_system';
    // x is longitude and y is latitude in SAPIENT's ordering, which is
    // the opposite of how they are usually written. Getting this
    // backwards silently puts an aircraft in the wrong hemisphere.
    if (y < -90 || y > 90 || x < -180 || x > 180) return 'coordinate_out_of_range';
    if (y === 0 && x === 0) return 'null_island';
    if (z != null) {
      if (!Number.isFinite(z)) return 'non_finite_altitude';
      // Mandatory in the standard, and the reason it is mandatory is
      // that an altitude without one is a silent error.
      if (!Object.values(LOCATION_DATUM).includes(datum)
          || datum === LOCATION_DATUM.UNSPECIFIED) return 'missing_altitude_datum';
    }
  }

  if (hasRangeBearing) {
    const { azimuth, range } = track.range_bearing;
    if (!Number.isFinite(azimuth)) return 'non_finite_azimuth';
    if (azimuth < 0 || azimuth > 360) return 'azimuth_out_of_range';
    // range is OPTIONAL and that is the whole point. A radio-frequency
    // sensor reporting a bearing and no distance is reporting the truth,
    // and must not be made to invent one.
    if (range != null && (!Number.isFinite(range) || range < 0)) return 'invalid_range';
  }

  if (track.detection_confidence != null) {
    const c = track.detection_confidence;
    if (!Number.isFinite(c) || c < 0 || c > 1) return 'confidence_out_of_range';
  }

  if (track.associated_detection != null) {
    if (!Array.isArray(track.associated_detection)) return 'associated_detection_not_a_list';
    for (const a of track.associated_detection) {
      if (!a || typeof a !== 'object') return 'malformed_association';
      if (!isNonEmptyString(a.object_id)) return 'association_missing_object_id';
      if (!isNonEmptyString(a.node_id)) return 'association_missing_node_id';
      if (a.association_type != null
          && !Object.values(ASSOCIATION_RELATION).includes(a.association_type)) {
        return 'unknown_association_type';
      }
      // An object claiming to be associated with itself is a producer
      // bug that would otherwise build a self-referential identity
      // graph nothing can walk.
      if (a.object_id === track.object_id) return 'self_association';
    }
  }

  return null;
}

export function isValidTrack(track) {
  return trackRejectionReason(track) === null;
}

// ── Publish ─────────────────────────────────────────────────────────

// An adapter calls this when its edge node reports a track.
//
// Returns a result object rather than a bare boolean, matching the
// sibling seams: a caller that cannot tell a malformed coordinate from
// an unregistered provider cannot act on either. Invalid tracks are
// counted rather than thrown, because a feed must not be able to take
// down the render loop, and a feed quietly producing rubbish should be
// visible rather than fatal.
export function publishTrack(provider, track) {
  const stats = _adapters.get(provider);
  const timestamp = new Date().toISOString();
  if (!stats) {
    // Refusing an unregistered provider is what makes the provider on a
    // payload mean anything.
    return { status: 'rejected', reason: 'unknown_provider', provider, timestamp };
  }
  const reason = trackRejectionReason(track);
  if (reason) {
    stats.rejected++;
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
    return {
      status: 'rejected', reason, provider,
      objectId: track?.object_id ?? null, timestamp,
    };
  }
  stats.accepted++;

  const loc = track.location || null;
  const altDatum = loc?.z != null ? loc.datum : null;
  const altitudeApplied = altDatum != null && CONVERTIBLE_LOCATION_DATUMS.has(altDatum);

  const payload = {
    objectId: track.object_id,
    nodeId: track.node_id,
    // Null for a bearing-only report, which is a legitimate track.
    lat: loc ? loc.y : null,
    lon: loc ? loc.x : null,
    latError: loc?.y_error ?? null,
    lonError: loc?.x_error ?? null,
    alt: altitudeApplied ? loc.z : null,
    altRaw: loc?.z ?? null,
    altDatum,
    rangeBearing: track.range_bearing
      ? {
        azimuth: track.range_bearing.azimuth,
        azimuthError: track.range_bearing.azimuth_error ?? null,
        elevation: track.range_bearing.elevation ?? null,
        // Explicitly null rather than absent, so a consumer cannot
        // mistake "not measured" for "not sent".
        range: track.range_bearing.range ?? null,
        rangeError: track.range_bearing.range_error ?? null,
      }
      : null,
    confidence: track.detection_confidence ?? null,
    classification: Array.isArray(track.classification) ? track.classification : [],
    // The identity graph. This is the field that answers "which blips
    // are one aircraft", and it is carried through untouched.
    associations: Array.isArray(track.associated_detection) ? track.associated_detection : [],
    // SAPIENT's own lifecycle field, documented as "whether a special
    // case is in effect (e.g. object lost)".
    state: track.state ?? null,
    // Read from the adapter's registration, never from the payload.
    // See registerTrackAdapter for why that distinction is the whole
    // protection.
    source: stats.source,
    provider,
    receivedAt: timestamp,
    reportedAt: track.timestamp || null,
  };

  for (const cb of _listeners) {
    try { cb(payload); } catch (err) {
      console.warn('[track_source] listener failed:', err?.message || err);
    }
  }

  return {
    status: 'accepted',
    provider,
    objectId: track.object_id,
    altitudeApplied,
    bearingOnly: payload.lat === null,
    timestamp,
  };
}

// ── Association graph ───────────────────────────────────────────────

// Which object ids does this track claim to be the same aircraft as?
//
// PARENT, CHILD and SIBLING all assert a real relationship. NO_RELATION
// and UNSPECIFIED do not, and are filtered out rather than treated as
// weak evidence: a producer that explicitly says two detections are
// unrelated must not have that read as a link.
export function relatedObjectIds(payload) {
  const out = [];
  for (const a of payload?.associations || []) {
    const t = a.association_type;
    if (t === ASSOCIATION_RELATION.PARENT
      || t === ASSOCIATION_RELATION.CHILD
      || t === ASSOCIATION_RELATION.SIBLING) {
      out.push(a.object_id);
    }
  }
  return out;
}

// ── Visibility ──────────────────────────────────────────────────────

export function trackStats(provider) {
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

export function _resetTracksForTest() {
  _listeners.clear();
  _adapters.clear();
}
