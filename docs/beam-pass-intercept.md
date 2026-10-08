# Beam-pass intercept

**Scope:** how a door-gun helicopter is vectored onto a crossing target.
`src/intercept.js`, consumed by the dispatch aim in `main.js`. Opt-in per
dispatch profile, so only `helicopter-intercept` uses it today.

## The problem

The dispatch logic re-aims every tick at the threat's current position. Pure
pursuit. Against a Geran-2 at 185 km/h an MH-60R at 250 km/h closes at 18 m/s,
so a 2 km gap takes nearly two minutes, and the gap only ever closes **from
behind**.

Dead astern is the one bearing this aircraft can never shoot. The gun is a
floor-mounted GAU-21 firing to port through the open door, inside a 45 degree
traverse. `_muzzleOffsetFor` offsets the muzzle to the left of the track.

So the miss was never about range. It was about bearing.

## What it does

Close on the threat at full speed, as pursuit already did, but aim a standoff
to one side of it. The aircraft keeps its full closing speed and arrives
**abeam** instead of astern.

| Constant | Value | Why |
|---|---|---|
| `BEAM_PASS_STANDOFF_M` | 700 m | inside the GAU-21's 1100 m effective range with margin, and well inside the 2000 m onboard sensor envelope so the contact is seen and the gun has time to lay on |
| `beamPassTrackSide` | +1 | the threat's right, which presents it off a port-gun chaser's firing side |

At 700 m the threat stays inside the 1100 m gun envelope for the chord
`2·√(1100² − 700²)`, which is 33 s at Geran-2 speed against an `engageSec` of 8.

```
standoff  400 m  ->  40 s inside the gun envelope
standoff  700 m  ->  33 s
standoff 1000 m  ->  18 s
```

`trackSide` is named for the geometry, not for the gun, because the sign
inverts between the two frames and that is exactly what nobody gets right
twice.

## Why not solve for a simultaneous arrival

`beamPassIntercept` does solve the full quadratic, and it is kept, but it is
**not** what steers the aircraft. That solve answers "where do we meet if we
both hold course", which is the *latest* useful arrival. For a chaser that is
already faster, aiming at that far-ahead point makes the intercept later:
against the Billund Geran transit it moved the closest approach from minute 4
to minute 73.

Deciding whether to commit is a different question from how to steer, and the
solve answers it honestly. No solution means this airframe cannot catch this
threat — an MH-60R cannot catch a Geran-5 at 525 km/h, and the result should be
a tail chase it is visibly losing, not a vector to a point it reaches late.
`_interceptEtaS` carries that figure; nothing acts on it yet.

## Not verified

The offline harness maintains the 700 m standoff as designed, but it omits the
turn-rate limit, the climb profile and the arrive/engage state machine, so it
does **not** reproduce the ~2 km miss seen in the app. The geometry change is
sound in isolation; whether it resolves that specific miss has to be judged by
running the scenario.

## Related

- `src/armament.js` — the GAU-21 entry and its 1100 m effective range
- `docs/track-trend-line-policy.md` — the breadcrumb that makes the transit followable
