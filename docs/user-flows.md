# ISR C2 Platform — User Flows

Internal reference. The connective tissue between every module. Every feature must slot into a flow or explicitly extend one. Foundation for **plug-and-play** readiness: when real sensor mesh comes online, these flows should carry it end to end without code changes.

Last updated 2026-09-06, reflecting the four escalation-extension flows (SLA overdue, structured progress status, post-incident handoff chain, observer revoke) added on top of the P92 / P95 / P83 baseline.

---

## Three-Tenant Model

Strict isolation. Separate deployments in prod. No cross-tenant access.

| Tenant | Who | What they buy | Access |
|---|---|---|---|
| **Admin** | ISR internal (L. Flindt et al.) | Full platform. Provisions sensors, sites, rules, receiver mappings. | Everything |
| **Operator** | Site owner (utility, port, grid, data centre, telecom, hospital) | SaaS + HaaS. Sensors on their site + full C2 dashboard. | Live map, sensor health, event ledger, escalate to receivers, config, history, fleet |
| **Receiver** | Government agency (Politi, PET, FE, Forsvaret branches + bases, Beredskabsstyrelsen) | SaaS only. Receives escalations from operators. Now hierarchical — see below. | Filtered inbox scoped to their destination IDs, brief detail, acknowledge, respond, cascade, dispatch counter-response |

---

## Receiver Hierarchy (P92)

Receivers are now nested. A parent role lands on a chooser grid of children; a leaf role lands on the normal inbox. The tree:

```
Receivers
├── PET                                    (leaf — intelligence)
├── FE                                     (leaf — defence intelligence)
├── Beredskabsstyrelsen                    (leaf — emergency mgmt)
├── Forsvarskommandoen                     (leaf — national defence HQ)
├── Forsvaret                              (PARENT — Danish Defence umbrella)
│   ├── Flyvevåbnet                        (PARENT — Air Force branch)
│   │   ├── Skrydstrup                     (leaf — F-35 QRA)
│   │   └── Karup                          (leaf — Helicopter Wing)
│   ├── Hæren                              (PARENT — Army branch)
│   │   ├── Slagelse (Gardehusarregimentet)
│   │   ├── Høvelte (Livgarden)
│   │   ├── Varde (Efterretningsregimentet)
│   │   ├── Bornholm (Bornholms Værn, Almegård)
│   │   └── Oksbøl (Hærens Kampskole)
│   ├── Søværnet                           (PARENT — Navy branch)
│   │   ├── Frederikshavn
│   │   └── Korsør
│   └── SOK                                (PARENT — Special Ops)
│       └── Aalborg (Jægerkorpset)
└── Politi                                 (PARENT — Danish Police umbrella)
    ├── Rigspolitiet (National HQ)
    ├── Politi København
    └── Politi Sydvestjylland
```

Adding a new base = one entry in `roles.js` RECEIVERS + one line in `ROLE_DISPATCH_SCOPE`. No other code changes required.

---

## Flow 1: Operator — Detection to Resolution

The primary journey. Everything else exists to support this.

```mermaid
flowchart TD
    A[NN emits detection on sensor node ~500ms tick] --> B[Ingestion attaches to event registry, sync subject]
    B --> C[Track billboard + trail on map, entry in Event Ledger]
    C --> D{Auto-escalation rule matches on subject?}
    D -->|Yes| E[Auto-fire to configured destinations]
    D -->|No| F[Operator opens detail panel]
    F --> G[Reviews DetectionSubject: class, cardinality, formation, behavior, threat flags]
    G --> H{Threat real?}
    H -->|Friendly / false| I[Log only, mark resolved]
    H -->|Hostile / unknown| J[Click Escalate]
    J --> K[Select destinations per tier, pick channels]
    K --> L[Preview Detection Brief PDF]
    L --> M[Send. Escalation stamped on event]
    E --> N[Receiver acks land back on event ledger]
    M --> N
    N --> O[Operator marks resolved OR event auto-closes on neutralisation]
    I --> P[Event moves to History with debrief]
    O --> P
```

**Modules touched:** map + entities, alert strip / event ledger, detail panel, DetectionSubject (attached at addEvent), auto-escalation rules, escalate modal, destinations, brief preview, receiver ack callback, history + debrief.

**Not in this flow (correctly):** anything kinetic. ISR provides intelligence — government responds.

---

## Flow 2: Receiver Parent — Landing to Drill-In (P92)

