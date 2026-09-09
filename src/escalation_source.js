// ═══════════════════════════════════════════════════════════════════
// Escalation Source — abstract seam + per-receiver-role registry
// ───────────────────────────────────────────────────────────────────
// Pluggable adapter interface for the cross-agency escalation
// lifecycle: send cascade, withdraw cascade, post cascade update,
// reply to escalation, acknowledge escalation.
//
// Mirrors dispatch_source.js exactly. Separate registry because the
// two concerns are different: dispatch adapters route asset spawns
// to real CAD systems; escalation adapters route case-file cascades
// to real inbox/case-management systems. A given agency may plug in
// both, one, or neither.
//
// Today: mock adapter is the default for every receiver role. It
// no-ops the transport layer since the source-of-truth mutation
// (event.escalations write, esc.response push, esc.status transition)
// already happened in events.js — the adapter just returns a
// standard result envelope for the caller.
//
// Tomorrow: each customer registers their own adapter that forwards
// the cascade over their internal API (Politi Kbh CAD inbox,
// Aktionsstyrken tactical intake, PET intelligence queue). Same
// contract; only the transport moves. All external calls route
// through the Azure sovereign proxy per docs/interface-design-
// document.md IF-9.7.
//
// Full design: docs/agentic-dispatch-adapter-architecture.md
// (same seam pattern, escalation namespace).
//
// Detection-only stance: adapters return RESULTS (accepted /
// rejected / error). They never make cascade decisions and never
// short-circuit the operator's action — the click IS the decision.
// This seam just carries it to the right endpoint.
// ═══════════════════════════════════════════════════════════════════

const _adapters = new Map();

export const DEFAULT_ESCALATION_ADAPTER_KEY = '__default__';

export function registerEscalationAdapter(receiverRoleId, adapter) {
  if (!receiverRoleId || typeof receiverRoleId !== 'string') {
    throw new Error('receiver role id required');
  }
  // At minimum an adapter needs sendEscalation. Optional methods
  // (withdraw/update/reply/acknowledge) fall back to a no-op when the
  // adapter doesn't implement them, so a real customer can plug in
  // only the paths their internal system actually supports.
  if (!adapter || typeof adapter.sendEscalation !== 'function') {
    throw new Error(`adapter for ${receiverRoleId} missing async sendEscalation({...})`);
  }
  _adapters.set(receiverRoleId, adapter);
}

export function getEscalationAdapter(receiverRoleId) {
  return _adapters.get(receiverRoleId)
      || _adapters.get(DEFAULT_ESCALATION_ADAPTER_KEY)
      || null;
}

export function listEscalationAdapters() {
  return [..._adapters.keys()];
}

// ── EscalationAdapter contract ──────────────────────────────────
// Every adapter implements:
//
//   {
//     name: string,   // 'mock' | 'politi-kbh-inbox' | 'pet-intake' | ...
//
//     async sendEscalation({
//       eventId,             // string
//       event,               // full event object (read-only for adapter)
//       escalationRecord,    // the freshly-created record (includes
//                            //   destinationId, assessmentPackage,
//                            //   requesterRoleId, priority, initiatedAt)
//       actorRole,           // getActiveRole() result (the sender)
//     }) → Promise<AdapterResult>
//
//     async withdrawEscalation?({
//       eventId, escalationId, reason, actorRole,
//     }) → Promise<AdapterResult>
//
//     async updateAssessment?({
//       eventId, escalationId, updateText, priority, actorRole,
//     }) → Promise<AdapterResult>
//
//     async replyToEscalation?({
//       eventId, escalationId, replyText, actorRole,
//     }) → Promise<AdapterResult>
//
//     async acknowledgeEscalation?({
//       eventId, escalationId, actorRole,
//     }) → Promise<AdapterResult>
//   }
//
// AdapterResult:
//   {
//     status:      'accepted' | 'rejected' | 'error',
//     external_id: string | null,   // recipient's ticket id when live
//     timestamp:   ISO,             // adapter-stamped
//     provider:    string,          // 'mock' | 'politi-kbh-inbox' | ...
//     notes:       string | null,   // human-readable free text
//   }
//
// IMPLEMENTATION NOTE: unlike dispatch adapters which push to
// event.interactions themselves, escalation adapters do NOT mutate
// the escalation record. Source of truth lives in events.js
// (escalateEvent, respondToEscalation, withdrawEscalation,
// updateEscalationAssessment). The adapter is transport-only —
// forwarding the intent to the recipient's real inbox system.
//
// When the recipient's system asynchronously reports acknowledgement
// or delivery-status transitions, the adapter is expected to call
// updateEscalationStatus() from events.js on our side to keep the
// shared state in sync. That's the "delivery receipt" loop that
// replaces the current _simulateEscalationDelivery timeout chain
// once real transport is wired.

// Convenience: async fan-out helper for callers that want to fire
// the adapter without blocking the UI. Returns the promise so
// consumers can chain if they want a toast on completion.
export function fireEscalationAdapter(methodName, args) {
  const adapter = getEscalationAdapter(args.actorRole?.id);
  if (!adapter) {
    return Promise.resolve({
      status: 'error',
      external_id: null,
      timestamp: new Date().toISOString(),
      provider: 'none',
      notes: `no escalation adapter registered for role ${args.actorRole?.id || 'unknown'}`,
    });
  }
  const fn = adapter[methodName];
  if (typeof fn !== 'function') {
    // Optional method not implemented — no-op with a benign result
    // envelope so the caller doesn't have to branch.
    return Promise.resolve({
      status: 'accepted',
      external_id: null,
      timestamp: new Date().toISOString(),
      provider: adapter.name || 'unknown',
      notes: `${methodName} not implemented by adapter; local state mutated`,
    });
  }
  return fn.call(adapter, args).catch(err => ({
    status: 'error',
    external_id: null,
    timestamp: new Date().toISOString(),
    provider: adapter.name || 'unknown',
    notes: err?.message || 'adapter threw',
  }));
}
