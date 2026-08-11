# ISR Systems · Agentic Architecture

Design reference for the multi-agent pipeline that turns neural network
detection outputs into operator-actionable intelligence and back into
coordinated response.

Current version reflects target state. Sections marked `[live]` are
implemented today. Sections marked `[planned]` are next.

---

## 1. Design principles

**Deterministic where lives are on the line, generative where nuance is
what an analyst adds.**

Correlation, threat scoring, and dispatch routing are deterministic.
Failure of these paths must never depend on a language model responding.
Narrative synthesis, dwell interpretation, and outlier explanation are
generative. Failure there degrades to a shorter deterministic summary.

**Every agent has one job.**

Seven small agents beat one large one. Small agents can be swapped,
cached, retried, and reasoned about independently. Each agent has a
defined input contract, output contract, latency budget, and failure
fallback.

**Sensor-side signal processing is not an agent.**

Raw RF, acoustic, visual, and radar processing happens inside the
neural network running on the sensor node. The NN emits fused
detection outputs on a fixed tick (~500 ms per node). The platform's
agent pipeline starts where the NN output stream arrives. Modality
processing, cross-modality fusion, and drone classification are the
NN's job, not a platform agent's job.

**Sovereign by default.**

All model inference runs on EU-hosted infrastructure. Mistral Large 2
on Scaleway or OVH for narrative and reasoning work. NN inference runs
on the sensor node itself. Zero calls to US-hosted models.

**Data provenance is a first-class artifact.**

Every derived value carries its lineage: which sensor node produced
the NN detection, which model version generated it, which agent
transformed it, at what timestamp. Not for compliance theater. For the
moment an operator asks "why did the platform say hostile" and gets a
real answer.

**Additive, not replacing.**

Real hardware plugs into the same downstream pipeline mock data uses
today. The boundary between "NN output source" and "platform logic"
is a single adapter interface, not a rewrite.

---

## 2. Platform entry point: the NN output stream

Before agent 1 fires, this happens on the sensor node:

- Raw multi-modality sensor input (RF, acoustic, visual, radar) flows
  into the neural network running locally on the sensor node.
- The NN performs modality-level signal processing, cross-modality
  fusion, and drone classification.
- On a fixed tick (~500 ms per node, configurable per site), the NN
  emits zero or more detection objects.

Each NN detection object carries:

```
{
  sensor_node_id: string
  tick_id: string
  timestamp_utc: ISO8601
  nn_model_version: string
  detections: [
    {
      nn_class: 'quadcopter' | 'fixed-wing' | 'jet' | 'missile' | 'unknown'
      nn_confidence: number 0..1
      lat: number
      lon: number
      alt_m: number
      heading_deg: number
      speed_ms: number
      contributing_modalities: string[]   // ["RF", "Acoustic", "Visual"]
      rf_signature_match: string | null   // "OcuSync 91%" | null
    }
  ]
  node_health: { cpu_pct, battery_pct, gps_lock_sec, inference_latency_ms }
}
```

The agent pipeline consumes this stream. Nothing platform-side re-does
the fusion or classification the NN already did.

---

## 3. Agent inventory

Seven agents. Numbered by their position in the live-detection flow.
Not all fire on every event.

### Agent 1 · Correlation `[live: partial]`

**Role.** Cross-references the incoming NN detection against
historical events and concurrent active events across all sites.
Detects repeat signatures, cross-border tracks, and coordinated
multi-site incursions. Also folds subsequent ticks for the same
target into an existing active event instead of spawning duplicates.

**Inputs.** NN detection stream plus the full EVENTS registry.

**Outputs.** Either a new `Event` scaffold or an update to an existing
active event, plus `CorrelationResult { linked_event_ids,
similarity_scores, cross_site_track, pattern_flags }`.

**Correlation heuristics.**
- Same RF signature at another site within 4 hours → cross-site track
- Same platform class at same site within 90 days → recurring
  incursion
- More than 3 similar events across the country in 30 days → national
  pattern flag
- Tick's target within 200 m and 8 s of an existing active event →
  attach to that event, do not spawn new

**Model.** Deterministic scoring. Signature match plus temporal
proximity plus spatial connectivity.

