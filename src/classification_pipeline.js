// Classification pipeline. Confidence-driven state machine that
// promotes and demotes event.classification as the NN's confidence in
// the platform signature rises, cooperative-traffic matches come in,
// and attack profile heuristics fire.
//
// The product model: every event starts precautionary. The system
// EARNS the downgrade through data. Precautionary until proven
// otherwise — the ISR promise.
//
//     t=0        Detection, 1-2 sensors, low NN confidence      →  RED
//                 (hostile-high, "unknown, precautionary")
//     t=t1       More sensors + confidence >= 0.6 + platform
//                 identified as commercial-class rotary/fixed-wing → YELLOW
//                 (hostile-medium, "commercial platform confirmed")
//     t=t2a      Cooperative-traffic match → registered flight     → GREEN
//                 (friendly, "matched registered flight X")
//     t=t2b      Attack profile detected (weaponized signature,
//                 dive vector, descent attack behavior, or
//                 sensitive-area approach at low altitude + speed)
//                 → advisory + operator "Confirm to promote" CTA    → RED (promoted)
//                 Per Lucas: system observes, human decides. Never
//                 automatic promotion to red.
//
// Detection-only invariant: pipeline calls reclassifyEvent (already
// audit-logged), pushes toasts, sets advisory flags. Never triggers
// dispatch, escalation, or agent invocation.

import { reclassifyEvent } from './events.js';

// Classes that read as "commercial identifiable rotary or fixed-wing"
// — the platforms where a confident NN classification means "hobbyist
// or commercial operator, not a weapon." Loitering munitions and
// missiles are DELIBERATELY excluded even at high confidence: their
// identification is grounds for HIGHER alert, not downgrade.
export const COMMERCIAL_IDENTIFIABLE_CLASSES = new Set([
  'micro_drone',
  'quadcopter',
  'hexcopter_octocopter',
  'fixed_wing_drone',
  'vtol_hybrid',
  'helicopter_civilian',
  'fixed_wing_civilian',
  'fixed_wing_commercial',
  'glider',
  'paraglider_hang_glider',
  'balloon_airship',
]);

// Classes that inherently indicate a weapon signature. If the NN
// identifies one of these with any meaningful confidence, the event
// belongs at high threat — no downgrade path applies.
export const WEAPON_SIGNATURE_CLASSES = new Set([
  'cruise_missile',
  'ballistic_missile',
  'hypersonic_weapon',
  'loitering_munition',
  'dropped_ordnance',
  'artillery_shell',
  'rocket_barrage',
]);

// Confidence thresholds. Tuned for the mock ramp; real NN feeds
// through the same values without change.
export const PIPELINE_THRESHOLDS = {
  COMMERCIAL_DOWNGRADE_CONFIDENCE: 0.6,   // NN sees platform clearly
  COOPERATIVE_MATCH_MINIMUM: 0.5,         // reconciler score floor
  ATTACK_PROFILE_LOW_ALT_M: 500,          // low + fast + heading toward critical asset
  ATTACK_PROFILE_MIN_SPEED_MS: 40,        // ~144 km/h
};

// Rate at which the mock NN "sees" more of the target when a template
// opts into dynamicClassification. Real NN provides its own confidence
// deltas per tick; the mock needs an explicit ramp to demonstrate the
// state machine on demo templates without hardware in the loop.
const MOCK_CONFIDENCE_RAMP_PER_TICK = 0.025;   // ~15s to cross 0.35 → 0.85 at 8Hz
const MOCK_CONFIDENCE_CEILING = 0.85;

