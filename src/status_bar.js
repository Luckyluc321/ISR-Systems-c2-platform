// ═══════════════════════════════════════════════════════════════════
// The bottom status bar's system cells.
// ───────────────────────────────────────────────────────────────────
// Five of the seven cells were literal text in index.html with no
// reference anywhere in main.js:
//
//   Model              v0.2-mixed
//   Detection latency  112 ms
//   Backend            nominal
//   Uptime             47:23:15          <- a frozen clock
//   Session            lucasaflindt · site-op
//
// The session cell put a personal username on screen for every customer
// who opened the platform, and a stopped uptime beside three invented
// metrics is the kind of detail that, once noticed, calls the two REAL
// cells next to it into question too.
//
// Everything here reports what is actually true, and reports absence as
// absence. A value nothing can measure yet renders as an em dash, never
// as a plausible number. That is the whole point: the cells go live on
// their own the moment there is something real behind them.
//
// COST. One 1 s interval, no network, no polling of anything. Each cell
// caches its last rendered string and only touches the DOM when it
// changes, so a quiet console writes nothing at all after the first
// pass. Uptime is the only cell that changes every second by nature.
// ═══════════════════════════════════════════════════════════════════

/** H:MM:SS from milliseconds. Hours are not zero padded; a console that
 *  has been open 3 hours should read 3:04:11, not 03:04:11. */
export function formatUptime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Who is signed in, as the status bar should say it.
 *  Never a username: the account's person and organisation. */
export function sessionLabel(role) {
  if (!role) return '—';
  const who = role.person || role.label || role.id || '—';
  const org = role.org && role.org !== who ? ` · ${role.org}` : '';
  return `${who}${org}`;
}

/** What is actually driving detections for the sites in scope.
 *  siteSources maps siteId -> 'mock' | something else. */
export function modelLabel(siteIds, siteSources, forceAllMock = false) {
  if (!Array.isArray(siteIds) || !siteIds.length) return '—';
  if (forceAllMock) return 'mock';
  const kinds = new Set(siteIds.map(sid => (siteSources?.[sid]?.source) || 'mock'));
  if (kinds.size === 1) return [...kinds][0];
  // Mixed is a real state and worth naming, but name the parts rather
  // than inventing a version string for it.
  return [...kinds].sort().join(' + ');
}

/** Feed health, derived from the feeds already registered. No pinging:
 *  a status bar must not generate traffic to describe itself. */
export function backendLabel(feeds) {
  if (!Array.isArray(feeds) || !feeds.length) return 'local';
  const active = feeds.filter(f => f.active);
  if (!active.length) return 'local';
  const live = active.filter(f => f.providerName && f.providerName !== 'mock');
  if (!live.length) return `mock · ${active.length} feed${active.length === 1 ? '' : 's'}`;
  return `${live.length} live`;
}

/** Latency is only real when something measured it. */
export function latencyLabel(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  return `${Math.round(ms)} ms`;
}

/**
 * @param deps.doc               document
 * @param deps.getRole           () => active account
 * @param deps.getVisibleSiteIds () => siteIds in scope for that account
 * @param deps.getSiteSources    () => SITE_SOURCE_CONFIG
 * @param deps.getFeeds          () => feed list, or null when unavailable
 * @param deps.isForcedMock      () => boolean
 * @param deps.now               () => ms, injected so tests need no clock
 */
export function createStatusBar(deps = {}) {
  const {
    doc,
    getRole = () => null,
    getVisibleSiteIds = () => [],
    getSiteSources = () => ({}),
    getFeeds = () => null,
    isForcedMock = () => false,
    now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  } = deps;

  const t0 = now();
  let timer = null;
  let lastDetectionLatencyMs = null;
  const cache = new Map();

  function paint(id, label, value) {
    if (!doc) return;
    const key = `${id}:${value}`;
    if (cache.get(id) === key) return;        // nothing changed, no DOM write
    const el = doc.getElementById(id);
    if (!el) return;
    el.innerHTML = `${label} <b>${value}</b>`;
    cache.set(id, key);
  }

  function update() {
    paint('sb-uptime', 'Uptime', formatUptime(now() - t0));
    paint('sb-session', 'Session', sessionLabel(getRole()));
    paint('sb-model', 'Model',
      modelLabel(getVisibleSiteIds(), getSiteSources(), isForcedMock()));
    paint('sb-backend', 'Backend', backendLabel(getFeeds()));
    paint('sb-latency', 'Detection latency', latencyLabel(lastDetectionLatencyMs));
  }

  return {
    update,
    /** Called by whatever actually observes a detection arriving. Until
     *  something does, the cell stays an em dash rather than a number. */
    noteDetectionLatency(ms) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) {
        lastDetectionLatencyMs = ms;
      }
    },
    start(intervalMs = 1000) {
      update();
      if (timer == null && typeof setInterval === 'function') {
        timer = setInterval(update, intervalMs);
      }
      return this;
    },
    stop() {
      if (timer != null) { clearInterval(timer); timer = null; }
    },
  };
}
