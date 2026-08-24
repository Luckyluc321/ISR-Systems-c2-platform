# Cross-agency flows

| Version | Date | Source of truth |
|---|---|---|
| 0.1 (working draft) | 2026-08-24 | Working tree at HEAD `f3998a8` |

Companion to the ISR C2 Interface Design Document (IDD). This document maps how a single detection event fans out into notifications, handoffs, and coordinated actions across the Danish government agencies and civil operators the platform serves.

Read IDD Section IF-6 (Receiver profile and interaction contract) first — the role registry, relationship classifications, and flow-type taxonomy referenced here are defined there.

---

## 0. Reading conventions

Every flow in this document is expressed as one of the ten canonical flow types defined in IDD IF-6.5:

| Flow | Meaning |
|---|---|
| `notification` | System-generated push, no human action required. |
| `advisory` | Human FYI, "you should know". |
| `cascade` | Top-down mandatory push (parent to child in a branch). |
| `escalation` | Bottom-up authority request (child to parent). |
| `handoff` | Ownership transfer of the case. |
| `request-support` | Peer asks peer for help (patrols, aircraft, expertise). |
| `coordination` | Joint action, shared ownership. |
| `observer-add` | Loop a role in without giving them action authority. |
| `observer-promote` | Observer requests actor status. |
| `situation-report` | Downstream to upstream status update. |

Which flows are allowed between any two roles is gated by their relationship (self / parent / child / sibling / same-branch / cross-branch). The full matrix lives in IDD IF-6.6.

---

## 1. Scenario A · Hostile quadcopter incursion at Copenhagen Airport

**Trigger.** A DJI Matrice quadcopter formation crosses the sensor mesh at CPH Airport. Classification: hostile. Threat: high.

### 1.1 First minute — automatic notifications

The platform reads `SITES.cph.receivers` and pushes a `notification` to every actor-mode receiver:

| Role | mode | flow | Content |
|---|---|---|---|
| `politi-kbh` | actor | `notification` | Case opened. Detection Brief attached. Acknowledge required within 90 s. |
| `politi-vestegn` | actor | `notification` | Same brief. Local jurisdiction acknowledgment. |
| `brs-hedehusene` | actor | `notification` | Response teams on standby cue. |
| `flv-skrydstrup` | actor | `notification` | Air Force on-call squadron alerted. Fighter QRA available. |
| `flv-karup` | actor | `notification` | Helicopter Wing alerted. Tactical intercept capability. |
| `agency-traf` | actor | `notification` | Regulator informed. Airspace advisory pending assessment. |
| `kom-taarnby` | actor | `notification` | Municipal crisis staff alerted. Airport jurisdiction. |

Simultaneously, observer-mode receivers get the same push at `info` priority:

- `rigspoliti`, `pet`, `politi-nsk` — national police intelligence layer.
- `forsvaret`, `forsvarskmd`, `fe`, `agency-cfcs` — defence and cyber layer.
- `min-just`, `min-fors`, `min-erhverv` — ministerial oversight.

Conditional observers stay dormant unless the routing rules match:

- `region-hst` — added on `casualty-scenario`.
- `hospital-rigshospitalet` — added on `mass-casualty`.
- `brs-kemisk`, `brs-nukleart` — added on `cbrn-threat` / `nuclear-threat`.
- `hjv-distrikt-kbh` — added on `sustained-incident`.

Every push writes to `event.interactions` for audit + `event.routingHistory` for delivery journal.

### 1.2 Operator escalates — cascade

The CPH operator promotes the event from active to escalated (site security has confirmed live threat, requesting national response). This fires a `cascade` from `op-cph-airports` to national-tier receivers:

- `rigspoliti` — cascade payload includes Detection Brief PDF + evidence bundle.
- `forsvarskmd` — cascade with intercept coordination request.

Cascade is allowed operator → any receiver (per canInitiate matrix, operators can push any flow to receivers). The cascade also promotes any observer at those roles to actor mode automatically.

### 1.3 Response coordination — coordination + request-support

Once `politi-kbh` acknowledges, they can initiate:

- `coordination` with `brs-hedehusene` — joint scene management. Shared ownership recorded on the event.
- `request-support` to `politi-vestegn` — sibling peer request for patrol reinforcement (both are children of `politi`, so sibling matrix allows it).
- `request-support` to `flv-karup` — cross-branch peer request for helicopter surveillance. Cross-branch matrix allows request-support bilaterally.

`flv-skrydstrup` on their own initiative can:

- `situation-report` upward to `forsvarskmd` — status of QRA readiness posture.
- `advisory` to `politi-kbh` — cross-branch FYI on fighter posture (no ownership transfer).

### 1.4 Threat cross-cues to Amager Koblingsstation — shadow spawn

The swarm crosses into AMK's sensor coverage. Platform automatically:

