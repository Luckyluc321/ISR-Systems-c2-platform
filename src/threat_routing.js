// ═══════════════════════════════════════════════════════════════════
// Threat routing matrix — auto-observer selection per event shape
// ───────────────────────────────────────────────────────────────────
// Pure lookup:
//
//   routeFor({domain, family, classification, threat}) → {
//     observers: string[],   // role ids to add as observers
//     rationale: string,     // one-line human explanation
//     confidence: 'high' | 'medium' | 'low',
//   }
//
// Consumed by:
//   - src/main.js event lifecycle (auto-observer suggestion on event open)
//   - Future: threat-based case-file classification banners
//   - Future: recommender extension for observer suggestions
//
// Design rationale — rules are data, not code branches. Every rule
// carries a { when } predicate + { adds } observer set + rationale
// tag. Adding a new site type or family = one new rule entry. No
// changes to the matcher. Auditable in one file.
//
// Detection-only invariant preserved. This module returns observer
// SUGGESTIONS. The event lifecycle wires them in as observers (log
// only), never as escalations or dispatches. Operator can always
// override.
//
// NOTE: file name is `threat_routing.js` to avoid collision with
// `routing.js` (OSRM driving-route lookup for ground dispatches).
// The two modules have unrelated purposes.
//
// See docs/threat-routing-overview.md for the plain-language
// walkthrough and docs/cross-agency-flows.md Section 8 for the
// design contract + rule table.
// ═══════════════════════════════════════════════════════════════════

import { FAMILIES } from './threat_taxonomy.js';

// Site domain values match what registerSiteDomains sets in main.js.
// Kept as string constants so the rules table reads naturally.
export const DOMAIN = {
  AVIATION: 'aviation',   // Airports (CPH, Billund, ...)
  MARITIME: 'maritime',   // Ports (Esbjerg, Copenhagen port)
  ENERGY:   'energy',     // Grid substations, transformers
  GROUND:   'ground',     // Default catch-all for on-land sites
  GOV:      'government', // Government / ministry facilities (future)
  DATA:     'data',       // Data centres, telecom (future)
};

// Classification values match event.classification in events.js.
export const CLS = {
  HOSTILE:  'hostile',
  UNKNOWN:  'unknown',
  FRIENDLY: 'friendly',
  RESOLVED: 'resolved',
};

// Threat level values match event.threat in events.js.
export const THREAT = {
  HIGH:    'high',
  MEDIUM:  'medium',
  LOW:     'low',
  UNKNOWN: 'unknown',
};

// Platform string → family mapper. Handles the legacy event.platform
// values (`quadcopter`, `missile`, `non-identifiable`, `fixed-wing`,
// `jet`, `helicopter`) that predate the taxonomy. When NN adapters
// land they SHOULD emit a family enum directly and skip this shim.
export function familyForPlatformString(platform) {
  if (!platform) return FAMILIES.UNKNOWN_SIGNATURE;
  const p = String(platform).toLowerCase();
  if (/cruise|missile/.test(p))             return FAMILIES.CRUISE_MISSILE;
  if (/shahed|geran|loiter/.test(p))        return FAMILIES.LOITERING_MUNITION;
  if (/swarm/.test(p))                      return FAMILIES.DRONE_SWARM;
  if (/fpv|kamikaze|racing/.test(p))        return FAMILIES.FPV_QUADCOPTER;
  if (/quadcopter|quad|multirotor/.test(p)) return FAMILIES.COMMERCIAL_QUADCOPTER;
  // Civilian helicopter markers checked BEFORE the general
  // helicopter branch so a rescue / medevac / HEMS / police / ambulance
  // string routes to HELICOPTER_CIVILIAN (low default threat, no
  // forsvarskmd auto-observer) rather than HELICOPTER_MILITARY.
  // Added 2026-09-12 after pass-3 audit noted HELICOPTER_CIVILIAN
  // was unreachable via this shim.
  if (/(heli|rotorcraft).*?(civil|rescue|medevac|hems|ambulance|police|air-med|airmed)/.test(p)
      || /(civil|rescue|medevac|hems|ambulance|police|air-med|airmed).*?(heli|rotorcraft)/.test(p)) {
    return FAMILIES.HELICOPTER_CIVILIAN;
  }
  if (/heli|rotorcraft/.test(p))            return FAMILIES.HELICOPTER_MILITARY;
  // Same civilian-first pattern for jets: business / private / executive /
  // corporate / airliner routes to JET_CIVILIAN (low default threat).
  // Bare "jet" continues to route JET_MILITARY (over-safe default).
  if (/(jet|airliner|business|executive|corporate|private).*?(civil|business|executive|corporate|private|airline|charter)/.test(p)
      || /(business|executive|corporate|private|airline|charter).*jet/.test(p)) {
    return FAMILIES.JET_CIVILIAN;
  }
  if (/jet|fighter|bomber/.test(p))         return FAMILIES.JET_MILITARY;
  if (/fixed[- ]wing/.test(p))              return FAMILIES.MILITARY_ISR_FIXED_WING;
  if (/glider/.test(p))                     return FAMILIES.GLIDER;
  if (/balloon|tethered/.test(p))           return FAMILIES.TETHERED_PLATFORM;
  // Bare "drone" is ambiguous — operator strings like "hobby drone",
  // "unknown drone" would previously fall into military-isr-fixed-wing
  // (which triggers fe + flv-karup observer auto-loop). Pre-audit
  // regex included `|drone` in the fixed-wing branch; removed 2026-09-11
  // so ambiguous "drone" strings route to UNKNOWN_SIGNATURE where the
  // unknown-signature rule surfaces intel for manual attribution
  // instead of auto-notifying air force.
  //
  // Note on the shim in general: NN adapters SHOULD emit event.family
  // directly and skip this string-mapper entirely. This shim is the
  // fallback for legacy event.platform strings. LIGHT_AIRCRAFT and
  // CIVILIAN JETS beyond the narrow business-jet heuristic above are
  // not inferable from freeform strings — set event.family upstream.
  return FAMILIES.UNKNOWN_SIGNATURE;
}

