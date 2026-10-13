# Live sensor integration

How one real ISR sensor node (HackRF One on a Radxa ROCK 4 SE) appears on the C2 map and opens detections. This describes what the code does today.

Files: `src/live_sensor.js` (the module), `src/sovereign_live_feeds.js` (the `isr_sensor_nodes` feed), the wiring block in `src/main.js` next to the persistent WebSocket NN subscribers, and `scripts/check-live-sensor.mjs` (the build gate).

## What the node delivers, and where the classifier output actually is

The Radxa does not deliver classifier output. It runs `isr-sweep-publisher.service` (ISR-Labs repo, `deployment/`), which captures raw IQ from the HackRF and publishes frames over MQTT to a broker on the LAN. Inference runs on a laptop:

```
Radxa (HackRF)  ──MQTT isr/rf/samples──▶  broker  ──▶  mqtt_subscriber.py   (laptop: runs the model)
                                                          │  MQTT isr/rf/results  {node_id, label, probability, frame_seq, capture_ts}
                                                          ▼
                                                      mqtt_ws_bridge.py       (laptop: port 8000)
                                                          │  WebSocket /ws/detections
                                                          ▼
                                                      C2 browser: isr_sensor_nodes feed → live_sensor.js
```

The C2 therefore consumes the bridge WebSocket. Message shapes are defined in `deployment/dashboard_protocol.py`:

| type | fields the C2 reads | effect |
|---|---|---|
| `detection` | `label` (`DRONE` or `BACKGROUND`), `probability`, `node_id`, `frame_seq`, `capture_ts` | `DRONE` opens or refreshes the live event. `BACKGROUND` does nothing. |
| `heartbeat` | `node_id`, `label` (`ONLINE`, `DEGRADED`, `OFFLINE`) | sensor status and dot colour |
| `status` | `nodes[node_id].status` | same |
| `spectrogram`, `subscriber` | ignored | |

The feed adds `bridge-open` and `bridge-closed` markers of its own. A closed bridge marks the sensor degraded with the reason on the record; the next heartbeat restores it.

The publisher's systemd unit points at a fixed broker address. In a new room, either the laptop takes that address or the unit's `--broker` flag is edited on the node.

## Manual path, built first

Two console entry points. They are the demo's floor: if the link is not ready, Gowri calls them from what the subscriber terminal prints and everything downstream behaves the same.

```
__isr_liveSensor(55.6300, 12.6450)                      // place the sensor symbol at the Radxa's position
__isr_liveSensor(lat, lon, { siteId: 'cph', nodeId: 'radxa-1', id: 'LIVE-01', label: 'Radxa on the bench' })

__isr_liveDetect({ confidence: 0.93 })                  // the network said DRONE at p=0.93
__isr_liveDetect({ label: 'DRONE', probability: 0.93, node_id: 'radxa-1' })   // bridge field names also accepted
__isr_liveDetect({ label: 'BACKGROUND', probability: 0.2 })                   // ignored: not a detection
```

Without `siteId`, the sensor joins the site whose centroid is nearest. An event belongs to a site and is tenant-stamped from it, so a sensor with no site would open events no operator can see.

Every call returns a result object rather than throwing: `{ status: 'placed' | 'opened' | 'refreshed' | 'ignored' | 'rejected', reason? }`. Rejections are counted in `__isr_liveSensors.stats()`.

## Automatic path, on top of the manual one

```
__isr_liveSensors.startFeed('ws://192.168.8.15:8000/ws/detections')   // the laptop's LAN address
__isr_liveSensors.stopFeed()
```

`startFeed` subscribes the runtime to the `isr_sensor_nodes` feed and starts it with that URL. The URL can also come from `VITE_ISR_SENSOR_WS_URL` in `.env.local`, in which case `__isr_live_feeds.start('isr_sensor_nodes')` is enough. Reconnect with exponential backoff, capped at 30 s, like the sibling feeds.

Detections arriving for a `node_id` that matches no registered sensor are routed to the only live sensor when exactly one is placed. With several, an unmatched node id is rejected as ambiguous.

## What happens on the map

1. **Placement.** The sensor record is appended to `SITES[siteId].sensors` in the exact shape `site_loader.js` produces, so every coverage predicate, the sensor popup, the night tint and the contributing rings read it as they read a manifest sensor. Three entities are added: the sensor dot (same id scheme, size, outline, ground clamp and `type: 'sensor'` properties as `renderSite`, asserted by the gate), the hidden coverage ellipse every sensor carries, and a pulse ring.
2. **Detection.** The runtime builds an IF-1.4 `NnDetectionBatch` with `source: 'live'` on the batch and on the detection. If the site has no active live event it creates one through `addEvent` with `source: 'live'`, `detected: true`, no template and no track flags, then folds the batch through `_applyDetectionBatchToEvent`, the same function the simulation uses. That stamps `_lastDetectionTs` and the sensor's confidence. The operator gets the DETECTED toast, the alert strip and the selected case, as in simulation. Further `DRONE` frames refresh the event's confidence and the detection clock.
3. **The pulse.** The ring on the sensor shows while the site has an active live event and this sensor has reported `DRONE` inside the sweeper's grace window. The simulation answers the same question with geometry; here the network's own recency answers it.
4. **Close.** A live event never gets a `droneState` entry. `_sweepUnobservedActiveEvents` in `main.js` closes any detected event that owns no render track and has had no detection for its grace window (15 s), outcome `lost contact`, with a note. The summary report is generated at `closeEvent` as for every event.

## What the event says, and what it does not

Only what the network said is in the record: the `DRONE` label and its probability (`confidence`, `evidence.rfMatch`, `evidence.rf_match_confidence`). Threat posture, drone type and platform are `unknown` because they are not network output today. The C2 is not the classifier.

One sensor gives presence inside its radius, not a fix. `lastPosition` is therefore the sensor's own position with `positionKind: 'sensor-anchor'`, altitude, speed and heading `null`. SAPIENT calls this `range_bearing` without a range. The right-hand panel's live telemetry rows render those nulls; filling them needs several sensors and is deliberately not built.

## The 1 km radius

The live sensor record carries `coverageRadius: 1000`, the same figure every manifest sensor carries. It is hardcoded inside `buildLiveSensorRecord` and cannot be passed in. The gate asserts both.

## Deliberately not built

- Localisation across several sensors, and any position in the right-hand panel.
- Flipping a site in `nn_registry.js` to `WebSocketNnOutputSource`. That class expects per-site IF-1.4 batches from a node that already knows its site and sensor ids; the bridge sends per-frame classifier results keyed by `node_id`. `live_sensor.js` is the adapter between the two for one node. When the node side emits batches, the registry flip is the next step and this module's `buildLiveDetectionBatch` is the shape to emit.
- Recording. A live event has no trajectory, so Replay has nothing to show for it.
- Authentication on the bridge WebSocket. Lab LAN only, as the bridge itself documents.