**Latency budget.** Sub-300 ms per tick.

**Fallback.** Correlation is advisory beyond the local same-target
attach. Missing cross-site correlation never blocks escalation, only
enriches the narrative.

---

### Agent 2 · Site Context (Agent A) `[live]`

**Role.** Maintains a per-site knowledge base of critical assets,
response asset positions, aircraft of interest, dwell zones,
perimeter geometry, and jurisdictional coverage.

**Inputs.** Site definition files, response asset registries, ATC /
port authority feeds.

**Outputs.** `SiteContext { site_id, critical_areas, high_value_assets,
response_asset_positions, aircraft_of_interest, dwell_zones,
politikreds, tier_1_operators }`

**Model.** Deterministic. Loaded from `site_context.js` and refreshed
per site on operator config change.

**Latency budget.** Zero at runtime. Cached in memory at boot.

**Fallback.** Missing site context means the narrative agent falls
back to generic language ("track observed across site sensor
coverage"). Never blocks the pipeline.

**Why offline.** Site context does not need real-time recomputation.
The Copenhagen Airport terminal layout does not change per detection.

---

### Agent 3 · Narrative (Agent B) `[live: mock, planned: Mistral Large 2]`

**Role.** Produces a natural-language analyst-grade summary and
recommendation per event. This is what the receiver reads first.

**Inputs.** Event scaffold from Agent 1, `CorrelationResult`,
`SiteContext`, live NN telemetry snapshot, recording samples if
available.

**Outputs.** `Narrative { body, recommendation, generated_at,
model_version, confidence }`

**Model.** Mistral Large 2 (`mistral-large-2411`), streaming,
sovereign endpoint. Prompt template versioned. Temperature 0.2 for
consistency across similar events.

**Prompt structure.**
```
System: You are an intelligence analyst producing a concise briefing
        for a Danish critical-infrastructure operator. Two short
        paragraphs. Declarative voice. No hedge language, no AI filler.
        Recommendation is one sentence with an action verb.

Context: [site context digest]
Event:   [NN classification + correlation + telemetry snapshot]

Produce: body (max 400 chars), recommendation (max 200 chars).
```

**Latency budget.** 3 seconds for stream start, 8 seconds for full
completion. Streams into the UI as it arrives.

**Fallback.** If Mistral is unreachable or slow, falls back to
`_mockAiSynthesis` deterministic template. Fallback is invisible to
the operator except for the model_version tag.

**Where it runs today.** Mock (`_mockAiSynthesis` in main.js). Real
Mistral wiring is Advance A, blocked on API token.

---

### Agent 4 · Recommendation `[live]`

**Role.** Maps NN classification plus threat plus site rules to a
prioritized list of escalation destinations and playbook steps.

**Inputs.** Event with NN classification, `SiteContext`, active
auto-escalation rules.

**Outputs.** `Recommendation { tiers, destinations, playbook_id,
urgency, override_reason }`

**Recommendation logic.**
- Missile + hostile → all tiers, QRA dispatch pre-authorized
- Hostile fixed-wing + inside perimeter → tiers 1-3, Politi cascade
- Unknown NN class + confidence under 0.60 → tier 1 only, analyst
  review flag
- Friendly ID with valid flight plan → tier 1 audit log only

**Model.** Deterministic rules engine. Rules editable via Config UI
(`rules.js`).

**Latency budget.** Sub-50 ms.

**Fallback.** If no rule matches, defaults to tier 1 escalation and
flags the event for rule authoring.

---

### Agent 5 · Escalation Router `[live]`

**Role.** Dispatches escalations to the destination receivers. Handles
dedup, contact method selection, delivery retries.

**Inputs.** `Recommendation` plus operator-selected destinations from
the escalate modal.

**Outputs.** `EscalationRecord[]` written to `event.escalations`. Each
record is a durable dispatch entry with status history.

**Contact method selection.** Reads `destination.contactMethods` and
picks by urgency: `api` for machine receivers, `phone` for critical
human, `encrypted-email` for standard.

**Dedup.** Skips destinations that already have a record on this
event. Prevents auto-rules and manual escalation from duplicating.

**Model.** Deterministic. `escalateEvent()` in `events.js`.

**Latency budget.** Sub-100 ms per destination.

**Fallback.** Delivery failures log a `SendFailure` and retry via
alternate contact method. Marked in the audit trail.

---

### Agent 6 · Response Coordinator `[live: partial]`

**Role.** Tracks receiver acknowledgements, responses, cascades, and
QRA dispatches. Coordinates multi-receiver state so each receiver
sees what the others have done.

**Inputs.** Receiver actions (ack, respond, cascade, QRA dispatch),
current `EscalationRecord[]`.

**Outputs.** Updates to `event.escalations[].statusHistory` and
`event.escalations[].response`. Fires `ResponseReceived` events for
the operator inbox.

**Cross-receiver visibility (Advance C).** When Politi is looking at
event E, they see PET's ack timestamp and Flyvevåbnet's QRA dispatch
status inline. Not just the operator sees it. Every active receiver
sees every other active receiver's state on the same event.

**Model.** Deterministic. Event-sourced. All state changes append to
`statusHistory`.

**Latency budget.** UI reflection under 250 ms via live-telemetry
patcher.

**Fallback.** Optimistic UI. Ack sent → chip appears immediately. If
delivery fails downstream, chip reverts and a toast surfaces.

---

### Agent 7 · Debrief Synthesizer `[live: partial mock, planned: Mistral Large 2]`

**Role.** Post-event synthesis. Combines trajectory recording, moment
extraction, outlier detection, and asset touch analysis into a
narrative + geospatial callouts.

**Inputs.** Full `EventRecording` (per-drone timeseries),
`SiteContext`, `analysis.touched` assets, `analysis.dwellZones`,
per-drone confidence outliers.

**Outputs.** `DebriefReport { narrative, moments, trajectory_segments,
outlier_flags, asset_touches, exports: {pdf, kml, gpx} }`

**Moment extraction (deterministic today).**
- First sensor contact
- Loiter (top 2 dwell zones over threshold)
- Closest approach (single, under 200 m)
- Level flyby (drone altitude matches asset rooftop height within ±12 m)
- Track lost (last sensor contact)
- Max 10 moments, callouts stagger vertically to avoid overlap

**Outlier detection (deterministic today).** Per-drone mean confidence
compared to pack average. Flags drones running 15+ percentage points
below pack.

**Narrative (planned: Mistral).** Currently `_debriefBuildNarrative`
in main.js. Real Mistral integration in Advance A produces the
analyst paragraph. Deterministic bullets + moments stay
authoritative.

**Latency budget.** Debrief opens instantly with deterministic
skeleton. Mistral narrative streams in over 5-8 seconds.

**Fallback.** Deterministic narrative always renders. Mistral
narrative replaces it when it arrives.

---

## 4. Flow diagrams

### Live-detection flow

```
  [Real sensor node]                     [Mock NN output source]
        |                                          |
        v                                          v
  Neural network                          Synthetic NN output
  (modality processing,                   generator (same schema)
   fusion, classification)                          |
        |                                          |
        +----- NN output stream (~500 ms tick) ----+
                             |
                             v
                    Agent 1 · Correlation
                             |
                    +--------+---------+
                    |                  |
                    v                  v
        (Event scaffold)     Agent 2 · Site Context
                    |                  |
                    +--------+---------+
                             |
                             v
                    Agent 3 · Narrative (Mistral Large 2, streaming)
                             |
                             v
                    Agent 4 · Recommendation
                             |
                             v
                    Agent 5 · Escalation Router
                             |
                             v
              [Receiver inboxes: PET, Politi, Flyvevåbnet, ...]
                             |
                             v
                    Agent 6 · Response Coordinator
                             |
                             v
                    [Operator ledger: acks, responses, cascades]
```

### Post-event flow

```
  Event closes  ---->  _persistRecording (timeseries frozen)
                                |
                                v
                     Agent 7 · Debrief Synthesizer
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
        Deterministic layer         Mistral narrative pass
        (moments, outliers,         (analyst paragraph,
         asset touches, exports)    reasoning about the drift)
                    |                       |
                    +-----------+-----------+
                                v
                    [DebriefReport rendered on map + panel]
                                |
                                v
              [Exports: PDF brief, KML flight path, GPX trail]
```

### Feedback loop (receiver → operator)

```
  Receiver clicks CTA
       |
       +---> Acknowledge  ----> Agent 6 updates statusHistory ----> Operator ledger badge
       |
       +---> Respond      ----> Agent 6 attaches response       ----> Operator ↩ chip + inbox
       |
       +---> Cascade      ----> Agent 5 escalateEvent (with     ----> New EscalationRecord[]
       |                        receiver-role provenance)             visible in audit trail
       |
       +---> QRA dispatch ----> triggerQraIntercept              ----> F-35 icon animates on map
```

---

## 5. Model selection matrix

| Layer | Task | Model | Rationale |
|---|---|---|---|
| Sensor node NN | Modality processing, fusion, classification | Neural network on-node | Real-time signal-level work, must live at the sensor |
| Agent 1 Correlation | Cross-event pattern match | Deterministic | Similarity scores are math, not language |
| Agent 2 Site Context | Knowledge base | Cached deterministic | Zero-latency requirement, no reasoning needed |
| Agent 3 Narrative | Event summary | **Mistral Large 2** | Natural language quality matters, sovereign requirement |
| Agent 4 Recommendation | Route logic | Deterministic rules | Auditable, editable, no black-box risk on dispatch |
| Agent 5 Escalation Router | Dispatch | Deterministic | Send-reliability critical, no room for hallucination |
| Agent 6 Response Coordinator | State machine | Deterministic | Event-sourced audit trail |
| Agent 7 Debrief Synthesizer | Post-event analysis | Deterministic bones + **Mistral Large 2** narrative | Bones are math, story is language |

**Why not one big model.** A single Mistral Large 2 call replacing
agents 4-6 would be cheaper to build. It would also be a single point
of failure for the dispatch decision, and it would erase the audit
trail that lets an operator answer "why did you route this to PET and
not Rigspolitiet."

---

## 6. Deployment topology

Three tiers.

### Edge (sensor node)
- Sensor hardware (RF, acoustic, visual, radar)
- Neural network inference (modality processing, fusion, drone
  classification)
- Local health telemetry
- Emits NN output stream on ~500 ms tick
- Runs on Radxa Rock 4SE or equivalent sensor compute
- Latency budget: sub-500 ms from raw signal to NN output on the wire

### Client (operator + receiver browsers)
- Renders all UI
- Runs the deterministic agent pipeline (Agents 1, 2, 4, 5, 6)
- Holds recording state, timeseries, event registry
- Talks to sovereign backend for Mistral calls (Agents 3, 7 narrative)
- All heavy lifting today (mock NN output source)

### Sovereign backend (planned)
- Mistral Large 2 inference endpoint (EU-hosted)
- Real sensor mesh ingestion (WebSocket + MQTT), consuming NN output
  streams from field nodes
- Persistent event storage with signed evidence hashes
- Cross-site correlation index
- Multi-tenant deployment per customer

---

## 7. Sensor mesh plug-in adapter `[planned: Advance B]`

The critical architectural decision that keeps the platform ready for
real hardware without a rewrite.

### Adapter contract

Every NN output source implements the same interface, whether it is a
mock generator, a WebSocket stream from real sensor nodes in the
field, or a bridge to a customer's existing detection system.

```
interface NnOutputSource {
  // Called on session boot. Adapter reports its sensor node inventory.
  registerNodes(): SensorNodeDescriptor[]

  // Adapter pushes NN detection batches via callback per tick.
  onDetectionTick(callback: (NnDetectionBatch) => void): void

  // Adapter pushes node health updates via callback.
  onNodeHealthChange(callback: (NodeHealthEvent) => void): void

  // Called when platform needs to unsubscribe.
  disconnect(): void
}
```

### Sensor node descriptor

Every node exposes this data regardless of hardware type.

```
SensorNodeDescriptor {
  id: string
  siteId: string
  lat: number
  lon: number
  alt_m: number
  hardware: string           // "Radxa Rock 4SE + HackRF + microphone array"
  modalities: string[]       // ["RF", "Acoustic", "Visual"] — what NN inputs
  nn_model_version: string   // versioned model artifact hash
  tick_ms: number            // typical output cadence
  coverageRadius_m: number
  status: 'online' | 'degraded' | 'offline'
  metadata: object           // vendor-specific extension
}
```

### Migration path

**Phase 1 (today).** `SITES[siteId].sensors` is static data. A single
`MockNnOutputSource` reads it and emits synthetic NN detection
batches per tick. Zero adapter boundary.

**Phase 2 (Advance B).** Extract a `MockNnOutputSource` implementing
the `NnOutputSource` interface. Zero visible change. Adds one layer
of indirection.

**Phase 3 (real hardware).** New `WebSocketNnOutputSource`
implementation consumes streams from field sensor nodes. Registered
alongside mock in config. Real NN outputs flow through the same
downstream agents.

**Phase 4 (multi-source composition).** Multiple NN output sources
active at once. Real hardware in some sites, mock in others (for
continued demo capability). Sources declare which siteIds they own.

### What this unlocks

- Adding a sensor node to a site is a JSON entry in a config file. No
  code.
- Swapping RF hardware vendors is a new adapter. No downstream code
  changes.
- A customer running their own legacy detection system writes an
  adapter that maps their output to our NN detection schema. Their
  existing infra plugs in.
- Testing new NN model versions is done at the adapter layer with
  recorded NN output batches. No platform code touched.

---

## 8. Data contracts (canonical shapes)

The interfaces every agent commits to. Version-locked once a customer
integration ships.

### NnDetectionBatch (platform entry point)
```
{
  sensor_node_id: string
  tick_id: string
  timestamp_utc: ISO8601
  nn_model_version: string
  detections: [
    {
      nn_class: 'quadcopter' | 'fixed-wing' | 'jet' | 'missile' | 'unknown'
      nn_confidence: number 0..1
      lat, lon, alt_m
      heading_deg, speed_ms
      contributing_modalities: string[]
      rf_signature_match: string | null
    }
  ]
  node_health: { cpu_pct, battery_pct, gps_lock_sec, inference_latency_ms }
}
```

### Event (Agent 1 output, mutated by later agents)
```
{
  event_id: string
  site_id: string
  first_seen_utc, last_seen_utc: ISO8601
  nn_class, threat_level, confidence
  contributing_nodes: string[]
  correlation: CorrelationResult
  narrative: Narrative
  recommendation: Recommendation
  escalations: EscalationRecord[]
  recording: EventRecording (post-close)
}
```

### CorrelationResult
```
{
  linked_event_ids: string[]
  similarity_scores: { [event_id]: number }
  cross_site_track: bool
  pattern_flags: string[]  // ['recurring', 'national_pattern', ...]
}
```

### Narrative
```
{
  body: string           // Max 400 chars
  recommendation: string // Max 200 chars, single sentence
  generated_at: ISO8601
  model_version: string  // "mistral-large-2411" | "mock-v1"
  streaming: bool
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}
```

---

## 9. Latency + reliability targets

| Stage | p50 | p99 | Availability target |
|---|---|---|---|
| Raw signal → NN output on the wire (on sensor node) | 400 ms | 800 ms | 99.9% |
| NN output → Correlation (Agent 1) | 80 ms | 300 ms | 99.9% |
| Correlation → Recommendation (Agent 4) | 40 ms | 150 ms | 99.9% |
| Recommendation → Dispatch (Agent 5) | 80 ms | 400 ms | 99.5% |
| Total live path (raw signal → receiver inbox) | **700 ms** | **1.8 s** | 99.5% |
| Narrative first token (Agent 3) | 2.5 s | 8 s | 99% |
| Narrative full completion (Agent 3) | 6 s | 15 s | 99% |
| Debrief render, deterministic bones (Agent 7) | instant | 200 ms | 99.9% |

Narrative failure never blocks dispatch. Deterministic path holds the
99.5% availability floor.

---

## 10. Failure modes + fallbacks

| Failure | Impact | Fallback |
|---|---|---|
| Mistral endpoint unreachable | No AI narrative | `_mockAiSynthesis` deterministic template |
| Single sensor node NN offline | Reduced coverage for that node's footprint | Other nodes' NN outputs continue, event still forms if any other node sees the target |
| Whole site sensor mesh offline | No local detections | Cross-site correlation still detects if track reaches another site |
| NN output schema mismatch on a tick | That tick dropped | Next tick resumes, `SchemaDrop` logged |
| Correlation index stale | No cross-site linking | Event still processes, no linked event advisory |
| Escalation dispatch fails (agency API down) | Destination not notified | Alternate contact method attempted, `SendFailure` logged |
| Receiver browser disconnects | No ack visibility | Escalation stays `sent`, timeout after 15 min triggers operator alert |
| Backend down | UI stays functional (mock NN source), no real sensor updates | Session survives on local cache, warns operator |

---

## 11. Current state vs target state

### What exists today (Aug 2026)

- Agents 2, 4, 5 fully deterministic and running
- Agent 1 partial (mock NN output source drives event lifecycle,
  cross-site correlation heuristics wired but not exercised at scale)
- Agent 3 mock (`_mockAiSynthesis`)
- Agent 6 partial (single-receiver flows wired, multi-receiver
  coordination pending Advance C)
- Agent 7 deterministic layer complete, narrative is mock
- No sovereign backend, all data client-side
- NN output source is synthetic, driven by
  `sites.js` + `sites_energinet.js` + scenario scripts

### What Advance A delivers (Mistral wiring)

- Agent 3 real Mistral Large 2 streaming
- Agent 7 narrative uses real Mistral
- Fallback to mock preserved
- Model version tag in every generated artifact

### What Advance B delivers (NN output source adapter)

- `NnOutputSource` interface extracted
- `MockNnOutputSource` implementing the interface (zero visible
  change)
- `WebSocketNnOutputSource` skeleton for real hardware
- Config-driven sensor node registration
- Live health stream (node.status flips on heartbeat)

### What Advance C delivers (multi-receiver coordination)

- Agent 6 fully realized
- Cross-receiver visibility on shared events
- Receiver-side timeline showing other receivers' actions
- Coordination indicator on operator ledger

### Roadmap beyond Advances A + B + C

- Sovereign backend deployment (Mistral inference, event storage,
  correlation index)
- Signed evidence links with chain-of-custody hashes
- KML / GPX / PDF exports from Debrief Agent
- Threat library expansion (more scenario templates)
- Real hardware pilot: DTI sensor mesh integration via Advance B
  adapter

---

## 12. Design decisions we have already committed to

**Cesium as the geospatial engine.** SDFI 2D default over Denmark,
gated 3D toggle branching on the CPH bbox to Google Photoreal in the
metro area and paid EU providers outside. Never Google/Vantar/Cesium
ion for government tenants.

**IBM Plex Mono for machine-readable text.** Every ID, timestamp,
coordinate, and confidence value uses tabular-nums. Body copy uses
the body font.

**Palantir-esque visual language.** Dark backgrounds, subtle white
borders, accent-color 3px left-stripes for state and grouping, mono
labels with wide letter-spacing. Reads as operations-grade, not
consumer software.

**No em-dashes, no semicolons, no AI filler in any human-facing
text.** Founder writing voice. Applies to narratives generated by
Mistral too (enforced by prompt).

**Æøå everywhere.** Never substitute with `ae`, `oe`, `o`.

**Detection-only positioning.** ISR provides intelligence, government
responds. Never framed as counter-drone, anti-drone, or kinetic.

---

## 13. Open questions

- **Prompt versioning for Mistral.** Do we version prompts per-agent
  in a git-tracked file and stamp `prompt_version` on every generated
  artifact? Recommend yes.
- **Rate limiting for Mistral calls.** At scale, one narrative per
  event across all customers could hit rate limits. Batch strategy?
  Priority queue?
- **Correlation index refresh cadence.** Currently per-request. At
  scale, precomputed and incrementally updated?
- **Multi-tenant boundary.** Each customer sees only their events.
  Cross-customer correlation for national-level pattern detection is
  a future capability that needs an explicit contract.
- **NN output source security.** Real sensor nodes push NN detection
  batches as trusted. Attestation strategy for field hardware?
- **NN model version drift.** Different sensor nodes may run
  different NN model versions. How does the platform reconcile
  cross-version confidence scores?

---

*Last updated 2026-08-11. Living document, updated as Advances land.*
