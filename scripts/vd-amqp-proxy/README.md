# Vejdirektoratet AMQP Proxy

Subscribes to Vejdirektoratet Dataudveksleren over Azure Service Bus (AMQP 1.0),
rebroadcasts DATEX II Situation records to browser C2 clients over WebSocket.

## Why this exists

Vejdirektoratet publishes traffic events (accidents, roadworks, congestion) as
DATEX II XML pushed to Azure Service Bus topics. A browser cannot open an
AMQP 1.0 connection nor authenticate to Azure AD with a client secret, so this
proxy holds the persistent AMQP connection server-side and fans out to any
browsers that connect via WebSocket.

## Local run

```bash
cd scripts/vd-amqp-proxy
npm install

# Values from du-portal-ui subscription detail page (Luckyluc123 -> dataset 222):
#   AMQP URL: amqps://<host>/<topic>/<subscription>
export VD_AAD_TENANT_ID="f1044067-8c60-4022-98d8-69306c5f7238"
export VD_AAD_CLIENT_ID="400b03a9-3bed-4456-8ce5-c98615930465"
export VD_AAD_CLIENT_SECRET="<adgangskode from portal>"
export VD_SB_FQDN="sb-duvproddistribution.servicebus.windows.net"
export VD_SB_TOPIC="t-distribution-222"
export VD_SB_SUBSCRIPTION="a022c9a4-b55f-4c1a-87af-7f4759fac9f4"

npm start
# -> [INFO] VD AMQP proxy listening on :8080/traffic
# -> [INFO] Subscribing to sb-duvproddistribution.servicebus.windows.net/t-distribution-222/subscriptions/a022c9a4-...
```

## Contract with frontend

Browsers connect to `ws://<host>:8080/traffic`. Two message types are sent:

- **On connect** — `{ type: 'traffic-batch', events: [{ id, situationXml, receivedAt, versionTime }] }`
  Full snapshot of every Situation currently held in the proxy cache
  (TTL 30 min). Ensures late-joiners see active events.

- **On new push** — `{ type: 'traffic-event', event: { id, situationXml, receivedAt, versionTime } }`
  Single Situation as it arrives from Service Bus. Frontend merges by `id`.

The `situationXml` field is the raw DATEX II XML PayloadPublication. Frontend
parses with `parseDatexIISituations()` (in `sovereign_renderers.js`).

## Deployment

Same pattern as `scripts/ais-proxy/`: build the Docker image, push to Scaleway
Container Registry, deploy as serverless container in `fr-par`.

```bash
docker build -t rg.fr-par.scw.cloud/isr-c2/vd-amqp-proxy:latest .
# aws-cli / scaleway-cli-based push here
```

Then paste the deployed WSS URL as `VITE_VD_TRAFFIC_WS_URL=wss://...` in the
frontend `.env.local`.

## Health check

`GET /health` -> `{ status, eventsKnown, clients }`
