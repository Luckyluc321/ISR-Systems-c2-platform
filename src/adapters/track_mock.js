// ═══════════════════════════════════════════════════════════════════
// Mock track adapter — the simulation as a conforming track producer
// ───────────────────────────────────────────────────────────────────
// In the simulation environment a drone IS an object, so its identity
// is free and the platform has never needed a track feed. That is
// exactly why this adapter exists: it lets the simulation SPEAK the
// track contract it already satisfies implicitly.
//
// The point is not to fake data. It is to make the live path executable
// before any live hardware exists. The dispatch telemetry seam shipped
// with a live branch that had never run in a browser, and the result
// was that four separate defects sat undiscovered until a review read
// the code. A mock that exercises the real path is the fix for that
// class of problem.
//
// So this adapter takes positions the simulation already computes and
// emits them as SAPIENT-conformant tracks through the real registry,
// the real validator and the real subscriber. Nothing downstream can
// tell the difference between this and an edge node, which is the
// whole test.
//
// Deliberately tiny. It holds no motion model, no association logic and
// no state beyond the ids it has issued. A mock that grows into its own
// tracking engine would be simulating the thing we are trying to leave
// room for.
// ═══════════════════════════════════════════════════════════════════

import {
  registerTrackAdapter,
  ASSOCIATION_RELATION,
  LOCATION_DATUM,
  LOCATION_COORDINATE_SYSTEM,
} from '../track_source.js';

// ULID-shaped ids, because the standard specifies ULID and a producer
// that emits something else will be caught by a conforming consumer.
// Crockford base32, the alphabet ULID actually uses: no I, L, O or U.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Deterministic, so a replayed scenario produces the same ids twice.
// Math.random would make eval fixtures unreproducible.
let _seq = 0;

function mockUlid(seed) {
  let n = (seed ?? ++_seq) >>> 0;
  let out = '';
  for (let i = 0; i < 26; i++) {
    out += CROCKFORD[n % 32];
    n = Math.floor(n / 32) + i * 7 + 13;
  }
  return out;
}

// Stable mapping from a simulation member to an object id. The same
// member always gets the same id, which is the property that makes this
// a TRACK feed rather than a detection feed.
const _idByMember = new Map();

export function objectIdForMember(memberKey) {
  if (!_idByMember.has(memberKey)) {
    _idByMember.set(memberKey, mockUlid());
  }
  return _idByMember.get(memberKey);
}

// The node id a mock track claims to come from. A real deployment has
// one per physical edge node; the simulation has one logical node per
// site, which is enough to exercise per-node attribution.
export function nodeIdForSite(siteId) {
  return `sim-fusion-node-${siteId || 'unknown'}`;
}

// Build a SAPIENT-conformant track from a simulation position.
//
// Exported and pure so the build gate can assert the shape without
// standing up an adapter or a browser.
export function buildMockTrack({
  memberKey, siteId, lat, lon, alt = null, confidence = null,
  classification = null, state = null, relatedMemberKeys = [], timestamp = null,
}) {
  const track = {
    object_id: objectIdForMember(memberKey),
    node_id: nodeIdForSite(siteId),
    location: {
      // SAPIENT orders these x then y, where x is longitude. Written
      // out rather than passed positionally, because transposing them
      // silently puts an aircraft in the wrong hemisphere.
      x: lon,
      y: lat,
      z: alt,
      coordinate_system: LOCATION_COORDINATE_SYSTEM.LAT_LNG_DEG_M,
      // The simulation's altitude is height above ground, which is
      // neither SAPIENT datum. Declaring the nearest true thing and
      // letting the seam decline to convert it is honest; claiming a
      // datum we do not have would defeat the check.
      datum: alt == null ? LOCATION_DATUM.UNSPECIFIED : LOCATION_DATUM.WGS84_G,
    },
    timestamp,
  };
  if (confidence != null) track.detection_confidence = confidence;
  if (classification) track.classification = [classification];
  if (state) track.state = state;

  // A formation. Members of one group are SIBLINGs of each other, which
  // is how the standard expresses "these separate detections belong to
  // one thing" without collapsing them into a single object.
  const siblings = relatedMemberKeys.filter(k => k !== memberKey);
  if (siblings.length) {
    track.associated_detection = siblings.map(k => ({
      node_id: nodeIdForSite(siteId),
      object_id: objectIdForMember(k),
      association_type: ASSOCIATION_RELATION.SIBLING,
      timestamp,
    }));
  }
  return track;
}

// The adapter itself. `start` is the required method on every seam in
// this codebase. This one has no feed of its own: the simulation drives
// it by calling the publish function returned from registration.
const mockAdapter = {
  // Declared once, here, and stamped onto every track this adapter
  // publishes. The simulation is a first-class environment, not a
  // stand-in, and its output must say so all the way into the case
  // file. A mixed site runs real sensors and a rehearsal scenario at
  // the same time, and nothing after the fact can separate them.
  source: 'sim',
  start() { /* driven by the simulation, not by a socket */ },
};

export const publishMockTrack = registerTrackAdapter('sim', mockAdapter);

export function _resetMockTrackIdsForTest() {
  _idByMember.clear();
  _seq = 0;
}

export default mockAdapter;
