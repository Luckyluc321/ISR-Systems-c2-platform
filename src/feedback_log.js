// ═══════════════════════════════════════════════════════════════════
// Feedback Log — operator decision triple audit (façade)
// ───────────────────────────────────────────────────────────────────
// Records the (agent_recommendation, operator_action, event_outcome)
// triple every time an operator takes a load-bearing decision on an
// event. This file is now a thin façade over a pluggable adapter
// (feedback_log_store.js) fronted by a sync in-memory cache. Callers
// keep the same sync fire-and-forget API — the storage backend is
// swappable behind the scenes.
//
// Storage matrix:
//   - localStorage: default today (adapter self-registers on import
//     of ./adapters/feedback_log_localstorage.js — mounted in main.js)
//   - Azure Blob WORM: registers via `setActiveFeedbackStore(name)`
//     in production boot when the sovereign proxy lands
//
// Sync-preservation pattern (mirrors src/precedent_index.js):
//   - Reads served from in-memory _entries array (sync)
//   - Writes push to _entries (sync) THEN fire-and-forget to adapter
//   - Boot awaits hydrateFeedbackLog() before any operator click can
//     land — cache is warm before any read
//
// Purpose: post-hoc review of "did operators agree with agent
// recommendations", regulatory audit trail ("prove the operator, not
// the platform, made the call"), and future ground truth for the
// precedent-retrieval index.
//
// CRITICAL — detection-only stance: this log records what operators
// did. It DOES NOT feed back into agent behaviour as "the agent
// should recommend Y next time because the operator picked Y last
// time." That's a decision-collaborator pattern which is explicitly
// out of scope. See memory file
// `feedback_detection_only_positioning.md`. The log is for humans to
// review, not for the model to imitate.
//
// See memory `project_azure_final_destination.md`,
// `project_feedback_log.md`, and docs/agentic-architecture.md §14.
// ═══════════════════════════════════════════════════════════════════

import { getFeedbackStore } from './feedback_log_store.js';

const SCHEMA_VERSION = 'fbl.v1.2026-09-05';
const MAX_ENTRIES_IN_MEMORY = 5000;   // FIFO cap on the in-memory cache

// ── FeedbackEntry shape ──────────────────────────────────────────
// {
//   id:                     string,       // "fbl-<eventId>-<timestamp>-<rand>"
//   schemaVersion:          SCHEMA_VERSION,
//   timestamp:              ISO string,
//   eventId:                string,
//   siteId:                 string,
//   actorRole:              string,       // getActiveRole().id at time of action
//   action:                 string,       // 'counter-dispatch' | 'confirm-outcome' | 'close-event' | 'escalate' | ...
//   actionDetail:           object,       // action-specific structured detail (asset id, tier, etc)
//   recommendationSnapshot: {             // captured at moment of decision
//     source:               string,       // 'agent_b' | 'agent_case_file' | null
//     body:                 string | null,
//     recommendation:       string | null,
//     model_version:        string | null,
//   },
//   outcome:                {             // filled in later when event closes / outcome set
//     status:               string | null, // 'pending' initially, resolves on close
//     label:                string | null,
//     resolvedAt:           ISO | null,
//   },
// }

// ── In-memory cache (source of truth for reads) ──────────────────
let _entries = [];
let _hydratePromise = null;
let _hydrated = false;

function _newId(eventId) {
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `fbl-${eventId}-${now}-${rand}`;
}

// ── Hydrate: pull persisted entries from the active adapter into
// the cache. Idempotent — second call returns the in-flight/resolved
// promise. main() must await this before the first operator click.
export function hydrateFeedbackLog() {
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    try {
      const store = getFeedbackStore();
      if (!store) {
        console.warn('[feedback_log] no store adapter registered — running in-memory only');
        _entries = [];
      } else {
        const list = await store.hydrate();
        _entries = Array.isArray(list) ? list : [];
      }
    } catch (err) {
      console.warn('[feedback_log] hydrate failed, cache starts empty:', err?.message || err);
      _entries = [];
    }
    _hydrated = true;
    return _entries.length;
  })();
  return _hydratePromise;
}

export function isHydrated() { return _hydrated; }

