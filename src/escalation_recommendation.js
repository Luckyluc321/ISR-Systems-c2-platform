// ═══════════════════════════════════════════════════════════════════
// Who an escalation goes to by default
// ───────────────────────────────────────────────────────────────────
// Lifted out of main.js (it was recommendationFor, inside the escalate
// modal) so it can be tested, and rewritten on 2026-10-26 after Lucas
// found the defaults wrong at every site:
//
//   1. A EUROPEAN AGENCY WAS PRESELECTED. Eurocontrol sits in Tier 2 at
//      Copenhagen and Billund, so every hostile drone preselected it,
//      and a missile preselected all of Tier 5: Europol, NATO, NORDEFCO,
//      ENTSO-E. A site operator tells the Danish authorities. Whether
//      and when a European or NATO body is told is their call, not the
//      operator's and not ours. International bodies stay on the list
//      to pick by hand and are never ticked by default.
//
//   2. THE WORDING DECIDED THE RESPONSE. "Dispatch Tier 1 and Tier 2
//      immediately. Escalate to Tier 3 within 60 seconds." ISR Systems
//      is the messenger, not the decision maker (Lucas, 2026-10-26). The
//      recommendation says who should be told, never what anyone should
//      do about it.
//
// Pure. No DOM, no store.
// ═══════════════════════════════════════════════════════════════════

import { isInternationalBody } from './destinations.js';

/**
 * Which tiers to tell for this event, and one line saying so.
 * @returns {{ tiers: number[], text: string, urgency: 'low'|'med'|'high'|'critical' }}
 */
export function recommendationFor(event) {
  const cls = event?.classification;
  const platform = event?.platform || 'quadcopter';
  const threat = event?.threat;
  if (cls === 'friendly') return { tiers: [1], text: 'Friendly identification. Log it with site security for the record.', urgency: 'low' };
  if (cls === 'resolved') return { tiers: [], text: 'Already dismissed. Nothing to send.', urgency: 'low' };
  if (platform === 'missile') return { tiers: [1, 2, 3, 4], text: 'Missile signature. Notify site security, the police, the national agencies and defence now.', urgency: 'critical' };
  if (cls === 'hostile' && threat === 'high') return { tiers: [1, 2, 3], text: 'High-threat hostile track. Notify site security, the police and the national agencies now.', urgency: 'high' };
  if (cls === 'hostile' && threat === 'medium') return { tiers: [1, 2], text: 'Hostile track. Notify site security and the police.', urgency: 'med' };
  if (platform === 'fixed-wing') return { tiers: [1, 2, 3], text: 'Fixed-wing platform. Notify site security, the police and the national agencies.', urgency: 'high' };
  if (platform === 'non-identifiable') return { tiers: [1, 2], text: 'Unidentified contact. Notify site security and the police. Add others as the picture firms up.', urgency: 'med' };
  if (cls === 'unknown') return { tiers: [1], text: 'Classification pending. Notify site security. Add others as the picture firms up.', urgency: 'med' };
  return { tiers: [1], text: 'Notify site security. Add others as required.', urgency: 'med' };
}

/** The destinations ticked when the modal opens, and by "Apply
 *  recommended": the recommended tiers, minus international bodies. */
export function preselectedDestinationIds(rec, dests) {
  return (dests || [])
    .filter(d => rec.tiers.includes(d.tier) && !isInternationalBody(d))
    .map(d => d.id);
}
