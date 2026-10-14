// Drone playback engine
// Multiple concurrent tracks. Each spawns dynamically (via button click), plays
// once through its trajectory, then closes. Real detection pipeline will replace
// this module with a WebSocket subscription that streams the same update shape.

// Time comes from the simulation clock, never the browser's. A track's
// position is a pure function of elapsed time, so freezing that clock
// freezes the track exactly and resuming continues from the same point.
// See sim_clock.js for why there are two readers.
import { monoNow } from './sim_clock.js';

// ── Trajectory templates ──
// Each template is a full flight path (list of waypoints). Spawn wraps it into
// a live track with startTime = now.

export const TEMPLATES = {
  cph_quad_hostile: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'high',
    platform: 'quadcopter',
    droneType: 'DJI Matrice 300',
    confidence: 0.87,
    confidenceTrend: 'Steady climb 0.42 to 0.87',
    contributingSensors: [
      { id: 'N16', confidence: 0.91 },   // Central Apron, closest to trajectory
      { id: 'N17', confidence: 0.82 },   // Central E Airside
      { id: 'N20', confidence: 0.74 },   // N Central Airside (loiter zone)
      { id: 'N09', confidence: 0.68 },   // S W Airside (entry approach)
      { id: 'N11', confidence: 0.00, offline: true }, // S Central Airside, offline (would be contributing)
    ],
    evidence: { rfCarrier: '2.412 GHz', rfBandwidth: '20 MHz OFDM', rfMatch: 'OcuSync 91%', modality: 'RF + acoustic', evidenceSize: '24.7 MB' },
    waypoints: [
      { lat: 55.60100, lon: 12.66980, alt: 120, heading: 285, tSec: 0   },
      { lat: 55.60420, lon: 12.66400, alt: 110, heading: 285, tSec: 8   },
      { lat: 55.60750, lon: 12.65950, alt: 100, heading: 285, tSec: 16  },
      { lat: 55.61120, lon: 12.65760, alt: 95,  heading: 300, tSec: 24  },
      { lat: 55.61420, lon: 12.65210, alt: 82,  heading: 285, tSec: 34  },
      { lat: 55.61650, lon: 12.64700, alt: 78,  heading: 260, tSec: 42  },
      { lat: 55.61550, lon: 12.64200, alt: 75,  heading: 220, tSec: 50  },
      { lat: 55.61000, lon: 12.64400, alt: 78,  heading: 175, tSec: 58  },
      { lat: 55.60500, lon: 12.65000, alt: 85,  heading: 125, tSec: 66  },
      { lat: 55.60200, lon: 12.66000, alt: 100, heading: 105, tSec: 74  },
      { lat: 55.60000, lon: 12.67000, alt: 115, heading: 95,  tSec: 82  },
      { lat: 55.59900, lon: 12.67400, alt: 125, heading: 90,  tSec: 90  },
    ],
    durationSec: 958,
  },

  // ── Fixed-wing, hostile (ScanEagle-class recon, high altitude straight pass) ──
  cph_fixedwing_hostile: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'medium',
    platform: 'fixed-wing',
    droneType: 'Fixed wing reconnaissance (ScanEagle class)',
    confidence: 0.79,
    confidenceTrend: 'Sustained 0.75 to 0.81',
    contributingSensors: [
      { id: 'N07', confidence: 0.83 },
      { id: 'N15', confidence: 0.79 },
      { id: 'N20', confidence: 0.72 },
      { id: 'N05', confidence: 0.61 },
    ],
    evidence: { rfCarrier: '2.400 GHz', rfBandwidth: '10 MHz FHSS', rfMatch: 'Fixed-wing telemetry 78%', modality: 'RF + acoustic', evidenceSize: '38.2 MB' },
    waypoints: [
      { lat: 55.59400, lon: 12.60200, alt: 450, heading: 45,  tSec: 0  },
      { lat: 55.60000, lon: 12.61200, alt: 440, heading: 45,  tSec: 10 },
      { lat: 55.60700, lon: 12.62400, alt: 430, heading: 45,  tSec: 20 },
      { lat: 55.61400, lon: 12.63700, alt: 420, heading: 45,  tSec: 30 },
      { lat: 55.62100, lon: 12.65000, alt: 410, heading: 45,  tSec: 40 },
      { lat: 55.62800, lon: 12.66300, alt: 400, heading: 45,  tSec: 50 },
      { lat: 55.63500, lon: 12.67600, alt: 400, heading: 45,  tSec: 60 },
    ],
    durationSec: 60,
  },

  // ── Jet, friendly (commercial airliner approach onto runway 04R) ──
  cph_jet_friendly: {
    siteId: 'cph',
    // COOPERATIVE. Known from its transponder, not from our sensors,
    // which is what the ADS-B evidence below already claims. The
    // sensors-observe-only rule hides a track outside coverage and draws
    // its unobserved path as a breadcrumb: right for a drone, wrong for
    // an airliner. One 18 km out is squawking and a controller has it
    // the whole way in.
    //
    // Only this flag exempts a track from the coverage visibility gate,
    // and only this template carries it.
    cooperative: true,
    classification: 'friendly',
    threat: null,
    platform: 'jet',
    droneType: 'Commercial airliner (SAS 743, A320neo)',
    confidence: 0.98,
    confidenceTrend: 'ADS-B correlated, flight plan match',
    contributingSensors: [
      { id: 'N07', confidence: 0.98 },
      { id: 'N08', confidence: 0.96 },
      { id: 'N09', confidence: 0.94 },
      { id: 'N15', confidence: 0.92 },
      { id: 'N17', confidence: 0.90 },
    ],
    evidence: { rfCarrier: '1090 MHz ADS-B', rfMatch: 'SAS743 A320neo, flight plan match', modality: 'RF + acoustic + visual', evidenceSize: '92.1 MB', note: 'Cleared commercial approach, no threat, logged for audit.' },
    // TERRAIN-RELATIVE ALTITUDE. `alt` here is metres above the GROUND,
    // and this is the only template that says so. The shared track code
    // draws a waypoint altitude as a height above the WGS84 ellipsoid,
    // which at Copenhagen is 38.0 m below the runway surface, so an
    // airliner commanded to alt 0 touches down 38 m underground. Every
    // other template is authored against that same convention and looks
    // right on screen, so the correction is opt-in rather than global.
    terrainRelativeAlt: true,
    // Metres to lift the aircraft above the sampled terrain so the wheels
    // sit ON the runway. Dialled in on screen, not computed: the model's
    // wheels are only 0.087 m below its origin, so this 2 m is the gap
    // between the bare height model that globe.getHeight() reads and the
    // built-up paved surface that is actually drawn.
    // 0.1, not 2. The 2 m compensated for globe.getHeight() returning
    // the terrain under the photogrammetry mesh. Near the ground the
    // rendered surface is now sampled directly, so all that is left is
    // the model's own wheel offset: its wheels sit 0.087 m below its
    // origin.
    groundOffsetM: 0.1,
    // Gear retracts in flight and extends on the approach. Off for every
    // other template, whose models have no gear worth driving.
    gearRetracts: true,
    // Tyre smoke when the wheels touch. The go-around never touches
    // down, so it deliberately does not carry this.
    touchdownSmoke: true,
    // NO ICON BEARING TRIM. The shared default is -2 degrees, tuned so a
    // canvas icon's drawn apex lines up with its course. The 3D rig reads
    // the same heading field, so on an airliner that trim is the nose
    // sitting 2 degrees off the runway centreline. Zero here, and the rig
    // reads the effective value rather than the global so the two cannot
    // double-correct each other.
    iconBearingTrimDeg: 0,
    // The symbol aligns to the REAL direction of travel, not to its
    // horizontal shadow. On a 3 degree glideslope seen from a pitched
    // camera those differ on screen by about 1.6 degrees, which reads as
    // the nose sitting just off the track. Zero for level flight, which
    // is why only an aircraft on an approach exposes it.
    iconTracksFlightPath: true,
    // Two condensation cores off the wingtips on short final, drawn by
    // src/airliner_vortices.js. DECLARED BUT NOT ENABLED: the first
    // version read as a pair of big white streaks rather than vapour,
    // so it needs an explicit opt-in while it is dialled in.
    //   window.__isr_vortex_tuning = { enabled: true }
    wingVortices: true,
    waypoints: [
      // A REAL APPROACH, GENERATED FROM THE GEOMETRY, not eyeballed.
      //
      // TEN KILOMETRES. 18 km was correct and unwatchable, 4 minutes 15
      // seconds of straight-and-level before anything happened, which
      // reads as "it never lands". 5 km overcorrected and started the
      // track on top of the airport. 10 km at 530 m gives a visible
      // approach that touches down at t+147 and stops at t+195.
      //
      // ON THE REAL RUNWAY, from the baked OSM centreline in
      // public/night-lights/cph.json, which is what the runway lighting
      // generator already uses:
      //
      //   04R  threshold 55.59219 / 12.60352   bearing 41.2   3552 m
      //
      // The previous threshold was DERIVED from a sensor position and was
      // wrong in two ways at once: 20 to 30 m off the centreline, which
      // on a 45 m runway puts the wheels on the grass, and 1734 m ALONG
      // it, so the aircraft touched down 2.2 km in, near the far end.
      // Bearing was 40.0 against a real 41.2, which drags the start of a
      // 10 km final 210 m sideways. Checked against the centreline: every
      // waypoint now sits within 1.9 m of it.
      //
      // THE FLARE IS A CUBIC. The original "flare" STEEPENED to -3.66
      // degrees and touched down at 490 fpm, which reads as being driven
      // into the tarmac. This crosses the threshold at 50 ft holding the
      // glideslope rate, then cuts to 148 fpm at the wheels, touching
      // down 450 m in, inside the touchdown zone markings.
      //
      // SPEED IS CONTINUOUS. interpolate() is piecewise-linear in lat and
      // lon, so ground speed is piecewise-CONSTANT and steps at every
      // waypoint. Times come from integrating one speed profile, so no
      // step exceeds 5 m/s.
      //
      //  10.0 km out   530 m   72 m/s   t+0
      //   threshold     15 m   70 m/s   t+141  50 ft, flare begins
      //   touchdown      0 m   70 m/s   t+147  450 m in, 148 fpm
      //   brakes off     0 m    6 m/s   t+190  1621 m at 1.5 m/s2
      //   taxi ends      0 m    6 m/s   t+243  2391 m in, 3552 m runway
      //
      // DECELERATION IS AUTOBRAKE MEDIUM, 1.5 m/s2 on a dry runway, from
      // touchdown speed down to 6 m/s, which is about 12 kt and a normal
      // taxi speed. It then rolls at that speed rather than stopping dead
      // on the centreline, so it reads as an aircraft heading for its
      // stand. 2391 m of a 3552 m runway used, which is realistic.
      { lat: 55.52460, lon: 12.49881, alt: 530, heading: 41, tSec: 0.00 },
      { lat: 55.53271, lon: 12.51137, alt: 468.2, heading: 41, tSec: 16.69 },
      { lat: 55.54015, lon: 12.52289, alt: 411.5, heading: 41, tSec: 32.05 },
      { lat: 55.54690, lon: 12.53336, alt: 360, heading: 41, tSec: 46.04 },
      { lat: 55.55299, lon: 12.54279, alt: 313.7, heading: 41, tSec: 58.68 },
      { lat: 55.55839, lon: 12.55116, alt: 272.5, heading: 41, tSec: 69.93 },
      { lat: 55.56313, lon: 12.55849, alt: 236.4, heading: 41, tSec: 79.80 },
      { lat: 55.56752, lon: 12.56530, alt: 203, heading: 41, tSec: 88.98 },
      { lat: 55.57157, lon: 12.57158, alt: 172.1, heading: 41, tSec: 97.47 },
      { lat: 55.57529, lon: 12.57734, alt: 143.8, heading: 41, tSec: 105.27 },
      { lat: 55.57867, lon: 12.58258, alt: 118, heading: 41, tSec: 112.36 },
      { lat: 55.58171, lon: 12.58729, alt: 94.8, heading: 41, tSec: 118.76 },
      { lat: 55.58442, lon: 12.59148, alt: 74.2, heading: 41, tSec: 124.45 },
      { lat: 55.58678, lon: 12.59514, alt: 56.2, heading: 41, tSec: 129.44 },
      { lat: 55.58881, lon: 12.59828, alt: 40.8, heading: 41, tSec: 133.72 },
      { lat: 55.59050, lon: 12.60090, alt: 27.9, heading: 41, tSec: 137.28 },
      { lat: 55.59178, lon: 12.60289, alt: 18.1, heading: 41, tSec: 140.00 },
      { lat: 55.59219, lon: 12.60352, alt: 15, heading: 41, tSec: 140.85 },
      { lat: 55.59249, lon: 12.60399, alt: 12.7, heading: 41, tSec: 141.50 },
      { lat: 55.59280, lon: 12.60446, alt: 10.6, heading: 41, tSec: 142.14 },
      { lat: 55.59310, lon: 12.60493, alt: 8.7, heading: 41, tSec: 142.78 },
      { lat: 55.59341, lon: 12.60540, alt: 6.8, heading: 41, tSec: 143.43 },
      { lat: 55.59371, lon: 12.60588, alt: 5.2, heading: 41, tSec: 144.07 },
      { lat: 55.59401, lon: 12.60635, alt: 3.7, heading: 41, tSec: 144.71 },
      { lat: 55.59432, lon: 12.60682, alt: 2.5, heading: 41, tSec: 145.35 },
      { lat: 55.59462, lon: 12.60729, alt: 1.4, heading: 41, tSec: 146.00 },
      { lat: 55.59493, lon: 12.60776, alt: 0.6, heading: 41, tSec: 146.64 },
      { lat: 55.59523, lon: 12.60823, alt: 0, heading: 41, tSec: 147.28 },
      { lat: 55.59618, lon: 12.60970, alt: 0, heading: 41, tSec: 149.33 },
      { lat: 55.59733, lon: 12.61148, alt: 0, heading: 41, tSec: 151.94 },
      { lat: 55.59848, lon: 12.61326, alt: 0, heading: 41, tSec: 154.74 },
      { lat: 55.59962, lon: 12.61504, alt: 0, heading: 41, tSec: 157.74 },
      { lat: 55.60077, lon: 12.61682, alt: 0, heading: 41, tSec: 161.02 },
      { lat: 55.60192, lon: 12.61860, alt: 0, heading: 41, tSec: 164.66 },
      { lat: 55.60307, lon: 12.62038, alt: 0, heading: 41, tSec: 168.83 },
      { lat: 55.60422, lon: 12.62216, alt: 0, heading: 41, tSec: 173.84 },
      { lat: 55.60537, lon: 12.62394, alt: 0, heading: 41, tSec: 180.62 },
      { lat: 55.60619, lon: 12.62521, alt: 0, heading: 41, tSec: 189.95 },
      { lat: 55.60693, lon: 12.62636, alt: 0, heading: 41, tSec: 208.28 },
      { lat: 55.60768, lon: 12.62751, alt: 0, heading: 41, tSec: 226.62 },
      { lat: 55.60835, lon: 12.62856, alt: 0, heading: 41, tSec: 243.28 },
    ],
    durationSec: 243,
  },

  // ═══════════════════════════════════════════════════════════════
  // GO-AROUND. The "without ISR" half of the promo film.
  //
  // A SEPARATE PATH, not a change to cph_jet_friendly. That one lands
  // correctly and is finished; nothing here touches it.
  //
  // Identical to it waypoint for waypoint until t+132, which is T-0:15,
  // 56 m and 800 m out: about 185 ft, half a mile from the threshold.
  //
  // T-0:15, NOT T-0:38. The first version broke off 2.5 km out, and a
  // pilot cannot see a small quadcopter from two and a half kilometres.
  // Visual acquisition of something that size is a few hundred metres,
  // which is a few seconds. Going around from 185 ft is rare and real,
  // and it is the honest version: nobody knew anything until the runway
  // was close enough to see.
  //
  // It also makes the better shot. The aircraft crosses the threshold at
  // about 130 m still climbing, so it goes straight over the drones
  // rather than turning away short of them.
  //
  // Then a real missed approach:
  //   TOGA, and the aircraft SINKS about 10 m first, to roughly 150 ft,
  //     because thrust takes time to spool and the attitude has to
  //     change before anything climbs
  //   rotation, climb at roughly 2500 fpm easing off as it accelerates
  //   STRAIGHT AHEAD on 041 to 600 m, about 2000 ft
  //   a 180 degree RIGHT turn at 25 degrees of bank, 1739 m radius,
  //     still climbing through it toward 1000 m
  //   outbound over the water
  //
  // STRAIGHT FIRST, AND THAT IS NOT A SIMPLIFICATION. The aircraft is
  // slow, low and still draggy with the flaps coming in, and the
  // straight segment is what guarantees obstacle clearance. It is also
  // what makes it SAFE with other traffic: the missed approach is a
  // published, protected volume that ATC keeps clear, and a runway is
  // used in one direction at a time, so there is nothing coming the
  // other way. An aircraft improvising a turn at 185 ft is the thing
  // that creates a conflict, because nobody expects it there.
  //
  // RIGHT, because off 04R that is out over the Oresund. A left turn
  // would take it over Copenhagen, which is what missed approaches are
  // routed to avoid.
  //
  // The gear comes up on its own: the driver retracts once the aircraft
  // has climbed 80 m back from its lowest point, which is what a real
  // crew does on a positive rate of climb.
  cph_jet_goaround: {
    siteId: 'cph',
    cooperative: true,
    classification: 'friendly',
    threat: null,
    platform: 'jet',
    droneType: 'Commercial airliner (SAS 743, A320neo)',
    confidence: 0.98,
    confidenceTrend: 'ADS-B correlated, flight plan match',
    contributingSensors: [
      { id: 'N07', confidence: 0.98 },
      { id: 'N08', confidence: 0.96 },
      { id: 'N09', confidence: 0.94 },
      { id: 'N15', confidence: 0.92 },
      { id: 'N17', confidence: 0.90 },
    ],
    evidence: { rfCarrier: '1090 MHz ADS-B', rfMatch: 'SAS743 A320neo, flight plan match', modality: 'RF + acoustic + visual', evidenceSize: '92.1 MB', note: 'Cleared commercial approach, go-around flown at 185 ft. Logged for audit.' },
    terrainRelativeAlt: true,
    // 0.1, not 2. The 2 m compensated for globe.getHeight() returning
    // the terrain under the photogrammetry mesh. Near the ground the
    // rendered surface is now sampled directly, so all that is left is
    // the model's own wheel offset: its wheels sit 0.087 m below its
    // origin.
    groundOffsetM: 0.1,
    iconBearingTrimDeg: 0,
    iconTracksFlightPath: true,
    gearRetracts: true,
    waypoints: [
      { lat: 55.524600, lon: 12.498810, alt: 530, heading: 41, tSec: 0 },
      { lat: 55.532710, lon: 12.511370, alt: 468.2, heading: 41, tSec: 16.69 },
      { lat: 55.540150, lon: 12.522890, alt: 411.5, heading: 41, tSec: 32.05 },
      { lat: 55.546900, lon: 12.533360, alt: 360, heading: 41, tSec: 46.04 },
      { lat: 55.552990, lon: 12.542790, alt: 313.7, heading: 41, tSec: 58.68 },
      { lat: 55.558390, lon: 12.551160, alt: 272.5, heading: 41, tSec: 69.93 },
      { lat: 55.563130, lon: 12.558490, alt: 236.4, heading: 41, tSec: 79.8 },
      { lat: 55.567520, lon: 12.565300, alt: 203, heading: 41, tSec: 88.98 },
      { lat: 55.571570, lon: 12.571580, alt: 172.1, heading: 41, tSec: 97.47 },
      { lat: 55.575290, lon: 12.577340, alt: 143.8, heading: 41, tSec: 105.27 },
      { lat: 55.578670, lon: 12.582580, alt: 118, heading: 41, tSec: 112.36 },
      { lat: 55.581710, lon: 12.587290, alt: 94.8, heading: 41, tSec: 118.76 },
      { lat: 55.584420, lon: 12.591480, alt: 74.2, heading: 41, tSec: 124.45 },
      { lat: 55.586780, lon: 12.595140, alt: 56.2, heading: 41, tSec: 129.44 },
      { lat: 55.587727, lon: 12.596605, alt: 49.2, heading: 41, tSec: 131.44 },
      { lat: 55.588808, lon: 12.598281, alt: 46.2, heading: 41, tSec: 133.64 },
      { lat: 55.590744, lon: 12.601280, alt: 97, heading: 41, tSec: 137.64 },
      { lat: 55.592723, lon: 12.604346, alt: 147, heading: 41, tSec: 141.64 },
      { lat: 55.594745, lon: 12.607479, alt: 196.2, heading: 41, tSec: 145.64 },
      { lat: 55.596811, lon: 12.610679, alt: 244.6, heading: 41, tSec: 149.64 },
      { lat: 55.598920, lon: 12.613946, alt: 292.2, heading: 41, tSec: 153.64 },
      { lat: 55.601072, lon: 12.617280, alt: 339, heading: 41, tSec: 157.64 },
      { lat: 55.603267, lon: 12.620681, alt: 385, heading: 41, tSec: 161.64 },
      { lat: 55.605506, lon: 12.624149, alt: 430.2, heading: 41, tSec: 165.64 },
      { lat: 55.605623, lon: 12.624333, alt: 431.7, heading: 41, tSec: 165.85 },
      { lat: 55.605740, lon: 12.624520, alt: 433.2, heading: 41, tSec: 166.06 },
      { lat: 55.605873, lon: 12.624740, alt: 434.9, heading: 41, tSec: 166.31 },
      { lat: 55.606057, lon: 12.625053, alt: 437.3, heading: 41, tSec: 166.65 },
      { lat: 55.606288, lon: 12.625463, alt: 440.4, heading: 41, tSec: 167.09 },
      { lat: 55.606563, lon: 12.625979, alt: 444.1, heading: 41, tSec: 167.63 },
      { lat: 55.606877, lon: 12.626607, alt: 448.6, heading: 41, tSec: 168.27 },
      { lat: 55.607223, lon: 12.627354, alt: 453.7, heading: 41, tSec: 169 },
      { lat: 55.607595, lon: 12.628231, alt: 459.6, heading: 41, tSec: 169.83 },
      { lat: 55.607982, lon: 12.629246, alt: 466.1, heading: 41, tSec: 170.76 },
      { lat: 55.608375, lon: 12.630406, alt: 473.3, heading: 41, tSec: 171.79 },
      { lat: 55.608763, lon: 12.631721, alt: 481.1, heading: 41, tSec: 172.92 },
      { lat: 55.609117, lon: 12.633135, alt: 489.4, heading: 41, tSec: 174.09 },
      { lat: 55.609418, lon: 12.634586, alt: 497.6, heading: 41, tSec: 175.27 },
      { lat: 55.609666, lon: 12.636069, alt: 505.8, heading: 41, tSec: 176.44 },
      { lat: 55.609859, lon: 12.637578, alt: 514.1, heading: 41, tSec: 177.62 },
      { lat: 55.609996, lon: 12.639105, alt: 522.3, heading: 41, tSec: 178.79 },
      { lat: 55.610076, lon: 12.640645, alt: 530.5, heading: 41, tSec: 179.97 },
      { lat: 55.610101, lon: 12.642191, alt: 538.7, heading: 41, tSec: 181.14 },
      { lat: 55.610068, lon: 12.643737, alt: 547, heading: 41, tSec: 182.32 },
      { lat: 55.609979, lon: 12.645276, alt: 555.2, heading: 41, tSec: 183.5 },
      { lat: 55.609833, lon: 12.646801, alt: 563.4, heading: 41, tSec: 184.67 },
      { lat: 55.609632, lon: 12.648306, alt: 571.6, heading: 41, tSec: 185.85 },
      { lat: 55.609376, lon: 12.649785, alt: 579.9, heading: 41, tSec: 187.02 },
      { lat: 55.609067, lon: 12.651231, alt: 588.1, heading: 41, tSec: 188.2 },
      { lat: 55.608705, lon: 12.652639, alt: 596.3, heading: 41, tSec: 189.37 },
      { lat: 55.608292, lon: 12.654002, alt: 604.5, heading: 41, tSec: 190.55 },
      { lat: 55.607830, lon: 12.655315, alt: 612.8, heading: 41, tSec: 191.72 },
      { lat: 55.607321, lon: 12.656572, alt: 621, heading: 41, tSec: 192.9 },
      { lat: 55.606767, lon: 12.657769, alt: 629.2, heading: 41, tSec: 194.07 },
      { lat: 55.606171, lon: 12.658899, alt: 637.5, heading: 41, tSec: 195.25 },
      { lat: 55.605534, lon: 12.659958, alt: 645.7, heading: 41, tSec: 196.42 },
      { lat: 55.604859, lon: 12.660942, alt: 653.9, heading: 41, tSec: 197.6 },
      { lat: 55.604150, lon: 12.661846, alt: 662.1, heading: 41, tSec: 198.77 },
      { lat: 55.603410, lon: 12.662667, alt: 670.4, heading: 41, tSec: 199.95 },
      { lat: 55.602641, lon: 12.663401, alt: 678.6, heading: 41, tSec: 201.12 },
      { lat: 55.601846, lon: 12.664045, alt: 686.8, heading: 41, tSec: 202.3 },
      { lat: 55.601030, lon: 12.664597, alt: 695, heading: 41, tSec: 203.47 },
      { lat: 55.600195, lon: 12.665054, alt: 703.3, heading: 41, tSec: 204.65 },
      { lat: 55.599345, lon: 12.665414, alt: 711.5, heading: 41, tSec: 205.82 },
      { lat: 55.598483, lon: 12.665675, alt: 719.7, heading: 41, tSec: 207 },
      { lat: 55.597614, lon: 12.665838, alt: 727.9, heading: 41, tSec: 208.17 },
      { lat: 55.596741, lon: 12.665900, alt: 736.2, heading: 41, tSec: 209.35 },
      { lat: 55.595867, lon: 12.665861, alt: 744.4, heading: 41, tSec: 210.52 },
      { lat: 55.594997, lon: 12.665723, alt: 752.6, heading: 41, tSec: 211.7 },
      { lat: 55.594133, lon: 12.665485, alt: 760.8, heading: 41, tSec: 212.88 },
      { lat: 55.593280, lon: 12.665148, alt: 769.1, heading: 41, tSec: 214.05 },
      { lat: 55.592441, lon: 12.664714, alt: 777.3, heading: 41, tSec: 215.23 },
      { lat: 55.591654, lon: 12.664208, alt: 785.2, heading: 41, tSec: 216.35 },
      { lat: 55.590952, lon: 12.663672, alt: 792.4, heading: 41, tSec: 217.38 },
      { lat: 55.590332, lon: 12.663126, alt: 798.9, heading: 41, tSec: 218.31 },
      { lat: 55.589792, lon: 12.662591, alt: 804.7, heading: 41, tSec: 219.14 },
      { lat: 55.589328, lon: 12.662083, alt: 809.9, heading: 41, tSec: 219.88 },
      { lat: 55.588935, lon: 12.661615, alt: 814.3, heading: 41, tSec: 220.51 },
      { lat: 55.588609, lon: 12.661201, alt: 818.1, heading: 41, tSec: 221.05 },
      { lat: 55.588349, lon: 12.660850, alt: 821.2, heading: 41, tSec: 221.49 },
      { lat: 55.588149, lon: 12.660568, alt: 823.6, heading: 41, tSec: 221.84 },
      { lat: 55.588009, lon: 12.660364, alt: 825.3, heading: 41, tSec: 222.08 },
      { lat: 55.587889, lon: 12.660184, alt: 826.8, heading: 41, tSec: 222.29 },
      { lat: 55.587770, lon: 12.660002, alt: 828.2, heading: 41, tSec: 222.5 },
      { lat: 55.583292, lon: 12.653065, alt: 1000, heading: 41, tSec: 230.5 },
      { lat: 55.578815, lon: 12.646129, alt: 1000, heading: 41, tSec: 238.5 },
      { lat: 55.574338, lon: 12.639193, alt: 1000, heading: 41, tSec: 246.5 },
      { lat: 55.569861, lon: 12.632257, alt: 1000, heading: 41, tSec: 254.5 },
    ],
    durationSec: 254,
  },

  // ═══════════════════════════════════════════════════════════════
  // RUNWAY INCURSION SWARM. The threat half of the promo film.
  //
  // THE ROUTE IS BUILT AROUND WHO CAN SEE THEM. Measured against the
  // site manifest and the aerodrome polygon:
  //
  //   Tower Syd, ATC core     581 m inside the boundary, deep airside
  //   SAS Hangar 141          682 m inside
  //   Terminal 2, Pier A       63 m and 32 m from the public edge
  //
  // So the piers are a PASS, not a loiter: anyone on the landside road
  // could see a drone sitting over them, and the story needs nobody to
  // know until the aircraft is on short final. The dwell happens deep
  // airside over the control tower, where nothing overlooks them. The
  // swarm works inward, away from witnesses, toward the asset that
  // matters, which is also the better escalation to narrate.
  //
  //   t+0     ingress from the Oresund, outside every ring
  //   t+35    crosses into coverage: this is where detection opens
  //   t+81    Hangar 3 and Pier E, passing rather than loitering
  //   t+149   inward to the Central Apron
  //   t+182   SAS Hangar 141
  //   t+191   holding over Tower Syd, the ATC core. Voiceover window.
  //   t+314   breaks off southwest
  //   t+404   on the 04R threshold, holding
  //
  // SEVEN MINUTES IS THE FLOOR, not a choice. The tower and the 04R
  // threshold are 3,843 m apart, and 22 m/s is the top of what a
  // Matrice-class airframe does, so that leg alone is 175 s. Cutting
  // the scenario shorter would mean flying them at speeds the type
  // cannot reach.
  //
  // It does not need to be shorter. The transit IS the story: they work
  // toward the far corner of the field, away from the terminals and the
  // landside road, which is exactly where nobody is looking. The film
  // uses the parts it needs and the voiceover carries the rest.
  cph_swarm_runway_incursion: {
    siteId: 'cph',
    // Spawns over the Oresund, outside every sensor ring, so it is
    // invisible until it crosses in and the detection opens on entry.
    // Without this the operator gets a report for something no sensor
    // can hear.
    coverageGated: true,
    classification: 'hostile',
    threat: 'high',
    platform: 'quadcopter',
    droneType: '4x Sibiryachok-5 + 1x DJI Mavic 3 (recon formation)',
    // HIGH, and deliberately so. A swarm reporting 14 to 17 per cent
    // says the network has no idea what it is looking at, which is the
    // opposite of the story. Five airframes holding a formation on a
    // deliberate track is one of the most legible things an RF mesh
    // ever sees.
    confidence: 0.94,
    confidenceTrend: 'Immediate 0.78 to 0.94 (formation geometry + five distinct emitters, four sharing one link type)',
    contributingSensors: [
      { id: 'N24', confidence: 0.88 },   // NE Perimeter Corner, first contact
      { id: 'N21', confidence: 0.86 },   // NE Perimeter
      { id: 'N03', confidence: 0.93 },   // Tower Syd, ATC core
      { id: 'N16', confidence: 0.91 },   // Central Apron
      { id: 'N07', confidence: 0.89 },   // SW Runway Approach
    ],
    evidence: {
      rfCarrier: '847 MHz right now, hopping between 720 and 1020 MHz on four of the emitters. The fifth is fixed at 5780 MHz.',
      rfBandwidth: 'Frequency hopping (FHSS) on four of the five. All four hop in step. The fifth holds a steady OcuSync link.',
      rfMatch: 'Four-airframe formation link + one OcuSync emitter, 94%',
      modality: 'Fused. Radio, sound and camera combined into one estimate.',
      evidenceSize: '412 MB',
      // Short enough to read in three seconds. The reasoning sits in
      // noteDetail behind a Show more, because an operator scanning a
      // live panel needs the finding, not the argument for it.
      note: 'Five drones flying in formation from the Oresund to the 04R threshold, past the control tower. Four of them are hopping between 720 and 1020 MHz, all four in step. The fifth sits on one fixed frequency, 5780 MHz. All five are hostile.',
      noteDetail: 'The frequency is what gives them away. Military drones are built to hop, and they do it low, between 700 and 1000 MHz. Drones you can buy sit at 2.4 and 5.8 GHz. A system that only listens there would hear one of these five. We hear all five because we listen across the whole spectrum.\n\nNothing in our library matches the hopping signal. We can see all four clearly. We cannot say what they are. The fifth is a Chinese quadcopter being flown for reconnaissance. It was bought rather than built, so it carries a stock radio we recognise in seconds. The difference is where they got the drone, not what they are doing with it.\n\nThis is one estimate, not three. Airport noise wrecks the sound channel and we still use it. The cameras lose them at range and pick them up again over the tower. None of the three would be enough on its own.',
    },
    swarm: {
      size: 5,
      formation: [
        // FOUR MILITARY AIRFRAMES AND ONE COMMERCIAL, which is what a
        // real unit flies. Sibiryachok-5 is a Rostec reconnaissance
        // quadcopter: 90 minutes endurance, 28 km control range, 1000 m
        // ceiling, laser rangefinder and 160x zoom, and it returns on
        // visual odometry when its link is jammed. The fifth is a DJI
        // Mavic 3, because Russian forces procure commercial airframes
        // in quantity for exactly this kind of low-altitude work.
        //
        // ALL FIVE ARE HOSTILE. The Mavic is not a civilian track that
        // wandered into the formation, it is a reconnaissance asset that
        // happens to be bought off a Chinese shelf rather than built for
        // the role.
        //
        // What differs is the procurement path, and that is what the
        // network actually sees. A bought DJI inherits DJI's licensed,
        // documented OcuSync link in ISM, so it names cleanly. A purpose
        // built military datalink hops in UHF and matches nothing. Same
        // mission, four of a kind and one outlier, and the outlier is
        // the one we can name. That is a detection characteristic, not a
        // label the platform is asserting.
        { role: 'lead',       model: 'Sibiryachok-5',  rfMHz:  847, offset: { forward:    0, right:    0, up:   0 } },
        { role: 'wingman-BL', model: 'Sibiryachok-5',  rfMHz:  764, offset: { forward:  -90, right:  -60, up:  -5 } },
        { role: 'wingman-BR', model: 'Sibiryachok-5',  rfMHz:  905, offset: { forward:  -90, right:   60, up:  +4 } },
        { role: 'wingman-L',  model: 'Sibiryachok-5',  rfMHz:  977, offset: { forward: -170, right: -120, up:  +8 } },
        { role: 'overwatch',  model: 'DJI Mavic 3 (Chinese-built, military recon use)', rfMHz: 5780, offset: { forward: -230, right:  140, up: +28 } },
      ],
    },
    waypoints: [
      // REBUILT AGAIN 2026-10-14, against the airport's own runway data
      // and the site perimeter polygon. Three faults, all measured.
      //
      // 1. THE RUN WAS 343 m OFF THE CENTRELINE. The path flew parallel
      //    to 04R, out over the perimeter grass, and never crossed the
      //    landing surface. Nothing about it would trouble a pilot on
      //    short final, which was the entire point of the scenario.
      //    It now flies the centreline itself, through the threshold at
      //    55.59219, 12.60352, and on out onto the approach where a
      //    landing aircraft actually is.
      //
      // 2. NO RE-ENTRY, BECAUSE THE PATH NEVER RE-ENTERED. The platform
      //    has always logged repeat entries: processDroneSiteMarkers
      //    counts them per site and labels them ENTRY #2, ENTRY #3.
      //    Nothing was removed. The old path crossed the fence once in
      //    and once out, so there was no second entry to label.
      //
      //    It now does the thing that produces one. Down the centreline,
      //    over the threshold, out onto the approach, which leaves the
      //    perimeter at about d = -450 m while STILL being tracked (N35
      //    at 191 to 623 m, so sensors see past the fence). Wide turn,
      //    back in over the field, which is the re-entry. Then east and
      //    out for the final exit.
      //
      //    Verified against the polygon: exactly four perimeter events,
      //    ENTRY, EXIT, ENTRY #2, EXIT. The earlier east route clipped
      //    the irregular eastern boundary twice more and produced six.
      //
      // 3. TURN RATE. Every turn is capped at 0.05 rad/s, radius at
      //    least twenty times the speed. Formation offsets rotate with
      //    the lead's heading, so a member 269 m back gains omega * 269:
      //    on the old 95 m orbit that was +46 m/s and put the overwatch
      //    at 62 m/s, and the near-180 degree corners were worse still
      //    at 117 m/s. Worst anywhere on this path is 39 m/s.
      //
      // The tower orbit is 300 m and is entered and left tangentially,
      // solved numerically, residual 0.0 degrees on both.
      //
      // Do not hand-edit single points. A corner inserted without
      // re-checking the turn rate puts the formation back into triple
      // digits, and a point nudged near the fence changes how many
      // perimeter events the operator sees.
      { lat: 55.63700, lon: 12.67900, alt: 115, heading: 0, tSec: 0 },
      { lat: 55.63300, lon: 12.66900, alt: 108, heading: 0, tSec: 36.7 },
      { lat: 55.62870, lon: 12.65550, alt:  92, heading: 0, tSec: 83.1 },
      { lat: 55.62100, lon: 12.65450, alt:  80, heading: 0, tSec: 124 },
      { lat: 55.61643, lon: 12.65258, alt:  72, heading: 0, tSec: 148.9 },
      { lat: 55.61416, lon: 12.65990, alt:  62, heading: 0, tSec: 174.9 },
      { lat: 55.61358, lon: 12.66118, alt:  62, heading: 0, tSec: 181.8 },
      { lat: 55.61280, lon: 12.66203, alt:  62, heading: 0, tSec: 188.7 },
      { lat: 55.61189, lon: 12.66237, alt:  62, heading: 0, tSec: 195.6 },
      { lat: 55.61097, lon: 12.66214, alt:  62, heading: 0, tSec: 202.5 },
      { lat: 55.61015, lon: 12.66138, alt:  62, heading: 0, tSec: 209.4 },
      { lat: 55.60953, lon: 12.66017, alt:  62, heading: 0, tSec: 216.3 },
      { lat: 55.60917, lon: 12.65866, alt:  62, heading: 0, tSec: 223.2 },
      { lat: 55.60912, lon: 12.65703, alt:  62, heading: 0, tSec: 230.1 },
      { lat: 55.60939, lon: 12.65546, alt:  62, heading: 0, tSec: 237 },
      { lat: 55.60994, lon: 12.65414, alt:  62, heading: 0, tSec: 243.9 },
      { lat: 55.61071, lon: 12.65323, alt:  62, heading: 0, tSec: 250.8 },
      { lat: 55.61161, lon: 12.65284, alt:  62, heading: 0, tSec: 257.7 },
      { lat: 55.61253, lon: 12.65301, alt:  62, heading: 0, tSec: 264.6 },
      { lat: 55.61337, lon: 12.65372, alt:  62, heading: 0, tSec: 271.5 },
      { lat: 55.61402, lon: 12.65488, alt:  62, heading: 0, tSec: 278.4 },
      { lat: 55.61440, lon: 12.65637, alt:  62, heading: 0, tSec: 285.3 },
      { lat: 55.61449, lon: 12.65800, alt:  62, heading: 0, tSec: 292.2 },
      { lat: 55.61425, lon: 12.65958, alt:  62, heading: 0, tSec: 299.1 },
      { lat: 55.61373, lon: 12.66093, alt:  62, heading: 0, tSec: 306 },
      { lat: 55.61298, lon: 12.66189, alt:  62, heading: 0, tSec: 312.9 },
      { lat: 55.61209, lon: 12.66234, alt:  62, heading: 0, tSec: 319.8 },
      { lat: 55.61116, lon: 12.66224, alt:  62, heading: 0, tSec: 326.7 },
      { lat: 55.61032, lon: 12.66158, alt:  62, heading: 0, tSec: 333.6 },
      { lat: 55.60964, lon: 12.66046, alt:  62, heading: 0, tSec: 340.5 },
      { lat: 55.60922, lon: 12.65900, alt:  62, heading: 0, tSec: 347.4 },
      { lat: 55.60911, lon: 12.65738, alt:  62, heading: 0, tSec: 354.3 },
      { lat: 55.60982, lon: 12.63064, alt:  58, heading: 0, tSec: 466.5 },
      { lat: 55.60439, lon: 12.62230, alt:  54, heading: 0, tSec: 502.9 },
      { lat: 55.59897, lon: 12.61395, alt:  50, heading: 0, tSec: 539.3 },
      { lat: 55.59422, lon: 12.60665, alt:  45, heading: 0, tSec: 571.1 },
      { lat: 55.59219, lon: 12.60352, alt:  43, heading: 0, tSec: 584.7 },
      { lat: 55.59016, lon: 12.60039, alt:  42, heading: 0, tSec: 598.3 },
      { lat: 55.58609, lon: 12.59413, alt:  42, heading: 0, tSec: 625.6 },
      { lat: 55.58338, lon: 12.58996, alt:  45, heading: 0, tSec: 643.8 },
      { lat: 55.58055, lon: 12.59087, alt:  50, heading: 0, tSec: 661.7 },
      { lat: 55.57929, lon: 12.59463, alt:  55, heading: 0, tSec: 678.9 },
      { lat: 55.58027, lon: 12.59992, alt:  58, heading: 0, tSec: 695.8 },
      { lat: 55.58400, lon: 12.60566, alt:  60, heading: 0, tSec: 715.4 },
      { lat: 55.58806, lon: 12.61192, alt:  62, heading: 0, tSec: 736.8 },
      { lat: 55.59281, lon: 12.61922, alt:  70, heading: 0, tSec: 761.8 },
      { lat: 55.60200, lon: 12.63600, alt:  85, heading: 0, tSec: 814.3 },
      { lat: 55.60500, lon: 12.64900, alt:  95, heading: 0, tSec: 845.8 },
      { lat: 55.60800, lon: 12.66000, alt: 105, heading: 0, tSec: 873.2 },
      { lat: 55.61000, lon: 12.66900, alt: 112, heading: 0, tSec: 894.9 },
      { lat: 55.61100, lon: 12.67500, alt: 118, heading: 0, tSec: 909 },
      { lat: 55.61000, lon: 12.68100, alt: 125, heading: 0, tSec: 923.1 },
      { lat: 55.60800, lon: 12.68700, alt: 130, heading: 0, tSec: 938.7 },
      { lat: 55.60600, lon: 12.69500, alt: 135, heading: 0, tSec: 958.3 },
    ],
    durationSec: 776,
  },

  // ── Recon drone, HALE (Reaper/Global-Hawk class), high altitude circular loiter ──
  // Detected by passive coherent location (PCL): our RF mesh triangulates reflections
  // of civil broadcast signals (DVB-T, FM) bouncing off the target. Backed by
  // SATCOM downlink capture on Ku/Ka band (needs wideband SDR). Lower confidence
  // than close-range detection because signal is weak and cross-section is small.
  cph_recon_hostile: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'medium',
    platform: 'fixed-wing',
    droneType: 'HALE reconnaissance (MQ-9 Reaper class)',
    confidence: 0.62,
    confidenceTrend: 'Detected on ingress at 800 m, climbing beyond passive-sensor ceiling',
    contributingSensors: [
      { id: 'N03', confidence: 0.68 },
      { id: 'N15', confidence: 0.65 },
      { id: 'N20', confidence: 0.61 },
      { id: 'N07', confidence: 0.58 },
      { id: 'N22', confidence: 0.55 },
    ],
    evidence: {
      rfCarrier: 'Ku band SATCOM (12.5 GHz) + PCL from DVB T reflection',
      rfMatch: 'Loiter signature 71%',
      modality: 'RF passive + IR thermal',
      evidenceSize: '84.6 MB',
      note: 'HALE recon platform. Ingressed at 800 m, initial pass detected clearly by passive fused mesh. Climbed to 3,000 m loiter altitude, exceeding the sensor grid ceiling around 2 km. Track lost as it climbed past the passive-sensor detection envelope. Active radar hardware required for sustained detection above 2 km.',
    },
    waypoints: [
      // Spiraling climb over CPH airport centre. Drone stays inside the
      // horizontal coverage of the sensor spine (N15 / N16 / N17 / N03)
      // for the whole orbit, so signal is only lost when altitude
      // exceeds the sensor ceilings, not when it exits horizontal range.
      //   alt < 1500 m: every CPH sensor sees it (base Radxa 4SE ceiling)
      //   alt 1500-2000 m: only HackRF-equipped sensors (N03, N15) see it
      //   alt > 2000 m: no passive sensor sees it, coverage exit fires,
      //   event auto-closes as fled (fled = out of sensor envelope, in
      //   this case vertically not horizontally). Real Reaper-class HALE
      //   operates 6-12 km altitude — this scenario demonstrates the
      //   capability edge of passive-only gear and why active radar is
      //   required for sustained high-altitude tracking.
      // 500 m radius diamond orbit centred at (55.618, 12.650), climbing
      // 300 m per waypoint. Loses signal around tSec 75 (alt 2300 m).
      { lat: 55.62250, lon: 12.65000, alt: 800,  heading: 90,  tSec: 0  },   // N point
      { lat: 55.61800, lon: 12.65800, alt: 1100, heading: 180, tSec: 15 },   // E point
      { lat: 55.61350, lon: 12.65000, alt: 1400, heading: 270, tSec: 30 },   // S point
      { lat: 55.61800, lon: 12.64200, alt: 1700, heading: 0,   tSec: 45 },   // W point (last altitude all sensors see)
      { lat: 55.62250, lon: 12.65000, alt: 2000, heading: 90,  tSec: 60 },   // Only HackRF sensors still see (N03, N15)
      { lat: 55.61800, lon: 12.65800, alt: 2300, heading: 180, tSec: 75 },   // Above all sensor ceilings, coverage exit fires here
      { lat: 55.61350, lon: 12.65000, alt: 2600, heading: 270, tSec: 90 },   // Track sustained by scripted trajectory only, no sensor contact
      { lat: 55.61800, lon: 12.64200, alt: 3000, heading: 0,   tSec: 105 },  // Full loiter altitude — event should have closed by this point
    ],
    durationSec: 105,
  },

  // ── Shahed-136 / Geran-2 attack profile ──
  //
  // One-way attack drone (loitering munition), Iranian design used
  // extensively by Russia against Ukraine. Specs triangulated from
  // CSIS Missile Threat Project, RUSI (Rubin 2023), Conflict Armament
  // Research field examination of downed airframes (IPHR "Terror in
  // the Details" Jul 2023), and ISIS teardown reports. Where specs
  // vary between sources — cite the range, don't invent numbers.
  //
  //   Cruise speed: ~180-185 km/h (~50 m/s) — piston MD-550
  //   Terminal dive: ~324 km/h (~90 m/s) from 1-2 km altitude
  //   Altitude typical: 1,000-2,500 m; ceiling 4,000 m
  //   Wingspan 2.5 m, length 3.5 m
  //   Warhead: 50 kg BCh-50 standard (or 90 kg BCh-90 heavy variant)
  //   Range 1,000-2,500 km
  //   RF: original fire-and-forget GNSS-only; 2024+ Geran-2 also
  //     emits cellular 4G (900-2600 MHz) and Iridium (1616 MHz uplink)
  //   Acoustic: piston engine, "moped/lawnmower" signature
  //
  // Path: enters over Øresund from SE, crosses CPH airport airspace
  // at 1200m cruise, passes near Amager Koblingsstation (crosses AMK
  // sensor coverage → cross-site domain scope union pulls maritime +
  // ground into scope for the parent event), terminal dive on
  // Amalienborg palace (55.6844, 12.5931).
  //
  // Classification: hostile-high from spawn. Loitering munition is
  // WEAPON_SIGNATURE_CLASSES, never downgrades even at high NN
  // confidence. Attack advisory fires immediately (weapon signature
  // + descent behavior + coordinated formation from taxonomy) and
  // again on terminal dive (low-alt + high-speed + close-to-critical
  // asset rule).
  cph_shahed_amalienborg: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'high',
    platform: 'loitering-munition',
    terminalImpact: true,   // warhead detonates at final waypoint (explosion + 'target impact' outcome)
    droneType: 'Shahed-136 / Geran-2 (loitering munition)',
    confidence: 0.72,
    confidenceTrend: 'Acoustic + RF (Iridium 1616 MHz + cellular 900 MHz), piston engine signature',
    multiSite: true,
    contributingSensors: [
      { id: 'N09', confidence: 0.78 },
      { id: 'N15', confidence: 0.72 },
      { id: 'N20', confidence: 0.68 },
      { id: 'N22', confidence: 0.63 },
    ],
    evidence: {
      rfCarrier: 'Iridium 1616 MHz uplink + cellular 900/1800 MHz downlink',
      rfBandwidth: 'narrowband',
      rfMatch: 'Geran-2 modem signature 74%',
      modality: 'RF + acoustic (moped-signature piston)',
      evidenceSize: '156.4 MB',
      note: 'Loitering munition class. Fire-and-forget flight profile with GNSS/INS guidance and Kometa CRPA anti-jam. 50 kg warhead. Real-world Geran-2 confirmed by Conflict Armament Research airframe exploitation (IPHR Jul 2023).',
    },
    waypoints: [
      // Real Shahed cruise ~50 m/s (180 km/h). Terminal dive ~90 m/s
      // (324 km/h) per Ukrainian AF observations. Waypoint spacing
      // computed for 600 m per 12 s cruise tick (50 m/s).
      //
      // Ingress starts 6.4 km east of CPH airport over open Øresund so
      // the operator sees the projected-path line approaching CPH from
      // sea before the track enters any sensor coverage. Detection
      // triggers around waypoint 5 as the drone enters N21 / N17
      // coverage from the east. That gives ~2 min of visible projection
      // before first sensor contact — matches real ISR observation
      // where distant surveillance (external radar cue, cooperative
      // traffic feed) hands off to the ground mesh as target closes.
      //
      // Route: pre-detection cruise over Øresund → enter E CPH via
      // N17 coverage → straight W along lat 55.618 through the CPH
      // sensor spine (N17, N16, N15, N18) → NW bend through AMK
      // cluster (cross-site link) → N over Copenhagen to Amalienborg
      // (55.6844, 12.5931) → terminal dive over last 2 km.
      // Tight ingress: ~1.5 km off the eastern sensor edge so first
      // detection fires within ~30 s of spawn. Real Shahed cruise
      // 50 m/s preserved; pre-detection segment is short so the
      // operator sees the projection line briefly then the drone
      // enters coverage before impatience sets in.
      { lat: 55.6180, lon: 12.6900, alt: 1000, heading: 270, tSec: 0   },  // Ingress ~1.5 km east of N17 coverage edge
      { lat: 55.6180, lon: 12.6837, alt: 1000, heading: 270, tSec: 12  },  // Closing on N17 coverage
      { lat: 55.6180, lon: 12.6775, alt: 1000, heading: 270, tSec: 24  },  // FIRST DETECTION, N17 coverage
      { lat: 55.6180, lon: 12.6680, alt: 1000, heading: 270, tSec: 36  },  // Over CPH central airside, N16
      { lat: 55.6180, lon: 12.6585, alt: 1000, heading: 270, tSec: 48  },
      { lat: 55.6180, lon: 12.6490, alt: 1000, heading: 270, tSec: 60  },  // Runway 04R, N15
      { lat: 55.6180, lon: 12.6395, alt: 1000, heading: 270, tSec: 72  },
      { lat: 55.6207, lon: 12.6312, alt: 1000, heading: 300, tSec: 84  },  // NW bend, N18
      { lat: 55.6234, lon: 12.6229, alt: 1000, heading: 315, tSec: 96  },
      { lat: 55.6272, lon: 12.6162, alt: 1000, heading: 330, tSec: 108 },  // Approaching AMK
      { lat: 55.6320, lon: 12.6115, alt: 1000, heading: 340, tSec: 120 },
      { lat: 55.6370, lon: 12.6095, alt: 1000, heading: 345, tSec: 132 },  // AMK cluster centre (330 m from AMK-N01)
      { lat: 55.6422, lon: 12.6090, alt: 1000, heading: 355, tSec: 144 },
      // Past AMK, transiting Copenhagen with no sensor coverage
      { lat: 55.6530, lon: 12.6045, alt: 1000, heading: 355, tSec: 156 },
      { lat: 55.6640, lon: 12.6005, alt: 950,  heading: 355, tSec: 168 },
      { lat: 55.6695, lon: 12.5985, alt: 850,  heading: 350, tSec: 180 },  // Terminal descent begins ~1.7 km out
      // Terminal dive 90 m/s (~360 m per 4 s tick)
      { lat: 55.6727, lon: 12.5972, alt: 700, heading: 348, tSec: 184 },
      { lat: 55.6759, lon: 12.5959, alt: 550, heading: 348, tSec: 188 },
      { lat: 55.6791, lon: 12.5946, alt: 400, heading: 348, tSec: 192 },
      { lat: 55.6820, lon: 12.5936, alt: 200, heading: 348, tSec: 196 },
      { lat: 55.6844, lon: 12.5931, alt: 50,  heading: 348, tSec: 200 },  // Impact at Amalienborg
    ],
    durationSec: 200,
  },

  // ── Geran-3 jet-powered loitering munition, same route as the
  //    Shahed-136 scenario at roughly double the closure speed ──
  //
  // Russian-built turbojet evolution of the Shahed line, produced at
  // scale since mid-2025. Specs per CSIS Missile Threat, Defense
  // Express, and Forbes (verified Sept 2026):
  //
  //   Cruise: 300-370 km/h (CONFIRMED, multiple sources) — sim uses
  //     ~350 km/h (97 m/s), Chinese Telefly JT80 turbojet
  //   Terminal dash: 550-600 km/h design/max per Ukrainian Defence
  //     Intelligence (PLAUSIBLE tier, not typical observed cruise) —
  //     sim uses ~550 km/h (153 m/s) for the dive
  //   Airframe: Shahed-238 lineage, ~3.5 m length, ~3 m wingspan
  //   Acoustic: turbojet whine — NO piston "moped" signature, which
  //     defeats acoustic classifiers trained only on Geran-2
  //   RF: GNSS/INS + cellular downlink, similar to late Geran-2
  //
  // Same ingress route and target as cph_shahed_amalienborg so the
  // two scenarios demo the speed differential directly: the mesh gets
  // ~100 s from first detection to impact instead of ~200 s. Half the
  // decision window is the entire story of this scenario.
  cph_geran3_amalienborg: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'high',
    platform: 'loitering-munition',
    terminalImpact: true,   // warhead detonates at final waypoint (explosion + 'target impact' outcome)
    droneType: 'Geran-3 (jet loitering munition)',
    confidence: 0.68,
    confidenceTrend: 'RF (cellular downlink) + turbojet acoustic, no piston signature match',
    multiSite: true,
    contributingSensors: [
      { id: 'N09', confidence: 0.74 },
      { id: 'N15', confidence: 0.70 },
      { id: 'N20', confidence: 0.64 },
      { id: 'N22', confidence: 0.60 },
    ],
    evidence: {
      rfCarrier: 'Cellular 900/1800 MHz downlink + GNSS/INS guidance',
      rfBandwidth: 'narrowband',
      rfMatch: 'Geran-3 modem signature 69%',
      modality: 'RF + acoustic (turbojet whine, no piston match)',
      evidenceSize: '142.1 MB',
      note: 'Jet-powered loitering munition class. Turbojet acoustic profile defeats piston-trained classifiers. Closure speed roughly double the Geran-2: compressed response window is the defining threat property. Cruise 300-370 km/h confirmed (CSIS, Defense Express); 550-600 km/h terminal dash per Ukrainian Defence Intelligence.',
    },
    waypoints: [
      // Same route geometry as the Shahed-136 scenario, retimed for
      // jet speeds: cruise ~97 m/s (600 m legs in ~6 s vs 12 s), dive
      // ~153 m/s (2 s legs). Ingress starts ~2.6 km east of N17 over
      // open Øresund: ~24 s of visible projected-path approach before
      // first sensor contact, giving the duty officer lead time to
      // pre-select which agencies to inform. Impact at tSec 112 —
      // still roughly half the Geran-2 timeline.
      { lat: 55.6180, lon: 12.7090, alt: 1500, heading: 270, tSec: 0   },  // Ingress far out over Øresund
      { lat: 55.6180, lon: 12.6995, alt: 1500, heading: 270, tSec: 6   },
      { lat: 55.6180, lon: 12.6900, alt: 1500, heading: 270, tSec: 12  },  // Closing on the coast
      { lat: 55.6180, lon: 12.6837, alt: 1500, heading: 270, tSec: 18  },
      { lat: 55.6180, lon: 12.6775, alt: 1500, heading: 270, tSec: 24  },  // FIRST DETECTION, N17 coverage
      { lat: 55.6180, lon: 12.6680, alt: 1500, heading: 270, tSec: 30  },
      { lat: 55.6180, lon: 12.6585, alt: 1500, heading: 270, tSec: 36  },
      { lat: 55.6180, lon: 12.6490, alt: 1500, heading: 270, tSec: 42  },  // Runway 04R, N15
      { lat: 55.6180, lon: 12.6395, alt: 1500, heading: 270, tSec: 48  },
      { lat: 55.6207, lon: 12.6312, alt: 1500, heading: 300, tSec: 54  },  // NW bend, N18
      { lat: 55.6234, lon: 12.6229, alt: 1500, heading: 315, tSec: 60  },
      { lat: 55.6272, lon: 12.6162, alt: 1500, heading: 330, tSec: 66  },  // Approaching AMK
      { lat: 55.6320, lon: 12.6115, alt: 1500, heading: 340, tSec: 72  },
      { lat: 55.6370, lon: 12.6095, alt: 1500, heading: 345, tSec: 78  },  // AMK cluster centre
      { lat: 55.6422, lon: 12.6090, alt: 1500, heading: 355, tSec: 84  },
      { lat: 55.6530, lon: 12.6045, alt: 1500, heading: 355, tSec: 90  },
      { lat: 55.6640, lon: 12.6005, alt: 1400, heading: 355, tSec: 96  },
      { lat: 55.6695, lon: 12.5985, alt: 1200, heading: 350, tSec: 102 },  // Terminal descent begins
      // Terminal dash ~153 m/s
      { lat: 55.6727, lon: 12.5972, alt: 950, heading: 348, tSec: 104 },
      { lat: 55.6759, lon: 12.5959, alt: 700, heading: 348, tSec: 106 },
      { lat: 55.6791, lon: 12.5946, alt: 450, heading: 348, tSec: 108 },
      { lat: 55.6820, lon: 12.5936, alt: 220, heading: 348, tSec: 110 },
      { lat: 55.6844, lon: 12.5931, alt: 50,  heading: 348, tSec: 112 },  // Impact at Amalienborg
    ],
    durationSec: 112,
  },

  // ── Shahed-238, the fastest of the family. Same route again ──
  //
  // Iranian jet original (Czech TJ150 turbojet lineage). ~600 km/h
  // maximum per leaked design specs via CSIS Missile Threat
  // (PLAUSIBLE tier; the fastest credibly reported figure in the
  // family). Sim flies ~450 km/h (125 m/s) ingress with a ~600 km/h
  // (167 m/s) terminal dash. First detection to impact ~80 s: the
  // shortest decision window of the three family scenarios
  // (Geran-2 ~176 s, Geran-3 ~88 s).
  //
  // Family note per Sept 2026 research: Geran-4/5 (the variants
  // dominating Russian production per Ukrainian HUR, single
  // reporting chain) cruise 300-400 km/h — inside Geran-3's
  // envelope. No verified distinct capability, so no separate
  // scenario: inventing one would be fake differentiation.
  cph_shahed238_amalienborg: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'high',
    platform: 'loitering-munition',
    terminalImpact: true,
    droneType: 'Shahed-238 (jet loitering munition)',
    confidence: 0.64,
    confidenceTrend: 'Turbojet acoustic + weak RF, highest closure rate in family catalog',
    multiSite: true,
    contributingSensors: [
      { id: 'N09', confidence: 0.70 },
      { id: 'N15', confidence: 0.66 },
      { id: 'N20', confidence: 0.61 },
    ],
    evidence: {
      rfCarrier: 'GNSS/INS guidance, minimal RF emissions',
      rfBandwidth: 'narrowband',
      rfMatch: 'Shahed-238 signature 61%',
      modality: 'Acoustic (turbojet) + visual silhouette',
      evidenceSize: '128.7 MB',
      note: 'Jet loitering munition, fastest of the Shahed family. ~600 km/h maximum per leaked design specifications (CSIS Missile Threat, plausible tier). Closure rate compresses the response window below one and a half minutes from first detection.',
    },
    waypoints: [
      // Cruise ~125 m/s (600 m legs in ~5 s), dash ~167 m/s.
      { lat: 55.6180, lon: 12.7090, alt: 1800, heading: 270, tSec: 0  },
      { lat: 55.6180, lon: 12.6995, alt: 1800, heading: 270, tSec: 5  },
      { lat: 55.6180, lon: 12.6900, alt: 1800, heading: 270, tSec: 10 },
      { lat: 55.6180, lon: 12.6837, alt: 1800, heading: 270, tSec: 15 },
      { lat: 55.6180, lon: 12.6775, alt: 1800, heading: 270, tSec: 20 },  // FIRST DETECTION, N17
      { lat: 55.6180, lon: 12.6680, alt: 1800, heading: 270, tSec: 25 },
      { lat: 55.6180, lon: 12.6585, alt: 1800, heading: 270, tSec: 30 },
      { lat: 55.6180, lon: 12.6490, alt: 1800, heading: 270, tSec: 35 },  // Runway 04R, N15
      { lat: 55.6180, lon: 12.6395, alt: 1800, heading: 270, tSec: 40 },
      { lat: 55.6207, lon: 12.6312, alt: 1800, heading: 300, tSec: 45 },  // NW bend, N18
      { lat: 55.6234, lon: 12.6229, alt: 1800, heading: 315, tSec: 50 },
      { lat: 55.6272, lon: 12.6162, alt: 1800, heading: 330, tSec: 55 },  // Approaching AMK
      { lat: 55.6320, lon: 12.6115, alt: 1800, heading: 340, tSec: 60 },
      { lat: 55.6370, lon: 12.6095, alt: 1800, heading: 345, tSec: 65 },  // AMK cluster centre
      { lat: 55.6422, lon: 12.6090, alt: 1800, heading: 355, tSec: 70 },
      { lat: 55.6530, lon: 12.6045, alt: 1700, heading: 355, tSec: 75 },
      { lat: 55.6640, lon: 12.6005, alt: 1500, heading: 355, tSec: 80 },
      { lat: 55.6695, lon: 12.5985, alt: 1300, heading: 350, tSec: 85 },  // Terminal descent begins
      // Terminal dash ~167 m/s
      { lat: 55.6727, lon: 12.5972, alt: 1000, heading: 348, tSec: 87 },
      { lat: 55.6759, lon: 12.5959, alt: 720,  heading: 348, tSec: 89 },
      { lat: 55.6791, lon: 12.5946, alt: 460,  heading: 348, tSec: 91 },
      { lat: 55.6820, lon: 12.5936, alt: 220,  heading: 348, tSec: 93 },
      { lat: 55.6844, lon: 12.5931, alt: 50,   heading: 348, tSec: 95 },  // Impact at Amalienborg
    ],
    durationSec: 95,
  },

  // ── Recon quadcopter, sustained loiter over CPH cargo apron ──
  //
  // Small commercial-class quadcopter, unclear operator, sustained
  // loiter pattern over the cargo apron area. Photographs cargo ops.
  // Different receiver mix than the Shahed: no Air Force, no PET
  // strategic intel — this is a ground evidence + Politi case.
  //
  // Classification pipeline: spawns hostile-high (RED, precautionary).
  // Confidence ramps 0.35 → 0.85 over ~20s via mockConfidenceRamp.
  // When confidence crosses 0.6 with class 'quadcopter' in
  // COMMERCIAL_IDENTIFIABLE_CLASSES, pipeline auto-downgrades to
  // hostile-medium (YELLOW). No attack advisory fires (no descent,
  // no weapon signature, altitude 80m not < 500m for the low+fast
  // rule but SPEED is only 8 m/s so the AND-gate fails on speed).
  cph_quad_recon_apron: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'high',
    platform: 'quadcopter',
    droneType: 'Commercial-class quadcopter, operator unclear',
    dynamicClassification: true,
    mockConfidenceRamp: true,
    confidence: 0.35,
    confidenceTrend: 'Initial low confidence, RF beacon fragmentary. Ramping as more sensors contribute.',
    contributingSensors: [
      { id: 'N16', confidence: 0.42 },
      { id: 'N17', confidence: 0.38 },
      { id: 'N20', confidence: 0.35 },
      { id: 'N09', confidence: 0.31 },
    ],
    evidence: {
      rfCarrier: '2.412 GHz',
      rfBandwidth: '20 MHz OFDM',
      rfMatch: 'Consumer-class quadcopter control signature 62%',
      modality: 'RF + acoustic',
      evidenceSize: '48.3 MB',
      note: 'Sustained loiter over cargo apron. Signature consistent with commercial quadcopter (DJI-class). Operator ground station not located at spawn. Could be inside airport perimeter or nearby residential.',
    },
    waypoints: [
      // Entry from S perimeter, transit toward cargo apron area (N side)
      { lat: 55.6020, lon: 12.6480, alt: 80, heading: 350, tSec: 0   },
      { lat: 55.6080, lon: 12.6460, alt: 80, heading: 355, tSec: 15  },
      { lat: 55.6140, lon: 12.6450, alt: 80, heading: 5,   tSec: 30  },
      { lat: 55.6210, lon: 12.6480, alt: 80, heading: 45,  tSec: 45  },
      { lat: 55.6250, lon: 12.6540, alt: 80, heading: 90,  tSec: 60  },
      // Loiter pattern over cargo apron (~55.622, 12.658) — figure-8
      { lat: 55.6230, lon: 12.6600, alt: 80, heading: 135, tSec: 75  },
      { lat: 55.6210, lon: 12.6620, alt: 80, heading: 180, tSec: 90  },
      { lat: 55.6180, lon: 12.6600, alt: 80, heading: 225, tSec: 105 },
      { lat: 55.6200, lon: 12.6560, alt: 80, heading: 315, tSec: 120 },
      { lat: 55.6230, lon: 12.6580, alt: 80, heading: 45,  tSec: 135 },
      { lat: 55.6250, lon: 12.6620, alt: 80, heading: 90,  tSec: 150 },
      { lat: 55.6230, lon: 12.6660, alt: 80, heading: 135, tSec: 165 },
      { lat: 55.6200, lon: 12.6640, alt: 80, heading: 180, tSec: 180 },
      // Egress E out of airport
      { lat: 55.6180, lon: 12.6700, alt: 90, heading: 100, tSec: 195 },
      { lat: 55.6170, lon: 12.6780, alt: 100, heading: 95, tSec: 210 },
    ],
    durationSec: 210,
  },

  // ── Unauthorized commercial DJI from Kastrup parking lot ──
  //
  // Amateur hobbyist who didn't file a NOTAM. Enters restricted CPH
  // airspace briefly, low altitude, short duration. Real ISR product
  // scenario — most reported airport drone events are hobbyists, not
  // attackers. Populates a different receiver set than either the
  // Shahed (aviation/intel emphasis) or the recon quadcopter (cargo
  // ground evidence emphasis): this one is Politi København + local
  // Trafikstyrelsen only.
  //
  // Classification pipeline: spawns hostile-high (RED, precautionary).
  // Downgrades to hostile-medium (YELLOW) after platform identified
  // as commercial quadcopter. Operator drives manual reclassification
  // to 'resolved' after Politi locates the operator on the ground.
  cph_dji_hobbyist: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'high',
    platform: 'quadcopter',
    droneType: 'DJI Mini 3 (unauthorized hobbyist)',
    dynamicClassification: true,
    mockConfidenceRamp: true,
    confidence: 0.35,
    confidenceTrend: 'Signature fragmentary at spawn. Consumer OcuSync 3 emerging as more sensors align.',
    contributingSensors: [
      { id: 'N08', confidence: 0.44 },
      { id: 'N07', confidence: 0.38 },
      { id: 'N15', confidence: 0.32 },
    ],
    evidence: {
      rfCarrier: '5.180 GHz',
      rfBandwidth: '20 MHz OFDM',
      rfMatch: 'OcuSync 3 (DJI consumer) 68%',
      modality: 'RF + acoustic',
      evidenceSize: '12.6 MB',
      note: 'Small consumer-class DJI. No NOTAM filed for airspace. Operator likely on-airport ground (parking area, terminal frontage). Politi coordinates ground search for pilot.',
    },
    waypoints: [
      // Launch from parking area near CPH terminal frontage (55.6180, 12.6570)
      { lat: 55.6178, lon: 12.6572, alt: 20, heading: 60,  tSec: 0  },
      { lat: 55.6182, lon: 12.6590, alt: 40, heading: 60,  tSec: 6  },
      { lat: 55.6188, lon: 12.6612, alt: 60, heading: 65,  tSec: 12 },
      { lat: 55.6196, lon: 12.6640, alt: 80, heading: 70,  tSec: 18 },
      { lat: 55.6205, lon: 12.6670, alt: 90, heading: 75,  tSec: 24 },
      { lat: 55.6215, lon: 12.6700, alt: 90, heading: 80,  tSec: 30 },
      // Brief hover / photo pass
      { lat: 55.6220, lon: 12.6720, alt: 90, heading: 135, tSec: 40 },
      { lat: 55.6215, lon: 12.6710, alt: 90, heading: 225, tSec: 50 },
      // Return toward launch area
      { lat: 55.6205, lon: 12.6680, alt: 80, heading: 250, tSec: 58 },
      { lat: 55.6195, lon: 12.6640, alt: 60, heading: 250, tSec: 66 },
      { lat: 55.6185, lon: 12.6600, alt: 40, heading: 240, tSec: 74 },
      { lat: 55.6180, lon: 12.6575, alt: 20, heading: 240, tSec: 82 },
      // Ground — operator located by Politi
      { lat: 55.6178, lon: 12.6570, alt: 2,  heading: 240, tSec: 88 },
    ],
    durationSec: 88,
  },

  // ═══════════════════════════════════════════════════════════
  // ESBJERG HARBOUR THREATS
  // ═══════════════════════════════════════════════════════════

  // ── Quadcopter, hostile (over port, from SE approach) ──
  esbjerg_quad_hostile: {
    siteId: 'esbjerg',
    classification: 'hostile',
    threat: 'high',
    platform: 'quadcopter',
    droneType: 'DJI Matrice 300 (port surveillance suspected)',
    confidence: 0.84,
    confidenceTrend: 'Steady climb 0.55 to 0.84',
    contributingSensors: [
      { id: 'N16', confidence: 0.89 },
      { id: 'N14', confidence: 0.83 },
      { id: 'N13', confidence: 0.76 },
      { id: 'N08', confidence: 0.71 },
      { id: 'N11', confidence: 0.00, offline: true },
    ],
    evidence: { rfCarrier: '2.412 GHz', rfBandwidth: '20 MHz OFDM', rfMatch: 'OcuSync 88%', modality: 'RF + acoustic', evidenceSize: '28.4 MB' },
    waypoints: [
      { lat: 55.45000, lon: 8.49000, alt: 100, heading: 315, tSec: 0  },
      { lat: 55.45200, lon: 8.48200, alt: 90,  heading: 315, tSec: 8  },
      { lat: 55.45500, lon: 8.47400, alt: 80,  heading: 300, tSec: 16 },
      { lat: 55.45814, lon: 8.46600, alt: 70,  heading: 285, tSec: 24 },
      { lat: 55.45814, lon: 8.45289, alt: 65,  heading: 270, tSec: 32 },  // Over Port Authority
      { lat: 55.45700, lon: 8.44500, alt: 70,  heading: 250, tSec: 40 },
      { lat: 55.45500, lon: 8.44000, alt: 80,  heading: 200, tSec: 48 },
      { lat: 55.45200, lon: 8.44800, alt: 90,  heading: 135, tSec: 56 },
      { lat: 55.44900, lon: 8.46000, alt: 100, heading: 110, tSec: 64 },
      { lat: 55.44700, lon: 8.47500, alt: 110, heading: 100, tSec: 72 },
      { lat: 55.44600, lon: 8.49000, alt: 120, heading: 95,  tSec: 80 },
    ],
    durationSec: 80,
  },

  // ── USV, hostile (surface vessel drone, low altitude, along Sønderhavn quay) ──
  esbjerg_usv_hostile: {
    siteId: 'esbjerg',
    classification: 'hostile',
    threat: 'high',
    platform: 'quadcopter',   // rendered as quad for now; USV silhouette is a future icon
    droneType: 'Unmanned Surface Vessel (USV, small craft)',
    confidence: 0.71,
    confidenceTrend: 'Late detection, low RCS on water',
    contributingSensors: [
      { id: 'N16', confidence: 0.78 },
      { id: 'N14', confidence: 0.72 },
      { id: 'N15', confidence: 0.68 },
      { id: 'N13', confidence: 0.55 },
    ],
    evidence: { rfCarrier: '433 MHz LoRa telemetry', rfMatch: 'Unknown transmitter, 62% pattern match to naval USV comms', modality: 'RF + acoustic (hull noise)', evidenceSize: '54.2 MB', note: 'Low altitude surface vessel. RF signature extremely small. Detected primarily by acoustic hull signature.' },
    waypoints: [
      { lat: 55.45000, lon: 8.48800, alt: 3,  heading: 285, tSec: 0  },
      { lat: 55.45100, lon: 8.48000, alt: 3,  heading: 285, tSec: 10 },
      { lat: 55.45200, lon: 8.47200, alt: 3,  heading: 285, tSec: 20 },
      { lat: 55.45268, lon: 8.46400, alt: 3,  heading: 270, tSec: 30 },
      { lat: 55.45300, lon: 8.45500, alt: 3,  heading: 260, tSec: 40 },
      { lat: 55.45350, lon: 8.44700, alt: 3,  heading: 250, tSec: 50 },
      { lat: 55.45450, lon: 8.44000, alt: 3,  heading: 200, tSec: 60 },
      { lat: 55.45300, lon: 8.43600, alt: 3,  heading: 180, tSec: 70 },
      { lat: 55.45100, lon: 8.43600, alt: 3,  heading: 165, tSec: 80 },
    ],
    durationSec: 80,
  },

  // ── Fixed-wing, hostile (reconnaissance overflight along coast) ──
  esbjerg_fixedwing_hostile: {
    siteId: 'esbjerg',
    classification: 'hostile',
    threat: 'medium',
    platform: 'fixed-wing',
    droneType: 'Fixed wing reconnaissance (ScanEagle class over Vadehavet)',
    confidence: 0.76,
    confidenceTrend: 'Sustained 0.72 to 0.79',
    contributingSensors: [
      { id: 'N05', confidence: 0.82 },
      { id: 'N03', confidence: 0.77 },
      { id: 'N02', confidence: 0.71 },
      { id: 'N08', confidence: 0.65 },
    ],
    evidence: { rfCarrier: '2.400 GHz', rfBandwidth: '10 MHz FHSS', rfMatch: 'Fixed-wing telemetry 74%', modality: 'RF + acoustic', evidenceSize: '42.8 MB' },
    waypoints: [
      { lat: 55.44000, lon: 8.41000, alt: 480, heading: 20,  tSec: 0  },
      { lat: 55.44700, lon: 8.41400, alt: 470, heading: 20,  tSec: 10 },
      { lat: 55.45500, lon: 8.41800, alt: 460, heading: 20,  tSec: 20 },
      { lat: 55.46300, lon: 8.42200, alt: 450, heading: 20,  tSec: 30 },
      { lat: 55.47100, lon: 8.42600, alt: 440, heading: 20,  tSec: 40 },
      { lat: 55.47900, lon: 8.43000, alt: 430, heading: 20,  tSec: 50 },
      { lat: 55.48700, lon: 8.43400, alt: 420, heading: 20,  tSec: 60 },
    ],
    durationSec: 60,
  },

  // ── Missile from Baltic (cruise-missile from east, direct attack on port infrastructure) ──
  esbjerg_missile_hostile: {
    siteId: 'esbjerg',
    classification: 'hostile',
    threat: 'high',
    platform: 'missile',
    droneType: 'Cruise missile signature (sea launched)',
    confidence: 0.92,
    confidenceTrend: 'Rapid spike 0.28 to 0.92 in 6s',
    contributingSensors: [
      { id: 'N16', confidence: 0.94 },
      { id: 'N14', confidence: 0.93 },
      { id: 'N13', confidence: 0.90 },
      { id: 'N10', confidence: 0.88 },
      { id: 'N08', confidence: 0.85 },
    ],
    evidence: { rfCarrier: 'Passive, no active emitter', modality: 'RF + acoustic + visual', evidenceSize: '198.6 MB', note: 'CRITICAL. Sea launched cruise missile signature. Origin bearing east, likely Baltic launch. All response tiers auto notified. Kystvagten handoff in progress.' },
    waypoints: [
      { lat: 55.45500, lon: 8.55000, alt: 55, heading: 270, tSec: 0  },
      { lat: 55.45500, lon: 8.53500, alt: 50, heading: 270, tSec: 3  },
      { lat: 55.45600, lon: 8.51800, alt: 45, heading: 270, tSec: 6  },
      { lat: 55.45700, lon: 8.50200, alt: 40, heading: 265, tSec: 10 },
      { lat: 55.45800, lon: 8.48500, alt: 35, heading: 265, tSec: 14 },
      { lat: 55.45814, lon: 8.46800, alt: 30, heading: 265, tSec: 18 },
      { lat: 55.45814, lon: 8.45289, alt: 25, heading: 265, tSec: 22 },  // Direct hit vector on Port Authority
      { lat: 55.45900, lon: 8.43800, alt: 20, heading: 260, tSec: 26 },
      { lat: 55.46000, lon: 8.42500, alt: 15, heading: 260, tSec: 28 },
    ],
    durationSec: 28,
  },

  // ═══════════════════════════════════════════════════════════════════
  // BILLUND AIRPORT (BLL / EKBI)
  // Runway 09/27 orientation, single strip. Templates model the four
  // primary threat archetypes plus a Billund-specific LEGO/Legoland
  // adjacency scenario. ARP 55.7405, 9.158 verified via Naviair AIP.
  // ═══════════════════════════════════════════════════════════════════

  // ── Quadcopter, hostile (low pass along the southern apron line) ──
  billund_quad_hostile: {
    siteId: 'billund',
    classification: 'hostile',
    threat: 'high',
    platform: 'quadcopter',
    droneType: 'DJI Matrice 300 RTK',
    confidence: 0.86,
    confidenceTrend: 'Steady climb 0.51 to 0.86',
    contributingSensors: [
      { id: 'BLL-N03', confidence: 0.90 },   // Passenger terminal apron
      { id: 'BLL-N04', confidence: 0.85 },   // Cargo apron CHBA
      { id: 'BLL-N08', confidence: 0.79 },   // Runway centre (Core)
      { id: 'BLL-N07', confidence: 0.72 },   // Runway mid-W
      { id: 'BLL-N02', confidence: 0.64 },   // S apron W
    ],
    evidence: { rfCarrier: '2.412 GHz', rfBandwidth: '20 MHz OFDM', rfMatch: 'OcuSync 89%', modality: 'RF + acoustic + visual', evidenceSize: '31.2 MB', note: 'Quadcopter low pass along the southern apron line, over the CHBA cargo apron and the general-aviation apron. Consistent with tourist / hobbyist NOT complying with restricted airspace, escalated to hostile after refusal to descend.' },
    waypoints: [
      { lat: 55.7360, lon: 9.13800, alt: 110, heading:  75, tSec:  0 },   // Enter SW, cruise altitude
      { lat: 55.7375, lon: 9.14700, alt:  90, heading:  70, tSec:  9 },   // Descend
      { lat: 55.7378, lon: 9.15000, alt:  75, heading:  75, tSec: 16 },   // LOW over W apron
      // NOTE 2026-09-22: this track was laid out against Billund asset
      // positions that were later found to be up to 1.4 km wrong. The
      // verified passenger terminal sits on the NORTH side
      // (55.746014, 9.147362); this southern apron line does not pass
      // over it. The cargo story still holds: the corrected CHBA
      // terminal and cargo apron are both within ~215 m of this path.
      // Left as flown rather than re-routed. To make the terminal
      // overflight real, bend the mid-track north toward 55.7460.
      { lat: 55.7378, lon: 9.15450, alt:  70, heading:  85, tSec: 24 },   // Along southern apron line
      { lat: 55.7378, lon: 9.16000, alt:  70, heading:  90, tSec: 34 },   // Over CHBA cargo apron (highlight #3)
      { lat: 55.7378, lon: 9.16800, alt:  75, heading:  95, tSec: 44 },   // Over GA/business apron
      { lat: 55.7385, lon: 9.17500, alt:  85, heading: 110, tSec: 52 },   // Bank NE, climbing
      { lat: 55.7395, lon: 9.18500, alt: 100, heading: 105, tSec: 62 },   // E protrusion pass-through
      { lat: 55.7400, lon: 9.19200, alt: 115, heading: 100, tSec: 70 },   // Exit E
      { lat: 55.7400, lon: 9.20500, alt: 125, heading:  95, tSec: 80 },
    ],
    durationSec: 80,
  },

  // ── Fixed-wing, hostile (high-alt straight recon pass W to E along runway axis) ──
  billund_fixedwing_hostile: {
    siteId: 'billund',
    classification: 'hostile',
    threat: 'medium',
    platform: 'fixed-wing',
    droneType: 'Fixed-wing reconnaissance UAV (ScanEagle class)',
    confidence: 0.78,
    confidenceTrend: 'Sustained 0.72 to 0.81',
    contributingSensors: [
      { id: 'BLL-N08', confidence: 0.82 },
      { id: 'BLL-N07', confidence: 0.76 },
      { id: 'BLL-N09', confidence: 0.74 },
      { id: 'BLL-N13', confidence: 0.65 },
    ],
    evidence: { rfCarrier: '2.400 GHz', rfBandwidth: '10 MHz FHSS', rfMatch: 'Fixed-wing telemetry 79%', modality: 'RF + acoustic', evidenceSize: '42.6 MB', note: 'Fixed-wing UAV performing east-west overflight along runway 09/27 axis at ~200m AGL. Pattern consistent with runway/airfield mapping mission.' },
    waypoints: [
      { lat: 55.7405, lon: 9.11500, alt: 220, heading:  90, tSec:  0 },
      { lat: 55.7405, lon: 9.13500, alt: 210, heading:  90, tSec: 15 },   // West threshold
      { lat: 55.7405, lon: 9.15500, alt: 200, heading:  90, tSec: 30 },   // Runway centre
      { lat: 55.7405, lon: 9.17500, alt: 205, heading:  90, tSec: 45 },   // East threshold
      { lat: 55.7405, lon: 9.19500, alt: 215, heading:  90, tSec: 60 },
      { lat: 55.7410, lon: 9.21500, alt: 220, heading:  90, tSec: 75 },
    ],
    durationSec: 75,
  },

  // ── SWARM · 4-drone recon over cargo + terminal (main scenario) ──
  // Multi-drone formation crossing the airport E-W with a slow loiter
  // over the CHBA cargo apron (highlight #3). Same multi-site render
  // gate as the CPH swarm so the platform is invisible outside sensor
  // coverage — only visible when inside BLL sensor rings.
  billund_swarm_recon: {
    siteId: 'billund',
    multiSite: true,
    classification: 'hostile',
    threat: 'high',
    platform: 'quadcopter',
    droneType: '4x DJI Matrice formation (recon swarm)',
    confidence: 0.88,
    confidenceTrend: 'Immediate 0.68 to 0.88 (multi-drone RF fingerprint + formation geometry)',
    contributingSensors: [
      { id: 'BLL-N04', confidence: 0.91 },   // Cargo apron (peak dwell zone)
      { id: 'BLL-N08', confidence: 0.87 },   // Runway centre
      { id: 'BLL-N03', confidence: 0.83 },   // Passenger terminal
      { id: 'BLL-N09', confidence: 0.78 },   // GA apron
      { id: 'BLL-N07', confidence: 0.72 },   // Runway mid-W
    ],
    evidence: {
      rfCarrier: '2.412 GHz + 5.745 GHz',
      rfBandwidth: 'OFDM formation link, DJI OcuSync signature',
      rfMatch: 'DJI Matrice 300 formation 88%',
      modality: 'RF + acoustic + visual',
      evidenceSize: '241 MB',
      note: 'CRITICAL. Coordinated 4-drone formation transiting BLL airspace on W-E vector along runway 09/27 axis. Loose diamond pattern, 22 m/s cruise, 100-140 m AGL. Deliberate loiter over CHBA cargo apron (Denmark\'s largest air cargo hub). Pattern consistent with peer-competitor cargo-freight reconnaissance doctrine.',
    },
    swarm: {
      size: 4,
      formation: [
        { role: 'lead',       model: 'DJI Matrice 300 RTK',       rfMHz: 2412, offset: { forward:    0, right:    0, up:   0 } },
        { role: 'wingman-BL', model: 'DJI Matrice 350 RTK',       rfMHz: 2437, offset: { forward: -120, right:  -80, up:  -6 } },
        { role: 'wingman-BR', model: 'DJI Matrice 30T (thermal)', rfMHz: 2462, offset: { forward: -120, right:   80, up:  +5 } },
        { role: 'overwatch',  model: 'Autel EVO II Pro (unknown link)', unidentified: true, rfMHz: 5780, offset: { forward: -240, right: -150, up: +30 } },
      ],
    },
    // W-to-E axis with a dwell segment over CHBA cargo apron
    waypoints: [
      { lat: 55.7400, lon: 9.11500, alt: 140, heading:  90, tSec:  0 },   // ingress from W
      { lat: 55.7405, lon: 9.13000, alt: 130, heading:  85, tSec: 15 },   // enter BLL sensors W
      { lat: 55.7405, lon: 9.14200, alt: 115, heading:  90, tSec: 30 },
      { lat: 55.7395, lon: 9.15500, alt: 105, heading:  95, tSec: 45 },   // over runway centre
      { lat: 55.7378, lon: 9.16000, alt:  95, heading: 100, tSec: 60 },   // descend to cargo apron
      { lat: 55.7378, lon: 9.16200, alt:  85, heading:  90, tSec: 75 },   // LOITER over CHBA
      { lat: 55.7378, lon: 9.16400, alt:  85, heading:  90, tSec: 90 },   // sustained loiter
      { lat: 55.7378, lon: 9.16700, alt:  90, heading:  85, tSec: 105 },
      { lat: 55.7395, lon: 9.17500, alt: 105, heading:  70, tSec: 120 },  // bank NE
      { lat: 55.7420, lon: 9.18500, alt: 120, heading:  60, tSec: 135 },  // E protrusion
      { lat: 55.7445, lon: 9.19500, alt: 130, heading:  55, tSec: 150 },  // exit NE toward Vejle
      { lat: 55.7500, lon: 9.21000, alt: 140, heading:  55, tSec: 165 },
      { lat: 55.7580, lon: 9.23000, alt: 145, heading:  55, tSec: 180 },
    ],
    durationSec: 180,
  },

  // ── SWARM · 3-drone commercial pavement survey, authorised ──
  //
  // The only multi-drone operation in the set that is not an attack, and
  // the reason it exists: 24 of the 27 scenarios before it were hostile.
  // A detection platform that has only ever been shown threats has never
  // been shown declining to raise one, and "does it cry wolf" is the
  // first question an airport asks.
  //
  // Classified friendly rather than a new 'commercial' value. The
  // platform branches on classification in 41 places and styles four
  // values; inventing a fifth would mean touching all of them to express
  // something the taxonomy already covers. An authorised contractor
  // flying a filed job IS friendly here, exactly as the SAS approach is.
  //
  // Classification still arrives with the track, as if from the
  // classifier. Nothing in the C2 decides this is benign by rule.
  //
  // Everything an operator would read is deliberately the opposite of
  // billund_swarm_recon, which crosses the same ground:
  //
  //            commercial survey          hostile recon
  //   formation line abreast, 45 m        loose diamond, 240 m deep
  //   altitude  45 m, constant            85-140 m, varying
  //   speed     12 m/s                    22 m/s
  //   track     inside the fence,         transits W to E, loiters
  //             lawnmower over 09/27      over the cargo apron
  //   RF        one link, licensed band   three bands, one unknown
  //   evidence  flight plan match         no plan, formation geometry
  //
  // The pair is the demonstration. Either one alone proves nothing.
  billund_commercial_survey: {
    siteId: 'billund',
    classification: 'friendly',
    threat: null,
    platform: 'quadcopter',
    droneType: '3x DJI Matrice 350 RTK (pavement survey)',
    confidence: 0.96,
    confidenceTrend: 'Flight plan correlated, operator ID match on first pass',
    contributingSensors: [
      { id: 'BLL-N08', confidence: 0.96 },   // Runway centre, directly under
      { id: 'BLL-N07', confidence: 0.94 },   // Runway mid-W
      { id: 'BLL-N12', confidence: 0.91 },
      { id: 'BLL-N03', confidence: 0.88 },   // Passenger terminal
      { id: 'BLL-N09', confidence: 0.84 },   // GA apron, launch and recovery
    ],
    evidence: {
      rfCarrier: '2.420 GHz',
      rfBandwidth: 'Single OFDM control link per airframe, licensed band',
      rfMatch: 'DJI Matrice 350 RTK 96%, operator ID broadcast present',
      modality: 'RF + acoustic + visual',
      evidenceSize: '118 MB',
      note: 'NO ACTION REQUIRED. Authorised pavement and lighting survey over runway 09/27, filed with the operator and coordinated with ATC. Three airframes line abreast at 45 m separation, 45 m AGL, 12 m/s, flying a lawnmower pattern inside the aerodrome fence. Remote operator ID broadcasting throughout. Logged for audit; no escalation.',
    },
    swarm: {
      size: 3,
      // Line abreast, 45 m apart, no depth. A survey covers adjacent
      // strips in one pass; it has no reason to stack in depth, and that
      // is what separates it from a formation built for overwatch.
      formation: [
        { role: 'survey-lead',  model: 'DJI Matrice 350 RTK', rfMHz: 2420, offset: { forward: 0, right:   0, up: 0 } },
        { role: 'survey-left',  model: 'DJI Matrice 350 RTK', rfMHz: 2420, offset: { forward: 0, right: -45, up: 0 } },
        { role: 'survey-right', model: 'DJI Matrice 350 RTK', rfMHz: 2420, offset: { forward: 0, right:  45, up: 0 } },
      ],
    },
    // Lawnmower over runway 09/27: launch from the GA apron, three
    // passes along the runway axis stepping north each time, recover
    // where it started. Never leaves the aerodrome.
    waypoints: [
      { lat: 55.74150, lon: 9.14600, alt:  0, heading:  90, tSec:   0 },   // GA apron, on the ground
      { lat: 55.74150, lon: 9.14600, alt: 45, heading:  90, tSec:  12 },   // vertical climb to survey height
      { lat: 55.74030, lon: 9.14000, alt: 45, heading: 250, tSec:  28 },   // reposition to W threshold
      { lat: 55.74030, lon: 9.15000, alt: 45, heading:  90, tSec:  55 },   // pass 1, W to E
      { lat: 55.74030, lon: 9.16200, alt: 45, heading:  90, tSec:  85 },
      { lat: 55.74030, lon: 9.17000, alt: 45, heading:  90, tSec: 105 },   // E end of pass 1
      { lat: 55.74055, lon: 9.17100, alt: 45, heading:   0, tSec: 115 },   // step north
      { lat: 55.74055, lon: 9.16200, alt: 45, heading: 270, tSec: 138 },   // pass 2, E to W
      { lat: 55.74055, lon: 9.15000, alt: 45, heading: 270, tSec: 168 },
      { lat: 55.74055, lon: 9.14000, alt: 45, heading: 270, tSec: 193 },   // W end of pass 2
      { lat: 55.74080, lon: 9.13950, alt: 45, heading:   0, tSec: 203 },   // step north
      { lat: 55.74080, lon: 9.15000, alt: 45, heading:  90, tSec: 230 },   // pass 3, W to E
      { lat: 55.74080, lon: 9.16200, alt: 45, heading:  90, tSec: 258 },
      { lat: 55.74080, lon: 9.16900, alt: 45, heading:  90, tSec: 276 },   // E end of pass 3
      { lat: 55.74150, lon: 9.15600, alt: 45, heading: 250, tSec: 305 },   // return to GA apron
      { lat: 55.74150, lon: 9.14600, alt: 30, heading: 270, tSec: 325 },
      { lat: 55.74150, lon: 9.14600, alt:  0, heading: 270, tSec: 338 },   // recovered
    ],
    durationSec: 338,
  },

  // ── Cruise missile (low altitude ingress from S, hits runway) ──
  billund_missile_hostile: {
    siteId: 'billund',
    classification: 'hostile',
    threat: 'high',
    platform: 'missile',
    droneType: 'Cruise missile signature (unknown class)',
    confidence: 0.94,
    confidenceTrend: 'Rapid spike 0.32 to 0.94 in 5s',
    contributingSensors: [
      { id: 'BLL-N02', confidence: 0.96 },
      { id: 'BLL-N01', confidence: 0.93 },
      { id: 'BLL-N08', confidence: 0.92 },
      { id: 'BLL-N06', confidence: 0.89 },
    ],
    evidence: { rfCarrier: 'Passive, no active emitter', modality: 'RF + acoustic + visual', evidenceSize: '162 MB', note: 'CRITICAL. Cruise missile signature transiting BLL from S at 40m AGL. Bearing 000° consistent with direct impact on runway 09/27. No transponder, no comms.' },
    waypoints: [
      { lat: 55.7180, lon: 9.15800, alt:  40, heading:   0, tSec:  0 },   // ingress from S at low alt
      { lat: 55.7280, lon: 9.15800, alt:  35, heading:   0, tSec:  6 },
      { lat: 55.7360, lon: 9.15800, alt:  30, heading:   0, tSec: 12 },
      { lat: 55.7400, lon: 9.15800, alt:  25, heading:   0, tSec: 18 },   // impact runway centre
    ],
    durationSec: 18,
  },

  // ── LEGO adjacency recon (drone crosses BLL airspace en route to LEGO HQ/Legoland) ──
  // Unique to Billund: adjacent to strategic Danish enterprise sites.
  // The drone is not targeting BLL itself; it's transiting BLL sensors
  // on its way to overfly LEGO HQ (~2km S) and Legoland Resort. Tests
  // the platform's ability to classify "transit through" vs "targeting"
  // and to route the alert to LEGO corporate security (out-of-scope
  // for BLL but relevant for the cross-agency picture).
  // ── Shahed up the spine of Jutland, Billund to Skagen ────────────
  //
  // Enters 5 km west of Billund and runs due north, passing 11 km off
  // Flyvestation Karup, which is where the helicopter lives. So a
  // dispatched Seahawk launches straight down the track at it and the
  // two close head-on, which is the point: it is the only Billund route
  // that puts a helicopter and a threat in the same piece of sky.
  //
  // It exits over Skagen. If nothing intercepts it, it simply leaves at
  // the top of Jutland and the track ends there rather than detonating:
  // no terminalImpact, because this is a transit, not a strike on a
  // site.
  //
  // Speeds are SOURCED, not chosen. The family splits sharply: piston
  // Gerans sit near 180 km/h and jet Gerans at 320 and above, a step of
  // roughly 3x rather than a gradient, which is what makes one route at
  // several speeds worth having.
  //
  // All jet-variant performance originates from Ukrainian Defence
  // Intelligence and is not independently verified. The Geran-4 engine
  // is the exception, confirmed by trade press from a captured
  // airframe. Retrieved October 2026, and that portal revises pages in
  // place, which is why the date is written down.
  billund_geran2_north: {
    siteId: 'billund',
    // Spawns ~4 km south of BLL-N01, outside every ring. Undetected
    // and invisible until it crosses into coverage, detected on
    // entry, closed on exit by the ordinary single-site chain.
    coverageGated: true,
    // Keeps flying after Billund's case closes, so the red dashed
    // breadcrumb continues out along its route instead of freezing at
    // the coverage edge. The event still closes and the icon still
    // hides: what continues is the unobserved-path line, not the
    // detection. See _trackContinuesAfterClose in main.js.
    continueAfterClose: true,
    classification: 'hostile',
    threat: 'high',
    platform: 'loitering-munition',
    droneType: 'Shahed-136 / Geran-2 (loitering munition)',
    confidence: 0.74,
    confidenceTrend: 'Acoustic piston signature + RF, climbing 0.52 to 0.74',
    contributingSensors: [
      { id: 'BLL-N01', confidence: 0.77 },
      { id: 'BLL-N02', confidence: 0.71 },
      { id: 'BLL-N07', confidence: 0.64 },
    ],
    evidence: {
      rfCarrier: '1616 MHz Iridium + 900 MHz cellular', rfBandwidth: 'narrowband burst',
      rfMatch: 'Geran-2 control signature 81%', modality: 'acoustic + RF',
      evidenceSize: '27.9 MB',
      note: 'Transit north up the Jutland spine, west of Billund and past Karup. '
        + 'Not a strike on the airport: it overflies and continues, which is why '
        + 'the airport sees it briefly and the interceptor has to go and get it.',
    },
    waypoints: [
      { lat: 55.7000, lon: 9.1300, alt: 600, heading: 356, tSec: 0 },
      { lat: 55.8200, lon: 9.1150, alt: 750, heading: 357, tSec: 260 },
      { lat: 56.0000, lon: 9.1000, alt: 900, heading: 358, tSec: 650 },
      { lat: 56.2000, lon: 9.1182, alt: 900, heading: 0, tSec: 1083 },
      { lat: 56.4200, lon: 9.1182, alt: 900, heading: 4, tSec: 1559 },
      { lat: 56.6500, lon: 9.1200, alt: 900, heading: 10, tSec: 2058 },
      { lat: 56.9000, lon: 9.2000, alt: 900, heading: 18, tSec: 2607 },
      { lat: 57.1500, lon: 9.3500, alt: 850, heading: 28, tSec: 3176 },
      { lat: 57.4000, lon: 9.6000, alt: 800, heading: 36, tSec: 3791 },
      { lat: 57.6200, lon: 9.9000, alt: 750, heading: 71, tSec: 4381 },
      { lat: 57.7400, lon: 10.5800, alt: 700, heading: 71, tSec: 5210 },
    ],
    durationSec: 5210,
  },

  // Purpose-built Russian jet airframe. NOT a Shahed derivative and it
  // carries no Shahed number, so it is not given one: it was designed
  // around its engine after the Geran-2 airframe proved too weak for jet
  // G loads. It is the only Geran with an official cruise figure cleanly
  // separated from maximum speed, which is why it is modelled at cruise
  // rather than at a headline number.
  //
  // Geran-3 was here and has been dropped. Its published speeds span 330
  // to 600 km/h across sources, its own official page carries no
  // specification table at all, and production is reported halted as of
  // August 2026. There was no figure to stand behind.
  billund_geran4_north: {
    siteId: 'billund',
    // Spawns ~4 km south of BLL-N01, outside every ring. Undetected
    // and invisible until it crosses into coverage, detected on
    // entry, closed on exit by the ordinary single-site chain.
    coverageGated: true,
    // Keeps flying after Billund's case closes, so the red dashed
    // breadcrumb continues out along its route instead of freezing at
    // the coverage edge. The event still closes and the icon still
    // hides: what continues is the unobserved-path line, not the
    // detection. See _trackContinuesAfterClose in main.js.
    continueAfterClose: true,
    classification: 'hostile',
    threat: 'high',
    platform: 'loitering-munition',
    droneType: 'Geran-4 (jet loitering munition)',
    confidence: 0.71,
    confidenceTrend: 'Turbojet acoustic signature, no piston harmonics',
    contributingSensors: [
      { id: 'BLL-N01', confidence: 0.74 },
      { id: 'BLL-N02', confidence: 0.68 },
      { id: 'BLL-N07', confidence: 0.61 },
    ],
    evidence: {
      rfCarrier: '1616 MHz Iridium', rfBandwidth: 'narrowband burst',
      rfMatch: 'Geran family modem signature 76%', modality: 'acoustic + RF',
      evidenceSize: '24.1 MB',
      note: 'Jet loitering munition. Cruise 320 km/h, maximum 450 to 500, '
        + '3.6 m long, 3.05 m span, 90 kg warhead. Chinese Telefly TF-TJ2000A '
        + 'turbojet, confirmed by trade press from a captured airframe. '
        + 'Performance figures: Ukrainian Defence Intelligence, Oct 2026.',
    },
    waypoints: [
      { lat: 55.7000, lon: 9.1300, alt: 600, heading: 356, tSec: 0 },
      { lat: 55.8200, lon: 9.1150, alt: 750, heading: 357, tSec: 150 },
      { lat: 56.0000, lon: 9.1000, alt: 900, heading: 358, tSec: 376 },
      { lat: 56.2000, lon: 9.1182, alt: 900, heading: 0, tSec: 626 },
      { lat: 56.4200, lon: 9.1182, alt: 900, heading: 4, tSec: 901 },
      { lat: 56.6500, lon: 9.1200, alt: 900, heading: 10, tSec: 1190 },
      { lat: 56.9000, lon: 9.2000, alt: 900, heading: 18, tSec: 1507 },
      { lat: 57.1500, lon: 9.3500, alt: 850, heading: 28, tSec: 1836 },
      { lat: 57.4000, lon: 9.6000, alt: 800, heading: 36, tSec: 2192 },
      { lat: 57.6200, lon: 9.9000, alt: 750, heading: 71, tSec: 2533 },
      { lat: 57.7400, lon: 10.5800, alt: 700, heading: 71, tSec: 3012 },
    ],
    durationSec: 3012,
  },

  // Fastest documented of the family, and a different shape again: it
  // drops the delta wing for a cruise-missile layout, cylindrical body
  // and straight wings at 6.5 m. Also no Shahed equivalent.
  //
  // Modelled at 525 km/h, the middle of the official 450 to 600 cruise
  // band. Worth knowing that a Geran-5 was engaged over Chernihiv at a
  // measured 425, below the published band, so real engagements can run
  // slower than the figures suggest.
  billund_geran5_north: {
    siteId: 'billund',
    // Spawns ~4 km south of BLL-N01, outside every ring. Undetected
    // and invisible until it crosses into coverage, detected on
    // entry, closed on exit by the ordinary single-site chain.
    coverageGated: true,
    // Keeps flying after Billund's case closes, so the red dashed
    // breadcrumb continues out along its route instead of freezing at
    // the coverage edge. The event still closes and the icon still
    // hides: what continues is the unobserved-path line, not the
    // detection. See _trackContinuesAfterClose in main.js.
    continueAfterClose: true,
    classification: 'hostile',
    threat: 'high',
    platform: 'loitering-munition',
    droneType: 'Geran-5 (jet cruise-missile layout)',
    confidence: 0.69,
    confidenceTrend: 'High-subsonic turbojet, no delta-wing acoustic return',
    contributingSensors: [
      { id: 'BLL-N01', confidence: 0.72 },
      { id: 'BLL-N02', confidence: 0.66 },
      { id: 'BLL-N07', confidence: 0.58 },
    ],
    evidence: {
      rfCarrier: '1616 MHz Iridium', rfBandwidth: 'narrowband burst',
      rfMatch: 'Geran family modem signature 71%', modality: 'acoustic + RF',
      evidenceSize: '22.6 MB',
      note: 'Jet, cruise-missile layout. Cruise 450 to 600 km/h, 6.5 m long with a '
        + '3.2 m span, 90 kg warhead, Telefly TF-TJ2000A turbojet, catapult '
        + 'launched. Interception rates against jet Gerans are reported far lower '
        + 'than against piston ones. Figures: Ukrainian Defence Intelligence, '
        + 'Oct 2026.',
    },
    waypoints: [
      { lat: 55.7000, lon: 9.1300, alt: 600, heading: 356, tSec: 0 },
      { lat: 55.8200, lon: 9.1150, alt: 750, heading: 357, tSec: 92 },
      { lat: 56.0000, lon: 9.1000, alt: 900, heading: 358, tSec: 229 },
      { lat: 56.2000, lon: 9.1182, alt: 900, heading: 0, tSec: 382 },
      { lat: 56.4200, lon: 9.1182, alt: 900, heading: 4, tSec: 549 },
      { lat: 56.6500, lon: 9.1200, alt: 900, heading: 10, tSec: 725 },
      { lat: 56.9000, lon: 9.2000, alt: 900, heading: 18, tSec: 919 },
      { lat: 57.1500, lon: 9.3500, alt: 850, heading: 28, tSec: 1119 },
      { lat: 57.4000, lon: 9.6000, alt: 800, heading: 36, tSec: 1336 },
      { lat: 57.6200, lon: 9.9000, alt: 750, heading: 71, tSec: 1544 },
      { lat: 57.7400, lon: 10.5800, alt: 700, heading: 71, tSec: 1836 },
    ],
    durationSec: 1836,
  },

  billund_lego_recon: {
    siteId: 'billund',
    classification: 'unknown',
    threat: 'medium',
    platform: 'quadcopter',
    droneType: 'DJI Mavic 3 (corporate recon suspected)',
    confidence: 0.71,
    confidenceTrend: 'Held 0.65 to 0.74',
    contributingSensors: [
      { id: 'BLL-N01', confidence: 0.78 },   // SW perimeter (near Legoland vector)
      { id: 'BLL-N06', confidence: 0.72 },
      { id: 'BLL-N12', confidence: 0.68 },
      { id: 'BLL-N02', confidence: 0.61 },
    ],
    evidence: { rfCarrier: '2.400 GHz', rfBandwidth: '10 MHz OcuSync', rfMatch: 'DJI Mavic 3 74%', modality: 'RF + visual', evidenceSize: '38.4 MB', note: 'Drone transits BLL sensor coverage briefly on SW vector, exits airspace toward LEGO Group HQ / Legoland Resort. Not targeting airport assets. Alert relevant for LEGO corporate security + Sydøstjyllands Politi.' },
    waypoints: [
      { lat: 55.7440, lon: 9.14000, alt: 90, heading: 200, tSec:  0 },   // enter NW
      { lat: 55.7405, lon: 9.13500, alt: 80, heading: 210, tSec: 12 },   // brief BLL cov crossing
      { lat: 55.7370, lon: 9.13000, alt: 75, heading: 215, tSec: 22 },
      { lat: 55.7340, lon: 9.12500, alt: 65, heading: 220, tSec: 32 },   // exit BLL SW
      { lat: 55.7310, lon: 9.12000, alt: 55, heading: 220, tSec: 42 },   // approach LEGO HQ area (out-of-cov)
      { lat: 55.7280, lon: 9.11500, alt: 50, heading: 220, tSec: 52 },   // over Legoland vector
    ],
    durationSec: 52,
  },
};

