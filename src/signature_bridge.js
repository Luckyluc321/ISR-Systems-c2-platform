// ═══════════════════════════════════════════════════════════════════
// Signature bridge — raw NN signature → family-labelled narrative
// ───────────────────────────────────────────────────────────────────
// Implements docs/integration-contracts.md Section 9. Deterministic
// preprocessing that translates a raw sensor signature slice (RF band,
// acoustic profile, visual silhouette) into a family label + narrative
// text + attribution hints + candidate model refinement. Rules-driven,
// same shape as `src/threat_routing.js` RULES table. Pure module — no
// external calls, no writes.
//
// Consumers:
//   - NN adapter downstream of `src/threat_routing.js` for enriching
//     event.narrativeCache before Agent B (Section 8) prompts
//   - Chapter renderers (Phase 2 report shape) for the attribution
//     sub-section
//   - Precedent retrieval — signature_hash groups similar past events
//
// Detection-only invariant preserved. Bridge returns labels + narrative
// text; no dispatch, no escalation, no state mutation.
//
// See docs/integration-contracts.md Section 9 for the full contract.
// ═══════════════════════════════════════════════════════════════════

import { FAMILIES, MODELS, ACOUSTIC, VISUAL, RF_BANDS } from './threat_taxonomy.js';

// ── Rules table ────────────────────────────────────────────────
//
// Each rule matches against the raw signature slice + optional NN
// classification and produces a narrative label + attribution hints.
// Multiple rules can match; rationales concatenate, attributions
// dedupe. Rules fire in order but order does NOT determine priority
// — every matching rule contributes.

const RULES = [
  {
    tag: 'shahed-rotary-acoustic',
    when: (sig) => sig.acoustic
                && sig.acoustic.profile === ACOUSTIC.MOPED_BUZZ
                && sig.acoustic.fundamental_hz >= 70
                && sig.acoustic.fundamental_hz <= 90,
    narrative: 'Distinctive Shahed-class rotary-engine acoustic signature detected (moped-buzz profile, 70-90Hz fundamental).',
    attribution: ['origin:IR', 'kinetic-capable', 'one-way-attack-UAV', 'family-loitering-munition'],
    modelFilterFamily: FAMILIES.LOITERING_MUNITION,
  },
  {
    tag: 'dji-ocusync-rf',
    when: (sig) => sig.rf
                && (sig.rf.band === RF_BANDS.BAND_2_4_GHZ || sig.rf.band === RF_BANDS.BAND_5_8_GHZ)
                && sig.rf.modulation_hint === 'ofdm',
    narrative: 'DJI OcuSync-family link pattern (OFDM on 2.4/5.8 GHz consumer bands).',
    attribution: ['origin:CN', 'consumer-drone', 'family-commercial-quadcopter'],
    modelFilterFamily: FAMILIES.COMMERCIAL_QUADCOPTER,
  },
  {
    tag: 'fpv-analog-video-rf',
    when: (sig) => sig.rf
                && sig.rf.band === RF_BANDS.BAND_5_8_GHZ
                && (sig.rf.modulation_hint === 'analog' || sig.rf.modulation_hint === null)
                && sig.rf.bandwidth_hz != null
                && sig.rf.bandwidth_hz >= 15000000,
    narrative: 'Wideband 5.8 GHz analog video pattern consistent with FPV racing / kamikaze quadcopter.',
    attribution: ['fpv-frame', 'kinetic-capable', 'family-fpv-quadcopter'],
    modelFilterFamily: FAMILIES.FPV_QUADCOPTER,
  },
  {
    tag: 'stealth-autonomous-signature',
    when: (sig) => sig.rf
                && sig.rf.band === RF_BANDS.SILENT
                && sig.visual
                && sig.visual.silhouette === VISUAL.DELTA_WING,
    narrative: 'Silent RF + delta-wing silhouette. Autonomous loitering munition or cruise-missile cruise phase.',
    attribution: ['autonomous', 'kinetic-capable', 'delta-wing'],
    modelFilterFamily: null,   // ambiguous between LOITERING_MUNITION + CRUISE_MISSILE
  },
  {
    tag: 'cruise-missile-jet-scream',
    when: (sig) => sig.acoustic
                && sig.acoustic.profile === ACOUSTIC.JET_SCREAM
                && sig.visual
                && sig.visual.silhouette === VISUAL.CRUISE_MISSILE,
    narrative: 'Jet-scream acoustic + cruise-missile silhouette. High-speed cruise munition.',
    attribution: ['kinetic-capable', 'high-speed', 'family-cruise-missile'],
    modelFilterFamily: FAMILIES.CRUISE_MISSILE,
  },
  {
    tag: 'strategic-uav-satcom-rf',
    when: (sig) => sig.rf
                && (sig.rf.band === RF_BANDS.BAND_KU || sig.rf.band === RF_BANDS.BAND_KA)
                && sig.visual
                && (sig.visual.silhouette === VISUAL.STRAIGHT_WING || sig.visual.silhouette === VISUAL.DELTA_WING),
    narrative: 'Ku/Ka-band SATCOM datalink + high-altitude airframe silhouette. Strategic ISR UAV likely.',
    attribution: ['satcom-controlled', 'high-altitude', 'ISR-capable', 'family-strategic-uav'],
    modelFilterFamily: FAMILIES.STRATEGIC_UAV,
  },
  {
    tag: 'helicopter-rotor-thump',
    when: (sig) => sig.acoustic
                && sig.acoustic.profile === ACOUSTIC.ROTOR_THUMP,
    narrative: 'Main + tail rotor acoustic thump. Conventional helicopter platform.',
    attribution: ['manned-likely', 'rotorcraft'],
    modelFilterFamily: null,   // helicopter-civilian or helicopter-military — needs visual/RF for split
  },
  {
    tag: 'small-quadcopter-high-whine',
    when: (sig) => sig.acoustic
                && sig.acoustic.profile === ACOUSTIC.HIGH_WHINE
                && sig.visual
                && sig.visual.silhouette === VISUAL.QUADCOPTER_SMALL,
    narrative: 'High-whine electric motors + small quadcopter silhouette. Consumer or prosumer platform.',
    attribution: ['electric', 'consumer-tier', 'family-commercial-quadcopter'],
    modelFilterFamily: FAMILIES.COMMERCIAL_QUADCOPTER,
  },
  {
    tag: 'swarm-acoustic-chorus',
    when: (sig) => sig.acoustic
                && sig.acoustic.profile === ACOUSTIC.SWARM_CHORUS,
    narrative: 'Multi-source acoustic chorus. Coordinated drone swarm signature.',
    attribution: ['coordinated', 'multi-drone', 'family-drone-swarm'],
    modelFilterFamily: FAMILIES.DRONE_SWARM,
  },
  {
    tag: 'balloon-tethered',
    when: (sig) => sig.visual && sig.visual.silhouette === VISUAL.BALLOON,
    narrative: 'Balloon or aerostat silhouette. Persistent surveillance platform likely.',
    attribution: ['low-mobility', 'family-tethered-platform'],
    modelFilterFamily: FAMILIES.TETHERED_PLATFORM,
  },
];

