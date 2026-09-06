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

## Three-stage transformation

### Stage 1: Signature → family classification

Input: `{ modality, signature_vector, nn_confidence }` per detection.
Output: `{ family, family_confidence, alternates: [{family, confidence}] }`.

Classification is a lookup against a **signature library** — a partner-curated (or vendor-supplied) mapping from signature clusters to human-labelled drone families. Libraries evolve over time; the bridge treats them as versioned data.

**Signature library layout (proposed):**

```
conf/signatures/
  rf/
    library.json               # frequency + hop patterns → family label
    version.txt                # SIGNATURE_LIBRARY_VERSION for cache invalidation
  acoustic/
    library.json               # RPM band + harmonic profile → family label
    version.txt
  visual/
    library.json               # visual embedding cluster → family label
    version.txt
```

Version bumps invalidate any cached classifications the way `DIGEST_VERSION` bumps invalidate Agent A digests. Partners can update libraries without code deploy.

**Family taxonomy:** family, not model. `"commercial FHSS quadcopter"` beats `"DJI Mavic 3"` when the NN can only distinguish family-level clusters. Model-level identification is a future capability.

### Stage 2: Per-modality narrative synthesis

Rules engine (not LLM) writes structured English per modality contribution. Deterministic templates keyed on family + measured parameters.

Example outputs:

- **RF:** `"Frequency-hopping spread spectrum in the 2.4 GHz ISM band. Dwell pattern consistent with commercial FHSS quadcopter class. Signal strength -68 dBm, direction-of-arrival stable at 145 degrees."`
- **Acoustic:** `"Four-rotor signature detected. RPM band 5-8 kHz, harmonic profile consistent with sub-2kg airframe. Confidence 0.71."`
- **Visual:** `"Quadcopter silhouette, wingspan estimate 40-60 cm. Camera pointing anomaly not detected."`

Rules live in `src/signature_bridge.js` as pure functions keyed on `(family, modality, measurements) → narrative string`. New families ship as new template entries plus library additions.

### Stage 3: Confidence-tiered language wrapper

Consistent phrasing for uncertainty so Agent B doesn't invent certainty the signals don't support.

| Confidence | Phrasing |
|---|---|
| `>= 0.85` | "identified as X" |
| `0.55 - 0.85` | "consistent with X family" |
| `0.30 - 0.55` | "closest match X, weak signal, alternates present" |
| `< 0.30` | "unclassified, [top 3 candidates listed]" |

Same wrapper regardless of modality. Confidence values come from Stage 1's `family_confidence`.

## Contract with downstream

`signature_bridge.js` emits a **SignatureBridgeOutput** consumed by `preprocessing.js`:

```
{
  detectionId: string,
  perModality: {
    rf?:       { family, family_confidence, alternates, narrative },
    acoustic?: { family, family_confidence, alternates, narrative },
    visual?:   { family, family_confidence, alternates, narrative },
  },
  fused: {                        // cross-modality reconciliation
    family: string,               // consensus family, or "conflicting"
    family_confidence: number,    // fused confidence
    dissent: string[],            // modalities that disagree with the consensus
  },
  library_versions: {             // stamped so downstream cache keys stay stable
    rf: string, acoustic: string, visual: string,
  },
}
```

`preprocessing.js` then folds this into the `STRUCTURED SIGNAL BLOCK` and `INTERPRETED SIGNAL PROSE` that Agent B already consumes today.

## Why this shape

- **Partner-updatable libraries** — new drones ship as data, not code deploys.
- **Version stamping** — cache invalidation is deterministic. Same data → same output → same cached narrative.
- **Family, not model** — matches what the NN can actually output, avoids overclaiming.
- **Confidence-tiered phrasing** — Agent B never sees a raw float that lets it invent false precision.
- **Per-modality dissent surfaced** — cross-modality contradictions (RF says quadcopter, visual says fixed-wing) become visible to the LLM instead of silently averaged into confusion.
- **Deterministic** — every field is testable in the eval harness (see `docs/agentic-eval-architecture.md`).

## When to build

Trigger: first field-hardware NN starts emitting real signature vectors that a customer or partner needs the platform to reason about. Until then, the mock NN source in `src/nn_source.js` produces family-labelled synthetic detections directly (no bridge needed).

At build time, the library JSON files come from one of:
- Partner delivery (Netcompany, DTU, vendor-supplied)
- Field-data self-supervised clustering (later, when there's enough data)
- Third-party threat intelligence subscription (paid)

## Related

- `docs/agentic-preprocessing-architecture.md` — the deterministic layer this bridge feeds.
- `docs/agentic-architecture.md` §Agent B — the LLM consumer.
- `docs/nn-adapter-explainer.md` — the `NnOutputSource` seam the raw signatures come through.
- Memory: `azure-final-destination` — signature libraries eventually live in Azure Blob or Cosmos, not client-side.