// ── Rules table ────────────────────────────────────────────────
//
// Each rule shape:
//   {
//     tag:     unique kebab-case identifier (for audit + dedup)
//     when:    predicate ({domain, family, classification, threat}) → bool
//     adds:    role ids to include as observers when the rule fires
//     rationale: one-line human explanation
//     confidence: 'high' | 'medium' | 'low' — how confident the rule is
//                 that these observers WANT to be looped in
//   }
//
// Rules fire in order; a role id added by multiple rules dedupes at
// the collect step. Rationale strings concatenate with ' · '.
// Order does NOT determine priority — every matching rule adds its
// observers. Priority lives in the caller (if it wants to trim).

const RULES = [

  // ── Site-domain baseline observers ─────────────────────────
  // Always-on: whoever owns airspace / waterways / grid for the site
  // gets loop-in visibility on every event at that site. Cheap to
  // notify, high value for regulator situational awareness.
  {
    tag: 'aviation-regulator-baseline',
    when: (c) => c.domain === DOMAIN.AVIATION,
    adds: ['agency-traf'],
    rationale: 'Trafikstyrelsen owns airspace regulation over aviation sites.',
    confidence: 'high',
  },
  {
    tag: 'maritime-regulator-baseline',
    when: (c) => c.domain === DOMAIN.MARITIME,
    adds: ['agency-sof'],
    rationale: 'Søfartsstyrelsen owns waterway regulation over maritime sites.',
    confidence: 'high',
  },
  {
    tag: 'energy-regulator-baseline',
    when: (c) => c.domain === DOMAIN.ENERGY,
    adds: ['agency-ener'],
    rationale: 'Energistyrelsen owns grid regulation over energy sites.',
    confidence: 'high',
  },

  // ── Hostile classification: intel eyes on it ───────────────
  {
    tag: 'hostile-intel-baseline',
    when: (c) => c.classification === CLS.HOSTILE,
    adds: ['pet', 'fe'],
    rationale: 'Any hostile detection routes to intelligence services for pattern-of-life logging.',
    confidence: 'high',
  },

  // ── Family-specific escalators ─────────────────────────────

  {
    tag: 'strategic-strike-platform',
    when: (c) => c.family === FAMILIES.CRUISE_MISSILE
              || c.family === FAMILIES.LOITERING_MUNITION,
    adds: ['forsvarskmd', 'rigspoliti', 'flv-karup', 'beredskab'],
    rationale: 'Strategic strike platform detected. National command + air defence observers looped in.',
    confidence: 'high',
  },

  {
    tag: 'military-isr-platform',
    when: (c) => c.family === FAMILIES.MILITARY_ISR_FIXED_WING,
    adds: ['fe', 'flv-karup'],
    rationale: 'Military ISR platform detected. Defence intelligence + air force notified.',
    confidence: 'high',
  },

  {
    tag: 'strategic-uav',
    when: (c) => c.family === FAMILIES.STRATEGIC_UAV,
    adds: ['forsvarskmd', 'fe', 'pet', 'nato-caoc-uedem'],
    rationale: 'Strategic UAV detected. NATO liaison + national command notified.',
    confidence: 'high',
  },

  {
    tag: 'military-jet',
    when: (c) => c.family === FAMILIES.JET_MILITARY,
    // flv-skrydstrup is the Danish F-35 QRA squadron. `flv-qra` was the
    // pre-refactor id and now only exists as ROLE_ID_ALIAS in roles.js —
    // observerRoleObjectsForEvent doesn't apply that alias, so using the
    // legacy id silently drops the QRA squadron from military-jet events.
    // Audit finding 2026-09-11.
    adds: ['flv-skrydstrup', 'flv-karup', 'forsvarskmd', 'nato-caoc-uedem'],
    rationale: 'Military jet detected. QRA squadron + NATO CAOC notified.',
    confidence: 'high',
  },

  {
    tag: 'military-helicopter',
    when: (c) => c.family === FAMILIES.HELICOPTER_MILITARY,
    adds: ['forsvarskmd', 'rigspoliti'],
    rationale: 'Military helicopter detected. Defence command + national police notified.',
    confidence: 'medium',
  },

  {
    tag: 'drone-swarm',
    when: (c) => c.family === FAMILIES.DRONE_SWARM,
    adds: ['forsvarskmd', 'rigspoliti', 'fe', 'pet', 'flv-karup', 'beredskab'],
    rationale: 'Drone swarm detected. Full command + intel + air defence + emergency observer set.',
    confidence: 'high',
  },

  {
    tag: 'fpv-kamikaze-hostile',
    when: (c) => c.family === FAMILIES.FPV_QUADCOPTER && c.classification === CLS.HOSTILE,
    adds: ['rigspoliti', 'pet', 'beredskab'],
    rationale: 'Hostile FPV / kamikaze quadcopter detected. Ground authority + intel + emergency observer set.',
    confidence: 'high',
  },

  {
    tag: 'commercial-quad-hostile',
    when: (c) => c.family === FAMILIES.COMMERCIAL_QUADCOPTER && c.classification === CLS.HOSTILE,
    adds: ['rigspoliti'],
    rationale: 'Hostile commercial quadcopter detected. National police coordinator notified.',
    confidence: 'medium',
  },

  {
    tag: 'unknown-signature',
    when: (c) => c.family === FAMILIES.UNKNOWN_SIGNATURE,
    adds: ['pet', 'fe'],
    rationale: 'Unknown-signature detection. Intel services routed for manual attribution.',
    confidence: 'medium',
  },

  // ── High-threat overlay ─────────────────────────────────────
  {
    tag: 'high-threat-consequence',
    when: (c) => c.threat === THREAT.HIGH && c.classification === CLS.HOSTILE,
    adds: ['beredskab'],
    rationale: 'High-threat hostile event. Beredskabsstyrelsen notified for consequence preparation.',
    confidence: 'high',
  },
];

