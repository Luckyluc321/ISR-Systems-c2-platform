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
| track side | chosen per tick | `pickTrackSide` evaluates both and keeps the one presenting the threat nearest the gun's bearing |

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

## Which side, and why it cannot be fixed on the profile

The side of the track to sit on is not a property of the aircraft. It depends on
the direction the chaser runs in from.

This helicopter launches from Karup or Skrydstrup. Against a northbound Geran it
therefore closes **head-on**, not from astern. Sitting on the threat's right is
correct for a co-directional chase and puts the threat on the **starboard** side
in a head-on pass, which a port gun can never bear. A fixed side is right half
the time, and the half it is wrong the aircraft arrives inside gun range and
still cannot fire.

`pickTrackSide` evaluates both sides each tick: it builds the aim point, takes
the heading the chaser will be on running in to it, and measures the threat's
relative bearing from there. It keeps the side closest to the port beam.

| Launch point, vs a northbound threat | Chosen side |
|---|---|
| Karup, north of it — head-on | −1, the threat's left |
| Billund, south of it — stern chase | +1, the threat's right |
| Skrydstrup, south-west | +1, the threat's right |

The sign flips exactly where the geometry says it should.

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

## The Karup pass, and why it was 2 km

The aim logic above was never the reason the helicopter could not engage. The
scenario geometry was.

Flyvestation Karup is at 56.2975, 9.1247 and is where `helicopter-intercept`
launches from. The Geran transit's track at that latitude sat at longitude
9.0900, which is **2.14 km west of the airfield** — outside the aircraft's own
2000 m sensor envelope, so it never saw the thing go past, let alone shot at it.

The two waypoints straddling Karup's latitude were moved east so the track
passes 400 m from the airfield: well inside the 2000 m sensor envelope so the
contact is acquired with time to lay the gun on, and close enough that the pass
reads as a pass rather than a distant transit. 800 m was the first attempt and
still looked too far out from the cockpit.

| | Karup closest approach | Sees it | Gun bears |
|---|---|---|---|
| Before | 2.14 km | no | no |
| After | 0.40 km | yes | yes |

Headings were recomputed from the new geometry and `tSec` from cumulative
distance at each airframe's real speed, so the shift did not silently change how
fast anything flies. The route stays 268 km; the flights stay 87, 50 and 31
minutes for the Geran-2, -4 and -5.

Window at the 400 m standoff:

| | Seen through the pass | Gun bears | `engageSec` |
|---|---|---|---|
| Geran-2, 185 km/h | 76 s | 40 s | 8 |
| Geran-4, 320 km/h | 44 s | 23 s | 8 |
| Geran-5, 525 km/h | 27 s | 14 s | 8 |

All three leave time to pivot and fire before it has passed, the Geran-5 only
just.

The Billund end is untouched: the track still spends the same 0.8 min inside
Billund's rings, so the detection report and its closure are unchanged.

## Firing: two bugs, one symptom

The gunner visibly tracked the contact and nothing ever shot. Two
independent causes, and the range was not one of them.

**1. The aircraft was not armed.** Every firing path is gated on
`profile.firesTracer`, and it was set on exactly one profile:
`counter-drone-swarm`. The helicopter had it nowhere, so it never fired at
any range. This hid because `_gunStationAim` runs off `onboardSensorRangeM`
and is independent of armament entirely — the traverse looked perfect while
the weapon behind it was never connected.

**2. The nose was pointed at the target.** `_gunStationAim` rests the gun on
the port beam and traverses 45° either side, so its arc is a relative bearing
of −135° to −45°. During an engagement the tick steered the nose at the
target, putting it at relative bearing **0**, which is 45° outside the near
stop. The gun swung as far as it could and held there.

`src/firing_pass.js` solves the heading that lands the target in the middle
of the arc: `heading = bearing − gunRest`, which for a port rest is
`bearing + 90°`. To put a contact due north on your left, face east. A door
gun pass is flown, not pointed. Nose-armed aircraft keep pointing, unchanged.

| Target bearing | Fly heading | Nose-on bears | Pass heading bears |
|---|---|---|---|
| 0° | 90° | no | yes |
| 90° | 180° | no | yes |
| 180° | −90° | no | yes |
| 270° | 0° | no | yes |

Nose-on never bears. That is not a tuning problem, it is geometry.

