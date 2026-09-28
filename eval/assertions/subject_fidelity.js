// Assertion: the model's body must reflect the DetectionSubject's
// class and cardinality faithfully — no confabulating a fixed-wing
// when the NN said quadcopter, no describing a single drone when the
// swarm formation is 4.
//
// Fixture opts in via:
//   "subjectFidelity": {
//     "requiredPlatformFamily": "dji-quadcopter",  // family must be recognisable in the body
//     "requiredMinimumCount": 4                    // body must mention >= this count OR "swarm"/"formation"
//   }
//
// Missing subjectFidelity block = skip.
//
// ── Why this is not a substring match ───────────────────────────────
//
// It used to be `body.includes(requiredPlatformFamily)`, comparing an
// internal identifier against operator prose. That failed four fixtures
// on 2026-09-28 and every one of them was the model being right:
//
//   required "loitering_munition"  body said "loitering munition"
//   required "fixed_wing"          body said "fixed-wing"
//   required "quadcopter"          body said "DJI Mavic 3"
//   required "quadcopter"          body said "Matrice-class airframes"
//
// The first two differ from the fixture by a single punctuation mark.
// The other two are the model naming the airframe more precisely than
// the family label does, which is better output, not worse.
//
// A snake_case identifier can never appear in good operator writing, so
// those fixtures could not have passed however good the model was. An
// assertion that cannot pass is not measuring anything.
//
// So the family is matched by SURFACE FORM: the words an operator would
// actually read, including model names that can only belong to one
// family. The cardinality half already worked this way, accepting a
// digit, a number word, or a swarm token, and it is unchanged.
// ═══════════════════════════════════════════════════════════════════

import { FAMILIES } from '../../src/families.js';

const SWARM_TOKENS = ['swarm', 'formation', 'pack', 'group'];

// Surface forms per family group. Written as they appear in prose.
// Model and brand names are included only where they belong to exactly
// one family; anything ambiguous is left out rather than guessed at.
//
// Deliberately NOT including 'drone' or 'uav' anywhere. They are true
// of every family here, so they would let any output satisfy any
// requirement and the assertion would stop meaning anything.
const SURFACE_FORMS = {
  rotary: [
    'quadcopter', 'quadrotor', 'multirotor', 'hexacopter', 'octocopter',
    'rotary wing', 'rotorcraft',
    'mavic', 'matrice', 'phantom', 'inspire', 'evo ii', 'skydio',
  ],
  // A cooperative transponder match identifies an airliner more firmly
  // than the words "fixed wing" do, and the model legitimately varies
  // between the two. This assertion was flaky across runs until both
  // were accepted: sometimes "a single fixed-wing track", sometimes
  // "cooperative match to RYR2A confirms friendly commercial traffic".
  //
  // Only POSITIVE identifications are listed. 'ads-b' and 'transponder'
  // are deliberately absent, because a quadcopter narrative saying "no
  // ADS-B" would otherwise satisfy a fixed-wing requirement.
  fixedWing: [
    'fixed wing', 'fixedwing', 'aeroplane', 'airplane',
    'airliner', 'commercial traffic', 'commercial aircraft', 'commercial flight',
  ],
  loitering: [
    'loitering munition', 'one way attack', 'one-way attack',
    'kamikaze', 'shahed', 'geran',
  ],
  cruiseMissile: ['cruise missile'],
  helicopter: ['helicopter'],
  balloon: ['balloon', 'aerostat'],
  strategicUav: ['strategic uav', 'high altitude', 'hale'],
  unknown: ['unidentified', 'unclassified', 'unknown platform'],
};

