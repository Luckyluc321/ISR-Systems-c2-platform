# Aarhus Harbour · flow reference

| Field | Value |
|---|---|
| Site ID | `aarhus_harbour` |
| Label | Aarhus Harbour |
| Code | AAR |
| Tenant | `op-aarhus-port` |
| Onboarded | 2026-10-22 |
| Site type | port |
| Operating mode | sim |

## 1. Overview

Denmark's largest container port, with the ferry terminal, the oil terminal and the inner city quays inside one boundary. Built as the second site of the promo trailer, beside Copenhagen Airport, because it shows a different domain: threats can arrive by water as well as by air.

The site is named neutrally, "Aarhus Harbour", and so is its operator account. Rename `org` and `label` in `src/roles.js` once the port has agreed to appear by name.

## 2. Boundary

Traced by Lucas inside the platform on 2026-10-22 with the shift-click tracer (`__isr_coverage`, `src/photoreal_coverage.js`), in three passes: the outer loop, the inner edge of the northern basin, and the indentation at the city quay. After an 8 m simplification it has 273 vertices, encloses 3.48 km² and never crosses itself.

- The south edge crosses the harbour entrance over water, from the south quay to the container pier. That is normal for a port boundary.
- Where the northern basin meets the city quay, a 20 m strip of water along 600 m of quay is narrowed to a 4 m corridor, so the two edges never cross. The solver keeps every sensor at least 25 m from the boundary, so none sits in it.

## 3. Sensor layout

17 nodes, `AAR-N01` to `AAR-N17`, computed with `scripts/three-eye-solver.py` against the three-eye policy the shipped sites are measured against: every point inside the boundary is within 1000 m of at least three nodes. Candidates are inside the boundary and at least 25 m from its edge, at least 500 m apart. The result is 100% of the site at three or more eyes.

The ids carry the site prefix, as Billund's `BLL-` do. Bare `N01` to `N16` collided with Copenhagen's ids, and the incident report looks a sensor up by id across every site, so a Copenhagen report named Aarhus sensors.

| Zone (2026-04 deployment plan) | Nodes |
|---|---|
| Quay Front Upper | AAR-N01 to AAR-N04 |
| Container Yard | AAR-N05 to AAR-N09 |
| Lower Port and Quay | AAR-N10 to AAR-N14 |
| East Tip Open Cargo | AAR-N15 to AAR-N17 |
| Middle pier tip (added on request) | AAR-N18 |
| East of the largest container terminal hangar (added on request) | AAR-N19 |

AAR-N18 was added by hand at the tip of the oil terminal pier, on top of the solved 17. It sits 472 m from AAR-N04, under the 500 m separation, accepted for coverage of the pier head. AAR-N19 was added the same way, at a spot Lucas shift-clicked just east of the largest hangar on the container terminal.

The deployment plan has 105 nodes for a denser, multi-modality build. This is the three-eye minimum. The positions are computed, not surveyed. Some may land on a crane rail or a roof edge, so each needs an eye before hardware is ordered.

## 4. Routing

- **Tier 1:** site security operations, duty officer, harbour control, container terminal operations, camera system, data broker.
- **Tier 2:** Østjyllands Politi, PET, vessel traffic services.
- **Tier 3:** Rigspolitiet, FE, Beredskabsstyrelsen, plus Aktionsstyrken, CFCS, CTA and NC3 from the universal generators.
- **Tier 4:** Søværnets Operative Kommando, the F-35 QRA at Skrydstrup, Flyvevåbnet air defence, Forsvarskommandoen, Hjemmeværnet.
- **Tier 5:** NATO Allied Maritime Command, plus NORDEFCO, Europol, NATO Air Policing Baltic, NOST and Statsministeriet from the universal generator.

Ownership mirrors Esbjerg: each national account (PET, FE, Rigspolitiet, Beredskabsstyrelsen, Forsvarskommandoen and the army and air bases) holds the Aarhus destination next to its Esbjerg one, and Østjyllands Politi holds `aar-t2-politi`. The destinations no account holds are the same set Esbjerg already lacks. Because a request to an agency goes to every destination that agency holds, requesting PET on any site's event now also records the Aarhus PET endpoint, the same as happened when each earlier site was added.

The manifest's receivers mirror Esbjerg's, with Østjyllands Politi, Beredskabsstyrelsen Herning and Aarhus Kommune as local actors, and Region Midtjylland as a conditional observer for casualty scenarios.

## 5. Agent context

Built 2026-10-24 in `src/site_context.js`. Without it the Mission Console (Agent B) never rendered for this site, because the agent chapter is skipped for a site with no context. Every position comes from our own data: the traced boundary (container terminal centre), Lucas's click beside the largest hangar, the middle pier where AAR-N18 sits, and the crane quay where AAR-N06 sits. All marked `approximate`. Names are descriptive, never an operator, and tank contents are not claimed. Refine from OSM or the port's plan.

## 6. Scenarios

Both fly the same fixed-wing, at 36 m/s with 280 m turns, through `_filletedRoute` in `src/drones.js`, with the same detection data. Altitudes include the site's 42 m of ground.

| Scenario | Path | What it is for |
|---|---|---|
| `aarhus_fixedwing_probe` | In off the bay, west down the container terminal, over the oil pier, a late loiter over the pier, out northeast | The probe story: it maps the port, dwells, leaves |
| `aarhus_fixedwing_inland` (2026-10-26) | In from 3 km inland, dead straight and level at 650 m east across the container yards and the Crane Quay to the east tip, one circle over the bay, out east-northeast | The film. A follow view behind it looks out over the harbour and the bay, so after a pause everything ahead is loaded or is water |

The inland route, measured: detected at 42 s, the straight level leg runs 67 to 134 s, the circle 148 to 203 s fully inside sensor range, contact lost at 212 s, scenario ends at 244 s.

## 7. Not built yet

- **Consequence routing** (`src/consequence_routing.js`): fire, hospital and rescue for a scene. It returns nothing for this site until an entry exists. The fire service is already modelled as `kbr-ostjyllands` (Østjyllands Brandvæsen, which covers Aarhus); it needs a destination and an entry here.
