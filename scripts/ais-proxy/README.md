# ISR Systems · AIS Proxy

Small Node.js service that turns Denmark's public raw AIS TCP feed into a
browser-friendly WebSocket stream.

**Why this exists:** DMA (Søfartsstyrelsen) publishes real-time AIS ship
positions at `ais2.dma.dk:4001` as raw NMEA sentences over a TCP socket.
Browsers can't consume TCP or NMEA directly. This proxy handles the
translation.

## Architecture

```
   ┌───────────────────────┐          ┌──────────────────────────┐          ┌──────────────────┐
   │ DMA raw AIS feed      │──TCP────▶│ this proxy (Scaleway)    │──WS─────▶│ ISR C2 browser   │
   │ ais2.dma.dk:4001      │  NMEA    │ - parse NMEA             │  JSON    │ (sovereign_live_ │
   │ (no auth, public)     │          │ - decode AIS messages    │          │  feeds.js WS     │
   │                       │          │ - filter by bbox         │          │  provider)       │
   │                       │          │ - broadcast to WS peers  │          │                  │
   └───────────────────────┘          └──────────────────────────┘          └──────────────────┘
```

## Data residency

Runs on **Scaleway (FR, EU-parented cloud)** to keep with the sovereign
profile story. No US-parented services (Cloudflare Workers, AWS, etc.)
in the AIS data path.

Later migration path: same container onto Azure Denmark East (Copenhagen
region) when a customer explicitly requires DK-only residency.

## Deployment (Scaleway serverless container, ~€5/mo)

**Prerequisite:** Scaleway CLI installed + logged in, container registry set up.

```bash
# Build
docker build -t rg.fr-par.scw.cloud/isr-systems/ais-proxy:latest .

# Push
docker push rg.fr-par.scw.cloud/isr-systems/ais-proxy:latest

# Deploy (Scaleway Serverless Containers)
scw container container deploy \
  name=ais-proxy \
  namespace-id=<isr-systems-namespace> \
  registry-image=rg.fr-par.scw.cloud/isr-systems/ais-proxy:latest \
  port=8080 \
  min-scale=1 \
  max-scale=3
```

Then set the resulting HTTPS/WSS URL in `.env.local` of the frontend:
```
VITE_AIS_WS_URL=wss://ais-proxy.functions.fnc.fr-par.scw.cloud/ships
```

## Local development

```bash
cd scripts/ais-proxy
npm install
npm start
# WebSocket now at ws://localhost:8080/ships
```

For the frontend to point at the local proxy during dev, set:
```
VITE_AIS_WS_URL=ws://localhost:8080/ships
```

## Message format (WS → browser)

Each message is a JSON object:

```json
{
  "type": "ship-batch",
  "ships": [
    {
      "mmsi": 219000001,
      "name": "MAERSK ALFIRK",
      "callSign": "OYBK2",
      "type": "CARGO",
      "lat": 55.47012,
      "lon": 8.40241,
      "sog": 12.5,
      "cog": 90,
      "heading": 90,
      "ts": "2026-09-02T14:23:00.000Z"
    }
  ]
}
```

## Bbox filtering

Client can pass a bbox query param on connection:
```
wss://.../ships?bbox=8.0,55.3,9.5,56.2
```
Format: `minLon,minLat,maxLon,maxLat` (WGS84). Only ships inside the bbox
are streamed. Reduces bandwidth from ~500 messages/sec (all of Danish
waters) to ~5-20/sec (single harbour).

## Volume expectations

- Peak DMA AIS: ~500 messages/sec (all Danish waters + Skagerrak)
- Per bbox filter (e.g. Esbjerg + 20km): ~5-20/sec
- Bandwidth per client: ~1-5 KB/s with bbox filter
- CPU: modest (NMEA parse is cheap)

## What this does NOT do (yet)

- Historical replay (only live positions)
- Static ship metadata enrichment (would need to join with a ship registry)
- Multi-region (DMA covers Danish waters, not international)
- Auth on the WS itself (add token check if you go multi-tenant)

## Status

**SCAFFOLDED, NOT DEPLOYED.** Code is here + ready to run locally + ready
to deploy to Scaleway. Frontend `sovereign_live_feeds.js` has both a mock
provider (works today, synthetic ships) and a WebSocket provider (points
at this proxy when `VITE_AIS_WS_URL` is set).

Deploy this proxy when a maritime customer pitch is imminent. Until then,
the frontend defaults to the mock provider so the demo still shows ships
on the map.
