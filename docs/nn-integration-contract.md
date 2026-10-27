# Plugging the neural net into C2 — the one page to start from

**Audience:** the edge, sensor-layer and infra engineers wiring real
detections into this platform. Internal. The partner-facing version is
`idd-integration-brief.md`; this page says more than that one does and
is not for sharing.

**What this page is:** a routing index. Every contract below already
exists in code or in a doc. This page says where, in what order to read
them, what the net must emit, what C2 will never do for it, and which
questions are still genuinely yours to answer. It restates nothing;
where a detail matters it is quoted and the source linked.

**The one sentence to hold onto:** every fact about a detection comes
from the net. C2 showcases it and gives it context. C2 never invents a
detection, an identity, a position or an intent, and anything in this
repository that appears to do so is a simulation standing in for your
output until it arrives.

---

## 1. The capability sequence, which the design respects

The net's output grows in three steps, and the platform already has a
place for each. Nothing waits on the later steps to use the earlier
ones.

| step | the net can say | what C2 does with it | where that lives |
|---|---|---|---|
| **1. Detect** | something is there, at this confidence, from this sensor, on this band | draws the track, runs the detection lifecycle, raises the threat banner, routes | IF-1, `live_sensor.js`, `signal_tier.js` |
| **2. Identify compliant traffic** | this one broadcasts Remote ID | shows the decoded broadcast as one emission type among eight; never infers it from band occupancy | `signal_tier.js`, `open-questions.md` Q3 |
| **3. Identify** | numeric signatures per modality, matched against labelled data | the signature bridge turns floats into a family, alternates and a confidence tier for the agent | `agentic-signature-bridge-architecture.md` (planned, waiting on step 3 output) |

Step 1 is enough to ship against a customer. Step 2 is already built and
is silent against the airframes that matter, which is why it is not the
identity path. Step 3 is designed and deliberately unbuilt until a real
net emits something, so the mapping is fitted rather than guessed.

---

## 2. The ingest seam — IF-1

Read first: `interface-design-document.md` **IF-1**, sections 1.1 to 1.7.

Everything downstream — tick loop, event lifecycle, correlator, UI,
agents — consumes an abstract `NnOutputSource`. Two implementations
exist: a mock that drives every simulation, and a WebSocket source for
field nodes. A per-site registry decides which one owns which site, so
a site can go live while every other site keeps simulating.

The batch shape, verbatim from IF-1.4:

```
NnDetectionBatch = {
  siteId, tickTs,
  sensors: [{ sensorId, status: 'online'|'offline',
              detections: [{ lat, lon, alt?, confidence 0..1,
                             droneKey?, modalityMix? }] }]
}
```

**Provenance is mandatory and not decoration.** Every batch and every
detection carries `source: 'sim' | 'live'`, and as of 2026-10-22 so
does every event (`spawnFromTemplate` writes `'sim'`,
`buildLiveEvent` writes `'live'`). `nn_source.js` explains why in its
header: a site can be mixed, real sensors beside a training scenario,
and once the two streams touch nothing can separate them afterwards.
Tag on the way in or never.

Configuration (IF-1.5): per-site in `src/nn_registry.js`
`SITE_SOURCE_CONFIG` — every site is `mock` today — and a global
`window.__ISR_FORCE_ALL_MOCK` that wins over it for demo recording.

---

## 3. The live path that exists today — what a node sends

Read: `live-sensor-integration.md`, then `src/live_sensor.js` header.

The platform already consumes a real node over a WebSocket
(`VITE_ISR_SENSOR_WS_URL`, default `ws://<laptop>:8000/ws/detections`,
served by `mqtt_ws_bridge.py` in the sensor-layer repository, not this
one). Message types, by `type`:

| type | fields | what happens |
|---|---|---|
| `sensor_online` | `node_id`, `lat`, `lon`, optional `sensor_id`, `label`, `hardware` | places the sensor on the nearest site **from its own coordinates**, draws the green dot and its 1 km ring. Idempotent: a reboot updates status, never a second dot. Refused if no coordinates, or if further from every site than that site's extent plus 3 km. Aliases `sensor-online`, `hello`. |
| `detection` | `node_id`, `label`, `probability` 0..1, `frame_seq`, `capture_ts` | a detection against that node. Dropped if the node was never placed. |
| `heartbeat` | `node_id`, `label` | per-node status |
| `status` | `nodes: { id: { status } }` | bulk status |
| `bridge-closed` | — | every placed node marked degraded |

