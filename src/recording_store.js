// Recording store — IndexedDB-backed persistence for trajectory
// recordings. Replaces the localStorage `isr_trajectory_*` keys.
//
// Why IndexedDB, not localStorage:
//   - localStorage has a ~5MB soft cap per origin. A single 300s
//     5-drone swarm recording is ~600KB. Two of those + the other
//     agentic caches (narrative, digest, preprocessed) blows past
//     the cap and downstream writes silently fail.
//   - IndexedDB quotas are measured in tens of MB up to GB depending
//     on browser + free disk. Designed for structured data.
//   - Per Lucas's rule: nothing auto-evicts. Event evidence persists
//     until operator explicitly clears via __isr_clearAllSimData().
//
// Compatible with the eventual Azure backend integration: this is
// the browser-local client cache layer. When Azure lands, the sync
// pattern is fetch-from-server → cache-locally-in-IDB → serve to UI.
// No architectural lock-in either direction.
//
// Public API is Promise-based (IDB is async by construction). Sync
// callers in main.js consume through an in-memory Map that this
// module populates on load — see _loadedRecordings + ensureRecording
// in main.js.

const DB_NAME = 'isr_recordings';
const DB_VERSION = 1;
const STORE_NAME = 'trajectories';

let _dbPromise = null;

function _openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available in this environment'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'eventId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB open failed'));
    req.onblocked = () => reject(new Error('IDB open blocked by another connection'));
  });
  return _dbPromise;
}

function _tx(mode) {
  return _openDb().then(db => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
}

// ─────────────────────────────────────────────────────────────
// Public API — all promise-returning.
// ─────────────────────────────────────────────────────────────

export async function saveRecording(eventId, recording) {
  if (!eventId || !recording) return;
  try {
    const store = await _tx('readwrite');
    await new Promise((resolve, reject) => {
      const req = store.put({ eventId, recording, savedAt: new Date().toISOString() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // IDB quota errors are much rarer than localStorage's, but still
    // possible on very heavy usage. Log loudly and let caller decide;
    // never auto-evict.
    console.error(`[recording_store] saveRecording failed for ${eventId}`, err);
    throw err;
  }
}

export async function loadRecording(eventId) {
  if (!eventId) return null;
  try {
    const store = await _tx('readonly');
    return await new Promise((resolve, reject) => {
      const req = store.get(eventId);
      req.onsuccess = () => resolve(req.result?.recording || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[recording_store] loadRecording failed for ${eventId}`, err);
    return null;
  }
}

export async function deleteRecording(eventId) {
  if (!eventId) return;
  try {
    const store = await _tx('readwrite');
    await new Promise((resolve, reject) => {
      const req = store.delete(eventId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[recording_store] deleteRecording failed for ${eventId}`, err);
  }
}

export async function listRecordingIds() {
  try {
    const store = await _tx('readonly');
    return await new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[recording_store] listRecordingIds failed', err);
    return [];
  }
}

// Wipe every trajectory from the store. Called by
// window.__isr_clearAllSimData() when the operator explicitly
// requests a full data clear. Never fires automatically.
export async function clearAll() {
  try {
    const store = await _tx('readwrite');
    await new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return true;
  } catch (err) {
    console.warn('[recording_store] clearAll failed', err);
    return false;
  }
}

// One-shot boot-time migration: scan localStorage for any legacy
// `isr_trajectory_*` entries, copy them into IDB, remove from
// localStorage on success. Called by main.js on boot. Idempotent —
// no-op if localStorage has no matching keys. Returns count migrated.
export async function migrateFromLocalStorage(prefix) {
  const legacyKeys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) legacyKeys.push(k);
    }
  } catch (_) { return 0; }
  if (!legacyKeys.length) return 0;
  let migrated = 0;
  for (const k of legacyKeys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const recording = JSON.parse(raw);
      const eventId = k.slice(prefix.length);
      await saveRecording(eventId, recording);
      localStorage.removeItem(k);
      migrated++;
    } catch (err) {
      console.warn(`[recording_store] migration failed for ${k}, leaving in localStorage`, err);
    }
  }
  if (migrated) console.log(`[recording_store] migrated ${migrated} legacy trajectory recording(s) from localStorage to IndexedDB`);
  return migrated;
}
