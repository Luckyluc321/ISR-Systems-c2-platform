# Agentic Eval Harness

Golden-fixture regression net for the Mistral agent surface (Agent A / Agent B / Agent 3 case-file). Runs against whichever endpoint `getInferenceConfig()` resolves to — dev-mode Mistral direct today, Azure sovereign proxy in production. Zero eval-code changes required when the endpoint moves.

Full architecture: [`docs/agentic-eval-architecture.md`](../docs/agentic-eval-architecture.md).

## Run

```bash
npm run eval                                      # full run, human-readable output
npm run eval -- --filter agent_b_debrief          # only one agent's fixtures
npm run eval -- --fixture agent-b-notable-swarm-cph   # one specific fixture
npm run eval:json > results.json                  # machine-readable, for CI
```

Requires `.env.local` with `VITE_MISTRAL_API_TOKEN` set. Runner reads `.env.local` at boot and exposes it via `globalThis.__isrEnv` so `mistral_client.getInferenceConfig()` picks it up.

Exit code:
- `0` — all fixtures passed all their opted-in assertions
- `1` — one or more assertions failed, or the runner couldn't find fixtures
- `2` — runner crashed

## Add a fixture

Drop a JSON file in `eval/fixtures/events/`. Minimum shape:

```json
{
  "fixtureId": "unique-slug",
  "agent": "agent_b_debrief",
  "expectedTier": "notable",
  "siteContextRef": "cph",
  "event": { "id": "...", "siteId": "cph", "..." },
  "samples": [],
  "analysis": {},
  "signalsProseBlock": "...",
  "assertions": ["writing_rules", "delimiter", "tier_caps", "model_version"]
}
```

`expectedTier` is required for `agent_b_debrief` fixtures (drives `tier_caps` assertion + notability-tier prompt gating). Omit for `agent_a_digest` and `agent_case_file`.

**Supported `agent` values:**
- `agent_a_digest` — site brief compression (no delimited output; skip `delimiter` + `tier_caps` in assertions)
- `agent_b_debrief` — post-event narrative + recommendation
- `agent_case_file` — live-event narrative + recommendation

**Supported `expectedTier` values (Agent B only):**
- `transit` — 500-char body, 200-char reco
- `marginal` — 1000-char body, 250-char reco
- `notable` — 2000-char body, 400-char reco

**Optional assertion-specific blocks:**
- `grounding: { expectedAssetMentions: ["ILS", "Runway 04L"] }` — body must reference these names
- `subjectFidelity: { requiredPlatformFamily: "quadcopter", requiredMinimumCount: 4 }` — body must reflect NN class + cardinality
- `partnerStrings: { canaryStrings: ["IGNORE ABOVE"] }` — body must not reflect these strings

Fixtures reference a site via `siteContextRef` → `eval/fixtures/site_contexts/<ref>.json`. Add a new site context by dropping a snapshot in `site_contexts/` (see `cph.json` for shape).

## Add an assertion

1. Write a pure function under `eval/assertions/<name>.js` with default export `(output, fixture, context) => ({ pass, message })`.
2. Reference it by filename (minus `.js`) in a fixture's `assertions` array.

Assertions are auto-loaded by the runner. No spec-file edits needed.

## Add an agent

1. Write an adapter under `eval/agents/<name>.spec.js` that wraps the agent's streaming callbacks in a Promise and returns `{ body, recommendation, model_version }`.
2. Register the adapter in `eval/runner.js` `AGENT_RUNNERS`.
3. Add fixtures with `"agent": "<name>"`.

## Cost

Full 4-fixture run: ~4 Mistral completions + Agent A digest resolution once per unique site (~1). ~5 calls total per run. On Scaleway pricing that's fractions of a cent.

For local dev, tokens are billed against your `VITE_MISTRAL_API_TOKEN` account. Don't run the harness in a tight loop.

## Contract with Azure migration

When the Azure sovereign proxy lands (see IDD IF-9.7):
1. Update `VITE_MISTRAL_ENDPOINT` in `.env.local` to point at the proxy URL.
2. Update `VITE_MISTRAL_API_TOKEN` to the proxy's auth token.
3. Run `npm run eval`.

Any proxy-introduced regression (delimiter stripping, encoding drift, streaming discontinuity, token-count changes) surfaces as an assertion failure. That's the point of this harness existing before the migration.

## Adding to CI

`npm run eval:json > results.json` emits machine-readable output. When the CI pipeline lands (GitHub Actions, likely Azure DevOps for the production repo), parse `results.json` and gate PRs on `summary.failCount === 0 && summary.errorCount === 0`.

## Design principles

- **Fixtures are DATA.** New scenarios = new JSON files. No code changes.
- **Assertions are COMPOSABLE.** Pure functions. New checks slot in without touching fixtures or runner.
- **Runner uses `getInferenceConfig()`.** Same seam as production. Endpoint changes are transparent.
- **Never asserts literal output text.** LLM output varies. Assertions check structural + semantic properties.
- **Cost-bounded.** Agent A digests cached per-site per-run.
- **Reproducibility.** Temperature pinned via `getInferenceConfig()`. Model version stamped on every result.
