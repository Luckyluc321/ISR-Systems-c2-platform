---
title: "Receiver console audit"
subtitle: "Right pillar, response actions, and the post-incident report"
date: "2026-10-06"
---

# How to read this

Three screenshots raised three questions. This audit answers all three and
reports what else was found on the way.

Every claim here was read out of the code and verified a second time
directly. Nothing in this document is inferred from behaviour alone. File
and line references are given so any claim can be checked in one jump.

The scenario throughout is the one in the screenshots: an incident at
Billund Airport, escalated to **Sydøstjyllands Politi** (`politi-sydostjyl`),
viewed in that profile's receiver console.

**Read the Decisions section and stop.** It is the only part that asks anything of the
reader. Everything after it is evidence, there so any single claim can be
checked without taking the rest on trust. The visual problems that prompted
this audit are real but cosmetic. The correctness problems are not.

\newpage

# Decisions

## Just fix these

Plain bugs. No decision needed, they will be fixed unless you object.

- **Bug A.** Every note ever written carries the same frozen timestamp.
- **Bug B.** Notes do not appear in the Audit trail that the button says it
  appends to.
- **Bug C.** A dead CSS class, and a layout bug that squashes the chapter
  meta line to one word per line.

## Then answer these eight

Each is a real choice. The recommendation is my opinion, not a finding of
the audit. Reply with the number and letter, for example `D1 a`.

---

### D1. Two dispatch buttons that do nothing

"Deploy patrol" and "Set up perimeter cordon" are shown to a profile
precisely because the system has no record of it owning any units.

**a.** Hide the dispatch group for profiles with no asset inventory.
*Honest immediately. 18 districts lose two buttons they could not use.*

**b.** Write real asset inventories for all 18 police districts.
*Correct end state. Needs inventory data we do not have yet.*

**c.** Leave as is.
*A demo risk every time a district profile is opened.*

> **Recommend a** now, and **b** per district as each one is onboarded.

---

### D2. Four report counters that can only ever read zero

CATALOG ENTRIES is never written. CASCADES IN and RESPONSES SENT compare
the wrong two kinds of identifier.

**a.** Hide counters that cannot yet be populated.
*The report shrinks but stops lying.*

**b.** Wire them properly.
*The report becomes true. Roughly a week of work.*

> **Recommend a** now, **b** once D4 lands.

---

### D3. The chapter headline names the wrong archetype

A police chapter is headlined KINETIC RESPONSE on an event where they
dispatched nothing and only coordinated.

**a.** Headline what the role actually did on this event.
*Becomes event-specific and true.*

**b.** Keep both rows, relabel so the difference is readable.
*Keeps the organisation's standing taxonomy visible.*

> **Recommend a.**

---

### D4. The same agency is keyed differently in different files

Six of twelve police districts have two different identifiers. Only 14 of
44 national-pool entries match a role.

**a.** Converge on one scheme now.
*Cheap today. Touches three files.*

**b.** Add a mapping layer and keep both.
*A translation surface we maintain forever.*

> **Recommend a**, before any real district is onboarded. This is the one
> that gets expensive if left.

---

### D5. The site capability gate does not know who is asking

It checks whether a patrol is plausible at a site, never whether this
particular agency owns patrols.

**a.** Add a role dimension to the gate.
*Small. Stops Bornholm being offered patrols at Copenhagen.*

**b.** Defer.

> **Recommend a.**

---

### D6. Move the action rail onto the archetype engine

A rule engine covering all 386 agencies already exists. The button rail
ignores it and uses a hand-written ladder instead.

**a.** Do it now.
*Largest item here. Stops each new agency type costing a code change.*

**b.** Defer.

> **Recommend b.** Right destination, wrong week.

---

### D7. Four different arrow styles in one panel

Plus three separate systems remembering what is collapsed, one of which
silently forgets.

**a.** Unify to one.
*Mostly deletion.*

**b.** Defer.

> **Recommend a.**

---

### D8. Colour

**a.** Finish the single-accent pass, and spend the colour on the eight
archetype badges, which already have the hooks and today are all the same
colour.
*Structure separates sections. Colour carries meaning.*

