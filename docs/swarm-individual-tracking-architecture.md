# Swarm Individual Tracking Architecture

**Status:** `[phase 2 in progress]` — designed 2026-09-16. P1.1 landed 2026-09-16 (commits 5809fd6 + 06d602b): `event.memberTracks[]` source of truth, syncMemberTrack/setMemberStatus mutators, tick-loop sync, kill-path status routing, frozen-at-spawn shadow clones. P1.2 landed 2026-09-17 (commit 501ee72): swarm roster renders per-member status from memberTracks. P2.1 landed 2026-09-17 (commits 12c99dc + 6f9225e): breakaway detection (observed-deviation grace clock, sensors-observe-only), child event promotion with provenance + cross-links, per-tick child mirroring with sticky detected, child-owned coverage-loss close, kill-path child closure, roster BREAKAWAY badge. Remaining Phase 2: rejoin semantics (P2.2), formation split (P2.3). Adversarially verified; four findings fixed in the follow-up commit. Per-member sensor attribution landed 2026-10-16: `event.memberSensors` is the per-airframe store, `contributingSensors` is the derived case union, member confidence reads member mass, and `scripts/check-member-sensor-attribution.mjs` gates it — see "Per-member sensor attribution" below. Its PANEL section was reverted on 2026-10-17 (`1fb84fe`); the attribution is intact and is read through `__isr_sensorAudit()`.

## Problem

Today a swarm is ONE event. The lead drone is the primary track; members are attached billboards following formation offsets, each with only a `neutralised` flag of independent state. That model breaks in three real-world situations:

1. **Breakaway.** One member peels off toward a different target. It has no independent track identity, no independent event lifecycle, and its departure is invisible to history and to receivers.
2. **Wide formations.** Members flying kilometers apart can straddle sensor coverage boundaries. Per the sensors-observe-only rule, each member's visibility must be gated by ITS position, not the lead's. Today gating follows the primary track.
3. **The live path inversion.** The simulation spawns a swarm as a pre-defined group. A real NN does the opposite: it emits N individual per-object detections and the C2 must CLUSTER them into a formation. The current model has no clustering seam, so the sim architecture cannot receive real swarm data without rework.

One thing stays right: one event per group lifecycle per site. Receivers coordinate a response to an incident, not to five separate paperwork trails. The fix is per-member track state INSIDE the group event, plus promotion rules for breakaways, not five events for five drones flying together.

## Design

### Track model

```mermaid
flowchart TD
    E[Group event<br/>one per swarm per site] --> M1[MemberTrack 0 lead]
    E --> M2[MemberTrack 1]
    E --> M3[MemberTrack 2]
    E --> M4[MemberTrack 3]
    M3 -- breakaway promotion --> C[Child event<br/>own full lifecycle<br/>linkedEventIds + provenance]
    C -- rejoin --> E
```

`event.memberTracks[]` replaces the render-only swarm billboard array as the source of truth:

```
MemberTrack = {
  memberId,               // stable within the event: '<eventId>-m<i>'
  nnTrackId,              // NN-assigned track id when live (null in sim)
  kinematics: { lat, lon, alt, heading, speedMs },   // per member, per tick
  inCoverage: bool,       // gated by THIS member's position
  status: 'tracked' | 'lost' | 'neutralised' | 'broken-away',
  classification,         // per member; usually inherited, can diverge
  class_confidence,
  formationOffset,        // expected slot; deviation feeds breakaway detection
  history: [...],         // per-member state transitions, append-only
}
```

**Per-member coverage gating.** Each tick evaluates each member against sensor coverage independently. A member outside all radii is hidden (its billboard, trail, and any projection) while the rest of the formation stays visible. The universal visibility rule applies at member granularity, full stop.

**Per-member classification.** A mixed group (four quadcopters escorting one fixed-wing) carries per-member class. The event's top-level subject remains the group summary (dominant class + cardinality), which keeps every existing consumer working.

**Cross-site shadow events (P1.1 semantics, deliberate).** A shadow event clones the primary's member tracks at spawn with `sourceMemberId` provenance and inherits each member's status at that moment. After spawn the shadow's tracks are FROZEN: shadow events have no droneState render wrappers, so nothing syncs their kinematics or coverage, and a member neutralised after the shadow spawned stays 'tracked' in the shadow's copy. The primary event's tracks are the live truth for the group; the shadow's copy answers "what did this site's event know at handoff." Live shadow-track sync (deriving the shadow's per-member coverage against ITS site's sensors) is Phase 2 work, folded into breakaway detection which needs per-site member geometry anyway.

### Per-member sensor attribution

**Landed 2026-10-16.** A sensor observes an airframe. It does not observe a formation.

