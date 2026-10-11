# What happens, step by step

Plain-language companion to `event-identity-and-linking.md`. If you read one
file about how events behave, read this one.

## The one rule everything follows

**An event belongs to a SITE, not to a drone.**

Copenhagen's case is about Copenhagen. When nothing is over Copenhagen any
more, Copenhagen's case ends. Where the drone went afterwards is somebody
else's case, or nobody's.

---

## A single drone

| Step | What you see |
|---|---|
| 1 | It enters a sensor's range → **event opens**, DETECTED marker |
| 2 | It crosses the fence → ENTRY marker |
| 3 | It flies around → symbol on the map, live telemetry |
| 4 | It leaves the fence → EXIT marker |
| 5 | It leaves sensor range → OUT OF RANGE marker, **countdown starts** |
| 6 | 30 seconds with no contact → **event closes**, summary written |

**If it comes back during the countdown**, the countdown stops and nothing new
is created. Same event, still live.

**If it comes back after the case closed**, that is a **new event**, linked to
the old one. This is the only way an operator sees a linked event.

---

## A drone we lose but that never left

Different case, longer leash.

| Where it was last seen | How long before the case closes |
|---|---|
| **Outside** the fence — it left | **30 seconds** |
| Inside the fence, near the edge, heading out | 30 seconds |
| **Inside** the fence, not leaving — lost to altitude or a gap | **15 to 60 seconds**, longer if it was slow |

Uncertainty gets more time. A confirmed departure gets less.

---

## A swarm

The swarm is **one event**. Each drone is a **member** of it.

| What happens to a member | Its status | Does the case split? |
|---|---|---|
| Flying normally | `tracked` | No |
| Breaks formation and flies off alone | `broken-away`, shown as ↗ DETACHED | **No** |
| Shot down, jammed, crashes | `neutralised`, shown as × DOWNED | No |
| Lost from sensors | `lost` | No |

**Nothing about one drone creates a second case.** The roster dims a member's
row and shows a small chip saying what happened to it.

The case closes when nothing is over the site any more — and the summary lists
every member and what became of it, including the one that got away.

---

## Several sites

| Step | What happens |
|---|---|
| 1 | Drone over Copenhagen → **Copenhagen's event** |
| 2 | It flies to Amager → **Amager's own event**, linked both ways |
| 3 | Nothing left over Copenhagen → **Copenhagen's case closes** |

**The Copenhagen operator never sees Amager's case.** Events are filtered by
tenant, and one site is one tenant. They see their own case carrying a note
that it continued elsewhere.

**A government profile sees the whole chain.** That is what the link is for.

---

## So when do you get a second event?

Only two ways:

1. **Something returns to your site after your case closed.** New event, linked
2. **It turns up at a different site.** That is that site's event, not yours

Breaking formation does not. Being shot down does not. Being lost for twenty
seconds does not.

---

## Why it is built this way

An operator holding a live case about a drone 40 km away they cannot see is
wrong twice over: it is not their airspace, and the platform would be claiming
to know something no sensor is reporting.

And the grace windows exist so a sensor gap does not mint a hundred cases for
one flight. That was the first thing we got wrong, and it is the reason every
number above is a delay rather than an instant.

## Related

- `event-identity-and-linking.md` — the same rules, with file references
- `event-model-edge-cases.md` — every known edge case and its verdict
- `swarm-individual-tracking-architecture.md` — member state and phases
