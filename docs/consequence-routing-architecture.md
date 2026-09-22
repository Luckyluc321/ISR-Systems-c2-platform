# Consequence routing architecture

Which agencies get alerted when something detonates or comes down at a
site: medical coordination, the receiving acute hospital, the municipal
fire service, and the state rescue reinforcement.

Table and lookup live in `src/consequence_routing.js`. It is pure data
plus one function, imports nothing, and runs under plain Node, so
`scripts/check-impact-cascade.mjs` verifies every id in it against the
real destination and role tables.

## The bug this replaced

The terminal-impact cascade alerted a fixed list of six Copenhagen
organisations for **every** site. A detonation at Billund Airport
summoned Rigshospitalet, Hovedstadens Beredskab and Beredskabsstyrelsen
Hedehusene, all of them a country away, while the services that actually
cover Billund were never told.

It was correct only because every site that could detonate happened to
be in the capital region. That is the same "latent, not live" reasoning
that let five dead receiver inboxes ship.

## Nothing here invents an organisation

Every role named in the table already existed in `roles.js`: five
regional medical coordination centres, 23 acute hospitals, 29 municipal
fire services, seven Beredskabsstyrelsen centres. What was missing was a
destination for them and a link back from the role, so they could be
named but never reached.

Wiring them up was 18 destinations and 18 role links. No new Danish
organisation, address or coordinate was created.

## How each capability is decided

```mermaid
flowchart LR
    S[site] --> R[declared region]
    R --> M[medical coordination]
    S --> K[kommune]
    K --> F[municipal fire service]
    S --> H[nearest acute hospital]
    S --> B[rescue centre]
    M & H & F & B --> C[cascade recipients]
```

| Capability | Decided by | Source |
|---|---|---|
| Medical coordination | the site's region | already declared in every site manifest |
| Municipal fire | the site's kommune | kommune resolved by point-in-polygon against official Danish boundary data, then matched to the `kbr-*` role whose `member_kommuner` contains it |
| Acute hospital | nearest akutmodtagelse | verified per site, see caveats |
| State rescue | Beredskabsstyrelsen centre | already named in every site manifest |

Kommune was resolved against official boundaries rather than by name
similarity. That matters: the Landerupgård manifest describes the site
as Fredericia, and the coordinates fall in Kolding.

## Judgement calls, recorded

These are the places where "nearest" is not the answer.

- **Copenhagen Airport and Amager route to Hvidovre, not
  Rigshospitalet.** Rigshospitalet is geometrically nearer to both, but
  it is Region Hovedstaden's trauma centre rather than a walk-in acute
  department. It is listed second, as escalation. A naive
  nearest-by-distance rule would pick it and be wrong.
- **Billund routes to Kolding, not Vejle.** Vejle is nearer but its
  emergency function runs 07 to 22. The 24-hour Fælles Akutmodtagelse
  for Sygehus Lillebælt is at Kolding, so Vejle is not a valid
  destination for a night event.
- **Copenhagen Airport's fire service is Tårnby, not Hovedstadens
  Beredskab.** Tårnby Brandvæsen covers the airport landside. Airside
  first response is the airport's own Lufthavnsbrandvæsen, which has no
  role in `roles.js` and so is not alerted. That is a known gap.
- **Bjæverskov is in Region Sjælland but routes to the Hedehusene
  rescue centre**, as its manifest declares. The repo holds a verified
  address for Beredskabsstyrelsen Sjælland in Næstved but no role for
  it. Kept as declared rather than inventing a role.

## Self-referential ids, and the trap they avoid

A consequence destination's id equals its role id, and the role holds
its own id in `destinationIds`.

This is load-bearing. Amager Koblingsstation's site code is **AMK**, so
its site-scoped destinations are `amk-t2-politi`, `amk-t3-cfcs` and so
on. The gate's old capability check matched an `amk-` prefix to mean
"an ambulance service was alerted", which a police destination would
have satisfied with no ambulance present. The gate now checks the named
fields in the routing table instead of prefixes, so the trap is closed
rather than avoided by luck.

## No fallback, on purpose

`consequenceAgenciesForSite` returns an **empty array** for a site it
does not know. It does not fall back to a default set, because falling
back to Copenhagen is the bug being removed, and a silent wrong answer
is worse than a visible empty one.

The build gate fails if a site with a detonating template has no routing
entry, so an empty result cannot reach production unnoticed.

## What the gate enforces

`scripts/check-impact-cascade.mjs` imports the real modules and runs the
real resolvers rather than pattern-matching source text. Text matching
cannot see a destination generated at runtime, which every Amager
destination is.

- the cascade still calls the resolver, for both the consequence leg and
  the police leg
- every detonating site has a routing entry
- every routed agency has a destination, an owning role, and a home base
  if it has vehicles
- every routed site covers all four capabilities, checked on the named
  fields
- no two destinations share an id
- every Politikreds destination is held by a role naming the same
  district, and no two roles claim one district

All mutation-tested: each fix reverted individually fails the gate.

## Two duplicate-id bugs this surfaced

Adding the shared destinations exposed both.

The **Aktionsstyrken generator** treated `siteId: null`, which marks a
shared destination, as if it were a site. It minted an entry for "no
site" whose prefix came from the first shared destination,
`amk-hovedstaden`, producing `amk-t3-aks` with no site that collided
with Amager's real one. Lookups return the first match, so which one you
got depended on array order.

**Esbjerg declared NORDEFCO inline** while the universal tier-5
generator also emitted it. The inline copy is removed and the generator
is now idempotent.

## Still open

The alerted agencies outside Copenhagen have **no vehicles**. They
receive the case and can coordinate, but nothing drives on the map,
because a dispatchable agency needs a verified station address and those
have only been gathered for the Copenhagen set. That is the next pass.

This is deliberate and it is honest: the right agency is alerted, and
dispatch is not yet modelled for it. The Mission Console shows no
dispatch options rather than inventing some.