// Public entry — call once per event per tick (or every N ticks; the
// pipeline is idempotent and cheap). Only fires reclassifications when
// a threshold is genuinely crossed, so calling it every tick is safe.
//
// ctx (optional): {
//   nearestCriticalAssetDistanceM: number,   // for attack profile heuristic
//   cooperativeMatchInfo: {matched, flightId, score}   // from reconciler
// }
//
// Returns the pipeline state for logging / display.
export function evaluateClassificationPipeline(event, ctx = {}) {
  if (!event || event.status !== 'active') return null;
  if (!event.dynamicClassification) return null;   // opt-in per template
  if (!event._pipelineState) {
    event._pipelineState = {
      mode: 'unknown',
      lastTransitionAt: null,
      transitions: [],
      attackAdvisoryFiredAt: null,
    };
  }

  const state = event._pipelineState;
  const subject = event.subject;
  if (!subject) return state;

  // Mock confidence ramp — only when template opts in AND the current
  // confidence sits below the ceiling. Real NN pushes its own values
  // via applyNnTickToSubject and this ramp becomes a no-op relative to
  // the real data (running max in applyNnTickToSubject prevents any
  // regression).
  if (event.mockConfidenceRamp && subject.class_confidence < MOCK_CONFIDENCE_CEILING) {
    subject.class_confidence = Math.min(
      MOCK_CONFIDENCE_CEILING,
      subject.class_confidence + MOCK_CONFIDENCE_RAMP_PER_TICK,
    );
    // Mirror to event.confidence so any UI still reading the flat
    // field stays consistent with the subject's canonical value.
    event.confidence = subject.class_confidence;
  }

  // ── State machine ──

  // Weapon-class classes never downgrade regardless of confidence.
  // If the NN identifies a weapon signature at any meaningful
  // confidence, the event belongs at hostile-high.
  if (WEAPON_SIGNATURE_CLASSES.has(subject.class)) {
    return _ensureAttackDetectorOnly(event, subject, ctx, state);
  }

  // unknown → commercial-identified
  if (state.mode === 'unknown'
      && subject.class_confidence >= PIPELINE_THRESHOLDS.COMMERCIAL_DOWNGRADE_CONFIDENCE
      && COMMERCIAL_IDENTIFIABLE_CLASSES.has(subject.class)) {
    _transition(event, state, 'commercial-identified', 'hostile', 'medium',
      `NN identified platform as ${subject.subclass || subject.class} (confidence ${Math.round(subject.class_confidence * 100)}%). Commercial platform, intent unclear — downgraded from precautionary.`);
  }

  // Any non-weapon state → friendly-matched (cooperative-traffic match)
  if (state.mode !== 'friendly-matched') {
    const coop = ctx.cooperativeMatchInfo || event.cooperativeCheck;
    if (coop?.matched && (coop.score == null || coop.score >= PIPELINE_THRESHOLDS.COOPERATIVE_MATCH_MINIMUM)) {
      _transition(event, state, 'friendly-matched', 'friendly', null,
        `Matched registered flight${coop.flightId ? ' ' + coop.flightId : ''} via cooperative-traffic feed. Reclassified friendly.`);
      return state;   // no further attack-profile checks on a matched friendly
    }
  }

  // Attack detector always evaluates. Never demotes; only surfaces the
  // advisory + arms the operator "Confirm attack profile" CTA. Actual
  // promotion happens on operator click (see handler in main.js).
  return _ensureAttackDetectorOnly(event, subject, ctx, state);
}

// Attack profile detector. Sets event._attackProfileAdvisory when the
// rules fire; leaves the reclassification to the operator per option C
// (system observes, human decides). Once armed, stays armed — the
// operator either confirms (→ red) or ignores (event proceeds at its
// current classification). Emits a one-shot toast via the toast hook
// if the caller provided one.
export function evaluateAttackProfileDetector(event, ctx = {}, hooks = {}) {
  if (!event || event.status !== 'active') return false;
  if (event._attackProfileAdvisory) return false;   // one-shot per event
  const subject = event.subject;
  if (!subject) return false;

  const kin = subject.kinematics || {};
  const speedMs = kin.speed_ms || 0;
  const altM = kin.altitude_m_agl;

  const rules = [];
  if (subject.threat_profile?.weaponized_signature === true) {
    rules.push('weapon signature detected by NN');
  }
  // Behavior, cardinality, and formation are objects (state / kind /
  // formation_confidence bags), not bare strings. Reading them as
  // strings — as an earlier draft did — always returned undefined and
  // the rules never fired. See detection_subject.js:294-378 for shapes.
  if (subject.behavior?.state === 'descent_attack_profile') {
    rules.push('descent attack profile from behavior head');
  }
  if (subject.cardinality?.kind === 'swarm' && subject.formation?.kind === 'coordinated') {
    rules.push('coordinated swarm formation');
  }
  if (speedMs > PIPELINE_THRESHOLDS.ATTACK_PROFILE_MIN_SPEED_MS
      && altM != null && altM < PIPELINE_THRESHOLDS.ATTACK_PROFILE_LOW_ALT_M
      && ctx.nearestCriticalAssetDistanceM != null
      && ctx.nearestCriticalAssetDistanceM < 2000) {
    rules.push(`low-altitude high-speed approach on critical asset (${Math.round(ctx.nearestCriticalAssetDistanceM)}m away, ${Math.round(speedMs * 3.6)}km/h at ${Math.round(altM)}m)`);
  }

  if (!rules.length) return false;

  event._attackProfileAdvisory = {
    firedAt: new Date().toISOString(),
    rules,
    proposedClassification: 'hostile',
    proposedThreat: 'high',
  };
  hooks.onAdvisory?.(event, rules);
  return true;
}

// ── internals ──

function _ensureAttackDetectorOnly(event, subject, ctx, state) {
  // Weapon-class fast path: still evaluate attack detector so a cruise
  // missile with a confirmed weapon signature also arms the advisory
  // (redundant but consistent — surfaces the advisory rules for the
  // operator's audit trail even when classification is already red).
  evaluateAttackProfileDetector(event, ctx);
  return state;
}

function _transition(event, state, nextMode, classification, threat, reason) {
  state.mode = nextMode;
  state.lastTransitionAt = new Date().toISOString();
  state.transitions.push({
    at: state.lastTransitionAt,
    to: nextMode,
    reason,
  });
  reclassifyEvent(event.id, {
    classification,
    threat,
    reason,
  });
}
