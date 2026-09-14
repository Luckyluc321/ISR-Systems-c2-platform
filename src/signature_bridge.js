// ═══════════════════════════════════════════════════════════════════
// Signature bridge — NN output → reference library adapter
// ───────────────────────────────────────────────────────────────────
// SCOPE (per feedback_c2_not_classifier): the C2 platform does NOT
// classify signatures. The neural network is the classifier. This
// module reads what the NN already labeled and looks up that label
// in the family reference library (src/families.js) to attach the
// response profile, precedent-context stubs, and attribution
// elaboration that C2 owns.
//
// The historical rule-based implementation (10 raw-signature rules
// with family voting) is archived at src/_legacySignatureBridgeRules.js.
// It was wrong scope — classifier work that duplicated the NN's job.
// Kept in the tree as reference material for the NN training team;
// not imported anywhere.
//
// Input:  NN output for a single detection
// Output: same NN classification passthrough, enriched with C2's
//         reference-library metadata for that family
//
// Wire contract: docs/integration-contracts.md §9.
// Design rationale: docs/agentic-signature-bridge-architecture.md.
// ═══════════════════════════════════════════════════════════════════

import { FAMILIES, familyMetadata, familyLibraryCoverage } from './families.js';

// ── Public API ─────────────────────────────────────────────────

// bridgeSignature(input) — main adapter.
//
// Input shape (all fields except nn_family + nn_confidence optional):
//   {
//     detection_id: string,           // opaque id; passthrough
//     nn_family: string,              // e.g. 'shahed-loitering-munition'
//     nn_confidence: number [0, 1],
//     candidate_models?: [{id, score, ...}],   // NN's model shortlist
//     raw_signature?: {               // used for signature_hash + optional elaboration
//       rf?: { carrier_hz, bandwidth_hz, modulation, ... },
//       acoustic?: { fundamental_hz, profile, ... },
//       visual?: { silhouette, ... },
//     },
//   }
//
// Output shape:
//   {
//     detection_id, family_label, family_confidence,   // passthrough from NN
//     family_metadata,                                 // from FAMILY_LIBRARY
//     candidate_models,                                // passthrough (may be [])
//     attribution_hints,                               // = family_metadata.attribution_elaboration
//     signature_hash,                                  // FNV-1a over sig; null if no raw_signature
//     source: 'nn',                                    // always 'nn' — C2 no longer classifies
//   }
//
// Off-list family label OR missing family → returns UNKNOWN metadata
// with source: 'nn-off-list'. Callers should surface this as
// "operator manual reclassify required" rather than fabricating.
export function bridgeSignature(input) {
  if (!input || typeof input !== 'object') return _malformed('input must be an object');

  const nn_family     = _normalizeFamily(input.nn_family);
  const nn_confidence = _coerceConfidence(input.nn_confidence);
  const candidateModels = Array.isArray(input.candidate_models) ? input.candidate_models : [];

  const metadata = familyMetadata(nn_family);
  const resolvedFamily = metadata === familyMetadata(null) && nn_family !== FAMILIES.UNKNOWN
    ? FAMILIES.UNKNOWN
    : nn_family;
  const isOffList = resolvedFamily === FAMILIES.UNKNOWN && input.nn_family && input.nn_family !== FAMILIES.UNKNOWN;

  return {
    detection_id:     input.detection_id || null,
    family_label:     resolvedFamily,
    family_confidence: nn_confidence,
    family_metadata:  metadata,
    candidate_models: candidateModels.map(_annotateCandidate.bind(null, metadata)),
    attribution_hints: metadata.attribution_elaboration || [],
    signature_hash:   input.raw_signature ? _fnv1aHash(_canonicalize(input.raw_signature)) : null,
    source:           isOffList ? 'nn-off-list' : 'nn',
  };
}

// explainSignature(input) — same shape as bridgeSignature but adds a
// debug envelope explaining why UNKNOWN fired (off-list, missing
// nn_family, malformed). Used by the browser-console dev handle.
export function explainSignature(input) {
  const result = bridgeSignature(input);
  const notes = [];
  if (!input) notes.push('input was null / undefined');
  else {
    if (!input.nn_family) notes.push('no nn_family provided — defaulted to UNKNOWN');
    else if (result.source === 'nn-off-list') notes.push(`nn_family '${input.nn_family}' not in FAMILIES enum — treated as UNKNOWN`);
    if (input.nn_confidence == null) notes.push('no nn_confidence provided — coerced to 0');
    if (!input.raw_signature) notes.push('no raw_signature provided — signature_hash is null (precedent retrieval will not group this detection)');
  }
  return { ...result, _debug: { notes } };
}

// signatureBridgeCoverage() — introspection. Returns the family enum
// + counts + threat-level buckets. Wired to the dev handle for
// coverage debugging + partner audit ("show me every family the C2
// knows how to enrich").
export function signatureBridgeCoverage() {
  return familyLibraryCoverage();
}

// ── Internals ─────────────────────────────────────────────────

// Normalise the NN's family label to our enum. Case-insensitive so
// a partner NN emitting 'DJI-QUADCOPTER' still resolves. Trims
// whitespace. Returns null when input is empty (caller downstream
// converts to UNKNOWN).
function _normalizeFamily(f) {
  if (!f || typeof f !== 'string') return null;
  return f.trim().toLowerCase();
}

// Coerce nn_confidence into [0, 1]. Anything invalid → 0.
function _coerceConfidence(c) {
  if (typeof c !== 'number' || Number.isNaN(c)) return 0;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

// Annotate an NN candidate model with a family_context string derived
// from the enriched metadata. Non-invasive — never overwrites fields
// the NN sent; only adds family_context if absent.
function _annotateCandidate(metadata, candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  if (candidate.family_context) return candidate;
  return {
    ...candidate,
    family_context: metadata?.display_name || null,
  };
}

// Malformed-input envelope. Never throws — signature_bridge must
// remain non-blocking for the downstream event pipeline.
function _malformed(reason) {
  const unknown = familyMetadata(null);
  return {
    detection_id: null,
    family_label: FAMILIES.UNKNOWN,
    family_confidence: 0,
    family_metadata: unknown,
    candidate_models: [],
    attribution_hints: unknown.attribution_elaboration || [],
    signature_hash: null,
    source: 'malformed',
    _malformed_reason: reason,
  };
}

// ── Signature hash (unchanged from legacy) ───────────────────
//
// FNV-1a 32-bit over a canonicalised JSON representation of the raw
// signature. Deterministic across sessions so precedent retrieval
// can group identical signatures without relying on the NN's own
// candidate id output.

function _canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(_canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _canonicalize(obj[k])).join(',') + '}';
}

function _fnv1aHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
