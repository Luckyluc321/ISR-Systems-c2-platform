// ═══════════════════════════════════════════════════════════════════
// Engagement effects — per-weapon, per-target survivability model
// ───────────────────────────────────────────────────────────────────
// One engagement window landing hits on a threat does NOT guarantee a
// kill. The outcome distribution (explode in air / disabled without
// explosion / survives and continues) depends on the weapon class,
// how many rounds landed, and the target's construction. Damage
// accumulates across windows, so sustained fire converges on certain
// neutralisation. Susceptibility gates non-kinetic effects: jamming
// does nothing against anti-jam guidance, everything against a
// consumer quadcopter.
//
// Pure data + pure functions. The dispatch engine in main.js calls
// resolveKineticEffect at engagement close and jammingEffectiveness
// at jam initiation; new weapon or target types plug in as data rows,
// no engine changes. Simulation-only: live events use adapter-
// reported outcomes and never enter these rolls.
//
// Tuning handle: window.__isr_effects (wired in main.js).
// ═══════════════════════════════════════════════════════════════════

// ── Weapon profiles, keyed by dispatch kind ─────────────────────
// class:        'kinetic-mg' | 'kinetic-missile' | 'jamming'
// perHitDamage: damage fraction per landed round, before target
//               toughness scaling
// explodeBias:  share of a neutralisation that is an in-air warhead
//               or battery explosion rather than a disabled airframe
export const WEAPON_PROFILES = {
  'counter-drone-swarm':  { class: 'kinetic-mg', perHitDamage: 0.16, explodeBias: 0.35 },
  'helicopter-intercept': { class: 'kinetic-mg', perHitDamage: 0.22, explodeBias: 0.40 },
  'friendly-missile':     { class: 'kinetic-missile', perHitDamage: 2.5, explodeBias: 0.92 },
  'counter-missile':      { class: 'kinetic-missile', perHitDamage: 2.5, explodeBias: 0.92 },
  'sam-battery':          { class: 'kinetic-missile', perHitDamage: 2.5, explodeBias: 0.92 },
  'police-c-uas':         { class: 'jamming', power: 0.85 },
  'army-c-uas':           { class: 'jamming', power: 1.0 },
};

// ── Target profiles, keyed by event platform ────────────────────
// toughness:      0..1 — fraction of kinetic damage the airframe
//                 absorbs (0 = fragile consumer plastic, 1 = armored)
// susceptibility: per effect class, 0..1 probability scaling. A
//                 jamming value of 0.12 means anti-jam guidance
//                 (CRPA + inertial) defeats the jammer 88% of the
//                 time; 0 means immune.
export const TARGET_PROFILES = {
  'quadcopter':         { toughness: 0.15, susceptibility: { jamming: 0.90, kinetic: 1.0 } },
  'fixed-wing':         { toughness: 0.45, susceptibility: { jamming: 0.55, kinetic: 1.0 } },
  'loitering-munition': { toughness: 0.60, susceptibility: { jamming: 0.12, kinetic: 1.0 } },
  'missile':            { toughness: 0.85, susceptibility: { jamming: 0.00, kinetic: 0.35 } },
  'helicopter':         { toughness: 0.70, susceptibility: { jamming: 0.00, kinetic: 0.8 } },
  'jet':                { toughness: 0.80, susceptibility: { jamming: 0.00, kinetic: 0.6 } },
  '_default':           { toughness: 0.40, susceptibility: { jamming: 0.50, kinetic: 1.0 } },
};

export function targetProfileFor(platform) {
  return TARGET_PROFILES[platform] || TARGET_PROFILES._default;
}

// ── Kinetic resolution ──────────────────────────────────────────
// Called once per engagement window that geometrically HIT (the
// geometry roll in _simComputeEngagementOutcome stays upstream).
//
// Worked example (the calibration case): 10 machine-gun rounds
// landed on a Shahed (toughness 0.6) at full hit quality:
//   damage gained = 10 × 0.16 × (1 − 0.6) × 1.0 = 0.64
//   P(neutralised) = 0.64 → P(explode) = 0.64 × 0.35 ≈ 0.22,
//   P(disabled) ≈ 0.42, P(survives) = 0.36
// A surviving target carries its damage into the next window, so the
// second burst pushes P(neutralised) toward 1.0.
//
// Returns { outcome: 'explode'|'disable'|'survive', damage,
//           probabilities } — caller persists `damage` on the target
// and maps outcome onto the existing explosion / physics-fall paths.
export function resolveKineticEffect({ weaponKind, roundsFired, hitQuality = 1, targetPlatform, accumulatedDamage = 0, rand = Math.random }) {
  const weapon = WEAPON_PROFILES[weaponKind];
  const target = targetProfileFor(targetPlatform);
  if (!weapon || weapon.class === 'jamming') {
    return { outcome: 'survive', damage: accumulatedDamage, probabilities: null, reason: 'no-kinetic-profile' };
  }
  const hitsLanded = Math.max(0, (roundsFired || 0) * Math.max(0, Math.min(1, hitQuality)));
  const kineticSusc = target.susceptibility?.kinetic ?? 1;
  const gained = hitsLanded * weapon.perHitDamage * (1 - target.toughness) * kineticSusc;
  const damage = Math.min(1.5, accumulatedDamage + gained);
  const pNeut = Math.max(0, Math.min(1, damage));
  const pExplode = pNeut * (weapon.explodeBias ?? 0.35);
  const probabilities = {
    explode: Number(pExplode.toFixed(3)),
    disable: Number((pNeut - pExplode).toFixed(3)),
    survive: Number((1 - pNeut).toFixed(3)),
  };
  const r = rand();
  const outcome = r < pExplode ? 'explode' : (r < pNeut ? 'disable' : 'survive');
  return { outcome, damage, probabilities };
}

// ── Jamming effectiveness ───────────────────────────────────────
// Called once per target at jam initiation. Returns whether THIS
// jam attempt takes effect, with the probability used so the toast
// can explain a resistant target honestly.
export function resolveJammingEffect({ weaponKind, targetPlatform, rand = Math.random }) {
  const weapon = WEAPON_PROFILES[weaponKind];
  const target = targetProfileFor(targetPlatform);
  const susc = target.susceptibility?.jamming ?? 0.5;
  const power = weapon?.power ?? 1;
  const p = Math.max(0, Math.min(1, susc * power));
  return { jammed: rand() < p, probability: Number(p.toFixed(3)) };
}
