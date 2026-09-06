// Auto-escalation rules engine.
// Watches new events + status changes. When conditions match a rule, fires
// the rule's dispatch action (auto-escalate to configured destinations).
// Real product: rule editor in Config module. For now: preset defaults per site.

import { EVENTS, onSelectionChange, escalateEvent, setEscalationOverdue } from './events.js';
import { destinationsForSite, destinationsForEvent } from './destinations.js';

// Per-tier SLA window (minutes) for escalation acknowledgement. Anything
// still un-ack'd past this threshold gets flipped to overdue by the sweep
// below. Detection-only: never triggers auto-cascade. Surfaces a badge +
// operator toast so a human decides whether to re-route.
export const SLA_MINS_BY_TIER = { 1: 5, 2: 15, 3: 30, 4: 60, 5: 120 };

// Rule shape:
// {
//   id, name, siteId (or 'all'), enabled,
//   when: { classification, platform, threat, minConfidence, insideInnerPerimeter, minDurationSec },
//   then: { escalateToTiers: [1,2,...], payload: 'summary'|'full'|'live-link', message, delaySec }
// }

const DEFAULT_RULES = [
  {
    id: 'r-missile-all-tiers',
    name: 'Cruise missile classification, automatic dispatch to all tiers',
    // Re-enabled. Cruise missile signature triggers national response
    // automatically — no operator gate. Air Force gets the notification via
    // this rule, meaning operator does not need to manually escalate. The
    // only manual action left is Air Force clicking Dispatch F-35.
    siteId: 'all', enabled: true,
    when: { platform: 'missile', minConfidence: 0.80 },
    then: { escalateToTiers: [1,2,3,4,5], payload: 'full', message: 'Automatic dispatch by rule. Confirmed cruise missile class signature.', delaySec: 0 },
  },
  {
    id: 'r-hostile-high-t1',
    name: 'Hostile with high threat, notify site security only',
    // Restricted to Tier 1 (site security only). Everything above Tier 1
    // requires operator judgment via manual Escalate. Prevents auto-dispatch
    // to national agencies for quadcopter or fixed wing threats — those need
    // a human to confirm before waking up PET, FE, Politi, etc.
    siteId: 'all', enabled: true,
    when: { classification: 'hostile', threat: 'high', minConfidence: 0.75 },
    then: { escalateToTiers: [1], payload: 'summary', message: 'Automatic notification. Confirmed hostile threat, site security engaged.', delaySec: 0 },
  },
  {
    id: 'r-fixed-wing-t3',
    name: 'Fixed wing hostile → loop in Tier 3 within 60 seconds',
    siteId: 'all', enabled: true,
    when: { platform: 'fixed-wing', classification: 'hostile', minConfidence: 0.70 },
    then: { escalateToTiers: [3], payload: 'summary', message: 'Auto dispatched by rule: fixed wing platform requires national visibility.', delaySec: 60 },
  },
  {
    id: 'r-friendly-log-only',
    name: 'Friendly ID → log to Tier 1 only',
    siteId: 'all', enabled: true,
    when: { classification: 'friendly' },
    then: { escalateToTiers: [1], payload: 'summary', message: 'Auto logged: friendly identification for audit record.', delaySec: 0 },
  },
];

// Persistence
// Bumped 2026-07-30 to invalidate cached rules where missile auto-fire was enabled.
const STORAGE_KEY = 'isr_c2_rules_overrides_v3';
function loadRules() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_RULES];
    const overrides = JSON.parse(raw);
    return Array.isArray(overrides) && overrides.length ? overrides : [...DEFAULT_RULES];
  } catch (e) { return [...DEFAULT_RULES]; }
}
function saveRules() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_rules)); } catch (e) {}
}

let _rules = loadRules();
const _listeners = new Set();
function _notify() { _listeners.forEach(fn => fn()); }
export function getRules() { return [..._rules]; }
export function onRulesChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
export function upsertRule(rule) {
  const idx = _rules.findIndex(r => r.id === rule.id);
  if (idx >= 0) _rules[idx] = rule; else _rules.push({ ...rule, id: rule.id || `r-custom-${Date.now()}` });
  saveRules(); _notify();
}
export function removeRule(id) {
  _rules = _rules.filter(r => r.id !== id);
  saveRules(); _notify();
}
export function toggleRule(id) {
  const r = _rules.find(r => r.id === id);
  if (r) { r.enabled = !r.enabled; saveRules(); _notify(); }
}
export function resetRulesToDefault() {
  localStorage.removeItem(STORAGE_KEY);
  _rules = [...DEFAULT_RULES];
  _notify();
}