**`engageRangeM` stays at 300 m.** The GAU-21's 1100 m is a ballistic
area-target figure; hitting a 3.5 m airframe at 51 m/s from a moving
helicopter on an unstabilised pintle is a different problem, and a few
hundred metres is the honest number. Raising it would have been unrealistic,
and it was never the blocker.

### The chain, with the real constants

```
closes to              100 m   (engageOffsetM)
firing gate            300 m   -> open
gun bears on the pass  yes
window                 8 s, a burst every 1.4 s = 5 bursts x 4 = 20 rounds
```

| Burst | Rounds | Explode | Disable | Survive |
|---|---|---|---|---|
| 1 | 4 | 0.141 | 0.211 | 0.648 |
| 2 | 8 | 0.282 | 0.422 | 0.296 |
| 3 | 12 | 0.400 | 0.600 | **0.000** |

Downed by the third burst, about 5 s into an 8 s window. 40% explodes in the
air, 60% loses power and descends on its own momentum to a wreck downrange.
If it should sometimes survive a pass, the lever is `engageSec`, not the kill
model.

## The gun run is an orbit, not a crab

My first two attempts at the pivot were both wrong, and the second was wrong
in a way that mattered: it yawed the aircraft 90 degrees and held it there at
cruise. That is a crab, and a helicopter cannot do it. Sideways flight runs out
of tail rotor authority and fuselage directional stability somewhere around
30 to 35 knots. Holding 90 degrees of yaw at 250 km/h is not a manoeuvre, it is
a loss of control.

A real door-gun engagement is **flown as a left-hand orbit**. The aircraft
circles the target, nose on the tangent, banked into the turn, port door facing
the centre the whole way round. The gunner holds the target continuously and
the airframe never flies sideways at all.

### The physics sets the speed, not the other way round

A coordinated turn ties bank, speed and radius together:

```
tan(bank) = v² / (g · r)
```

So a radius is not free. A 400 m orbit at cruise would need **51 degrees** of
bank. Hold the bank at something a crew would fly and the radius fixes the
speed instead:

```
v = √(g · r · tan(bank))
```

| Speed | Radius at 18° bank | Yaw rate | Full circle |
|---|---|---|---|
| 250 km/h | 1513 m | 2.6°/s | 137 s |
| 140 km/h | 474 m | 4.7°/s | 77 s |
| 100 km/h | 242 m | 6.6°/s | 55 s |

Holding the 400 m radius instead gives **129 km/h at 5.1°/s**. So 90 degrees of
turn takes **17.6 s**, not one movement, and the aircraft has to slow down to
set up the shot — which is what a gun run looks like.

### The run, measured

```
1. run-in decelerates over the last 1.2 km (three radii)
     1200 m out   250 km/h
      600 m out   189 km/h
        0 m out   129 km/h

2. orbit at 400 m, 129 km/h, 5.1 deg/s
     90 deg of turn   17.6 s
     full circle      70 s
     bank held        18.0 deg
     target bearing   -90 deg throughout  (arc is -135 to -45)

3. the gunner holds it for the whole 70 s circle, firing in 8 s windows
```

### Bank had to be fixed for this to work

The bank model scaled the maximum bank by the turn rate as a fraction of the
airframe's maximum. That is not physics. The orbit turns at 5.1°/s, which is 8
per cent of a 60°/s maximum, so it would have banked the aircraft **1.5 degrees
for a turn that genuinely needs 18**. Flown fast and gently it would have
over-banked instead.

`bankForCoordinatedTurn` now uses `tan(bank) = v·ω/g` directly, clamped to the
airframe limit, with speed measured from the same position deltas as the course:

| | Bank |
|---|---|
| 400 m gun-run orbit, 129 km/h, 5.1°/s | **18.0°** — matches theory exactly |
| Gentle transit turn, 250 km/h, 1°/s | 7.0° |
| Pedal turn, course held | 0.0° |
| Hover, no speed | 0.0° |

The clamp is also the honest signal that a turn is being asked for which cannot
be flown.

## When the turn happens

The pass heading is applied from the moment the gunner has the contact, not
when the dispatch state flips to `engaging`.

