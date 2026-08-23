// Runbooks: contextual response step guides per threat type.
// Real product: customer defines these in Config module per site.
// For now: pre authored for each platform × classification combination.

// Runbook copy uses plain human language. Tier numbers and military
// acronyms replaced with named agencies + intent phrasing so a duty
// officer new to the platform understands each step without a glossary.
const RUNBOOKS = {
  'quadcopter-hostile': {
    title: 'Hostile Quadcopter Response',
    urgency: 'high',
    estMinutes: 8,
    steps: [
      { n: 1, action: 'Confirm detection on live sensor mesh',
        detail: 'Check that at least three sensors are reporting the same track. Make sure the classification is not a registered friendly flight before acting.' },
      { n: 2, action: 'Alert site security team',
        detail: 'Notify the Security Operations Centre by SMS and in-app. Expect acknowledgment within 90 seconds.' },
      { n: 3, action: 'Notify local police district',
        detail: 'Send the Detection Brief by encrypted email. If no acknowledgment within 5 minutes, follow up by phone.' },
      { n: 4, action: 'Assess perimeter breach',
        detail: 'If the drone crosses the inner perimeter, escalate to national authorities (Rigspolitiet + relevant defence branch) within 60 seconds.' },
      { n: 5, action: 'Prepare evidence handoff',
        detail: 'Package the full evidence bundle (radio, acoustic, visual) tied to the police case number. Retain source data for 7 years per compliance policy.' },
      { n: 6, action: 'Debrief and log outcome',
        detail: 'Close the event with a resolution note. Update classification if the pilot has been identified. Leave an operator note for the next shift.' },
    ],
  },

  'fixed-wing-hostile': {
    title: 'Hostile Fixed Wing Response',
    urgency: 'high',
    estMinutes: 12,
    steps: [
      { n: 1, action: 'Confirm platform type and altitude',
        detail: 'A fixed-wing platform at cruise altitude points to a coordinated operator, not a hobbyist. Verify visually if the drone is in optical range.' },
      { n: 2, action: 'Alert site security and local police in parallel',
        detail: 'Fixed-wing incursions warrant simultaneous local security and police notification. Confirm both acknowledgments.' },
      { n: 3, action: 'Notify Rigspolitiet and defence intelligence',
        detail: 'National-level intelligence services need visibility. Dispatch via API integration where configured, otherwise encrypted email.' },
      { n: 4, action: 'Coordinate with Eurocontrol NOTAM',
        detail: 'If the track is in controlled airspace, push a NOTAM programmatically. Confirm the airspace advisory has been issued.' },
      { n: 5, action: 'Prepare defence handoff briefing',
        detail: 'If the threat classification firms up, prepare the Air Force handoff package. Nonessential radio traffic drops once defence takes operational control.' },
      { n: 6, action: 'Track and record full trajectory',
        detail: 'Fixed-wing platforms often make reconnaissance passes. The full trajectory is evidence. Keep it in the History module.' },
    ],
  },

  'jet-friendly': {
    title: 'Friendly Aviation Detection',
    urgency: 'low',
    estMinutes: 1,
    steps: [
      { n: 1, action: 'Verify ADS-B match',
        detail: 'Confirm the flight number matches a scheduled arrival or departure. Cross-reference against the airspace schedule.' },
      { n: 2, action: 'Log for audit',
        detail: 'Automatic logging to the audit trail. No further action needed.' },
    ],
  },

  'missile-hostile': {
    title: 'CRITICAL · Cruise Missile Class Signature',
    urgency: 'critical',
    estMinutes: 4,
    steps: [
      { n: 1, action: 'Confirm this is not a false positive',
        detail: 'A missile-class signature is very rare. Verify at least four independent sensors report a consistent kinematic track before triggering full response.' },
      { n: 2, action: 'Fire the full escalation chain automatically',
        detail: 'The system pushes to site security, police, national agencies, and the Air Force in parallel. No operator confirmation required for a missile classification.' },
      { n: 3, action: 'Drop nonessential radio traffic',
        detail: 'Once the Air Force takes operational control, nonessential radio traffic ceases. Fighter Response leads. This step is not recallable.' },
      { n: 4, action: 'Alert site personnel via internal channels',
        detail: 'Sound the air-raid siren if present. Trigger site-wide shelter-in-place via SCADA integration.' },
      { n: 5, action: 'Preserve all sensor data at maximum fidelity',
        detail: 'Raw sensor data retention flips to unlimited automatically. The full evidence bundle is required for national investigation.' },
      { n: 6, action: 'Await defence command direction',
        detail: 'Operator role narrows to sensor-network monitoring. All escalation authority passes to Forsvarskommandoen.' },
    ],
  },

  'fixed-wing-hostile-recon': {
    title: 'High-Altitude Reconnaissance Response',
    urgency: 'medium',
    estMinutes: 15,
    steps: [
      { n: 1, action: 'Confirm high-altitude platform classification',
        detail: 'High-altitude reconnaissance platforms need passive coherent location (PCL) confirmation. Verify SATCOM downlink capture if available.' },
      { n: 2, action: 'Log for situational awareness',
        detail: 'A high-altitude reconnaissance track at cruise altitude with normal loiter behaviour is informational at this stage. Notify site security in-app only.' },
      { n: 3, action: 'Monitor for behaviour change',
        detail: 'Auto-escalate to national agencies if the platform descends below 3000 metres or lingers over the site for more than 10 minutes.' },
      { n: 4, action: 'Notify defence intelligence for pattern analysis',
        detail: 'Reconnaissance patterns may indicate coordinated activity across sites. Defence intelligence aggregates these for national threat assessment.' },
      { n: 5, action: 'Preserve trajectory for forensic archive',
        detail: 'High-altitude reconnaissance tracks are valuable for pattern-of-life analysis. Keep the full trajectory in the History module indefinitely.' },
    ],
  },

  'quadcopter-friendly': {
    title: 'Friendly Inspection Drone',
    urgency: 'low',
    estMinutes: 1,
    steps: [
      { n: 1, action: 'Confirm registered flight',
        detail: 'Verify against the registered inspection schedule and operator credentials for this site.' },
      { n: 2, action: 'Log for audit',
        detail: 'Automatic logging to the audit trail. No further action needed.' },
    ],
  },
};

export function runbookFor(event) {
  const platform = event.platform || 'quadcopter';
  const cls = event.classification;
  const key = `${platform}-${cls}`;
  const alt = event.lastPosition?.alt || event.entry?.alt || 0;
  // HALE variant for high altitude fixed wing
  if (platform === 'fixed-wing' && cls === 'hostile' && alt > 3000) return RUNBOOKS['fixed-wing-hostile-recon'];
  return RUNBOOKS[key] || {
    title: 'Standard Response',
    urgency: 'medium',
    estMinutes: 5,
    steps: [
      { n: 1, action: 'Confirm detection',       detail: 'Verify sensor mesh consensus across radio, acoustic, and visual.' },
      { n: 2, action: 'Alert site security',      detail: 'Notify the Security Operations Centre.' },
      { n: 3, action: 'Escalate as required',     detail: 'Follow the site escalation policy in the Config module.' },
    ],
  };
}