New with P92. When a receiver logs in as a parent role (Forsvaret, Flyvevåbnet, Hæren, Politi, etc.), they land on a chooser grid before seeing any inbox.

```mermaid
flowchart TD
    A[Receiver logs in as parent role] --> B[renderReceiverParentLanding fires]
    B --> C[Tile grid of children with active event badges]
    C --> D{Which child?}
    D -->|Base with active event| E[Click tile → setActiveRole → normal receiver view]
    D -->|Base with no activity| F[Click tile → empty inbox, standing by]
    D -->|Branch parent| G[Click tile → drill into nested landing]
    E --> H[Normal receiver flow — Flow 3 below]
    G --> C
```

**Modules touched:** roles.js (type=parent), renderReceiverParentLanding, _bindReceiverParentActions, memoization keyed on child active counts.

**Sub-flow: back to parent.** Currently done by re-selecting the parent from the account dropdown. Future: add "← Back to Forsvaret" chip at the top of leaf inbox views.

---

## Flow 3: Receiver Leaf — Inbox to Dispatch

Government-side. What a duty officer does when a brief lands in their queue. Now includes graduated counter-response dispatch (P86, P87).

```mermaid
flowchart TD
    A[Escalation arrives in receiver inbox] --> B[Push via configured channel — email, SMS, Signal, radio, MIP]
    B --> C[Receiver opens web dashboard scoped to destination IDs]
    C --> D[Ledger shows event card. Click Case-file]
    D --> E[Case-file: AI Synthesis Mistral narrative + detection brief + audit + Mission Console]
    E --> F[Mission Console shows: subject one-liner, rationale, YOUR Dispatch Options, other agencies on case]
    F --> G{Action?}
    G -->|Acknowledge| H[Timestamped receipt back to operator]
    G -->|Cascade to FE/PET| I[New escalation created with your role as initiator]
    G -->|Cascade to local Politi| I
    G -->|Dispatch counter-response| J[Level 3 map animation: en_route → engaging → complete]
    G -->|Respond to operator| K[Message returns to operator inbox]
    J --> L[Threat neutralised — event.outcome = neutralized]
    L --> M[Post-incident responders panel opens for ground handoff]
    H --> N[Continue monitoring, mark resolved when done]
    I --> N
    K --> N
    M --> N
```

**Modules touched:** receiver dashboard, event filter by `destinationIds`, workspace (Case-file + Live Map modes), renderWorkspaceMissionConsole, ROLE_DISPATCH_SCOPE, dispatchCounterResponse, CD_PROFILE, Mistral streaming (mistral.js).

**Role-scoping (P90):** Dispatch button only appears for asset kinds this role can command. Other agencies' assets show as "OTHER AGENCY" for situational awareness only.

---

## Flow 4: Admin — Provisioning

How ISR wires a new operator or receiver into the platform.

```mermaid
flowchart LR
    A[Admin opens Config] --> B{Provision what?}
    B --> C[Add new site to sites.js + site_context.js]
    B --> D[Add new sensor node to SensorNodeDescriptor via adapter registration]
    B --> E[Add new receiver base to roles.js + destinations.js]
    B --> F[Add new response asset to response_assets.js]
    B --> G[Add new auto-escalation rule via UI]
    C --> H[Assign to operator via siteIds]
    D --> I[NN adapter starts emitting detections]
    E --> J[Update ROLE_DISPATCH_SCOPE if base has counter-assets]
    F --> K[No further wiring — response bundle picks up automatically]
    G --> L[Persisted via localStorage today, backend Phase 2]
```

**Plug-and-play checklist for new sensor:**
1. Ship SensorNodeDescriptor entry pointing to node
2. NN adapter registers → ingestion consumes NN output stream
3. Detections flow through DetectionSubject → Correlation → Narrative → Recommendation → Escalation Router
4. Zero platform code changes if the NN output schema is honoured

---

## Flow 5: Counter-Response Dispatch (P87 Level 3)

Detailed drill-in for the dispatch state machine. Fires from Flow 3's "Dispatch counter-response" action.

