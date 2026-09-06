// Agent 3 (live case-file) adapter. Same Promise-wrap pattern as
// Agent B. Accepts siteDigest injected by the runner (matches the
// production wiring in main.js _fireMistralCaseFile added 2026-09-04).

import { streamCaseFileNarrative } from '../../src/agents/agent_case_file.js';

export async function runAgentCaseFile(fixture, { site, digest }) {
  return new Promise((resolve, reject) => {
    let bodyBuf = '';
    let recoBuf = '';

    streamCaseFileNarrative(fixture.event, site, {
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
    }, digest, fixture.cooperativeCheckBlock);
  });
}
