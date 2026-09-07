// Drone playback engine
// Multiple concurrent tracks. Each spawns dynamically (via button click), plays
// once through its trajectory, then closes. Real detection pipeline will replace
// this module with a WebSocket subscription that streams the same update shape.

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
    durationSec: 90,
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
    waypoints: [
      { lat: 55.57500, lon: 12.57500, alt: 800, heading: 40, tSec: 0  },
      { lat: 55.58300, lon: 12.58800, alt: 630, heading: 40, tSec: 10 },
      { lat: 55.59100, lon: 12.60100, alt: 460, heading: 40, tSec: 20 },
      { lat: 55.59900, lon: 12.61400, alt: 300, heading: 40, tSec: 30 },
      { lat: 55.60300, lon: 12.63400, alt: 90,  heading: 40, tSec: 40 },
      { lat: 55.60500, lon: 12.64020, alt: 3,   heading: 40, tSec: 45 },
      { lat: 55.61200, lon: 12.64800, alt: 0,   heading: 40, tSec: 55 },
      { lat: 55.62000, lon: 12.65650, alt: 0,   heading: 40, tSec: 65 },
      { lat: 55.62700, lon: 12.66300, alt: 0,   heading: 40, tSec: 75 },
      { lat: 55.62960, lon: 12.66590, alt: 0,   heading: 40, tSec: 82 },
    ],
    durationSec: 82,
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

  // ── Quadcopter, hostile (low pass over passenger terminal + cargo apron) ──
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
    evidence: { rfCarrier: '2.412 GHz', rfBandwidth: '20 MHz OFDM', rfMatch: 'OcuSync 89%', modality: 'RF + acoustic + visual', evidenceSize: '31.2 MB', note: 'Quadcopter low pass over passenger terminal + cargo apron. Consistent with tourist / hobbyist NOT complying with restricted airspace, escalated to hostile after refusal to descend.' },
    waypoints: [
      { lat: 55.7360, lon: 9.13800, alt: 110, heading:  75, tSec:  0 },   // Enter SW, cruise altitude
      { lat: 55.7375, lon: 9.14700, alt:  90, heading:  70, tSec:  9 },   // Descend
      { lat: 55.7378, lon: 9.15000, alt:  75, heading:  75, tSec: 16 },   // LOW over W apron
      { lat: 55.7378, lon: 9.15450, alt:  70, heading:  85, tSec: 24 },   // Over passenger terminal
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
        { role: 'overwatch',  model: 'Autel EVO II Pro (unknown link)', rfMHz: 5780, offset: { forward: -240, right: -150, up: +30 } },
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
        { role: 'overwatch',  model: 'Autel EVO II Pro (unknown link)', rfMHz: 5780, offset: { forward: -300, right: -200, up: +25 } },
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

function _tick() {
  const updates = [];
  for (const [eventId, live] of _liveTracks) {
    if (live.closed) continue;
    const elapsed = (performance.now() - live.startTime) / 1000;
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
  if (updates.length) _listeners.forEach(fn => fn(updates));
  if (_liveTracks.size > 0) _rafId = requestAnimationFrame(_tick);
  else _rafId = null;
}

export function addLiveTrack(eventId, template) {
  _liveTracks.set(eventId, { template, startTime: performance.now(), closed: false });
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