1. Spawns shadow event (`DET-YYYYMMDD-9002`) via `_spawnLinkedSiteEvent`.
2. Reads `SITES.energinet_amager_koblingsstation.receivers`.
3. Pushes shadow-spawn advisory to every AMK-scoped receiver.

New actors joining on the shadow event:

- `op-energinet` — site operator.
- `politi-vestegn` — already actor on CPH primary. Now also actor on AMK shadow (same jurisdiction).
- `politi-kbh` — dual jurisdiction (Amager sits inside København district).
- `brs-hedehusene` — regional continuity.
- `kom-taarnby` — municipal continuity.

New observers on shadow:

- `agency-ener` — energy regulator.
- `min-klim` — climate + energy ministry.
- All the CPH-scope observers stay in the loop via the linked event chain.

Toast fired to every AMK-scoped receiver: `Advisory · 5x DJI Matrice re-acquired at Amager Koblingsstation. Linked from DET-...9001.`

### 1.5 Neutralisation — post-incident handoffs

Interceptors kill 4 of 5 drones at AMK. Overwatch escapes.

- `politi-kbh` fires `handoff` to `politi-special-nsk` for state-actor investigation (sibling handoff, allowed).
- `flv-skrydstrup` fires `situation-report` to `forsvarskmd` — "engagement complete, one target escaped east, tracking".
- `op-cph-airports` and `op-energinet` fire `handoff` to `agency-traf` for airspace advisory maintenance.
- `min-just` and `min-fors` receive automatic `notification` — outcome recorded at ministerial layer.

Dispatch to Verá command layer (operator action) closes the operational loop.

### 1.6 Cross-agency communication chain (example subset)

```
op-cph-airports (operator)
  ├─ notification → politi-kbh (auto)
  ├─ notification → brs-hedehusene (auto)
  ├─ notification → flv-skrydstrup (auto)
  ├─ cascade → rigspoliti (manual escalation)
  └─ cascade → forsvarskmd (manual escalation)

politi-kbh (actor, primary response)
  ├─ coordination → brs-hedehusene (joint scene mgmt)
  ├─ request-support → politi-vestegn (sibling patrols)
  ├─ request-support → flv-karup (cross-branch helo surveillance)
  ├─ handoff → politi-special-nsk (state-actor investigation)
  └─ situation-report → rigspoliti (parent update)

flv-skrydstrup (actor, air response)
  ├─ advisory → politi-kbh (fighter posture FYI)
  ├─ situation-report → forsvarskmd (QRA readiness)
  └─ observer-add → fe (loop in defence intel)
```

Every arrow in that graph is one row in `event.interactions`.

---

## 2. Scenario B · Substation approach at Energinet Kassø

**Trigger.** A fixed-wing platform tracks toward Kassø HV substation. Classification: hostile. Threat: medium. No cross-cue to another site.

### 2.1 First minute — automatic notifications

Kassø is a single-site event (no chain). Platform reads `SITES.energinet_kassoe.receivers`:

- `op-energinet` — site operator, actor.
- `brs` (umbrella) — actor, emergency response.
- `politi-sydostjyl` — actor, local district (added by site config specifically for Kassø).
- `brs-haderslev` — actor, regional BRS centre.
- `region-syd` — observer, conditional on `casualty-scenario`.

Observers auto-added at national layer: `agency-ener`, `min-klim`, `forsvarskmd`, `fe`, `agency-cfcs`, `pet`, `min-fors`, `brs-kemisk`, `brs-nukleart`.

### 2.2 Fixed-wing platform-type triggers specific routing

Fixed-wing at cruise altitude is a distinct threat profile. The threat-type routing matrix (planned, `routing.js`) adds `agency-traf` as an actor for airspace de-confliction and pushes an `observer-add` for Eurocontrol NOTAM coordination.

### 2.3 Coordination — Energinet acts, Politi supports

`op-energinet` initiates:

- `handoff` — nominal transfer of case ownership to `politi-sydostjyl` for physical response. Site operator retains site-security posture but police leads incident response.
- `coordination` with `brs-haderslev` — joint hazmat + rescue posture in case of substation breach.
- `situation-report` — periodic status to `min-klim` (grid operator ministerial oversight).

`politi-sydostjyl` on receipt:

- `request-support` to `flv-skrydstrup` for airborne surveillance. Cross-branch bilateral request.
- `escalation` to `rigspoliti` if threat firms — parent authority for extra-district resources.
- `advisory` to `hjv-distrikt-sonderjyl` — cross-branch FYI to home guard for potential reinforcement.

### 2.4 What Energinet DSO uniquely provides

Energinet operates the grid. Their platform view surfaces context Politi and BRS cannot:

