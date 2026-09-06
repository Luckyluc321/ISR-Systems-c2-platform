// ═══════════════════════════════════════════════════════════════════
// Cooperative Traffic Reconciler — deterministic classification input
// ───────────────────────────────────────────────────────────────────
// Given an event + its site context, queries the site's registered
// cooperative-traffic adapter, matches sensor detection against known
// cooperative tracks (spatial + temporal + class compatibility), and
// returns a structured result plus a formatted signal block that
// Agent B / Agent 3 can inject into their prompt.
//
// Detection-only stance: this layer ONLY produces evidence. It does
// not decide to alert or suppress — it hands the evidence to the LLM
// so the narrative is grounded in truth. Classification-collapse to
// 'friendly' on strong matches is out of MVP scope (would require
// event-lifecycle intervention); this MVP is the SIGNAL-BLOCK path,
// which is where the second-order value ("no match = strong non-
// cooperative signal") lives anyway.
//
// Full design: docs/agentic-cooperative-traffic-fusion-architecture.md
// ═══════════════════════════════════════════════════════════════════

import { getCooperativeAdapter } from './cooperative_traffic_source.js';

// ── Distance + time helpers ────────────────────────────────────────
function _haversineM(a, b) {
  const R = 6378137;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
  const A = s1 * s1 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * s2 * s2;
  return 2 * R * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
}

function _tDeltaSec(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.abs(ta - tb) / 1000;
}

// ── Class-compatibility matrix ─────────────────────────────────────
// Sensor-inferred platform vs cooperative-track klass. Drones are
// never cooperative (they don't broadcast ADS-B / carry transponders),
// so a sensor detection of "quadcopter" or "fixed_wing" small drone
// class is incompatible with any real cooperative track — treat as
// no match regardless of spatial + temporal proximity.
const _DRONE_PLATFORM_TOKENS = ['quadcopter', 'hexacopter', 'octocopter', 'racing_drone', 'fpv', 'fixed_wing_uav', 'uav'];

function _isDroneLike(platform) {
  if (!platform) return false;
  const p = String(platform).toLowerCase();
  return _DRONE_PLATFORM_TOKENS.some(t => p.includes(t));
}

function _classCompatible(sensorPlatform, coopKlass) {
  if (_isDroneLike(sensorPlatform)) return false;   // drones never cooperative
  if (!coopKlass || coopKlass === 'unknown') return true;   // unknown coop = permissive
  if (!sensorPlatform) return true;
  const sp = String(sensorPlatform).toLowerCase();
  if (coopKlass === 'helicopter_civilian' || coopKlass === 'helicopter_military') {
    return sp.includes('helicopter') || sp.includes('rotorcraft');
  }
  if (coopKlass === 'fixed_wing_commercial' || coopKlass === 'fixed_wing_military') {
    return sp.includes('fixed_wing') || sp.includes('airliner') || sp.includes('fixed-wing');
  }
  return true;
}

// ── bbox around a site ────────────────────────────────────────────
function _bboxAround(center, paddingDeg) {
  return {
    minLat: center.lat - paddingDeg,
    minLon: center.lon - paddingDeg,
    maxLat: center.lat + paddingDeg,
    maxLon: center.lon + paddingDeg,
  };
}

// ── Match scoring ─────────────────────────────────────────────────
function _scoreMatch(eventPos, eventTime, sensorPlatform, track, cfg) {
  // Class gate first — a mismatch is a hard reject.
  if (!_classCompatible(sensorPlatform, track.klass)) {
    return { score: 0, rejected_by: 'class_incompatible' };
  }
  const dist = _haversineM(eventPos, track);
  if (dist > cfg.match_radius_m) {
    return { score: 0, rejected_by: 'outside_radius', distanceM: dist };
  }
  const dt = _tDeltaSec(eventTime, track.timestamp);
  if (dt > cfg.match_time_window_s) {
    return { score: 0, rejected_by: 'outside_time_window', dtSec: dt };
  }
  // Linear decay on both axes. Combined score is the product so both
  // axes must be strong for a match; either being borderline collapses
  // the score.
  const spatial = 1 - (dist / cfg.match_radius_m);
  const temporal = 1 - (dt / cfg.match_time_window_s);
  return { score: spatial * temporal, distanceM: dist, dtSec: dt };
}