That distinction was the whole bug on the second attempt. `engaging` begins
when the aircraft is within `arriveAtM` of its pass point, which is the last
second of a run that takes a minute, so the nose followed the flight path for
the entire approach and then snapped at the end. A real crew turns as soon as
the contact is acquired and holds that attitude through the run.

The gate is `_gunTargetOf`, which is the gunner's own 2000 m envelope. Inside
it the nose holds at `bearing + 90°`; outside it the nose follows the flight
path as before. The POSITION always steps along the run-in bearing, so the
aircraft flies one way and points another — the crab, and the only reason a
side gun can make this shot.

| Target bearing | Nose held at | Gun bears |
|---|---|---|
| 0° | 90° | yes |
| 45° | 135° | yes |
| 180° | −90° | yes |

Because bank is derived from course and not from nose heading, this 90° yaw
correctly leaves the disc level instead of rolling it 18°.

## Pivoting like a helicopter

Bank was derived from **nose heading** change. That is correct for an
aeroplane, where the only way to change direction is to bank, so heading and
flight path are the same thing. A helicopter decouples them: it pedal-turns
with the disc level, and it crabs.

The firing pass IS a crab — hold the course, yaw the nose 90° so the gunner
can bear. Driving bank off nose heading rolled the aircraft 18° through a pass
that should be dead level, and the 90° yaw is the largest heading change in the
whole engagement, so it produced the worst possible roll at the worst moment.

`src/rotorcraft_attitude.js` derives bank from **course over ground**, measured
from successive positions. Turn the flight path and it banks into the turn;
swing the nose alone and the disc stays level.

| | Bank |
|---|---|
| Pedal turn, nose yaws 90°, course held | **0.0°** |
| Hard turn, course swinging at the full 60°/s | 17.2° of an 18° max |
| Hover, no movement | level — course is unmeasurable and reported as null |

Course comes from position rather than from any heading field on purpose:
position is the one thing that cannot disagree with what the operator sees on
the map. The null at a standstill matters too — numerical noise in a hover
would otherwise bank the aircraft at random.

Yaw rate is unchanged at `TURN_RATE_RAD_S`, 60°/s, which is a realistic pintle-
era rotorcraft figure and means a 90° pass turn takes 1.5 s.

## The four ranges have to descend, and for a while they did not

This is why the gun never fired even after the aircraft was armed.

| | Was | Now |
|---|---|---|
| Run-in standoff (`BEAM_PASS_STANDOFF_M`) | 700 m | **250 m** |
| Arrival tolerance (`arriveAtM`) | 500 m | **200 m** |
| Orbit radius (`gunRunRadiusM`) | 400 m | **220 m** |
| Firing gate (`engageRangeM`) | 300 m | 300 m, unchanged |

The old set never agreed. The run-in aimed 700 m abeam, arrival was declared
within 500 m of *that point* — so the gun run could begin 1200 m from the
contact — and the aircraft then flew a perfect circle at 400 m, which is **100 m
outside the 300 m range its own gun fires at**. It burned the whole eight-second
window without a round and the engagement resolved as a miss, after which it
stopped pursuing. From the cockpit that reads as the helicopter ignoring a
target it can plainly see.

They now descend in order, so arriving means being on a circle that is inside
the weapon.

At 220 m the orbit is 95 km/h, 6.9°/s, a full circle in 52 s.

## Spiral in, do not snap

Writing the position straight onto the orbit radius teleported the aircraft: it
could declare arrival a kilometre out and appear 220 m from the target on the
next frame. That is the same "2 km jump" the original standoff chase was written
to avoid, reintroduced by me.

`advanceOrbit` now takes `currentRadiusM` and closes at a bounded 40 m/s, so the
aircraft spirals onto the circle, which is also how a gun run is actually flown:

```
t+ 0s   1199 m
t+ 6s    957 m
t+12s    717 m
t+18s    479 m
t+24s    239 m   on the circle, firing
```

## Not verified

The offline harness maintains the 700 m standoff as designed, but it omits the
turn-rate limit, the climb profile and the arrive/engage state machine, so it
does **not** reproduce the ~2 km miss seen in the app. The geometry change is
sound in isolation; whether it resolves that specific miss has to be judged by
running the scenario.

## Related

- `src/armament.js` — the GAU-21 entry and its 1100 m effective range
- `docs/track-trend-line-policy.md` — the breadcrumb that makes the transit followable