`event.contributingSensors` was one array per event, and the swarm tick wrote into it five
times per frame: once for the lead, from inside the `if (p.visible)` branch, and once per
wingman inside the swarm loop. Every writer MAX-merged into the same list, so the instant
any one member crossed into a ring, that sensor was credited with holding the whole case.
There was no per-member list anywhere that could disagree, so clicking DRONE-4 in the
roster showed DRONE-1's sensors — the panel had only ever had one list to show.

Two consequences that were worse than a union:

- **The decay baseline depended on call order.** The per-tick decay ran on the FIRST call
  for the event in a tick and every later call could only RAISE a value. Which airframe's
  geometry set the floor was therefore decided by loop order.
- **A member whose call is skipped kept its sensors.** The lead's call is guarded on
  `!leadSwarmMember.neutralised`, and the whole `p.visible` branch it sits in is skipped
  once the lead's trajectory completes, while the wingman loop sits OUTSIDE that branch
  and keeps running. Nothing then aged the lead's contribution down, so sensors held up by
  a wingman read as holding a lead that had stopped being evaluated at all.

And the roster's per-member confidence came off the case union's mass, so a member held by
one weak sensor printed the number of a member held by four.

The store is now per member, with the case view derived from it:

```mermaid
flowchart TD
    P0["lead position<br/>p.lat p.lon p.alt"] --> B0["memberSensors['&lt;ev&gt;-m0']"]
    P1["wingman 1 position"] --> B1["memberSensors['&lt;ev&gt;-m1']"]
    PN["wingman n position"] --> BN["memberSensors['&lt;ev&gt;-mn']"]
    WS["WebSocket / live-sensor batch<br/>no member context"] --> BU["memberSensors['_event']"]
    B0 --> U["contributingSensors<br/>DERIVED union<br/>best confidence, best peak"]
    B1 --> U
    BN --> U
    BU --> U
    B0 --> C0["DRONE-1 confidence<br/>off its own mass"]
    B1 --> C1["DRONE-2 confidence<br/>off its own mass"]
    U --> S["alert strip · case file · PDF<br/>signal-evidence gate · entry.sensorIds"]
```

- `_updateContributingSensorsForPosition(event, lat, lon, altM, memberKey)` takes the
  member the position belongs to. One call, one position, one airframe, one bucket. The
  geometry floor and the detection-batch merge raise only that bucket.
- Decay runs ONCE per event per tick, across every bucket, because ageing is a function of
  time and time passes for an airframe whether or not the tick called this for it. Decay is
  uniform; only the raising is attributed.
- `contributingSensors` is recomputed from the buckets after every write: per sensor the
  best confidence and the best peak any member earned. Every existing case-level consumer
  is unchanged. `offline: true` entries survive a rebuild — that is a declaration about a
  sensor, not an observation of a target, and the historical events in `events.js` carry
  them.
- `_event` is the unattributed bucket. A real field node reports a detection, not a
  formation slot, so the WebSocket subscriber and the live-sensor console file there. It is
  a visible gap rather than a guess, and it is the seam where real per-target association
  lands once there is a classifier to do it.
- `_fusedMemberConfidence` reads `_evidenceQForMember`. A member with a store but an empty
  bucket scores ZERO mass, not the formation's — "no sensor holds this airframe" is a real
  answer. An event with no store at all (every single-platform event, every historical
  event) falls back to the case union, so nothing outside swarms changed.

**Operator surface: the case union, and nothing new.** The detail panel shows the
case-level **Contributing Sensors** section exactly as it always has.

A second section, **Sensors Holding DRONE-n**, shipped above it on 2026-10-16 and was
reverted the same day (commit `1fb84fe`). On a lead drone held by every sensor in range the
two sections rendered identically — same ids, same bars, same numbers, twice — which reads
as a bug, not as per-member truth. The roster row tooltip that carried "held by N sensors"
went with it. Nothing per-airframe is on screen today.

What survived is the live patcher on the case section (`data-live-case-sensors`). The full
render is blocked by the panel's hover gate, so a sensor acquiring the case while the
pointer was on the panel could not appear until the operator clicked something — which made
the sensor appear at the moment another drone was selected. A change in the union's
membership still forces one full render, because those rows carry an id and a value and
nothing else, so there is nothing to patch when the SET changes.

`__isr_sensorAudit()` is where per-member attribution is read. It prints two tables: the
case union, then one row per member with the sensors holding it, their mass, and the
confidence that mass produced. If the breakdown earns a place in the panel later it belongs
behind a toggle on the existing section, not as a second permanent list.

**Gate:** `scripts/check-member-sensor-attribution.mjs`, wired into `npm run build`. Static
half asserts the attribution contract in the source; live half extracts the real functions
and runs them against the real site manifests and the real CPH 5-drone template.