// Canonical family value → surface-form group.
const FAMILY_TO_GROUP = {
  [FAMILIES.SHAHED]: 'loitering',
  [FAMILIES.LOITERING_MUNITION]: 'loitering',
  [FAMILIES.CRUISE_MISSILE]: 'cruiseMissile',
  [FAMILIES.STRATEGIC_UAV]: 'strategicUav',
  [FAMILIES.DJI_QUADCOPTER]: 'rotary',
  [FAMILIES.FPV_QUADCOPTER]: 'rotary',
  [FAMILIES.SMALL_QUADCOPTER]: 'rotary',
  [FAMILIES.DRONE_SWARM]: 'rotary',
  [FAMILIES.HELICOPTER]: 'helicopter',
  [FAMILIES.FIXED_WING]: 'fixedWing',
  [FAMILIES.BALLOON_TETHERED]: 'balloon',
  [FAMILIES.UNKNOWN]: 'unknown',
};

// Fixtures were written with their own spellings before the canonical
// list existed: 'quadcopter', 'fixed_wing', 'loitering_munition'.
// Normalising punctuation lets a fixture say it any of those ways and
// still resolve, so this assertion is not also a rename tax.
function _normalise(text) {
  return String(text || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Resolve a fixture's declared family to a surface-form group.
// Returns null when it resolves to nothing, which is itself a failure:
// a fixture asking for a family that does not exist is a broken
// fixture, and it should say so rather than quietly pass.
function _groupFor(declared) {
  const want = _normalise(declared);
  for (const [family, group] of Object.entries(FAMILY_TO_GROUP)) {
    if (_normalise(family) === want) return group;
  }
  // Bare forms the fixtures use, which are not canonical family values
  // but are unambiguous.
  const BARE = {
    quadcopter: 'rotary', quadrotor: 'rotary', multirotor: 'rotary', rotary: 'rotary',
    'fixed wing': 'fixedWing',
    'loitering munition': 'loitering',
    'cruise missile': 'cruiseMissile',
    helicopter: 'helicopter', balloon: 'balloon', unknown: 'unknown',
  };
  return BARE[want] || null;
}

function _containsAnyToken(text, tokens) {
  const lower = _normalise(text);
  return tokens.some(t => lower.includes(_normalise(t)));
}

function _containsCountReference(text, minCount) {
  // Match a number that's >= minCount and looks like a count
  // (word or digit form).
  const digits = text.match(/\b(\d+)\b/g) || [];
  for (const d of digits) {
    if (parseInt(d, 10) >= minCount) return true;
  }
  const wordCounts = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const lower = text.toLowerCase();
  for (const [word, n] of Object.entries(wordCounts)) {
    if (n >= minCount && new RegExp(`\\b${word}\\b`).test(lower)) return true;
  }
  return false;
}

export default function subject_fidelity(output, fixture, context) {
  const sf = fixture.subjectFidelity;
  if (!sf) return { pass: true, message: 'no subject fidelity requirement declared' };

  const body = output.body || '';
  const problems = [];

  if (sf.requiredPlatformFamily) {
    const group = _groupFor(sf.requiredPlatformFamily);
    if (!group) {
      // A broken fixture, not a broken model. Named as such so nobody
      // spends an afternoon rewriting a prompt to satisfy a typo.
      problems.push(
        `fixture declares platform family "${sf.requiredPlatformFamily}", which resolves to no known `
        + 'family. Use a value from FAMILIES in src/families.js',
      );
    } else if (!_containsAnyToken(body, SURFACE_FORMS[group])) {
      problems.push(
        `body never identifies the platform as ${group}. Expected one of: `
        + `${SURFACE_FORMS[group].slice(0, 6).join(', ')}`,
      );
    }
  }

  if (typeof sf.requiredMinimumCount === 'number' && sf.requiredMinimumCount > 1) {
    const hasCount = _containsCountReference(body, sf.requiredMinimumCount);
    const hasSwarmToken = _containsAnyToken(body, SWARM_TOKENS);
    if (!hasCount && !hasSwarmToken) {
      problems.push(`multi-drone event (${sf.requiredMinimumCount}) described as single drone (no numeric count and no swarm/formation token)`);
    }
  }

  return problems.length === 0
    ? { pass: true, message: 'subject fidelity ok' }
    : { pass: false, message: problems.join('; ') };
}
