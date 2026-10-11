# When is it a new event, and when is it a link?

**Status:** target model, agreed 2026-10-11. Partly built. See "What is built,
and what is not" before relying on any row of the table.

One question decides almost everything about how an incident reads on an
operator's screen: *is this the same event, a different event, or a link
between two?* This is the answer, in one place.

## The governing rule

**An event belongs to a SITE, not to a drone.**

An operator at Copenhagen Airport needs to know what happened at Copenhagen
Airport, and nothing else. A drone that leaves is no longer their problem — it
is a fact recorded in their summary, not a case that stays open on their
screen. Holding a case open about airspace an operator cannot see and is not
responsible for breaks site scoping and the sensors-observe-only rule at the
same time.

## The table

| What happens | Event | Link | Seen by the site's operator |
|---|---|---|---|
| Drone enters a site's coverage | **New event** at that site | — | Yes, their own |
| Drone breaks formation, stays at the site | Same event. Member status → `broken-away` | — | Yes, as a member row marked ↗ DETACHED |
| Drone is shot down, lands or crashes | Same event. Member status → `neutralised` | — | Yes, as a member row marked × DOWNED |
| Drone leaves coverage and does not return | Same event, which **closes** after the grace window. Its fate is recorded on the member | — | Their event closes. Summary says one fled |
| It returns **while the event is still live** | Same event. **Rejoin**: status → `tracked` | **No link** | Nothing new appears |
| It returns **after the event closed** | **New event** at that site | **Linked** to the closed one | Yes — this is the only way they get a second event |
| It appears at **another** site | **New event at that site** | **Linked** both ways | **No.** It is the other site's event, under the other site's tenant |

## Why "no link for an operator, except a return"

Linked events are scoped by tenant at the data layer (`_visibleToActor` in
`src/events.js`), and site→tenant is 1:1. So a cross-site link points at an
event the operator cannot see. They see their own event carrying a note that it
continued elsewhere; they do not get the other site's case in their inbox.

A **gov profile** reads the whole chain, which is the point of the link.

So in practice an operator encounters a linked event in exactly one situation:
something came back to **their** site after **their** case had closed.

## Why a breakaway is a member, not an event

`event.memberTracks[]` is the source of truth for per-member state, with status
`tracked | lost | neutralised | broken-away`
(`docs/swarm-individual-tracking-architecture.md`). The roster already renders
it. A drone that leaves formation has changed **state**, not identity. Giving
it a second event at the same site means the operator sees two cases for one
incident, and the two then disagree about who owns the markers and the
aggregate counters.

The rule of thumb: **a new event requires a new observation at a site.**
Breaking formation is not a new observation. Coming back after a close is.

## The grace window still applies

None of this changes the loss rule. A track that drops out while still inside
the perimeter is held for a speed-scaled grace window before the event closes
(`_classifyDetectionLoss`), precisely so a sensor gap does not mint a hundred
events for one flight. Ended means ended only **after** that window.

## What is built, and what is not

**Built, as of 2026-10-11:**

- A breakaway is a member with `status: 'broken-away'`. No child event, no
  same-site link. `_markMemberBrokenAway` in `src/main.js`
- `_spawnLinkedSiteEvent` is the only creator of linked events and is
  cross-site by construction: `_findGroupEventForSite` returns the primary
  itself for the same site, so the spawn is unreachable there
- Operators are filtered by tenant, so a cross-site linked event is already
  invisible to the other site's operator
- A departure gets a 30 second grace with a visible countdown; a loss inside
  the perimeter keeps its 15-60 second speed-scaled leash

**Agreed but NOT built.** The table at the top of this document describes the
target model. These rows of it are not yet true:

| Row | What happens today |
|---|---|
| Returns after the event closed → new linked event | `_handlePerSiteLifecycle` **reopens the closed event in place**: `status = 'active'`, `endTime = null`, and `outcome = null`, which **erases the recorded outcome**. No new event, no link |
| Returns while live → rejoin to `tracked` | Nothing clears `_brokenAway` or writes `tracked`. A member stays detached for the life of the event |
| The site's case closes when nothing is observable there | True unless one of our own interceptors is still chasing. `noChase` keeps the event open while any dispatch is `en_route` or `engaging`, and `_hostilesRemainIncludingChildren` counts the detached member as a live hostile. It resolves at the aircraft's fuel cap, not at 30 seconds |
| The 30 second rule | Applies only to tracks declaring `multiSite` or `coverageGated`. Every other template closes on the same tick as OUT OF RANGE, with no grace and no countdown |

`provenance.breakawayOf` now has readers and no writer. All reads use optional
chaining so nothing throws, but four code paths that keyed off it are inert.

## Related

- `docs/swarm-individual-tracking-architecture.md` — member state, phases
- `docs/event-model-edge-cases.md` — the grace window and loss classification
- `src/track_clustering.js` — decides when a member stops being part of a
  formation. Built, tested, not yet wired in
