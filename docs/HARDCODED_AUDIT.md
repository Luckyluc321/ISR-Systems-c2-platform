# What is hardcoded, and what it blocks

Audit of 2026-10-21, written so we stop firefighting these one at a time.

**The test it is measured against:** could a new customer be onboarded by
dropping a YAML into `sites/`, with no source edit? The site registry
already globs `sites/*.yaml`, so the data layer says yes. Everything
around it says no.

**Evidence base.** Standing up the Købmagergade 57 instance required
edits in three files and seven places for a single site. Two bugs fell
straight out of that in one hour: a site silently rejected over one enum
value, and a rename that only took in one of two parallel lists. Nothing
below is hypothetical.

Ordered by what it costs a real customer, not by how hard it is.

---

## P1 — broken today, for sites that already exist

### 1.1 Receiver rule "Site scope" offers two sites out of eleven

`main.js` ~25183. The dropdown is literal HTML:

```html
<option value="cph">CPH Airport only</option>
<option value="esbjerg">Esbjerg Harbour only</option>
```

Billund, the six Energinet substations, Odense and Øresund **cannot be
selected**. A receiver routing rule cannot be scoped to Billund, which
is a live commercial track.

**Fix:** generate from `SITES`.

### 1.2 FLY TO lists 9 of 11 sites

`index.html` 169-195. `odense` and `oresund_range` load fine and are
unreachable from the UI. The simulate-threat site dropdown lists 3.

**Fix:** generate from `SITES`.

### 1.3 A rejected site only announces itself in the console

**FIXED 2026-10-22.** The Scope cell of the status bar now reads
"· 1 site file rejected" for admin, with every file and reason in its
tooltip. Admin only: a file name and validation message describe other
tenants' configuration. Gated by `check:status-bar`.


**CORRECTED 2026-10-21.** The original text here said `SITE_LOAD_ERRORS`
is read by nothing. That was wrong: `main.js:28` logs a `console.warn`
per rejected file. The real gap is narrower, and still real: the warning
reaches the console and nothing else, so a rejected site is
indistinguishable from a rendering bug to anyone looking at the map. The
site is absent, every sensor is absent, and the screen says nothing.

Købmagergade was rejected for `site_type: office` against the enum
`[airport, port, energy, government, data, gov-facility, other]`. It
cost an hour, and the symptom was "the sensor doesn't show".

**Fix:** make it visible in the UI rather than console-only. Cheapest
item here, and it prevents a whole class of lost afternoon: Købmagergade
cost one, and the warning was sitting in the console the entire time.

### 1.4 Camera framing keyed on site identity

`main.js` ~30690:

```js
const bigSite = event.siteId === 'cph' || event.siteId === 'esbjerg';
const range = bigSite ? 2200 : 1100;
```

Billund is an airport and gets substation framing. A new customer always
gets 1100 m.

**Fix:** derive from site extent or `siteType`.

---

## Corrected: per-account scoping was never missing

**ADDED 2026-10-21.** An earlier draft of this document implied the UI
did not scope itself to the signed-in account. It did, and does:
`applyFlyToScope()` hides fly-to buttons and simulate-threat options for
sites the account does not own, re-running on every account switch, and
it reads `_visibleSiteIds()`, which derives from `SITES`.

What was actually wrong was narrower: the lists were hand-written markup,
so a site with no button had nothing to hide. `odense` was configured,
loading, and unreachable. Generating the lists from the registry fixed
it in 79fee8f; the scoping itself was not touched and did not need to be.

Recorded because the wrong version of this would send the next reader
rebuilding something that already works.

## P2 — blocks onboarding a new site without a developer

### 2.1 Camera presets are per-site literals

`main.js` ~23102. Each site has a hand-written block with centre, range,
heading, pitch and duration. A new site has no FLY TO target at all.

**Fix:** derive from `site.coordinates`, with optional YAML overrides for
range and pitch. The Energinet entries already show the shape: tight
zoom, small footprint.

### 2.2 Default site is a literal

**FIXED 2026-10-22.** `_configSiteId` has no literal. The Config page
resolves its site on every render against the active account's visible
sites, using the same order as the fly-to list (`_siteWorkOrder`). It
was also a tenant leak: any operator opened Config on CPH's destinations.
Gated by `check:scenario-menu` [defaults].


`main.js` ~23689, `let _configSiteId = 'cph'`. An instance without CPH
starts pointed at a site it does not have.

**Fix:** first site in `SITES`, or a manifest flag.

### 2.3 Operator and receiver bindings live in code

