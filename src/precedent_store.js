// Precedent store — IndexedDB-backed persistence for the precedent
// index (Agent B "PRIOR SIMILAR EVENTS" retrieval source).
//
// Why this exists:
//   Before: precedent_index rebuilt from EVENTS on every page reload.
//   Precedents from a prior session vanished — cross-session
//   precedent retrieval was a marketing claim, not a real behavior.
//   This module persists PrecedentRecords across reloads so Agent B
//   actually sees historical events at the site.
//
// Separate DB from recording_store on purpose:
//   - Different lifecycle (recordings are big + wiped on demand;
//     precedents are small + persist as the customer accumulates
//     event history).
//   - Version-bumping the precedent schema shouldn't invalidate any
//     recording data or vice versa.
//
// Version invalidation:
//   At hydrate time, records whose `version` field doesn't match
//   PRECEDENT_INDEX_VERSION are discarded + deleted from IDB. Bump
//   the version in precedent_index.js when the feature vector shape
//   changes. Recording_store.js has no equivalent because trajectory
//   shape is stable; precedent feature vectors will evolve.
//
// Azure fit:
//   When Azure AI Search lands, this module gets a second implementation
//   (or is replaced entirely). The precedent_index public API stays
//   sync via a write-through in-memory cache — this store is the
//   swappable "backend" behind that cache. See
//   docs/agentic-precedent-retrieval-architecture.md.

const DB_NAME = 'isr_precedents';
const DB_VERSION = 1;
const STORE_NAME = 'records';

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
// Public API — all promise-returning. precedent_index consumes
// these behind its sync in-memory Map so retrieval stays sync.
// ─────────────────────────────────────────────────────────────

export async function savePrecedent(record) {
  if (!record?.eventId) return;
  try {
    const store = await _tx('readwrite');
    await new Promise((resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[precedent_store] savePrecedent failed for ${record.eventId}`, err);
    // NOT rethrowing — precedent persistence is a nice-to-have, must
    // never break the register path in precedent_index.registerEvent.
  }
}

export async function loadAllPrecedents() {
  try {
    const store = await _tx('readonly');
    return await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[precedent_store] loadAllPrecedents failed', err);
    return [];
  }
}

export async function deletePrecedent(eventId) {
  if (!eventId) return;
  try {
    const store = await _tx('readwrite');
    await new Promise((resolve, reject) => {
      const req = store.delete(eventId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[precedent_store] deletePrecedent failed for ${eventId}`, err);
  }
}

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
    console.warn('[precedent_store] clearAll failed', err);
    return false;
  }
}