// TWO-TIER SCENARIO — single continuous cruise missile track.
// Detected at Kassø, transits blind through central Denmark (sensor gap),
// re-acquired at CPH airport, neutralised by F-35 at intercept station.
// ONE event, ONE ID, ONE missile. Total ~100 sec demo time.
Object.assign(TEMPLATES, {
  cruise_missile_to_amalienborg: {
    siteId: 'energinet_kassoe',
    classification: 'hostile',
    threat: 'high',
    platform: 'missile',
    droneType: 'Cruise missile signature → Copenhagen approach vector',
    confidence: 0.94,
    confidenceTrend: 'Immediate high confidence 0.72 to 0.94 (multi sensor)',
    contributingSensors: [
      { id: 'KAS-N01', confidence: 0.96 },
      { id: 'KAS-N02', confidence: 0.95 },
      { id: 'KAS-N03', confidence: 0.93 },
      { id: 'KAS-N04', confidence: 0.91 },
      { id: 'KAS-N05', confidence: 0.89 },
    ],
    evidence: {
      rfCarrier: 'Passive, no active emitter',
      modality: 'RF + acoustic + visual',
      evidenceSize: '246.8 MB',
      note: 'CRITICAL. Cruise missile signature transiting Kassø. Bearing consistent with Copenhagen approach vector. Cross cued to downstream infra.',
    },
    // CONSTANT VELOCITY end to end. Total path length ~236 km, duration 300 s
    // → constant speed ~0.78 km/s. That is still ~3x realtime Mach 0.8 (a
    // real Tomahawk is 275 m/s) but slow enough that a viewer can actually
    // watch the missile CROSS each sensor site (Kassø / Bjæverskov / CPH
    // airport) instead of blinking through in a single frame. Segment tSec
    // is proportional to segment distance so the pace never jumps.
    //
    // Start point is intentionally OUTSIDE sensor visibility (~5 km SW of
    // Kassø) so the operator sees the track fly IN to Kassø from off screen
    // rather than materialising already inside coverage.
    waypoints: [
      // Missile flies a STRAIGHT LINE from off-screen approach through
      // Kassø, holding heading ~62° NE for the full Kassø visibility
      // window (t=0-11). The evasion pivot happens deep inside the sensor
      // gap at t=18 — well after Kassø signal is lost — so operators see
      // the projection frozen at 62° until Bjæverskov re-acquires and
      // reveals the missile's new NE-to-CPH course.
      { lat: 55.001, lon: 9.191,   alt: 120, heading: 59, tSec: 0    },  // off-screen approach
      { lat: 55.037, lon: 9.270,   alt: 80,  heading: 59, tSec: 8    },  // over Kassø centre (F-35 captures this heading — tuned so intercept lands inside CPH sensor range)
      { lat: 55.068, lon: 9.338,   alt: 90,  heading: 59, tSec: 15   },  // post-Kassø exit, same heading line
      { lat: 55.086, lon: 9.400,   alt: 90,  heading: 78, tSec: 18   },  // EVASION PIVOT (invisible in gap) — new heading toward Bjæverskov
      { lat: 55.451, lon: 12.007,  alt: 80,  heading: 78, tSec: 240  },  // Bjæverskov centre — pivot revealed on re-acquisition
      { lat: 55.618, lon: 12.647,  alt: 60,  heading: 45, tSec: 298  },  // OVER CPH airport centre
      { lat: 55.651, lon: 12.620,  alt: 40,  heading: 348, tSec: 303 }, // intercept, Islands Brygge / Refshaleøen
    ],
    durationSec: 303,
  },
});

