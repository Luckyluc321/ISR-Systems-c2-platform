# NN Adapter Layer

**Purpose:** one seam between "how detections arrive" and everything else. Simulations and real hardware live behind the same interface. No downstream code cares which one is running.

Date shipped: 25 August 2026. Files: `src/nn_source.js`, `src/nn_registry.js`. Full contract in `docs/interface-design-document.md` section IF-1.

---

## The one-sentence version

Every site's detections come from an `NnOutputSource`. Two kinds exist today: `MockNnOutputSource` (drives simulations) and `WebSocketNnOutputSource` (consumes real field sensor streams). A per-site registry decides which one owns which site.

---

## What did NOT change

The simulation engine is untouched. Drones, swarm formations, waypoint templates, RF signatures, template scenarios like the CPH swarm — all still work exactly as before. Simulations are a permanent, first-class part of the platform, not a phased-out mock. They will be used for demos, training, and edge-case regression testing forever.

The C2 UI, tick loop, event lifecycle, correlator, agentic summary — none of them changed either. They read from `event.contributingSensors` the same way they always have.

---

## What DID change

The math that turned "drone is at lat/lon" into "sensor N01 sees the drone at 0.87 confidence" used to be inline in `main.js`, hardcoded to iterate `SITES[siteId].sensors`. Now that math lives inside `MockNnOutputSource`. The tick loop calls `source.ingestPositions([{lat, lon}])` and reads back a detection batch. Same numbers out. Different plumbing.

The plumbing matters because tomorrow, `WebSocketNnOutputSource` will replace that call with real hardware output. Every downstream layer keeps working.

---

## How you switch to real hardware for one site

Open `src/nn_registry.js`. Change the site's entry:

```
Before:
  cph: { source: 'mock' }

After:
  cph: { source: 'websocket', url: 'wss://cph-node-01.field.isr/nn', auth: '<token>' }
```

That is the whole change. Zero downstream code touched. The tick loop, the UI, and the agentic summary all keep working.

---

## How you force everything to mock (for demos)

Before you run the platform, set this in the browser console or in the bootstrap:

```
window.__ISR_FORCE_ALL_MOCK = true
```

Every site now routes to mock regardless of what `SITE_SOURCE_CONFIG` says. Real hardware, if any is wired, is bypassed for the session. Use this for demo recording, sales calls, and any offline training environment.

Remove the line (or set it to `false`) to go back to normal routing.

---

## Four operating modes

| Mode | `FORCE_ALL_MOCK` | Per-site config | What happens |
|---|---|---|---|
| Pure simulation (demo, training) | `true` | ignored | Every site runs mock. Simulation drones flow through mock source. Identical to today's build. |
| Mixed (customer visit, staged rollout) | `false` | some `websocket`, others `mock` | Real sensor sites feed live batches; sim sites keep running scripted scenarios. Both on the same map. |
| Full production | `false` | every site `websocket` | Every site consumes real hardware. Mock code stays in the bundle — available on demand for post-incident replay and sim regressions. |
| Development default | `false` | all undefined | Every site defaults to mock. New sites added to `SITES` work with zero registry config. |

---

## Why this matters

Three concrete gains.

**One: real hardware onboarding is a config edit, not a code change.** When the first Radxa node lands at CPH, we don't refactor the tick loop. We add a line to `nn_registry.js`. Same for every subsequent site.

**Two: simulations are permanent, not a placeholder.** Every scenario that runs today keeps running with real hardware in the field. Trade shows, training environments, and offline regression tests use the exact same C2 build.

**Three: Netcompany and any customer with their own detection stack can plug in.** They write an adapter that maps their output to the `NnDetectionBatch` shape (documented in IDD IF-1.4). Their infrastructure feeds our C2 through the same seam mock uses today.

---

## What is NOT wired yet

`WebSocketNnOutputSource` exists as a class with the full contract (reconnect with backoff, site-scoped delivery, offline batch on disconnect, bearer-token auth). It is not connected to any real endpoint. The wiring happens when the first field node ships.

Live Agent B narratives via Scaleway Mistral inference also not wired yet. Same pattern — a single named function is the seam. `event.narrativeCache` already drives every downstream renderer (PDF, closed panel, debrief). When we swap the deterministic fallback for a real Mistral call, everything downstream keeps working.

---

## One-line summary for the team

The C2 platform is now source-agnostic. Simulations keep running. Real hardware plugs in at one file when it ships. Turn everything mock with one boolean when you need a clean demo run.
