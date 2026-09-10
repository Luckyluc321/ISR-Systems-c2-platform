# Report shape · end-to-end overview

Companion to `docs/cross-agency-flows.md`. That doc is the reference — every rule, every edge case, every table. This doc is the map. Read this to see how the pieces fit; open cross-agency-flows.md when you need the details of a specific piece.

| Layer | Where it lives | What it does |
|---|---|---|
| Data foundation | `src/events.js` + `src/archetypes.js` | Event record shape + 386-receiver archetype tagging |
| Sub-section render | `src/report_subsections.js` | One HTML renderer per archetype (kinetic, coord, intel, forensic, medical, regulatory, public, liaison) |
| Chapter compose | `src/chapter_composer.js` | 4 canonical blocks + 0-8 archetype sub-sections per contributor |
| PIR mount | `src/main.js` `_renderPirContributorChapters` | Chapters mount in the Step 7 Incident Report panel |
| Cascade | `src/cascade_picker.js` + `src/main.js` `_openArchetypeCascadeModal` | Universal front door to cascade to any of the 386 |
| Visibility | `src/visibility.js` | Per-viewer redaction of compartmented material |
| Chain | `src/xlink_graph.js` + `src/main.js` `_renderPirEventChain` | Cross-event graph traversal + chain view in the PIR |

---

## The one-diagram view

The whole report shape in one flowchart. Follow the arrows from top-left (an event closes) to bottom-right (a specific viewer sees a specific version of the PIR).

```mermaid
flowchart TD
  subgraph SOURCE["Event lifecycle"]
    DET[Detection<br/>ingested]
    ESC[Escalations<br/>cascades in/out]
    DIS[Counter-dispatches<br/>owned by roles]
    CAT[Catalog entries<br/>authored by roles]
    CLO[closeEvent]
  end

  subgraph P1["Phase 1 · Foundation"]
    ARCH[archetypes.js<br/>assignArchetypes RECEIVERS]
    CATT[event.catalog<br/>13 typed sub-arrays]
    KIND[DISPATCH_KIND_ARCHETYPES<br/>dispatch tags mirrored]
  end

  subgraph P2["Phase 2 · Sub-sections"]
    RS[report_subsections.js<br/>8 pure renderers]
    RSD[renderSubsection dispatcher]
    RSA[renderAllSubsections<br/>composer output]
  end

  subgraph P3["Phase 3 · Chapters"]
    CC[chapter_composer.js<br/>composeChapter]
    B1[Block 1 Identifier]
    B2[Block 2 Situation received]
    B3[Block 3 Involvement summary]
    B4[Block 4 Timeline slice]
    CH[contributorsForEvent<br/>first-touch order]
  end

  subgraph P4["Phase 4 · Mount"]
    PIR[_renderPirContributorChapters]
    CARD[Collapsible details card<br/>per contributor]
    VP[Viewer's card pinned + open]
  end

  subgraph P5["Phase 5 · Cascade"]
    CP[cascade_picker.js]
    REC[recommendationsForEvent<br/>3-6 defaults]
    GRP[Archetype-grouped tiles<br/>thick/thin]
    ACM[_openArchetypeCascadeModal<br/>universal front door]
  end

  subgraph P6["Phase 6 · Visibility"]
    VIS[visibility.js<br/>chapterVisibilityFor]
    FL[FULL]
    SM[SUMMARY<br/>+ redaction placeholder]
    HD[HIDDEN<br/>card dropped]
  end

  subgraph P7["Phase 7 · Chain"]
    XG[xlink_graph.js]
    CHAIN[Connected component<br/>= chain]
    CV[_renderPirEventChain<br/>chronological rows]
  end

  DET --> CLO
  ESC --> CLO
  DIS --> CLO
  CAT --> CLO
  ARCH --> CH
  CATT --> RS
  KIND --> RS
  RS --> RSD --> RSA --> CC
  CC --> B1 & B2 & B3 & B4
  CH --> PIR
  CC --> PIR
  PIR --> CARD --> VP
  PIR -.opens.-> ACM
  ACM --> CP --> REC & GRP
  ACM -->|escalateEvent| ESC
  CC --> VIS
  VIS --> FL & SM & HD
  XG --> CV
  CV --> PIR
  CLO --> PIR

  style DET fill:#0d1a26,stroke:#4dd2ff,color:#fff
  style CLO fill:#0d1a26,stroke:#4dd2ff,color:#fff
  style PIR fill:#2a1d0a,stroke:#ffb84d,color:#fff
  style ACM fill:#0d2610,stroke:#4dff9c,color:#fff
```

