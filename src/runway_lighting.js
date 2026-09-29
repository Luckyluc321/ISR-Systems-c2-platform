// ═══════════════════════════════════════════════════════════════════
// Runway lighting — ICAO Annex 14 geometry generator
// ───────────────────────────────────────────────────────────────────
// Produces the individual lamp positions for a runway from its two
// threshold coordinates, using the geometry ICAO Annex 14 specifies. This
// is why an AIP-sourced airport is achievable without a per-lamp dataset:
// aviation lighting is standardised, so precise anchors plus the standard
// yield every light position.
//
// Anchors today come from the baked OSM runway centrelines, which are
// accurate to a few metres. The upgrade path is AIP threshold coordinates
// and declared ALS type dropping into the same `runwayFromCentreline`
// input — the generator does not change, only the anchor precision and
// the ALS flags do.
//
// Colours are the real ones, which is most of what makes an airport read
// correctly at night:
//   threshold  green      runway end  red
//   edge       white, amber over the final 600 m
//   centreline white, alternating red/white 900-300 m out, red final 300 m
//   TDZ        white barrettes
//   approach   white bars extending beyond the threshold
//   PAPI       white/red pair set
// ═══════════════════════════════════════════════════════════════════

const M_PER_DEG_LAT = 111_320;
const mPerDegLon = lat => 111_320 * Math.cos((lat * Math.PI) / 180);

// Annex 14 spacings, metres.
const EDGE_SPACING = 60;
const CENTRELINE_SPACING = 15;
const TDZ_SPACING = 30;
const TDZ_LENGTH = 900;
const APPROACH_SPACING = 30;
const APPROACH_LENGTH = 900;
const APPROACH_CROSSBAR_AT = 300;
const APPROACH_CROSSBAR_HALF_WIDTH = 15;
const PAPI_FROM_THRESHOLD = 300;
const PAPI_LATERAL = 20;
const PAPI_UNIT_SPACING = 9;

export const RUNWAY_LIGHT_COLORS = {
  edge:       '#fff6e6',
  edgeAmber:  '#ffc04d',
  threshold:  '#3dff7a',
  end:        '#ff3b30',
  centreline: '#fff6e6',
  centreRed:  '#ff3b30',
  tdz:        '#fff6e6',
  approach:   '#fff0d0',
  papiWhite:  '#ffffff',
  papiRed:    '#ff3b30',
  // Annex 14 Ch.5 taxiway lighting. Blue edge lighting is the single most
  // recognisable airport-at-night cue there is; green centreline lighting
  // is what a crew actually follows.
  taxiEdge:   '#2f7dff',
  taxiCentre: '#25e06a',
  // Annex 14 Ch.6 obstacle lighting — steady red on fixed structures.
  obstacle:   '#ff2a20',
};

const TAXI_EDGE_SPACING = 45;
const TAXI_CENTRE_SPACING = 25;

// Taxiway lighting from a centreline. Blue edge lights either side, green
// centreline lights along it. Same Annex 14 basis as the runway generator.
export function taxiwayFromCentreline(flat, opts = {}) {
  const lights = [];
  if (!flat || flat.length < 4) return lights;
  const halfWidth = (opts.widthM ?? 23) / 2;

  for (let i = 0; i < flat.length - 2; i += 2) {
    const aLat = flat[i], aLon = flat[i + 1];
    const bLat = flat[i + 2], bLon = flat[i + 3];
    const mLon = mPerDegLon((aLat + bLat) / 2);
    const dE = (bLon - aLon) * mLon;
    const dN = (bLat - aLat) * M_PER_DEG_LAT;
    const segLen = Math.hypot(dE, dN);
    if (segLen < 1) continue;
    const hdg = { e: dE / segLen, n: dN / segLen };

    for (let d = 0; d < segLen; d += TAXI_EDGE_SPACING) {
      push(lights, offset(aLat, aLon, d, halfWidth, hdg), 'taxiEdge');
      push(lights, offset(aLat, aLon, d, -halfWidth, hdg), 'taxiEdge');
    }
    for (let d = 0; d < segLen; d += TAXI_CENTRE_SPACING) {
      push(lights, offset(aLat, aLon, d, 0, hdg), 'taxiCentre');
    }
  }
  return lights;
}

