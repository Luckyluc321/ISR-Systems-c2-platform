# ISR Systems · Agentic Architecture

Design reference for the multi-agent pipeline that turns raw sensor
returns into operator-actionable intelligence and back into coordinated
response.

Current version reflects target state. Sections marked `[live]` are
implemented today. Sections marked `[planned]` are next.

---

## 1. Design principles

**Deterministic where lives are on the line, generative where nuance is
what an analyst adds.**

Classification, threat scoring, and dispatch routing are deterministic.
Failure of these paths must never depend on a language model responding.
Narrative synthesis, dwell interpretation, and outlier explanation are
generative. Failure there degrades to a shorter deterministic summary.

**Every agent has one job.**

Ten small agents beat one large one. Small agents can be swapped, cached,
retried, and reasoned about independently. Each agent has a defined
input contract, output contract, latency budget, and failure fallback.

**Sovereign by default.**

All model inference runs on EU-hosted infrastructure. Mistral Large 2 on
Scaleway or OVH for the heavy narrative work. Mistral 7B fine-tune on
local edge for latency-critical fusion. Zero calls to US-hosted models.

**Data provenance is a first-class artifact.**

Every derived value carries its lineage: which sensor produced the raw
reading, which agent transformed it, at what model version, at what
timestamp. Not for compliance theater. For the moment an operator asks
"why did the platform say hostile" and gets a real answer.

**Additive, not replacing.**

Real hardware plugs into the same downstream pipeline mock data uses
today. The boundary between "data source" and "platform logic" is a
single adapter interface, not a rewrite.

---

## 2. Agent inventory

Ten agents. Numbered by their position in the live-detection flow. Not
all fire on every event.

### Agent 1 · Ingestion `[live: partial]`

**Role.** Normalizes raw multi-modality sensor data into a uniform
detection event schema. Handles heartbeat, health, timestamp
reconciliation, and coordinate frame conversion.

**Inputs.**
- RF spectrum snapshots (2.4 GHz, 5.8 GHz, sub-GHz, Ku band, ADS-B)
- Acoustic signatures (peak dB, dominant Hz, harmonic profile)
- Visual matches (SVM confidence, model hash, bounding box)
- Radar returns (Doppler bin, RCS, range gate)
- Sensor health telemetry (CPU, battery, GPS lock, network RTT)

**Outputs.** `RawDetectionEvent { sensorId, timestamp, modality,
raw_payload, health_snapshot }`

**Model.** Deterministic. Rules-based normalizer.

**Latency budget.** Sub-100 ms per event. No inference call.

**Fallback.** If a sensor goes dark for more than 30 seconds, ingestion
emits a `SensorHealthAlert` and downstream agents proceed with the
remaining mesh coverage.

**Sensor plug-in contract.** Any real sensor implements one of the
supported modality adapters. Adding a new sensor type means adding one
adapter, not touching downstream code.

---

### Agent 2 · Fusion `[live: partial]`

**Role.** Cross-references detection events from multiple sensors within
a spatial-temporal window. Produces a fused `Contact` with weighted
confidence.

**Inputs.** Stream of `RawDetectionEvent` from Agent 1.

**Outputs.** `FusedContact { contactId, lat, lon, alt, heading, speed,
modality_agreement, contributing_sensors, confidence, timestamp }`

**Fusion window.** 500 ms sliding. Sensors within 1500 m horizontal and
100 m vertical of each other's returns get fused into a single contact.

**Confidence weighting.**
- RF match to known signature: 0.35 weight
- Acoustic match: 0.20 weight
- Visual match: 0.25 weight
- Radar return: 0.20 weight
- Boost 1.15x per additional sensor confirming
- Cap at 0.98

**Model.** Deterministic kinematic filter. Consideration for a light
Mistral 7B pass on ambiguous cases in a future phase, but not needed
for MVP.

**Latency budget.** Under 200 ms per fusion cycle.

**Fallback.** If only one modality reports, downstream classification
still runs but flags `single_modality: true` and caps confidence at
0.65.

---

### Agent 3 · Classification `[live]`

**Role.** Assigns platform type (quadcopter, fixed-wing, jet, missile,
non-identifiable) and threat level (low, medium, high) to each fused
contact.

**Inputs.** `FusedContact` plus historical signature database.

**Outputs.** `Classification { platform, threat, threat_reason,
classification_confidence, rf_match_source }`

**Model.** Deterministic signature lookup first. If no match, hand off
to Mistral 7B fine-tune for provisional classification with an
`analyst_review_required` flag.

