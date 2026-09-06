// Hardcoded response playbooks per threat platform.
// Suggestions shown to receiver agencies (Politi, PET, Beredskabsstyrelsen, etc.)
// when a brief lands in their inbox. Real product replaces these with agency
// authored playbooks per tenant. Demo uses these fixed doctrines.

export const PLAYBOOKS = {
  quadcopter: {
    hostile: {
      title: 'Military grade quadcopter, hostile',
      severity: 'high',
      immediateActions: [
        'Dispatch 2 patrol units to site perimeter, secure ground access',
        'Establish 500m ground exclusion around active track',
        'Attempt operator location trace via RF signal triangulation',
        'Do not engage in flight, passive tracking only, follow to landing',
        'Preserve all sensor evidence for FE attribution analysis',
      ],
      coordination: [
        'PET assumes lead on counter intelligence investigation',
        'FE runs SIGINT and platform attribution (state actor assessment)',
        'Coordinate with Hjemmeværnet for extended ground cordon if remote',
        'Alert grid operator (Energinet) for immediate infrastructure hardening',
      ],
      handoffTo: ['PET', 'FE', 'Forsvarskommandoen (if pattern of activity)'],
    },
    unknown: {
      title: 'Quadcopter, unclassified',
      severity: 'low',
      immediateActions: [
        'Dispatch 1 patrol unit for identification',
        'Monitor track, do not engage',
      ],
      coordination: [],
      handoffTo: [],
    },
  },
  'fixed-wing': {
    hostile: {
      title: 'Fixed wing UAV, hostile',
      severity: 'medium',
      immediateActions: [
        'Establish air exclusion coordination with Flyvevåbnet',
        'Dispatch patrol units to projected landing area',
        'Backtrack trajectory to identify launch origin',
      ],
      coordination: [
        'Alert FE for trajectory analysis and intelligence value',
        'Coordinate with Flyvevåbnet Fighter Response at Skrydstrup if military grade platform',
      ],
      handoffTo: ['FE', 'Flyvevåbnet Fighter Response'],
    },
  },
  missile: {
    hostile: {
      title: 'Cruise missile, critical',
      severity: 'critical',
      immediateActions: [
        'IMMEDIATE mass civil alert, blast radius 500m',
        'Evacuate all civilians within 1km of projected impact',
        'Coordinate with Flyvevåbnet Fighter Response for airborne intercept',
        'Alert Beredskabsstyrelsen for medical and rescue staging',
      ],
      coordination: [
        'Notify PET, FE, and Forsvarskommandoen simultaneously',
        'Coordinate with Politi for cordon and traffic control',
        'Prepare post impact response, casualty triage, HAZMAT if applicable',
      ],
      handoffTo: ['Forsvarskommandoen', 'PET', 'FE', 'Beredskabsstyrelsen'],
    },
  },
  jet: {
    friendly: {
      title: 'Commercial jet, friendly',
      severity: 'info',
      immediateActions: [
        'No response required. Verify flight plan match.',
      ],
      coordination: [],
      handoffTo: [],
    },
  },
  usv: {
    hostile: {
      title: 'Surface drone (USV), hostile',
      severity: 'high',
      immediateActions: [
        'Alert Søværnet and Kystvagten immediately',
        'Dispatch nearest naval patrol vessel',
        'Evacuate maritime traffic in 2km radius',
      ],
      coordination: [
        'Alert Beredskabsstyrelsen for port civilian safety',
        'Coordinate with Politi Sydvestjylland for coastal cordon',
      ],
      handoffTo: ['Søværnet', 'Kystvagten', 'FE'],
    },
  },
};

// Look up the right playbook for a threat.
export function playbookFor(event) {
  const platform = event.platform || 'quadcopter';
  const cls = event.classification || 'unknown';
  const byPlatform = PLAYBOOKS[platform] || PLAYBOOKS.quadcopter;
  return byPlatform[cls] || byPlatform.hostile || byPlatform.unknown || null;
}
