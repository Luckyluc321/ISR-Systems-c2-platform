// ═══════════════════════════════════════════════════════════════════
// Precedent Index — deterministic event feature-vector store
// ───────────────────────────────────────────────────────────────────
// In-memory Map<eventId, PrecedentRecord> rebuilt from EVENTS on load.
// Feature vectors are computed deterministically from event fields so
// the same event always produces the same vector — cache invalidation
// is version-bumped, not time-based.
//
// Storage swaps to Azure AI Search in production without touching the
// query interface in precedent_retrieval.js. See
// docs/agentic-precedent-retrieval-architecture.md.
//
// Detection-only stance: this index only records observed events and
// their outcomes. Nothing in this file makes decisions. Retrieval
// surfaces precedents to the operator via Agent B narrative — the
// operator still decides.
// ═══════════════════════════════════════════════════════════════════

import { savePrecedent, loadAllPrecedents, deletePrecedent, clearAll as _clearIdb } from './precedent_store.js';

export const PRECEDENT_INDEX_VERSION = 'v1.2026-09-05';

const _index = new Map();   // eventId -> PrecedentRecord

// Hydrate lifecycle. main() awaits hydrateFromIdb() at boot before
// any code path that fires Agent B can run. Retrieval stays sync
// because the in-memory Map is fully populated by the time the first
// retrieval call happens.
let _hydratePromise = null;
let _hydrated = false;

export function isHydrated() { return _hydrated; }

// ── PrecedentRecord shape ────────────────────────────────────────
// {
//   eventId, siteId, closedAt (ISO), outcome,
//   featureVector: number[],
//   featureFields: { asset_targeted, platform_family, cardinality_bucket, dwell_hash, approach_bucket, tier, had_class_transition },
//   summary: string,               // one-line human summary for prompt block
//   version: PRECEDENT_INDEX_VERSION,
// }

// ── Feature computation ──────────────────────────────────────────
// Every field maps to a stable numeric or hashed slot. The vector
// concatenation order MUST match between register + query — that's
// what makes cosine similarity meaningful.
//
// Cache invalidation: hydrateFromIdb() at boot filters records by
// PRECEDENT_INDEX_VERSION — mismatched records are dropped from the
// in-memory index and deleted from IDB. Bumping the constant auto-
// purges stale schema on next reload. New registrations always stamp
// the current version.

const _PLATFORM_FAMILY_SLOTS = ['quadcopter', 'hexacopter', 'fixed_wing_uav', 'fixed_wing_commercial', 'helicopter_civilian', 'helicopter_military', 'fixed_wing_military', 'loitering_munition', 'unknown'];
const _CARDINALITY_BUCKETS  = ['1', '2-3', '4-6', '7+'];
const _APPROACH_BUCKETS     = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const _TIER_SLOTS           = ['identify-only', 'transit', 'marginal', 'notable'];

function _oneHot(slots, value) {
  return slots.map(s => (s === value ? 1 : 0));
}

function _bucketCardinality(count) {
  const n = Number(count) || 1;
  if (n <= 1) return '1';
  if (n <= 3) return '2-3';
  if (n <= 6) return '4-6';
  return '7+';
}

function _bucketApproach(bearingDeg) {
  if (typeof bearingDeg !== 'number' || Number.isNaN(bearingDeg)) return null;
  // 8-way compass, N is [-22.5, 22.5)
  const norm = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.floor(((norm + 22.5) % 360) / 45);
  return _APPROACH_BUCKETS[idx];
}

// Stable hash of a sorted list of hotspot ids. Same set → same hash.
// Uses a small string hash — not cryptographic, just reproducible.
function _hashHotspotList(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const joined = [...ids].sort().join('|');
  let h = 0;
  for (let i = 0; i < joined.length; i++) {
    h = (h * 31 + joined.charCodeAt(i)) | 0;
  }
  return h;
}

// Same 4 slots reserved for dwell-hash — bucketed by low bits so
// similar dwell patterns land in the same slot. Not a great vector
// signal on its own but does contribute to non-identical events with
// overlapping asset sets being flagged as related.
function _dwellSlot(hash) {
  return [
    (hash & 0x1) ? 1 : 0,
    ((hash >> 1) & 0x1) ? 1 : 0,
    ((hash >> 2) & 0x1) ? 1 : 0,
    ((hash >> 3) & 0x1) ? 1 : 0,
  ];
}

export function computeFeatureVector(event) {
  const fields = extractFeatureFields(event);
  const vec = [
    ..._oneHot(_PLATFORM_FAMILY_SLOTS, fields.platform_family),
    ..._oneHot(_CARDINALITY_BUCKETS, fields.cardinality_bucket),
    ..._oneHot(_APPROACH_BUCKETS, fields.approach_bucket || 'N'),
    ..._oneHot(_TIER_SLOTS, fields.tier),
    fields.had_class_transition ? 1 : 0,
    ..._dwellSlot(fields.dwell_hash),
  ];
  return { vec, fields };
}

