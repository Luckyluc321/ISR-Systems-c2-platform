// NN source registry — per-site routing decision. Given a siteId, returns
// the NnOutputSource instance that owns that site's detections. Reads two
// config surfaces:
//
//   1. window.__ISR_FORCE_ALL_MOCK — global override. When true, every
//      site routes to mock regardless of per-site config. Used for
//      demo recording sessions, offline simulation runs, and any time
//      the environment must not touch real hardware.
//
//   2. SITE_SOURCE_CONFIG — per-site declarations. Sites not listed
//      default to mock, so a new site added to SITES gets working
//      simulation-driven detections with zero registry changes. Live
//      wiring is added by flipping the entry from mock to websocket
//      when the field node ships.
//
// The registry lazy-constructs source instances the first time a siteId
// is requested and caches them for the lifetime of the page. Downstream
// code always receives the same source instance for the same siteId,
// which is required for the source's onDetection subscribers to remain
// attached across ticks.
//
// See docs/interface-design-document.md IF-1 for the full contract.

import { MockNnOutputSource, WebSocketNnOutputSource } from './nn_source.js';

// ─────────────────────────────────────────────────────────────────────
// Per-site source declarations.
//
// Structure:
//   siteId: { source: 'mock' | 'websocket', url?: string, auth?: string }
//
// Sites not listed default to mock. Adding a live field node is a one-
// line change: flip the entry from { source: 'mock' } to
// { source: 'websocket', url: 'wss://...', auth: '<token>' }.
// ─────────────────────────────────────────────────────────────────────
export const SITE_SOURCE_CONFIG = {
  // Every site currently ships against mock — no field hardware is
  // wired yet. Entries are listed explicitly so the registry surface
  // is visible in the code and each new field deployment is a diff
  // that reviewers can see, not a silent default flip. Sites not
  // listed here still default to mock via the fallback in _buildSource.
  cph:                            { source: 'mock' },
  esbjerg:                        { source: 'mock' },
  billund:                        { source: 'mock' },
  energinet_hovegaard:            { source: 'mock' },
  energinet_bjaeverskov:          { source: 'mock' },
  energinet_landerupgaard:        { source: 'mock' },
  energinet_kassoe:               { source: 'mock' },
  energinet_ferslev:              { source: 'mock' },
  energinet_amager_koblingsstation: { source: 'mock' },
};

// Runtime cache — one source instance per siteId. Cleared by
// resetRegistry() (test hook + hot-reload safety).
const _sourceCache = new Map();

function _forceAllMock() {
  try {
    return !!(typeof window !== 'undefined' && window.__ISR_FORCE_ALL_MOCK);
  } catch (_) {
    return false;
  }
}

function _buildSource(siteId) {
  if (_forceAllMock()) {
    return new MockNnOutputSource(siteId);
  }
  const cfg = SITE_SOURCE_CONFIG[siteId];
  if (cfg?.source === 'websocket' && cfg.url) {
    return new WebSocketNnOutputSource(siteId, cfg.url, { auth: cfg.auth });
  }
  // Default (undefined or explicit 'mock') → mock.
  return new MockNnOutputSource(siteId);
}

// Return the source for a siteId. First call constructs + start()s it
// and caches. Subsequent calls return the cached instance.
export function getSourceFor(siteId) {
  if (!siteId) return null;
  let src = _sourceCache.get(siteId);
  if (!src) {
    src = _buildSource(siteId);
    src.start();
    _sourceCache.set(siteId, src);
  }
  return src;
}

// Iterate every currently-cached source. Used by the tick loop to push
// sim positions into every mock source per tick without knowing which
// sites are currently mock-routed.
export function forEachSource(cb) {
  for (const src of _sourceCache.values()) cb(src);
}

// Test hook + hot-reload safety. Stops every cached source and drops
// the cache so the next getSourceFor rebuilds from the current config
// + global override.
export function resetRegistry() {
  for (const src of _sourceCache.values()) {
    try { src.stop(); } catch (_) { /* swallow */ }
  }
  _sourceCache.clear();
}
