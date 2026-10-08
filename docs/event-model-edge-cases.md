# Event Model Edge Cases — Catalog and Approach

**Scope:** every known edge case in how detections become events, how events become history, and how the intelligence layer reads that history. Each case states what the system does today (verified against source, Sept 2026), whether that is a gap, and the approach if so.

**Status legend:**
- HANDLED — current behavior is correct, test exists or is in the test plan
- FIXED — was GAP-NOW, closed 2026-09-16 with adversarial verification per fix
- GAP-LATER — known limitation whose fix belongs to a planned layer (NN adapter, Azure backend)
- BY-DESIGN — looks surprising but is intentional; do not "fix"

**2026-09-16 fix pass:** all five GAP-NOW items closed in commit chain
d98e44b (case 13 tenant gate), 2455030 + 7a53761 (case 10 outcome
stamping + two verify-agent holes), 1520eac (case 9 droneCount),
28ff333 (case 11 classification split + v2 schema bump), f0ac013
(case 12 admin annul). Each fix was adversarially verified by a
dedicated agent; findings that survived were fixed in follow-ups
(late-kill supersede, reactivation outcome clear, op-energinet AMK
siteIds drift in 609bc2b).

Companion: docs/testing/historical-pattern-test-plan.md covers the hands-on tests for cases 1-4 and 7-8.

---

## Summary table

| # | Case | Status | Approach owner |
|---|------|--------|----------------|
| 1 | Capture bites within one site | HANDLED | — |
| 2 | Short contact lost forever (fled) | HANDLED | — |
| 3 | Re-capture at another site | HANDLED | — |
| 4 | Late reclassification (bird → quadcopter) | HANDLED | — |
| 5 | Closed while still unclassified | GAP-LATER | NN adapter (signature hash) |
| 6 | Same drone returns days later | GAP-LATER | NN adapter (signature hash) |
| 7 | Two same-family drones at two sites, unrelated | HANDLED | — |
| 8 | Concurrent same-family events at one site | HANDLED | — |
| 9 | Swarm cardinality recorded wrong | FIXED | events.js + precedent_index.js |
| 10 | Close without outcome pollutes history quality | FIXED | close flow |
| 11 | Friendly / false-positive events count as "prior activity" | FIXED | historical_pattern.js |
| 12 | No operator annul path for bogus events | FIXED | events.js + precedent_index.js |
| 13 | Cross-tenant leakage in Agent B precedent retrieval | FIXED | precedent_retrieval.js |
| 14 | Sensor modality disagreement | GAP-LATER | NN adapter |
| 15 | History wiped by schema version bump | BY-DESIGN | — |
| 16 | Per-browser history until backend | GAP-LATER | Azure swap |

---

## Capture fragmentation

### 1. Capture bites within one site — HANDLED

Drone dips in and out of coverage repeatedly. One event = one full lifecycle (entry → track → loss → re-entry → exit); re-acquisition inside the detection window continues the SAME event (`src/events.js:1-3`, `_fireReacquisition` in main.js). Coverage gaps hide the object on the map (sensors-observe-only rule) but never split the event. History gets exactly one record per flight. Test 5 in the test plan.

#### How long the grace lasts, and why it branches

`_classifyDetectionLoss` decides this the first tick coverage drops, off the
last confirmed position. The platform only knows what its sensors saw, so the
question is not "where is it" but "had it already left".

| Last confirmed position | Classification | Grace |
|---|---|---|
| Outside the site perimeter | `fled` | `_LOSS_GRACE_FLOOR_MS` (12 s) |
| Inside, within `temporary_loss_buffer_m` of the edge, projected path exits | `fled` | 12 s |
| Inside, not leaving | `hiding` | `900 / speed`, clamped 15 to 60 s |
| No perimeter or no last-known position on record | `fled` | 12 s |

Speed-scaled rather than fixed, so a slow loiterer gets the full minute and a
fast mover 15 s. `temporary_loss_buffer_m` is per-site configuration,
defaulting to 200 m.

Closing the instant a detection drops would register a hundred linked events
per site for one flight, which is what the grace prevents. Re-acquisition
inside the window continues the same event (case 1), and the separate
unobserved-event sweeper skips anything owning a live track, so it reaps
orphaned shadow events only and cannot pre-empt a `hiding` grace.

`graceMs` is read back off `event.temporaryLoss` in two places, the close
comparison and the countdown panel, which must agree or the panel counts down
to a time the event does not close at. Both fall back to
`_LOSS_GRACE_FLOOR_MS`. The fallback is unreachable today, since the single
writer always sets `graceMs`, but it is kept rather than removed: a missing
value would make the close comparison false forever and strand the event LIVE.

### 2. Short contact lost forever — HANDLED

