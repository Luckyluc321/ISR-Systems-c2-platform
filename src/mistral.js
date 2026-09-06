// Re-export barrel. The Mistral integration is split across:
//   - src/mistral_client.js         (transport, config, sanitizer, siteVersionStamp)
//   - src/agents/agent_a_digest.js  (Agent A — site context digest)
//   - src/agents/agent_b_debrief.js (Agent B — debrief narrative + narrativeCache)
//   - src/agents/agent_case_file.js (Agent 3 — live-event narrative)
//
// This file re-exports every public symbol so existing importers
// (`import { X } from './mistral.js'`) keep working without a diff.
// New code should prefer importing directly from the target module.
//
// See docs/agentic-architecture.md and docs/agentic-preprocessing-architecture.md.

export {
  getInferenceConfig,
  isMistralConfigured,
  siteVersionStamp,
  invalidateSiteVersionStamp,
  sanitizePartnerString,
  // Lower-level primitives, exported for future agent modules:
  streamCompletion,
  makeDelimitedStreamHandler,
  WRITING_RULES,
  OUTPUT_FORMAT,
  RECO_DELIMITER,
  DEFAULT_TIMEOUT_MS,
  hashContent,
} from './mistral_client.js';

export {
  ensureSiteContextDigest,
  readCachedSiteDigest,
  invalidateSiteContextDigest,
} from './agents/agent_a_digest.js';

export {
  streamDebriefNarrative,
  writeNarrativeCache,
  readNarrativeCache,
  readNarrativeCacheIfSignalMatch,
  invalidateNarrativeCache,
} from './agents/agent_b_debrief.js';

export {
  streamCaseFileNarrative,
} from './agents/agent_case_file.js';
