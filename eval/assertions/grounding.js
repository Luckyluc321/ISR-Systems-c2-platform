// Assertion: when the fixture declares grounding.expectedAssetMentions,
// each of those asset names must appear in the body (case-insensitive).
// This is the "did the model actually use the Agent A digest" check.
//
// Fixture opts in via:
//   "grounding": { "expectedAssetMentions": ["ILS 30", "Terminal 2"] }
//
// Missing grounding block = skip check (pass with note).

export default function grounding(output, fixture, context) {
  const g = fixture.grounding;
  if (!g || !Array.isArray(g.expectedAssetMentions) || g.expectedAssetMentions.length === 0) {
    return { pass: true, message: 'no grounding requirement declared for this fixture' };
  }

  const body = (output.body || '').toLowerCase();
  const missing = g.expectedAssetMentions.filter(name => !body.includes(String(name).toLowerCase()));

  if (missing.length === 0) {
    return { pass: true, message: `all ${g.expectedAssetMentions.length} expected assets referenced` };
  }
  return { pass: false, message: `missing asset references: ${missing.join(', ')}` };
}
