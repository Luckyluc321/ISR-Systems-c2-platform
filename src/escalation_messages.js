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

// How confident, in words. A number belongs in the evidence pack, not
// in the first line someone reads at two in the morning.
function _confidenceWord(conf) {
  if (typeof conf !== 'number') return 'Detection';
  if (conf >= 0.85) return 'Confirmed detection';
  if (conf >= 0.65) return 'Probable detection';
  return 'Low confidence detection';
}

function _situation(event, siteName) {
  const what = event.droneType || 'Unidentified airborne platform';
  return `${_confidenceWord(event.confidence)}. ${what} over ${siteName}.`;
}

// Keyed on the id suffix, which is stable across sites: cph-t1-atc and
// billund-t1-atc both end in t1-atc.
const BY_SUFFIX = {
  't1-atc':      'Hold arrivals and departures. Divert inbound traffic to the alternate until the airspace is confirmed clear.',
  't1-duty-mgr': 'Stand up the operations room and take the operational decision on runway status.',
  't1-sec-ops':  'Ground response to the affected sector. Live track and contributing sensors are on the shared view.',
  't1-fire':     'Stage crews at readiness. No deployment requested yet, this is precautionary while the airspace is contested.',
  't1-ground':   'Hold airside vehicle movement in the affected sector until the track is clear of the manoeuvring area.',
  't2-politi':   'Requesting ground response and perimeter support. Last confirmed position and heading are in the brief.',
  't2-pet':      'Notifying for intelligence awareness. Emitter profile and formation behaviour are in the evidence pack.',
  't3-rigspoliti': 'Notifying national police coordination. Local district has been escalated to in parallel.',
  't3-fe':       'Requesting assessment. The emitters do not match the civil library and the flight profile is coordinated.',
  't3-cta':      'Requesting threat assessment. Pattern, timing and target selection are in the evidence pack.',
  't3-cfcs':     'Notifying for awareness. No cyber indicators observed, sharing in case it correlates with other reporting.',
  't3-nc3':      'Notifying for awareness in case the emitter signature correlates with existing reporting.',
  't3-beredskab':'Notifying for readiness. No assistance requested at this stage.',
  't4-forsvar':  'Sharing the air picture. Track, emitter profile and confirmed positions are in the evidence pack.',
  't5-stm':      'National notification. Critical infrastructure affected, operational response is under way locally.',
};

// Systems are machines. They get an instruction, not a briefing.
function _systemMessage(dest, event, siteName) {
  const n = String(dest.name || '').toLowerCase();
  if (n.includes('notam') || n.includes('eurocontrol')) {
    return `Airspace advisory. Requesting NOTAM for the affected zone at ${siteName} until the track is cleared.`;
  }
  if (n.includes('camera') || n.includes('surveillance')) {
    return 'Slew to the reported track and begin recording. Coordinates follow the live position.';
  }
  return `Airspace event at ${siteName}. Flagging on the operations feed.`;
}

// A friendly or stood-down track is still escalated sometimes, for the
// record. It must not read like an incursion.
function _benignMessage(event, siteName) {
  if (event.classification === 'friendly') {
    return `Authorised flight over ${siteName}. Logged for the record, no action requested.`;
  }
  return `Track over ${siteName} assessed and stood down. Logged for the record, no action requested.`;
}

export function defaultEscalationMessage(dest, event, siteName = 'the site') {
  if (!dest || !event) return '';
  if (event.classification && event.classification !== 'hostile') {
    return _benignMessage(event, siteName);
  }
  const head = _situation(event, siteName);
  if (dest.type === 'system') return _systemMessage(dest, event, siteName);

  const suffix = String(dest.id || '').replace(/^[a-z_]+-/, '');
  const body = BY_SUFFIX[suffix];
  if (body) return `${head} ${body}`;

  // Unmapped destination: say something true rather than nothing. The
  // tier is the only thing known about it, so the ask scales with that.
  const byTier = {
    1: 'Site response requested.',
    2: 'Requesting response and coordination.',
    3: 'Notifying for national awareness and assessment.',
    4: 'Sharing for the air picture.',
    5: 'National notification.',
  };
  return `${head} ${byTier[dest.tier] || 'Notifying for awareness.'}`;
}