// ── Recommendation snapshot resolver ─────────────────────────────
// Captures whatever Agent B / Agent 3 last produced for this event.
// Pulled from event.narrativeCache (Agent B post-event) OR the live
// Mistral result cache (Agent 3 case-file). Missing = null fields —
// still logged so the triple exists even for decisions taken before
// any agent narrative rendered.
export function snapshotRecommendation(event, opts = {}) {
  const source = opts.source || (event?.narrativeCache ? 'agent_b_debrief' : 'agent_case_file');
  const cache = event?.narrativeCache || opts.liveCacheEntry || null;
  return {
    source: cache ? source : null,
    body: cache?.body || null,
    recommendation: cache?.recommendation || null,
    model_version: cache?.model_version || null,
  };
}

// ── Public API (unchanged from pre-adapter façade) ───────────────
export function logOperatorDecision({
  event,
  action,
  actionDetail = {},
  recommendationSnapshot = null,
  actorRole = 'unknown',
}) {
  if (!event?.id || !action) return null;
  const entry = {
    id: _newId(event.id),
    schemaVersion: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    eventId: event.id,
    siteId: event.siteId || null,
    actorRole,
    action,
    actionDetail,
    recommendationSnapshot: recommendationSnapshot || snapshotRecommendation(event),
    outcome: {
      status: event.outcome || 'pending',
      label: event.dispatchOutcomes ? Object.values(event.dispatchOutcomes)[0]?.outcomeLabel || null : null,
      resolvedAt: event.outcome ? new Date().toISOString() : null,
    },
  };
  // Sync cache write — retrieval sees it immediately.
  _entries.push(entry);
  if (_entries.length > MAX_ENTRIES_IN_MEMORY) {
    _entries = _entries.slice(-MAX_ENTRIES_IN_MEMORY);
  }
  // Fire-and-forget adapter persistence — never block or throw upward.
  const store = getFeedbackStore();
  if (store) {
    store.append(entry).catch(err => console.warn('[feedback_log] append failed:', err?.message || err));
  }
  return entry;
}

// Fill in outcome later for entries whose events resolve after the
// decision was logged. Mutates the cache in place (sync — reads see
// the update immediately), then fires the adapter's
// appendOutcomeResolution (WORM-safe: Azure Blob adapter writes a NEW
// resolution entry rather than mutating in place).
export function updateFeedbackOutcome(eventId, outcomeStatus, outcomeLabel) {
  if (!eventId) return 0;
  const now = new Date().toISOString();
  let updated = 0;
  for (const e of _entries) {
    if (e.eventId !== eventId) continue;
    if (e.outcome?.status === outcomeStatus && e.outcome?.label === outcomeLabel) continue;
    e.outcome = {
      status: outcomeStatus || 'unknown',
      label: outcomeLabel || null,
      resolvedAt: now,
    };
    updated++;
  }
  if (updated > 0) {
    const store = getFeedbackStore();
    if (store) {
      store.appendOutcomeResolution(eventId, {
        status: outcomeStatus || 'unknown',
        label: outcomeLabel || null,
        resolvedAt: now,
      }).catch(err => console.warn('[feedback_log] outcome resolution append failed:', err?.message || err));
    }
  }
  return updated;
}

// ── Introspection helpers (sync reads against the cache) ─────────
export function getFeedbackLog(filter = {}) {
  return _entries.filter(e => {
    if (filter.eventId && e.eventId !== filter.eventId) return false;
    if (filter.action && e.action !== filter.action) return false;
    if (filter.siteId && e.siteId !== filter.siteId) return false;
    if (filter.actorRole && e.actorRole !== filter.actorRole) return false;
    return true;
  });
}

export function clearFeedbackLog() {
  _entries = [];
  const store = getFeedbackStore();
  if (store) {
    store.clear().catch(err => console.warn('[feedback_log] clear failed:', err?.message || err));
  }
}

export function feedbackLogSize() {
  return _entries.length;
}

// ── window.__isr_feedbackLog() console helper ────────────────────
// Registered by main.js at boot. Useful for dev inspection.
export function _installConsoleHelper() {
  if (typeof window === 'undefined') return;
  window.__isr_feedbackLog = (filter) => {
    const entries = getFeedbackLog(filter || {});
    console.table(entries.map(e => ({
      timestamp: e.timestamp,
      eventId: e.eventId,
      action: e.action,
      actorRole: e.actorRole,
      outcome: e.outcome?.status,
      recModel: e.recommendationSnapshot?.model_version,
    })));
    return entries;
  };
  window.__isr_feedbackLogClear = () => { clearFeedbackLog(); return 'cleared'; };
}
