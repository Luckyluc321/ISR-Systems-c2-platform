# Signature Bridge Architecture (planning, not yet built)

**Status:** `[planned]` — designed 2026-09-05. Deferred until the first real NN plugs in and starts emitting numeric signatures. This document exists so future work doesn't re-derive the pattern.

## Problem

The neural network on the sensor node outputs **numeric signatures** — RF spectral fingerprints, acoustic feature vectors, visual embedding vectors — plus per-modality confidence scores. It does NOT output human-readable drone model names, and won't for a long time. The model catalog is grown from field data over months and years.

Feeding raw floats to Agent B is useless. It cannot reason on `acoustic_vector: [0.42, 0.18, 0.91, ...]`. It needs structured English about what the sensor mesh actually detected.

The **signature bridge** is the deterministic preprocessing layer that translates numeric NN output into narrative signals the LLM can reason on.

## Where it sits

```
Sensor node NN
   ↓  (numeric signatures + confidences per modality)
signature_bridge.js         [PLANNED — this doc]
   ↓  (family classification + alternates + confidence tier)
preprocessing.js            [live — approach vectors, z-scores, formation cohesion]
   ↓  (STRUCTURED SIGNAL BLOCK + INTERPRETED SIGNAL PROSE)
agent_b_debrief.js / agent_case_file.js
   ↓
Mistral narrative
```

The bridge is a peer of `preprocessing.js`, sitting one stage upstream. Both are deterministic. The LLM sees the output of both, never raw NN floats.

## The adapter

`bridgeSignature(input)` — single entry point. Given the NN's classification output for one detection, it looks up the family in the reference library and returns an enrichment envelope.

### Input (from the NN adapter)

```
{
  detection_id?: string,
  nn_family: string,               // e.g. 'shahed-loitering-munition'
  nn_confidence: number,           // [0, 1]
  candidate_models?: [{ id, score }],
  raw_signature?: {                // optional; used for signature_hash + future elaboration
    rf?:       { carrier_hz?, bandwidth_hz?, modulation? },
    acoustic?: { fundamental_hz?, profile? },
    visual?:   { silhouette? },
    radar?:    { ... },
  },
}
```

### Output (enrichment envelope)

```
{
  detection_id,
  family_label,                    // NN passthrough
  family_confidence,               // NN passthrough
  family_metadata: {               // lookup from FAMILY_LIBRARY[family_label]
    display_name,
    threat_level,                  // 'low' | 'medium' | 'high' | 'critical'
    escalation_posture,            // e.g. 'immediate-national-tier'
    response_time_secs,
    recommended_observers: [...],
    dispatch_hint,
    attribution_elaboration: [...],
    typical_kinematics: { cruise_speed_ms, cruise_altitude_m, endurance_min } | null,
  },
  candidate_models,                // NN passthrough + family_context annotation
  attribution_hints,               // = family_metadata.attribution_elaboration
  signature_hash,                  // FNV-1a over canonicalised raw_signature, or null
  source: 'nn' | 'nn-off-list' | 'malformed',
}
```

### Family reference library (`src/families.js`)

12 canonical families. Each carries the metadata bundle above. The library is intentionally decoupled from the adapter — new drone families ship as pure data edits, no code deploy. Partner-editable path.

**Off-list handling:** if the NN emits a family label the library doesn't know, the adapter returns `UNKNOWN` metadata with `source: 'nn-off-list'`. Never fabricates a family. Operator manual reclassification is the path forward — the NN is the classifier and it hit a gap in the library.

**Malformed / missing input:** returns `UNKNOWN` with `source: 'malformed'` or `'nn'`. Never throws. The adapter is non-blocking for the downstream event pipeline.

**No rule-based fallback.** If the NN doesn't classify, C2 does not guess. This is the whole point of the reshape.

### Signature hash

Deterministic FNV-1a 32-bit over a canonicalised (key-sorted JSON) serialisation of `raw_signature`. Precedent retrieval groups detections by hash to find historical repeats. If `raw_signature` is absent, the hash is `null` and precedent retrieval skips grouping for that detection but enrichment still lands.

## What Agent B and the receiver lens consume

`bridgeSignature`'s output feeds three downstream consumers:

1. **`preprocessing.js` → Agent B debrief narrative** — reads `family_metadata` to shape doctrine references, `attribution_elaboration` to seed the "what platform is this" prose, and `signature_hash` to key the debrief-narrative cache alongside the signal hash.
2. **`agent_b_lens.js` receiver-lens narratives** — reads `family_metadata.recommended_observers` for cascade suggestions per archetype, and `attribution_elaboration` to enrich the intelligence-attribution lens.
3. **Chapter attribution sub-section** (`report_subsections.js` intel archetype) — reads `attribution_hints` verbatim as bullet points under the intelligence-attribution renderer.

None of these consumers see the NN's raw signature floats. They see the enriched envelope, keyed by the family label the NN chose.

## Why this shape

- **NN owns classification, C2 owns enrichment.** No overlap, no rule-based fallback pretending to classify.
- **Partner-editable library.** Threat level per family or a new family entry ships as a data edit — governance without code deploy.
- **Non-blocking.** Adapter never throws; malformed input returns UNKNOWN. The event pipeline can't stall on a signature-bridge failure.
- **Cacheable.** Every enrichment result is a deterministic function of `(nn_family, nn_confidence, raw_signature)`. Precedent retrieval indexes by `signature_hash` for repeat detections.
- **Auditable off-list rate.** When live-wired, a boot audit will surface how many detections hit `nn-off-list` in the previous session — the signal for "NN is emitting labels the library doesn't yet know."

## When to wire into the live path

The adapter is dev-handle only today (`window.__isr_signature`). Live-path integration fires when the first field-hardware NN starts emitting real classification output that a customer or partner needs the platform to enrich. Until then, the mock NN source in `src/nn_source.js` emits family-labelled synthetic detections that don't need the enrichment loop.

Family metadata (in `src/families.js`) grows from one of:
- Partner delivery (Netcompany, DTU, vendor-supplied family definitions)
- Field-data self-supervised clustering (later, when there's enough real detections to cluster)
- Third-party threat intelligence subscription (paid)

The library is deliberately versionable as data (not code). Partners can update `threat_level` for a family, or add a new family entry, without touching the adapter logic. When Azure infra is provisioned, the library moves to Azure Blob / Cosmos and is refreshed via a governed pull (versioned, signed).

## Related

- `docs/agentic-preprocessing-architecture.md` — the deterministic layer this bridge feeds.
- `docs/agentic-architecture.md` §Agent B — the LLM consumer.
- `docs/nn-adapter-explainer.md` — the `NnOutputSource` seam the raw signatures come through.
- Memory: `azure-final-destination` — signature libraries eventually live in Azure Blob or Cosmos, not client-side.
