// Per-account plug-in asset library. Every dispatchable asset a
// receiver profile owns lives here with descriptive metadata that
// surfaces in the UI so operators understand capability, use cases,
// deploy time, and limitations before they click dispatch.
//
// Two axes per profile:
//
//   dispatchable[]  Assets the profile can fire from their own home
//                   base. Clicking one spawns a billboard at the
//                   profile's home base coordinate (receiver_bases.js)
//                   and animates it toward the incident via the
//                   existing counter dispatch engine in main.js. The
//                   asset kind maps to a CD_PROFILE entry.
//
//   requestable[]   Assets the profile does NOT own but can request
//                   from another profile. Clicking one creates a new
//                   escalation targeting the from profile. Target
//                   profile sees the request in their inbox and can
//                   dispatch their own asset.
//
// Adding new assets for an existing profile: append a new entry to
// dispatchable[] or requestable[]. No code changes required beyond
// ensuring the asset kind has a matching CD_PROFILE entry in main.js
// for the dispatch physics (cruise speed, arrival radius, engage
// time, icon).
//
// Adding a new profile entirely: new top-level key mapping the
// profile's role id to a dispatchable + requestable definition.
//
// Descriptive metadata fields:
//   name          Human-readable asset name shown in the UI
//   count         How many units of this asset the profile owns
//   icon          Emoji or symbol for the CTA button
//   useCases[]    Real-world scenarios this asset addresses
//   capabilities  Structured capability flags (radio frequency,
//                 kinetic, coordination, forensic, etc.)
//   deployTime    Human-readable time from click to on-scene
//   limitations   Where this asset is NOT suitable
//
// Real-customer plug-in path: when a Danish police district gives us
// their actual counter drone inventory, we add rows to their
// dispatchable[] with real names, counts, and metadata. No code
// changes, no logic churn, no risk of ruining existing flows.
//
// See docs/agentic-receiver-asset-plugin-architecture.md for the
// full plug-in flow and mermaid diagram.

