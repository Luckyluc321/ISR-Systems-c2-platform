# The agent panel: provenance before content

Design note, 2026-10-22. Proposal, not yet built.

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

## Open question for Lucas

Should an ASSESSED row appear **every time** the agent is given
concurrent tracks, or **only when the agent judges it meaningful**?

Always-render means an operator can tell "the system checked and found
nothing in it" from "the system did not look". Only-when-meaningful is
quieter but makes silence ambiguous, and at a busy site ambiguous
silence is the worse failure.

Recommendation: always render, with the null result stated plainly
("concurrent activity present, no coordination indicated").