---

## Phase-by-phase walkthrough

### Phase 1 · Foundation (`src/archetypes.js` + `event.catalog`)

Every one of the 386 receivers gets tagged with a primary archetype (and optional secondaries) at boot via prefix rules over the role id. Every event carries a `catalog` object with 13 typed append-only sub-arrays that later phases read from.

```mermaid
flowchart LR
  R["RECEIVERS[]<br/>386 role objects"]
  RU[assignArchetypes<br/>prefix rules]
  R --> RU
  RU --> RT["role.archetype<br/>role.secondaryArchetypes"]
  E["event.catalog"]
  E --> S1[subjects]
  E --> S2[recordings]
  E --> S3[respHistory]
  E --> S4[attribution]
  E --> S5[patterns]
  E --> S6[xlinks]
  E --> S7[roe]
  E --> S8[evidence]
  E --> S9[coordDecisions]
  E --> SA[casualties]
  E --> SB[advisories]
  E --> SC[publicAlerts]
  E --> SD[liaison]
```

**Read this for details:** cross-agency-flows.md Section 6a (catalog shape) + Section 7 (archetype rules table).

---

### Phase 2 · Archetype sub-section renderers (`src/report_subsections.js`)

Eight pure renderers, one per archetype. Each function is `(role, event) → HTMLString`. Empty return when the role has no data for that archetype so the Phase 3 composer only surfaces sub-sections that earned their place.

```mermaid
flowchart LR
  role[role] --> R[renderAllSubsections]
  event[event] --> R
  R --> K[renderKineticSubsection]
  R --> CO[renderCoordinationSubsection]
  R --> IN[renderIntelSubsection]
  R --> FO[renderForensicSubsection]
  R --> ME[renderMedicalSubsection]
  R --> RE[renderRegulatorySubsection]
  R --> PU[renderPublicSafetySubsection]
  R --> LI[renderLiaisonSubsection]
  K & CO & IN & FO & ME & RE & PU & LI -->|filter by ownerRoleId or authorRoleId + archetype| OUT[0..8 sub-section HTMLs]
```

Contributor scoping is enforced at read time (filter counterDispatches by archetype + ownerRoleId, filter catalog sub-arrays by authorRoleId). The renderer never claims data authored by someone else.

**Read this for details:** cross-agency-flows.md Section 7 "The 8 archetypes".

---

### Phase 3 · Chapter composer (`src/chapter_composer.js`)

One chapter per contributor. Chapter = 4 canonical top blocks + 0-8 archetype sub-sections. Empty return when the role didn't touch the event so the master PIR composer can iterate every RECEIVERS entry and only surface the ones that earned a chapter.

```mermaid
flowchart TD
  E[event] --> CI{contributorsForEvent}
  RC["RECEIVERS[]"] --> CI
  CI -->|for each contributor| CC[composeChapter]
  CC --> B1[Block 1 Identifier<br/>name + tier + archetype badges]
  CC --> B2[Block 2 Situation received<br/>cascade in / out / self-initiated]
  CC --> B3[Block 3 Involvement summary<br/>6 stats + populated archetypes]
  CC --> B4[Block 4 Timeline slice<br/>chronological actions]
  CC --> SS[renderAllSubsections]
  B1 & B2 & B3 & B4 & SS --> ART[article.chapter]
  style ART fill:#0d1a26,stroke:#4dd2ff,color:#fff
```

**Contributor detection:** a role contributed if ANY of these is true:
- Initiated an escalation on this event
- Was an escalation destination
- Owns any counter-dispatch
- Authored any catalog entry

Contributors ordered by first-touch timestamp so the master PIR reads in the sequence events actually unfolded.

**Read this for details:** cross-agency-flows.md Section 7 "Chapter composition rule".

---

### Phase 4 · Master PIR mount (`_renderPirContributorChapters`)

Contributor chapters mount in the Step 7 PIR panel below the classic summary rows. One collapsible `<details>` card per contributor. Active viewer's own chapter pins to the top and opens by default.