export const RECEIVER_ASSETS = {

  // ── Politi København (Copenhagen Police District) ────────────

  'politi-kbh': {
    label: 'Politi København',
    baseId: 'politi-koebenhavn',
    dispatchable: [
      {
        assetKey: 'kbh-patrol-car',
        kind: 'receiver-patrol-car',
        name: 'Patrol car',
        count: 12,
        icon: '🚔',
        useCases: [
          'First ground responder to any incident in Copenhagen district',
          'Perimeter presence and civilian evacuation coordination',
          'Witness location and initial statement gathering',
        ],
        capabilities: {
          coordination: true,
          civilian_management: true,
          armed: true,
          kinetic_counter_drone: false,
        },
        deployTime: '3-8 minutes from station via real road routing',
        limitations: 'Copenhagen district only. No airspace jurisdiction.',
      },
      {
        assetKey: 'kbh-k9-unit',
        kind: 'receiver-k9-unit',
        name: 'K9 search unit',
        count: 4,
        icon: '🐕',
        useCases: [
          'Explosive detection at cordon points',
          'Search of downed drone wreckage or suspect packages',
          'Suspect track and locate',
        ],
        capabilities: {
          explosive_detection: true,
          suspect_track: true,
        },
        deployTime: '10-15 minutes from station',
        limitations: 'Requires clear scene, cannot deploy into active kinetic engagement.',
      },
      {
        assetKey: 'kbh-cordon-squad',
        kind: 'receiver-cordon-squad',
        name: 'Perimeter cordon squad',
        count: 6,
        icon: '⚑',
        useCases: [
          'Establish and hold a physical perimeter around the incident',
          'Traffic diversion and civilian standoff distance',
          'Evidence scene preservation',
        ],
        capabilities: {
          crowd_management: true,
          traffic_control: true,
        },
        deployTime: '15-25 minutes from station',
        limitations: 'Squad is stationary once established. Requires 5+ officers.',
      },
      {
        assetKey: 'kbh-forensic',
        kind: 'receiver-forensic-van',
        name: 'Forensic team',
        count: 2,
        icon: '🔬',
        useCases: [
          'Scene documentation after incident closure',
          'Evidence recovery from downed drone or impact site',
          'Chain of custody handoff to Rigspolitiet cyber crime team',
        ],
        capabilities: {
          evidence_recovery: true,
          scene_documentation: true,
        },
        deployTime: '20-30 minutes from station',
        limitations: 'Post-incident only. Requires scene secured by patrol or cordon first.',
      },
    ],
    requestable: [
      {
        requestKey: 'req-aks',
        from: 'politi-aks',
        name: 'Tactical intervention',
        useCases: [
          'Armed hostage or barricaded suspect',
          'Active shooter scenario',
          'Terminal phase counter drone intercept in populated area',
        ],
        priority: 'critical',
        expectedResponse: 'Aktionsstyrken tactical van or strike team from Ejby',
      },
    ],
  },

  // ── Aktionsstyrken (National Police Tactical Unit) ───────────

  'politi-aks': {
    label: 'Aktionsstyrken',
    baseId: 'aks-cta',
    dispatchable: [
      {
        assetKey: 'aks-tactical-van',
        kind: 'receiver-tactical-van',
        name: 'Tactical van',
        count: 3,
        icon: '🚐',
        useCases: [
          'Armed hostage or barricaded suspect response',
          'High-risk arrest',
          'Terminal-phase counter drone intercept',
        ],
        capabilities: {
          armed: true,
          armored: true,
          kinetic_counter_drone: true,
          breach_capability: true,
        },
        deployTime: '15-25 minutes from Ejby to Copenhagen area',
        limitations: 'National unit, single-scene at a time.',
      },
      {
        assetKey: 'aks-strike-team',
        kind: 'receiver-strike-team',
        name: 'Strike team',
        count: 2,
        icon: '🛡',
        useCases: [
          'Multi-suspect breach and clear',
          'Hostage rescue',
          'High-threat entry',
        ],
        capabilities: {
          armed: true,
          breach_capability: true,
          hostage_rescue: true,
        },
        deployTime: '20-30 minutes from Ejby',
        limitations: 'Requires senior political approval for domestic hostage rescue.',
      },
    ],
    requestable: [],
  },

  // ── Rigspolitiet (National Police HQ) ────────────────────────

  'rigspoliti': {
    label: 'Rigspolitiet',
    baseId: 'rigspolitiet',
    dispatchable: [
      {
        assetKey: 'rigs-coord-cell',
        kind: 'receiver-coord-cell',
        name: 'National coordination cell',
        count: 1,
        icon: '📞',
        useCases: [
          'Cross-district resource marshalling for a multi-district incident',
          'National-scale crisis coordination with military and ministries',
          'Media and public communication coordination',
        ],
        capabilities: {
          coordination: true,
          static: true,
        },
        deployTime: 'Instant activation from Rigspolitiet HQ',
        limitations: 'Coordination only, no kinetic or field response.',
      },
      {
        assetKey: 'rigs-nc3-cyber',
        kind: 'receiver-cyber-team',
        name: 'National cyber crime team',
        count: 8,
        icon: '💻',
        useCases: [
          'Digital forensics on captured drone control channels',
          'Attribution analysis for state-sponsored incidents',
          'Cyber threat intelligence handoff to Politiets Efterretningstjeneste and Forsvarets Efterretningstjeneste',
        ],
        capabilities: {
          digital_forensics: true,
          cyber_analysis: true,
          static: true,
        },
        deployTime: 'Remote analysis begins immediately, on-site forensics 60-90 minutes to Copenhagen area',
        limitations: 'Analysis and forensics only, no kinetic response.',
      },
    ],
    requestable: [
      {
        requestKey: 'req-aks',
        from: 'politi-aks',
        name: 'Tactical intervention',
        useCases: [
          'Armed hostage or barricaded suspect',
          'Active shooter scenario',
          'Terminal phase counter drone intercept in populated area',
        ],
        priority: 'critical',
        expectedResponse: 'Aktionsstyrken tactical van or strike team from Ejby',
      },
    ],
  },
};

// Resolve the asset spec for a receiver role. Returns null if the
// role has no defined assets yet. Callers use this to render the
// role's response console.
export function assetsForReceiverRole(roleId) {
  return RECEIVER_ASSETS[roleId] || null;
}

// Look up a specific dispatchable asset spec by role + assetKey.
// Used when the operator clicks a dispatch button so the handler
// knows the asset's kind, icon, and label.
export function getReceiverDirectAsset(roleId, assetKey) {
  const roleAssets = RECEIVER_ASSETS[roleId];
  if (!roleAssets) return null;
  return roleAssets.dispatchable.find(a => a.assetKey === assetKey || a.assetKey === assetKey) || null;
}

// Look up a requestable asset spec by role + requestKey. Used when
// the operator clicks a request button so the handler knows which
// target profile to route the escalation to.
export function getReceiverRequestAsset(roleId, requestKey) {
  const roleAssets = RECEIVER_ASSETS[roleId];
  if (!roleAssets) return null;
  return roleAssets.requestable.find(r => r.requestKey === requestKey) || null;
}