A live event is created as `classification: 'unknown'`,
`droneType: 'Drone · RF, unclassified'`, `source: 'live'`. That is
step 1 of §1 done honestly: detection without identification, and the
platform does not pretend otherwise. **Do not send a drone name in
`label` expecting it to become the identity.** Identity arrives through
the track contract in §4, and until the signature bridge exists it is
not expected at all.

The 1 km coverage radius is deliberate and not configurable. See the
section of that name in `live-sensor-integration.md`.

---

## 4. Identity — the track contract, and it is not ours

Read: `src/track_source.js` header, then `idd-integration-brief.md` §2.

**C2 consumes identity. It never mints it.** A sensor sees a blip, then
another; nothing in a detection says they are the same aircraft.
Deciding that, assigning a stable id, and keeping it attached across
sensors belongs at the edge, with the raw signal and the microsecond
timestamps that never reach a browser.

The contract is **SAPIENT, BSI Flex 335 v2.0** — Dstl-owned, UK MOD
adopted, in NATO ratification for exactly this sensor-to-C2 problem.
Field names are the standard's own, so a conforming node plugs in with
no translation layer, and the ask to you is "conform to BSI Flex 335",
not "implement our format".

What a track carries, as the validator reads it (`trackRejectionReason`):

| field | rule |
|---|---|
| `object_id` | **required.** ULID. The stable identity. C2 rejects a track without one rather than generating one, because generating one would make C2 the thing that decides what counts as one aircraft. |
| `node_id` | **required.** The sensor that produced it. |
| `site_id` | **required** as of 2026-10-22. Scope travels with the data, not the plumbing; tenant derives from the site manifest's `tenant:`. |
| `location` **or** `range_bearing` | exactly one. A oneof, as SAPIENT has it: an RF sensor commonly gives a direction and no range, and forcing it into a lat/lon would fabricate a distance it never measured. |
| `location.datum` | **mandatory when location is used.** `WGS84_E` (ellipsoid) or `WGS84_G` (geoid, roughly mean sea level). See §6 Q2. |
| `location.coordinate_system` | `LAT_LNG_DEG_M` is what C2 accepts today; `LAT_LNG_RAD_M` and `UTM_M` are defined, not yet consumed. |
| `associated_detection[]` | other detections and how they relate: `PARENT` / `CHILD` / `SIBLING` / `NO_RELATION`. This is how a breakaway from a swarm is expressed. |
| `state`, `classification`, `detection_confidence`, `timestamp` | per the standard |

Enum values are string constants prefixed per SAPIENT
(`LOCATION_DATUM_WGS84_G`, `ASSOCIATION_RELATION_CHILD`, ...), exported
from `track_source.js`.

Gate: `check:track-identity` asserts all of this, including that
nothing in the seam ever generates an identifier.

---

## 5. What is expressible before identification — signal tier

Read: `src/signal_tier.js`.

Before the net can name an airframe it can still say a great deal, and
the panel renders every piece of it without inventing the rest. Two
axes, both live and gated by `check:signal-tier`:

**Emission type:** Control uplink · Video downlink · Telemetry ·
Datalink · Satellite link · Remote identification broadcast ·
No emission · Unclassified emission

**Band:** `hf-vhf` · `uhf-433` · `uhf-868-915` · `l-band-1.2` ·
`ism-2400` · `ism-5800` · `satcom-ku-ka`

So *"2.4 GHz, video downlink, 0.83"* is a complete, honest statement
the net can make on day one. Remote ID renders **only** when the network
reports a decoded broadcast, and the gate asserts it is never inferred
from a band that happens to carry it.

---

**C2 holds every escalation until the track is identified** (2026-10-27,
`src/identification_gate.js`). Before that, an operator who escalates by
hand sends "Unidentified track, classification in progress" with position
and movement only, and no auto-rule fires. Today the moment is a timer, 8 s
after first detection, the same moment the roster names the lead. When the
net is in the loop, the moment is the net's: set `identified: true` on the
event when it reports a class with enough confidence. That flag is the whole
integration; nothing downstream reads the timer.

---

## 6. After identification — the signature bridge

Read: `agentic-signature-bridge-architecture.md`. Status: planned,
deliberately unbuilt.