**b.** Colour the section arrows instead.
*Rebuilds the rainbow that `--sec-accent` was introduced to remove.*

> **Recommend a.** The design tokens already state the rule: colour is for
> state, one accent, not many.

\newpage

# 1. Severity-ranked findings

## Tier 1: the product states things that are not true

These are what a customer notices in a demo.

| # | Finding | Where |
|---|---------|-------|
| 1 | "Deploy patrol" and "Set up perimeter cordon" are captioned "Units this profile controls directly" and are rendered **because** the system has no record of the profile controlling anything | `main.js:24685` |
| 2 | Both buttons fire a mock adapter. Nothing spawns, nothing moves, no route is drawn | `adapters/dispatch_mock.js` |
| 3 | They write an audit record with `flow: 'action-dispatched'`. That string appears **only inside the mock adapter**. Nothing reads it | `dispatch_mock.js:56` |
| 4 | CATALOG ENTRIES in the incident report is permanently zero. Nothing in the entire codebase ever writes into `event.catalog` | `events.js:33` |
| 5 | CASCADES IN and RESPONSES SENT compare a destination id against a role id. Only 27 of 165 destination ids are also role ids, so for the other 138 these silently read zero | `chapter_composer.js:301` |
| 6 | Every note ever written gets the same hardcoded timestamp, `2026-07-24T14:32:41Z` | `events.js:915` |
| 7 | "Add note - Append to audit trail" does not appear in the Audit trail section directly below it | `main.js:24931` |
| 8 | A chapter's loudest label advertises an archetype the role contributed nothing to | `chapter_composer.js:161` |

## Tier 2: scalability

| # | Finding | Scale |
|---|---------|-------|
| 9 | Only 28 of 386 receiver profiles have an asset inventory | 7.3 percent |
| 10 | Of 21 police-branch roles, 3 have one. 18 districts land on the stub rail | 86 percent uncovered |
| 11 | The site capability gate takes no role parameter. It is role-blind | `main.js:24426` |
| 12 | The action list is a hardcoded branch ladder, while a working 386-role archetype engine sits unused beside it | `main.js:24523` |
| 13 | Three data files key the same agency differently. 6 of 12 police districts diverge | see 5.3 |

## Tier 3: visual and structural

| # | Finding | Where |
|---|---------|-------|
| 14 | Four different disclosure-arrow idioms in one pillar | see 2.3 |
| 15 | Three independent collapse-state stores, one with inverted polarity | `main.js:25563` |
| 16 | `.c-row-collapsible` is applied in markup and has zero CSS rules | `main.js:22095` |
| 17 | Collapse state is keyed by title text, so a title change silently resets it | `main.js:25577` |
| 18 | The single-accent rule is about 20 percent applied: 2 panels against 8 | see 2.4 |
| 19 | A pseudo-element consumes a grid cell, collapsing a column to one word wide | `style.css:8405` |
| 20 | All 8 archetype badge classes set the identical colour | `style.css:7882` |

\newpage

# 2. The right-hand pillar

## 2.1 The brown line is not where it appears to be

The salmon rule reads as though it belongs to RESPONSE OPTIONS. It does not.

`#c0817c` is the **top border of PRIOR ACTIVITY AT THIS SITE**:

```
style.css:9372
.hist-pattern-panel { border-top: 3px solid var(--sec-accent); }
```

It only looks like a rule under Response Options because Steps 3 through 6
all return an empty string on a live event, so Prior Activity collapses
upward and sits directly beneath it.

The only other panel carrying that colour is Attribution, set inline at
`attribution.js:301`.

## 2.2 Why the bottom section has no arrow

It is not a missing arrow. "Request from other agencies" is **structurally
not a disclosure**.

```
main.js:22235
<div class="c-panel">
  <div class="c-panel-title" ...>Request from other agencies</div>
```

Three things make that final:

1. The wrapper is `c-panel`, not `c-panel c-panel-collapsible`. The arrow
   exists only as `.c-panel-collapsible > .c-panel-title::before`, so no
   selector matches and nothing renders.
2. There is no `c-panel-body` wrapper. Adding the class would produce an
   arrow that collapses nothing.