// Continuation track: cruise missile re-detected on approach to CPH airspace
// after transiting a Jutland/Zealand substation site. Comes from SW (bearing
// ~73° from Kassø → CPH), overflies CPH airport, continues NNE toward
// Amalienborg. Same platform class as the Kassø-detected missile — narrative
// pairing for the two-tier demo (light response at Kassø → hard response here).
Object.assign(TEMPLATES, {
  cph_missile_inbound_sw: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'high',
    platform: 'missile',
    droneType: 'Cruise missile signature (SS-N-30 class), continuation track',
    confidence: 0.96,
    confidenceTrend: 'Immediate high confidence 0.88 to 0.96 (multi sensor cued)',
    contributingSensors: [
      { id: 'N09', confidence: 0.97 },
      { id: 'N08', confidence: 0.96 },
      { id: 'N15', confidence: 0.94 },
      { id: 'N16', confidence: 0.91 },
      { id: 'N07', confidence: 0.89 },
    ],
    evidence: {
      rfCarrier: 'Passive, no active emitter',
      modality: 'RF + acoustic + visual',
      evidenceSize: '212.8 MB',
      note: 'CRITICAL. Same platform class as prior Kassø detection. Bearing consistent with continuation vector. Copenhagen impact projected. All response tiers dispatched, QRA scramble authorised.',
    },
    // Smooth continuous curve — starts ~13km SW of CPH, passes over CPH
    // Airport, curves NNW toward Amalienborg. Heading rotates gradually
    // from 45° at start to 340° at end (60° left turn spread across ~75s
    // at cruise-missile speed, ~1° per second — physically plausible).
    // No sharp 90° kinks, no perimeter re-entry.
    waypoints: [
      { lat: 55.50000, lon: 12.58000, alt: 110, heading: 45, tSec: 0  },
      { lat: 55.52800, lon: 12.60300, alt: 100, heading: 40, tSec: 8  },
      { lat: 55.55400, lon: 12.62400, alt: 90,  heading: 35, tSec: 16 },
      { lat: 55.57900, lon: 12.64100, alt: 85,  heading: 25, tSec: 24 },
      { lat: 55.60100, lon: 12.65200, alt: 80,  heading: 15, tSec: 32 },
      { lat: 55.61800, lon: 12.64700, alt: 75,  heading: 5,  tSec: 38 },  // over CPH airport
      { lat: 55.63400, lon: 12.63800, alt: 65,  heading: 355, tSec: 45 },
      { lat: 55.64900, lon: 12.62600, alt: 55,  heading: 350, tSec: 52 },
      { lat: 55.66300, lon: 12.61100, alt: 45,  heading: 345, tSec: 59 },
      { lat: 55.67600, lon: 12.59800, alt: 35,  heading: 340, tSec: 66 },
      { lat: 55.68400, lon: 12.59300, alt: 30,  heading: 340, tSec: 72 },  // near Amalienborg
    ],
    durationSec: 72,
  },
});