**Known limit, unchanged by this work.** When NO member of a case is inside any coverage,
`_updateContributingSensorsForPosition` returns before the decay pass, so every bucket holds
its last value until a member re-enters coverage or the sweeper closes the case on
`_lastDetectionTs`. That was true of the single shared array too.

### Breakaway detection and promotion

Deterministic, tunable per site, evaluated per tick for each member:

- **Distance trigger:** member's distance from formation centroid exceeds `breakawayDistanceM` (default 500 m) for longer than `breakawayGraceSec` (default 10 s), OR
- **Vector trigger:** member's heading diverges from the formation's mean heading by more than `breakawayHeadingDeg` (default 45°) sustained over the grace window.

On trigger, the member PROMOTES to a child event:

- New event with full lifecycle (entry, escalations, dispatches, close, PIR, precedent record).
- `linkedEventIds` both ways + `provenance: { parentEventId, memberId, promotedAt, reason }`.
- Parent's MemberTrack flips to `broken-away` with a pointer to the child. Parent cardinality history remembers the peak (per the gap 9 rule: history records what showed up).
- Receivers on the parent case see a timeline entry: "Member 3 broke formation, tracking as EV-xxxx." Cross-navigation via the existing linked-events panel.

**Rejoin.** If a promoted child re-converges with the formation (inverse of the triggers, sustained), it closes with outcome `rejoined formation` and links back. The parent MemberTrack returns to `tracked`. History keeps both records; the child's precedent record is real intelligence (a probing maneuver).

**Formation split.** If the group splits into two coherent sub-formations (cluster analysis yields two centroids, each with 2+ members), the larger cluster keeps the parent event; the smaller promotes as ONE child group event, not N singles.

### The clustering seam (live-path inversion)

```mermaid
flowchart LR
    NN[NN adapter<br/>N per-object detections<br/>with track ids] --> CL[Formation clusterer<br/>deterministic, C2-side]
    CL -- coherent cluster --> GE[Group event<br/>memberTracks from cluster]
    CL -- singleton --> SE[Single event<br/>as today]
    SIM[Sim templates<br/>swarm formation] --> GE
```

The clusterer is the new deterministic module (`src/formation_clusterer.js` when built). Inputs: live per-object detections with NN track ids. Rule: objects within `clusterRadiusM` of each other with velocity coherence above `clusterVelocityDot` (default cos 30°) sustained `clusterConfirmSec` (default 5 s) form one group event. The sim path constructs the same MemberTrack shape directly from templates, so downstream code has exactly one swarm representation regardless of source. This honors the plug-in-ready rule: when the real NN lands, the clusterer is the only new consumer; everything downstream is already member-aware.

Clustering is kinematic grouping, not classification. The NN classifies each object; C2 groups what the NN already classified. The c2-not-classifier boundary is untouched.

### History and intelligence layer fit

- Parent group event registers ONE precedent record with peak cardinality (gap 9 semantics).
- Promoted child events register their own records with provenance, so "this site has seen breakaway maneuvers before" becomes a queryable pattern — feeds the historical pattern panel and, later, the adversary tactics tracker (`project_rf_evasion_tactics_tracker`).
- The signature bridge applies per member when raw signatures flow: five members = five signature hashes. Same-airframe matching across events (edge case 6) then works per drone, not per formation.

## Migration phases

| Phase | Scope | Depends on |
|-------|-------|------------|
| 1 | `memberTracks[]` on swarm events, per-member coverage gating, per-member status replacing the billboard `neutralised` flag | nothing — sim-only refactor |
| 2 | Breakaway detection + child-event promotion + rejoin semantics | Phase 1 |
| 3 | Formation clusterer for the live path | NN adapter emitting per-object tracks |
| 4 | Per-member signature hashes + same-airframe matching | Phase 3 + signature bridge live |

Phase 1 and 2 are buildable today against the sim. Phase 1 is the prerequisite for everything and touches the swarm tick loop, render path, and neutralisation flow. Estimate: Phase 1 ~1 week, Phase 2 ~1 week. Phases 3-4 wait for their layers.

## Constraints (unchanged, restated)

- Detection-only. Promotion creates tracking context, never response action.
- Sensors observe only: per-member visibility gating is the POINT of this design, not an exception to negotiate.
- One event per group lifecycle per site remains the doctrine; child events are the exception with explicit provenance, not a new default.
- Additive Cesium entities only. Member billboards and trails follow the existing entity patterns.
- Every seam NN-plug-in ready: MemberTrack carries `nnTrackId` from day one, sim leaves it null.

## Related

- docs/event-model-edge-cases.md — cases 1-3 and 9 define the group-event semantics this extends
- docs/agentic-signature-bridge-architecture.md — per-member signatures (Phase 4)
- docs/nn-adapter-explainer.md — the per-object detection stream the clusterer consumes
- Memory: sensors-observe-only, c2-not-classifier, api-nn-plugin-ready, site-intelligence-layer