3. The click binding only attaches to `.c-panel-collapsible > .c-panel-title`,
   so the title is not clickable.

## 2.3 Four arrow idioms, three state stores

| Section | Collapsible | Arrow mechanism | State store |
|---------|-------------|-----------------|-------------|
| Mission Console | no | none | none |
| Response Options | yes | CSS `::before`, one glyph rotated | `_collapsedPanels`, keyed by **title text** |
| Prior activity | yes | same CSS pseudo-element | same |
| Other agencies on case | yes | hand-rolled glyph span in JS | `_otherAgenciesPanelCollapsed`, keyed by event id |
| Request from other agencies | no | none | none |
| ... its child rows | yes | third idiom, fully inline, no class | `_otherAgenciesExpanded`, **inverted polarity** |

Across the file: 1 CSS pseudo-element against 10 hand-rolled chevron spans.

Three consequences:

- `.c-row-collapsible` is applied at `main.js:22095` and has **zero** CSS
  rules anywhere. Dead class.
- `_collapsedPanels` keys on title text. The Step 2 title changes between
  "Step 2 - Select response option" and "Your Response Options" when the
  event is acknowledged, so collapsing it silently resets.
- Section 5's rows have no first-child suppression, so the first row draws
  a hairline directly under the lede paragraph.

## 2.4 The single-accent rule is 20 percent applied

The token file states the intent at `style.css:41-47`:

> One accent for every section and step in an event's right-hand pillar.
> Replaces a per-archetype palette of purple, pink, teal, blue, amber and
> green, which made a case file read as eight unrelated colours rather than
> one document.

The pillar's actual 3px top rules:

| Colour | Panels |
|--------|--------|
| `#ffb84d` amber | 3 (Steps 1, 4, 7) |
| cyan | 2 (Steps 3, 5) |
| green | 2 (Step 6) |
| grey | 1 (admin) |
| `--sec-accent` | **2** (Prior activity, Attribution) |

Eight panels still carry the old per-step palette. The comment describes an
intention, not the current state.

## 2.5 Recommendation on colour

**Do not colour the arrows.** The design header states the rule plainly:
*"semantic colour for state only"* and *"One accent, not many."*
`--sec-accent` was introduced specifically to kill a per-section rainbow.
Colouring arrows per section rebuilds that rainbow somewhere else.

Segment by structure instead:

- One arrow idiom everywhere, the CSS pseudo-element, on every collapsible
  section without exception.
- Make the two non-collapsible sections look deliberately non-collapsible,
  rather than looking like collapsibles missing a part.
- Group the five by purpose using weight and spacing, not hue: the brief you
  read, the actions you take, the context you consult.
- Keep the 3px coloured rule for state only, which is what the token file
  already says.

The colour budget is better spent on the eight archetype classes, which
already have CSS hooks and would carry real meaning. See section 4.4.

\newpage

# 3. The ten response buttons

## 3.1 Why those two dispatch buttons exist

```
main.js:24681-24685

// Politi actors - legacy stub buttons. Only rendered when the
// role does NOT have a defined asset library yet (older Politi
// districts pending real asset spec). Once assetsForReceiverRole
// returns a spec for the role, these stubs are skipped.
if (isActive && isPolitiBranch && !_receiverAssetSpec) {
```

A button group captioned *"Units this profile controls directly"* is gated
on the system having **no record of this profile controlling anything**.

The original instinct was correct, and more precisely correct than expected:
the buttons are not merely disconnected, they are the fallback shown when
the connection is known to be absent.

## 3.2 What each button does today

| Button | Wired | Effect on click |
|--------|-------|-----------------|
| Deploy patrol | **Cosmetic** | Mock adapter. No entity, no route, no asset state. Flips own escalation to `in-progress` |
| Set up perimeter cordon | **Cosmetic** | Same. A real cordon engine exists in `perimeter.js` and is never called from here |
| Request tactical intervention | Wired | Real escalation to `politi-aks` carrying an assessment package |
| Cascade to intelligence services | Wired | Real escalation, scoped to destinations configured for the site |
| Cascade to any agency | Wired | Real escalation across the full 386-role pool |
| Reply | Wired | Pushes to `rec.responses[]`, renders back, flips status to acknowledged |
| Update status | Wired | Real `progressStatus` plus history, visible in three render sites |
| Decline cascade | Wired, barely surfaced | Sets status and writes a note. **No decline UI exists anywhere** |
| Loop in observer | Wired | Real participant entry, visible in the participants strip |
| Add note | Wired to store, broken downstream | See 3.3 |

