# Report shape · how a drone detection becomes a report every agency can read

Plain-language walkthrough for anyone (founder, investor, new team member) who wants to understand what the ISR C2 platform does end-to-end without reading source code. If you want function names and file paths, open `docs/cross-agency-flows.md` instead.

---

## What the platform does in one paragraph

Sensors at critical infrastructure sites (airports, ports, energy grids) watch the sky for drones. When something worth acting on is detected, the platform decides who needs to know, notifies them, coordinates the response across dozens of agencies, and produces a shared incident record every party can read afterwards. The core promise is a single event that everyone sees the same version of, with each agency's slice of the work presented in their own language.

---

## The story of one event, from detection to closed report

```mermaid
flowchart TD
  D[Sensor detects a drone<br/>at Copenhagen Airport]
  A[Operator on duty<br/>Copenhagen Airport control room]
  Q[Operator asks<br/>who needs this?]
  C1[Cascade to<br/>Local police]
  C2[Cascade to<br/>Intelligence services]
  C3[Cascade to<br/>Airspace regulator]
  R1[Local police<br/>dispatch patrol]
  R2[Intelligence services<br/>log the pattern]
  R3[Airspace regulator<br/>issue flight restriction]
  E[Drone leaves airspace<br/>Operator closes event]
  REP[Incident Report<br/>one shared file, every agency's slice inside]
  D --> A --> Q
  Q --> C1 --> R1
  Q --> C2 --> R2
  Q --> C3 --> R3
  R1 --> E
  R2 --> E
  R3 --> E
  E --> REP
  style D fill:#0d1a26,stroke:#4dd2ff,color:#fff
  style REP fill:#2a1d0a,stroke:#ffb84d,color:#fff
```

That is the whole system in one flowchart. Everything else is the fine print.

---

## Three kinds of users

The platform serves three tenant types. Each sees a different view of the same underlying events.

```mermaid
flowchart LR
  ADMIN[Admin<br/>ISR itself]
  OP[Operator<br/>the customer that owns the site<br/>e.g. Copenhagen Airport, Esbjerg Port]
  RCV[Receiver<br/>agencies notified about events<br/>e.g. Local police, Intelligence services, hospitals]
  ADMIN -->|provisions| OP
  ADMIN -->|provisions| RCV
  OP -->|sends cascades| RCV
  RCV -->|responds, dispatches, replies| OP
  style ADMIN fill:#0d2610,stroke:#4dff9c,color:#fff
  style OP fill:#0d1a26,stroke:#4dd2ff,color:#fff
  style RCV fill:#2a1d0a,stroke:#ffb84d,color:#fff
```

- **Admin (ISR)** sets up the accounts, runs the platform, sees everything.
- **Operator** is the customer whose site is being watched. Their team sits in front of the platform live, deciding what to escalate and to whom.
- **Receiver** is any agency the operator needs help from. Police, intelligence, hospitals, fire brigade, the airspace regulator, kommune crisis staff, NATO liaison. There are around 386 registered receivers today.

---

## What an operator sees when a drone appears

```mermaid
flowchart TD
  A[Drone appears on the map]
  B[Alert panel opens]
  C[Live camera / signal picture]
  D[AI takes a first read<br/>threat level + suggested response]
  E1[Button: Cascade to local police]
  E2[Button: Cascade to intelligence]
  E3[Button: Cascade to any agency]
  E4[Button: Dispatch own patrol]
  A --> B --> C
  C --> D
  D --> E1 & E2 & E3 & E4
  style A fill:#0d1a26,stroke:#4dd2ff,color:#fff
  style D fill:#2a1d0a,stroke:#ffb84d,color:#fff
```

The operator is not asked to memorize anything. The platform surfaces suggested actions based on what the drone is doing, and lets them cascade to anyone they need with one button.

**Cascade to any agency** opens a searchable picker with all 386 receivers grouped by what they do (police-style agencies, hospitals, intel services, regulators, and so on). It also shows 3-6 recommended defaults for this exact event so common cascades take one click.

---

## What a receiver sees when a cascade lands

```mermaid
flowchart TD
  A[Cascade arrives<br/>e.g. from Copenhagen Airport]
  B[Notification]
  C[Open the case file]
  D[See operator's assessment<br/>+ AI take + what's been done so far]
  E1[Reply back to the operator]
  E2[Dispatch own resources]
  E3[Cascade further to peers]
  E4[Loop in a specialist as observer]
  A --> B --> C --> D
  D --> E1 & E2 & E3 & E4
  style A fill:#2a1d0a,stroke:#ffb84d,color:#fff
  style C fill:#0d1a26,stroke:#4dd2ff,color:#fff
```

The receiver arrives at the case already briefed. They see what the operator thinks, what the AI thinks, and everything that has been dispatched or coordinated on the case up to that moment. Their next action is a single button click, not a form.

---

## How the shared Incident Report is built

Once the event closes (drone leaves, threat neutralised, all-clear given), a single Incident Report is generated. Every agency that touched the event gets a chapter inside it.

