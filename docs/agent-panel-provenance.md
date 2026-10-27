# The agent panel: provenance before content

Design note, 2026-10-22. The concurrency rows are built (see "Built" at the end); the visual tier markers are still a proposal.

## The problem

In the Agent B section today, these two rows are rendered identically:

```
Nearest critical asset    PostNord mail terminal area · 0.20 km
Assessed pattern          Reconnaissance profile. It stayed over several
                          critical areas in a single pass.
```

The first is a **measurement**: a distance between two coordinates,
reproducible, auditable, wrong only if a sensor or a map is wrong. The
second is a **model's opinion**, which can be confidently wrong in ways
nobody can reconstruct afterwards.

They share a row class, a key style and a value style. Nothing on screen
separates them.

For a demo that is untidy. For an operator deciding whether to stop
aircraft movements, it is the defect that matters most, because the
failure is silent: the model's opinion inherits the credibility of the
measurement sitting above it.

## The rule

**Every item in the agent panel declares how it is known, and the
declaration is visual, not textual.** Three tiers, and nothing may sit
outside them.

### MEASURED
Deterministic. Derived from sensor data, geometry or the event record.
Reproducible from the same inputs, auditable after the fact, and does
not depend on a model being reachable.

Today: nearest critical asset, dwell analysis, contributing sensors,
separation and age in the concurrency list, perimeter crossings.

Shown plainly. No confidence value, because confidence is not a property
of a measurement — a distance is or is not 0.20 km.

### ESTABLISHED
The system asserted a relationship, deterministically, and recorded why.

Today: linked events, carrying the correlator's composite score
(0.50 RF + 0.30 kinematic + 0.20 temporal, auto-linking above 0.65 with
kinematic at or above 0.3), and multi-site continuations spawned by
`_spawnLinkedSiteEvent()`.

Shown with the score. The score is what makes it auditable; an
established link without its score is just an assertion.

### ASSESSED
A model's reading. Fallible, not reproducible, and not an instruction.

Today: assessed pattern, confidence. Next: whether concurrent tracks
look coordinated.

Shown with three things, always, and never without them:
- an explicit marker that this is a model reading
- a confidence value
- the model version that produced it

## Where concurrency goes, and why not in Linked events

Concurrency splits across two tiers, and that split is the whole point.

- **MEASURED**: a hostile fixed-wing track is live at this site, 3025 m
  away, active 279 s. That is a fact. It belongs beside the nearest-asset
  row, and it is true whether or not inference is reachable.
- **ASSESSED**: whether the timing and placement suggest coordination.
  That is a reading, and it belongs with the pattern verdict, carrying
  confidence and model version.

It must NOT appear in **Linked events**. That section means "the system
established this relationship", and the deterministic correlator has
specifically not. Putting an unestablished relationship there would
destroy the only distinction the Post-Incident Report exists to
preserve: what the system established versus what a model suggested.

## Why this scales

Every future agent output answers one question before it is designed:
measured, established, or assessed? Precedent retrieval is MEASURED
selection feeding an ASSESSED reading. Signature matching will be the
same shape. Egress estimation will be ASSESSED and must never read as
MEASURED.

The tiers also degrade correctly. With inference unreachable, every
MEASURED and ESTABLISHED row still renders and is still true; the
ASSESSED rows are absent rather than stale. An operator loses judgement
and keeps facts, which is the right way round.

## What this does not change

- No new panel section. These are the sections that exist.
- No change to what is computed, only to how provenance is shown.
- The mock-output footer stays until inference is live, and the ASSESSED
  marker does not replace it: "this is a model reading" and "this model
  is not currently connected" are different statements.

## Answered: every time

Lucas, 2026-10-22: the ASSESSED coordination line renders **every time**
the Mission Console shows concurrent tracks. With no model reading it
says so ("Coordination · not yet assessed") instead of going
quiet, so an operator can tell "checked, nothing" from "never looked".

## Built, 2026-10-22

In the existing Mission Console section, no new section:

- **Other detections on site** row, MEASURED. One line per other live,
  detected, non-friendly track at the site, from the same tenant-scoped
  list the agent receives: type, classification, distance, which side
  of the site, and how long before or after this track it appeared.
  No confidence, because these are measurements.
- **Coordination** line inside the Assessed pattern row, ASSESSED,
  rendered whenever the row above is. Reads `event.coordinationReading`,
  written only through `events.js::setCoordinationReading(id,
  { text, confidence, modelVersion })` and validated on read by
  `concurrent_events.js::coordinationReadingFor`. Nothing calls it yet: the analysis debrief gives the model the concurrent block
  and asks the question, but answers in free narrative. When a
  structured answer exists, that one call is the whole integration.