## 3.3 Three confirmed defects

**The dispatch audit record is write-only exhaust.** The mock adapter writes
an interaction with `flow: 'action-dispatched'`. Searching the whole of
`src/` for that string returns hits **only inside `dispatch_mock.js` itself**.
Nothing consumes it.

**Every note carries a frozen timestamp.**

```
events.js:915
e.notes.push({
  timestamp: new Date('2026-07-24T14:32:41Z').toISOString(), // demo reference time
  author, text: text.trim(), type: 'note',
});
```

**The note does not reach the audit trail it names.** `_buildAuditJournal`
at `main.js:24931` reads `event.createdAt`, `rec.statusHistory`,
`rec.response` and `event.closedAt`. It never reads `event.notes`. So a
button labelled "Append to audit trail", clicked from a panel whose final
section is titled "Audit trail", produces no visible change in that section.

## 3.4 The site gate is role-blind

```
main.js:24426
function _siteAllowsAction(event, action) {
  if (!event?.siteId) return true;
  const siteCtx = contextForSite(event.siteId);
  const caps = siteCtx?.response_capabilities;
  if (!Array.isArray(caps)) return true;   // permissive fallback
  return caps.includes(action);
}
```

Two parameters: the event and the action. No role. It asks "is a patrol
plausible at this site" and never "does this role own patrols". Bornholms
Politi is offered Deploy patrol at Copenhagen Airport.

Site capability data is real and well-formed. All nine declared sites carry
`response_capabilities`. The six Energinet substations declare only
`['brs-standby', 'hjv-reinforce']`, so a police profile there correctly sees
no dispatch buttons. The gate works. It is simply only half the question.

## 3.5 Scalability: two lanes

**The lane that scales.** `receiver_assets.js` is a clean plug-in: add a
top-level key per role with `dispatchable[]` and `requestable[]`, and the
generic handlers do the rest. No code change. Coverage today:

| Measure | Count |
|---------|-------|
| Receiver profiles total | 386 |
| With an asset inventory | 28 (7.3 percent) |
| Police-branch roles | 21 |
| Police with an inventory | 3 (`politi-kbh`, `politi-aks`, `rigspoliti`) |
| **Police districts on the stub rail** | **18** |

**The lane that does not scale.** Everything else in
`availableCTAsForReceiver` is a literal branch ladder: `isPolitiBranch`,
`isBrsBranch`, `isFlyv`, `isHaer`, `isIntel`, `isKommune`, `isHjvBranch`,
`isRegionBranch`, plus exact-id tests such as `roleId === 'agency-traf'`.
The function's own header claims it *"replaces every if role === X hardcode
in the UI"*. It relocated them. A new agency type needs a new `else if`
block plus an entry in a 16-item `STUB_DISPATCH_ACTIONS` set.

**The engine already built and unused.** `archetypes.js` is a prefix-rule
engine that stamps all 386 receivers at boot, documented as doing exactly
that. The action rail does not consult it at all. Archetypes are used only
for report chapters and the cascade picker's grouping.

## 3.6 Flows that are off

**Decline cascade appears on things that were never cascades.** The record
is chosen at `main.js:23567` as `_cascades[0] || _matching[0]`, where
`_matching` includes plain operator escalations with no assessment package.
The decline gate at `main.js:24900` checks only status, never
`assessmentPackage`. So a profile that received a direct operator dispatch
is offered "Decline cascade", with a tooltip saying the reason is visible to
"operator".

**Cascade to any agency strictly contains Cascade to intelligence services.**
Both call `escalateEvent` the same way. The second uses a hardcoded two-entry
list. They differ in exactly two literal defaults, `cascadeReason` and
`defaultPriority`. The code calls the narrower one a "legacy shortcut".