export function extractFeatureFields(event) {
  const subject = event.subject || {};
  const platform_family = subject.klass || event.platform || 'unknown';
  const cardinality_bucket = _bucketCardinality(event.droneCount);
  const approach_bucket = _bucketApproach(event.entry?.heading);
  const tier = event.notabilityTier || event.analysis?.notability?.tier || 'marginal';
  const had_class_transition = Array.isArray(subject.class_change_log) && subject.class_change_log.length > 0;
  const hotspotIds = event.analysis?.dwellProfile?.hotspotIds || [];
  const dwell_hash = _hashHotspotList(hotspotIds);
  const asset_targeted = event.analysis?.closestAssetApproach?.assetId || null;
  return {
    asset_targeted,
    platform_family,
    cardinality_bucket,
    approach_bucket,
    tier,
    had_class_transition,
    dwell_hash,
    hotspot_ids: hotspotIds,
  };
}

// One-line summary for the prompt block. Deterministic — no LLM.
export function buildSummary(event) {
  const droneType = event.droneType || event.platform || 'unknown platform';
  const dwellIds = event.analysis?.dwellProfile?.hotspotIds || [];
  const dwellStr = dwellIds.length ? `dwelled over ${dwellIds.slice(0, 2).join(' + ')}` : 'no significant dwell';
  const closest = event.analysis?.closestAssetApproach;
  const closestStr = closest ? `, closest approach ${closest.assetName || closest.assetId} at ${Math.round(closest.minDistanceM)}m` : '';
  const cls = event.classification || 'unknown';
  const outcome = event.outcome || 'no dispatch';
  return `${droneType}, ${dwellStr}${closestStr}. Classified ${cls}. Outcome: ${outcome}.`;
}

// ── Register / query ─────────────────────────────────────────────
export function registerEvent(event) {
  if (!event?.id) return null;
  if (!event.endTime && event.status !== 'closed') return null;   // only closed events
  const { vec, fields } = computeFeatureVector(event);
  const record = {
    eventId: event.id,
    siteId: event.siteId,
    tenantId: event.tenantId || null,
    closedAt: event.endTime || event.lastUpdated || new Date().toISOString(),
    outcome: event.outcome || null,
    featureVector: vec,
    featureFields: fields,
    summary: buildSummary(event),
    version: PRECEDENT_INDEX_VERSION,
  };
  _index.set(event.id, record);
  // Fire-and-forget IDB persistence — write-through cache. Sync
  // register API is preserved; retrieval sees the record immediately
  // via _index; cross-session persistence lands whenever the browser
  // flushes the IDB write.
  savePrecedent(record).catch(err => console.warn('[precedent_store] save failed:', err.message));
  return record;
}

export function unregisterEvent(eventId) {
  _index.delete(eventId);
  deletePrecedent(eventId).catch(err => console.warn('[precedent_store] delete failed:', err.message));
}

export function getRecord(eventId) {
  return _index.get(eventId) || null;
}

export function allRecords() {
  return [..._index.values()];
}

export function indexSize() {
  return _index.size;
}

export function clearIndex() {
  _index.clear();
  _clearIdb().catch(err => console.warn('[precedent_store] clearAll failed:', err.message));
}

// Bulk load — kept for tests / demo reseed. Boot no longer calls this
// (see hydrateFromIdb below). Callers passing an explicit EVENTS array
// still work; every registered event goes through the write-through
// path so persistence is preserved.
export function loadFromEvents(events) {
  let n = 0;
  for (const e of events) {
    if (registerEvent(e)) n++;
  }
  return n;
}

// ── IndexedDB hydration ─────────────────────────────────────────
// Called at boot from main.js. Reads every persisted PrecedentRecord
// from IDB, filters by matching PRECEDENT_INDEX_VERSION (stale schema
// records are deleted), and populates the in-memory Map. Returns the
// count of records hydrated.
//
// Idempotent — a second call returns the same in-flight promise
// (or a resolved one if already hydrated). Safe to await multiple
// times from different code paths.
//
// After this resolves, the sync retrieval API (allRecords /
// retrievePrecedents / buildPrecedentBlock) sees the full historical
// precedent index. Nothing else needs to change downstream.
export function hydrateFromIdb() {
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    let hydrated = 0;
    let discarded = 0;
    try {
      const rows = await loadAllPrecedents();
      for (const r of rows) {
        if (r?.version === PRECEDENT_INDEX_VERSION) {
          _index.set(r.eventId, r);
          hydrated++;
        } else {
          discarded++;
          // Fire-and-forget stale-version cleanup.
          deletePrecedent(r.eventId).catch(() => { /* ignore */ });
        }
      }
    } catch (err) {
      console.warn('[precedent_index] hydrate failed, index starts empty:', err?.message || err);
    }
    _hydrated = true;
    if (discarded) {
      console.log(`[precedent_index] hydrated ${hydrated} records, discarded ${discarded} stale-version records`);
    }
    return hydrated;
  })();
  return _hydratePromise;
}
