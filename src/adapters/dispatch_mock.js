// ═══════════════════════════════════════════════════════════════════
// Mock Dispatch Adapter — default for every receiver role today
// ───────────────────────────────────────────────────────────────────
// Preserves the pre-adapter inline stub behavior EXACTLY:
//   1. Push an interaction record to event.interactions with the
//      original shape (id / timestamp / flow: 'action-dispatched' /
//      from_role_id / to_role_id: 'response-pipeline' / payload /
//      ackStatus / ackedAt / ackedBy).
//   2. Return an adapter-standard result envelope.
//
// The interaction-record `flow` value is the literal string
// 'action-dispatched' — NOT a FLOW_TYPES enum member. Preserved
// verbatim because current audit consumers (docs/interface-design-
// document.md IF-6.12, Phase 3+ readers) will filter on this exact
// literal. IDD schema flags this as a non-enum violation but the
// stub's history is more load-bearing than the schema right now —
// changing it here breaks backward compat with any future consumer
// already coded against the literal.
//
// Toast + view re-render stay in the CTA handler (UI concerns, not
// adapter concerns). Adapter is transport-only.
//
// Registered as DEFAULT so any receiver role without a specific
// adapter falls through here. Real customer adapters register their
// own by role id and take precedence.
// ═══════════════════════════════════════════════════════════════════

import { registerDispatchAdapter, DEFAULT_DISPATCH_ADAPTER_KEY } from '../dispatch_source.js';

function _newInteractionId() {
  return `ACT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

const mockDispatchAdapter = {
  name: 'mock',
  async dispatch({ action, event, actorRole /*, actionDetail */ }) {
    if (!event) {
      return {
        status: 'error',
        external_id: null,
        timestamp: new Date().toISOString(),
        provider: 'mock',
        notes: 'no event context',
      };
    }
    const timestamp = new Date().toISOString();
    const roleId = actorRole?.id || 'unknown';

    // Byte-for-byte match with the pre-adapter inline stub push at
    // the old main.js:16997-17010. Any change here shifts an audit
    // shape that Phase 3+ readers may already be coded against.
    if (!Array.isArray(event.interactions)) event.interactions = [];
    event.interactions.push({
      id: _newInteractionId(),
      timestamp,
      flow: 'action-dispatched',
      from_role_id: roleId,
      to_role_id: 'response-pipeline',
      payload: { action, event_id: event.id },
      ackStatus: 'pending',
      ackedAt: null,
      ackedBy: null,
    });

    return {
      status: 'accepted',
      external_id: null,     // real adapters return a ticket id / dispatch reference here
      timestamp,
      provider: 'mock',
      notes: 'Stubbed dispatch. Live pipeline wires in Phase 3 via per-receiver adapter registration.',
    };
  },
};

registerDispatchAdapter(DEFAULT_DISPATCH_ADAPTER_KEY, mockDispatchAdapter);

export default mockDispatchAdapter;