- Nothing is written to `linkedEventIds`. Gated by
  `check:concurrent-events` [panel].

Still a proposal: the visual MEASURED / ESTABLISHED / ASSESSED markers
on every row. The rows above use the panel's existing styles.

## The detection line, built 2026-10-24

The sentence beside a detection's confidence ("0.71 · Held by four sensors
and firming.") is a model reading, so it comes only from Mistral
(`src/agents/agent_detection_line.js`). It used to be `confidenceTrend`, a
sentence written into each scenario; that field is no longer shown anywhere,
and `check:detection-line` fails if any code reads it.

- **Input:** measured facts only. The confidence on screen and how it has
  moved since first seen, the sensors holding the track and the strongest
  three, altitude, speed, heading, seconds held on the sim clock. The
  scenario's commentary is stripped from the type string.
- **Output:** one sentence of at most 14 words. No intent, no identity beyond
  the type given, no recommendation, the number not repeated.
- **Cadence:** on first hold, then when a sensor is gained or lost or the
  confidence on screen moves by 0.05, at most every 20 s per event, never
  while the sim is paused.
- **Absent, never stale:** no key, an error, an empty answer or a rejected
  key clears the line, and the panel shows the number alone. A 401/403 parks
  it for the session.
- **Provenance:** hovering the line shows "Model reading · <model> · <time>".

## The escalation brief's Situation section, built 2026-10-26

The Detection Brief an escalation sends used to list the nearest fighter
jets, military helicopters, police units and emergency services for every
detection, a recon swarm included, and closed on "Recommended Action:
dispatch Tier 1 and Tier 2". Lucas: "We are the messenger, not the decision
maker." The brief now describes and stops
(`src/agents/agent_escalation_assessment.js`, `src/summary.js`).

- **Input:** measured facts only. Site and its kind, the detector's type
  without scenario commentary, class, threat level, platform category and
  the weapon-class flag from the detection subject, airframes in the track,
  confidence, sensors holding, altitude, speed, heading, inside or outside
  the perimeter, seconds held on the sim clock.
- **Output:** strict JSON. `situation`, two or three sentences of at most 60
  words, descriptive only. `state_attack`, true only when the facts show an
  armed attack on Denmark by a state. A recon flight, a single drone or an
  observing swarm is never one. Only an explicit `true` counts.
- **What it decides:** whether the brief carries the response asset tables,
  as reference for the authorities. Nothing else. No recommendation section
  exists any more. ASSESSED tier.
- **The floor under it:** a `true` counts only on a military-class track, a
  missile, a loitering munition, or a weapon-class or known military platform
  in the detection subject. "It should never ever happen at a recon swarm" is
  held in code, not left to the prompt.
- **Cadence:** once when the operator opens the escalate modal, again only if
  the stored one is older than 60 s. An escalation an auto-rule sent is
  assessed once too. The preview re-renders when it lands.
- **Absent, never stale:** no key, an error or an unparseable reply clears it.
  The brief then carries measured facts and no tables, which is the safe
  default. A 401/403 parks it for the session.
- **Provenance:** the section carries "Model reading · <model> · <time>".

Gated by `check:escalation-flow`, with the defaults below.

**Escalation defaults** (`src/escalation_recommendation.js`): the
recommendation says who to notify, never what anyone should do. No
international body (Eurocontrol, Europol, ENTSO-E, NATO, NORDEFCO) is ever
ticked by default, and no auto-rule sends to one (`rules.js` filters them,
which holds rules saved in a browser too). They stay on the list to pick by
hand. A missile still ticks Tier 5's two Danish crisis staffs, NOST and
Statsministeriet.

**Nothing is ticked when the modal opens** (Lucas, 2026-10-27). The security
manager picks the recipients, or presses "Apply recommended" for ours. A
drone, a recon swarm or a fixed-wing included, suggests Tier 1 and Tier 2
only, and the manager adds national agencies as they judge. Missiles and
loitering munitions keep their national tiers. The auto-rule that told Tier
3 about every hostile fixed-wing a minute in is off by default (rules storage
bumped to v6 so a cached copy cannot keep it on). Every tier folds with the sections' own control. The
recommended tiers open, the rest start folded.

## Single-drone confidence follows the sensors, 2026-10-23

Every single-drone threat now reads its confidence off the sensors holding
it, as the swarms always did (`_fusedMemberConfidence`). It starts at the
scenario's own value, so rules that read confidence fire at detection exactly
as before, then moves with the sensors at no more than 0.03 a second, so it
never swings from 0.8 to 0.4 in a couple of seconds. `peakConfidence` is kept
beside it for the report. Airliners (transponder identity), swarms and the
two `mockConfidenceRamp` scenarios are unchanged. Linked site events inherit
the starting value.