- Which HV bus this substation feeds — knock-on load balancing implications.
- Which downstream DSO territories depend on this substation for import.
- SCADA integration for grid isolation posture — Politi can request, Energinet executes.

Cross-agency implication: on `hostile` + `substation` events, response playbooks (planned P3 audit patch) should include a "grid isolation" CTA visible ONLY to Energinet actors. That CTA fires a SCADA advisory. Every other agency observing the event sees the CTA state as read-only status ("Grid isolation posture: DEPLOYED at 09:42:15Z by op-energinet").

---

## 3. Scenario C · Cruise-missile signature at Copenhagen airspace

**Trigger.** A cruise-missile-class kinematic signature is detected on approach vector to CPH. Classification: hostile. Threat: critical. Platform: missile.

### 3.1 First seconds — automatic full-tier escalation

Missile platform triggers auto-cascade in the routing rules (per runbook). No operator confirmation required. Every actor at every tier receives a `notification` marked `priority: critical`.

- All CPH-scoped actors from Scenario A.
- Plus `sok-aalborg` (Jægerkorpset SOF), `haer-slagelse` (Gardehusarregimentet), `flv-karup-control` (Air Control Wing radar picture), `sov-frederikshavn` (naval interdiction posture).

### 3.2 Radio silence protocol

On tier 4 dispatch (Air Force fighter response), non-essential radio traffic drops per doctrine. Platform surfaces this in every actor's mission console: `Air Force operational control. Radio silence for non-essential comms.`

### 3.3 Command layer takes over

`forsvarskmd` becomes the primary owner. Every prior actor role converts to `observer` mode automatically. Escalation authority transfers upward until neutralisation or interception.

- Operators: switch to sensor-monitoring only.
- Politi: cordon posture, ground evacuation.
- BRS: mass-casualty triage prep.

The chain-of-command handoff is expressed as `handoff` interactions from every prior actor to `forsvarskmd`, with mode-change side effect on `event.participants`.

---

## 4. Cross-branch collaboration patterns

Common flow patterns that recur across scenarios. Each is a template a partner integrator can point at when asking "how does agency X talk to agency Y".

### 4.1 Same-branch sibling collaboration

Two Politi districts, two BRS centres, two Forsvaret wings. Peer relationship (share a parent). Allowed flows: `notification`, `advisory`, `handoff`, `request-support`, `coordination`, `observer-add`.

**Example**: `politi-kbh` requests patrol reinforcement from `politi-vestegn`. Sibling `request-support`. Peer approval, no parent authority needed.

**Example**: `brs-hedehusene` transfers case ownership to `brs-herning` when the incident geography shifts west. Sibling `handoff`. Both children of `brs`, handoff allowed.

### 4.2 Same-branch parent-child cascade

Rigspolitiet directs regional Politi. Beredskabsstyrelsen HQ directs BRS centres. Forsvarskommandoen directs Flyvevåbnet / Hæren / Søværnet.

Allowed flows from parent: `notification`, `advisory`, `cascade`, `handoff`, `request-support`, `coordination`, `observer-add`.

Allowed flows from child (upward): `notification`, `advisory`, `escalation`, `handoff`, `request-support`, `coordination`, `observer-add`, `situation-report`.

**Example**: national-level Politi directive during heightened threat posture. `cascade` from `rigspoliti` to every regional politikreds. Mandatory acknowledgment within 60 s. Rejection requires justification.

**Example**: regional Politi requests national-authority resources for hostage-scenario response. `escalation` upward to `rigspoliti` with reason + resource ask.

### 4.3 Cross-branch bilateral coordination

Politi and Forsvaret. Politi and BRS. Politi and Energinet DSO. Different top-level agency branches. No cascade allowed (no parent authority across branches). Bilateral peer flows only.

Allowed flows: `notification`, `advisory`, `handoff`, `request-support`, `coordination`, `observer-add`.

**Example**: `politi-kbh` and `flv-skrydstrup` coordinate on airport airspace closure. Cross-branch `coordination` — shared ownership recorded on both role's task lists. Neither has authority over the other; both must sign off on tactical decisions.

**Example**: `politi-sydostjyl` asks `flv-skrydstrup` for helicopter surveillance over a Kassø substation approach. Cross-branch `request-support`. Air Force can accept or decline; no compulsion.

### 4.4 Observer-add for command awareness

Any actor can loop any role in as observer at any time. Common patterns:

- `politi-kbh` loops in `min-just` on high-profile incidents for ministerial awareness.
- `flv-skrydstrup` loops in `fe` on foreign-actor suspicion for intel picture.
- `op-cph-airports` loops in `agency-traf` on airspace-restriction decisions for regulatory record.

Observer-add creates a `notification` push + adds the role to `event.participants` in observer mode. Recipient sees the case in their inbox with an OBSERVER chip.

### 4.5 Observer promotion

