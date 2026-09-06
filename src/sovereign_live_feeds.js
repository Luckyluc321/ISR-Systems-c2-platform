// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN LIVE FEEDS — real-time streaming data providers
// ═══════════════════════════════════════════════════════════════════════════
//
// Companion to sovereign_layers.js (tile providers) and
// sovereign_services.js (REST lookups). Where those two handle static tiles
// and click-driven queries respectively, this module handles CONTINUOUS
// streams: ship positions, NOTAM updates, live traffic incidents.
//
// Design principles (identical to the other two modules):
//
//   1. DATA-DRIVEN. Every feed is one entry in LIVE_FEEDS. Adding a new
//      provider = one entry + one client class.
//
//   2. PROVIDER-ABSTRACTED. Each feed can have multiple concrete providers
//      (production DMA proxy / third-party aggregator / mock generator).
//      Selected by config, swapped without touching consumer code.
//
//   3. DEFAULT-OFF. Feeds only connect when explicitly enabled. Prevents
//      accidental bandwidth burn + external calls at boot.
//
//   4. LIFECYCLE-CLEAN. Every feed exposes { start, stop, isActive,
//      onUpdate(cb) }. Manager handles reconnect/backoff. Consumers just
//      subscribe to updates.
//
//   5. FEATURE-PRESERVING. Never touches Cesium directly. Consumers
//      (main.js) subscribe to updates and render however they want.
//      Photoreal profile can consume the same feeds if useful.
//
//   6. BACKEND-READY. Where a feed needs a server-side proxy (AIS TCP →
//      WebSocket), the client points at a URL from env config. Backend
//      code lives in scripts/ais-proxy/ (deployable to Scaleway/Azure).
//
// Update flow:
//
//   const mgr = initLiveFeeds({...tokens})
//   const feed = mgr.get('ais_ships')
//   feed.onUpdate(ships => { /* render ships on Cesium */ })
//   feed.start()
//   ...
//   feed.stop()
// ═══════════════════════════════════════════════════════════════════════════

// ── Feed categories ─────────────────────────────────────────────────────
export const FEED_CATEGORY = Object.freeze({
  MARITIME: 'maritime',   // AIS ships, VTS updates
  AVIATION: 'aviation',   // NOTAMs, live traffic
  ROAD: 'road',            // Vejdirektoratet incidents
});

