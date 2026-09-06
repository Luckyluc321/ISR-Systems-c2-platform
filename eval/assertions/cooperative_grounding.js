// Assertion: when the fixture provides a cooperativeCheckBlock AND
// declares grounding.expectedCoopSignals, the model output must
// reflect the check result — either mentioning a matched callsign,
// mentioning cooperation/non-cooperation, or referencing the
// cross-check outcome.
//
// Fixture opts in via:
//   "cooperativeCheckBlock": "COOPERATIVE TRAFFIC CROSS-CHECK\n..."
//   "grounding": { "expectedCoopSignals": ["cooperative", "SAS831"] }
//
// Missing cooperativeCheckBlock or expectedCoopSignals = skip.

export default function cooperative_grounding(output, fixture, context) {
  if (!fixture.cooperativeCheckBlock) {
    return { pass: true, message: 'no cooperativeCheckBlock in fixture' };
  }
  const expected = fixture.grounding?.expectedCoopSignals;
  if (!Array.isArray(expected) || expected.length === 0) {
    return { pass: true, message: 'no expectedCoopSignals declared' };
  }

  const both = `${output.body || ''}\n${output.recommendation || ''}`.toLowerCase();
  const missing = expected.filter(sig => !both.includes(String(sig).toLowerCase()));

  if (missing.length === 0) {
    return { pass: true, message: `all ${expected.length} cooperative-check signals reflected in output` };
  }
  return { pass: false, message: `cooperative-check block ignored — missing signals: ${missing.join(', ')}` };
}
