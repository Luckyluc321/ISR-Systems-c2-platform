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
import { contextForSite } from './site_context.js';
import { bareType } from './agents/agent_detection_line.js';

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
  // Still classifying (identification_gate.js): nothing about what it is.
  if (event.identified === false) return `Unidentified track over ${siteName}, classification in progress. `;
  const what = detailed ? (event.droneType || 'Unidentified aircraft') : _whatPlain(event);
  // The subject is capitalised on its own: capitalising the whole lead
  // only reached the confidence word, and read "Probable. five drones".
  const subject = `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
  return `${_confidenceWord(event.confidence)}${subject} over ${siteName}. `;
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

// ── AIRPORTS: HOW AN AIRPORT ACTUALLY PASSES A DRONE REPORT ───────────
//
// Lucas, 2026-10-27, on the messages above at Copenhagen: "AI generated
// as shit. Needs a real comms message for an airport ... choice of words
// that are like an airport". An airport passes a drone report the way it
// passes any traffic information: a header word, then where it is
// against the RUNWAYS, height in FEET, track in three figures and speed
// in KNOTS, and nothing else. No prose, no "passing for awareness".
//
//   DRONE ALERT, DK Airport (probable). Five drones over Runway 04R/22L,
//   400 ft, tracking 270 at 30 kt. Live track on the platform.
//
// Position is measured, never guessed: against both thresholds where the
// site context has them (on the runway, or on the approach beyond a
// threshold), against a runway's centre where it has only that, and
// otherwise against the airport reference point. Distances are rounded
// coarsely enough that the reference point's exact definition does not
// change the words. Still the messenger: no recipient is told what to do.
const _FT = 3.28084, _KT = 1.943844, _NM = 1852;
const _COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

function _airportCtx(siteId) {
  const c = siteId ? contextForSite(siteId) : null;
  return c && /airport/.test(c.site_type || '') && c.airport_reference_point ? c : null;
}
function _en(lat, lon, ref) {
  const mLon = 111320 * Math.cos(ref.lat * Math.PI / 180);
  return { e: (lon - ref.lon) * mLon, n: (lat - ref.lat) * 111320 };
}
const _compass = (e, n) => _COMPASS[Math.round(((Math.atan2(e, n) * 180 / Math.PI + 360) % 360) / 45) % 8];
const _dist = (m) => (m < _NM ? `${Math.max(100, Math.round(m / 100) * 100)} m` : `${(m / _NM).toFixed(1)} NM`);

/** Where the track is, in the words an airport uses. Null with no fix. */
export function airportWhere(ctx, p) {
  if (!ctx || !p || typeof p.lat !== 'number') return null;
  const ref = ctx.airport_reference_point;
  const q = _en(p.lat, p.lon, ref);
  for (const rw of (ctx.critical_areas || []).filter(a => /^runway_/.test(a.id || ''))) {
    const label = `Runway ${rw.id.replace(/^runway_/, '').replace('_', '/')}`;
    if (rw.thresholds?.length === 2) {
      const [ta, tb] = rw.thresholds;
      const A = _en(ta.lat, ta.lon, ref), B = _en(tb.lat, tb.lon, ref);
      const L = Math.hypot(B.e - A.e, B.n - A.n);
      const u = { e: (B.e - A.e) / L, n: (B.n - A.n) / L };
      const along = (q.e - A.e) * u.e + (q.n - A.n) * u.n;
      const lateral = Math.abs((q.e - A.e) * u.n - (q.n - A.n) * u.e);
      if (along >= 0 && along <= L && lateral <= 300) return `over ${label}`;
      // Beyond a threshold and on the centreline: the approach to THAT
      // runway end, since that is the end landing traffic crosses first.
      if (along < 0 && -along <= 15000 && lateral <= 600) return `on the approach to Runway ${ta.id}, ${_dist(-along)} out`;
      if (along > L && along - L <= 15000 && lateral <= 600) return `on the approach to Runway ${tb.id}, ${_dist(along - L)} out`;
    } else if (rw.center) {
      const c = _en(rw.center.lat, rw.center.lon, ref);
      if (Math.hypot(q.e - c.e, q.n - c.n) <= 600) return `near ${label}`;
    }
  }
  const d = Math.hypot(q.e, q.n);
  const inside = typeof p.rangeToPerim === 'number' ? p.rangeToPerim <= 0 : d <= 1500;
  if (inside) return `over the airport, ${_compass(q.e, q.n)} side`;
  return `${_dist(d)} ${_compass(q.e, q.n)} of the airport`;
}

function _airportWhat(event) {
  const n = _countFrom(event.droneType) ?? (typeof event.droneCount === 'number' ? event.droneCount : null);
  if (event.platform === 'missile') return 'One missile';
  const kind = event.platform === 'fixed-wing' ? 'fixed-wing drone' : 'drone';
  if (n && n > 1) { const w = _WORDS[n] || String(n); return `${w.charAt(0).toUpperCase()}${w.slice(1)} ${kind}s`; }
  return `One ${kind}`;
}

function _airportReport(event, siteName, ctx) {
  // Still classifying: no type, no count of "drones", no header that
  // says what it is. Only where it is and how it moves.
  const unidentified = event.identified === false;
  const header = unidentified ? 'UNIDENTIFIED TRACK' : (event.platform === 'missile' ? 'MISSILE ALERT' : 'DRONE ALERT');
  const c = event.confidence;
  const qual = typeof c !== 'number' || c >= 0.85 ? '' : (c >= 0.65 ? ' (probable)' : ' (unconfirmed)');
  const p = event.lastPosition;
  const where = airportWhere(ctx, p);
  let fix = '';
  if (where) {
    const parts = [where];
    if (typeof p.alt === 'number') parts.push(`${Math.max(0, Math.round(p.alt * _FT / 50) * 50).toLocaleString('en-US')} ft`);
    if (typeof p.heading === 'number' && typeof p.speed === 'number') {
      parts.push(p.speed < 1.5
        ? 'hovering'
        : `tracking ${String(((Math.round(p.heading) % 360) + 360) % 360).padStart(3, '0')} at ${Math.round(p.speed * _KT / 5) * 5} kt`);
    }
    fix = ` ${parts.join(', ')}`;
  } else {
    fix = ' at the airport';
  }
  if (unidentified) {
    const at = where ? `${fix.trim().charAt(0).toUpperCase()}${fix.trim().slice(1)}.` : 'At the airport.';
    return { head: `${header}, ${siteName}.`, body: `${at} Classification in progress.` };
  }
  return { head: `${header}, ${siteName}${qual}.`, body: `${_airportWhat(event)}${fix}.` };
}

// What each airport role is told after the report. The tower, the duty
// manager, security and ground ops get the report and the live track:
// what they do with it is theirs. Fire is told for awareness.
// Intelligence gets the type as reported, because that is what it
// assesses.
const _AIRPORT_TAIL = {
  't1-atc':          'Live track on the platform.',
  't1-duty-mgr':     'Live track on the platform.',
  't1-sec-ops':      'Live track on the platform.',
  't1-ground':       'Live track on the platform.',
  't1-fire':         'For your awareness. Live track on the platform.',
  't1-arff':         'For your awareness. Live track on the platform.',
  't2-politi':       'Live track on the platform.',
  't2-trekantbrand': 'For your awareness.',
};

function _airportMessage(dest, suffix, event, siteName, ctx) {
  const { head, body } = _airportReport(event, siteName, ctx);
  // Still classifying: every role gets the same where-and-how-it-moves
  // report and the live track. No role-specific claims (a signature
  // judgement, "drone activity") until the system knows what it is.
  if (event.identified === false) {
    if (dest.type === 'system') {
      const n = String(dest.name || '').toLowerCase();
      if (n.includes('camera') || n.includes('cctv') || n.includes('surveillance')) return 'Slew to the live track. Record continuous.';
      if (n.includes('notam') || n.includes('eurocontrol') || n.includes('network manager')) return `Unidentified track at ${siteName}. ${body}`;
      return `${head} ${body}`;
    }
    return `${head} ${body} Live track on the platform.`;
  }
  if (dest.type === 'system') {
    const n = String(dest.name || '').toLowerCase();
    if (n.includes('camera') || n.includes('cctv') || n.includes('surveillance')) return 'Slew to the live track. Record continuous.';
    if (n.includes('notam') || n.includes('eurocontrol') || n.includes('network manager')) return `Drone activity at ${siteName}. ${body}`;
    return `${head} ${body}`;
  }
  if (suffix === 't2-pet' && event.identified !== false) {
    const type = bareType(event.droneType);
    return `${head} ${body}${type ? ` Type reported: ${type}.` : ''} Signatures do not match commercial traffic.`;
  }
  const tail = _AIRPORT_TAIL[suffix] || BY_SUFFIX[suffix] || 'Live track on the platform.';
  return `${head} ${body} ${tail}`;
}

export function defaultEscalationMessage(dest, event, siteName = 'the site') {
  if (!dest || !event) return '';
  if (event.classification && event.classification !== 'hostile') {
    return _benignMessage(event, siteName);
  }
  const suffix = String(dest.id || '').replace(/^[a-z_]+-/, '');
  const airport = _airportCtx(event.siteId);
  if (airport) return _airportMessage(dest, suffix, event, siteName, airport);
  // Still classifying (identification_gate.js): the same neutral line
  // for every recipient, no role-specific claims until it is known.
  if (event.identified === false) {
    if (dest.type === 'system') {
      const n = String(dest.name || '').toLowerCase();
      if (n.includes('camera') || n.includes('cctv') || n.includes('surveillance')) return 'Slew to the live track. Record continuous.';
      return `Unidentified track flagged on the operations feed. ${siteName}.`;
    }
    return `${_situation(event, siteName, false)}Live track on the shared view.`;
  }
  if (dest.type === 'system') return _systemMessage(dest, event, siteName);

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
