// Agent B (post-event debrief) adapter.
//
// Wraps streamDebriefNarrative's callback interface into a Promise so
// the runner can await it. The fixture provides pre-resolved
// preprocessing outputs (siteDigest, highlightsJson, signalsJsonBlock,
// signalsProseBlock, notabilityTier) so eval runs are deterministic
// and don't depend on hitting the real preprocessing pipeline at
// eval time. See eval/README.md for fixture-authoring guidance.

import { streamDebriefNarrative } from '../../src/agents/agent_b_debrief.js';

export async function runAgentB(fixture, { digest }) {
  const { event, samples = [], analysis = {} } = fixture;
  const opts = {
    siteDigest: digest,
    highlightsJson: fixture.highlightsJson,
    signalsJsonBlock: fixture.signalsJsonBlock,
    signalsProseBlock: fixture.signalsProseBlock,
    // Pre-authored cooperative-check block. Fixture opts in with a
    // string; real production runs resolve this via
    // cooperative_traffic_reconciler.checkCooperativeTraffic. Keeping
    // eval deterministic (no HTTP to OpenSky) — fixture author owns
    // the block content.
    cooperativeCheckBlock: fixture.cooperativeCheckBlock,
    // Pre-authored PRIOR SIMILAR EVENTS block. Same fixture-owned
    // pattern — production resolves via precedent_retrieval.buildPrecedentBlock.
    // Eval fixture holds a hand-written string so assertions stay
    // deterministic across runs.
    precedentBlock: fixture.precedentBlock,
    notabilityTier: fixture.expectedTier,
    maxTokens: fixture.maxTokens,
  };

  return new Promise((resolve, reject) => {
    let bodyBuf = '';
    let recoBuf = '';

    streamDebriefNarrative(event, samples, analysis, {
      onBodyDelta: (text) => { bodyBuf = text; },
      onRecoDelta: (text) => { recoBuf = text; },
      onDone: ({ body, recommendation, model_version }) => {
        resolve({
          body: body ?? bodyBuf,
          recommendation: recommendation ?? recoBuf,
          model_version: model_version || null,
        });
      },
      onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    }, opts);
  });
}