export function taxiwayLightsForSite(polylines, opts = {}) {
  const all = [];
  for (const flat of polylines || []) all.push(...taxiwayFromCentreline(flat, opts));
  return all;
}

function offset(lat, lon, alongM, acrossM, hdg) {
  // hdg is the unit vector along the runway in local metres.
  const dxE = hdg.e * alongM + hdg.n * acrossM;   // perpendicular = (n, -e)
  const dyN = hdg.n * alongM - hdg.e * acrossM;
  return {
    lat: lat + dyN / M_PER_DEG_LAT,
    lon: lon + dxE / mPerDegLon(lat),
  };
}

function push(out, p, type) {
  out.push({ lat: p.lat, lon: p.lon, type });
}

// centreline: flat [lat,lon,lat,lon,...] of a runway, both ends being
// thresholds. Returns [{lat, lon, type}].
export function runwayFromCentreline(flat, opts = {}) {
  const lights = [];
  if (!flat || flat.length < 4) return lights;

  const aLat = flat[0], aLon = flat[1];
  const bLat = flat[flat.length - 2], bLon = flat[flat.length - 1];

  const mLon = mPerDegLon((aLat + bLat) / 2);
  const dE = (bLon - aLon) * mLon;
  const dN = (bLat - aLat) * M_PER_DEG_LAT;
  const length = Math.hypot(dE, dN);
  if (length < (opts.minLengthM ?? 1200)) return lights;

  const hdg = { e: dE / length, n: dN / length };
  const halfWidth = (opts.widthM ?? 45) / 2;
  // Approach lighting is OFF. Annex 14 puts it 900 m beyond each threshold,
  // which is real — but it renders as lit strips lying across fields,
  // housing and open water outside the aerodrome boundary, which is not
  // what this map is for. Every generated lamp now stays within the runway
  // itself. Opt in per runway only if an aerodrome's approach lighting is
  // genuinely wanted.
  const withApproach = opts.approach === true;

  // ── Edge lights, both sides. Amber over the final 600 m in each
  // direction, which is the real cue that the end is coming up.
  for (let d = 0; d <= length; d += EDGE_SPACING) {
    const amber = d > length - 600 || d < 600;
    const type = amber ? 'edgeAmber' : 'edge';
    push(lights, offset(aLat, aLon, d, halfWidth, hdg), type);
    push(lights, offset(aLat, aLon, d, -halfWidth, hdg), type);
  }

  // ── Centreline. White, then alternating red/white from 900 m to 300 m
  // remaining, then solid red for the last 300 m — in both directions,
  // since a runway is used from both ends.
  for (let d = 0; d <= length; d += CENTRELINE_SPACING) {
    const remaining = Math.min(d, length - d);
    let type = 'centreline';
    if (remaining < 300) type = 'centreRed';
    else if (remaining < 900) type = (Math.round(d / CENTRELINE_SPACING) % 2 === 0) ? 'centreRed' : 'centreline';
    push(lights, offset(aLat, aLon, d, 0, hdg), type);
  }

  // ── Threshold (green) and end (red) bars at both ends.
  for (let x = -halfWidth; x <= halfWidth; x += 3) {
    push(lights, offset(aLat, aLon, 0, x, hdg), 'threshold');
    push(lights, offset(aLat, aLon, length, x, hdg), 'threshold');
    push(lights, offset(aLat, aLon, 2, x, hdg), 'end');
    push(lights, offset(aLat, aLon, length - 2, x, hdg), 'end');
  }

  // ── Touchdown zone barrettes, first 900 m from each threshold.
  for (const from of [0, 1]) {
    for (let d = 150; d <= TDZ_LENGTH; d += TDZ_SPACING) {
      const along = from === 0 ? d : length - d;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          push(lights, offset(aLat, aLon, along, side * (5 + i * 1.5), hdg), 'tdz');
        }
      }
    }
  }

  // ── Approach lighting, extending OUT beyond each threshold. This is the
  // part that reads as a real airport from the air: bars running out over
  // whatever is off the end, with a crossbar at 300 m.
  if (withApproach) {
    for (const from of [0, 1]) {
      const sign = from === 0 ? -1 : 1;
      const base = from === 0 ? 0 : length;
      for (let d = APPROACH_SPACING; d <= APPROACH_LENGTH; d += APPROACH_SPACING) {
        const along = base + sign * d;
        for (let i = -2; i <= 2; i++) {
          push(lights, offset(aLat, aLon, along, i * 2.0, hdg), 'approach');
        }
        if (Math.abs(d - APPROACH_CROSSBAR_AT) < 1) {
          for (let x = -APPROACH_CROSSBAR_HALF_WIDTH; x <= APPROACH_CROSSBAR_HALF_WIDTH; x += 3) {
            push(lights, offset(aLat, aLon, along, x, hdg), 'approach');
          }
        }
      }
    }
  }

  // ── PAPI, four units per approach direction, left side.
  for (const from of [0, 1]) {
    const sign = from === 0 ? 1 : -1;
    const base = from === 0 ? 0 : length;
    const along = base + sign * PAPI_FROM_THRESHOLD;
    for (let i = 0; i < 4; i++) {
      const across = -(PAPI_LATERAL + i * PAPI_UNIT_SPACING) * (from === 0 ? 1 : -1);
      push(lights, offset(aLat, aLon, along, across, hdg), i < 2 ? 'papiWhite' : 'papiRed');
    }
  }

  return lights;
}

