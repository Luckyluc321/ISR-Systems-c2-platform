// Default escalation message, per recipient.
//
// An escalation used to arrive carrying nothing but the payload. The
// operator message box is optional and usually left empty, so the
// receiving team saw a notification with no words in it. A duty manager
// opening that has to reconstruct what is being asked of them from an
// evidence pack.
//
// This writes the line that should have been there. Each recipient gets
// what the event means FOR THEM and what is actually being asked. The
// air traffic tower is asked to hold traffic. Intelligence is told what
// the emitters look like. The NOTAM system gets an airspace advisory.
// None of them get the same sentence.
//
// WHAT THIS IS NOT. The operator's own message always wins. This only
// fills the gap when the box was left blank, and it is a draft in the
// operator's voice, not the platform speaking for them.
//
// TONE, AND WHY IT CHANGES WITH THE RECIPIENT. ISR reports, the
// authorities decide. A message to the site's own teams can be
// directive, because the operator runs that organisation. A message to
// the police, to intelligence or to defence states what was observed
// and requests, it does not instruct. That line is deliberate and
// should not be smoothed over into one uniform register.

// HOW AN AIRPORT ACTUALLY TALKS.
//
// The first version of this read like a briefing memo: "Notifying for
// intelligence awareness", "this is precautionary while the airspace is
// contested". Nobody on a radio or an ops phone says that. Real traffic
// is short, leads with the fact, names the ask, and stops.
//
// Rewritten in that register. Fragments are correct here. The absence of
// hedging is correct here. A duty manager at 02:00 wants to know what is
// happening and what you want from them, in that order, in one breath.
function _confidenceWord(conf) {
  // Only said when it is NOT certain. "Confirmed detection" as a prefix
  // on every message is padding; ops assume confirmed unless told.
  if (typeof conf !== 'number') return '';
  if (conf >= 0.85) return '';
  if (conf >= 0.65) return 'Probable. ';
  return 'Unconfirmed. ';
}

// WHO NEEDS THE MODEL NAMES AND WHO DOES NOT.
//
// A tower controller says "five drones over the field". They do not say
// "4x Sibiryachok-5 + 1x DJI Mavic 3 (recon formation)", and handing
// them that is the analyst's register leaking into an operational call.
//
// Intelligence recipients are the opposite case: the airframe types ARE
// the message, because that is what they assess. So the head is written
// for the reader rather than once for everyone.
const _WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function _countFrom(droneType) {
  const hits = String(droneType || '').match(/(\d+)\s*x/gi);
  if (!hits) return null;
  return hits.reduce((n, h) => n + parseInt(h, 10), 0);
}
function _whatPlain(event) {
  const n = _countFrom(event.droneType);
  if (n && n > 1) return `${_WORDS[n] || n} drones`;
  if (event.platform === 'quadcopter' || /drone|quad|mavic|matrice/i.test(event.droneType || '')) return 'A drone';
  return event.droneType || 'An unidentified aircraft';
}
function _situation(event, siteName, detailed) {
  const what = detailed ? (event.droneType || 'Unidentified aircraft') : _whatPlain(event);
  const lead = `${_confidenceWord(event.confidence)}${what}`;
  // Capitalised here rather than in every table entry, because the word
  // that lands first changes with the reader.
  return `${lead.charAt(0).toUpperCase()}${lead.slice(1)} over ${siteName}. `;
}

// The recipients who assess airframes rather than respond to them.
const _WANTS_MODELS = new Set(['t2-pet', 't3-fe', 't3-cta', 't3-nc3', 't4-forsvar']);

// Keyed on the id suffix, which is stable across sites: cph-t1-atc and
// billund-t1-atc both end in t1-atc.
const BY_SUFFIX = {
  't1-atc':      'Request ground stop on arrivals and departures. Inbounds to hold or divert.',
  't1-duty-mgr': 'Runway status is your call. Recommend ops room.',
  't1-sec-ops':  'Patrols to the affected sector. Live track is on the shared view.',
  't1-fire':     'Crews to standby. No response required unless we get a ground impact.',
  't1-ground':   'Stop vehicle movement on the manoeuvring area until we call it clear.',
  't2-politi':   'Request patrol response to the perimeter. Position and heading are in the brief.',
  't2-pet':      'Signatures do not match commercial traffic. Passing for your awareness.',
  't3-rigspoliti': 'Local district already engaged. Passing for national coordination.',
  't3-fe':       'Coordinated flight profile, no library match on the link. Request assessment.',
  't3-cta':      'Pattern, timing and target selection are in the pack. Request assessment.',
  't3-cfcs':     'No cyber indicators seen. Passing in case it correlates with your reporting.',
  't3-nc3':      'Passing in case the emitter signature matches anything you hold.',
  't3-beredskab':'No assistance required at this stage. Passing for readiness.',
  't4-forsvar':  'Track and emitter signatures are in the pack.',
  't5-stm':      'Critical infrastructure affected. Local response running.',
};

// Systems are machines. They get an instruction.
function _systemMessage(dest, event, siteName) {
  const n = String(dest.name || '').toLowerCase();
  if (n.includes('notam') || n.includes('eurocontrol')) {
    return `NOTAM request. ${siteName}, drone activity in the vicinity. Runway unavailable until further notice.`;
  }
  if (n.includes('camera') || n.includes('surveillance')) {
    return 'Slew to the live track. Record continuous.';
  }
  return `Drone activity flagged on the operations feed. ${siteName}.`;
}

// A friendly or stood-down track is still escalated sometimes, for the
// record. It must not read like an incursion.
function _benignMessage(event, siteName) {
  if (event.classification === 'friendly') {
    return `Authorised flight over ${siteName}. Logged, no action.`;
  }
  return `Track over ${siteName} assessed and stood down. Logged, no action.`;
}

export function defaultEscalationMessage(dest, event, siteName = 'the site') {
  if (!dest || !event) return '';
  if (event.classification && event.classification !== 'hostile') {
    return _benignMessage(event, siteName);
  }
  if (dest.type === 'system') return _systemMessage(dest, event, siteName);

  const suffix = String(dest.id || '').replace(/^[a-z_]+-/, '');
  const head = _situation(event, siteName, _WANTS_MODELS.has(suffix));
  const body = BY_SUFFIX[suffix];
  if (body) return `${head}${body}`;

  const byTier = {
    1: 'Site response requested.',
    2: 'Request response and coordination.',
    3: 'Passing for national awareness.',
    4: 'Passing for the air picture.',
    5: 'National notification.',
  };
  return `${head}${byTier[dest.tier] || 'Passing for awareness.'}`;
}