// ── Public entry point ─────────────────────────────────────────

export function routeFor(context) {
  // Default parameter `= {}` only substitutes for undefined, not null.
  // Coerce here so `routeFor(null)` matches `routeFor()` behaviour.
  const src = context || {};
  const ctx = {
    domain:         src.domain         || DOMAIN.GROUND,
    family:         src.family         || FAMILIES.UNKNOWN_SIGNATURE,
    classification: src.classification || CLS.UNKNOWN,
    threat:         src.threat         || THREAT.UNKNOWN,
  };

  const obsSet = new Set();
  const rationales = [];
  const firedRules = [];
  let confidenceScore = 3;

  for (const rule of RULES) {
    if (!rule.when(ctx)) continue;
    firedRules.push(rule.tag);
    rationales.push(rule.rationale);
    for (const rid of rule.adds) obsSet.add(rid);
    const rc = rule.confidence === 'high' ? 3 : rule.confidence === 'medium' ? 2 : 1;
    if (rc < confidenceScore) confidenceScore = rc;
  }

  // When zero rules match, confidenceScore is still 3 from init —
  // reporting 'high' on an empty routing result would misdirect a UI
  // badge. Force 'low' so a no-rule-fired result is clearly weak.
  // Audit finding 2026-09-12.
  const confidence = firedRules.length === 0
    ? 'low'
    : (confidenceScore === 3 ? 'high' : confidenceScore === 2 ? 'medium' : 'low');

  return {
    observers: Array.from(obsSet),
    rationale: rationales.join(' · ') || 'No routing rules matched. No auto-observers assigned.',
    confidence,
    firedRules,
  };
}