// OSM splits a single runway across several ways — CPH's 12/30 is three
// separate ways. Treating each as a complete runway puts thresholds in the
// MIDDLE of the real runway and projects approach lighting outward from
// there, straight across whatever is beside it. Fragments are therefore
// joined end-to-end first, so a generated runway's ends are its real ends.
const JOIN_TOLERANCE_M = 80;

function endpoints(flat) {
  return {
    a: [flat[0], flat[1]],
    b: [flat[flat.length - 2], flat[flat.length - 1]],
  };
}

function distM(p, q) {
  const mLon = mPerDegLon((p[0] + q[0]) / 2);
  return Math.hypot((q[1] - p[1]) * mLon, (q[0] - p[0]) * M_PER_DEG_LAT);
}

export function mergeRunwayFragments(polylines, tolM = JOIN_TOLERANCE_M) {
  const pending = (polylines || []).filter(f => Array.isArray(f) && f.length >= 4).map(f => f.slice());
  const merged = [];

  while (pending.length) {
    let cur = pending.shift();
    let joined = true;
    while (joined) {
      joined = false;
      for (let i = 0; i < pending.length; i++) {
        const cand = pending[i];
        const c = endpoints(cur);
        const d = endpoints(cand);
        if (distM(c.b, d.a) <= tolM) { cur = cur.concat(cand.slice(2)); }
        else if (distM(c.b, d.b) <= tolM) { cur = cur.concat(reverseFlat(cand).slice(2)); }
        else if (distM(c.a, d.b) <= tolM) { cur = cand.concat(cur.slice(2)); }
        else if (distM(c.a, d.a) <= tolM) { cur = reverseFlat(cand).concat(cur.slice(2)); }
        else continue;
        pending.splice(i, 1);
        joined = true;
        break;
      }
    }
    merged.push(cur);
  }
  return merged;
}

function reverseFlat(flat) {
  const out = [];
  for (let i = flat.length - 2; i >= 0; i -= 2) out.push(flat[i], flat[i + 1]);
  return out;
}

// Generate lighting for every runway centreline in a baked site file.
export function runwayLightsForSite(runwayPolylines, opts = {}) {
  const all = [];
  for (const flat of mergeRunwayFragments(runwayPolylines)) {
    all.push(...runwayFromCentreline(flat, opts));
  }
  return all;
}