// Keep old export slot for the original CPH cruise-missile template.
Object.assign(TEMPLATES, {
  cph_missile_hostile: {
    siteId: 'cph',
    classification: 'hostile',
    threat: 'high',
    platform: 'missile',
    droneType: 'Cruise missile signature (SS-N-30 class)',
    confidence: 0.94,
    confidenceTrend: 'Rapid spike 0.30 to 0.94 in 8s',
    contributingSensors: [
      { id: 'N08', confidence: 0.96 },
      { id: 'N15', confidence: 0.94 },
      { id: 'N16', confidence: 0.91 },
      { id: 'N20', confidence: 0.88 },
      { id: 'N07', confidence: 0.85 },
    ],
    evidence: { rfCarrier: 'Passive, no active emitter', modality: 'RF + acoustic + visual', evidenceSize: '176.4 MB', note: 'CRITICAL. Cruise missile class signature confirmed. All response tiers auto notified. Handoff to Flyvevåbnet QRA in progress.' },
    waypoints: [
      { lat: 55.58500, lon: 12.68500, alt: 60, heading: 315, tSec: 0  },
      { lat: 55.59000, lon: 12.67400, alt: 55, heading: 315, tSec: 3  },
      { lat: 55.59700, lon: 12.66000, alt: 50, heading: 315, tSec: 7  },
      { lat: 55.60400, lon: 12.64700, alt: 45, heading: 315, tSec: 11 },
      { lat: 55.61100, lon: 12.63400, alt: 40, heading: 315, tSec: 15 },
      { lat: 55.61800, lon: 12.62100, alt: 35, heading: 315, tSec: 19 },
      { lat: 55.62500, lon: 12.60800, alt: 30, heading: 315, tSec: 23 },
      { lat: 55.63200, lon: 12.59500, alt: 25, heading: 315, tSec: 27 },
      { lat: 55.63900, lon: 12.58200, alt: 20, heading: 315, tSec: 30 },
    ],
    durationSec: 30,
  },
});

