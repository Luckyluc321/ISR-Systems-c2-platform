# Promo clip: with and without ISR

Working document for the two-clip customer film. Shot list, what has to be
built, and the rules that keep the claims honest.

## The one idea

Both clips end the same way: the aircraft does not land on a runway with
drones on it. **The difference is when that was known, and therefore what
it cost.**

| | Without ISR | With ISR |
|---|---|---|
| Drones seen | seconds from touchdown | minutes out |
| What happens | emergency go-around | a routine hold instruction |
| Who is involved | pilot and tower, reacting | a controller, deciding |
| How it reads | an incident | a non-event |

**Put a countdown to touchdown on screen in both clips.** Same aircraft,
same approach, same clock. Detection at T-7:00 against T-0:40 makes the
argument without narration. It is the single most valuable device in the
film.

**The best outcome is boring, and showing that it is boring IS the
argument.** The "with" clip should end on the aircraft landing normally
later. Nothing happened. That is the product.

## Honesty rules, which are also the stronger claims

- **Airliners do not carry drone detection.** In the "without" clip
  nothing is known until somebody SEES the drones on short final, or a
  tower call comes. Late, human and lucky, which is how the real closures
  have gone. Showing aircraft sensors spotting a swarm loses every
  viewer who works at an airport.
- **ISR detects and informs. The airport decides, the authorities
  respond.** Show our output arriving at the people who act, never ISR
  acting. This is positioning, not modesty: a perception layer that
  plugs into existing authority is a far easier thing to buy than one
  that claims to direct a response.
- **No police cars.** They dilute the point and edge toward implying we
  dispatch a response. Information sharing to the relevant authority is
  the shot; the response is theirs.

## The tower captions

The aircraft needs to be spoken to, and the tempting way to do it is a
cockpit POV. Do not. The one we looked at was a 737 and this aircraft is
an A320, which anyone in aviation spots instantly, and it loses the
credibility the real runway geometry and the real flare just bought. It
also makes the pilot the protagonist, and the pilot is the one person
ISR does not talk to.

Instead: a small radio-transcript caption in frame beside the aircraft.

**STYLE IT AS A FILM CAPTION, NOT AS PLATFORM UI.** If it looks like part
of the C2, the film implies the platform transmits to aircraft. It does
not, and the entire positioning is that we detect and inform while the
airport decides. Small, monospaced, timestamped, visibly a dramatisation
of the tower transmission.

**Use real phraseology**, for exactly the reason the wrong cockpit fails.
"You are good to go" lands like a prop. SAS's radio callsign is
**Scandinavian**, not SAS.

### Clip 1, without ISR

```
T-04:12   "Scandinavian 743, runway 04R, cleared to land."

T-00:38   "Scandinavian 743, GO AROUND. I say again, go around."
          "Drones reported on the runway."
```

The go-around call is repeated, which is real, and carries the urgency
with no voiceover at all.

### Clip 2, with ISR

```
T-07:20   "Scandinavian 743, discontinue approach."
          "Climb maintain 4000 feet, hold as published."
          "Expect further clearance at 1420."
```

Calm, three parts, with an expect-further-clearance time, which is what a
planned hold actually sounds like.

**Put the countdown beside each caption.** T-07:20 against T-00:38 is the
whole argument, and the contrast between a shouted go-around and a
routine hold instruction is the film in two captions.

## Production method

**One instance, not two.** Record both passes from the SAME running
simulation with the ISR layer toggled off for the "without" pass. Two
deployments drift: different spawn times, different drone positions,
different light. The clips will not cut together.

**Match the camera.** For any pair of shots meant to cut against each
other, use a FIXED camera and record both passes from it. Moving-camera
shots only where the two clips are not intercut.

**Record order:** with-ISR pass first while the overlay is up and you can
see what is happening, then toggle and repeat for the clean pass.

## Shot list

### Clip 1, without ISR

1. Aircraft on approach, routine. Countdown running.
2. Normal traffic exchange with the tower. Calm.
3. Swarm already on and around the runway, visible to the camera but to
   nobody in the film.
4. Short final. The sighting. Countdown reads under a minute.
5. Go-around: power up, climb, gear up, out over the sea, turn, hold.
6. End card: what that costs. Fuel, a diverted aircraft, a runway closed,
   a schedule gone.

### Clip 2, with ISR

1. Same aircraft, same approach, same countdown.
2. Swarm enters coverage far out. Detection opens: ring, classification,
   contributing sensors.
3. The platform informs the airport. Information sharing to the relevant
   authority.
4. The aircraft is told to hold, minutes ahead. It never leaves its
   normal envelope.
5. Receiver view: what the recipient actually sees.
6. Aircraft lands normally later. Nothing happened.

## What exists already

- The landing: real 04R geometry, gear, flare, derotation, spoilers,
  autobrake to taxi speed
- Drone swarm scenarios at CPH
- Detection lifecycle, ring, detection reports, contributing sensors
- Consequence routing to the agencies, and the Receiver view
- Cooperative-track handling, so an airliner is visible as ADS-B rather
  than as a sensor contact

## What still has to be built

1. **The emergency pivot.** Go-around, climb, out to sea, turn, hold.
   This is the only engineering left before both clips can be shot.
2. **A clean-world toggle.** Hides sensors, coverage rings, perimeter and
   detection overlays. VISIBILITY ONLY: the lifecycle keeps running
   underneath, untouched, so the two passes stay identical.
3. **The hold**, so the "with" clip has somewhere for the aircraft to
   wait before its later landing.

## Open

- Voiceover and copy: sleek, short, no adjectives doing work the footage
  should do
- Whether the countdown is burned into the recording or added in the edit
- Whether the "with" clip shows the later landing in full or as a cut
