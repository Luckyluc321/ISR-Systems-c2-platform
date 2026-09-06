// ═══════════════════════════════════════════════════════════════════════════
// ISR Systems · AIS Proxy — AISStream.io upstream
// ═══════════════════════════════════════════════════════════════════════════
//
// Subscribes to the AISStream.io public WebSocket AIS feed (free tier,
// requires API key) for Danish waters, rebroadcasts parsed ship positions
// to browser WebSocket clients with per-client bbox filtering.
//
// Switched from Søfartsstyrelsen (DMA) TCP feed on 2026-09-03: the old
// ais2.dma.dk:4001 endpoint's DNS is dead and DMA now gates raw AIS
// behind a partnership agreement. AISStream.io is the fastest public
// alternative — free tier, JSON over WSS, bbox-filtered server-side.
//
// Contract with frontend: sovereign_live_feeds.js AisWebSocketProvider.
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

// ── Config (env vars) ────────────────────────────────────────────────────
const CFG = {
  aisStreamKey: process.env.AISSTREAM_API_KEY || '',
  aisStreamUrl: process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream',
  // Denmark waters bbox — [[NW lat, NW lon], [SE lat, SE lon]]. Server-side
  // filter, so we only receive ships within Danish maritime interest area.
  bboxNwLat: parseFloat(process.env.BBOX_NW_LAT || '58.5'),
  bboxNwLon: parseFloat(process.env.BBOX_NW_LON || '7.5'),
  bboxSeLat: parseFloat(process.env.BBOX_SE_LAT || '54.4'),
  bboxSeLon: parseFloat(process.env.BBOX_SE_LON || '15.6'),
  wsPort: parseInt(process.env.PORT || '8080', 10),
  wsPath: process.env.WS_PATH || '/ships',
  reconnectMs: parseInt(process.env.RECONNECT_MS || '5000', 10),
  batchIntervalMs: parseInt(process.env.BATCH_INTERVAL_MS || '1000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
};

function log(level, msg, extra) {
  const rank = { debug: 0, info: 1, warn: 2, error: 3 };
  if (rank[level] < rank[CFG.logLevel]) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (extra !== undefined) console.log(line, extra); else console.log(line);
}

// ── State: latest known position per MMSI ───────────────────────────────
const shipsByMmsi = new Map();   // mmsi (number) → last observed state
const clients = new Set();       // Set<{ws, bbox}>

// ── AISStream.io WebSocket client ───────────────────────────────────────
// Subscription payload shape per aisstream.io/documentation:
//   { APIKey, BoundingBoxes: [[[latA, lonA], [latB, lonB]]],
//     FilterMessageTypes: ["PositionReport", "ShipStaticData"] }
// Message shape received:
//   { MessageType: "PositionReport",
//     MetaData: { MMSI, ShipName, Latitude, Longitude, time_utc },
//     Message: { PositionReport: { Sog, Cog, TrueHeading, ... } } }
let upstream = null;
let upstreamReconnectTimer = null;

function connectAisStream() {
  if (!CFG.aisStreamKey) {
    log('error', 'AISSTREAM_API_KEY not set. Feed disabled. Register free at aisstream.io/account.');
    return;
  }
  log('info', `Connecting to AISStream.io upstream at ${CFG.aisStreamUrl}...`);
  upstream = new WebSocket(CFG.aisStreamUrl, { perMessageDeflate: true });

  upstream.on('open', () => {
    const subscription = {
      APIKey: CFG.aisStreamKey,
      BoundingBoxes: [[
        [CFG.bboxNwLat, CFG.bboxNwLon],
        [CFG.bboxSeLat, CFG.bboxSeLon],
      ]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    };
    upstream.send(JSON.stringify(subscription));
    log('info', `Subscribed to Danish waters bbox [${CFG.bboxNwLat},${CFG.bboxNwLon}] → [${CFG.bboxSeLat},${CFG.bboxSeLon}]`);
  });

  upstream.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch (err) {
      log('debug', 'bad JSON from AISStream', err.message);
      return;
    }
    handleAisStreamMessage(msg);
  });

  upstream.on('close', () => {
    log('warn', `AISStream closed. Reconnecting in ${CFG.reconnectMs}ms.`);
    if (upstreamReconnectTimer) clearTimeout(upstreamReconnectTimer);
    upstreamReconnectTimer = setTimeout(connectAisStream, CFG.reconnectMs);
  });

  upstream.on('error', (err) => {
    log('warn', 'AISStream socket error', err.message);
    // 'close' will fire after 'error' and handle reconnect.
  });
}