// ── SWARM RECON SCENARIO ──
// 5-drone coordinated formation. Ingress from Øresund (E), cross CPH airport
// (60s over runway 04L), transit NW ~4 km, cross Amager Koblingsstation
// (60s over the substation), egress NE back to Øresund. Two cross-linked
// events: CPH fires first at t=30, AMK fires at t=115 while CPH is still
// active. Peer competitor / state-actor recon doctrine.
//
// Template extensions vs. standard drone:
//   swarm.size          — number of drones in formation (5)
//   swarm.formation     — role + offset (metres forward/right of lead) per drone
//   secondEvent         — auto-spawn a second event at a specific tSec
Object.assign(TEMPLATES, {
  swarm_recon_cph_amk: {
    // PRIMARY event fires at spawn — this is the CPH detection.
    siteId: 'cph',
    // multiSite=true triggers the "sensors observe only" render gate: the
    // formation is invisible outside sensor coverage, only the projected
    // trajectory line is drawn as a simulation debug aid. Same behaviour
    // as the cruise missile scenario across Kassø/Bjæverskov/CPH.
    multiSite: true,
    classification: 'hostile',
    threat: 'high',
    platform: 'quadcopter',
    droneType: '5x DJI Matrice formation (recon swarm)',
    confidence: 0.89,
    confidenceTrend: 'Immediate 0.72 to 0.89 (multi-drone RF fingerprint + formation geometry)',
    contributingSensors: [
      { id: 'N16', confidence: 0.91 },   // CPH Central Apron
      { id: 'N17', confidence: 0.87 },   // CPH Central E Airside
      { id: 'N20', confidence: 0.83 },   // CPH N Central Airside
      { id: 'N09', confidence: 0.76 },   // CPH SW Airside
      { id: 'N07', confidence: 0.71 },   // CPH W perimeter
    ],
    evidence: {
      rfCarrier: '2.412 GHz + 5.745 GHz',
      rfBandwidth: 'OFDM formation link, DJI OcuSync signature',
      rfMatch: 'DJI Matrice 300 formation 89%',
      modality: 'RF + acoustic + visual',
      evidenceSize: '287 MB',
      note: 'CRITICAL. Coordinated 5-drone formation crossing CPH airport airspace on E-W vector. Loose V pattern, 25 m/s cruise, 120 m AGL. Approach from Øresund. Recon profile: predictable pass over runway 04L, continues NW toward mainland Amager. Pattern consistent with peer-competitor reconnaissance doctrine.',
    },
    // 5-drone loose-V formation. Offsets are relative to lead drone in the
    // ground frame: `forward` = along heading vector, `right` = perpendicular
    // to heading (positive = starboard). Rotated per-frame by current heading.
    swarm: {
      size: 5,
      formation: [
        // Per-drone identity (model + RF channel). Real swarms often mix
        // platforms — command M300, cheaper M350 wingmen, thermal M30T,
        // Mavic scout. RF channels spread across DJI OcuSync bands so
        // each drone has a distinguishable emitter signature.
        { role: 'lead',       model: 'DJI Matrice 300 RTK',           rfMHz: 2412, offset: { forward:    0, right:    0, up:   0 } },
        { role: 'wingman-BL', model: 'DJI Matrice 350 RTK',           rfMHz: 2437, offset: { forward: -150, right: -100, up:  -8 } },
        { role: 'wingman-BR', model: 'DJI Matrice 30T (thermal)',     rfMHz: 2462, offset: { forward: -150, right:  100, up:  +5 } },
        // Rogue non-DJI OVERWATCH airframe — foreign / unknown control link,
        // maintains high-altitude oversight of the swarm below (real recon
        // doctrine: overwatch drone monitors friendly airframes + provides
        // situational awareness). Flies +25m base and periodically climbs
        // another +40-70m so it hangs ~50-100% above the pack during ingress.
        // RF fingerprint doesn't match any commercial DJI band. Confidence
        // stays in the weak band so the replay + debrief trail colour-codes
        // red/yellow — surfaces "the one drone we never positively identified"
        // story visually + explains WHY it flies differently.
        { role: 'overwatch',  model: 'Autel EVO II Pro (unknown link)', unidentified: true, rfMHz: 5780, offset: { forward: -300, right: -200, up: +25 } },
        { role: 'outer-BR',   model: 'DJI Matrice 350 RTK',           rfMHz: 5825, offset: { forward: -300, right:  200, up:  -6 } },
      ],
    },
    // Lead drone trajectory — S-shape reconnaissance pattern.
    // Ingress from Øresund E at cruise altitude, then dives to low
    // altitude for detailed passes over east cargo apron + Pier E
    // (SAS long-haul stands) + westward sweep across Schengen piers,
    // climbs and banks NW toward Amager Koblingsstation. Deliberate
    // recon behaviour reads clearly: "sustained inspection of
    // high-value assets" not "casual overflight".
    // ~5 min total, 25 m/s average, ~7.5 km path.
    waypoints: [
      { lat: 55.6050, lon: 12.7600, alt: 120, heading: 260, tSec:   0 },  // off-screen ingress, Øresund E — normal cruise
      { lat: 55.6180, lon: 12.6800, alt: 110, heading: 265, tSec:  25 },  // enter CPH sensors E, begin descent

      // Low-altitude S-shape recon over the EAST cargo apron (DHL / FedEx / WFS on Kystvejen)
      { lat: 55.6210, lon: 12.6700, alt:  70, heading: 275, tSec:  42 },  // descend over east cargo — DHL/FedEx assessment start
      { lat: 55.6215, lon: 12.6620, alt:  55, heading: 255, tSec:  58 },  // LOW pass over Apron East (cargo aircraft detail)

      // Curve NW-then-W into the passenger pier belt at very low altitude
      { lat: 55.6260, lon: 12.6580, alt:  50, heading: 250, tSec:  75 },  // LOW over Pier E (SAS long-haul widebody stands E1-E7)
      { lat: 55.6272, lon: 12.6500, alt:  50, heading: 260, tSec:  92 },  // LOW over Piers C/D (mixed non-Schengen)
      { lat: 55.6275, lon: 12.6420, alt:  55, heading: 265, tSec: 108 },  // LOW over Pier B (Schengen)
      { lat: 55.6278, lon: 12.6350, alt:  65, heading: 275, tSec: 122 },  // starting to climb toward Pier A / Terminal 2

      // Climb and bank NW toward Amager Koblingsstation — begin egress from CPH
      { lat: 55.6295, lon: 12.6280, alt:  85, heading: 305, tSec: 138 },  // climbing, banking NW
      { lat: 55.6320, lon: 12.6220, alt: 100, heading: 320, tSec: 152 },  // approach CPH NW exit
      { lat: 55.6347, lon: 12.6175, alt: 115, heading: 320, tSec: 160 },  // OVERLAP SLIVER — inside both CPH N22 and AMK-N01 rings, seamless handover
      { lat: 55.6380, lon: 12.6120, alt: 120, heading: 315, tSec: 168 },  // fully inside AMK coverage
      { lat: 55.6410, lon: 12.6088, alt: 120, heading: 315, tSec: 190 },  // over AMK substation, peak AMK detection

      // Egress from AMK back toward Øresund
      { lat: 55.6440, lon: 12.6140, alt: 120, heading:  40, tSec: 220 },  // exiting AMK sensors NE
      { lat: 55.6480, lon: 12.6400, alt: 120, heading:  75, tSec: 250 },  // transit over N Amager
      { lat: 55.6500, lon: 12.6800, alt: 120, heading:  90, tSec: 280 },  // approaching Øresund
      { lat: 55.6500, lon: 12.7600, alt: 120, heading:  90, tSec: 300 },  // exit off-screen, Øresund E
    ],
    durationSec: 300,
    // Second event auto-fires when lead crosses AMK sensor coverage (t=115).
    // Cross-linked back to the primary CPH event via linkedEventId at spawn.
    secondEvent: {
      triggerAtSec: 115,
      siteId: 'energinet_amager_koblingsstation',
      classification: 'hostile',
      threat: 'high',
      platform: 'quadcopter',
      droneType: '5x DJI Matrice formation (recon swarm) — cross-cued from CPH',
      confidence: 0.94,
      confidenceTrend: 'High confidence 0.94 on entry (RF fingerprint pre-loaded from CPH detection)',
      contributingSensors: [
        { id: 'AMK-N04', confidence: 0.94 },
        { id: 'AMK-N07', confidence: 0.92 },
        { id: 'AMK-N03', confidence: 0.88 },
        { id: 'AMK-N05', confidence: 0.85 },
        { id: 'AMK-N01', confidence: 0.79 },
      ],
      evidence: {
        rfCarrier: '2.412 GHz + 5.745 GHz',
        rfBandwidth: 'OFDM formation link (matches CPH signature)',
        rfMatch: 'DJI Matrice 300 formation 94%',
        modality: 'RF + acoustic + visual',
        evidenceSize: '312 MB',
        note: 'CRITICAL. Signature and formation profile match track from CPH Airport (SWARM-CPH, ~90s prior). Egress vector confirmed toward NE. Cross-cued detection. Same 5-drone V-formation. Site under active surveillance by state-level actor.',
      },
    },
  },
});