**Latency budget.** 100 ms for signature hit, 800 ms for model
inference on unmatched.

**Fallback.** Unmatched contacts classify as `non-identifiable` with a
0.5 confidence. Never blocks downstream escalation.

---

### Agent 4 · Correlation `[live: partial]`

**Role.** Cross-references the new event against historical events and
concurrent active events across all sites. Detects repeat signatures,
cross-border tracks, and coordinated multi-site incursions.

**Inputs.** New `Classification` plus the full EVENTS registry.

**Outputs.** `CorrelationResult { linked_event_ids, similarity_scores,
cross_site_track, pattern_flags }`

**Correlation heuristics.**
- Same RF fingerprint at another site within 4 hours → cross-site track
- Same platform class at same site within 90 days → recurring incursion
- More than 3 similar events across the country in 30 days → national
  pattern flag

**Model.** Deterministic scoring. Signature match plus temporal
proximity plus spatial connectivity.

**Latency budget.** Sub-300 ms per event.

**Fallback.** Correlation is advisory. Missing correlation never blocks
escalation, only enriches the narrative.

---

### Agent 5 · Site Context (Agent A) `[live]`

**Role.** Maintains a per-site knowledge base of critical assets,
response asset positions, aircraft of interest, dwell zones,
perimeter geometry, and jurisdictional coverage.

**Inputs.** Site definition files, response asset registries, ATC / port
authority feeds.

**Outputs.** `SiteContext { site_id, critical_areas, high_value_assets,
response_asset_positions, aircraft_of_interest, dwell_zones,
politikreds, tier_1_operators }`

**Model.** Deterministic. Loaded from `site_context.js` and refreshed
per site on operator config change.

**Latency budget.** Zero at runtime. Cached in memory at boot.

**Fallback.** Missing site context means the narrative agent falls back
to generic language ("track observed across site sensor coverage").
Never blocks the pipeline.

**Why offline.** Site context does not need real-time recomputation.
The Copenhagen Airport terminal layout does not change per detection.

---

### Agent 6 · Narrative (Agent B) `[live: mock, planned: Mistral Large 2]`

**Role.** Produces a natural-language analyst-grade summary and
recommendation per event. This is what the receiver reads first.

**Inputs.** `Classification`, `CorrelationResult`, `SiteContext`, live
telemetry snapshot, recording samples if available.

**Outputs.** `Narrative { body, recommendation, generated_at,
model_version, confidence }`

**Model.** Mistral Large 2 (`mistral-large-2411`), streaming, sovereign
endpoint. Prompt template versioned. Temperature 0.2 for consistency
across similar events.

**Prompt structure.**
```
System: You are an intelligence analyst producing a concise briefing
        for a Danish critical-infrastructure operator. Two short
        paragraphs. Declarative voice. No hedge language, no AI filler.
        Recommendation is one sentence with an action verb.

Context: [site context digest]
Event:   [classification + correlation + telemetry]

Produce: body (max 400 chars), recommendation (max 200 chars).
```

**Latency budget.** 3 seconds for stream start, 8 seconds for full
completion. Streams into the UI as it arrives.

**Fallback.** If Mistral is unreachable or slow, falls back to
`_mockAiSynthesis` deterministic template. Fallback is invisible to
the operator except for the model_version tag.

**Where it runs today.** Mock (`_mockAiSynthesis` in main.js line 10119).
Real Mistral wiring is Advance A, blocked on API token.

---

### Agent 7 · Recommendation `[live]`

**Role.** Maps classification plus threat plus site rules to a
prioritized list of escalation destinations and playbook steps.

**Inputs.** `Classification`, `SiteContext`, active auto-escalation
rules.

**Outputs.** `Recommendation { tiers, destinations, playbook_id,
urgency, override_reason }`

**Recommendation logic.**
- Missile + hostile → all tiers, QRA dispatch pre-authorized
- Hostile fixed-wing + inside perimeter → tiers 1-3, Politi cascade
- Non-identifiable + confidence under 0.60 → tier 1 only, analyst
  review flag
- Friendly ID with valid flight plan → tier 1 audit log only

**Model.** Deterministic rules engine. Rules editable via Config UI
(`rules.js`).

**Latency budget.** Sub-50 ms.

**Fallback.** If no rule matches, defaults to tier 1 escalation and
flags the event for rule authoring.

---

### Agent 8 · Escalation Router `[live]`

**Role.** Actually dispatches escalations to the destination
receivers. Handles dedup, contact method selection, delivery retries.