```mermaid
flowchart TD
    A[User clicks Dispatch button in Mission Console] --> B[dispatchCounterResponse eventId, asset]
    B --> C{Static ground asset?}
    C -->|Yes: army-c-uas at base| D[state = engaging immediately, radiation cone rendered]
    C -->|No: helicopter/drone/patrol| E[state = en_route, Cesium billboard flies at kind cruiseKmh]
    E --> F[rAF tick advances position toward live threat]
    F --> G{Arrived within arriveAtM?}
    G -->|No| F
    G -->|Yes| H[state = engaging]
    D --> H
    H --> I[engageSec timer]
    I --> J{Visual verify only?}
    J -->|Yes ISR drone| K[state = complete, toast, no neutralise]
    J -->|No| L[event.outcome = neutralized, toast]
    K --> M[Entities retire after 5s]
    L --> M
```

**Kinds + profiles** (see `CD_PROFILE` in main.js):
- helicopter-intercept: 250 km/h, 500m arrive, 8s engagement
- army-c-uas: 0 km/h (static), 12s jam
- police-c-uas: 80 km/h drive, 500m, 10s
- army-isr-drone: 60 km/h flight, 300m orbit, 6s visual verify (does NOT neutralise)
- sof-tactical: 200 km/h air insertion, 400m, 15s
- wildlife-response: 20 km/h on-airport, 200m, 4s

---

## Flow 6: Escalation Extensions (SLA, Progress, Chain, Observer Revoke)

Four gap-fill flows layered on top of the operator to receiver contract. All four are detection-only. No layer here triggers auto-cascade, kinetic response, or automatic re-routing. Every action is a human decision surfaced with clean data.

### 6.1 SLA Timer to OVERDUE

Per-tier acknowledgement windows. `rules.js` sweeps every 15 seconds. When an escalation has not reached `acknowledged` within the tier window, the record flips to `overdue = true` and both the operator and receiver see the flag. No auto-cascade fires.

Windows: T1 = 5 min, T2 = 15 min, T3 = 30 min, T4 = 60 min, T5 = 120 min.

```mermaid
sequenceDiagram
    autonumber
    participant Op as Operator (site owner)
    participant Ev as events.js
    participant R as rules.js sweep (15s)
    participant W as window (CustomEvent)
    participant Rcv as Receiver (agency)

    Op->>Ev: escalateEvent → rec.status = sent
    Note over Ev: rec.overdue = false<br/>rec.initiatedAt = now
    Ev-->>Rcv: dispatched (delivered → read timers)

    loop every 15s
        R->>Ev: sweepSLAOverdue()
        R->>R: for each rec: status != acknowledged?
        R->>R: age >= SLA_MINS_BY_TIER[tier] * 60s?
    end

    R->>Ev: setEscalationOverdue(eventId, escId)
    Ev->>Ev: rec.overdue = true<br/>notes.push('sla-overdue')
    Ev-->>W: CustomEvent('escalation-overdue')
    W-->>Op: toast: "SLA overdue · <dest> · operator judgement needed"
    W-->>Rcv: toast (same session-wide broadcast)
    Note over Op,Rcv: NO auto-cascade. Human decides whether to re-route.
```

**Invariant:** `setEscalationOverdue` only writes state + emits a browser event. It never calls `escalateEvent`, never touches destinations, never triggers a rule.

---

### 6.2 Structured Progress Status

Delivery axis (`status`) and progress axis (`progressStatus`) are orthogonal. `status` still tracks `sent → delivered → read → acknowledged`. `progressStatus` tracks what the receiver does with the case after ack: `in-progress → resolved` or `→ blocked(reason)`.

Auto-advance: any physical-response CTA the receiver clicks flips the receiver's own escalation record to `in-progress`. Explicit "Update status" CTA covers resolve, blocked, and freeform re-set.

```mermaid
sequenceDiagram
    autonumber
    participant Rcv as Receiver actor
    participant UI as main.js CTA handler
    participant Adp as dispatch adapter
    participant Ev as events.js
    participant Op as Operator (log view)

    Rcv->>UI: click "Deploy patrol"
    UI->>UI: STUB_DISPATCH_ACTIONS.has(action)
    UI->>Ev: updateEscalationProgress(evId, myRec.id, 'in-progress')
    Note over Ev: rec.progressStatus = 'in-progress'<br/>rec.progressHistory.push(...)
    UI->>Adp: adapter.dispatch({ action, event })
    Adp-->>UI: result
    UI-->>Rcv: toast "deploy patrol · logged"
    Op->>Op: escalation log re-renders → IN PROGRESS badge

    Rcv->>UI: click "Update status"
    UI-->>Rcv: prompt: in-progress | resolved | blocked
    alt blocked
        UI-->>Rcv: prompt: reason (required)
        UI->>Ev: updateEscalationProgress('blocked', reason)
        Note over Ev: rec.blockedReason = reason
    else resolved
        UI->>Ev: updateEscalationProgress('resolved')
    end
    UI-->>Op: log renders BLOCKED / RESOLVED badge on rec
    Note over Op,Rcv: Log never feeds back into agent prompts.<br/>Write-only from the platform's perspective.
```