// ── Rule matching ──
function ruleMatches(rule, event) {
  if (!rule.enabled) return false;
  if (rule.siteId && rule.siteId !== 'all' && rule.siteId !== event.siteId) return false;
  const w = rule.when || {};
  if (w.classification && w.classification !== event.classification) return false;
  if (w.platform && w.platform !== event.platform) return false;
  if (w.threat && w.threat !== event.threat) return false;
  if (w.minConfidence != null && event.confidence < w.minConfidence) return false;
  if (w.minDurationSec != null && (event.duration || 0) < w.minDurationSec) return false;
  return true;
}

// Track which (eventId, ruleId) pairs have already fired to avoid duplicates
const _firedPairs = new Set();

function fireRule(rule, event) {
  const key = `${event.id}:${rule.id}`;
  if (_firedPairs.has(key)) return;
  _firedPairs.add(key);
  // Domain-scoped destination pool. destinationsForEvent applies the
  // event's live domainScope against each destination's declared
  // domains, so an inland substation rule never fires to Kystvagten
  // and a maritime-crossing quadcopter reaches the coast guard the
  // moment it enters harbour scope.
  const destIds = destinationsForEvent(event)
    .filter(d => rule.then.escalateToTiers.includes(d.tier))
    .map(d => d.id);
  if (!destIds.length) return;
  const doFire = () => {
    escalateEvent(event.id, {
      destinationIds: destIds,
      payload: rule.then.payload || 'summary',
      message: rule.then.message || `Auto-dispatched by rule: ${rule.name}`,
      operator: 'Auto-Rule Engine',
    });
  };
  if (rule.then.delaySec > 0) setTimeout(doFire, rule.then.delaySec * 1000);
  else doFire();
}

// Main tick: evaluate every event against every rule.
// Skips events that have not yet been detected by any sensor
// (event.detected === false for multiSiteTrack pre-ingress events)
// so auto-escalations do not fire before we have actually observed
// anything. Once a sensor confirms detection the flag flips true
// and rules evaluate on the next tick.
export function evaluateAllRules() {
  EVENTS.forEach(event => {
    if (event.status !== 'active') return;
    if (event.detected === false) return;
    _rules.forEach(rule => {
      if (ruleMatches(rule, event)) fireRule(rule, event);
    });
  });
}

// Auto-evaluate whenever any event changes
onSelectionChange(() => evaluateAllRules());
// Also poll every 3s to catch time-based rules (minDurationSec)
setInterval(evaluateAllRules, 3000);

// ── SLA overdue sweep ──
// Independent from the rule-firing tick because SLA windows are minute-scale
// (5-120 min per tier) — polling every 3s would waste cycles. 15s cadence
// gives sub-minute latency to flip the flag once the tier window elapses,
// which is more than tight enough for a human decision loop.
//
// Detection-only invariant: this sweep NEVER re-dispatches or cascades. It
// only flips rec.overdue + rec.overdueAt via setEscalationOverdue, which
// itself only writes state + emits a browser CustomEvent for the toast. No
// auto-escalation of any kind.
export function sweepSLAOverdue(nowMs = Date.now()) {
  EVENTS.forEach(event => {
    if (event.status !== 'active') return;
    if (event.detected === false) return;
    if (!Array.isArray(event.escalations) || !event.escalations.length) return;
    const dests = destinationsForSite(event.siteId);
    event.escalations.forEach(rec => {
      if (!rec || rec.overdue) return;
      if (rec.status === 'acknowledged' || rec.status === 'failed') return;
      const dest = dests.find(d => d.id === rec.destinationId);
      const tier = dest?.tier;
      const slaMins = SLA_MINS_BY_TIER[tier];
      if (!slaMins) return;
      const startedMs = new Date(rec.initiatedAt).getTime();
      if (Number.isNaN(startedMs)) return;
      if (nowMs - startedMs >= slaMins * 60 * 1000) {
        setEscalationOverdue(event.id, rec.id);
      }
    });
  });
}
setInterval(() => sweepSLAOverdue(), 15000);

// Public helper for rule editor UI
export function ruleSummaryText(rule) {
  const w = rule.when || {};
  const parts = [];
  if (w.platform) parts.push(w.platform);
  if (w.classification) parts.push(w.classification);
  if (w.threat) parts.push(`threat ${w.threat}`);
  if (w.minConfidence != null) parts.push(`confidence ≥ ${w.minConfidence}`);
  if (w.minDurationSec != null) parts.push(`duration ≥ ${w.minDurationSec}s`);
  const conditions = parts.length ? parts.join(', ') : 'any event';
  const tiers = rule.then.escalateToTiers.join(', ');
  const delay = rule.then.delaySec ? ` after ${rule.then.delaySec}s` : ' immediately';
  return `When ${conditions} → dispatch Tier ${tiers}${delay}`;
}
