// ═══════════════════════════════════════════════════════════════════════════
// ISR Systems · Vejdirektoratet Dataudveksleren AMQP Proxy
// ═══════════════════════════════════════════════════════════════════════════
//
// Subscribes to the Azure Service Bus topic subscription that Vejdirektoratet
// exposes for a Dataudveksleren dataset (e.g. dataset 222 = OOV2
// Trafikmeldinger, DATEX II Situation records). Authenticates via Azure AD
// service principal (client_credentials). Forwards each received message
// as JSON over WebSocket to browser C2 clients.
//
// Contract with frontend: sovereign_live_feeds.js VejdirektoratetTrafficProvider
//   messages: { type: 'traffic-batch', events: [{ id, situationXml, receivedAt }] }
//
// Deployment: Scaleway serverless container. Set env vars from .env.local
// values plus:
//   VD_AAD_TENANT_ID
//   VD_AAD_CLIENT_ID
//   VD_AAD_CLIENT_SECRET
//   VD_SB_FQDN          (host from AMQP url, e.g. sb-duvproddistribution.servicebus.windows.net)
//   VD_SB_TOPIC         (topic name, e.g. t-distribution-222)
//   VD_SB_SUBSCRIPTION  (subscription GUID from AMQP url path)
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { ServiceBusClient } from '@azure/service-bus';
import { ClientSecretCredential } from '@azure/identity';

// ── Config ──────────────────────────────────────────────────────────────
const CFG = {
  aadTenant: requireEnv('VD_AAD_TENANT_ID'),
  aadClient: requireEnv('VD_AAD_CLIENT_ID'),
  aadSecret: requireEnv('VD_AAD_CLIENT_SECRET'),
  sbFqdn: requireEnv('VD_SB_FQDN'),
  sbTopic: requireEnv('VD_SB_TOPIC'),
  sbSubscription: requireEnv('VD_SB_SUBSCRIPTION'),
  wsPort: parseInt(process.env.PORT || '8080', 10),
  wsPath: process.env.WS_PATH || '/traffic',
  eventTtlMs: parseInt(process.env.EVENT_TTL_MS || String(30 * 60 * 1000), 10),
  logLevel: process.env.LOG_LEVEL || 'info',
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function log(level, msg, extra) {
  const rank = { debug: 0, info: 1, warn: 2, error: 3 };
  if (rank[level] < rank[CFG.logLevel]) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (extra !== undefined) console.log(line, extra); else console.log(line);
}

// ── State: latest known Situations, keyed by DATEX II situation id ─────
// Vejdirektoratet sends full re-publications periodically plus per-update
// deltas. We dedupe by (id, versionTime) and prune older than eventTtlMs.
const eventsById = new Map(); // id -> { id, situationXml, receivedAt, versionTime }
const clients = new Set();    // Set<{ws}>

// ── Azure Service Bus receiver ─────────────────────────────────────────
const credential = new ClientSecretCredential(CFG.aadTenant, CFG.aadClient, CFG.aadSecret);
const sbClient = new ServiceBusClient(CFG.sbFqdn, credential);

async function startReceiver() {
  log('info', `Subscribing to ${CFG.sbFqdn}/${CFG.sbTopic}/subscriptions/${CFG.sbSubscription}...`);
  const receiver = sbClient.createReceiver(CFG.sbTopic, CFG.sbSubscription, {
    receiveMode: 'peekLock',
    subQueueType: undefined,
  });

  receiver.subscribe({
    async processMessage(msg) {
      try {
        const body = typeof msg.body === 'string' ? msg.body : Buffer.isBuffer(msg.body) ? msg.body.toString('utf8') : String(msg.body ?? '');
        // Body is DATEX II XML (PayloadPublication with one or more Situations).
        // Extract Situation id from the first Situation for dedup — cheap
        // string scan avoids pulling in an XML parser server-side.
        const idMatch = body.match(/<sit:Situation\b[^>]*\sid="([^"]+)"/);
        const verMatch = body.match(/<sit:situationVersionTime>([^<]+)<\/sit:situationVersionTime>/);
        const id = idMatch ? idMatch[1] : (msg.messageId || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        const versionTime = verMatch ? verMatch[1] : null;
        eventsById.set(id, {
          id,
          situationXml: body,
          receivedAt: new Date().toISOString(),
          versionTime,
        });
        broadcast({ type: 'traffic-event', event: eventsById.get(id) });
        await receiver.completeMessage(msg);
        log('debug', `event ${id} processed (versionTime=${versionTime})`);
      } catch (err) {
        log('warn', 'processMessage failed', err.message);
        try { await receiver.abandonMessage(msg); } catch (_) {}
      }
    },
    async processError(args) {
      log('error', `Service Bus error [${args.errorSource}]`, args.error?.message || args.error);
    },
  }, {
    autoCompleteMessages: false,
    maxConcurrentCalls: 4,
  });
}

// ── TTL sweep (drop Situations older than TTL from in-memory cache) ────
setInterval(() => {
  const cutoff = Date.now() - CFG.eventTtlMs;
  for (const [id, ev] of eventsById) {
    if (new Date(ev.receivedAt).getTime() < cutoff) eventsById.delete(id);
  }
}, 60_000).unref();

// ── WebSocket broadcast ────────────────────────────────────────────────
function broadcast(payload) {
  const json = JSON.stringify(payload);
  for (const client of clients) {
    if (client.ws.readyState !== 1) continue;
    try { client.ws.send(json); } catch (err) { log('debug', 'ws send failed', err.message); }
  }
}

// ── HTTP + WebSocket server ────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      eventsKnown: eventsById.size,
      clients: clients.size,
    }));
    return;
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: CFG.wsPath });

wss.on('connection', (ws) => {
  const client = { ws };
  clients.add(client);
  log('info', `client connected. total=${clients.size}`);

  // Snapshot: send everything currently cached so late-joiners see all
  // active Situations, not just deltas going forward.
  const snapshot = [...eventsById.values()];
  if (snapshot.length) {
    try { ws.send(JSON.stringify({ type: 'traffic-batch', events: snapshot })); } catch (_) {}
  }

  ws.on('close', () => {
    clients.delete(client);
    log('info', `client disconnected. total=${clients.size}`);
  });
  ws.on('error', (err) => log('debug', 'ws error', err.message));
});

httpServer.listen(CFG.wsPort, async () => {
  log('info', `VD AMQP proxy listening on :${CFG.wsPort}${CFG.wsPath}`);
  try {
    await startReceiver();
  } catch (err) {
    log('error', 'Failed to start Service Bus receiver', err.message);
    process.exit(1);
  }
});

// ── Graceful shutdown ──────────────────────────────────────────────────
async function shutdown() {
  log('info', 'shutting down...');
  try { await sbClient.close(); } catch (_) {}
  for (const c of clients) try { c.ws.close(); } catch (_) {}
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