// ── Feed registry ──────────────────────────────────────────────────────
export const LIVE_FEEDS = [
  {
    id: 'ais_ships',
    category: FEED_CATEGORY.MARITIME,
    provider: 'Søfartsstyrelsen (DMA) via Scaleway proxy',
    authority: 'Søfartsstyrelsen',
    name: 'AIS skibspositioner',
    description: 'Realtids skibstrafik i danske farvande. Kilde: DMA raw AIS feed (ais2.dma.dk:4001) via Scaleway proxy → WebSocket → browser. Bbox-filtreret per aktivt site.',
    providers: {
      mock: {
        type: 'mock',
        description: 'Genererer 8-12 syntetiske skibe der bevæger sig langs kendte danske sejlruter. Bruges når ingen backend-proxy er tilgængelig eller ved demo uden internet.',
      },
      scaleway: {
        type: 'websocket',
        description: 'Production AIS-proxy hostet på Scaleway (EU, EU-parented cloud).',
        urlEnv: 'VITE_AIS_WS_URL',   // set in .env.local to enable
        // Expected message shape from proxy:
        //   {mmsi, name, callSign, lat, lon, sog, cog, heading, type, ts}
      },
    },
    defaultProvider: 'mock',   // safe default until Scaleway proxy is deployed
    enabledByDefault: false,
  },
  {
    id: 'vd_traffic',
    category: FEED_CATEGORY.ROAD,
    provider: 'Vejdirektoratet · Dataudveksleren via vd-amqp-proxy',
    authority: 'Vejdirektoratet',
    name: 'Trafikhændelser (DATEX II)',
    description: 'Live traffic Situations (accidents, roadworks, congestion) pushed by Vejdirektoratet Dataudveksleren over Azure Service Bus. Server-side proxy (scripts/vd-amqp-proxy/) holds the AMQP connection and rebroadcasts DATEX II XML to browsers via WebSocket. Frontend parses with parseDatexIISituations() and renders point markers.',
    providers: {
      websocket: {
        type: 'vd-traffic-websocket',
        description: 'vd-amqp-proxy WebSocket. Local dev: ws://localhost:8080/traffic. Production: Scaleway wss URL.',
        urlEnv: 'VITE_VD_TRAFFIC_WS_URL',
      },
    },
    defaultProvider: 'websocket',
    enabledByDefault: false,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDERS
// ═══════════════════════════════════════════════════════════════════════════

// Base class contract every provider fulfils:
//   constructor(config, tokens)
//   start(bbox?)   — begin producing updates
//   stop()         — halt + cleanup (idempotent)
//   isActive       — boolean
//   onUpdate(cb)   — register callback(payload)
class BaseFeedProvider {
  constructor(config) {
    this.config = config || {};
    this._callbacks = new Set();
    this._active = false;
  }
  get isActive() { return this._active; }
  onUpdate(cb) { this._callbacks.add(cb); return () => this._callbacks.delete(cb); }
  _emit(payload) { for (const cb of this._callbacks) { try { cb(payload); } catch (err) { console.warn('[live_feed] callback threw:', err); } } }
  start(_bbox) { this._active = true; }
  stop() { this._active = false; }
}

// ── AIS Mock Provider ──────────────────────────────────────────────────
// Emits synthetic ship positions moving along fixed sejlruter around
// Danish waters. Purpose: demo capability without needing a Scaleway
// proxy deployed. Not for production use.
class AisMockProvider extends BaseFeedProvider {
  constructor(config) {
    super(config);
    this._tickHandle = null;
    // Seed ships along the North Sea / Kattegat / Storebælt / Øresund
    // corridors + Esbjerg approach. Real bounding boxes.
    this._ships = [
      { mmsi: 219000001, name: 'MAERSK ALFIRK', callSign: 'OYBK2', type: 'CARGO',      lat: 55.470, lon: 8.400,  sog: 12.5, cog: 90,  heading: 90  },
      { mmsi: 219000002, name: 'ESVAGT NEXUS',  callSign: 'OWCP2', type: 'SUPPLY',     lat: 55.485, lon: 8.435,  sog: 8.2,  cog: 275, heading: 275 },
      { mmsi: 219000003, name: 'FJORD LINE STAVANGERFJORD', callSign: 'LATH', type: 'PASSENGER', lat: 57.850, lon: 10.680, sog: 22.1, cog: 175, heading: 175 },
      { mmsi: 219000004, name: 'DFDS PEARL SEAWAYS',        callSign: 'OYSA2', type: 'PASSENGER', lat: 56.150, lon: 12.610, sog: 18.7, cog: 0,   heading: 0   },
      { mmsi: 219000005, name: 'MERANTI ARCTIC',             callSign: 'OYDU',  type: 'TANKER',    lat: 55.620, lon: 12.720, sog: 10.1, cog: 175, heading: 175 },
      { mmsi: 219000006, name: 'GOTLAND SOFIA',               callSign: 'SBGZ',  type: 'CARGO',     lat: 55.310, lon: 11.050, sog: 14.0, cog: 90,  heading: 90  },
      { mmsi: 219000007, name: 'DANNEBROG',                   callSign: 'OUYH',  type: 'GOVERNMENT',lat: 55.200, lon: 12.590, sog: 6.4,  cog: 340, heading: 340 },
      { mmsi: 219000008, name: 'MOLSLINJEN EXPRESS 4',        callSign: 'OYYA2', type: 'PASSENGER', lat: 56.130, lon: 10.520, sog: 27.3, cog: 240, heading: 240 },
    ];
  }
  start(_bbox) {
    if (this._active) return;
    super.start();
    // 1-second tick, small position drift per ship
    this._tickHandle = setInterval(() => {
      const now = new Date().toISOString();
      const updates = this._ships.map(s => {
        // rough: 1 knot ≈ 0.000005 deg lat/sec at Danish latitudes
        const distDeg = (s.sog / 3600) / 60;
        const cogRad = (s.cog * Math.PI) / 180;
        s.lat += distDeg * Math.cos(cogRad);
        s.lon += (distDeg * Math.sin(cogRad)) / Math.cos((s.lat * Math.PI) / 180);
        return { ...s, ts: now };
      });
      this._emit({ type: 'ship-batch', ships: updates });
    }, 1000);
  }
  stop() {
    if (!this._active) return;
    super.stop();
    if (this._tickHandle) { clearInterval(this._tickHandle); this._tickHandle = null; }
  }
}

// ── AIS WebSocket Provider ─────────────────────────────────────────────
// Connects to a Scaleway-hosted AIS proxy (scripts/ais-proxy/ deployable
// module). Proxy handles DMA TCP → NMEA parse → WebSocket. Client just
// consumes JSON ship-update messages. Auto-reconnect with backoff.
class AisWebSocketProvider extends BaseFeedProvider {
  constructor(config) {
    super(config);
    this._ws = null;
    this._retryMs = 2000;
    this._reconnectTimer = null;
    this._url = config.url;
  }
  start(bbox) {
    if (this._active) return;
    if (!this._url) {
      console.warn('[live_feed:ais_ships] no WebSocket URL configured. Set VITE_AIS_WS_URL in .env.local, or fall back to mock provider.');
      return;
    }
    super.start();
    this._bbox = bbox;
    this._connect();
  }
  _connect() {
    if (!this._active) return;
    try {
      const url = this._bbox
        ? `${this._url}?bbox=${this._bbox.join(',')}`
        : this._url;
      this._ws = new WebSocket(url);
      this._ws.onopen = () => {
        console.log('[live_feed:ais_ships] WS connected.');
        this._retryMs = 2000;
      };
      this._ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this._emit(payload);
        } catch (err) { console.warn('[live_feed:ais_ships] bad message:', err); }
      };
      this._ws.onclose = () => {
        console.log(`[live_feed:ais_ships] WS closed. Reconnecting in ${this._retryMs}ms.`);
        if (this._active) this._scheduleReconnect();
      };
      this._ws.onerror = (err) => {
        console.warn('[live_feed:ais_ships] WS error:', err);
      };
    } catch (err) {
      console.warn('[live_feed:ais_ships] connect failed:', err);
      this._scheduleReconnect();
    }
  }
  _scheduleReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._connect(), this._retryMs);
    this._retryMs = Math.min(this._retryMs * 2, 30000);   // exp backoff, cap 30s
  }
  stop() {
    if (!this._active) return;
    super.stop();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) { try { this._ws.close(); } catch (_) {} this._ws = null; }
  }
}

