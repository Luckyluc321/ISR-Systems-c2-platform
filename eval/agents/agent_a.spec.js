// Agent A (site context digest) adapter.
//
// Agent A is not streaming — it's a single non-streaming Mistral call
// that returns a ~300-word site brief. The adapter wraps
// ensureSiteContextDigest so the runner can await it and hand the
// resulting string to assertions.
//
// Fixture shape for Agent A:
//   { agent: "agent_a_digest", siteContextRef, ... }
// Runner resolves siteContext via eval/fixtures/site_contexts/<ref>.json
// and passes it in as the context input.

import { ensureSiteContextDigest } from '../../src/agents/agent_a_digest.js';

export async function runAgentA(fixture, { siteContext }) {
  const siteId = fixture.event?.siteId || siteContext?.site_id || fixture.siteContextRef;
  const digest = await ensureSiteContextDigest(siteId, siteContext);
  // Shape the output to match the {body, recommendation, model_version}
  // contract the assertions expect — Agent A only produces prose so
  // reco is empty, model_version comes from the underlying call.
  return {
    body: digest || '',
    recommendation: '',
    model_version: 'agent-a-digest',   // Agent A doesn't stamp per-call
  };
}
