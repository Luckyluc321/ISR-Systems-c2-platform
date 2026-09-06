// ═══════════════════════════════════════════════════════════════════
// LocalStorage feedback-log adapter — default backend today
// ───────────────────────────────────────────────────────────────────
// Preserves the pre-adapter feedback_log.js behavior byte-for-byte:
//   - Storage key: 'isr:feedback_log:v1'
//   - 5000-entry FIFO cap on append
//   - Quota-exceeded: halve then silently drop
//   - Outcome retro-fill: in-place mutation of matching entries
//     (localStorage is mutable, so this works; WORM adapter uses
//     append-only resolution entries via the same interface method)
//
// Self-registers under 'localStorage' + DEFAULT_FEEDBACK_STORE_KEY on
// import. Azure Blob WORM adapter, when it lands, registers under
// 'azure-blob-worm' + calls `setActiveFeedbackStore('azure-blob-worm')`
// during environment-specific boot.
// ═══════════════════════════════════════════════════════════════════

import { registerFeedbackStore, DEFAULT_FEEDBACK_STORE_KEY } from '../feedback_log_store.js';

const STORAGE_KEY = 'isr:feedback_log:v1';
const MAX_ENTRIES = 5000;

function _readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

function _writeAll(list) {
  try {
    const trimmed = list.length > MAX_ENTRIES ? list.slice(-MAX_ENTRIES) : list;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // Quota exceeded — drop half and retry once, then silently give up
    // rather than break the operator's action. Same behavior as the
    // pre-adapter fallback in feedback_log.js.
    try {
      const halved = list.slice(-Math.floor(list.length / 2));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(halved));
    } catch (_) {
      console.warn('[feedback_log_localstorage] localStorage full, entry dropped:', err.message);
    }
  }
}

const localStorageAdapter = {
  name: 'localStorage',

  async hydrate() {
    if (typeof localStorage === 'undefined') return [];
    return _readAll();
  },

  async append(entry) {
    if (typeof localStorage === 'undefined') return;
    if (!entry?.id) return;
    const list = _readAll();
    list.push(entry);
    _writeAll(list);
  },

  // In-place retro-fill for localStorage. WORM adapter will emit a
  // NEW resolution entry instead; feedback_log.js reconstructor sees
  // the same effect either way.
  async appendOutcomeResolution(eventId, { status, label, resolvedAt }) {
    if (typeof localStorage === 'undefined') return;
    if (!eventId) return;
    const list = _readAll();
    let updated = 0;
    for (const e of list) {
      if (e.eventId !== eventId) continue;
      if (e.outcome?.status === status && e.outcome?.label === label) continue;
      e.outcome = { status: status || 'unknown', label: label || null, resolvedAt };
      updated++;
    }
    if (updated > 0) _writeAll(list);
  },

  async clear() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
  },
};

registerFeedbackStore('localStorage', localStorageAdapter);
registerFeedbackStore(DEFAULT_FEEDBACK_STORE_KEY, localStorageAdapter);

export default localStorageAdapter;