// ── Vejdirektoratet Traffic WebSocket Provider ─────────────────────────
// Consumes DATEX II Situations pushed by scripts/vd-amqp-proxy/ (which
// subscribes to Azure Service Bus and rebroadcasts as WebSocket JSON).
// Message shapes from proxy:
//   { type: 'traffic-batch', events: [{ id, situationXml, receivedAt, versionTime }] }
//   { type: 'traffic-event', event:  { id, situationXml, receivedAt, versionTime } }
// The provider forwards them unchanged; consumer parses situationXml with
// parseDatexIISituations() from sovereign_renderers.js.
class VejdirektoratetTrafficProvider extends BaseFeedProvider {
  constructor(config) {
    super(config);
    this._ws = null;
    this._retryMs = 2000;
    this._reconnectTimer = null;
    this._url = config.url;
  }
  start() {
    if (this._active) return;
    if (!this._url) {
      console.warn('[live_feed:vd_traffic] no WebSocket URL configured. Set VITE_VD_TRAFFIC_WS_URL in .env.local (points at scripts/vd-amqp-proxy/ deployment).');
      return;
    }
    super.start();
    this._connect();
  }
  _connect() {
    if (!this._active) return;
    try {
      this._ws = new WebSocket(this._url);
      this._ws.onopen = () => {
        console.log('[live_feed:vd_traffic] WS connected.');
        this._retryMs = 2000;
      };
      this._ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this._emit(payload);
        } catch (err) { console.warn('[live_feed:vd_traffic] bad message:', err); }
      };
      this._ws.onclose = () => {
        console.log(`[live_feed:vd_traffic] WS closed. Reconnecting in ${this._retryMs}ms.`);
        if (this._active) this._scheduleReconnect();
      };
      this._ws.onerror = (err) => {
        console.warn('[live_feed:vd_traffic] WS error:', err);
      };
    } catch (err) {
      console.warn('[live_feed:vd_traffic] connect failed:', err);
      this._scheduleReconnect();
    }
  }
  _scheduleReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._connect(), this._retryMs);
    this._retryMs = Math.min(this._retryMs * 2, 30000);
  }
  stop() {
    if (!this._active) return;
    super.stop();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) { try { this._ws.close(); } catch (_) {} this._ws = null; }
  }
}

