---
title: "What each agency should be able to do"
subtitle: "Draft capability sets for the receiver action rail"
date: "2026-10-07"
---

# Read this bit

The action rail is being moved off a hand-written ladder and onto a rule.
This is the proposed rule, in plain words, for review before any code
changes.

**One finding changes the shape of it.** Archetype alone is too coarse.
145 roles share the "kinetic response" archetype and they are not alike:

| Who | Count |
|-----|-------|
| Hjemmeværnet districts | 81 |
| Søværnet | 16 |
| Flyvevåbnet | 14 |
| Politi districts | 14 |
| Hæren garrisons | 12 |

A volunteer home guard district and an F-35 base are the same archetype.
Any rule keyed on archetype alone gives them the same buttons, which is
how the modelled rewrite ended up offering a fighter scramble to 81
volunteer districts.

**So capability is keyed on archetype AND branch.** Archetype says what
kind of work the agency does. Branch says what it actually has. Both are
already in the data.

\newpage

# The draft

Everyone gets the universals regardless: acknowledge, reply, update
status, decline, loop in an observer, add a note, cascade to another
agency. Those are how an agency participates in a case at all. The lists
below are the capability buttons on top.

## Kinetic response, 145 roles, split five ways

**Politi districts (14).** Send a unit. Set a cordon. Request the national
tactical unit. Record the scene released.
*Unchanged from today for the 12 districts, except they only see dispatch
once their own inventory is loaded.*

**Hjemmeværnet (81).** Reinforce a perimeter, on request from police or
the Defence.
*Nothing airborne, nothing armed-response. They support, they do not lead.*

**Søværnet (16).** Vessel response. Maritime incidents only.
*Should not appear at all for an inland site.*

**Flyvevåbnet (14).** Airborne intercept, **from the QRA bases only**.
Skrydstrup and Karup. Transport and support stations get nothing.
*This is the one that must not be archetype-wide.*

**Hæren (12).** Counter-drone team and ground reinforcement, **only from
garrisons that have the unit**. Varde and Slagelse have electronic
warfare and counter-drone roles. Høvelte is ground reinforcement. The
training school is not a responder.

## Public safety and communication, 133 roles, split three ways

**Kommuner (98).** Alert the municipal crisis staff. Issue a
shelter-in-place notification.
*No physical dispatch. A municipality commands no vehicles here.*

**Municipal fire and rescue (29).** Fire and rescue response from their
own station.

**Beredskabsstyrelsen (6).** National standby and full deployment.

## Coordination and command, 42 roles

Convene, coordinate, relay the picture upward. **No physical dispatch.**

One exception: the three 112 alarm centrals dispatch emergency resources,
because that is literally their function.

## Medical and consequence, 36 roles, split four ways

**Hospitals (23).** Prepare to receive casualties. **No dispatch.**
*A hospital does not own ambulances. This is the one the naive rewrite
got most wrong.*

**Regions (5).** Ambulance standby and triage preparation. The region is
the entity that actually holds the ambulance service.

**Akutmedicinsk koordination (5).** Medical coordination and ambulance
dispatch.

**Beredskabsstyrelsen specialists (2).** Chemical and nuclear response.

## International liaison, 15 roles

Inform and coordinate across a border. **Nothing physical.**
*This equals today's behaviour exactly, which is why it migrates first:
it proves the machinery at a diff of zero.*

## Intelligence and attribution, 7 roles

Log to the intelligence picture. Contribute attribution. **No dispatch.**

## Forensic and cyber, 5 roles

Evidence handling, digital forensics, cyber analysis. **No dispatch.**

## Regulatory and advisory, 3 roles

Issue an airspace advisory. Restrict airspace. Issue a maritime advisory.
**No dispatch.**

\newpage

# Three rules that hold across all of it

**1. A button that moves people or vehicles requires a declared
inventory.** No inventory, no button. This is already enforced and is the
only thing that stopped the modelled rewrite handing out 310 of them.

**2. Capability is offered, the site decides.** Each site declares which
responses are possible there. An Energinet substation allows two. That
gate stays and is applied after the capability set is computed.

**3. We describe what an agency can be asked to do, not what equipment it
holds.** Specifying a responder's hardware is how the counter-drone
jamming text got written, and it was invented.

# What changes

Six roles lose the ability to request the national tactical unit: the
police academy, disaster victim identification, the SIRENE office, the
national criminal centre, the forensic centre and the cyber centre. They
hold it today only because the rule keys on an org-chart parent rather
than on what the unit does.

Everything else is either unchanged or gains a capability that matches
what the agency actually does.

# Order of migration

Smallest and safest first, so the machinery is proven before it touches
anything large.

1. International liaison, 15 roles, target equals current, diff of zero
2. Regulatory, 3 roles
3. Forensic and cyber, 5 roles, then intelligence, 7
4. Medical, 36 roles, split four ways
5. Coordination, 42 roles
6. Public safety, 133 roles
7. Kinetic, 145 roles, last and most carefully

Each step diffs against the committed baseline. The diff is the review.
