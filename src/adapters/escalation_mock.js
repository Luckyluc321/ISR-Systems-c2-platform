// ═══════════════════════════════════════════════════════════════════
// Mock Escalation Adapter — default for every receiver role today
// ───────────────────────────────────────────────────────────────────
// The source-of-truth mutation for escalations already happens in
// events.js (escalateEvent, respondToEscalation, withdrawEscalation,
// updateEscalationAssessment, updateEscalationStatus). This adapter
// is a transport-layer no-op: it stamps an audit-friendly
// interaction record on event.interactions and returns a standard
// success envelope.
//
// Real customer adapters (politi-kbh-inbox, pet-intake, aks-tactical,
// fe-analytics) will forward the intent over their internal APIs.
// Each customer's adapter can implement any subset of the five
// methods; unimplemented methods fall back to a no-op via
// fireEscalationAdapter in escalation_source.js.
//
// Registered as DEFAULT so any receiver role without a specific
// adapter falls through here. Real adapters register by role id
// and take precedence.
// ═══════════════════════════════════════════════════════════════════

import {
  registerEscalationAdapter,
  DEFAULT_ESCALATION_ADAPTER_KEY,
} from '../escalation_source.js';

function _stampInteraction(event, actorRole, flow, payload) {
  if (!event) return;
  if (!Array.isArray(event.interactions)) event.interactions = [];
  event.interactions.push({
    id: `ACT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    flow,
    from_role_id: actorRole?.id || 'unknown',
    to_role_id: 'escalation-pipeline',
    payload,
    ackStatus: 'pending',
    ackedAt: null,
    ackedBy: null,
  });
}

function _successEnvelope(notes) {
  return {
    status: 'accepted',
    external_id: null,
    timestamp: new Date().toISOString(),
    provider: 'mock',
    notes: notes || 'Stubbed transport. Real inbox delivery wires in Phase 3 via per-role adapter registration.',
  };
}

const mockEscalationAdapter = {
  name: 'mock',

  async sendEscalation({ event, escalationRecord, actorRole }) {
    _stampInteraction(event, actorRole, 'escalation-sent', {
      escalation_id: escalationRecord?.id,
      destination_id: escalationRecord?.destinationId,
      cascade_reason: escalationRecord?.assessmentPackage?.cascadeReason || null,
      priority:       escalationRecord?.assessmentPackage?.priority || null,
    });
    return _successEnvelope();
  },

  async withdrawEscalation({ event, escalationId, reason, actorRole }) {
    _stampInteraction(event, actorRole, 'escalation-withdrawn', {
      escalation_id: escalationId,
      reason: reason || null,
    });
    return _successEnvelope();
  },

  async updateAssessment({ event, escalationId, updateText, priority, actorRole }) {
    _stampInteraction(event, actorRole, 'escalation-updated', {
      escalation_id: escalationId,
      update_text_preview: (updateText || '').slice(0, 120),
      priority: priority || null,
    });
    return _successEnvelope();
  },

  async replyToEscalation({ event, escalationId, replyText, actorRole }) {
    _stampInteraction(event, actorRole, 'escalation-replied', {
      escalation_id: escalationId,
      reply_text_preview: (replyText || '').slice(0, 120),
    });
    return _successEnvelope();
  },

  async acknowledgeEscalation({ event, escalationId, actorRole }) {
    _stampInteraction(event, actorRole, 'escalation-acknowledged', {
      escalation_id: escalationId,
    });
    return _successEnvelope();
  },
};

registerEscalationAdapter(DEFAULT_ESCALATION_ADAPTER_KEY, mockEscalationAdapter);

export default mockEscalationAdapter;