`roles.js` plus 38 occurrences of literal tenant and agency ids across
`src/`. Adding a customer means editing the role tree.

**Fix:** per-site `receivers:` already exists in the YAML. Extend it to
cover the operator binding so the code reads the manifest.

### 2.4 Two parallel scenario lists

**FIXED 2026-10-22.** One list. `_SIM_COMPOSER_META` is gone; each
`THREAT_MENU` entry carries the `threat` and `pathLabel` the picker
shows. All 55 picker entries were snapshotted before and after and are
identical. Gated by `check:scenario-menu` [menu], which also asserts
every (threat, path) pair is unique per site and every key resolves.


`THREAT_MENU` (`main.js` ~23268) and `_SIM_COMPOSER_META` (~23650) both
name scenarios and must be kept in sync by hand. Renaming the Mohajer-2
scenario took in one and not the other, and the scenario became
unfindable by name in the picker actually used.

**Fix:** one source, derived from `TEMPLATES`.

---

## P3 — the structural one

### 3.1 Scenarios are code, not data

Every scenario is a `TEMPLATES` entry in `drones.js` with waypoints
authored inline. 33 hardcoded site references in that file. Sites are
data; scenarios are not.

This blocks both halves of what simulations are for:

- **The sales effect, now.** A new customer's site loads with sensors and
  routing live, and the panel reads *"No threat scenarios authored for
  this site yet."* No wow-effect content without a developer.
- **The rehearsal tool, later.** An operator cannot turn a recorded real
  incident into a replayable scenario, because authoring one means
  editing source. The recordings already exist in IndexedDB and already
  carry the trajectory, so the raw material is there and the gap is the
  authoring path.

**Fix:** scenario templates into per-site config, plus a path from a
recorded track to a template. Biggest job here, and the one that changes
what the product can claim.

### 3.2 Per-site routing destinations live in code

`destinations.js`, 61 site-id references. Every agency, contact and tier
for every site is source. A new customer's response chain is a code
edit.

**Fix:** into per-site config. Large, and P3 only because 3.1 unlocks
more.

---

## Open product decisions, not yet bugs

These need a call before they can be specified.

### D1 — does an undetected track exist as an event?

`detected: false` means pre-detection. The detail panel renders:

> **PRE-INGRESS · AWAITING SENSOR CONTACT**
> Track inferred from cross-cue but not yet inside sensor coverage.

That is defensible when sensors are online and another cue suggests a
track. It is **not** defensible in the WITHOUT ISR run, where the whole
network is offline: there is no cross-cue, so the panel asserts an
inference the system could not have made, and the ledger carries an
event nothing detected.

Lucas's position: if the network detects nothing, there is no event, no
ledger row, no panel, and no pre-ingress page.

The question is whether pre-ingress should be **conditional on the site
having a live sensor network**, or removed entirely.

### D2 — what drives the threat banner

Currently: active, not pre-detection, not friendly. Fixed today, because
a filed ADS-B-correlated airliner was turning the banner orange, and six
templates are `friendly`.

Lucas's position: derive it from **detection events only**. That implies
cooperative transponder tracks should not drive it either, since a flight
plan correlation is not a detection by our network. Needs confirming
before the filter changes again.

---

## Not hardcoding, checked and cleared

Worth recording so nobody refiles these.

- **Domain scope.** `main.js` ~61 prefers `domainScope` from the
  manifest; the id and name-regex branch is a documented fallback for
  legacy inline sites.
- **`siteType`.** Read from the manifest and used for real, e.g. the
  energy-site filtering at ~128 and ~23370.
- **Sensor coverage radius, 1 km.** Deliberate and off limits.
- **Scenario-to-site coupling in `drones.js`.** A template named
  `cph_quad_hostile` genuinely belongs to CPH. That is per-site content,
  not hardcoding; 3.1 is about where it lives, not that it exists.
- **Danish data sources** (SDFI, Datafordeler, DMI, across 5-7 files
  each). Correct for a Danish product and a sovereign-profile decision,
  not accidental coupling.

---

## Suggested order

1. **1.3** surface `SITE_LOAD_ERRORS` — smallest, prevents a class of
   lost afternoon
2. **1.1 + 1.2** generate every UI site list from `SITES` — one change,
   three bugs, and most of the seven-place problem
3. **2.1 + 2.2** camera presets derived, default site derived
4. **1.4** `bigSite` becomes a site property
5. **2.4** one scenario list
6. **3.1** scenarios into config
7. **2.3 + 3.2** routing and roles into config

One through four are small and independent. Five onward are real
projects and want their own scoping.