The net will emit **numbers**: RF spectral fingerprints, acoustic
feature vectors, visual embeddings, plus a confidence per modality. It
will not emit model names, and will not for a long time; the catalogue
is grown from field data over months. The agent cannot reason about
`[0.42, 0.18, 0.91, ...]`, so the bridge is the deterministic translator
from signatures to *"fixed-wing family, 0.78, alternates: loitering
munition 0.61"*.

It is unbuilt on purpose: fit it to real output, not to a guess. When
step 3 of §1 produces its first signatures, that document is the spec.

---

## 7. What C2 will never do, so you do not build around it

- **Classify.** No rule-based classifiers anywhere in C2. Identity and
  intent come from the net; C2 derives *meaning* from site context and
  doctrine. (`feedback: C2 is not the classifier`)
- **Mint an identity.** See §4. A track without `object_id` is rejected.
- **Localise.** Position is centralised in the sensor network — three or
  more sensors fix a track at the network's own rate. C2 receives a
  position. It does not multilaterate, fuse or correct. (Q5)
- **Guess an altitude reference.** A height with no declared datum is
  carried and not converted. (Q2)
- **Infer Remote ID** from band occupancy. (Q3)
- **Assert a model's reading as a fact.** Agent output is marked as
  assessed, with confidence and model version; measured and established
  facts are kept visually separate. (`agent-panel-provenance.md`)

---

## 8. The other inbound seam — responder positions

Not detection, but the same shape of problem and worth knowing exists:
`src/dispatch_telemetry.js` is where a responding unit's position comes
*in* from an agency, the inbound counterpart of `dispatch_source.js`
which carries an operator's decision *out*. Same discipline: in a
simulation the tick loop moves the police car; in a deployment a real
officer does, and the position arrives from the agency's own system.

---

## 9. Open questions, and who owns them

Full register with reasoning: `open-questions.md`. Status as of
2026-10-22:

**Answered — these are your constraints**

- **Q1 — stable object id.** A plain random identifier with no
  relationship to the net, the detection, or anything derivable. One per
  track, kept for its life. Nothing downstream may read meaning out of
  it. *(Drafted for Esteban and Gowri; the answer is now recorded.)*
- **Q2 — altitude reference.** The tracker declares which datum it used;
  C2 holds the site's terrain and converts from there. Site context
  settles the conversion but cannot settle the ambiguity — a `100` is
  either 95 m above the ground or 105 m above sea level, and only the
  producer knows which. **One nuance for you:** SAPIENT's two datums are
  ellipsoid and geoid; neither is height-above-ground. Say which of
  theirs you emit.
- **Q5 — position.** Localisation is yours, centralised, at your
  sampling rate. C2 receives and renders.
- **Q7 — tenant scope.** Closed by `site_id` on the track contract.
  Nothing for you to do beyond sending it.

**Recorded so it is not mistaken for a solution**

- **Q3 — Remote ID** identifies compliant traffic only. The standard
  says of itself that it does not address UAS not participating or
  circumventing it. Adversarial and DIY airframes have no transmitter
  to disable. Raw IQ to the net is the identity path.

**Open — needs a conversation with you before anything is built**

- **Q4 — interceptor targeting by list position.** Today the code holds
  live references into a swarm's member array by index, not by id.
  Works in a simulation where the array never reorders; a real feed
  that adds, drops or reorders entries between ticks reproduces two
  defects already seen in the field. The entry says it *"wants its own
  pass against a real feed rather than a speculative one"*. It is the
  largest single piece of the integration, and it is not being guessed
  at. When you can describe how your feed orders and retires tracks,
  that conversation starts.

---

## 10. Reading order

1. This page
2. `interface-design-document.md` IF-1 (ingest), then IF-3 (lifecycle)
3. `live-sensor-integration.md` (the path that works today)
4. `src/track_source.js` header (identity, SAPIENT)
5. `open-questions.md` Q1, Q2, Q4, Q5
6. `agentic-signature-bridge-architecture.md` when step 3 is near
7. `agent-panel-provenance.md` for how your output will be shown

Gates that will fail if any of the above drifts from the code:
`check:track-identity`, `check:live-sensor`, `check:signal-tier`,
`check:coverage-gate`, `check:nn-integration-index` (this page's own
links and the IDD status row).