// ── NON-IDENTIFIABLE CONTACT SCENARIO ──
// Slow low-altitude craft crossing CPH N perimeter. Sensors register RF
// energy + partial acoustic but no signature lock. Consistent with the
// fall-2024 Danish airport incursions where multiple unidentified craft
// were tracked without positive platform ID. Exercises:
//   - The system-wide auto-detect rule (fires on first coverage entry)
//   - The 'non-identifiable' platform symbol (dashed diamond + "?")
//   - Classification 'unknown' independent of platform (both axes at once)
// Loiter behaviour over NE bulge, drift SW across the N face, egress SW.
Object.assign(TEMPLATES, {
  cph_unknown_contact: {
    siteId: 'cph',
    classification: 'unknown',
    threat: null,
    platform: 'non-identifiable',
    droneType: 'Non-identifiable contact (pending classification)',
    confidence: 0.68,
    confidenceTrend: 'Sustained 0.60 to 0.68 across 3 sensors, no signature lock',
    contributingSensors: [
      { id: 'N24', confidence: 0.71 },   // NE Perimeter Corner (first contact)
      { id: 'N23', confidence: 0.66 },   // N Perimeter Bulge (transit)
      { id: 'N05', confidence: 0.58 },   // N maintenance (weak)
      { id: 'N20', confidence: 0.52 },   // N Central Airside (edge)
    ],
    evidence: {
      rfCarrier: '2.400 GHz (fragmented)',
      rfBandwidth: 'Non-standard modulation, no signature match',
      rfMatch: 'Unmatched (0% against known threat library)',
      modality: 'RF only + weak acoustic',
      evidenceSize: '43.2 MB',
      note: 'Non-identifiable contact. RF energy detected in 2.4 GHz ISM band but modulation does not match any signature in threat library (DJI, Skydio, Parrot, mil-COTS). Acoustic signature partial, single-rotor pattern possible. No visual acquisition. Loiter behavior over CPH N perimeter. Classification pending analyst review. Could be home-built RC, modified consumer platform, or peer-competitor payload.',
    },
    waypoints: [
      { lat: 55.6405, lon: 12.6650, alt:  55, heading: 200, tSec:   0 },  // ingress edge, N24 catches
      { lat: 55.6360, lon: 12.6635, alt:  50, heading: 200, tSec:  15 },  // inside N24 core
      { lat: 55.6320, lon: 12.6620, alt:  45, heading: 210, tSec:  30 },  // loiter over NE bulge
      { lat: 55.6320, lon: 12.6580, alt:  50, heading: 270, tSec:  45 },  // turn west (loiter)
      { lat: 55.6315, lon: 12.6540, alt:  55, heading: 270, tSec:  60 },  // mid transit
      { lat: 55.6300, lon: 12.6500, alt:  60, heading: 250, tSec:  75 },  // passing N23
      { lat: 55.6280, lon: 12.6460, alt:  65, heading: 230, tSec:  90 },  // approaching N central
      { lat: 55.6250, lon: 12.6420, alt:  70, heading: 220, tSec: 105 },  // exiting perimeter SW
      { lat: 55.6210, lon: 12.6380, alt:  80, heading: 220, tSec: 120 },  // sensor edge egress
      { lat: 55.6170, lon: 12.6320, alt: 100, heading: 250, tSec: 140 },  // off-screen
    ],
    durationSec: 140,
  },
});