Observer receives escalating advisories and decides they need to act. Fires `observer-promote` — self-promotion to actor mode. Any existing actor can approve within a short window (default 30 s auto-approve if no rejection).

**Example**: `fe` observes a hostile drone incursion at CPH. Reads a pattern-match advisory suggesting foreign-actor coordination across multiple sites. Promotes to actor mode. Now has CTAs for intel actions (log to intel picture, coordinate with CFCS).

---

## 5. Chain-of-command decision trees

Two representative decision trees. Both drive the routing rules that fire automatic escalations.

### 5.1 Hostile quadcopter at critical infrastructure

```
Detection classified hostile-high
│
├── Auto push (notification) → site.receivers[actor]
│      ├─ site operator
│      ├─ local Politi district
│      ├─ regional BRS centre
│      └─ nearest Air Force wing (if aviation-relevant)
│
├── Auto add (observer) → national layer
│      ├─ Rigspolitiet
│      ├─ PET (state-actor pattern watch)
│      ├─ Forsvarskommandoen (situational awareness)
│      ├─ FE (foreign intel pattern watch)
│      └─ Justits + Forsvar + relevant sector ministry
│
├── After 90 s if no operator acknowledgment
│      └─ Auto-escalate to rigspoliti (missed-ack escalation rule)
│
├── If crosses inner perimeter of critical site
│      └─ Auto-escalate to forsvarskmd (physical-breach rule)
│
└── If cross-cues to another site (shadow spawn)
       └─ Repeat auto-push + auto-add for that site's receivers
```

### 5.2 Missile signature toward CPH

```
Detection classified missile-critical
│
├── Auto push (notification, priority: critical) → every tier simultaneously
│      ├─ site operator
│      ├─ local Politi + regional BRS
│      ├─ Air Force fighter QRA + Air Control Wing + Helicopter Wing
│      ├─ Forsvarskommandoen (command layer, primary owner)
│      ├─ Special Operations Command (SOK) — awareness
│      ├─ Naval interdiction (Søværnet Frederikshavn) — awareness
│      ├─ FE + CFCS + PET (intel layer)
│      └─ Every relevant ministry
│
├── Every observer → auto-promote to actor if they choose to act
│
├── Air Force acts → forsvarskmd assumes primary ownership
│      └─ Every prior actor → convert to observer (mode change)
│
├── Radio silence protocol activates on tier 4 dispatch
│      └─ Platform surfaces silence status in every mission console
│
└── Outcome recorded → cascade to ministerial layer + evidence handoff to Politi
```

---

## 6. Onboarding a new receiver into a scenario

Zero code changes required for a new government profile. Two data-side steps:

1. Add role to `RECEIVERS` in `roles.js` with correct `parentId` + `agencyBranch` (see IDD IF-6.2).
2. Add to relevant `SITES[siteId].receivers` blocks with `mode: 'actor'` or `mode: 'observer'` and appropriate `tier` / `condition`.

The runtime routing engine (`impactedRolesFor`, `pushNotification`, `_spawnLinkedSiteEvent`) picks up the new role on the next event automatically. Every allowed flow between the new role and every existing role is governed by the flow matrix (IDD IF-6.6) without any per-role coding.

**Example**: adding `politi-havnepolitiet` (maritime port police) as a new specialty unit under `politi` for harbour incidents:

1. `roles.js`: add row `{id: 'politi-havnepolitiet', kind: 'receiver', type: 'leaf', parentId: 'politi', org: 'Havnepolitiet', ...}`.
2. `sites.js`: for `esbjerg` (harbour), add `{id: 'politi-havnepolitiet', mode: 'actor', role: 'maritime-primary', tier: 1}` to `receivers` block.

Next Esbjerg event auto-notifies Havnepolitiet. Every allowed peer interaction with `politi-sydsonderjyl` (sibling), `politi-vestegn` (sibling), `sov-frederikshavn` (cross-branch), etc. works immediately. No further code required.

---

## 7. What this document does NOT cover

Explicitly out of scope for v0.1 — track separately as they land.

- **Threat-type routing matrix** (`routing.js`) — the `(siteType × platform × classification) → auto-observer role set` lookup. Planned P3 audit patch.
- **Cross-site combined evidence report** — multi-event PDF / JSON / CSV bundling for chain incidents. Planned as Option B in the marker-filter chain-scope work.
- **PDF layout of the multi-event report** — TBD template.
- **UI affordances for observer-promote acceptance / rejection** — Phase 4 work.
- **Rejection / declined flow protocol** — when a receiver rejects a cascade or handoff, what's the audit trail + backup escalation path.

---

## 8. Change log

| Date | Change | Author |
|---|---|---|
| 2026-08-24 | v0.1 initial draft — scenarios A, B, C + collaboration patterns + decision trees | ISR C2 build |
