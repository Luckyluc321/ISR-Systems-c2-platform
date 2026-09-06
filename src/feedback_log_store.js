// ═══════════════════════════════════════════════════════════════════
// Feedback Log Store — abstract seam + registry
// ───────────────────────────────────────────────────────────────────
// Pluggable backend for the operator-decision audit log. The
// feedback_log.js module fronts every backend with a sync in-memory
// cache (same pattern as precedent_index.js), so callers stay
// unchanged as new backends land.
//
// Today: localStorage adapter self-registers as DEFAULT + 'active'.
// Tomorrow: Azure Blob (WORM immutability) adapter registers under
// 'active' and takes precedence — no other code changes.
//
// WORM (Write-Once-Read-Many) compatibility is enforced by the
// contract:
//   - `append(entry)` writes ONE entry, never rewrites a container
//   - `appendOutcomeResolution(eventId, ...)` writes a NEW resolution
//     entry rather than mutating prior entries in place
// LocalStorage adapter is mutable and can no-op the append-only
// discipline (it read-modify-writes the array), but the interface
// enforces WORM-safety at the boundary so the Azure adapter can drop
// in without changing feedback_log.js.
//
// Detection-only stance: adapters are transport-only. They never read
// entries to feed back into agent prompts. Same guarantee as the
// dispatch adapter seam (dispatch_source.js).
//
// See docs/agentic-architecture.md §14 Audit / Feedback Log and
// memory: project_feedback_log.
// ═══════════════════════════════════════════════════════════════════

const _adapters = new Map();
const _ACTIVE_KEY = '__active__';
export const DEFAULT_FEEDBACK_STORE_KEY = '__default__';

// Register a backend. Adapter must implement the contract below.
// Registering under DEFAULT_FEEDBACK_STORE_KEY makes this the fallback
// when no explicit adapter is 'active'. Registering under any other
// key is a named registration; call setActiveFeedbackStore(name) to
// promote it to the singleton lookup.
export function registerFeedbackStore(key, adapter) {
  if (!key || typeof key !== 'string') throw new Error('feedback store key required');
  if (!adapter
    || typeof adapter.hydrate !== 'function'
    || typeof adapter.append !== 'function'
    || typeof adapter.appendOutcomeResolution !== 'function'
    || typeof adapter.clear !== 'function') {
    throw new Error(`adapter ${key} missing required methods (hydrate/append/appendOutcomeResolution/clear)`);
  }
  _adapters.set(key, adapter);
}

export function setActiveFeedbackStore(key) {
  const adapter = _adapters.get(key);
  if (!adapter) throw new Error(`no feedback store registered under key '${key}'`);
  _adapters.set(_ACTIVE_KEY, adapter);
}

export function getFeedbackStore() {
  return _adapters.get(_ACTIVE_KEY)
      || _adapters.get(DEFAULT_FEEDBACK_STORE_KEY)
      || null;
}

export function listFeedbackStores() {
  return [..._adapters.keys()].filter(k => k !== _ACTIVE_KEY);
}

// ── FeedbackLogStore contract ───────────────────────────────────
// Every adapter (localStorage today, Azure Blob WORM later) implements:
//
//   {
//     name: string,                          // 'localStorage' | 'azure-blob-worm' | ...
//     async hydrate() → FeedbackEntry[],     // read-all at boot; empty [] on error
//     async append(entry) → void,            // WORM-safe: writes ONE entry, never rewrites container
//     async appendOutcomeResolution(         // WORM-safe substitute for retro-fill mutation
//       eventId, { status, label, resolvedAt }
//     ) → void,
//     async clear() → void,                  // dev-only; WORM adapter may throw or no-op
//   }
//
// Read path is served from the in-memory cache in feedback_log.js —
// the store never handles queries. If a future auditor tool needs
// server-side query, add a separate `queryRemote(filter)` method on
// the specific adapter; don't grow the base contract.