const _PROVIDER_CLASSES = {
  mock: AisMockProvider,
  websocket: AisWebSocketProvider,
  'vd-traffic-websocket': VejdirektoratetTrafficProvider,
};

// ═══════════════════════════════════════════════════════════════════════════
// MANAGER
// ═══════════════════════════════════════════════════════════════════════════

class LiveFeedsManager {
  constructor(tokens, envUrls) {
    this._tokens = tokens || {};
    this._envUrls = envUrls || {};
    this._feeds = new Map();
    for (const entry of LIVE_FEEDS) {
      const providerName = this._pickProvider(entry);
      const providerCfg = entry.providers[providerName];
      const url = providerCfg.urlEnv ? this._envUrls[providerCfg.urlEnv] : null;
      const ProviderClass = _PROVIDER_CLASSES[providerCfg.type];
      if (!ProviderClass) { console.warn(`[live_feeds] no class for type "${providerCfg.type}"`); continue; }
      const instance = new ProviderClass({ ...providerCfg, url });
      this._feeds.set(entry.id, { entry, providerName, provider: instance });
    }
  }
  // Pick provider: prefer scaleway if URL configured, else fall back to
  // the entry's defaultProvider (usually mock).
  _pickProvider(entry) {
    for (const [name, cfg] of Object.entries(entry.providers)) {
      if (cfg.urlEnv && this._envUrls[cfg.urlEnv]) return name;
    }
    return entry.defaultProvider || 'mock';
  }
  get(id) { return this._feeds.get(id); }
  list() {
    return [...this._feeds.values()].map(({ entry, providerName, provider }) => ({
      id: entry.id,
      category: entry.category,
      name: entry.name,
      description: entry.description,
      active: provider.isActive,
      providerName,
    }));
  }
  start(id, bbox) { const rec = this._feeds.get(id); if (rec) rec.provider.start(bbox); }
  stop(id) { const rec = this._feeds.get(id); if (rec) rec.provider.stop(); }
  stopAll() { for (const { provider } of this._feeds.values()) provider.stop(); }
}

let _instance = null;

export function initLiveFeeds(tokens = {}, envUrls = {}) {
  if (_instance) { console.warn('[live_feeds] already initialised.'); return _instance; }
  _instance = new LiveFeedsManager(tokens, envUrls);
  if (typeof window !== 'undefined') {
    window.__isr_live_feeds = {
      list: () => _instance.list(),
      start: (id, bbox) => _instance.start(id, bbox),
      stop: (id) => _instance.stop(id),
      get: (id) => _instance.get(id),
      subscribe: (id, cb) => {
        const rec = _instance.get(id);
        if (!rec) { console.warn(`[live_feeds] no feed "${id}"`); return () => {}; }
        return rec.provider.onUpdate(cb);
      },
    };
    console.log('[live_feeds] window.__isr_live_feeds ready. Try: __isr_live_feeds.list() / .start("ais_ships") / .subscribe("ais_ships", console.log)');
  }
  return _instance;
}

export function getLiveFeedsManager() { return _instance; }
