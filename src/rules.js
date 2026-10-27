// Auto-escalation rules engine.
// Watches new events + status changes. When conditions match a rule, fires
// the rule's dispatch action (auto-escalate to configured destinations).
// Real product: rule editor in Config module. For now: preset defaults per site.

import { EVENTS, onSelectionChange, escalateEvent, setEscalationOverdue } from './events.js';
import { destinationsForSite, destinationsForEvent, isInternationalBody } from './destinations.js';

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
    name: 'Cruise missile classification, automatic notification of every Danish tier',
    // Re-enabled. Cruise missile signature triggers national response
    // automatically — no operator gate. Air Force gets the notification via
    // this rule, meaning operator does not need to manually escalate. The
    // only manual action left is Air Force clicking Dispatch F-35.
    siteId: 'all', enabled: true,
    when: { platform: 'missile', minConfidence: 0.80 },
    then: { escalateToTiers: [1,2,3,4,5], payload: 'full', message: '', delaySec: 0 },
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
    // NO MESSAGE HERE, DELIBERATELY. An empty message means "use the
    // per-recipient default" from escalation_messages.js. This used to
    // carry one sentence that went to all seven tier 1 destinations
    // identically, so the tower, the fire service and the camera system
    // all received "Confirmed hostile threat, site security engaged."
    // None of them is told what to do with it.
    then: { escalateToTiers: [1], payload: 'summary', message: '', delaySec: 0 },
  },
  {
    id: 'r-fixed-wing-t3',
    name: 'Fixed wing hostile → loop in Tier 3 within 60 seconds',
    // OFF BY DEFAULT since 2026-10-27. It told the national agencies
    // about every hostile fixed-wing a minute in, with no one deciding.
    // Lucas: Tier 1 and 2 to begin with, "and then the security manager
    // can select them for himself". An operator can still turn it on.
    siteId: 'all', enabled: false,
    when: { platform: 'fixed-wing', classification: 'hostile', minConfidence: 0.70 },
    then: { escalateToTiers: [3], payload: 'summary', message: '', delaySec: 60 },
  },
  {
    // OFF, AND IT SHOULD NEVER HAVE BEEN ON.
    //
    // "Log to Tier 1" is a sensible intent implemented with the wrong
    // mechanism. Escalation is how this platform asks an agency to do
    // something, so a friendly firing it created seven escalation
    // records against a scheduled arrival and the card read
    // "ESCALATED · 7". A cooperative airliner, correlated on ADS-B and
    // matching its own flight plan, is not something the tower, the
    // fire service, ground ops and the camera system need dispatching
    // about.
    //
    // It also outranked live work. Until the ledger comparator was
    // fixed this put a routine arrival above a five-drone runway
    // incursion in every receiver's inbox, purely because the aircraft
    // spawned later.
    //
    // Logging a friendly is worth doing. It is a journal entry, not a
    // dispatch, and when there is somewhere to write it this rule comes
    // back pointed at that instead.
    id: 'r-friendly-log-only',
    name: 'Friendly ID → log to Tier 1 only',
    siteId: 'all', enabled: false,
    when: { classification: 'friendly' },
    then: { escalateToTiers: [1], payload: 'summary', message: '', delaySec: 0 },
  },
];

// Persistence
// Bumped 2026-07-30 to invalidate cached rules where missile auto-fire was enabled.
// Bumped again 2026-10-14: the rules carried a hardcoded message that went
// to every recipient identically. Without this bump a cached override
// keeps sending it and the per-recipient defaults never appear.
// Bumped again 2026-10-15: the friendly rule is disabled in code, and a
// cached v4 override would keep it enabled and keep escalating every
// cooperative arrival to seven tier-1 destinations.
// Bumped again 2026-10-27: the fixed-wing rule is off by default, and a
// cached v5 override would keep sending Tier 3 a minute after every
// hostile fixed-wing without anyone deciding.
const STORAGE_KEY = 'isr_c2_rules_overrides_v6';
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
  // NEVER AN INTERNATIONAL BODY, whatever the rule says. A rule is a
  // default, and the default for Eurocontrol, Europol, NATO, NORDEFCO and
  // ENTSO-E is "not unless an operator picks them by hand" (Lucas,
  // 2026-10-26: we are the messenger, the Danish authorities decide who
  // else is told). Filtered here rather than in the rule's tiers so a
  // rule saved in a browser before this change is held to it too.
  const destIds = destinationsForEvent(event)
    .filter(d => rule.then.escalateToTiers.includes(d.tier) && !isInternationalBody(d))
    .map(d => d.id);
  if (!destIds.length) return;
  const doFire = () => {
    escalateEvent(event.id, {
      destinationIds: destIds,
      payload: rule.then.payload || 'summary',
      // ?? NOT ||. An empty message is a DELIBERATE value meaning "use the
      // per-recipient default in escalation_messages.js", which is what
      // all four rules now carry. With || the empty string was falsy, this
      // uniform sentence won every time, and defaultEscalationMessage was
      // never reached on the auto-rule path at all.
      message: rule.then.message ?? `Auto-dispatched by rule: ${rule.name}`,
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
    // Not before the system knows what it is (identification_gate.js).
    // An unidentified track waits; the rule fires on the next evaluation
    // after it is identified, about 8 s after first detection.
    if (event.identified === false) return;
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
