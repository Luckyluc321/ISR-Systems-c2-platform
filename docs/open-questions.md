# Open Questions

Short-term ledger of things that are **decided but not asked**, **blocked on someone else**, or **deliberately deferred with a known trigger**.

This exists so a decision made in one working session is not lost when the session ends, and so a question waiting on a person is visible rather than remembered. Anything here is either waiting on an answer or waiting on a condition. When it is done, delete the row. This is not a changelog.

**Rules for this file.** Every entry names an owner and a trigger. "Later" is not a trigger. If nobody owns it, it does not belong here.

---

## Waiting on someone

### Q1 · Edge team: emit a stable object id per track

**Owner:** Esteban and Gowri · **Raised:** 2026-09-26 · **Status:** drafted, not sent

The ask, in full:

> Emit `object_id` and `associated_detection` per BSI Flex 335 v2.0 (SAPIENT).

Context if it is queried:

- A sensor sees a blip, then another blip. Nothing in a detection says they are the same aircraft. In simulation a drone **is** an object, so the question never arises. Live, it has to be answered before C2 can draw a track line, run a replay, or write a case file.
- Deciding which detections are one aircraft is **association**, not classification. It is a separate question from what the neural net already answers.
- It belongs at the edge because it needs microsecond timestamps across sensors, per-modality signal features and error models that never reach a browser. C2 consumes identity and never mints it, which `scripts/check-track-identity.mjs` enforces.
- The format is not a request for a design. SAPIENT is Dstl-owned, UK MOD adopted, in NATO ratification, and `docs/idd-integration-brief.md` already commits our detection output to it. The proto files are public.
- The C2 side is already built and gated. See `docs/track-identity-architecture.md`.

**Why it is parked rather than sent:** the C2 half landed first deliberately, so the conversation can be "here is the socket, conform to the standard" rather than "please design a format for us". Send when the sensor pipeline is at a point where a track output is the next natural step, not before.

---

## Blocked on a real customer or real hardware

### Q2 · Altitude datum conversion

**Owner:** whoever wires the first real feed · **Trigger:** a named tracker's specification exists

Two seams accept an altitude and deliberately refuse to apply it:

| Seam | Behaviour today |
| --- | --- |
| `src/dispatch_telemetry.js` | A fix must declare `altDatum`. `agl` is applied. `msl` and `ellipsoid` are accepted, carried as `altRaw` + `altDatum`, and not applied. |
| `src/track_source.js` | `CONVERTIBLE_LOCATION_DATUMS` is empty. No datum is applied at all. |

The renderer places an object at a height above ground. Real trackers report height above the WGS84 ellipsoid or above the geoid. Converting needs a terrain sample under the vehicle.

**Do not write this against a guess.** A wrong datum is a silent error the size of the local terrain, and it looks completely correct on screen. Dropping the altitude and keeping the position is the honest failure. SAPIENT independently reached the same conclusion and makes `datum` mandatory, which is a good sign the caution is right rather than excessive.

### Q3 · Remote ID is not our identity path

**Owner:** unassigned · **Trigger:** a site that needs to greenlist compliant traffic · **Priority: low**

Recorded mainly so it is not mistaken for a solution to Q1.

ISR's drones do not broadcast. Field testing uses a drone without Remote ID, and adversarial and defence airframes never had a transmitter to disable. The standard says this about itself: it *"does not purport to address identification needs for UAS that are not participating in Remote ID or operators that purposefully circumvent Remote ID."*

The sensor repository already scopes this correctly. Remote ID capture is *"silent against non-compliant / adversarial drones"*, while the raw-IQ path to the neural network is *"detection of non-cooperative drones (DIY, RID-disabled, military). The defensible core technology."*

**So all identity for the population we care about comes from association.** There is no free serial number to fall back on. Two consequences that are not optional:

- SAPIENT's `id` field, documented as "the tail number of aircraft", will be null for us permanently. `object_id` is the only identity and it is entirely derived.
- Re-identification after an object leaves and re-enters coverage cannot come from kinematics. No fielded system does it that way. It has to come from the radio-frequency signature, which is the differentiating capability rather than a convenience.