10-second contact, never re-acquired: event auto-closes as fled. No minimum duration, no notability gate on registration — even identify-only tier events register. The fragment becomes intelligence for the next incident. Test 6.

### 3. Re-capture at another site — HANDLED

Primary event at site A; when the trajectory enters site B's coverage a linked shadow event spawns (`linkedEventIds`, main.js:8095-8133). Each site's event closes separately and registers under its own siteId. The historical panel is site-scoped by design; the cross-site story lives in the xlink chain and chain report. Auto-correlation requires kinematic score ≥ 0.3 as a hard gate, so two same-type drones at different sites do not falsely link. Test 7.

---

## Classification timing

### 4. Late reclassification — HANDLED

Subject class changes mid-event (bird → quadcopter); `class_change_log` records every transition and the FINAL class at close is what registers as platform_family (`precedent_index.js:117-137`). Test 8.

### 5. Closed while still unclassified — GAP-LATER

Event closes before any classification lands → registers as family "unknown". Future confirmed-quadcopter queries at that site will not count it. **Approach:** when the NN adapter goes live, persist the signature hash on the precedent record; historical matching then falls back to signature-hash grouping for unknown-family records. Until then the record still exists and surfaces in "unknown" queries — the data is not lost, just not cross-matched. No code change now; noted in the NN adapter integration contract instead.

### 6. Same drone returns days later — GAP-LATER

Physically the same airframe returning next week creates a new event (correct) but nothing today can say "this is the SAME drone, not just the same family." **Approach:** signature hash matching once real NN raw signatures flow. The precedent record already reserves the field. This is also the foundation for the deferred RF evasion tactics tracker.

---

## Identity and concurrency

### 7. Two same-family drones at two sites, unrelated — HANDLED

The kinematic ≥ 0.3 hard gate in auto-correlation prevents family-similarity alone from linking unrelated events. Manual operator linking remains available when intelligence says otherwise.

### 8. Concurrent same-family events at one site — HANDLED

Two separate quadcopters at one site are two events with unique ids; no auto-merge, each registers its own history record. Correct: two simultaneous detections ARE two prior-activity data points.

### 9. Swarm cardinality recorded wrong — FIXED 2026-09-16