```mermaid
sequenceDiagram
  participant U as Viewer (activeRole)
  participant P as Step 7 PIR panel
  participant C as contributorsForEvent()
  participant K as composeChapter()
  participant S as renderAllSubsections()
  participant V as chapterVisibilityFor()
  participant X as xlink_graph
  U->>P: opens closed event
  P->>X: chainFor(eventId, EVENTS)
  X-->>P: chain summary (Phase 7)
  P->>C: (event, RECEIVERS)
  C-->>P: contributors[] sorted by first-touch
  P->>P: pin activeRole to top when contributor
  loop for each contributor
    P->>V: (viewer, chapterRole, event)
    V-->>P: FULL | SUMMARY | HIDDEN (Phase 6)
    P->>K: (role, event, viewer)
    K->>S: (role, event)
    S-->>K: 0..8 sub-section HTMLs
    K-->>P: chapter HTML (may be redacted)
  end
  P-->>U: collapsed cards, viewer's chapter open,<br/>chain view above
```

**Zero JS state** — every card is a native `<details>` element so collapse/expand is free. Redacted cards carry a `chapter-card-redacted` accent + "redacted" tag so the reader spots them without expanding.

**Read this for details:** cross-agency-flows.md Section 7 "PIR panel data flow".

---

### Phase 5 · Universal cascade picker (`src/cascade_picker.js` + `_openArchetypeCascadeModal`)

The "Cascade to any agency" CTA in every active event's Mission Console opens a picker over all 386 receivers. Thick archetypes collapse to category tiles the operator expands on click; thin archetypes show their chips open.

```mermaid
flowchart TD
  CTA[Cascade to any agency CTA]
  CTA --> M[_openArchetypeCascadeModal]
  M --> BUILD[buildPickerGroups]
  M --> REC[recommendationsForEvent]
  BUILD --> GRP["8 archetype groups<br/>+ onCase[] + all[]"]
  REC --> CHIPS[3-6 recommended chips]
  M --> S[search input]
  S --> F[filterByQuery]
  F --> UI[filtered chip list<br/>groups auto-expand]
  UI --> SEL[selectedRoleIds]
  CHIPS --> SEL
  GRP --> SEL
  SEL --> SUB[submit]
  SUB --> ESC[escalateEvent<br/>per selected role]
  style CTA fill:#0d2610,stroke:#4dff9c,color:#fff
  style ESC fill:#0d1a26,stroke:#4dd2ff,color:#fff
```

**Recommender rules** — 3-6 defaults surfaced per event based on classification, threat, platform, domainScope, outEnv. Full rule table in cross-agency-flows.md Section 7 "Cascade picker grouping".

**Legacy shortcuts stay wired.** Cascade to intel services (FE + PET) and Cascade to local police (Politikreds) still use their hardcoded 2-chip modal for one-click send. Phase 5 is the universal path.

---

### Phase 6 · Visibility scoping (`src/visibility.js`)

Cross-tenant redaction policy. Non-cleared viewers see intel + forensic chapters as SUMMARY: nameplate + involvement counts, no situation / timeline / sub-section bodies.

```mermaid
flowchart TD
  V[viewer role] --> P[chapterVisibilityFor]
  C[chapter role] --> P
  E[event] --> P
  P --> R1{viewer null?}
  R1 -->|yes| FULL
  R1 -->|no| R2{admin bypass?}
  R2 -->|yes| FULL
  R2 -->|no| R3{viewer == chapter?}
  R3 -->|yes| FULL
  R3 -->|no| R4{same parent branch?}
  R4 -->|yes| FULL
  R4 -->|no| R5{chapter is INTEL or FORENSIC<br/>AND viewer not cleared?}
  R5 -->|yes| SUM[SUMMARY]
  R5 -->|no| FULL
  style FULL fill:#0d2610,stroke:#4dff9c,color:#fff
  style SUM fill:#2a1d0a,stroke:#ffb84d,color:#fff
```

**Server-side backstop:** client-side visibility is defence in depth. The real access gate lives at the API layer. visibility.js prevents accidental cross-tenant leakage in the UI.

**Read this for details:** cross-agency-flows.md Section 7 "Visibility scoping".

---

### Phase 7 · Cross-event chain graph (`src/xlink_graph.js`)

Unifies three link sources into one undirected graph. Connected components define chains. Chain view mounts above the contributor chapters in the PIR when the chain size is greater than 1.

```mermaid
flowchart LR
  A["evt-001<br/>BILLUND<br/>10:12"]
  B["evt-002<br/>CPH<br/>10:41"]
  C["evt-003<br/>AALBORG<br/>11:08"]
  D["evt-004<br/>CPH<br/>11:22"]
  A -.linkedEventIds<br/>0.82.- B
  B -.linkedEventIds<br/>0.78.- C
  B -.catalog.xlinks<br/>same-actor.- D
  E[Connected component]
  A --> E
  B --> E
  C --> E
  D --> E
  E --> CHAIN["chain-evt-001<br/>4 events, 3 sites, 70 min"]
  style E fill:#0d1a26,stroke:#4dd2ff,color:#fff
  style CHAIN fill:#2a1d0a,stroke:#ffb84d,color:#fff
```