**Four overlapping cordon concepts coexist.** The cosmetic `set-cordon`
stub; the real `buildCordon` / `assignPatrols` engine driven only by
automatic wreckage flows; a genuinely wired "Record scene released" that
stands down cordons; and, for Copenhagen only, a real cordon-squad asset. A
profile can release a cordon the Set up cordon button never created.

**Dead set membership.** `request-aks` is listed in `STUB_DISPATCH_ACTIONS`
but is unreachable there, because its explicit branch fires earlier in the
same chain. The set's own header asserts that every entry must route through
the adapter seam.

\newpage

# 4. The contributor chapters panel

## 4.1 What it is

Not a stray panel. It is the Post-Incident Report, generated at `closeEvent`
and designed in `docs/report-shape-overview.md`: one chapter per agency that
touched the event, the reader's own chapter pinned to the top and expanded.

A chapter is not a stored object. There is no `event.chapters`. It is derived
at render time from live `event.escalations`, `event.counterDispatches` and
`event.catalog`. The report object itself is never consulted for chapters.

## 4.2 Four of six counters cannot report a real number

| Counter | Status |
|---------|--------|
| CASCADES OUT | **Works.** The 7 is real |
| DISPATCHES OWNED | Works, but only the real dispatch path writes it, which the stub buttons are not |
| DISPATCHES OPEN | Works, same caveat |
| **CATALOG ENTRIES** | **Permanently zero.** The 13 sub-arrays are created and backfilled. Nothing anywhere ever pushes into them |
| **CASCADES IN** | **Mostly unreachable.** Compares `escalation.destinationId` against a role id |
| **RESPONSES SENT** | **Mostly unreachable.** Derived from the same filter |

Destination ids and role ids are different namespaces. Destination ids look
like `cph-t4-forsvar`; role ids look like `politi-sydostjyl`. Only **27 of
165** destination ids are also role ids. For the remaining 138 the counter
silently reads zero.

`post_incident_report.js:210` documents the mismatch and compensates by
resolving `dest.ownerRoleId`. That field **does not exist on any
destination**, so the compensation is inert as well.

A reading of `0 / 7 / 0 / 0 / 0 / 0` therefore does not mean "nothing
happened". It largely means "cannot be counted".

## 4.3 The archetype pills contradict each other, and both are right

The white pill reads KINETIC RESPONSE. POPULATED ARCHETYPES reads
Coordination and command. They measure different things:

- The pills beside the role name are **static taxonomy**: what a police
  district *is*, from the rule `prefix('politi-') -> primary KINETIC`.
  Independent of the event.
- POPULATED ARCHETYPES is **what this role produced on this event**. The
  kinetic sub-section needs dispatches owned by the role, of which there
  were none, so it rendered empty. The coordination sub-section fires on
  cascades initiated with an assessment package, of which there were seven.

So the most prominent label on the card advertises an archetype the role
contributed nothing to, while the archetype it did contribute to is rendered
dimmed. They are not redundant. They are worse than redundant.

There is a load-bearing note at `archetypes.js:121` confirming that
reclassifying a role does not change the report, because chapter composition
never reads archetype at all.

## 4.4 Eight colour hooks doing nothing

```
style.css:7882-7889
.chapter-arch-badge-kinetic-response      { border-left: 2px solid var(--sec-accent); }
... six more ...
.chapter-arch-badge-international-liaison { border-left: 2px solid var(--sec-accent); }
```

Eight selectors, one colour. The markup implies per-archetype colour-coding
that does not exist. This is where a colour budget would buy real meaning,
rather than on the pillar's section arrows.

## 4.5 There is no commenting feature

Searching the chapter composer, the sub-section renderers and the report
module for `textarea`, `button`, `contenteditable`, `input`, `comment`,
`annotate` and `remark` returns **zero** matches. Both modules declare
themselves read-only. The only interactive element in the whole report panel
is a JSON download.

What appears to be a comment affordance is the "Add note" button in the
**centre** pane. The workspace is two panes: the centre holds the event
report and its action rail, the right aside holds the mission console and
the post-incident report.

