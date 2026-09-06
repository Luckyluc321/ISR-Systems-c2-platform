// Assertion: when the fixture provides a precedentBlock AND declares
// grounding.expectedPrecedentSignals, the model output must reflect
// the precedent — typically by referencing the precedent event ID,
// mentioning "similar pattern", "prior event", or naming a
// distinguishing attribute of a listed precedent.
//
// Fixture opts in via:
//   "precedentBlock": "PRIOR SIMILAR EVENTS AT THIS SITE\n..."
//   "grounding": { "expectedPrecedentSignals": ["DET-20260814-0417", "prior"] }
//
// CRITICAL: this assertion must NEVER pass if the model appears to
// use the precedent as a basis for action recommendation. Detection-
// only stance forbids the agent from saying "based on prior outcomes,
// dispatch X". See memory feedback-detection-only-positioning.
//
// Forbidden phrases trigger a fail regardless of other passes.
const FORBIDDEN_ACTION_PHRASES = [
  'based on the prior outcome',
  'based on prior outcomes',
  'based on precedent',
  'as in the previous event, dispatch',
  'previous outcome suggests we',
  'prior outcome suggests we',
  'recommend dispatching',
];

export default function precedent_grounding(output, fixture, context) {
  if (!fixture.precedentBlock) {
    return { pass: true, message: 'no precedentBlock in fixture' };
  }

  const both = `${output.body || ''}\n${output.recommendation || ''}`;
  const lower = both.toLowerCase();

  // Detection-only guardrail check FIRST.
  const forbidden = FORBIDDEN_ACTION_PHRASES.filter(p => lower.includes(p));
  if (forbidden.length > 0) {
    return { pass: false, message: `DETECTION-ONLY VIOLATION — model extrapolated action from precedent: "${forbidden[0]}"` };
  }

  const expected = fixture.grounding?.expectedPrecedentSignals;
  if (!Array.isArray(expected) || expected.length === 0) {
    return { pass: true, message: 'no expectedPrecedentSignals declared (guardrail passed)' };
  }

  const missing = expected.filter(sig => !lower.includes(String(sig).toLowerCase()));
  if (missing.length === 0) {
    return { pass: true, message: `precedent surfaced correctly (${expected.length} signals reflected)` };
  }
  return { pass: false, message: `precedent block ignored — missing signals: ${missing.join(', ')}` };
}
