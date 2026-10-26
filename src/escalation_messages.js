// Default escalation message, per recipient.
//
// An escalation used to arrive carrying nothing but the payload. The
// operator message box is optional and usually left empty, so the
// receiving team saw a notification with no words in it. A duty manager
// opening that has to reconstruct what is being asked of them from an
// evidence pack.
//
// This writes the line that should have been there. Each recipient gets
// what the event means FOR THEM and where to find it. The tower is told
// the live track is up and the traffic call is theirs. Intelligence is
// told the signatures are in the pack. None of them get the same
// sentence, and none of them is told what to do.
//
// WHAT THIS IS NOT. The operator's own message always wins. This only
// fills the gap when the box was left blank, and it is a draft in the
// operator's voice, not the platform speaking for them.
//
// THE MESSENGER, NOT THE DECISION MAKER (Lucas, 2026-10-26). This used
// to let messages to the site's own teams be directive ("Request ground
// stop. Inbounds to hold or divert", "Runway unavailable until further
// notice", "Stop vehicle movement") and let others carry claims the
// platform cannot back ("Local district already engaged", "No cyber
// indicators seen", "No assistance required at this stage"). Every one
// of those is a decision or a judgement that belongs to the recipient.
// Now every message states what was observed and where to find it, and
// leaves the decision with the reader. What still changes with the
// recipient is what they need to know, not whether they are told what
// to do. check:escalation-flow [messages] holds it.

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
  't1-atc':      'Live track on the shared view. Traffic decisions are yours.',
  't1-duty-mgr': 'Live track on the shared view. Runway status is your call.',
  't1-sec-ops':  'Live track on the shared view. Position and heading are in the brief.',
  't1-fire':     'Passing for readiness. Position and heading are in the brief.',
  't1-ground':   'Passing for the manoeuvring area. Position and heading are in the brief.',
  't2-politi':   'Position and heading are in the brief. Live track on the shared view.',
  't2-pet':      'Signatures do not match commercial traffic. Passing for your awareness.',
  't3-rigspoliti': 'Passing for national coordination.',
  't3-fe':       'Track and emitter signatures are in the pack. Passing for assessment.',
  't3-cta':      'Track history and timing are in the pack. Passing for assessment.',
  't3-cfcs':     'Passing in case it correlates with your reporting.',
  't3-nc3':      'Passing in case the emitter signature matches anything you hold.',
  't3-beredskab':'Passing for readiness.',
  't4-forsvar':  'Track and emitter signatures are in the pack.',
  't5-stm':      'Detection over critical infrastructure. Passing for national awareness.',
};

// Systems are machines, and the site's own. The camera system still
// gets an instruction: pointing a camera at a track is sensing, not a
// response. A NOTAM is an airspace decision, so the NOTAM system is told
// what was seen and nothing more.
function _systemMessage(dest, event, siteName) {
  const n = String(dest.name || '').toLowerCase();
  if (n.includes('notam') || n.includes('eurocontrol')) {
    return `${siteName}, drone activity in the vicinity. Position and heading in the brief.`;
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
    1: 'Passing for site awareness. Live track on the shared view.',
    2: 'Position and heading are in the brief. Passing for your decision.',
    3: 'Passing for national awareness.',
    4: 'Passing for the air picture.',
    5: 'National notification.',
  };
  return `${head}${byTier[dest.tier] || 'Passing for awareness.'}`;
}