// ── Substation threat factory ──
// Substation sites are small (~300m). Generate 3 threat variants for each
// with waypoints approaching the site center from ~4km out.
function bearingOffset(lat, lon, bearingDeg, distanceKm) {
  const R = 6371;
  const b = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const d = distanceKm / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}
// Waypoints that approach the site from `startKm` out on the given bearing,
// pass THROUGH the site center, and continue `exitKm` past on the same heading.
// Total path = startKm + exitKm. The exit tail lets the coverage-loss and
// out-of-range markers fire naturally.
function subWaypoints(siteLat, siteLon, bearing, startKm, altStart, altEnd, durationSec, steps = 6, exitKm = 2.5) {
  const totalKm = startKm + exitKm;
  const wps = [];
  const inbound = Math.round(steps * (startKm / totalKm));
  const outbound = steps - inbound;
  // Inbound leg: startKm → 0 (site center)
  for (let i = 0; i < inbound; i++) {
    const p = i / inbound;
    const dist = startKm * (1 - p);
    const pt = bearingOffset(siteLat, siteLon, (bearing + 180) % 360, dist);
    wps.push({
      lat: +pt.lat.toFixed(5), lon: +pt.lon.toFixed(5),
      alt: Math.round(altStart + (altEnd - altStart) * (p * (startKm / totalKm))),
      heading: bearing,
      tSec: Math.round(durationSec * (p * (startKm / totalKm))),
    });
  }
  // Site center waypoint
  wps.push({
    lat: siteLat, lon: siteLon,
    alt: altEnd,
    heading: bearing,
    tSec: Math.round(durationSec * (startKm / totalKm)),
  });
  // Outbound leg: 0 → exitKm past target
  for (let i = 1; i <= outbound; i++) {
    const p = i / outbound;
    const dist = exitKm * p;
    const pt = bearingOffset(siteLat, siteLon, bearing, dist);
    const altP = (startKm / totalKm) + (exitKm / totalKm) * p;
    wps.push({
      lat: +pt.lat.toFixed(5), lon: +pt.lon.toFixed(5),
      alt: Math.round(altEnd + (altEnd * 0.5) * p),  // slight climb-out
      heading: bearing,
      tSec: Math.round(durationSec * altP),
    });
  }
  return wps;
}
export function makeSubstationThreats(siteId, siteName, siteLat, siteLon, sensorIds) {
  const short = siteName.split(' ')[0];
  const s0 = sensorIds[0] || `${siteId}-N01`;
  const s1 = sensorIds[1] || s0;
  const s2 = sensorIds[2] || s0;
  return {
    [`${siteId}_quad_hostile`]: {
      siteId, classification: 'hostile', threat: 'medium', platform: 'quadcopter',
      droneType: 'Military grade quadcopter, hostile',
      confidence: 0.86, confidenceTrend: 'Rising 0.68 to 0.86 over 15s',
      contributingSensors: [
        { id: s0, confidence: 0.89 }, { id: s1, confidence: 0.84 }, { id: s2, confidence: 0.81 },
      ],
      evidence: { rfCarrier: 'Encrypted control link, non commercial waveform (900 MHz + 5.8 GHz uplink)', modality: 'RF + Acoustic + Visual', evidenceSize: '28.6 MB', note: `Military grade quadcopter loitering over ${short} substation. Encrypted command link, no ADS B or commercial ID. Consistent with state actor reconnaissance of grid infrastructure.` },
      waypoints: subWaypoints(siteLat, siteLon, 90, 3, 120, 60, 75, 12, 2.5),
      durationSec: 75,
    },
    [`${siteId}_fixedwing_hostile`]: {
      siteId, classification: 'hostile', threat: 'medium', platform: 'fixed-wing',
      droneType: 'Fixed wing UAV, ~2m wingspan',
      confidence: 0.84, confidenceTrend: 'Rising 0.70 to 0.84 over 20s',
      contributingSensors: [
        { id: s0, confidence: 0.88 }, { id: s1, confidence: 0.82 }, { id: s2, confidence: 0.79 },
      ],
      evidence: { rfCarrier: 'No RF, GPS only autonomous', modality: 'Visual + acoustic', evidenceSize: '38.1 MB', note: `Fixed wing drone overflight of ${short}. Trajectory consistent with mapping mission over transmission assets.` },
      waypoints: subWaypoints(siteLat, siteLon, 45, 4, 250, 180, 65, 12, 2.5),
      durationSec: 65,
    },
    [`${siteId}_missile_hostile`]: (() => {
      // Missile approaches Copenhagen (Amalienborg area) — passes through the
      // detection site en route. Bearing is computed from site → Copenhagen so
      // the trajectory naturally intersects the projected impact corridor with
      // downstream critical infra (cross-cueing narrative).
      const CPH_TGT_LAT = 55.6842, CPH_TGT_LON = 12.5931;
      const bearing = bearingBetween(siteLat, siteLon, CPH_TGT_LAT, CPH_TGT_LON);
      return {
        siteId, classification: 'hostile', threat: 'high', platform: 'missile',
        droneType: 'Cruise missile signature (unknown class)',
        confidence: 0.93, confidenceTrend: 'Rapid spike 0.30 to 0.93 in 6s',
        contributingSensors: [
          { id: s0, confidence: 0.95 }, { id: s1, confidence: 0.93 }, { id: s2, confidence: 0.91 },
        ],
        evidence: { rfCarrier: 'Passive, no active emitter', modality: 'RF + acoustic + visual', evidenceSize: '184.2 MB', note: `CRITICAL. Cruise missile signature transiting ${short}. Bearing consistent with Copenhagen approach vector. Cross cued to downstream infra.` },
        waypoints: subWaypoints(siteLat, siteLon, bearing, 5, 60, 20, 40, 12, 2.5),
        durationSec: 40,
      };
    })(),
  };
}