function handleAisStreamMessage(msg) {
  if (!msg || !msg.MetaData) return;
  const mmsi = msg.MetaData.MMSI;
  if (typeof mmsi !== 'number') return;

  const existing = shipsByMmsi.get(mmsi) || { mmsi };
  const merged = { ...existing };

  // Lat/Lon: AISStream puts them in MetaData for some message types and
  // inside Message.<Type>.Latitude/Longitude for others. Check both.
  // Live-verified 2026-09-03: some PositionReports carry lat/lon ONLY on
  // the inner payload, and the renderer rejects any ship without them.
  const p = msg.Message?.PositionReport
         || msg.Message?.StandardClassBPositionReport
         || msg.Message?.ExtendedClassBPositionReport
         || null;
  const lat = msg.MetaData.Latitude  ?? msg.MetaData.latitude  ?? p?.Latitude;
  const lon = msg.MetaData.Longitude ?? msg.MetaData.longitude ?? p?.Longitude;
  if (typeof lat === 'number' && typeof lon === 'number') {
    merged.lat = lat;
    merged.lon = lon;
    merged.ts = new Date().toISOString();
  }

  if (msg.MetaData.ShipName) {
    merged.name = String(msg.MetaData.ShipName).trim();
  }

  if (p) {
    // AIS "no data" sentinels: sog=102.3, cog=360, hdg=511
    if (typeof p.Sog === 'number' && p.Sog < 102.3) merged.sog = p.Sog;
    if (typeof p.Cog === 'number' && p.Cog < 360)   merged.cog = p.Cog;
    if (typeof p.TrueHeading === 'number' && p.TrueHeading !== 511) merged.heading = p.TrueHeading;
  }

  if (msg.MessageType === 'ShipStaticData' && msg.Message?.ShipStaticData) {
    const s = msg.Message.ShipStaticData;
    if (s.CallSign)   merged.callSign = String(s.CallSign).trim();
    if (s.Destination) merged.destination = String(s.Destination).trim();
    if (s.Type != null) merged.type = String(s.Type);
  }

  shipsByMmsi.set(mmsi, merged);
}

// ── Broadcast tick — flush per-client bbox-filtered batches ────────────
setInterval(() => {
  if (clients.size === 0) return;
  const now = Date.now();
  for (const [mmsi, s] of shipsByMmsi) {
    if (s.ts && (now - new Date(s.ts).getTime()) > 900_000) shipsByMmsi.delete(mmsi);
  }
  for (const client of clients) {
    if (client.ws.readyState !== 1) continue;
    const ships = filterByBbox([...shipsByMmsi.values()], client.bbox);
    if (ships.length === 0) continue;
    try {
      client.ws.send(JSON.stringify({ type: 'ship-batch', ships }));
    } catch (err) { log('debug', 'ws send failed', err.message); }
  }
}, CFG.batchIntervalMs);

function filterByBbox(ships, bbox) {
  if (!bbox) return ships;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return ships.filter(s =>
    typeof s.lat === 'number' && typeof s.lon === 'number' &&
    s.lat >= minLat && s.lat <= maxLat && s.lon >= minLon && s.lon <= maxLon
  );
}

// ── HTTP + WebSocket server (unchanged contract for browser clients) ────
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      shipsKnown: shipsByMmsi.size,
      clients: clients.size,
      upstreamConnected: upstream && upstream.readyState === WebSocket.OPEN,
      upstream: 'aisstream.io',
    }));
    return;
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: CFG.wsPath });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const bboxParam = url.searchParams.get('bbox');
  let bbox = null;
  if (bboxParam) {
    const parts = bboxParam.split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) bbox = parts;
  }
  const client = { ws, bbox };
  clients.add(client);
  log('info', `client connected. bbox=${bbox ? bbox.join(',') : 'none'}. total=${clients.size}`);

  ws.on('close', () => {
    clients.delete(client);
    log('info', `client disconnected. total=${clients.size}`);
  });
  ws.on('error', (err) => log('debug', 'ws error', err.message));

  // Immediate snapshot on connect
  const snapshot = filterByBbox([...shipsByMmsi.values()], bbox);
  if (snapshot.length) {
    try { ws.send(JSON.stringify({ type: 'ship-batch', ships: snapshot })); } catch (_) {}
  }
});

httpServer.listen(CFG.wsPort, () => {
  log('info', `AIS proxy listening on :${CFG.wsPort}${CFG.wsPath}`);
  connectAisStream();
});

// ── Graceful shutdown ───────────────────────────────────────────────────
function shutdown() {
  log('info', 'shutting down...');
  if (upstreamReconnectTimer) clearTimeout(upstreamReconnectTimer);
  if (upstream) try { upstream.close(); } catch (_) {}
  for (const c of clients) try { c.ws.close(); } catch (_) {}
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
