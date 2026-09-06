# ISR Systems — C2 Platform

Command and Control platform for the ISR Systems drone-detection network. Sensor-fusion evidence layer (RF + Acoustic + Visual) with an EU-sovereign agentic reasoning stack sitting on top. Serves three tenant classes — Admin, Operator, Receiver — from one codebase.

**Positioning:** detection and intelligence only. Government responds. Never a counter-drone / kinetic system.

## Stack

**Frontend**
- **CesiumJS** — 3D globe, sovereign map profile (SDFI Skærmkort / GeoDanmark WMTS + DHM terrain) with a gated photoreal profile for demo scenarios
- **Vite** — dev server + build
- **Cesium Ion** — terrain provider (day mode uses Cesium World Terrain; sovereign mode uses self-hosted DHM tiles via `VITE_DHM_TERRAIN_URL`)

**Sensor + detection layer**
- `src/nn_source.js` — pluggable `NnOutputSource` seam. Per-site adapters route to mock generator (sim) or WebSocket subscriber (live hardware). Batch contract: `{siteId, tickTs, sensors:[{sensorId, detections:[{lat, lon, alt, confidence, droneKey, modalityMix}]}]}`
- Sensors declare `modalities: ['RF','Acoustic','Visual']` in `src/sites.js` and `src/sites_energinet.js`

**Agentic reasoning stack** (`src/agents/`)
- **Agent A — site digest** (`agent_a_digest.js`): compresses partner-curated `site_context.js` into a brief under 300 words. Persistent LRU cache keyed on `(siteId, contextHash)` — cache hit = zero tokens.
- **Agent A2 — highlight ranker** (`agent_a2_highlights.js`): fallback ranker that fires only when a site lacks a declared `highlights[]`.
- **Agent B — post-event debrief** (`agent_b_debrief.js`): 4-tier notability gating (transit / marginal / notable + deterministic identify-only). Prompt injects Agent A digest as a second system message alongside structured signal blocks, trajectory analysis, and classification log.
- **Agent 3 — live case-file** (`agent_case_file.js`): streams body + recommendation for active events. Per-event 45s backoff on Mistral 429 rate-limit responses (`main.js:MISTRAL_COOLDOWN_MS`).
- **Deterministic preprocessing** (`src/preprocessing.js`): approach vectors, altitude/speed z-scores vs site baseline, dwell hotspots, formation cohesion. Grounded feature engineering feeds the LLM structured signals instead of raw coords.

**Inference hosting**
- **Current (transitional, dev-only):** browser → Mistral direct via bearer token in `VITE_MISTRAL_*` envs. Known debt (see `mistral_client.js:18-19` and IDD IF-9.7). Do not ship to production.
- **Target:** browser → Azure-hosted proxy (Container Apps, token in Key Vault) → Scaleway Mistral endpoint (sovereign EU inference). Azure carries the platform spine (Entra ID, Cosmos/Postgres state, App Insights telemetry). Scaleway is the sovereign inference provider.
- **Optional failover:** Azure Foundry Mistral as backup when Scaleway degrades. Same client contract.

**External data sources** (all EU-sovereign or open)
- SDFI Dataforsyningen (WMTS ortho + DAGI vectors)
- DMI Open Data (weather / lightning / radar)
- Datafordeler (BBR building registry, CVR)
- openAIP (Danish airspace polygons)
- Vejdirektoratet Dataudveksleren (live traffic — Azure Service Bus AMQP → own proxy → WebSocket)
- AISStream.io (live maritime AIS — WSS → own proxy → WebSocket)

**Proxies** (`scripts/`)
- `scripts/vd-amqp-proxy/` — Vejdirektoratet AMQP → WebSocket bridge, deployed to Scaleway Serverless Containers
- `scripts/ais-proxy/` — AISStream.io WSS → WebSocket bridge with per-client bbox filtering, deployed to Scaleway Serverless Containers
- `scripts/city-tiles-pipeline/` — CityGML → 3DCityDB → CityJSONSeq → glTF pipeline for self-hosted 3D building tilesets