**Handled in C2 as of 2026-09-26.** `src/signal_tier.js` carries Remote ID as one emission category among eight. It renders only when the network reports a decoded broadcast, and is never inferred from occupancy of a band that happens to carry it. `scripts/check-signal-tier.mjs` asserts both directions.

What Remote ID is still good for, whenever a site wants it:

- Greenlisting the compliant majority so the remaining alerts stay credible.
- A claimed position that can be checked against a measured bearing. A spoofer broadcasts a position that will not match an angle of arrival, and a drone with Remote ID disabled appears in the sensor picture with no matching broadcast. Neither case is covered by any standard, so it is open ground. The cross-check itself is not built; the tier surfaces the operator position marked self-reported so an operator can make the comparison by eye.

Plan against poor reception if it is ever built: the FAA's own study across 4.5 million receptions found about 14% Good or better and 65% Weak or Poor.

## Deferred with a known trigger

### Q4 · Render and interceptor rewiring for external identity

**Owner:** unassigned · **Trigger:** position ingest from a real track feed

Interceptor targeting holds **live object references** into `droneState.get(eventId).swarmBillboards`, keyed by array position, not by id. Two defect classes already exist here:

- Stale target references, where a billboard is hidden but its position callback keeps returning coordinates, so an interceptor flies to empty space.
- Mass re-target onto a breakaway child, found in the field 2026-09-18, where every interceptor retasked at once and returned to base past four live drones.

A track feed that reorders, adds or drops array entries between ticks reproduces both. This is the largest single piece of the eventual integration and wants its own pass against a real feed rather than a speculative one now.

### Q5 · Position ingest from tracks

**Owner:** unassigned · **Trigger:** Q1 answered and an edge feed exists

`src/track_source.js` attaches identity today. Movement still comes from the simulation tick. The separation is deliberate, so the edge can take over identity before it takes over position. `syncMemberTrack()` in events.js already accepts kinematics and is the landing point.

### Q6 · Breakaway reconciliation

**Owner:** unassigned · **Trigger:** Q5 done

`_promoteBreakawayMember` mints a **new** event identity for an object that would already carry a stable one from the edge. The event promotion still has to happen, because that is what receivers coordinate on, but the identity half becomes redundant and the `provenance.breakawayOf` chain-walking may contradict the external id.

This is the one place in the codebase that already models "the same object, re-identified", and it does so by creating a second identity and cross-linking. Worth revisiting once there is a real id to compare against.

### Q7 · Track source is a single registry, not per tenant

**Owner:** unassigned · **Trigger:** second concurrent feed, or Azure tenant isolation work

`_adapters` and the listener set in both `track_source.js` and `dispatch_telemetry.js` are module-level. Counters are per provider, which is enough to tell which feed is broken, but not per tenant. Fine for one feed. Revisit before per-tenant isolation lands.

---

## Known-failing, not a defect

### Q8 · Five eval cases fail on model output quality

**Owner:** unassigned · **Trigger:** next agentic prompt pass · **Last checked:** 2026-09-26

`npm run eval` → **60 pass, 5 fail, 0 error.**

The failures are the model not following the prompt, not the harness or the platform being wrong. Two representative cases:

- `agent-b-precedent-cph` · `precedent_grounding` — the precedent block is supplied and ignored, so a referenced prior event is missing from the narrative.
- `agent-b-precedent-cph` · `subject_fidelity` — the required platform family is dropped from the output.

Recorded here so a green build is not mistaken for a green eval. They move together with prompt work, not with code.

---

## Housekeeping

### Q9 · Night lighting work is uncommitted

**Owner:** the session doing the night rendering work · **Trigger:** that work reaching a stable point

`src/main.js`, `src/style.css`, `src/night_infrastructure_lights.js` carry uncommitted changes, and `src/runway_lighting.js` is untracked. A fresh clone therefore does not reproduce what is on screen locally.

Noted, not acted on. Commits from this thread stage only their own hunks specifically to avoid disturbing it.