**Invariant:** `progressStatus` is only ever set by explicit human action (physical-response click or "Update status"). No timer, rule, or agent writes it.

---

### 6.3 Post-Incident Handoff Chain

Ground-response coordination after `dispatchOutcomes` is confirmed. `dispatchPostIncident` creates a root chain entry. Whoever holds any entry can hand off to another responder (creates a child linked via `chainParentId`) or mark their entry resolved. Close-event gate: every leaf (an entry with no child) must be resolved.

```mermaid
sequenceDiagram
    autonumber
    participant Op as Operator
    participant UI as main.js Step 5
    participant Ev as events.js chain funcs
    participant PA as Politi (root)
    participant BRS as Beredskabsstyrelsen (child)

    Op->>UI: click Dispatch → Politi
    UI->>Ev: dispatchPostIncident(evId, 'politi-kbh')
    Ev->>Ev: addPostIncidentChainRoot(evId, 'politi-kbh', operator)
    Note over Ev: chain = [{id:PIC-1, destId:politi-kbh,<br/>chainParentId:null, status:open}]
    UI-->>PA: "Politi Kbh dispatched"

    PA->>UI: click "Hand off" on PIC-1
    UI-->>PA: prompt fresh responders (not yet in chain)
    PA->>UI: select Beredskabsstyrelsen
    UI->>Ev: handoffPostIncidentChain(evId, PIC-1, 'brs-kbh', politi-actor)
    Ev->>Ev: chain.push({id:PIC-2, chainParentId:PIC-1, status:open})
    Note over Ev: PIC-1 is no longer a leaf.<br/>Leaves now = [PIC-2].

    BRS->>UI: click "Mark resolved" on PIC-2
    UI->>Ev: resolvePostIncidentChainEntry(evId, PIC-2, brs-actor)
    Note over Ev: PIC-2.status = 'resolved'<br/>PIC-2.resolvedBy = brs-actor

    Op->>UI: view Step 6 close gate
    UI->>Ev: postIncidentChainAllLeavesResolved(event)
    alt every leaf resolved
        Ev-->>UI: true
        UI-->>Op: "Close event" button shown
    else any leaf still open
        Ev-->>UI: false
        UI-->>Op: Step 6 hidden
    end
```

**Invariant:** Any entry can spawn a child. Resolve only affects the entry, not its ancestors or descendants. Close gate reads `postIncidentChainLeaves(event)`, so intermediate handed-off entries are not part of the check.

---

### 6.4 Observer Add and Revoke

Observers are looped in via `pushScopedNotification`. Revoke rules:
- Original operator + admin can revoke anyone.
- Any actor can revoke observers they themselves added.
- Anyone can self-revoke (leave the case).

`× ` visibility on chips is gated by `_canRevokeParticipant`. The handler applies the same check as defence-in-depth.

```mermaid
sequenceDiagram
    autonumber
    participant Actor as Actor role
    participant UI as main.js CTA + strip
    participant Ev as events.js participants
    participant Notif as pushNotification
    participant Obs as Observer role (target)

    Actor->>UI: click "Loop in observer" → picker
    UI->>UI: _openObserverPicker
    Actor->>UI: select role from 242 pool
    UI->>Ev: pushScopedNotification (adds to participants Map)
    Ev-->>Obs: toast "Looped into event"

    Note over UI: participants strip now renders new observer chip

    Actor->>UI: click × on observer chip
    UI->>UI: _canRevokeParticipant(event, activeRole, targetRole)?
    alt authorized
        UI->>Ev: revokeParticipant(evId, targetRole, revokedBy)
        Ev->>Ev: participants.delete(targetRole)<br/>notes.push('participant-revoke')
        UI->>Notif: pushNotification(targetRole, {kind:'observer-revoked'})
        Notif-->>Obs: toast "You have been removed from event"
        UI-->>Actor: toast "Removed <name> from event"
    else not authorized
        UI-->>Actor: toast "You cannot revoke this participant."
    end

    Note over Obs: Self-revoke path: Obs clicks × on their own chip → same handler,<br/>always authorized, toast "You left the case." No notification to self.
```