And notes never reach the report. Operator notes render in exactly three
places, none of which is the post-incident report or any chapter.

## 4.6 Why the meta line wraps one word per line

```
style.css:8393
.chapter-card-summary {
  display: grid;
  grid-template-columns: 1fr auto auto;   /* three columns */
  gap: var(--space-3);
  ...
}
style.css:8405
.chapter-card-summary::before { content: "▸"; ... }
```

`display: grid` makes the `::before` pseudo-element a **grid item**, not a
marker. So four items are placed into three columns:

1. the arrow takes row 1, column 1, the `1fr` track
2. the role name takes row 1, column 2
3. the archetype label takes row 1, column 3
4. the stats text wraps to **row 2, column 1**

That `1fr` track is starved. The rail is a fixed 380px, leaving roughly
300px of grid width, and the two `auto` columns claim max-content first.
With no free space, the `fr` track falls back to its automatic minimum,
which is the longest unbreakable word in the stats string.

It is not a `min-width`. It is a pseudo-element consuming a grid cell.

\newpage

# 5. Cross-cutting findings

## 5.1 Stale architecture documentation

`docs/agentic-receiver-asset-plugin-architecture.md` closes with "Current
profiles configured" listing three: Politi København, Aktionsstyrken,
Rigspolitiet. The file now has 28. The document is stale by 25 profiles.

## 5.2 Stale count comments in code

`main.js:17015` says "242 receiver profiles". The number is 386.

## 5.3 Three identifier schemes for the same agency

`roles.js`, `response_assets.js` and `receiver_assets.js` do not share keys.
Six of twelve police districts diverge:

| District | `roles.js` | `response_assets.js` |
|----------|-----------|----------------------|
| Sydøstjyllands | `politi-sydostjyl` | `politi-sydoest` |
| Østjyllands | `politi-ostjyl` | `politi-oestjyl` |
| Nordsjællands | `politi-nordsj` | `politi-nord` |
| Midt- og Vestjyllands | `politi-midtvestjyl` | `politi-midtvest` |
| Midt- og Vestsjællands | `politi-midtvestsjaelland` | `politi-midtsjael` |
| Sydsjællands | `politi-sydsjaelland` | `politi-syd` |

Only 14 of 44 national-pool ids match a role id. The national asset pool and
the role tree cannot be joined by key today. This is the same class of
problem as the destination-versus-role mismatch in 4.2, and it is the single
most load-bearing thing to fix before onboarding a real district.

## 5.4 Two dispatch systems, which is easy to confuse

Per `docs/agentic-receiver-asset-plugin-architecture.md` these are separate
by design:

- **Your Response**, centre pane, reads department-owned assets from
  `receiver_assets.js`. Answers "what does this department own".
- **Request from other agencies**, right pillar, reads the national pool in
  `response_assets.js`, ranked by real distance. Answers "what national
  assets can respond to this threat class".

An empty right pillar therefore does not imply the left pane is unwired. In
the audited case neither had data for this profile.

\newpage

\newpage

# Appendix: how this was verified

Three independent code surveys were run in parallel across `src/main.js`
(26,817 lines), `src/style.css`, and the supporting modules. Every
load-bearing claim was then re-checked directly against the source rather
than accepted from the survey.

Claims verified a second time by direct inspection:

- the element carrying the `#c0817c` rule
- that `.c-row-collapsible` has no CSS rules
- that "Request from other agencies" has no collapsible class or body wrapper
- the stub-button gate at `main.js:24685` and its comment
- the contents of `STUB_DISPATCH_ACTIONS`
- that `flow: 'action-dispatched'` is never read
- the hardcoded note timestamp
- that `_siteAllowsAction` takes no role parameter
- the decline-cascade gate and the record-selection fallback
- that nothing writes into `event.catalog`
- the destination-id versus role-id namespace overlap, measured at 27 of 165
- that `ownerRoleId` does not exist on destinations
- that all eight archetype badge classes use one colour
- every count in this document, recomputed from the source files

The file `src/main 2.js` was excluded throughout. It is a 23,519-line
duplicate of `main.js`, imported by nothing, committed by accident in
`f1526db`.