// Bearing in degrees from point A to point B (0° = north, clockwise)
function bearingBetween(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const λ1 = lon1 * Math.PI / 180;
  const λ2 = lon2 * Math.PI / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

// ── Playback state ──
const _liveTracks = new Map(); // eventId -> { template, startTime, closed }
const _listeners = new Set();
// One log line per failing listener, not one per frame.
const _listenerErrLogged = new WeakSet();
let _rafId = null;

function interpolate(waypoints, tSec) {
  if (tSec < waypoints[0].tSec) return { ...waypoints[0], visible: true };
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (tSec >= waypoints[i].tSec && tSec <= waypoints[i + 1].tSec) {
      const span = waypoints[i + 1].tSec - waypoints[i].tSec;
      const a = (tSec - waypoints[i].tSec) / span;
      let dh = waypoints[i + 1].heading - waypoints[i].heading;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      return {
        lat: waypoints[i].lat + (waypoints[i + 1].lat - waypoints[i].lat) * a,
        lon: waypoints[i].lon + (waypoints[i + 1].lon - waypoints[i].lon) * a,
        alt: waypoints[i].alt + (waypoints[i + 1].alt - waypoints[i].alt) * a,
        heading: (waypoints[i].heading + dh * a + 360) % 360,
        visible: true,
      };
    }
  }
  return { ...waypoints[waypoints.length - 1], visible: false };
}

function speedAt(waypoints, tSec) {
  const p1 = interpolate(waypoints, tSec);
  const p2 = interpolate(waypoints, tSec + 1);
  const dLat = (p2.lat - p1.lat) * 111000;
  const dLon = (p2.lon - p1.lon) * 111000 * Math.cos(p1.lat * Math.PI / 180);
  return Math.round(Math.hypot(dLat, dLon) * 10) / 10;
}

function _tickBody() {
  const updates = [];
  for (const [eventId, live] of _liveTracks) {
    if (live.closed) continue;
    const elapsed = (monoNow() - live.startTime) / 1000;
    const p = interpolate(live.template.waypoints, elapsed);
    updates.push({
      eventId,
      siteId: live.template.siteId,
      classification: live.template.classification,
      platform: live.template.platform,
      lat: p.lat, lon: p.lon, alt: p.alt, heading: p.heading,
      speed: speedAt(live.template.waypoints, elapsed),
      visible: p.visible,
      tSec: elapsed,
      completed: elapsed >= live.template.durationSec,
    });
  }
  // One listener's failure must not starve the others, and no failure
  // may reach the reschedule in _tick. Logged once per listener so a
  // bug that throws every frame stays visible without flooding.
  if (updates.length) {
    for (const fn of _listeners) {
      try {
        fn(updates);
      } catch (err) {
        if (!_listenerErrLogged.has(fn)) {
          _listenerErrLogged.add(fn);
          console.error('[drones] track listener failed, playback continues:', err);
        }
      }
    }
  }
}

// WHY THE RESCHEDULE SITS IN A `finally`.
//
// This loop drives every drone in every scenario. It used to end with
// the reschedule as a trailing statement after a bare
// `_listeners.forEach(fn => fn(updates))`, and the sole listener is
// onDroneTick in main.js, about 1,300 lines of work per position. A
// throw anywhere in it escaped the forEach, escaped _tick, and the
// reschedule never ran. `_rafId` kept its already-consumed handle, so
// addLiveTrack's `if (!_rafId)` guard then refused to restart the
// loop: every drone stopped, including tracks spawned afterwards,
// until the page was reloaded. That failure mode shipped twice.
//
// The reschedule is now unconditional on the way out. A bug inside the
// body is logged once and the simulation keeps running.
function _tick() {
  try {
    _tickBody();
  } finally {
    if (_liveTracks.size > 0) _rafId = requestAnimationFrame(_tick);
    else _rafId = null;
  }
}

export function addLiveTrack(eventId, template) {
  // Stamped on the simulation clock, not the browser's, so that
  // `monoNow() - startTime` in _tick stays a frozen-aware elapsed.
  _liveTracks.set(eventId, { template, startTime: monoNow(), closed: false });
  if (!_rafId) _rafId = requestAnimationFrame(_tick);
}

export function markTrackClosed(eventId) {
  const live = _liveTracks.get(eventId);
  if (live) live.closed = true;
}

export function removeLiveTrack(eventId) {
  _liveTracks.delete(eventId);
}

export function isTrackLive(eventId) {
  const live = _liveTracks.get(eventId);
  return !!live && !live.closed;
}

export function anyTrackLive() {
  for (const live of _liveTracks.values()) if (!live.closed) return true;
  return false;
}

export function onDroneUpdate(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ── Geo helpers ──
export function distanceToPerimeter(lat, lon, perimeter) {
  let minM = Infinity;
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i];
    const b = perimeter[(i + 1) % perimeter.length];
    const cosLat = Math.cos(lat * Math.PI / 180);
    const ax = (a[0] - lon) * 111000 * cosLat;
    const ay = (a[1] - lat) * 111000;
    const bx = (b[0] - lon) * 111000 * cosLat;
    const by = (b[1] - lat) * 111000;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < minM) minM = d;
  }
  return Math.round(minM);
}

export function pointInPolygon(lat, lon, perimeter) {
  let inside = false;
  for (let i = 0, j = perimeter.length - 1; i < perimeter.length; j = i++) {
    const xi = perimeter[i][0], yi = perimeter[i][1];
    const xj = perimeter[j][0], yj = perimeter[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
