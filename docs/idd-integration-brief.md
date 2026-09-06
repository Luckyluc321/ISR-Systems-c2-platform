# ISR C2 Platform Integration Interface Brief

| Version | Date | Scope |
|---|---|---|
| 0.1 (draft for review) | 2026-08-23 | Shareable integration overview for a partner |

This brief covers how NC connects to the ISR Systems sensor network platform. It sets out the topology, the interoperability posture, and the API contracts NC plugs into. It leaves out the internal build on purpose.

---

## 1. Topology

ISR is the perception layer. It owns and deploys the sensor networks, runs the detection and reasoning, and produces a live detection picture. NC consumes that picture into its own command layer.

The C2 platform takes in three input classes and produces one output picture.

- Inputs (ISR side): sensor networks (detections and sensor condition), site definitions (geometry and sensor placement), and agency directories.
- Output (NC side): the detection picture, events, escalations, and evidence, exposed through the contracts in Section 3.

The sensors and the detection reasoning belong to ISR Systems, delivered as hardware and software as a service. NC sits at the output boundary. NC consumes the SAPIENT conformant detection output into its own C2 platform.

---

## 2. Interoperability posture (SAPIENT)

The ISR Systems detection output is designed to align to the SAPIENT interface control document, published as BSI Flex 335 (v2.0, 2024-03). SAPIENT (Sensing for Asset Protection with Integrated Electronic Networked Technology) is an open standard owned by Dstl, adopted by the UK MOD and now in NATO ratification for sensor to C2 interoperability. It defines how autonomous edge nodes register, report status, and report detections to a fusion node and command and control.

For this integration ISR Systems is the sensing side of the standard. Our perception layer produces SAPIENT conformant registration, status, and detection output, so it drops into a SAPIENT aware command layer instead of a custom feed. A C2 that already speaks SAPIENT consumes our detection picture through the standard message contract.

One scoping note. SAPIENT edge nodes can be sensors or effectors. ISR Systems uses the sensor and detection side of the standard only. It is a detection and intelligence platform, and does not implement effector nodes.

Message contract (what ISR emits, mapped to SAPIENT):

| SAPIENT message | Purpose | What ISR emits |
|---|---|---|
| Registration | A node declares its identity and capabilities | ISR sensor nodes declared to the consuming C2. Identity, modalities, position, coverage. |
| Status report | Node health, power, coverage | ISR sensor status (online, degraded, offline) and coverage geometry. |
| Detection report | A detection with class, confidence, and position | The core detection feed. Class, confidence, position, kinematics, modality evidence. |
| Alert | An alert raised by a node | Surfaces as an event on the shared picture. |
| Task and Task ACK | Tasking a node | Not exposed. Detection only posture, no effector tasking. |

Current state. The platform runs on an internal detection message today. The SAPIENT conformant output is the boundary NC consumes, and the internal message maps one to one onto the SAPIENT edge node message set above.

---

## 3. Integration interfaces

Each interface below is described in outline. The full field schemas come during integration.

### IF-A. Detection output

The primary integration point. ISR Systems provides the detection picture as SAPIENT conformant registration, status, and detection messages (Section 2) that NC's C2 consumes. A detection carries, at minimum:

- A stable track identifier.
- Position in WGS84 (latitude, longitude, altitude above ground in metres).
- Kinematics (heading in degrees, speed in metres per second).
- Classification and a confidence value between 0 and 1.
- Per modality evidence where available (RF, acoustic, visual).
- A data sampling rate of 1 to 2 Hz.

Cadence is per node. Each message is a track update that the consumer attaches to the correct track.

### IF-B. Site and sensor onboarding

A site is the unit of deployment. Adding a site is a configuration action, not a code change. A site definition carries:

- Identity (site id, name, code, centroid).
- Perimeter geometry (a polygon ring) for boundary crossing.
- One or more sensor nodes, each with position, coverage radius in metres, status, and declared modalities.
- The escalation tiers this site routes to.

Adding a site turns on detection coverage, the per site event lifecycle, and sensor health for that site. Adding a new sensor node to a site is a single entry in that site's sensor list.

### IF-C. Event and detection data contract

A detection becomes an event on the C2 ledger. An event carries identity, site, classification, threat level, confidence, entry and exit points, last known position, contributing sensors, and evidence. Events open on detection, update on each track message, and close on exit or signal loss. A track that crosses more than one site is linked across those sites. The full event and detection schemas come during integration.

### IF-D. Escalation output

When an event is judged worthy of a response, it escalates to the designated downstream receivers. An escalation carries the event reference and its track data at the sensor sampling rate, a payload level (summary or full), a target receiver, and a status that moves from sent to acknowledged.

### IF-E. Evidence and recording export

Every event records a per track timeseries. The platform exports the record as JSON or CSV for downstream analysis, evidence, and replay. The export carries per track position, kinematics, classification, confidence, and modality evidence across the life of the event.

---

## 4. How NC integrates

1. Consume the ISR Systems SAPIENT conformant detection output (IF-A) into your C2, or map it to your own track model.
2. Receive events and escalations from the platform (IF-C, IF-D).
3. Define the sites and geometry to be covered (IF-B). ISR provisions and deploys the sensors for those sites.
4. Pull evidence and recordings per event as needed (IF-E).

The sensors and the detection reasoning stay on the ISR Systems side. NC integrates at the output and configuration boundary. No ISR platform code change is required.

---

## 5. Available under NDA

Two parts of the platform are already mapped in our design and documented separately. We share them under NDA rather than in an open brief.

- A cross agency interaction model. It goes past a single escalation push and governs how an operator and several receiving agencies coordinate on one event, role to role.
- An agentic reasoning layer that produces analyst narrative and cross detection correlation.

Both are modelled. The detail is available on request under NDA.

---

## Reference

- SAPIENT interface control document, BSI Flex 335. https://www.bsigroup.com/en-US/insights-and-media/insights/brochures/bsi-flex-335-interface-of-the-sapient-sensor-management-specification/
- SAPIENT proto files (Dstl). https://github.com/dstl/SAPIENT-Proto-Files
