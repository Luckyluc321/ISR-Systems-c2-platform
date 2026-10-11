# What happens, step by step

Plain-language companion to `event-identity-and-linking.md`.

**This file describes what the code does TODAY.** Anything agreed but not yet
built is in the last section, marked as such. Do not read a row of a table here
as a promise.

## The one rule everything follows

**An event belongs to a SITE, not to a drone.**

Copenhagen's case is about Copenhagen. When nothing is over Copenhagen any
more, Copenhagen's case ends. Where the drone went afterwards is somebody
else's case, or nobody's.

---

## A single drone

| Step | What you see |
|---|---|
| 1 | Enters a sensor's range → **event opens**, DETECTED marker |
| 2 | Crosses the fence → ENTRY marker |
| 3 | Flies around → symbol on the map, live telemetry |
| 4 | Leaves the fence → EXIT marker |
| 5 | Leaves sensor range → OUT OF RANGE marker |
| 6 | Event closes |

**Step 6 happens in one of two ways, and which one depends on the template:**

| Track type | What happens at step 6 |
|---|---|
| Declares `multiSite` or `coverageGated` | **30-second countdown**, visible in the panel, then closes |
| Everything else — **most templates** | **Closes immediately**, same tick as OUT OF RANGE. No grace, no countdown |

That split is not a design decision anyone made. It is where the code happens
to be. See "Known gaps".

---

## A drone we lose but that never left

For tracks that get the countdown, the wait depends on *where it was last seen*:

| Last seen | Wait before closing |
|---|---|
| **Outside** the fence — it left | **30 seconds** |
| Inside, near the edge, heading out | 30 seconds |
| **Inside** the fence, not leaving — lost to altitude or a gap | **15 to 60 seconds**, longer if it was slow |

A **slow** track that might be hiding gets the most time, up to 60 seconds.

**The two cross over at about 30 metres per second**, and above that a
departure gets MORE time than a possible hider: a departure is a flat 30
seconds, while the hiding window is `900 / speed` capped at 15 seconds. A
Shahed at 50 m/s that goes quiet inside the fence gets 18 seconds. One that
leaves gets 30. Nobody designed that; it is where the arithmetic lands.

---

## A swarm

The swarm is **one event**. Each drone is a **member** of it.

| What happens to a member | Status | Shown as | Splits the case? |
|---|---|---|---|
| Flying normally | `tracked` | normal row | No |
| Breaks formation, flies off alone | `broken-away` | ↗ DETACHED chip | **No** |
| Shot down, jammed, crashes | `neutralised` | × DOWNED, row dimmed | No |

**Nothing about one drone creates a second case.**

A detached member keeps its dotted breadcrumb while the event is live, so you
can still see where it went.

---

## Several sites

| Step | What happens |
|---|---|
| 1 | Drone over Copenhagen → **Copenhagen's event** |
| 2 | It reaches Amager → **Amager's own event**, linked both ways |
| 3 | Nothing left over Copenhagen → Copenhagen's case closes |

**The Copenhagen operator never sees Amager's case.** Events are filtered by
tenant, and Copenhagen and Amager are different tenants. A government profile
reads the whole chain.

**One operator can hold several sites, though.** `op-energinet` holds six
substations. A track moving between two of them makes two events that the same
operator sees, linked. Correct, but it means "an operator never sees both ends
of a link" is not a general rule.

---

## Built, as of 2026-10-11

| Rule | How it works |
|---|---|
| **Re-entry opens a NEW linked event** | For multi-site and coverage-gated tracks. The closed case stays closed and the return opens a new event linked to it. A single-site track cannot re-enter at all, its entities are torn down at close, so there is nothing to return to |
| **A detached member that nobody holds gets a verdict** | 30 seconds outside our sensors AND outside every responder's own sensor range → `status: 'lost'`, a note on the event, a `? LOST` chip on the roster. The dashed breadcrumb keeps running: a verdict on the roster and a breadcrumb on the map answer different questions |

---

## Known gaps — agreed, NOT built

These are written down so nobody reads the tables above as the finished design.

| Gap | What happens instead today |
|---|---|
| **The 30-second rule should apply to every track** | Only coverage-gated and multi-site tracks get it. Most close instantly |
| **A chase should not hold a site's case open** | While one of our interceptors is pursuing, the case stays open even with nothing over the site. It resolves at the aircraft's fuel limit, not at 30 seconds |
| **Rejoin** | Nothing ever clears `broken-away`. A member that rejoins the formation stays marked detached |
| **The summary should list every member and its fate** | The post-incident report never reads `memberTracks` |
| **A detached row should dim** | A `broken-away` row gets the ↗ DETACHED chip but no dimming. `neutralised` and `lost` rows both dim |

---

## Why it is built this way

An operator holding a live case about a drone 40 km away they cannot see is
wrong twice: it is not their airspace, and the platform would claim knowledge
no sensor is reporting.

The grace windows exist so a sensor gap does not mint a hundred cases for one
flight. Every number above is a delay rather than an instant for that reason.

## Related

- `event-identity-and-linking.md` — the same rules with file references
- `event-model-edge-cases.md` — every known edge case and its verdict
- `swarm-individual-tracking-architecture.md` — member state and phases
