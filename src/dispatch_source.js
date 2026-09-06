// ═══════════════════════════════════════════════════════════════════
// Dispatch Source — abstract seam + per-receiver-role registry
// ───────────────────────────────────────────────────────────────────
// Pluggable adapter interface for the Phase 2 branch-scoped CTAs
// (deploy-patrol, set-cordon, request-aks, brs-standby, brs-deploy,
// army-c-uas, army-ground, intel-log, issue-notam, restrict-airspace,
// issue-maritime-advisory, kom-crisis, kom-shelter, hjv-reinforce,
// region-ambulance-standby, region-triage-prep).
//
// Today: mock adapter is the default for every receiver role. It
// pushes an audit interaction to event.interactions with the same
// shape the previous inline stub produced (byte-for-byte parity).
//
// Tomorrow: each customer (Politi Kbh, Politi Sydvest, BRS Beredskab,
// Trafikstyrelsen, etc.) registers their own adapter that calls their
// real internal dispatch API — routed through the Azure sovereign
// proxy per docs/interface-design-document.md IF-9.7 pattern. Same
// contract from main.js's point of view; only the transport moves.
//
// Same architectural pattern as nn_source.js and
// cooperative_traffic_source.js — one interface, per-key adapter
// selection driven by the caller's receiver role id.
//
// Full design: docs/agentic-dispatch-adapter-architecture.md
// Detection-only stance: adapters return dispatch RESULTS (accepted /
// rejected / error), never make decisions. Operator's click IS the
// decision — this seam just carries it to the right endpoint.
// ═══════════════════════════════════════════════════════════════════

// Registry populated at boot by importing adapter modules. Adapter
// modules self-register via registerDispatchAdapter(receiverRoleId, adapter).
const _adapters = new Map();

// Sentinel key for the default adapter used when a role has no
// dedicated adapter registered. Every real deployment registers
// per-role; DEFAULT is the safety net.
export const DEFAULT_DISPATCH_ADAPTER_KEY = '__default__';

export function registerDispatchAdapter(receiverRoleId, adapter) {
  if (!receiverRoleId || typeof receiverRoleId !== 'string') throw new Error('receiver role id required');
  if (!adapter || typeof adapter.dispatch !== 'function') {
    throw new Error(`adapter for ${receiverRoleId} missing async dispatch({ action, event, actorRole, actionDetail })`);
  }
  _adapters.set(receiverRoleId, adapter);
}

export function getDispatchAdapter(receiverRoleId) {
  return _adapters.get(receiverRoleId)
      || _adapters.get(DEFAULT_DISPATCH_ADAPTER_KEY)
      || null;
}

export function listDispatchAdapters() {
  return [..._adapters.keys()];
}

// ── DispatchAdapter contract ────────────────────────────────────
// Every adapter (mock + future real ones) implements:
//
//   {
//     name: string,                       // 'mock' | 'politi-kbh-api' | ...
//     async dispatch({                    //
//       action:       string,             // 'deploy-patrol', 'issue-notam', ...
//       event:        object,             // the full event object (mutable)
//       actorRole:    object,             // getActiveRole() result
//       actionDetail: object | undefined, // action-specific extras from
//                                         // the CTA dataset (empty today)
//     }) → Promise<{
//       status:      'accepted' | 'rejected' | 'error',
//       external_id: string | null,       // real API's ticket id when live
//       timestamp:   ISO,                 // adapter-stamped
//       provider:    string,              // 'mock' | 'politi-api' | ...
//       notes:       string | null,       // human-readable free text
//     }>
//   }
//
// IMPLEMENTATION NOTE: the adapter is responsible for pushing to
// event.interactions itself (with whatever payload shape it wants).
// Return value is for the caller's inspection + future UI hooks
// (e.g. surface external_id in the audit journal).