A 5-drone swarm is one event (correct) but `event.droneCount` is never populated, so the precedent record's cardinality_bucket registers "1" instead of "4-6" (`precedent_index.js:120`). A swarm incident looks like a single-drone incident in history and in Agent B's precedent block. **Approach:** populate `droneCount` at event creation from the swarm template size (and update on member neutralisation is NOT wanted — record the incident's peak cardinality). One-line fix at the swarm spawn path plus a test. Small.

---

## History integrity

### 10. Close without outcome — FIXED 2026-09-16

Fled auto-closes and outcome-less manual closes register `outcome: null`; the panel renders "outcome unrecorded". Legal but low-quality intelligence. **Approach:** two parts. (a) Fled auto-closes should stamp a machine outcome ("lost contact / left coverage") at the auto-close call sites — those ARE the outcome, no operator needed. (b) Manual close with unconfirmed dispatch outcomes already nudges via Step 4; keep it a nudge, never a hard block (operator authority wins). Small.

### 11. Friendly and false-positive events count as "prior activity" — FIXED 2026-09-16

A friendly inspection drone or a resolved bird-flock event registers like anything else, so the panel can say "detected 3 times before" where 2 were friendly inspections. Technically true, operationally misleading. **Approach:** the precedent record does not carry classification today — add `classification` to the record at register time, then the historical panel splits the count: "2 hostile / 1 friendly prior detections" and badges each row. Do NOT exclude friendly events (a pattern of friendly flights is also intelligence); label them. Requires a schema version bump (see case 15). Small-medium.

### 12. No operator annul path — FIXED 2026-09-16

`unregisterEvent()` exists in precedent_index.js but nothing calls it. A confirmed-bogus event (sensor artifact, duplicate) permanently pollutes history. **Approach:** admin-tier-only "annul from history" action on closed events, calling unregisterEvent + audit-logging the annulment to the feedback log (who, when, why). Receiver and operator tiers never get this. Deliberately NOT a delete of the event itself — the event and its PIR remain; only the history index entry is withdrawn. Small-medium.

### 13. Cross-tenant leakage in Agent B precedent retrieval — FIXED 2026-09-16

The historical pattern panel is safe (site-scoped; a site belongs to one tenant). But `retrievePrecedents()` for Agent B's "PRIOR SIMILAR EVENTS" block includes cross-tenant records — tenantId affects scoring tier only, not filtering (`precedent_retrieval.js:72-85`). A receiver's narrative can cite another tenant's site history. **Approach:** hard tenant filter in retrievePrecedents before scoring, with an explicit opt-in parameter for the future customer-network correlation feature (roadmap 3.5) where cross-tenant sharing is consented. This is the "no tenant isolation via client flags" principle applied one layer down: fix now in the query, enforce again server-side when Azure lands. Small, and should ship soon.

---

## Sensor and platform truth

### 14. Sensor modality disagreement — GAP-LATER

RF says drone, camera says bird: today the mock NN emits one fused detection per tick and subject confidence is a running max — no conflict surface at all. **Approach:** conflict resolution is the NN's job (C2 is not the classifier). What C2 will do when the real NN adapter lands: render per-modality confidence when the NN provides it, and surface "modality disagreement" as a flag the NN can set. Nothing to build until the adapter contract is real.

### 15. History wiped by schema version bump — BY-DESIGN

Bumping PRECEDENT_INDEX_VERSION discards old records at hydrate (auto-purge of stale schema). This is deliberate cache invalidation, not data loss — but note case 11's fix requires exactly such a bump, so batch schema changes together. When Azure lands, version migration replaces version purge.

### 16. Per-browser history — GAP-LATER

Records live in the local IndexedDB. Two machines, two histories. The storage seam (`precedent_store.js`) is already adapter-shaped for the Azure swap. No client change needed at swap time.

---

### 17. Detection raised for a track outside every sensor ring — FIXED 2026-10-08

The sensors-observe-only rule was enforced by one flag that also meant
something else, so there were tracks it could not be asked for.

`template.multiSite` carried two unrelated meanings:

| Concern | What it does | Read at |
|---|---|---|
| Coverage gating | undetected and invisible outside every ring, detected on first entry | the multi-site coverage block in main.js |
| Lifecycle ownership | suppress the single-site auto-close chain, because `_handlePerSiteLifecycle` owns entries and exits | four `!event.multiSiteTrack` conditions |

A single-site transit that spawns outside coverage needs the first and
not the second, and could get neither cleanly. Setting `multiSite` bought
the coverage gate and handed closure to a per-site path that does not run
for a single-site track, so the event never closed. Clearing it restored
closure and silently bought detection-at-spawn, because the single-site
branch assumes a template spawns inside its own coverage:

```js
// Single-site events fire immediately (spawned inside their site's coverage).
detected: (!!template.multiSite || ...) ? false : true,
```

Now two fields. `multiSiteTrack` is lifecycle ownership only.
`coverageGatedTrack` carries the sensor rule and is set by `multiSite` OR
the new `template.coverageGated`. `multiSite` still implies it, so every
pre-existing template evaluates identically and only a template that
declares `coverageGated` changes behaviour. The four close-chain
conditions still read `multiSiteTrack`.

**Invariant for any new template:** if its first waypoint is outside every
sensor ring of its own site, it MUST declare `multiSite` or
`coverageGated`. Without either, the operator gets a detection event for
an object no sensor can hear.

### 18. Pre-existing templates that spawn outside coverage ungated — GAP-OPEN

An audit of all 20 templates with waypoints, comparing each first
waypoint against every sensor position and `coverage_radius_m` in its own
site manifest, found seven that spawn outside all rings while declaring
neither flag. They therefore raise a detection event before first
contact, the same defect as case 17:

| Template | Site | First waypoint outside nearest ring |
|---|---|---|
| `cph_missile_inbound_sw` | cph | 8.75 km |
| `esbjerg_missile_hostile` | esbjerg | 2.40 km |
| `esbjerg_fixedwing_hostile` | esbjerg | 1.61 km |
| `cph_missile_hostile` | cph | 1.58 km |
| `billund_missile_hostile` | billund | 1.17 km |
| `cph_jet_friendly` | cph | 1.03 km |
| `billund_fixedwing_hostile` | billund | 0.06 km |

Not touched. These are long-standing scenarios whose timing, dispatch and
narrative were tuned against the behaviour they have now, and gating them
shifts first contact later for all of them. The one-line fix per template
is `coverageGated: true`, but it is a deliberate per-scenario call, not a
sweep.

## Recommended fix order

1. **Case 13** (tenant filter in retrieval) — correctness + tenancy principle, smallest fix, do first
2. **Case 10a** (fled auto-close stamps outcome) — one-line-per-call-site quality win
3. **Case 9** (swarm droneCount) — one-line fix + schema note
4. **Case 11** (classification on record + panel split) — batch its schema bump with case 9
5. **Case 12** (admin annul path) — needs a small UI decision (where the action lives)

Cases 5, 6, 14, 16 wait for their layers by design. Nothing here blocks the 3.6 attribution feature.

---

## Related

- docs/testing/historical-pattern-test-plan.md — hands-on tests for the handled cases
- docs/receiver-tier-features-roadmap.md — the intelligence layer this protects
- docs/agentic-precedent-retrieval-architecture.md — the retrieval path case 13 patches
- Memory: sensors-observe-only, c2-not-classifier, azure-final-destination