// ── Public API ─────────────────────────────────────────────────

/**
 * Bridge a raw signature slice into a family-labelled narrative.
 * Idempotent + pure. Returns a fresh object every call.
 *
 * Input shape (per Section 9 contract):
 *   {
 *     detection_id: string,
 *     modality: 'rf' | 'acoustic' | 'visual' | 'radar' | 'cooperative-traffic',
 *     raw_signature: { rf?, acoustic?, visual?, radar? },
 *     nn_classification?: {
 *       family: FAMILIES value,
 *       candidate_models: [{id, score}],
 *       family_confidence: number [0, 1]
 *     }
 *   }
 *
 * Output shape:
 *   {
 *     family_label: FAMILIES value,
 *     family_confidence: number [0, 1],
 *     candidate_models: [{id, score, signature_match_reasoning}],
 *     narrative_label: string,
 *     attribution_hints: string[],
 *     signature_hash: string,
 *     fired_rules: string[]  // audit trail
 *   }
 */
export function bridgeSignature(input) {
  const empty = {
    family_label:      FAMILIES.UNKNOWN_SIGNATURE,
    family_confidence: 0,
    candidate_models:  [],
    narrative_label:   'Signature could not be parsed.',
    attribution_hints: [],
    signature_hash:    'sig-invalid',
    fired_rules:       [],
  };
  if (!input || typeof input !== 'object') return empty;
  const sig = input.raw_signature || {};
  if (!sig || typeof sig !== 'object') return empty;

  const firedRules = [];
  const narrativeParts = [];
  const attributionSet = new Set();
  const familyVotes = new Map();   // family → total vote weight

  for (const rule of RULES) {
    let matched = false;
    try { matched = rule.when(sig) === true; } catch (_) { matched = false; }
    if (!matched) continue;
    firedRules.push(rule.tag);
    if (rule.narrative) narrativeParts.push(rule.narrative);
    for (const hint of rule.attribution || []) attributionSet.add(hint);
    if (rule.modelFilterFamily) {
      familyVotes.set(rule.modelFilterFamily, (familyVotes.get(rule.modelFilterFamily) || 0) + 1);
    }
  }

  // NN classification vote weight: worth 2x a single rule (external
  // signal). If NN family disagrees with rule-inferred family, higher
  // rule-vote count wins; ties break in favour of NN.
  const nn = input.nn_classification || null;
  if (nn && nn.family) {
    const nnWeight = 2 * (nn.family_confidence != null ? Math.max(0.1, nn.family_confidence) : 1);
    familyVotes.set(nn.family, (familyVotes.get(nn.family) || 0) + nnWeight);
  }

  // Winning family = max-vote entry; fall back to unknown when no
  // votes and no NN classification.
  let bestFamily = FAMILIES.UNKNOWN_SIGNATURE;
  let bestScore = 0;
  for (const [family, score] of familyVotes) {
    if (score > bestScore) {
      bestFamily = family;
      bestScore = score;
    }
  }

  // family_confidence normalised: bounded [0, 1] via a soft
  // rule-count → confidence mapping. NN confidence dominates when
  // present; rule-only confidence caps at 0.85 (never assert
  // certainty from signature-side rules alone).
  let familyConfidence;
  if (nn && nn.family === bestFamily) {
    familyConfidence = nn.family_confidence != null ? nn.family_confidence : 0.75;
  } else if (bestScore >= 3) {
    familyConfidence = 0.85;
  } else if (bestScore >= 2) {
    familyConfidence = 0.70;
  } else if (bestScore >= 1) {
    familyConfidence = 0.55;
  } else {
    familyConfidence = 0.20;
  }

  // Candidate models: start from NN's candidate list (if any), filter
  // by winning family, then annotate each with signature-match
  // reasoning derived from the fired rules.
  const nnCandidates = Array.isArray(nn?.candidate_models) ? nn.candidate_models : [];
  const familyModels = MODELS.filter(m => m.family === bestFamily).map(m => m.id);
  const familyModelSet = new Set(familyModels);
  let candidates = nnCandidates.filter(c => familyModelSet.has(c.id));
  // If NN gave no in-family candidates, fall back to the top 3 of the
  // family by model position (alphabetical stability).
  if (!candidates.length && bestFamily !== FAMILIES.UNKNOWN_SIGNATURE) {
    candidates = familyModels
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 3)
      .map(id => ({ id, score: 0.33 }));
  }
  // Annotate every candidate with match reasoning.
  const matchReasoning = narrativeParts.length
    ? narrativeParts.join(' · ')
    : 'No rule-derived reasoning; inference from NN classification only.';
  candidates = candidates.map(c => ({
    id:    c.id,
    score: c.score,
    signature_match_reasoning: matchReasoning,
  }));

  // Narrative label — first fired rule wins as primary sentence,
  // subsequent rules append as context. Empty → deterministic
  // fallback per Section 9.
  const narrativeLabel = narrativeParts.length
    ? narrativeParts[0]
    : (bestFamily !== FAMILIES.UNKNOWN_SIGNATURE
         ? `Signature consistent with ${bestFamily} family (NN classification, no distinctive rule matched).`
         : 'Unrecognised signature pattern.');

  return {
    family_label:      bestFamily,
    family_confidence: familyConfidence,
    candidate_models:  candidates,
    narrative_label:   narrativeLabel,
    attribution_hints: Array.from(attributionSet),
    signature_hash:    _signatureHash(sig),
    fired_rules:       firedRules,
  };
}