**Inputs.** `Recommendation` plus operator-selected destinations from
the escalate modal.

**Outputs.** `EscalationRecord[]` written to `event.escalations`. Each
record is a durable dispatch entry with status history.

**Contact method selection.** Reads `destination.contactMethods` and
picks by urgency: `api` for machine receivers, `phone` for critical
human, `encrypted-email` for standard.

**Dedup.** Skips destinations that already have a record on this event.
Prevents auto-rules and manual escalation from duplicating.

**Model.** Deterministic. `escalateEvent()` in `events.js`.

**Latency budget.** Sub-100 ms per destination.

**Fallback.** Delivery failures log a `SendFailure` and retry via
alternate contact method. Marked in the audit trail.

---

### Agent 9 · Response Coordinator `[live: partial]`

**Role.** Tracks receiver acknowledgements, responses, cascades, and
QRA dispatches. Coordinates multi-receiver state so each receiver sees
what the others have done.

**Inputs.** Receiver actions (ack, respond, cascade, QRA dispatch),
current `EscalationRecord[]`.

**Outputs.** Updates to `event.escalations[].statusHistory` and
`event.escalations[].response`. Fires `ResponseReceived` events for
operator inbox.

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

### Agent 10 · Debrief Synthesizer `[live: partial mock, planned: Mistral Large 2]`

**Role.** Post-event synthesis. Combines trajectory recording, moment
extraction, outlier detection, and asset touch analysis into a
narrative + geospatial callouts.

**Inputs.** Full `EventRecording` (per-drone timeseries), `SiteContext`,
`analysis.touched` assets, `analysis.dwellZones`, per-drone confidence
outliers.

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

**Narrative (planned: Mistral).** Currently `_debriefBuildNarrative` in
main.js. Real Mistral integration in Advance A produces the analyst
paragraph. Deterministic bullets + moments stay authoritative.

**Latency budget.** Debrief opens instantly with deterministic
skeleton. Mistral narrative streams in over 5-8 seconds.

**Fallback.** Deterministic narrative always renders. Mistral narrative
replaces it when it arrives.

---

## 3. Flow diagrams

### Live-detection flow

```
  [Real sensors]                            [Mock data source]
       |                                            |
       +----------- Sensor adapter layer -----------+
                             |
                             v
                    Agent 1 · Ingestion
                             |
                             v
                    Agent 2 · Fusion
                             |
                             v
                    Agent 3 · Classification
                             |
                    +--------+---------+
                    |                  |
                    v                  v
        Agent 4 · Correlation   Agent 5 · Site Context
                    |                  |
                    +--------+---------+
                             |
                             v
                    Agent 6 · Narrative (Mistral Large 2, streaming)
                             |
                             v
                    Agent 7 · Recommendation
                             |
                             v
                    Agent 8 · Escalation Router
                             |
                             v
              [Receiver inboxes: PET, Politi, Flyvevåbnet, ...]
                             |
                             v
                    Agent 9 · Response Coordinator
                             |
                             v
                    [Operator ledger: acks, responses, cascades]
```

### Post-event flow

```
  Event closes  ---->  _persistRecording (timeseries frozen)
                                |
                                v
                     Agent 10 · Debrief Synthesizer
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
       +---> Acknowledge  ----> Agent 9 updates statusHistory ----> Operator ledger badge
       |
       +---> Respond      ----> Agent 9 attaches response       ----> Operator ↩ chip + inbox
       |
       +---> Cascade      ----> Agent 8 escalateEvent (with     ----> New EscalationRecord[]
       |                        receiver-role provenance)             visible in audit trail
       |
       +---> QRA dispatch ----> triggerQraIntercept              ----> F-35 icon animates on map
```

---

## 4. Model selection matrix

| Agent | Task | Model | Rationale |
|---|---|---|---|
| 1 Ingestion | Normalize | Deterministic | Rules-based, sub-100 ms, no ambiguity |
| 2 Fusion | Cross-modal | Deterministic + Mistral 7B (ambiguous cases, phase 2) | Kinematic filter handles 95% deterministically |
| 3 Classification | Signature match | Deterministic + Mistral 7B fine-tune (unmatched) | Known signatures are lookup; unknowns benefit from generalist |
| 4 Correlation | Pattern match | Deterministic | Similarity scores are math, not language |
| 5 Site Context | Knowledge base | Cached deterministic | Zero-latency requirement, no reasoning needed |
| 6 Narrative | Event summary | **Mistral Large 2** | Natural language quality matters; sovereign requirement |
| 7 Recommendation | Route logic | Deterministic rules | Auditable, editable, no black-box risk on dispatch |
| 8 Escalation Router | Dispatch | Deterministic | Send-reliability critical, no room for hallucination |
| 9 Response Coordinator | State machine | Deterministic | Event-sourced audit trail |
| 10 Debrief Synthesizer | Post-event analysis | Deterministic bones + **Mistral Large 2** narrative | Bones are math, story is language |