**Invariant:** Once removed, `event.participants.get(roleId)` returns `undefined`. The observer stops receiving `pushScopedNotification` triggers because those iterate participants at send time.

---

## Flow 7: Event Transmission Relevance + Incident Report

Two coupled additions on top of the Flow 6 escalation extensions. Same detection-only stance. Same accountability guarantees.

### 7.1 Domain Relevance Filter

Every destination declares operational domains (maritime, aviation, ground, intel, cyber, all). Every event carries a `domainScope` computed from site type plus platform, unioned across linked shadow events. `destinationsForEvent(event)` intersects the two so an inland Energinet substation event never routes to Kystvagten, and a drone that starts inland and crosses to the coastline picks up maritime destinations from the moment of the link.

```mermaid
sequenceDiagram
    autonumber
    participant Sensor as Sensor mesh
    participant Ev as events.js addEvent
    participant Site as Site registry
    participant Dst as destinations.js
    participant Modal as Escalate modal
    participant Rules as rules.js fireRule

    Sensor->>Ev: new detection at CPH (airport)
    Ev->>Site: defaultDomainsForSite('cph')
    Site-->>Ev: ['aviation', 'ground']
    Ev->>Ev: event.domainScope = ['aviation', 'ground']
    Ev->>Ev: platform=missile → adds 'aviation' (idempotent)

    Note over Ev: Later: shadow event at Esbjerg links back
    Ev->>Ev: unionLinkedEventDomains(cph.id)<br/>scope = ['aviation','ground','maritime']

    Modal->>Dst: destinationsForEvent(event)
    Dst->>Dst: filter site catalog by scope intersection
    Dst-->>Modal: Kystvagten NOW included<br/>(scope now contains maritime)

    Rules->>Dst: destinationsForEvent(event) inside fireRule
    Rules-->>Ev: auto-rule dispatches to domain-relevant destinations only
```

**Invariant:** `destinationsForEvent` is a pure filter. Never calls `escalateEvent`. Never mutates the destination catalog. Never triggers auto-cascade. When `event.domainScope` is missing, it falls back to the unfiltered site list so older callers do not silently lose destinations.

---

### 7.2 Post-Incident Report + Receiver Library

Every event that closes generates a Post-Incident Report attached as `event.postIncidentReport`. Cross-linked shadow events each close independently, so each site's receivers see their own site-scoped report the moment their portion of the incident concludes. The report is rendered inline in the case-file view as Step 7. Historical reports are browsable in the receiver profile via a side-by-side Reports panel that sits next to the Inbox with a filter strip on top (site, kommune, politikreds, region, classification, domain, time range).

```mermaid
sequenceDiagram
    autonumber
    participant Op as Operator
    participant Ev as events.js closeEvent
    participant Gen as post_incident_report.js
    participant Case as Receiver case-file view
    participant Prof as Receiver profile (two-box view)

    Op->>Ev: closeEvent(id)
    Ev->>Ev: status = 'closed', endTime = now
    Ev->>Gen: buildPostIncidentReport(event, {getDestination})
    Gen-->>Ev: {id, event_snapshot, summary, timeline,<br/>escalations, dispatches, handoff_chain,<br/>acknowledgments, ...}
    Note over Ev: event.postIncidentReport attached

    Case->>Case: renderWorkspaceMissionConsole(event)
    Case->>Case: _renderPostIncidentReportPanel<br/>emphasisForBranch(activeRole)
    Note over Case: PET reads it as intel<br/>Politi reads it as ground evidence<br/>Trafikstyrelsen reads it as airspace impact

    Prof->>Prof: two boxes rendered side-by-side<br/>Inbox (left, ~440px) + Reports (right, flex)
    Prof->>Prof: reportsPool = filter EVENTS where PIR exists<br/>AND active role has an escalation on it
    Prof->>Prof: chip strip renders filters from actual variation<br/>in the pool (single-value dims omitted)
    Op->>Prof: change filter chip → re-render<br/>reportsFiltered = applyReportsFilter(pool)
    Op->>Case: click report card → open workspace<br/>→ PIR panel visible
```