## Local development

```bash
npm install
cp .env.example .env.local
# Fill in required tokens: Cesium Ion, Mistral, Scaleway, Datafordeler, etc.
npm run dev
```

`.env.example` documents every variable and its provider.

## Build + deploy

```bash
npm run build     # emits static bundle to dist/
```

`dist/` deploys to any static host (Vercel, Netlify, S3 + CloudFront, Azure Static Web Apps). All `VITE_*` env vars must be set on the host's build environment. Scaleway proxy containers deploy separately via `scripts/vd-amqp-proxy/` and `scripts/ais-proxy/` build scripts.

## Repository layout

```
src/
  main.js                        # Cesium bootstrap, event loop, dispatch logic, UI wiring
  nn_source.js                   # Sensor detection source abstraction (pluggable adapter)
  preprocessing.js               # Deterministic signal extraction feeding Agent B
  mistral_client.js              # SSE streaming client + prompt-injection sanitiser
  agents/
    agent_a_digest.js            # Site context compression
    agent_a2_highlights.js       # Highlight ranker (fallback)
    agent_b_debrief.js           # Post-event debrief narrative
    agent_case_file.js           # Live case-file streaming
  sovereign_*.js                 # Sovereign map + live-feed layer providers
                                 # (SDFI, DHM, GeoDanmark WFS, DAWA, AIS, airspace, traffic)
  events.js, sites.js,
  sites_energinet.js,
  site_context.js, roles.js      # Domain data
docs/
  agentic-architecture.md              # Full agent spec + Mermaid overview (START HERE)
  agentic-preprocessing-architecture.md  # Deterministic preprocessing feeding Agent B
  agentic-signature-bridge-architecture.md  # [planned] NN numeric signatures → LLM-legible narrative
  agentic-cooperative-traffic-fusion-architecture.md  # [planned — buildable today] ADS-B fusion for classification precision
  agentic-precedent-retrieval-architecture.md  # [planned — buildable today] similar past events → Agent B context
  agentic-eval-architecture.md         # Golden-fixture harness (regression net for prompts + Azure migration)
  interface-design-document.md         # SAPIENT-conformant partner contract (IF-1..IF-9)
  nn-adapter-explainer.md              # NnOutputSource seam explainer
  geospatial-integrations.md           # Sovereign map layer catalogue
  cross-agency-flows.md                # Multi-tenant escalation flows
eval/                                  # Prompt eval harness (see docs/agentic-eval-architecture.md)
  fixtures/    assertions/    agents/    runner.js    reporter.js    README.md
scripts/
  vd-amqp-proxy/                 # Vejdirektoratet live traffic proxy
  ais-proxy/                     # AIS live maritime proxy
  city-tiles-pipeline/           # CityGML → 3D Tiles build stack
public/logos/                    # Operator brand logos (CPH, Esbjerg, Energinet)
```

## Related

- Product design + agentic architecture: `docs/agentic-architecture.md` (includes Mermaid overview of all live + planned pieces), `docs/agentic-preprocessing-architecture.md`
- NN signature bridge (planned deterministic layer between raw NN and LLM): `docs/agentic-signature-bridge-architecture.md`
- Cooperative traffic fusion (planned pluggable ADS-B / Naviair adapter for classification precision at aviation sites): `docs/agentic-cooperative-traffic-fusion-architecture.md`
- Precedent retrieval (planned deterministic similar-past-events retrieval fed into Agent B prompt): `docs/agentic-precedent-retrieval-architecture.md`
- Prompt eval harness (golden fixtures + assertions, regression net for the Azure migration): `docs/agentic-eval-architecture.md`
- Partner integration contract (SAPIENT-conformant): `docs/interface-design-document.md`
- Sovereign map layer catalogue: `docs/geospatial-integrations.md`