**Why not one big model.** A single Mistral Large 2 call replacing
agents 3-7 would be cheaper to build. It would also be a single point
of failure for the dispatch decision, and it would erase the audit
trail that lets an operator answer "why did you route this to PET and
not Rigspolitiet."

---

## 5. Deployment topology

Three tiers.

### Edge (sensor + local compute)
- Sensor firmware
- Ingestion adapter (Agent 1)
- Local fusion filter for burst-suppression before uplink
- Runs on Radxa Rock 4SE or equivalent sensor compute
- Latency budget: sub-50 ms sensor-to-ingestion

### Client (operator + receiver browsers)
- Renders all UI
- Runs the deterministic pipeline (Agents 2-5, 7-9)
- Holds recording state, timeseries, event registry
- Talks to sovereign backend for Mistral calls only
- All heavy lifting today (mock data source)

### Sovereign backend (planned)
- Mistral Large 2 inference endpoint (EU-hosted)
- Real sensor mesh ingestion (WebSocket + MQTT)
- Persistent event storage with signed evidence hashes
- Cross-site correlation index
- Multi-tenant deployment per customer

---

## 6. Sensor mesh plug-in adapter `[planned: Advance B]`

The critical architectural decision that keeps the platform ready for
real hardware without a rewrite.

### Adapter contract

Every sensor data source implements the same interface, whether it is
a mock generator, a WebSocket stream from real hardware, or a legacy
XML dump from a customer's existing system.

```
interface SensorSource {
  // Called on session boot. Adapter reports its sensor inventory.
  registerSensors(): SensorDescriptor[]

  // Adapter pushes detection events via callback as they arrive.
  onDetection(callback: (RawDetectionEvent) => void): void

  // Adapter pushes health updates via callback.
  onHealthChange(callback: (SensorHealthEvent) => void): void

  // Called when platform needs to unsubscribe.
  disconnect(): void
}
```

### Sensor descriptor

Every sensor exposes this data regardless of hardware type.

```
SensorDescriptor {
  id: string
  siteId: string
  lat: number
  lon: number
  alt_m: number
  hardware: string           // "Radxa Rock 4SE + HackRF"
  modalities: string[]       // ["RF", "Acoustic", "Visual"]
  coverageRadius_m: number
  status: 'online' | 'degraded' | 'offline'
  metadata: object           // vendor-specific extension
}
```

### Migration path

**Phase 1 (today).** `SITES[siteId].sensors` is static data. A single
`MockSensorSource` reads it and emits synthetic detection events per
tick. Zero adapter boundary.

**Phase 2 (Advance B).** Extract a `MockSensorSource` implementing the
`SensorSource` interface. Zero visible change. Adds one layer of
indirection.

**Phase 3 (real hardware).** New `WebSocketSensorSource` implementation
consumes streams from field hardware. Registered alongside mock in
config. Real detection events flow through the same downstream agents.

**Phase 4 (multi-source composition).** Multiple sensor sources active
at once. Real hardware in some sites, mock in others (for continued
demo capability). Sources declare which siteIds they own.

### What this unlocks

- Adding a sensor to a site is a JSON entry in a config file. No code.
- Swapping RF hardware vendors is a new adapter. No downstream code
  changes.
- A customer running their own legacy sensor mesh writes an adapter
  and ships. Their existing infra plugs in.
- Testing new detection algorithms is done at the adapter layer with
  recorded RawDetectionEvents. No platform code touched.

---

## 7. Data contracts (canonical shapes)

The interfaces every agent commits to. Version-locked once a customer
integration ships.

### RawDetectionEvent
```
{
  event_id: string
  sensor_id: string
  timestamp_utc: ISO8601
  modality: 'rf' | 'acoustic' | 'visual' | 'radar'
  payload: {
    // modality-specific — see below
  }
  health: { cpu_pct, battery_pct, gps_lock_sec }
}
```

### FusedContact
```
{
  contact_id: string
  timestamp_utc: ISO8601
  lat, lon, alt_m
  heading_deg, speed_ms, climb_rate_ms
  contributing_sensors: [{ id, confidence, modality }]
  modality_agreement: 'all' | 'partial' | 'single'
  confidence: number 0..1
}
```