// Debug helper — returns per-rule match outcome for a given signature.
export function explainSignature(input) {
  const sig = input?.raw_signature || {};
  return RULES.map(rule => {
    let matched = false;
    try { matched = rule.when(sig) === true; } catch (_) {}
    return {
      tag: rule.tag,
      matched,
      narrative: rule.narrative,
      attribution: rule.attribution,
      family: rule.modelFilterFamily,
    };
  });
}

// Coverage snapshot for dev handle
export function signatureBridgeCoverage() {
  return {
    ruleCount: RULES.length,
    tags: RULES.map(r => r.tag),
    modelCount: MODELS.length,
  };
}

// ── Internals ──────────────────────────────────────────────────

// Stable hash over the raw signature bytes for precedent retrieval.
// Deterministic; same input → same hash. Not cryptographic — a fast
// hash suffices since the platform's usage is grouping, not security.
function _signatureHash(sig) {
  const canonical = JSON.stringify(_canonicalise(sig));
  let h = 0x811c9dc5;   // FNV-1a offset basis
  for (let i = 0; i < canonical.length; i++) {
    h = (h ^ canonical.charCodeAt(i)) >>> 0;
    h = (h * 0x01000193) >>> 0;
  }
  return `sig-${h.toString(16).padStart(8, '0')}`;
}

// Sort object keys recursively so `_signatureHash` is invariant to
// key ordering in the caller's input object.
function _canonicalise(v) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(_canonicalise);
  if (typeof v !== 'object') return v;
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = _canonicalise(v[k]);
  return out;
}
