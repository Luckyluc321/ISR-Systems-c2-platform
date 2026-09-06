# Agentic Eval Architecture

**Status:** `[live post-2026-09-05]` — initial harness landed with 10 fixtures, 7 assertion families, 3 agent specs. Runs against whichever Mistral endpoint `getInferenceConfig()` resolves to (dev-mode Mistral direct today, Azure sovereign proxy in production per IDD IF-9.7).

## Why

Every prompt change today invalidates nothing — no eval, no golden fixtures, no CI gate. A well-meaning tweak to `WRITING_RULES` or `DEBRIEF_TIER_RULES` silently degrades output quality until an operator notices in production. The eval harness is the regression net that makes prompt work safe.

It's also the safety net for the Azure sovereign proxy migration. When the proxy lands between the browser and the model, we need to prove request/response shape wasn't mangled in flight. The eval harness catches that.

## Design principles

1. **Fixtures are DATA, not code.** New scenario = drop a JSON file in `eval/fixtures/events/`. Zero code changes to add coverage.
2. **Assertions are COMPOSABLE.** Each assertion is a pure function `(output, fixture, context) → { pass, message }`. Spec files compose assertion sets per agent.
3. **Runner uses `getInferenceConfig()`.** Same seam as production — works against dev Mistral direct today, against Azure proxy when it lands, zero eval-code change.
4. **Reporter emits JSON.** CI hook (GitHub Actions when Azure lands, or now if wanted) reads JSON, gates PRs. Human-readable table for local runs.
5. **Cost-bounded.** Agent A digests cached per fixture. Reproducibility flag pins temperature and stamps model version.
6. **Never asserts literal output text.** LLM output varies. Assertions check structural + semantic properties (char caps, delimiter presence, named-asset grounding), never string equality on prose.

## Directory layout

```
eval/
  fixtures/
    events/                     # recorded events, one JSON per case
      cph-transit-mavic-1.json
      cph-notable-swarm-recon-1.json
      esbjerg-marginal-fixedwing-1.json
      energinet-identify-only-1.json
      ...
    site_contexts/              # per-site frozen context snapshots
      cph.json
      esbjerg.json
      energinet_kassoe.json
      ...
  assertions/                   # composable check functions
    writing_rules.js            # no em-dash, no semicolon, no filler
    delimiter.js                # ===RECO=== present, body/reco split
    tier_caps.js                # per-tier body + reco length caps
    grounding.js                # named highlighted assets appear when in signals
    partner_string.js           # no direct partner-string reflection (FIX-5)
    subject_fidelity.js         # NN classification matches subject digest
    model_version.js            # model_version populated
  agents/                       # one spec per agent
    agent_a.spec.js
    agent_b.spec.js
    agent_case_file.spec.js
  runner.js                     # CLI: node eval/runner.js [--filter agent_b] [--fixture cph-transit-mavic-1]
  reporter.js                   # human table + JSON export
  README.md                     # how to add fixtures, add assertions, run locally
```

## Fixture shape

Each fixture is a single JSON file that captures everything needed to reproduce one agent run:

```json
{
  "fixtureId": "cph-transit-mavic-1",
  "agent": "agent_b_debrief",
  "expectedTier": "transit",
  "event": { "..." },
  "samples": [ "..." ],
  "analysis": { "..." },
  "siteContextRef": "cph",
  "assertions": ["writing_rules", "delimiter", "tier_caps", "grounding", "partner_string", "model_version"],
  "notes": "Single Mavic transiting CPH ILS approach corridor. Should classify as transit tier, minimum caps."
}
```

`siteContextRef` points at `eval/fixtures/site_contexts/cph.json`. Same context can back many fixtures without duplication.

`assertions` names the assertion families that must pass. Each fixture opts in — a partner-string fixture might skip `grounding` if there's no highlighted asset to reference, for example.

## Assertion contract

```js
export default function assertionName(output, fixture, context) {
  return { pass: boolean, message: string };
}
```

- `output` — the model's output (`{ body, recommendation, model_version }`).
- `fixture` — the fixture JSON.
- `context` — resolved site context, digest, signals, preprocessing state.

Pure function. No I/O. Composable across specs. New assertions ship as new files under `eval/assertions/` and get imported by the spec that needs them.

## Runner behaviour

```
node eval/runner.js
node eval/runner.js --filter agent_b
node eval/runner.js --fixture cph-transit-mavic-1
node eval/runner.js --json > results.json
```

Sequence per fixture:
1. Load fixture + resolve site context ref.
2. Resolve Agent A digest via `ensureSiteContextDigest` (cached).
3. Call the target agent's stream entry point using `getInferenceConfig()`.
4. Await final `onDone({ body, recommendation, model_version })`.
5. Run each named assertion, collect `{ pass, message }`.
6. Report.

Failures are captured but don't abort the run — the report shows the full matrix.

## Reporter

Two modes:

**Human (default):** table per agent × fixture × assertion, with pass/fail markers and failure messages.
**JSON (`--json`):** machine-readable, one object per fixture with all assertion results. Consumed by CI later.

## Initial coverage

10 fixtures across the tier × agent matrix:
- 2× identify-only (deterministic short-circuit — no Mistral call, verifies no accidental LLM invocation)
- 2× transit (Agent B minimum caps)
- 2× marginal (Agent B middle caps)
- 2× notable (Agent B max caps + full grounding)
- 2× live case-file (Agent 3 with digest injection, post-task-4)

7 assertion families:
- writing_rules
- delimiter
- tier_caps
- grounding
- partner_string
- subject_fidelity
- model_version

## Adding coverage

**New scenario:**
1. Capture event + samples JSON. Drop in `eval/fixtures/events/`.
2. Reference the site context (add a new one under `site_contexts/` if the site isn't covered).
3. Name the assertion set in the fixture.

**New assertion:**
1. Write pure function under `eval/assertions/`.
2. Add its name to the fixtures that should enforce it.
3. Import in the relevant spec.

Zero coupling between fixtures and assertions beyond the fixture's opt-in list.

## Cost + reproducibility

- Agent A digests cached across fixtures sharing a `siteContextRef` — one Agent A call per unique site per run.
- Temperature pinned in `getInferenceConfig()` for eval runs (0.2 default, matching production).
- `model_version` stamped on every result so a Mistral model update is visible in the diff.
- Full eval run cost: ~10 fixtures × 1 Mistral call each + Agent A per site (~3 total) = ~13 completions. On Scaleway pricing that's fractions of a cent.

## Contract with Azure migration

When the sovereign proxy lands:
- `VITE_MISTRAL_ENDPOINT` points at the proxy URL.
- `getInferenceConfig()` returns proxy-endpoint config.
- Eval harness calls the proxy the same way production does.
- Assertions catch any proxy-introduced regressions (delimiter stripping, encoding changes, streaming discontinuities, token-count drift).

No eval-code change required for the migration. That's the point.

## Related

- `docs/agentic-architecture.md` — the agents this harness tests.
- `docs/agentic-preprocessing-architecture.md` — the deterministic pipeline that feeds Agent B.
- `docs/agentic-signature-bridge-architecture.md` — planned upstream layer; when it lands, add signature-bridge assertions to this harness.
- `docs/interface-design-document.md` IF-9.3, IF-9.5, IF-9.7 — the contracts this harness verifies against.
- Memory: `azure-final-destination`, `api-nn-plugin-ready`.