### Classification
```
{
  platform: 'quadcopter' | 'fixed-wing' | 'jet' | 'missile' | 'non-identifiable'
  threat: 'low' | 'medium' | 'high'
  threat_reason: string
  classification_confidence: number
  rf_match_source: string  // "OcuSync 91%" | null
  analyst_review_required: bool
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

## 8. Latency + reliability targets

| Stage | p50 | p99 | Availability target |
|---|---|---|---|
| Sensor → Ingestion | 40 ms | 150 ms | 99.9% |
| Ingestion → Fusion | 80 ms | 300 ms | 99.9% |
| Fusion → Classification | 60 ms | 250 ms | 99.9% |
| Classification → Recommendation | 30 ms | 100 ms | 99.9% |
| Recommendation → Dispatch | 80 ms | 400 ms | 99.5% |
| Total live-detection path (sensor → receiver inbox) | **300 ms** | **1.2 s** | 99.5% |
| Narrative first token | 2.5 s | 8 s | 99% |
| Narrative full completion | 6 s | 15 s | 99% |
| Debrief render (deterministic bones) | instant | 200 ms | 99.9% |

Narrative failure never blocks dispatch. Deterministic path holds the
99.5% availability floor.

---

## 9. Failure modes + fallbacks

| Failure | Impact | Fallback |
|---|---|---|
| Mistral endpoint unreachable | No AI narrative | `_mockAiSynthesis` deterministic template |
| Single sensor offline | Reduced modality agreement | Fusion continues with remaining sensors, flags `single_modality` |
| Whole site sensor mesh offline | No local detections | Cross-site correlation still detects if track reaches another site |
| Correlation index stale | No cross-site linking | Event still processes, no linked event advisory |
| Escalation dispatch fails (agency API down) | Destination not notified | Alternate contact method attempted, `SendFailure` logged |
| Receiver browser disconnects | No ack visibility | Escalation stays `sent`, timeout after 15 min triggers operator alert |
| Backend down | UI stays functional (mock data source), no real sensor updates | Session survives on local cache, warns operator |

---

## 10. Current state vs target state

### What exists today (Aug 2026)

- Agents 3, 5, 7, 8 fully deterministic and running
- Agents 1, 2, 4 partial (mock data source, deterministic logic wired)
- Agent 6 mock (`_mockAiSynthesis`)
- Agent 9 partial (single-receiver flows wired, multi-receiver
  coordination pending Advance C)
- Agent 10 deterministic layer complete, narrative is mock
- No sovereign backend, all data client-side
- Sensor data is static in `sites.js` + `sites_energinet.js`

### What Advance A delivers (Mistral wiring)

- Agent 6 real Mistral Large 2 streaming
- Agent 10 narrative uses real Mistral
- Fallback to mock preserved
- Model version tag in every generated artifact

### What Advance B delivers (sensor adapter)

- `SensorSource` interface extracted
- `MockSensorSource` implementing the interface (zero visible change)
- `WebSocketSensorSource` skeleton for real hardware
- Config-driven sensor registration
- Live health stream (sensor.status flips on heartbeat)

### What Advance C delivers (multi-receiver coordination)

- Agent 9 fully realized
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

## 11. Design decisions we have already committed to

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

**No em-dashes, no semicolons, no AI filler in any human-facing text.**
Founder writing voice. Applies to narratives generated by Mistral too
(enforced by prompt).

**Æøå everywhere.** Never substitute with `ae`, `oe`, `o`.

**Detection-only positioning.** ISR provides intelligence, government
responds. Never framed as counter-drone, anti-drone, or kinetic.

---

## 12. Open questions

- **Prompt versioning for Mistral.** Do we version prompts per-agent
  in a git-tracked file and stamp `prompt_version` on every generated
  artifact? Recommend yes.
- **Rate limiting for Mistral calls.** At scale, one narrative per
  event across all customers could hit rate limits. Batch strategy?
  Priority queue?
- **Correlation index refresh cadence.** Currently per-request. At
  scale, precomputed and incrementally updated?
- **Multi-tenant boundary.** Each customer sees only their events. Cross-
  customer correlation for national-level pattern detection is a
  future capability that needs an explicit contract.
- **Adapter security.** Real sensor adapters accept detection events
  as trusted. Attestation strategy for field hardware?

---

*Last updated 2026-08-11. Living document, updated as Advances land.*
