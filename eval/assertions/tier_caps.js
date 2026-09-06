// Assertion: tier-specific body + recommendation length caps per
// IDD IF-9.3 and src/agents/agent_b_debrief.js DEBRIEF_TIER_RULES.
//
// Base contract (agent_case_file + Agent B transit):
//   body <= 500 chars, reco <= 200 chars
// marginal:
//   body <= 1000 chars, reco <= 250 chars
// notable:
//   body <= 2000 chars, reco <= 400 chars
//
// Uses fixture.expectedTier to know which caps to apply. Missing tier
// = base contract.

const CAPS = {
  base:     { body: 500,  reco: 200 },
  transit:  { body: 500,  reco: 200 },
  marginal: { body: 1000, reco: 250 },
  notable:  { body: 2000, reco: 400 },
};

export default function tier_caps(output, fixture, context) {
  const tier = fixture.expectedTier || 'base';
  const caps = CAPS[tier] || CAPS.base;
  const bodyLen = (output.body || '').length;
  const recoLen = (output.recommendation || '').length;

  const problems = [];
  if (bodyLen > caps.body) problems.push(`body ${bodyLen} chars exceeds ${tier} cap ${caps.body}`);
  if (recoLen > caps.reco) problems.push(`reco ${recoLen} chars exceeds ${tier} cap ${caps.reco}`);

  return problems.length === 0
    ? { pass: true, message: `body ${bodyLen}/${caps.body}, reco ${recoLen}/${caps.reco} (${tier})` }
    : { pass: false, message: problems.join('; ') };
}
