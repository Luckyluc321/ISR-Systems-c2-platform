// ═══════════════════════════════════════════════════════════════════
// Escalation progress badge — compact pill rendered next to any
// escalation record showing its post-acknowledgment progress state.
// Second render surface extracted from main.js as part of Phase 2.
// ───────────────────────────────────────────────────────────────────
// Pure function: (escalationRecord) => HTMLString. No side effects,
// no closures over main.js state, no listeners.
//
// The progress axis is independent of the escalation lifecycle
// (sent → delivered → read → acknowledged). It kicks in POST-ack
// and tracks whether the receiver is actively working the incident
// (in-progress), has closed it out (resolved), or has flagged that
// they can't proceed (blocked, with a reason).
//
// Rendered in three surfaces (all callsites in main.js keep the same
// function name via a thin alias):
//   1. Operator-side escalation log rows
//   2. Receiver inbox card status line
//   3. Compact history / audit views
// ═══════════════════════════════════════════════════════════════════

const _PROGRESS_STATES = {
  'in-progress': { bg: 'rgba(77,210,255,0.10)', border: 'rgba(77,210,255,0.4)', fg: '#4dd2ff', label: 'IN PROGRESS' },
  'resolved':    { bg: 'rgba(77,255,156,0.10)', border: 'rgba(77,255,156,0.4)', fg: '#4dff9c', label: 'RESOLVED' },
  'blocked':     { bg: 'rgba(255,184,77,0.12)', border: 'rgba(255,184,77,0.5)', fg: '#ffb84d', label: 'BLOCKED' },
};

export function renderProgressBadge(esc) {
  if (!esc || !esc.progressStatus) return '';
  const cfg = _PROGRESS_STATES[esc.progressStatus];
  if (!cfg) return '';
  const reason = esc.progressStatus === 'blocked' && esc.blockedReason
    ? ` · ${esc.blockedReason.length > 60 ? esc.blockedReason.slice(0, 60) + '…' : esc.blockedReason}`
    : '';
  return `<span class="esc-progress-badge" title="${(esc.blockedReason || '').replace(/"/g, '&quot;')}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:${cfg.bg};border:1px solid ${cfg.border};border-radius:12px;font-size:var(--fs-2xs);letter-spacing:0.14em;color:${cfg.fg};font-family:var(--font-mono);margin-left:6px;">${cfg.label}${reason}</span>`;
}