export function explainRoute(context) {
  const src = context || {};
  const ctx = {
    domain:         src.domain         || DOMAIN.GROUND,
    family:         src.family         || FAMILIES.UNKNOWN_SIGNATURE,
    classification: src.classification || CLS.UNKNOWN,
    threat:         src.threat         || THREAT.UNKNOWN,
  };
  return RULES.map(r => ({
    tag: r.tag,
    matched: r.when(ctx),
    adds: r.adds.slice(),
    rationale: r.rationale,
    confidence: r.confidence,
  }));
}

export function routingCoverage() {
  return {
    ruleCount: RULES.length,
    domainCount: Object.keys(DOMAIN).length,
    tags: RULES.map(r => r.tag),
  };
}

// ── Event-shaped convenience wrappers ──────────────────────────

// Single-context wrapper. Kept for backward compat; picks the first
// domain from event.domainScope. Callers that need multi-domain
// routing should use contextsForEvent (plural) instead — a
// domain-boundary event (drone crossing from maritime port airspace
// into inland substation airspace) legitimately carries both scopes
// via events.js expandEventDomainScope / unionLinkedEventDomains,
// and the single-context form silently drops the second baseline.
export function contextForEvent(event) {
  if (!event) return null;
  const domain = Array.isArray(event.domainScope) && event.domainScope.length
    ? event.domainScope[0]
    : DOMAIN.GROUND;
  const family = event.family || familyForPlatformString(event.platform || event.droneType);
  return {
    domain,
    family,
    classification: event.classification || CLS.UNKNOWN,
    threat:         event.threat || THREAT.UNKNOWN,
  };
}

// Multi-domain wrapper. Returns one context per domain in the event
// scope so the caller can union observer sets across every domain-
// baseline rule that legitimately applies. Empty domainScope falls
// back to a single GROUND context so the return is never empty.
// Added 2026-09-12 after pass-2 audit surfaced silent aviation-drop
// on multi-domain events.
export function contextsForEvent(event) {
  if (!event) return [];
  const scope = Array.isArray(event.domainScope) && event.domainScope.length
    ? event.domainScope
    : [DOMAIN.GROUND];
  const family = event.family || familyForPlatformString(event.platform || event.droneType);
  const classification = event.classification || CLS.UNKNOWN;
  const threat = event.threat || THREAT.UNKNOWN;
  return scope.map(domain => ({ domain, family, classification, threat }));
}

export function observerRoleObjectsForEvent(event, receivers, { alreadyOnCaseRoleIds = null } = {}) {
  if (!event || !Array.isArray(receivers)) return { roles: [], rationale: '', confidence: 'low', firedRules: [] };

  // Multi-domain safe: iterate every context in the event's domain
  // scope and union the resulting observer sets. Confidence collapses
  // to the weakest matched across all contexts; rationale + firedRules
  // dedupe across the same. This is the fix for the pass-2 finding
  // that maritime+aviation events silently dropped agency-traf.
  const contexts = contextsForEvent(event);
  const obsSet = new Set();
  const ruleSet = new Set();
  const rationaleSet = new Set();
  let confidenceScore = 3;

  for (const ctx of contexts) {
    const route = routeFor(ctx);
    for (const rid of route.observers) obsSet.add(rid);
    for (const tag of route.firedRules) ruleSet.add(tag);
    if (route.rationale) rationaleSet.add(route.rationale);
    const rc = route.confidence === 'high' ? 3 : route.confidence === 'medium' ? 2 : 1;
    if (rc < confidenceScore) confidenceScore = rc;
  }

  const dedupe = alreadyOnCaseRoleIds instanceof Set ? alreadyOnCaseRoleIds : null;
  const roles = Array.from(obsSet)
    .map(rid => receivers.find(r => r.id === rid))
    .filter(Boolean)
    .filter(r => !dedupe || !dedupe.has(r.id));
  // Same no-rules-fired guard as routeFor: report 'low' when nothing
  // matched so an empty union result doesn't display as 'high'.
  const confidence = ruleSet.size === 0
    ? 'low'
    : (confidenceScore === 3 ? 'high' : confidenceScore === 2 ? 'medium' : 'low');

  return {
    roles,
    rationale:  Array.from(rationaleSet).join(' · ') || 'No routing rules matched. No auto-observers assigned.',
    confidence,
    firedRules: Array.from(ruleSet),
  };
}