// ── Public API ────────────────────────────────────────────────────
export async function checkCooperativeTraffic(event, siteContext, opts = {}) {
  const cfg = siteContext?.cooperative_traffic;
  if (!cfg) return null;
  if (cfg.expected === false && cfg.source === 'none') return null;
  if (cfg.source === 'none') return null;

  const adapter = getCooperativeAdapter(cfg.source);
  if (!adapter) {
    return {
      checked: false,
      status: 'adapter_missing',
      adapter_name: cfg.source,
      formatted_block: _formatBlock({ status: 'adapter_missing', cfg }),
    };
  }

  // Anchor coord lookup — accepts any of the site-type-specific
  // reference-point fields we've adopted so far. Add new ones here
  // when new site types come online (e.g. grid_reference_point).
  // Falls back to the first critical_area centroid so opting-in sites
  // that forgot to declare an anchor still work degradedly.
  const anchor = siteContext.airport_reference_point
    || siteContext.port_reference_point
    || siteContext.substation_reference_point
    || siteContext.critical_areas?.[0]?.center
    || (typeof opts.fallbackAnchor === 'object' ? opts.fallbackAnchor : null);
  if (!anchor) {
    return {
      checked: false,
      status: 'no_site_anchor',
      formatted_block: _formatBlock({ status: 'no_site_anchor', cfg }),
    };
  }

  const eventPos = _eventPos(event);
  const eventTime = event.startTime || event.lastUpdated || new Date().toISOString();
  if (!eventPos) {
    return {
      checked: false,
      status: 'no_event_position',
      formatted_block: _formatBlock({ status: 'no_event_position', cfg }),
    };
  }

  const paddingDeg = cfg.bbox_padding_deg ?? 0.15;
  const bbox = _bboxAround(anchor, paddingDeg);

  let tracks = [];
  let feedStatus = 'live';
  try {
    tracks = await adapter.getActiveTracks(bbox, cfg.match_time_window_s ?? 4);
  } catch (err) {
    feedStatus = `error: ${err.message}`;
  }

  const scored = tracks.map(t => ({
    track: t,
    ...(_scoreMatch(eventPos, eventTime, event.platform, t, {
      match_radius_m: cfg.match_radius_m ?? 800,
      match_time_window_s: cfg.match_time_window_s ?? 4,
    })),
  }));

  const matches = scored
    .filter(s => s.score >= (cfg.match_score_threshold ?? 0.75))
    .sort((a, b) => b.score - a.score);

  return {
    checked: true,
    status: 'ok',
    adapter_name: cfg.source,
    feed_status: feedStatus,
    site_expects_traffic: cfg.expected === true,
    tracks_in_window: tracks.length,
    matches,
    match_count: matches.length,
    formatted_block: _formatBlock({
      status: 'ok',
      cfg,
      feed_status: feedStatus,
      tracks_in_window: tracks.length,
      matches,
      site_expects_traffic: cfg.expected === true,
    }),
  };
}

function _eventPos(event) {
  const p = event.lastPosition || event.entry;
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') return null;
  return { lat: p.lat, lon: p.lon };
}

// ── Prompt block formatter ────────────────────────────────────────
// Formats one of four cases the LLM might see:
//   1. status=ok, matches>0        → matched, likely friendly
//   2. status=ok, matches=0, expected=true  → strong non-cooperative signal
//   3. status=ok, matches=0, expected=false → weak signal, note only
//   4. status=error/missing        → tell the model the check couldn't run
function _formatBlock(state) {
  const lines = ['COOPERATIVE TRAFFIC CROSS-CHECK', '─────────────────────────────────'];
  if (state.status === 'adapter_missing') {
    lines.push(`Configured source "${state.cfg?.source}" not registered. Cross-check unavailable.`);
    return lines.join('\n');
  }
  if (state.status === 'no_site_anchor') {
    lines.push('No site anchor coordinates available. Cross-check unavailable.');
    return lines.join('\n');
  }
  if (state.status === 'no_event_position') {
    lines.push('No event position available. Cross-check unavailable.');
    return lines.join('\n');
  }
  if (state.feed_status && state.feed_status !== 'live') {
    lines.push(`Feed status: ${state.feed_status}. Check inconclusive.`);
    return lines.join('\n');
  }
  const expectedLine = state.site_expects_traffic
    ? 'Site expectation: cooperative traffic normally present.'
    : 'Site expectation: cooperative traffic NOT normally present at this site.';
  lines.push(expectedLine);
  lines.push(`Feed status: live (${state.tracks_in_window} cooperative track${state.tracks_in_window === 1 ? '' : 's'} in site bubble at detection time).`);

  if (state.matches.length > 0) {
    lines.push(`Match result: ${state.matches.length} track${state.matches.length === 1 ? '' : 's'} compatible with observed class + trajectory:`);
    for (const m of state.matches.slice(0, 3)) {
      const cs = m.track.callsign || m.track.icao24 || 'unidentified';
      const dist = Math.round(m.distanceM);
      const dt = Math.round(m.dtSec);
      lines.push(`  - ${cs} (${m.track.klass}, ${dist}m away, ${dt}s offset, score ${m.score.toFixed(2)})`);
    }
    lines.push('Confidence uplift on FRIENDLY / cooperative classification: HIGH.');
  } else {
    lines.push('Match result: 0 cooperative tracks compatible with observed class + trajectory.');
    if (state.site_expects_traffic) {
      lines.push('Confidence uplift on NON-cooperative hypothesis: HIGH (site normally sees cooperative traffic).');
    } else {
      lines.push('Confidence uplift on non-cooperative hypothesis: NONE (site does not normally see cooperative traffic — absence tells us nothing).');
    }
  }

  return lines.join('\n');
}
