# Open question: should a chase keep a site's case open?

**Status:** OPEN. Not a bug to fix, a doctrine question to answer. Flagged
2026-10-11. Lucas wants an operational view on it — Peter's.

## The question in one line

Our interceptor is still chasing a drone that has left the site. **Does the
site's case stay open, or does it close?**

## What happens today

It stays open. `noChase` is false while any dispatch is `en_route` or
`engaging`, and the close chain will not fire while that holds. It resolves
when the aircraft hits its fuel cap and turns for home — not at the 30 second
grace.

So Copenhagen can hold a live case about a drone 40 km away that no Copenhagen
sensor can see, for as long as the pursuit lasts.

## Why it is genuinely two-sided

**Close it.** An event answers *what did this site observe*. The site has
stopped observing. Holding the case open claims knowledge no sensor is
reporting, which is the rule the rest of the platform obeys. The operator is
not responsible for airspace 40 km away. And the dispatch panel still shows the
aircraft, so nobody is blind.

**Keep it open.** An operator who committed an asset has a duty of care for it.
Closing the case while their aircraft is airborne and engaged reads as the
system losing interest. The engagement outcome — did it down the thing or not —
belongs to the incident that caused the launch, and a closed case is an awkward
place to put it.

## What a middle answer would look like

The two are separate state machines and should resolve separately:

- **The event** closes when the site stops observing. That is its only question
- **The dispatch** continues on its own authority: its own sensor, its own
  fuel, its own decision to break off
- **The outcome** is appended to the closed case's report when it resolves.
  There is already a pattern for this — `_appendLinkedEventToClosedPIR` adds to
  a closed event's report when new information arrives

## Why it is not a small change

`targetLost` currently keys off `primaryClosed`. Decoupling them removes the
interceptors' abandon-pursuit condition, so they need a replacement: break off
on their own sensor losing the target, on fuel, or on an operator recall. That
was attempted once in passing on 2026-10-11 and caused the interceptors to stop
engaging, so it needs to be its own piece of work with its own verification.

## The question to put to an operational reader

> An interceptor you launched is pursuing a drone that has left your airspace.
> On your screen, is that incident still open?

The answer decides the design. It is not a software question.

## Related

- `event-identity-and-linking.md` — the site-scoped event model
- `event-lifecycle-plain.md` — the agreed rules in plain language
