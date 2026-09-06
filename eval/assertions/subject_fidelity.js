// Assertion: the model's body must reflect the DetectionSubject's
// class and cardinality faithfully — no confabulating a fixed-wing
// when the NN said quadcopter, no describing a single drone when the
// swarm formation is 4.
//
// Fixture opts in via:
//   "subjectFidelity": {
//     "requiredPlatformFamily": "quadcopter",   // must appear in body
//     "requiredMinimumCount": 4                 // body must mention >= this count OR "swarm"/"formation"
//   }
//
// Missing subjectFidelity block = skip.

const SWARM_TOKENS = ['swarm', 'formation', 'pack', 'group'];

function _containsAnyToken(text, tokens) {
  const lower = text.toLowerCase();
  return tokens.some(t => lower.includes(t));
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
    if (!body.toLowerCase().includes(String(sf.requiredPlatformFamily).toLowerCase())) {
      problems.push(`missing required platform family "${sf.requiredPlatformFamily}"`);
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