```mermaid
flowchart TD
  E[Event closes]
  R[Incident Report generated]
  S[Summary at the top<br/>what happened, how long, outcome]
  CH[One chapter per agency<br/>ordered by when they arrived on the case]
  CH1[Copenhagen Airport chapter<br/>e.g. cascade timings, sensor picture]
  CH2[Local police chapter<br/>patrols dispatched, arrival times, outcome]
  CH3[Intelligence chapter<br/>pattern notes]
  CH4[Airspace regulator chapter<br/>restriction issued, duration]
  E --> R --> S
  R --> CH
  CH --> CH1
  CH --> CH2
  CH --> CH3
  CH --> CH4
  style R fill:#2a1d0a,stroke:#ffb84d,color:#fff
```

Every chapter has the same shape so readers know where to look:

1. **Who this agency is** (name, tier, what they do)
2. **How they got involved** (who cascaded to them, at what time, or if they self-initiated)
3. **What they did** (summary: patrols dispatched, replies sent, notes written)
4. **Timeline** (chronological list of their actions)
5. **Deep detail sections** (only the sections that agency actually populated on this event)

The deep-detail sections are shaped by the kind of work the agency does. Police get a dispatched-assets section. Hospitals get a casualty section. Regulators get an advisories section. Intel gets an attribution section. The platform picks the right shapes automatically based on who wrote what.

---

## The reader's own chapter is pinned to the top

```mermaid
flowchart TD
  V[Local police officer opens<br/>the Incident Report]
  P[Their own chapter is pinned on top<br/>and already expanded]
  O[Other agencies' chapters are collapsed<br/>they can click to expand]
  V --> P
  V --> O
  style P fill:#0d2610,stroke:#4dff9c,color:#fff
```

A police officer reading the report sees Local Police at the top, already open, tagged "your chapter". Everyone else is one click away. No hunting.

---

## Some chapters are redacted for tenant boundaries

Not everyone should see everything. Intelligence services and forensic units write notes that stay inside their branch by default. A police officer reading the same incident sees the intel chapter's presence but the internal notes are held back.

```mermaid
flowchart TD
  V[Police officer<br/>viewing the report]
  I[Intelligence chapter]
  I --> Q{Is the viewer<br/>cleared for intel?}
  Q -->|no| S[Shows the name +<br/>a note that says<br/>Redacted for tenant boundary]
  Q -->|yes| F[Shows the full chapter]
  style S fill:#2a1d0a,stroke:#ffb84d,color:#ffb84d
  style F fill:#0d2610,stroke:#4dff9c,color:#fff
```

The reader still sees the intel agency was on the case (audit trail intact) but the internal notes stay compartmented. The intel agency reading the same report sees their own chapter fully. Different windows on the same underlying record.

---

## When one incident is actually a chain of incidents

Sometimes one drone visits three sites in an hour. Or a swarm hits several targets at once. The platform links related events into a chain automatically and shows a chain view at the top of each report.

```mermaid
flowchart LR
  A["Event 1<br/>Billund Airport<br/>10:12"]
  B["Event 2<br/>Copenhagen Airport<br/>10:41"]
  C["Event 3<br/>Aalborg Airport<br/>11:08"]
  D["Event 4<br/>Copenhagen Airport<br/>11:22"]
  A -->|same drone signature| B
  B -->|same drone signature| C
  B -->|same actor, different platform| D
  style A fill:#0d1a26,stroke:#4dd2ff,color:#fff
  style B fill:#2a1d0a,stroke:#ffb84d,color:#fff
  style C fill:#0d1a26,stroke:#4dd2ff,color:#fff
  style D fill:#0d1a26,stroke:#4dd2ff,color:#fff
```

The report says "4-event chain across 3 sites over 70 minutes. Billund → Copenhagen → Aalborg" and lists every event in the chain. If the reader was involved in more than one of them (like local police at both airports), each of their events is tagged "you were on this" so they can see their footprint across the whole campaign.

---

## What the platform will NOT do

Three hard guardrails, worth knowing up front:

1. **The platform never dispatches on its own.** It observes, recommends, and lets humans decide. Every action goes through a human click. This is what "detection-only" means in our positioning.

2. **Tenant data stays inside tenant boundaries.** Copenhagen Airport does not see Esbjerg Port's events. Intelligence notes do not leak to civil agencies. The redaction shown above is the visible half of a stricter server-side gate.

3. **No half-truths in the record.** If an agency touched the case, they appear in the report. If their notes are compartmented, the presence still shows even when the content doesn't. The audit trail is always complete.

---

## The one thing to remember

Every drone detection becomes one shared record. Every agency involved gets their own chapter in it. Every reader sees the version they are cleared to see, with their own contribution up top. Chains of related events surface together. The platform stitches it all live so nobody is writing situation reports by hand at 3am after an incident.

That is the whole product.

---

## Where each piece lives (for later)

When you do want to open the code, this is the map:

| What you see | Where it lives |
|---|---|
| The Cascade-to-any-agency picker | `src/cascade_picker.js` |
| The report chapters (one per agency) | `src/chapter_composer.js` + `src/report_subsections.js` |
| The redaction rules for chapters | `src/visibility.js` |
| The chain view at the top of a report | `src/xlink_graph.js` |
| The list of 386 agencies + what each one does | `src/roles.js` + `src/archetypes.js` |
| The Incident Report generator itself | `src/post_incident_report.js` |

All wired together inside `src/main.js`, which is the shell everything sits inside.

Deep architecture reference: `docs/cross-agency-flows.md`. This overview is the map; that doc is the terrain.
