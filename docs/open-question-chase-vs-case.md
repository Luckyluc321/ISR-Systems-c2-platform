# Open question: should a chase keep a site's case open?

**Status:** HALF BUILT, half still open. 2026-10-11.

- **The UNIT half is built.** A dispatch no longer breaks off because the case
  closed. Its own contact decides. See "What was built" below
- **The CASE half is still open.** Whether a site's event should stay open
  while a pursuit continues is a doctrine question, not a software one, and it
  is Peter's call

A site owns no **counter-drone** response, which settles part of this, but two
site operators do own an on-site team and the code does not care which kind it
is.

## The question in one line

Our interceptor is still chasing a drone that has left the site. **Does the
site's case stay open, or does it close?**

## What happens today

The case stays open. `noChase` is false while any dispatch is `en_route` or
`engaging`, and the close chain will not fire while that holds. It resolves
when the aircraft hits its fuel cap and turns for home, not at the 30 second
grace.

So Copenhagen can hold a live case about a drone 40 km away that no Copenhagen
sensor can see, for as long as the pursuit lasts.

## What was built, 2026-10-11

**The problem as it actually showed up.** Running the Copenhagen swarm, the
counter-drone interceptors stopped chasing the escapee at the edge of Amager's
perimeter and turned for home with the drone still airborne. Two causes, both
of them the case driving the unit:

1. `targetLost` is `primaryClosed && !anyLinkedActive`. It flips the moment a
   swarm clears a site, and the Phase F return-to-base acted on it directly,
   so the case closing sent the unit home
2. The per-target loss path fired on the first tick the **mesh** lost the
   drone, not the first tick the **unit** lost it. It flew to a point 1 km past
   the last fix and orbited there while the drone carried on at 25 m/s

**The policy now.** A unit breaks off on its own contact, not on the case:

| | Before | Now |
|---|---|---|
| Case closes, unit still has a live hostile | Returns to base | Keeps pursuing |
| Mesh loses the drone, unit's seeker still holds it (within `onboardSensorRangeM`) | Kept pursuing | Unchanged |
| Mesh loses it and the seeker does not hold it | Returns to base immediately, via a frozen point | Pursues the **projected** track for `_PURSUIT_GRACE_MS` (30 s) |
| Reacquired within the window, at this site or any other | n/a | Clock resets, pursuit continues |
| 30 s with no contact | n/a | Breaks off, old last-known behaviour |
| Fuel and envelope caps (`maxPursuitKm`) | Always applied | Unchanged. A projected pursuit cannot run off the map |

`_PURSUIT_GRACE_MS` is deliberately the same number as `_LOSS_GRACE_FLOOR_MS`,
so there is one answer to "how long before we accept it is gone".

**The projection is a simulation aid**, like the dashed breadcrumb. It
dead-reckons from the last observed position, heading and speed. A real
deployment does not hand an interceptor a track nobody is observing: its own
seeker and its operator are the authority. `_projectedTargetPosition` in
`src/main.js` says so at the call site.

**What this does NOT change.** Only dispatches with an assigned swarm member
defer to the window. Every other kind, including `helicopter-intercept` against
a single track, keeps its previous behaviour exactly. And the CASE still stays
open during a pursuit, which is the half below.

## The account model answers part of it

**A site owns no counter-drone response.** It observes, and it escalates to a
state department, police or Forsvarskommandoen, and that department decides
what to send. Operators send, receivers respond.

So the "duty of care for an asset I committed" argument does **not** apply to a
site operator for an interceptor. They did not commit it. The aircraft belongs
to the department that launched it.

**One correction, and it is not cosmetic.** Two site operators DO own a
dispatchable unit: `op-cph-airports` and `op-esbjerg-port` each hold a
`wildlife-response` team (`ROLE_SCOPE_MC` in `src/main.js`,
`src/response_assets.js`). It exists for biological targets, moves at 20 km/h
and will never chase a drone 40 km out. But **the close chain does not check
what kind of unit it is**: `noChase` is false while ANY dispatch of the
event is `en_route` or `engaging`. So an airport's own bird team, dispatched
and still walking, holds the airport's case open on exactly the same mechanism
as a fighter. The doctrine and the code disagree here, and the code wins
today.

That collapses most of the case for keeping a site's event open:

**Close it, for the site.** An event answers *what did this site observe*. The
site has stopped observing. It does not own the asset, did not launch it, and
is not responsible for airspace 40 km away. Holding the case open claims
knowledge no sensor is reporting, which is the rule everything else obeys.

**The remaining open question is about the DEPARTMENT, not the site.** The unit
is now decoupled from the case. The case is not yet decoupled from the unit.
Forsvarskommandoen did commit the aircraft. Their view of the engagement should
survive the site's case closing, because the pursuit is theirs. Today both are
bound to the same event, so there is no way to close one and not the other.

## What a middle answer would look like

The two are separate state machines and should resolve separately:

- **The event** closes when the site stops observing. That is its only question
- **The dispatch** continues on its own authority: its own sensor, its own
  fuel, its own decision to break off
- **The outcome** is appended to the closed case's report when it resolves.
  There is already a pattern for this — `_appendLinkedEventToClosedPIR` adds to
  a closed event's report when new information arrives

## Why it was not a small change

`targetLost` keys off `primaryClosed`. Decoupling them removed the
interceptors' abandon-pursuit condition, so it needed a replacement: break off
on their own sensor losing the target, on fuel, or on an operator recall. An
attempt in passing earlier on 2026-10-11 made the interceptors stop engaging
altogether, which is why the replacement was built as its own change with its
own verification rather than folded into unrelated work.

The replacement is the 30 second projected-pursuit window described above. Fuel
and envelope caps were already there and were left alone, which is what keeps a
decoupled pursuit bounded.

## The question to put to an operational reader

> Copenhagen Airport reports a drone and you launch an interceptor. The drone
> leaves Copenhagen's airspace and your aircraft is still pursuing it.
>
> Copenhagen's own case: open or closed?
> And on your screen at Forsvarskommandoen: what are you looking at?

The first half we think is settled: Copenhagen closes, because Copenhagen is
not watching anything any more and did not launch the aircraft. The second half
is the real question, what the dispatching department sees once the reporting
site has gone quiet.

A third, smaller one for the same conversation: should an airport's own
wildlife team being out on the apron hold the airport's case open? Mechanically
it does today.

It is not a software question.

## Related

- `event-identity-and-linking.md` — the site-scoped event model
- `event-lifecycle-plain.md` — the agreed rules in plain language
