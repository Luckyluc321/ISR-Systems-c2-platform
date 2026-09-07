// Per-receiver-role asset library. Two axes per role:
//
//   direct[]  Assets the role can dispatch itself. Clicking one
//             spawns a billboard at the role's home base coordinate
//             (see receiver_bases.js) and animates it toward the
//             incident site via the existing counter-dispatch engine
//             in main.js. Same visual pattern the operator uses when
//             they scramble a fighter or dispatch a police patrol.
//
//   request[] Assets the role does NOT own but can REQUEST from
//             another profile. Clicking one creates a new escalation
//             record routed to the target profile (routesTo). The
//             target profile sees the request in their inbox and can
//             choose to dispatch (their own direct asset) or ignore.
//             Request status flows back to the requester as an
//             acknowledgement on the escalation record.
//
// Every asset has a kind that maps to a CD_PROFILE entry in main.js
// (cruise speed, arrival radius, engage time, icon, road routing).
//
// This first batch covers three police roles: Politi København,
// Aktionsstyrken, and Rigspolitiet. Additional branches (Hæren,
// Beredskabsstyrelsen, Hjemmeværnet, Region, Kommune) land in
// follow-up commits using the same schema.

export const RECEIVER_ASSETS = {

  // ── Politi København (Copenhagen Police District) ────────────

  'politi-kbh': {
    baseId: 'politi-koebenhavn',
    direct: [
      {
        id: 'kbh-patrol-car',
        action: 'receiver-dispatch',
        assetKey: 'kbh-patrol-car',
        kind: 'receiver-patrol-car',
        label: 'Deploy patrol car',
        sub: 'Local district patrol responder',
        icon: '🚔',
        supportsMultiDispatch: true,
      },
      {
        id: 'kbh-k9-unit',
        action: 'receiver-dispatch',
        assetKey: 'kbh-k9-unit',
        kind: 'receiver-k9-unit',
        label: 'Deploy K9 search unit',
        sub: 'Handler and search dog',
        icon: '🐕',
      },
      {
        id: 'kbh-cordon-squad',
        action: 'receiver-dispatch',
        assetKey: 'kbh-cordon-squad',
        kind: 'receiver-cordon-squad',
        label: 'Establish perimeter cordon',
        sub: 'Uniformed cordon squad',
        icon: '⚑',
      },
      {
        id: 'kbh-forensic',
        action: 'receiver-dispatch',
        assetKey: 'kbh-forensic',
        kind: 'receiver-forensic-van',
        label: 'Deploy forensic team',
        sub: 'Scene documentation and evidence recovery',
        icon: '🔬',
      },
    ],
    request: [
      {
        id: 'req-aks',
        action: 'receiver-request',
        routesTo: 'politi-aks',
        label: 'Request tactical intervention',
        sub: 'Aktionsstyrken, national police tactical unit',
        priority: 'critical',
      },
    ],
  },

  // ── Aktionsstyrken (National Police Tactical Unit) ───────────

  'politi-aks': {
    baseId: 'politi-aks',
    direct: [
      {
        id: 'aks-tactical-van',
        action: 'receiver-dispatch',
        assetKey: 'aks-tactical-van',
        kind: 'receiver-tactical-van',
        label: 'Deploy tactical van',
        sub: 'Aktionsstyrken assault vehicle and team',
        icon: '🚐',
      },
      {
        id: 'aks-strike-team',
        action: 'receiver-dispatch',
        assetKey: 'aks-strike-team',
        kind: 'receiver-strike-team',
        label: 'Deploy strike team',
        sub: 'Aktionsstyrken breach and clear element',
        icon: '🛡',
      },
    ],
    request: [],
  },

  // ── Rigspolitiet (National Police HQ) ────────────────────────

  'rigspoliti': {
    baseId: 'rigspolitiet',
    direct: [
      {
        id: 'rigs-coord-cell',
        action: 'receiver-dispatch',
        assetKey: 'rigs-coord-cell',
        kind: 'receiver-coord-cell',
        label: 'Activate national coordination cell',
        sub: 'National operations command coordination',
        icon: '📞',
      },
      {
        id: 'rigs-nc3-cyber',
        action: 'receiver-dispatch',
        assetKey: 'rigs-nc3-cyber',
        kind: 'receiver-cyber-team',
        label: 'Deploy national cyber crime team',
        sub: 'Nationalt Cyber Crime Center forensics and response',
        icon: '💻',
      },
    ],
    request: [
      {
        id: 'req-aks',
        action: 'receiver-request',
        routesTo: 'politi-aks',
        label: 'Request tactical intervention',
        sub: 'Aktionsstyrken, national police tactical unit',
        priority: 'critical',
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

// Look up a specific direct-asset spec by role + assetKey. Used when
// the operator clicks a direct dispatch button so the handler knows
// the asset's kind, icon, and label.
export function getReceiverDirectAsset(roleId, assetKey) {
  const roleAssets = RECEIVER_ASSETS[roleId];
  if (!roleAssets) return null;
  return roleAssets.direct.find(a => a.assetKey === assetKey || a.id === assetKey) || null;
}

// Look up a request spec by role + requestId. Used when the operator
// clicks a request button so the handler knows which target profile
// to route the escalation to.
export function getReceiverRequestAsset(roleId, requestId) {
  const roleAssets = RECEIVER_ASSETS[roleId];
  if (!roleAssets) return null;
  return roleAssets.request.find(r => r.id === requestId) || null;
}