**Layout:** Inbox is a fixed-width (440px) column on the left holding the live dispatched queue. Reports is a flex-fill column on the right holding the persistent archive with filter chips on top. Below a viewport width where the two would collide (Reports min-width 500px + Inbox 440px), CSS flex-wrap stacks Reports below Inbox. No media query needed. Filter state is session-only and resets on every role change so PET switching to Politi does not inherit PET's filter set.

**Invariants:**
- Generator is a pure state assembler. No calls to `escalateEvent`, dispatch adapters, or agents. Reads what already exists on the event at close.
- Report attached in a `try/catch` so a generator failure never blocks close.
- Reports pool uses the same `roleDestSet` axis as Inbox, so receiver isolation matches inbox semantics.
- Filter chips only render when the unfiltered pool has 2+ distinct values on that dimension. A dimension with one possible value is noise.
- Seed events (demo historical data) get a boot-time backfill so the panel is populated on demo events too.

---

## Cross-Cutting States

**Site scope:**
```
All Sites (Denmark rollup) → Click site marker → Fly to site → Detail visible → "Fly to Denmark" resets
```

**View mode (operator):**
```
Live Ops (default) ↔ History (event browser) ↔ Fleet (sensor health)
```

**Role switch (all users, for demos + testing):**
```
Any user → Account dropdown → Select any role → body.mode-* class → Full view
```

**Panel state:**
```
Both panels open (default) ↔ Collapse alerts (left) ↔ Collapse detail (right) ↔ Both collapsed for max map real estate
```

**Workspace mode (receiver):**
```
Inbox split view ↔ Case-file (Report) ↔ Live Map — back button exits to inbox
```

---

## Plug-and-Play Readiness Matrix

For each dimension, what is config-driven (plug-and-play) vs code-driven (requires deploy).

| Dimension | Config-driven | Code-driven |
|---|---|---|
| Add new site | ❌ (needs sites.js entry) | ✓ |
| Add new sensor node | Partial — needs adapter registration | ✓ (NN output schema locked in) |
| Add new receiver base | Almost — roles.js + ROLE_DISPATCH_SCOPE | ✓ |
| Add new response asset | ✓ (response_assets.js entry) | — |
| Add new class to taxonomy | ✓ (detection_subject.js CLASS_VOCAB) | — |
| Add new auto-escalation rule | ✓ (rules.js UI, localStorage) | — |
| Change response mapping (kind → asset) | ✓ (tacticalKindsForSubject) | — |
| Add new Mistral prompt language | ✓ (mistral.js WRITING_RULES) | — |
| Add new sensor MODALITY | ❌ (NN output schema is fixed) | ✓ |
| Add new receiver LEVEL (grandchild of parent) | Partial — getRoleChildren supports recursion, landing page renders one level | ✓ (needs UI drill-in state) |
| Change UI layout | ❌ | ✓ |

**Target state (Advance B):** everything above except UI layout becomes config-driven via sovereign backend + admin console.

---

## Known Gaps

These flows exist but have unresolved sub-questions:

- **Onboarding flow** — new operator tenant provisioning, first sensor install, first-run tour. Comes when we sign first paying customer.
- **Billing / account** — Stripe, invoice, tier upgrade. Comes with first paying customer.
- **Multi-user within a tenant** — operator company with three duty officers on shift rotation. Handoff, override, audit log.
- **Sensor commissioning** — HaaS install and calibration flow. Field-side, not web-app.
- **Compliance flow** — GDPR data subject requests, audit export, retention policy. Comes with first regulated customer.
- **Site Context Console (Advance D)** — operator direct-brief to Agent A. Currently site context is static JSON.
- **Multi-receiver coordination (Advance C)** — when 3 receivers acknowledge the same event, each sees what the others did. Currently each receiver's view is isolated.
- **Cross-tenant correlation** — same detection at CPH + Bjæverskov, does the platform automatically link? Correlation Agent supports this but no UI shows the roll-up.

---

## How to Use This Doc

- Adding a feature? Locate the flow. If it fits nowhere, either update the flow or reconsider the feature.
- Reviewing UX? Walk each flow end-to-end with a real user in mind. Break points logged as issues, not silently patched.
- Investor / partner demo? Flows 1, 3, 5 are the tour. Flow 2 (parent → drill in) is the P92 showcase.
- Plug-and-play verification? Check the readiness matrix. Anything with ✓ in the config-driven column should never require a code change to extend.

Kept tight on purpose. If it grows past what fits on one screen, split by tenant.