**Role presence in chain:** `rolePresenceInChain(chain, roleId)` returns which events in the chain a role touched. Feeds the "you were on this" tag in the PIR chain view.

**Read this for details:** cross-agency-flows.md Section 7 "Cross-event chain graph".

---

## Data flow across all phases (dispatch → chapter → viewer)

The lifecycle from the moment an operator fires a dispatch to the moment a specific viewer sees a specific version of that action in a specific contributor's chapter.

```mermaid
sequenceDiagram
  participant OP as Operator
  participant MC as Mission Console
  participant EV as event record
  participant EX as escalateEvent / dispatch
  participant CAT as event.catalog
  participant CCM as chapter_composer
  participant VIS as visibility
  participant PIR as Step 7 panel
  participant VR as Viewer role

  OP->>MC: click Cascade to any agency
  MC->>EX: escalateEvent(destinationIds, assessmentPackage)
  EX->>EV: append escalation with initiatedByRoleId
  EX->>EV: append counterDispatch with ownerRoleId + archetype tag
  EX->>CAT: append coordDecisions / advisories / etc

  Note over EV: event closes

  VR->>PIR: opens Step 7
  PIR->>CCM: contributorsForEvent(event, RECEIVERS)
  loop for each contributor
    PIR->>VIS: chapterVisibilityFor(viewer, chapter, event)
    VIS-->>PIR: FULL | SUMMARY | HIDDEN
    PIR->>CCM: composeChapter(role, event, viewer)
    CCM->>CAT: read catalog filtered by authorRoleId
    CCM->>EV: read escalations / counterDispatches filtered by role
    CCM-->>PIR: chapter HTML
  end
  PIR-->>VR: renders cards (viewer's pinned + open)
```

**Detection-only invariant** holds end-to-end. No phase writes back into the event during a render. Every module reads the event and derives its output; state changes only happen through the escalateEvent / dispatch / catalog-append paths on the write side.

---

## Debugging + dev handles

Every phase exposes a browser-console dev handle for spot-checking. Open a closed event, then in the console:

| Handle | What it does |
|---|---|
| `window.__isr_archetypes.byArchetype('kinetic-response')` | List every role tagged with an archetype |
| `window.__isr_archetypes.coverage()` | Count of roles per archetype |
| `window.__isr_subsections.populated(role, event)` | Array of archetypes this role populated |
| `window.__isr_subsections.all(role, event)` | Concatenated sub-section HTML for a role |
| `window.__isr_chapters.contributors(event)` | Array of role objects that touched this event |
| `window.__isr_chapters.compose(role, event)` | Composed chapter HTML for one role |
| `window.__isr_chapters.preview(event, elementId)` | Mount all chapters into a DOM element for inspection |
| `window.__isr_picker.groups(event)` | Grouped picker spec: groups[], onCase[], all[] |
| `window.__isr_picker.recommend(event)` | 3-6 recommended defaults for this event |
| `window.__isr_visibility.level(viewer, chapterRole, event)` | FULL / SUMMARY / HIDDEN |
| `window.__isr_visibility.adminOn('some-role-id')` | Register admin bypass for local preview |
| `window.__isr_xlink.graph()` | Full xlink graph over all EVENTS |
| `window.__isr_xlink.chainFor(eventId)` | Chain summary for one event |
| `window.__isr_xlink.narrative(eventId)` | One-line chain description |
| `window.__isr_xlink.rolePresence(eventId, roleId)` | Which events a role touched in the chain |

---

## What comes next (not in scope of these seven phases)

- **Threat-type routing matrix** (`routing.js`) — the `(siteType × platform × classification) → auto-observer role set` lookup for automatic cascade defaults.
- **Cross-site combined evidence report** — multi-event PDF / JSON / CSV bundling for chain incidents. Option B in the marker-filter chain-scope work.
- **UI affordances for observer-promote acceptance / rejection** — Phase 4 in the earlier docs' P8 numbering.
- **Rejection / declined flow protocol** — audit trail + backup escalation path when a receiver rejects a cascade or handoff.
- **PDF layout of the multi-event report** — template TBD.
- **Server-side visibility enforcement** — real auth gate at the API layer; visibility.js is only the client-side rendering companion.

These are tracked in `docs/cross-agency-flows.md` Section 8 "What this document does NOT cover".
