// ═══════════════════════════════════════════════════════════════════
// AGENT A · Site-context definitions (offline cache)
// ───────────────────────────────────────────────────────────────────
// Static per-site JSON describing critical areas, high-value assets,
// sensitive setups, and normal traffic patterns. Consumed by Agent B
// (Mission Console) to correlate live event trajectories against
// site-specific context — e.g. "swarm loitered 90% over Terminal 2
// coincident with cargo aircraft on stand 22".
//
// Post-demo: Mistral Agent A generates this per site on each site-def
// change. Until then, this module IS Agent A output — hand-curated
// against real domain characteristics of each Danish critical site.
//
// Consumers should always go through contextForSite(siteId) so future
// dynamic loading (Mistral fetch) can be plumbed in one place.
// ═══════════════════════════════════════════════════════════════════

export const SITE_CONTEXT = {
  // ── København Airport ─────────────────────────────────────────────
  // Coordinates verified against OpenStreetMap (with Danish BBR/address
  // register backing), VATSIM Scandinavia controllers' ops wiki, and
  // CPH.dk operational docs. Sources documented per entry via `verified`
  // and `source` fields. NEVER guess coordinates for this block — always
  // pull from OSM or verified operational source.
  cph: {
    site_id: 'cph',
    name: 'København Airport (CPH)',
    site_type: 'commercial_airport',
    schema_version: '1.2',
    generated_at: '2026-08-06T00:00:00Z',
    generated_by: 'Agent A stub. Coordinates: OSM + Danish address register verified 2026-08-06.',
    airport_reference_point: { lat: 55.61806, lon: 12.65611 },

    critical_areas: [
      // Runways (3) — approximate midpoints along each strip
      // Corrected 2026-09-22. Was 2551 m away, off the runway entirely.
      // Midpoint of the two thresholds on OSM way 361451318 (ref 04L/22R,
      // length 3571 m), which matches the published runway length.
      // Thresholds: 04L 55.592191/12.603521, 22R 55.616213/12.640677.
      { id: 'runway_04L_22R', name: 'Runway 04L/22R (primary)', center: { lat: 55.604202, lon: 12.622099 }, criticality: 'critical', verified: 'high',
        reason: 'Primary arrival axis. Airborne obstruction on approach triggers go-around; ground incursion closes the runway.' },
      // Corrected 2026-09-22, was 801 m out. OSM way 361451319, ref 04R/22L,
      // length 3302 m. Thresholds: 04R 55.603084/12.633033,
      // 22L 55.625446/12.667644.
      { id: 'runway_04R_22L', name: 'Runway 04R/22L (parallel)', center: { lat: 55.614265, lon: 12.650338 }, criticality: 'critical', verified: 'high',
        reason: 'Parallel arrival axis. Simultaneous ops with 04L; obstruction cascades to full airfield closure.' },
      // OSM way 361451323, ref 12/30, length 2800 m. Still OPERATIONAL, used
      // when crosswind on the parallels exceeds roughly 15-20 kt. Paved
      // surface extends ~340 m past the 12 threshold and ~250 m past 30 as
      // displaced threshold, so an object can be on 12/30 asphalt without
      // being on the landing surface.
      { id: 'runway_12_30',   name: 'Runway 12/30 (crosswind)',   center: { lat: 55.618996, lon: 12.653028 }, criticality: 'high', verified: 'high',
        reason: 'Secondary crosswind runway. Used in NE/SW wind conditions.' },

      // Terminal 1 — INACTIVE since 29 Mar 2015 (Wikipedia). Retained for
      // completeness but flagged; do not target for operational alerts.
      // Renamed and moved 2026-09-22. TERMINAL 1 NO LONGER EXISTS as a
      // discrete facility: domestic departures moved to T2/T3 on 29 March
      // 2015 and the structure was absorbed into Terminal 2 as Finger A.
      // A report must not name "Terminal 1" as the asset an object is over.
      // OSM relation 12750718, aeroway=terminal, name=Finger A.
      { id: 'terminal_1', name: 'Finger A / Pier A (former Terminal 1, closed 2015)', center: { lat: 55.629268, lon: 12.636324 }, criticality: 'low', verified: 'high', status: 'inactive',
        reason: 'Historic domestic terminal. Not used for scheduled passenger flights since 29 March 2015. Building physically remains.' },

      // Terminal 2 (international check-in) — OSM way 702120960, Wikidata Q56860009
      { id: 'terminal_2', name: 'Terminal 2 (international check-in)', center: { lat: 55.62878, lon: 12.64579 }, criticality: 'high', verified: 'high',
        source: 'https://www.openstreetmap.org/way/702120960',
        reason: 'International check-in. Shares airside/arrivals hall with Terminal 3.' },

      // Terminal 3 (central concourse feeding all piers)
      { id: 'terminal_3', name: 'Terminal 3 (main check-in, shared arrivals hall)', center: { lat: 55.62870, lon: 12.65000 }, criticality: 'high', verified: 'medium',
        reason: 'Main check-in. Distributed complex bridging T2 to the pier fingers. Centroid interpolated.' },

      // Piers — OSM building centroids where available, else gate-cluster centroids
      { id: 'pier_a', name: 'Pier A / Finger A (Schengen, gates A1-A34)', center: { lat: 55.62778, lon: 12.64199 }, criticality: 'high', verified: 'high',
        source: 'https://www.openstreetmap.org/way/242422294',
        reason: 'Schengen departures, westernmost pier.' },
      { id: 'pier_b', name: 'Pier B / Finger B (Schengen, gates B4-B19)', center: { lat: 55.62708, lon: 12.64520 }, criticality: 'high', verified: 'high',
        source: 'https://www.openstreetmap.org/way/242422295',
        reason: 'Schengen departures.' },
      { id: 'pier_c', name: 'Pier C (non-Schengen, gates C2-C8 + C27-C39)', center: { lat: 55.62649, lon: 12.64956 }, criticality: 'high', verified: 'medium',
        source: 'https://wiki.vatsim-scandinavia.org/books/danish-airports-charts/page/ekch-copenhagenkastrup',
        reason: 'Non-Schengen only. Centroid computed from 18 OSM gate nodes.' },
      { id: 'pier_d', name: 'Pier D (flexi Schengen / non-Schengen, gates D1-D4 + D101-D104)', center: { lat: 55.62780, lon: 12.65242 }, criticality: 'high', verified: 'medium',
        source: 'https://wiki.vatsim-scandinavia.org/books/danish-airports-charts/page/ekch-copenhagenkastrup',
        reason: 'Mixed Schengen and non-Schengen ("flexi"). 4 OSM gate nodes cluster.' },
      { id: 'pier_e', name: 'Pier E / Finger E (non-Schengen, SAS long-haul, gates E1-E7 + E20-E36)', center: { lat: 55.62682, lon: 12.65581 }, criticality: 'critical', verified: 'high',
        source: 'https://www.openstreetmap.org/way/616277328',
        reason: 'SAS long-haul hub since 2019 (moved from Pier C). Widebody stands including A350 / 787 / 777 operations.' },
      { id: 'pier_f', name: 'Pier F / CPH Go (low-cost, gates F1-F10)', center: { lat: 55.62574, lon: 12.65675 }, criticality: 'medium', verified: 'high',
        source: 'https://www.openstreetmap.org/way/242422297',
        reason: 'Low-cost carriers (easyJet, Ryanair, Wizz Air, Transavia). Bus-boarded remote stands.' },

      // Cargo — ALL on the EAST side along Kystvejen / Cargovej ("Apron East" in OSM)
      { id: 'apron_east', name: 'Apron East (main cargo apron, stands G120-G137)', center: { lat: 55.61891, lon: 12.66860 }, criticality: 'high', verified: 'high',
        source: 'https://www.openstreetmap.org/way/12786032',
        reason: 'All commercial cargo operations at CPH. Runs along east edge adjacent to Øresund coast and Kystvejen road.' },
      { id: 'cargo_dhl', name: 'DHL Aviation Nordic Hub', center: { lat: 55.62124, lon: 12.67460 }, criticality: 'high', verified: 'high',
        source: 'https://www.cph.dk/en/cph-business/aviation/cargo/cargo-airlines',
        reason: 'DHL Nordic hub. 6,000 m² terminal at Kystvejen 24. Express freight including pharma cold chain.' },
      { id: 'cargo_fedex', name: 'FedEx Express Nordic Gateway', center: { lat: 55.61734, lon: 12.67508 }, criticality: 'high', verified: 'high',
        source: 'https://www.openstreetmap.org/way/380049837',
        reason: 'FedEx Nordic gateway. Opened 2016 at Kystvejen 34.' },
      { id: 'cargo_wfs', name: 'Worldwide Flight Services (WFS)', center: { lat: 55.61854, lon: 12.67506 }, criticality: 'medium', verified: 'high',
        source: 'https://www.openstreetmap.org/way/380058689',
        reason: '6,200 m² cargo handling. Ground handler for multiple carriers.' },
      // Official address point Kystvejen 28 (Danmarks Adresseregister). The
      // PostNord BUILDING is not mapped in OSM; only three PostNord
      // flagpoles ~65 m away corroborate the location. Address high,
      // footprint unverified.
      { id: 'cargo_postnord', name: 'PostNord mail terminal area', center: { lat: 55.620026, lon: 12.675062 }, criticality: 'medium', verified: 'medium',
        source: 'https://www.openstreetmap.org/node/3717655615',
        reason: 'National postal sorting. Includes classified government correspondence. Bus stop tagged; precise building footprint pending on-site survey.' },
    ],

    high_value_assets: [
      // Air traffic control + navigation (4)
      { id: 'atc_tower_syd',   name: 'Tower Syd (ATC control tower)',    location: { lat: 55.61180, lon: 12.65760 }, asset_type: 'atc_control_tower', criticality: 'critical', verified: 'unverified',
        reason: 'Single point of airspace control. Loss = airspace closure with national-scale impact.' },
      // NOT AN ANTENNA COORDINATE. No ILS antenna is mapped anywhere at this
      // airport. This is the airside access road named GP 04L-Vej
      // (OSM way 37274085), which brackets the glidepath site.
      // 
      // It previously held the EXACT coordinate of the runway centre, which
      // is not where a glidepath antenna sits and made two different assets
      // share one position. A road beside the real site is wrong by tens of
      // metres; the runway centre was wrong by kilometres.
      // 
      // Real coordinates live in the Naviair AIP, EKCH AD 2, which publishes
      // navaid positions to sub-second precision.
      { id: 'ils_04L',         name: 'ILS glidepath site 04L (access road)',               location: { lat: 55.593403, lon: 12.608983 }, asset_type: 'ils_ground_installation', criticality: 'high', verified: 'approximate',
        reason: 'Instrument approach guidance for primary runway. Any interference triggers ILS re-certification.' },
      // Same as ils_04L: access road GP 22R Vej (OSM way 475335537), not the
      // antenna. Source the real position from the Naviair AIP.
      { id: 'ils_22R',         name: 'ILS glidepath site 22R (access road)',               location: { lat: 55.609419, lon: 12.633499 }, asset_type: 'ils_ground_installation', criticality: 'high', verified: 'approximate',
        reason: 'Reciprocal approach guidance. Same sensitivity as 04L.' },
      { id: 'atis_broadcast',  name: 'ATIS broadcast antenna',           location: { lat: 55.61240, lon: 12.65810 }, asset_type: 'nav_broadcast', criticality: 'medium', verified: 'unverified',
        reason: 'Continuous weather / operations broadcast. Loss forces manual radio queries.' },
      // Maintenance + hangars (3)
      { id: 'sas_hangar_141',  name: 'SAS Hangar 141 (maintenance)',     location: { lat: 55.61289, lon: 12.65980 }, asset_type: 'maintenance_facility', criticality: 'medium', verified: 'unverified',
        reason: 'Deep maintenance of Nordic fleet. Fire risk and jet fuel storage.' },
      { id: 'hangar_2',        name: 'Hangar 2 (widebody)',              location: { lat: 55.61360, lon: 12.66130 }, asset_type: 'maintenance_facility', criticality: 'medium', verified: 'unverified',
        reason: 'Widebody deep maintenance. Contains active aircraft during scheduled works.' },
      // OSM way 25604810, aeroway=hangar, name=Hangar 3. Was 147 m out.
      { id: 'hangar_3',        name: 'Hangar 3, N Maintenance',          location: { lat: 55.629461, lon: 12.659069 }, asset_type: 'maintenance_facility', criticality: 'medium', verified: 'high',
        reason: 'North apron maintenance. Adjacent to N23/N24 perimeter sensor line.' },
      // Fuel + utility (3)
      // Corrected 2026-09-22. Was 2795 m away, the worst error at this site,
      // on the asset the site itself ranks priority 1.
      // Braendstoflageret Koebenhavns Lufthavn I/S, CVR 24247910,
      // Hydrantvej 10, registered with Miljoestyrelsen for mineral-oil
      // storage above 2500 tonnes. Identity confirmed as aviation fuel, not
      // another tank facility. This is the official address point; the tank
      // farm FOOTPRINT is unmapped, so do not derive a boundary from it.
      { id: 'fuel_farm',       name: 'Fuel farm (Jet A-1 storage)',      location: { lat: 55.627833, lon: 12.635868 }, asset_type: 'fuel_storage', criticality: 'critical', verified: 'high',
        reason: 'Bulk aviation fuel. Vulnerability to standoff attack; fire hazard cascades to airfield.' },
      { id: 'fuel_hydrant_c',  name: 'Central fuel hydrant network',     location: { lat: 55.61850, lon: 12.65450 }, asset_type: 'fuel_infrastructure', criticality: 'high', verified: 'unverified',
        reason: 'Underground fuel distribution to all pier stands. Rupture cascades to airfield closure.' },
      { id: 'main_gpu_station', name: 'Main GPU (ground power) station', location: { lat: 55.61490, lon: 12.65540 }, asset_type: 'ground_power', criticality: 'medium', verified: 'unverified',
        reason: 'Ground power supply. Loss strands parked aircraft, cascades to Tier 2 escalation.' },
      // Emergency + response (2)
      // Renamed and moved 2026-09-22, was 1725 m out. The two named airport
      // fire assets are WEST and SOUTHEAST, not north and south.
      // OSM way 401571568, Kystvejen 51.
      { id: 'fire_station_n',  name: 'Copenhagen Airport Fire & Rescue (southeast)',       location: { lat: 55.611408, lon: 12.680162 }, asset_type: 'emergency_response', criticality: 'high', verified: 'high',
        reason: 'Category 10 CFR (crash fire rescue). Attack on this station degrades emergency response for any incident.' },
      // Renamed and moved 2026-09-22, was 1231 m out.
      // OSM way 31578010, amenity=fire_station, name=Brandstation Vest.
      { id: 'fire_station_s',  name: 'Brandstation Vest (west)',       location: { lat: 55.607135, lon: 12.622049 }, asset_type: 'emergency_response', criticality: 'high', verified: 'high',
        reason: 'Southern CFR. Covers 04R/22L runway ops.' },
      // Border + gov — Vilhelm Lauritzen Terminal (W1 stand) — OSM relation
      // 2956891, Wikidata Q121069544. VIP / state visits / royals.
      // NB: Wikipedia's coordinate for this building (12.6543) is INCORRECT;
      // OSM + Danish address register agree on 12.6297.
      { id: 'vilhelm_lauritzen_terminal', name: 'Vilhelm Lauritzen Terminal (W1 stand, VIP/state/royals)', location: { lat: 55.62145, lon: 12.62964 }, asset_type: 'vip_state_terminal', criticality: 'critical', verified: 'high',
        source: 'https://www.openstreetmap.org/relation/2956891',
        reason: 'Segregated VIP terminal on WEST side of airfield. All state visits, royal movements, and foreign military transport (French Air Force, US State Dept, etc.) park at W1 here. Coordinated with PET (Politiets Efterretningstjeneste).' },
    ],

    // Response asset coordination points — NOTIONAL / PROPOSED positions
    // where ISR data would be relayed for external counter-UAS deployment.
    // ISR is detection-only; these are NOT ISR-owned assets and NOT
    // confirmed real deployment sites. They represent operationally
    // plausible coordination positions for the response layer
    // (Politiets Aktionsstyrke, Flyvevåbnet, SIB). Actual positions
    // require sign-off from customer + Danish authorities before demoing
    // externally. Kept here for demo scaffolding only.
    response_asset_positions: [
      { id: 'cuas_stage_n',    name: 'CUAS staging area, North perimeter',     location: { lat: 55.62950, lon: 12.65780 }, asset_type: 'cuas_staging', criticality: 'high',
        reason: 'Pre-cleared ground for mobile counter-UAS units. 200m clear zone from active taxiways.' },
      { id: 'cuas_stage_s',    name: 'CUAS staging area, South perimeter',     location: { lat: 55.60420, lon: 12.64950 }, asset_type: 'cuas_staging', criticality: 'high',
        reason: 'Southern deployment point. Closest to fuel farm and 04R approach corridor.' },
      { id: 'cuas_rooftop_t3', name: 'Rooftop CUAS position, Terminal 3',      location: { lat: 55.62310, lon: 12.65540 }, asset_type: 'cuas_fixed', criticality: 'high',
        reason: 'Elevated position covering terminal apron approach vectors. Coordination with SIB (Sikringsberedskabet).' },
      { id: 'overwatch_atc',   name: 'Overwatch position, ATC tower',          location: { lat: 55.61180, lon: 12.65760 }, asset_type: 'overwatch', criticality: 'high',
        reason: 'Highest vantage on airfield. Coordinated overwatch for critical response operations.' },
      { id: 'qra_dispatch_relay', name: 'QRA dispatch relay (to Flyvestation Skrydstrup)', location: { lat: 55.61180, lon: 12.65760 }, asset_type: 'qra_relay', criticality: 'critical',
        reason: 'Tier 4 escalation to F-35 quick reaction alert. Automated dispatch on high-threat missile signature.' },
    ],

    // Aircraft of interest — illustrative rotation of high-value aircraft
    // that would typically be parked at CPH at any given time. Coordinates
    // anchored to real pier/apron/stand-cluster centroids from OSM (see
    // critical_areas above). Aircraft, operators, routes, and stand ranges
    // are drawn from real CPH operations — NOT fabricated. Registrations
    // are real fleet examples (verify against current schedule before demo).
    //
    // Live system would sync with airport ground movement schedule +
    // customs manifest. Until then this is a demo-realistic snapshot.
    aircraft_of_interest: [
      // SAS long-haul widebody at Pier E (SAS's actual long-haul hub since 2019)
      { id: 'sas_a350_jfk',
        callsign: 'SK909', operator: 'SAS',
        aircraft: 'Airbus A350-900',
        registration: 'LN-RKF',
        stand: 'E4',
        location: { lat: 55.62682, lon: 12.65581 },
        status: 'boarding',
        eta_departure: '2026-08-06T16:20:00Z',
        route: 'CPH → JFK',
        manifest_note: 'Scheduled transatlantic. Standard passenger + belly cargo. SAS long-haul flagship route.' },

      // Emirates 777 to DXB — daily service, historically Pier C/E
      { id: 'emirates_ek152',
        callsign: 'EK152', operator: 'Emirates',
        aircraft: 'Boeing 777-300ER',
        registration: 'A6-EGA',
        stand: 'E6',
        location: { lat: 55.62700, lon: 12.65650 },
        status: 'parked',
        eta_departure: '2026-08-06T14:45:00Z',
        route: 'CPH → DXB',
        manifest_note: 'Dubai service. Long-haul widebody. High-value passenger manifest.' },

      // French Air Force diplomatic — Vilhelm Lauritzen Terminal (W1)
      // This is where state visits ACTUALLY park at CPH.
      { id: 'fr_af_diplomatic',
        callsign: 'CTM0001', operator: 'French Air Force (Escadron de transport)',
        aircraft: 'Airbus A330-200',
        registration: 'F-RARF',
        stand: 'W1',
        location: { lat: 55.62145, lon: 12.62964 },
        status: 'parked',
        eta_departure: '2026-08-06T18:00:00Z',
        route: 'CPH → LFPB (Paris Le Bourget)',
        manifest_note: 'Diplomatic transport at VIP terminal. Foreign ministerial delegation. Movements coordinated PET + Rigspoliti.' },

      // DHL cargo freighter — actually located on east cargo apron (G120-G137 range)
      { id: 'dhl_767f',
        callsign: 'BCS733', operator: 'DHL (European Air Transport Leipzig)',
        aircraft: 'Boeing 767-300F',
        registration: 'D-ALCA',
        stand: 'G124',
        location: { lat: 55.62124, lon: 12.67460 },
        status: 'loading',
        eta_departure: '2026-08-06T22:00:00Z',
        route: 'CPH → LEJ (Leipzig, DHL European hub)',
        manifest_note: 'Overnight express freight. Includes pharmaceutical cold-chain shipments for Nordic distribution.' },

      // FedEx freighter — Nordic gateway, Kystvejen 34
      { id: 'fedex_md11f',
        callsign: 'FDX52', operator: 'FedEx Express',
        aircraft: 'Boeing 777F',
        registration: 'N889FD',
        stand: 'G127',
        location: { lat: 55.61734, lon: 12.67508 },
        status: 'unloading',
        eta_departure: '2026-08-06T23:30:00Z',
        route: 'CDG → CPH → MEM (Memphis)',
        manifest_note: 'Inbound express freight from Paris CDG. Nordic gateway distribution.' },
    ],

    // Partner-declared narrative highlights (FIX-4 per architecture review).
    // These are the assets Agent B references first when narrating any
    // event at this site. Ordered by priority (1 = highest). Rationale
    // is fed verbatim to the debrief prompt (sanitized before injection
    // per FIX-5). Aircraft-of-interest IDs are intentionally NOT valid
    // highlight targets (rosters change hourly) — see FIX-8.
    highlights: [
      { asset_id: 'fuel_farm',              priority: 1, rationale: 'Bulk aviation fuel (Jet A-1). Standoff attack cascades to fire on airfield and multi-week fuel supply disruption.' },
      { asset_id: 'atc_tower_syd',          priority: 2, rationale: 'ATC Tower Syd is the single point of airspace control. Loss triggers immediate airspace closure with national-scale impact.' },
      { asset_id: 'runway_04L_22R',         priority: 3, rationale: 'Primary arrival axis. Airborne obstruction on approach forces go-around; ground incursion closes the runway.' },
      { asset_id: 'pier_e',                 priority: 4, rationale: 'SAS long-haul widebody hub since 2019. A350, 787, and 777 stands. Any incident here affects intercontinental operations.' },
      { asset_id: 'vilhelm_lauritzen_terminal', priority: 5, rationale: 'Segregated VIP terminal for state visits, royals, and foreign military transport. Coordinated with PET.' },
      { asset_id: 'ils_04L',                priority: 6, rationale: 'ILS glideslope for primary runway. RF interference triggers immediate ILS re-certification and approach downgrade.' },
      { asset_id: 'fire_station_n',         priority: 7, rationale: 'Category 10 crash fire rescue (CFR). Degrading this station lowers emergency response capacity for any concurrent incident.' },
    ],

    sensitive_setups: [
      { id: 'ils_axis_04L_approach', name: 'ILS 04L approach corridor', note: 'Airborne track on axis 04L within 3 NM triggers ILS interference alert.' },
      { id: 'ils_axis_04R_approach', name: 'ILS 04R approach corridor', note: 'Parallel approach axis. Same sensitivity.' },
      { id: 'gp_28',                  name: 'Ground power stations',   note: 'Loss of GPU capacity strands parked aircraft; escalation Tier 2.' },
      { id: 'coast_arrival_e',        name: 'Øresund E arrival corridor', note: 'All international arrivals from E. Unusual traffic in this corridor = high-priority alert.' },
      { id: 'perimeter_north_ni_road', name: 'North perimeter, Nordlundsvej', note: 'Public road adjacent to perimeter fence. Vehicle-mounted attack risk.' },
      { id: 'metro_terminal_link',    name: 'CPH Metro underground terminal', note: 'Underground rail link. Not sensor-visible; access controlled at station level.' },
    ],

    normal_patterns: {
      operating_hours: '24/7',
      approach_corridors: [
        { name: 'Runway 04 approach (from SW)', from_bearing: 225, typical_altitude_ft: 2000 },
        { name: 'Runway 22 approach (from NE)', from_bearing:  45, typical_altitude_ft: 2000 },
        { name: 'Runway 30 approach (from SE)', from_bearing: 120, typical_altitude_ft: 2000 },
      ],
      maintenance_windows: 'Runway sweep 02:00-04:00 local. ILS calibration first Tuesday of month.',
      civilian_drone_activity: 'None permitted within 5 km CTR. Police, coastguard, and airport-authorised photographic ops occur E of perimeter with prior clearance.',
      routine_helicopter_activity: 'Politi helicopter overflight ~2x daily. Rigshospitalet medevac transits N perimeter.',
    },

    correlator_hints: {
      dwell_alarm_zones: [
        // Anchored to verified pier centroids
        { name: 'Pier E (SAS long-haul widebody)', center: { lat: 55.62682, lon: 12.65581 }, radius_m: 300, threshold_sec: 20 },
        { name: 'Piers A/B (Schengen departures)', center: { lat: 55.62743, lon: 12.64360 }, radius_m: 400, threshold_sec: 30 },
        { name: 'Piers C/D (mixed + non-Schengen)', center: { lat: 55.62715, lon: 12.65099 }, radius_m: 350, threshold_sec: 30 },
        { name: 'Pier F / CPH Go (low-cost)', center: { lat: 55.62574, lon: 12.65675 }, radius_m: 250, threshold_sec: 30 },
        // Thresholds corrected 2026-09-22 to the mapped runway ends.
        // These held positions that no longer matched any asset after
        // the runway centres were fixed, so a dwell alarm could fire
        // for a zone with nothing in it.
        { name: 'Runway 04L threshold', center: { lat: 55.592191, lon: 12.603521 }, radius_m: 250, threshold_sec: 15 },
        { name: 'Runway 04R threshold', center: { lat: 55.603084, lon: 12.633033 }, radius_m: 250, threshold_sec: 15 },
        { name: 'ATC Tower Syd', center: { lat: 55.61180, lon: 12.65760 }, radius_m: 150, threshold_sec: 20 },
        { name: 'Fuel farm', center: { lat: 55.627833, lon: 12.635868 }, radius_m: 250, threshold_sec: 15 },
        { name: 'Apron East (cargo, G120-G137)', center: { lat: 55.61891, lon: 12.66860 }, radius_m: 400, threshold_sec: 20 },
        { name: 'DHL / FedEx / WFS cargo terminals', center: { lat: 55.61900, lon: 12.67480 }, radius_m: 250, threshold_sec: 15 },
        { name: 'Vilhelm Lauritzen Terminal (VIP/state)', center: { lat: 55.62145, lon: 12.62964 }, radius_m: 200, threshold_sec: 10 },
      ],
      unusual_pattern_flags: [
        'Sustained loiter > 30s over any single critical_area',
        'Any airborne track descending below 100m AGL over runway thresholds',
        'RF signature matching civilian consumer platform without airport clearance manifest',
        'Track proximity < 200m to any aircraft_of_interest with high-value or diplomatic manifest',
        'Multiple simultaneous tracks over separate piers suggests coordinated recon',
        'Track over Vilhelm Lauritzen Terminal (W1) during confirmed state visit → immediate Tier 4 escalation',
        'Ingress vector from N perimeter aligned with Amager Koblingsstation axis suggests cross-cued asset',
      ],
    },

    // Cooperative-aircraft feed reconciliation. See
    // docs/agentic-cooperative-traffic-fusion-architecture.md.
    // 'expected: true' at CPH because commercial + police + medevac
    // aviation is continuous — absence-of-match is a strong non-
    // cooperative signal here.
    cooperative_traffic: {
      expected: true,
      source: 'opensky',
      match_radius_m: 800,
      match_time_window_s: 8,
      bbox_padding_deg: 0.15,
    },

    // Site-level response capability declaration. Filters which
    // branch-specific CTAs render in the receiver Mission Console.
    // Undeclared = permissive (all CTAs). CPH is Denmark's main
    // international airport — the full national response envelope
    // is plausible here.
    response_capabilities: [
      'deploy-patrol', 'set-cordon', 'request-aks',
      'brs-standby', 'brs-deploy',
      'army-c-uas', 'army-ground',
      'issue-notam', 'restrict-airspace',
      'kom-crisis', 'kom-shelter',
      'hjv-reinforce',
      'region-ambulance-standby', 'region-triage-prep',
    ],
  },

  // ── Amager Koblingsstation (400/132 kV switching) ────────────────
  energinet_amager_koblingsstation: {
    site_id: 'energinet_amager_koblingsstation',
    name: 'Amager Koblingsstation',
    site_type: 'hv_switching_station',
    schema_version: '1.0',
    generated_at: '2026-08-05T00:00:00Z',
    generated_by: 'Agent A (stub, replaced by Mistral post-demo)',

    critical_areas: [
      // OSM way 316459619, ref AMK, voltage 132000;30000, location=indoor.
      // 
      // CORRECTED 2026-09-23. This site was recorded as a 400 kV station
      // with two 400/132 kV autotransformers and a shunt reactor bank.
      // It is a 132/30 kV INDOOR station and none of that equipment is
      // mapped here. The nearest real 400 kV sites are Glentegaard, Ishoej
      // and Avedoerevaerket, so those assets may have been meant for one
      // of them.
      // 
      // Mapped extent is 136 x 106 m, about two buildings. At that scale
      // naming a sub-asset in a report is not defensible whatever the
      // source, so this site carries the station and its two buildings
      // rather than invented internals.
      { id: 'sw_yard_132kv', name: '132/30 kV switchgear (indoor)', center: { lat: 55.640968, lon: 12.60862 }, criticality: 'critical', verified: 'high',
        reason: 'Feeds the Copenhagen distribution network. Indoor gas-insulated switchgear, so there is no outdoor yard to overfly.' },
    ],

    high_value_assets: [
      // OSM way 328984707, building=industrial. Function inferred from
      // size and position; OSM does not tag it.
      { id: 'building_main', name: 'Main building', location: { lat: 55.640992, lon: 12.608721 }, asset_type: 'control_room', criticality: 'critical', verified: 'medium',
        reason: 'Principal structure, 75 x 73 m. Houses the indoor switchgear.' },
      { id: 'building_secondary', name: 'Secondary building', location: { lat: 55.641032, lon: 12.607951 }, asset_type: 'support_facility', criticality: 'medium', verified: 'medium',
        reason: 'Smaller structure, 23 x 30 m. Function not recorded.' },
    ],

    sensitive_setups: [
      { id: 'line_entry_n', name: 'North 400 kV line entry (from Bjæverskov)', note: 'Overhead entry gantry. Physical attack at this point severs the ring.' },
      { id: 'battery_room', name: 'DC battery + UPS room', note: 'Backup protection power. Loss disables trip circuits during grid disturbance.' },
    ],

    // Partner-declared narrative highlights per site (FIX-4 pattern).
    // Substation scope is tight — 3 entries covering the two switchyards
    // + control building. Everything else is either redundant or already
    // implied by these three.
    // Rewritten 2026-09-23 with the asset list. The old entries pointed
    // at a 400 kV switchyard and a control building that do not exist
    // at this site; it is a 132/30 kV indoor station.
    highlights: [
      { asset_id: 'sw_yard_132kv', priority: 1, rationale: 'Indoor 132/30 kV switchgear feeding Amager and parts of central København. A fault here propagates into the city distribution network.' },
      { asset_id: 'building_main', priority: 2, rationale: 'Houses the switchgear and its protection. The station is indoor, so the building IS the substation rather than a shelter beside it.' },
    ],

    normal_patterns: {
      operating_hours: '24/7 unmanned. Scheduled inspection twice weekly.',
      typical_ambient_activity: 'Zero human activity outside inspection windows. Local wildlife (birds) and occasional maintenance vehicle.',
      civilian_drone_activity: 'None permitted. Restricted airspace over substations per Trafikstyrelsen.',
    },

    correlator_hints: {
      dwell_alarm_zones: [
        { name: '400 kV switchyard', center: { lat: 55.6410, lon: 12.6088 }, radius_m: 150, threshold_sec: 10 },
        { name: 'Autotransformer bay', center: { lat: 55.6410, lon: 12.6087 }, radius_m: 80,  threshold_sec: 8  },
        { name: 'Control building', center: { lat: 55.6412, lon: 12.6086 }, radius_m: 60, threshold_sec: 10 },
      ],
      unusual_pattern_flags: [
        'Any airborne contact within perimeter regardless of altitude',
        'Multiple simultaneous contacts (swarm) indicate coordinated recon or targeting',
        'RF telemetry consistent with FPV camera platform = active surveillance',
      ],
    },

    // Grid TSO substation: unmanned rural site. No on-site physical
    // response capability — Politi has no station here, no cordon
    // team, no AKS. Response = cascade to Politi + Forsvar + Energinet
    // internal SCADA action. HJV volunteer patrol + BRS standby are
    // the ONLY sensible on-site physical primitives (both respond
    // from off-site bases). Everything else is deliberately absent.
    response_capabilities: [
      'brs-standby',
      'hjv-reinforce',
    ],
  },

  // ── Kassø substation (400 kV + HVDC to Germany) ──────────────────
  energinet_kassoe: {
    site_id: 'energinet_kassoe',
    name: 'Kassø Substation',
    site_type: 'hv_substation_with_hvdc',
    schema_version: '1.0',
    generated_at: '2026-08-05T00:00:00Z',
    generated_by: 'Agent A (stub, replaced by Mistral post-demo)',

    critical_areas: [
      // OSM way 95840891, ref KAS, voltage 400000;150000. Secondary is
      // 150 kV, not the 132 kV previously recorded. Extent 424 x 333 m,
      // with 33 mapped switch nodes forming two busbar rows.
      { id: 'sw_yard_400kv', name: '400/150 kV switchyard', center: { lat: 55.036736, lon: 9.269712 }, criticality: 'critical', verified: 'high',
        reason: 'Main Jutland transmission node toward the German border.' },
    ],

    high_value_assets: [
      // THE HVDC ASSETS PREVIOUSLY LISTED HERE DO NOT EXIST AT THIS SITE.
      // No converter, valve hall or converter transformer is mapped within
      // roughly 20 km. Kontek terminates at Bjaeverskov and all of it has
      // been moved there.
      { id: 'main_tx_1', name: 'Main autotransformer 400/150 kV (1)', location: { lat: 55.037058, lon: 9.271382 }, asset_type: 'transformer', criticality: 'critical', verified: 'high',
        reason: 'Couples the 400 kV and 150 kV networks.' },
      { id: 'main_tx_2', name: 'Main autotransformer 400/150 kV (2)', location: { lat: 55.037312, lon: 9.2713 }, asset_type: 'transformer', criticality: 'critical', verified: 'high',
        reason: 'Couples the 400 kV and 150 kV networks.' },
      { id: 'aux_tx_400_220', name: 'Auxiliary transformer 400/220 kV', location: { lat: 55.036524, lon: 9.271542 }, asset_type: 'transformer', criticality: 'high', verified: 'high',
        reason: 'Secondary coupling transformer.' },
      { id: 'traction_tx_1', name: 'Traction transformer 150/25 kV (1)', location: { lat: 55.037802, lon: 9.271207 }, asset_type: 'transformer', criticality: 'medium', verified: 'high',
        reason: 'Single-phase supply to the electrified railway.' },
      { id: 'traction_tx_2', name: 'Traction transformer 150/25 kV (2)', location: { lat: 55.037938, lon: 9.27117 }, asset_type: 'transformer', criticality: 'medium', verified: 'high',
        reason: 'Single-phase supply to the electrified railway.' },
      // Two of the three reactor nodes carry the mapper's own note
      // "looks like a reactor", an aerial-imagery guess rather than a
      // survey. Medium is generous and is recorded as such.
      { id: 'shunt_reactor_n', name: 'Shunt reactor (north)', location: { lat: 55.037593, lon: 9.271263 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'shunt_reactor_c', name: 'Shunt reactor (centre)', location: { lat: 55.036796, lon: 9.27146 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'shunt_reactor_w', name: 'Shunt reactor (west)', location: { lat: 55.036241, lon: 9.267266 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'lattice_tower', name: 'Lattice tower, 50 m', location: { lat: 55.038021, lon: 9.2702 }, asset_type: 'structure', criticality: 'low', verified: 'high',
        reason: 'Tall structure on site, relevant to low-altitude flight paths.' },
    ],

    sensitive_setups: [
      { id: 'hvdc_cooling', name: 'HVDC valve cooling plant', note: 'Water cooling for valves. Loss forces valve trip within minutes.' },
      { id: 'dc_line_entry', name: 'DC line entry (south to DE border)', note: 'Overhead DC transmission. Sabotage cuts cross-border capacity.' },
    ],

    normal_patterns: {
      operating_hours: '24/7 unmanned. Cross-border valve maintenance coordinated with 50Hertz (DE).',
      typical_ambient_activity: 'Zero human activity outside inspection windows.',
      civilian_drone_activity: 'None permitted. Prior Danish-German incidents involving unidentified drones flagged by Trafikstyrelsen.',
    },

    correlator_hints: {
      dwell_alarm_zones: [
        { name: 'HVDC valve hall', center: { lat: 55.0371, lon: 9.2705 }, radius_m: 100, threshold_sec: 8 },
        { name: '400 kV switchyard', center: { lat: 55.03682, lon: 9.26960 }, radius_m: 200, threshold_sec: 10 },
      ],
      unusual_pattern_flags: [
        'Southbound flight vector after loiter suggests cross-border egress',
        'Contact at HVDC valve hall = state-actor level target selection',
      ],
    },

    // Grid TSO substation — see Amager for full rationale.
    response_capabilities: [
      'brs-standby',
      'hjv-reinforce',
    ],
  },

  // ── Bjæverskov substation (400 kV Zealand-Fyn interconnect) ──────
  energinet_bjaeverskov: {
    site_id: 'energinet_bjaeverskov',
    name: 'Bjæverskov Substation',
    site_type: 'hv_substation',
    schema_version: '1.0',
    generated_at: '2026-08-05T00:00:00Z',
    generated_by: 'Agent A (stub, replaced by Mistral post-demo)',

    critical_areas: [
      // OSM way 26953215, name "Bjaeverskov HVDC Kontek", voltage 400000.
      // Mapped extent 583 x 393 m, the largest and best-mapped of the six.
      { id: 'sw_yard_400kv', name: '400 kV switchyard', center: { lat: 55.451644, lon: 12.006024 }, criticality: 'critical', verified: 'high',
        reason: 'Central Zealand transmission node feeding the capital region via Amager.' },
      // THIS SITE IS THE KONTEK HVDC TERMINAL. Until 2026-09-23 the
      // platform believed that infrastructure sat at Kassoe, 200 km away
      // in Jutland, while this site was modelled as a generic substation.
      // Kassoe has no converter mapped within 20 km. OSM names this
      // building explicitly: way 142321228, substation=converter,
      // rating 600 MW. Our own site label already said HVDC Kontek; only
      // the asset list disagreed.
      { id: 'hvdc_valve_hall', name: 'HVDC Kontek static inverter hall (600 MW)', center: { lat: 55.450304, lon: 12.007611 }, criticality: 'critical', verified: 'high',
        reason: 'Danish converter terminal of the Kontek link to Germany. Losing the hall severs the interconnector.' },
    ],

    high_value_assets: [
      // All three phases individually mapped: OSM nodes 2210444164/65/66.
      { id: 'converter_tx_a', name: 'Converter transformer, phase A (232 MVA)', location: { lat: 55.450419, lon: 12.007313 }, asset_type: 'hvdc_converter', criticality: 'critical', verified: 'high',
        reason: 'Single-phase converter transformer feeding the valve hall.' },
      { id: 'converter_tx_b', name: 'Converter transformer, phase B (232 MVA)', location: { lat: 55.45042, lon: 12.007444 }, asset_type: 'hvdc_converter', criticality: 'critical', verified: 'high',
        reason: 'Single-phase converter transformer feeding the valve hall.' },
      { id: 'converter_tx_c', name: 'Converter transformer, phase C (232 MVA)', location: { lat: 55.45042, lon: 12.007561 }, asset_type: 'hvdc_converter', criticality: 'critical', verified: 'high',
        reason: 'Single-phase converter transformer feeding the valve hall.' },
      { id: 'auto_tx_1', name: 'Autotransformer 400/132 kV', location: { lat: 55.452385, lon: 12.008153 }, asset_type: 'transformer', criticality: 'critical', verified: 'high',
        reason: 'Couples the 400 kV bus to the regional 132 kV network.' },
      { id: 'harmonic_filter_60', name: 'Harmonic filter, 60 Mvar', location: { lat: 55.451567, lon: 12.006733 }, asset_type: 'compensation', criticality: 'high', verified: 'high',
        reason: 'AC-side harmonic filtering for the converter.' },
      { id: 'harmonic_filter_113_1', name: 'Harmonic filter, 113 Mvar (1)', location: { lat: 55.45132, lon: 12.006755 }, asset_type: 'compensation', criticality: 'high', verified: 'high',
        reason: 'AC-side harmonic filtering for the converter.' },
      { id: 'harmonic_filter_113_2', name: 'Harmonic filter, 113 Mvar (2)', location: { lat: 55.45107, lon: 12.006749 }, asset_type: 'compensation', criticality: 'high', verified: 'high',
        reason: 'AC-side harmonic filtering for the converter.' },
      { id: 'synchronous_condenser', name: 'Synchronous condenser', location: { lat: 55.451222, lon: 12.005247 }, asset_type: 'compensation', criticality: 'high', verified: 'high',
        reason: 'Provides inertia and short-circuit strength for the converter terminal.' },
      { id: 'series_reactor', name: 'Series reactor', location: { lat: 55.450086, lon: 12.007392 }, asset_type: 'compensation', criticality: 'medium', verified: 'high',
        reason: 'Limits fault current on the converter side.' },
      { id: 'shunt_reactor_400', name: 'Shunt reactor, 400 kV', location: { lat: 55.451618, lon: 12.008122 }, asset_type: 'compensation', criticality: 'medium', verified: 'high',
        reason: 'Reactive compensation on the 400 kV bus.' },
      // OSM way 291974925, building=industrial, 30 x 26 m, beside the
      // synchronous condenser. Function inferred from position; OSM does
      // not tag it as a control building.
      { id: 'control_building', name: 'Control + relay building', location: { lat: 55.45119, lon: 12.005297 }, asset_type: 'control_room', criticality: 'critical', verified: 'medium',
        reason: 'Protection and control for the converter terminal.' },
    ],

    sensitive_setups: [
      { id: 'line_out_amager', name: '400 kV overhead line to Amager Koblingsstation', note: 'Direct feed to CPH region. Physical attack on gantry = regional impact.' },
    ],

    normal_patterns: {
      operating_hours: '24/7 unmanned. Weekly inspection.',
      typical_ambient_activity: 'Zero human activity outside inspection.',
      civilian_drone_activity: 'None permitted.',
    },

    correlator_hints: {
      dwell_alarm_zones: [
        { name: '400 kV switchyard', center: { lat: 55.45151, lon: 12.00729 }, radius_m: 180, threshold_sec: 10 },
      ],
      unusual_pattern_flags: [
        'Any airborne contact within perimeter',
        'NE flight vector suggests continuation toward Amager or CPH',
      ],
    },

    // Grid TSO substation — see Amager for full rationale.
    response_capabilities: [
      'brs-standby',
      'hjv-reinforce',
    ],
  },

  // ── Esbjerg (port + offshore wind hub) ───────────────────────────
  esbjerg: {
    site_id: 'esbjerg',
    name: 'Port of Esbjerg',
    site_type: 'port_offshore_wind_hub',
    schema_version: '1.0',
    generated_at: '2026-08-05T00:00:00Z',
    generated_by: 'Agent A (stub, replaced by Mistral post-demo)',
    // Anchor for reconciler bbox lookups (cooperative-traffic + future
    // spatial queries). Centroid of the operational port area.
    port_reference_point: { lat: 55.4680, lon: 8.4500 },

    critical_areas: [
      // OSM way 282017162. Last edited 2026-05, so this part of the port
      // is actively changing.
      { id: 'osthavnen', name: 'Østhavnen (offshore wind heavy-lift area)', center: { lat: 55.4512, lon: 8.483749 }, criticality: 'critical', verified: 'high',
        reason: 'Where offshore wind components are staged and loaded out. Europe largest offshore wind port operates from here.' },
      // Esbjerg names its quays, it does not number them, so the
      // "deepwater quays 4 and 5" previously recorded do not exist as
      // named features.
      // 
      // Every quay position here is a ROAD CENTRELINE MIDPOINT, not the
      // quay face: OSM maps no quay edges, berths or draught anywhere in
      // this port. Expect 10 to 30 m of offset toward land, and on a
      // 600 m quay the midpoint says little about where a vessel sits.
      // Berth-level precision is not available from open data.
      { id: 'virgokaj', name: 'Virgokaj (Østhavnen)', center: { lat: 55.452863, lon: 8.47678 }, criticality: 'critical', verified: 'medium',
        reason: 'Longest Østhavnen quay at roughly 624 m. Heavy-lift and installation-vessel berthing.' },
      { id: 'trafikhavnskaj', name: 'Trafikhavnskaj', center: { lat: 55.469214, lon: 8.433375 }, criticality: 'high', verified: 'medium',
        reason: 'Longest quay in the older port at roughly 812 m. General cargo and supply traffic.' },
    ],

    high_value_assets: [
      // OSM node 12070290999, operator Ørsted, CVR 31849322.
      { id: 'ow_om_base', name: 'Ørsted offshore wind O&M base (Horns Rev 2)', location: { lat: 55.475426, lon: 8.425004 }, asset_type: 'maintenance_facility', criticality: 'high', verified: 'high',
        reason: 'Operations and maintenance base for offshore wind. Crew transfer and spares.' },
      { id: 'offshore_supply_base', name: 'Offshore Supply Base', location: { lat: 55.463326, lon: 8.449622 }, asset_type: 'maintenance_facility', criticality: 'high', verified: 'high',
        reason: 'Supply base serving offshore operations.' },
      // Tank contents are not tagged in OSM. The depot operator is named,
      // the individual tanks are positioned, but what each holds is not
      // recorded and is not inferred here.
      { id: 'fuel_depot_q8', name: 'Kuwait Petroleum (Q8) fuel depot', location: { lat: 55.470745, lon: 8.424576 }, asset_type: 'fuel_storage', criticality: 'critical', verified: 'high',
        reason: 'Bulk fuel storage inside the port. Five tanks mapped.' },
      // Cluster centroid across OSM ways 135543364-135543377. A centroid,
      // not a single structure.
      { id: 'tank_farm_north', name: 'Tank farm, Tobiskaj area (12 tanks)', location: { lat: 55.4774, lon: 8.4208 }, asset_type: 'fuel_storage', criticality: 'high', verified: 'medium',
        reason: 'Cluster of twelve storage tanks. Contents not recorded.' },
      { id: 'gas_tanks', name: 'Gas storage tanks (4)', location: { lat: 55.482489, lon: 8.421701 }, asset_type: 'fuel_storage', criticality: 'high', verified: 'high',
        reason: 'Four tanks explicitly tagged as gas storage. The only tanks in the port whose contents OSM records.' },
      { id: 'drydock_1', name: 'Drydock 1 (Esbjerg Shipyard)', location: { lat: 55.477545, lon: 8.41334 }, asset_type: 'maintenance_facility', criticality: 'medium', verified: 'high',
        reason: 'Ship repair. Vessels immobilised here for extended periods.' },
      { id: 'hot_water_accumulator', name: 'Accumulator tank, 45,000 m3', location: { lat: 55.46021, lon: 8.457346 }, asset_type: 'utility', criticality: 'medium', verified: 'high',
        reason: 'Forty-five metre hot-water accumulator. A tall, distinctive structure on approach.' },
    ],

    // Partner-declared narrative highlights (FIX-4 per architecture review).
    // Port-side priorities lead with the highest-value physical assets
    // (installation vessel, deepwater quays) then the operational choke
    // points (pilot dock, LNG area). See CPH block above for schema notes.
    // Rewritten 2026-09-23 with the asset list. The old entries named a
    // berthed installation vessel, numbered deepwater quays and a
    // planned LNG terminal. Esbjerg names its quays rather than
    // numbering them, no berth or vessel is mapped, and no LNG feature
    // exists anywhere in the port in open data.
    highlights: [
      { asset_id: 'osthavnen', priority: 1, rationale: 'Offshore wind heavy-lift and load-out area. Denial here interrupts installation campaigns across the North Sea, which is what makes this port strategically significant.' },
      { asset_id: 'fuel_depot_q8', priority: 2, rationale: 'Bulk fuel storage inside the port. A standoff attack creates a fire hazard that cascades to surrounding quays.' },
      { asset_id: 'virgokaj', priority: 3, rationale: 'Longest Østhavnen quay. Where installation vessels berth when alongside.' },
      { asset_id: 'ow_om_base', priority: 4, rationale: 'Operations and maintenance base for the offshore wind fleet. Crew transfer and spares for Horns Rev and the wider North Sea.' },
      { asset_id: 'gas_tanks', priority: 5, rationale: 'The only tanks in the port whose contents are recorded. Gas storage carries a different hazard profile from the liquid fuel tanks.' },
    ],

    sensitive_setups: [
      { id: 'pilot_boat_dock',  name: 'Pilot boat dock',       note: 'Coordination point for all commercial arrivals. Disruption cascades to port throughput.' },
      { id: 'northsea_approach', name: 'North Sea shipping approach', note: 'Primary entry for offshore-wind and cargo vessels.' },
    ],

    normal_patterns: {
      operating_hours: '24/7 for commercial + offshore wind ops.',
      typical_ambient_activity: 'Continuous cargo + vessel movement. Wind O&M helicopter routes over harbour.',
      civilian_drone_activity: 'Port-authorised inspection drones over quays; recreational drones prohibited within 3 NM.',
    },

    correlator_hints: {
      dwell_alarm_zones: [
        { name: 'Deepwater quay 4', center: { lat: 55.467, lon: 8.450 }, radius_m: 200, threshold_sec: 20 },
        { name: 'OW installation vessel berth', center: { lat: 55.468, lon: 8.449 }, radius_m: 150, threshold_sec: 15 },
      ],
      unusual_pattern_flags: [
        'Sea-approach vector (from W) with descending altitude profile = payload delivery pattern',
        'RF signature matching mil-COTS platforms indicates state actor',
      ],
    },

    // Cooperative-aircraft feed. Esbjerg has continuous helicopter
    // O&M traffic to offshore wind installations. 'expected: true'
    // so absence-of-match on a helicopter track is a strong signal.
    cooperative_traffic: {
      expected: true,
      source: 'opensky',
      match_radius_m: 800,
      match_time_window_s: 8,
      bbox_padding_deg: 0.15,
    },

    // Port + military port + offshore wind hub: physical response
    // is credible on the quays (Politi Sydvestjylland + military
    // port garrison + BRS). Maritime advisory is the site-specific
    // regulatory action. No airspace-restrict (not Naviair-controlled
    // airspace at this scale). No AKS (recon-drone threats don't
    // warrant anti-terror tactical). No wildlife-management (not
    // airport bird-strike context).
    response_capabilities: [
      'deploy-patrol', 'set-cordon',
      'brs-standby', 'brs-deploy',
      'army-c-uas', 'army-ground',
      'issue-maritime-advisory',
      'kom-crisis', 'kom-shelter',
      'hjv-reinforce',
      'region-ambulance-standby', 'region-triage-prep',
    ],
  },

  // ── Billund Airport (BLL / EKBI) ──────────────────────────────────
  // Denmark's second-busiest passenger airport + largest air cargo hub
  // (Cargo Handling Billund Airport / CHBA). Municipal-owned (7 Jylland
  // kommuner). Naviair Remote Tower Centre. Adjacent to Legoland Billund
  // Resort + LEGO Group HQ — critical infrastructure blast radius
  // includes both airport and adjacent LEGO complex tourism/HQ.
  // ARP verified from Naviair AIP EKBI. Asset coordinates approximate
  // (derived from runway 09/27 orientation + terminal south layout);
  // refine from OSM aeroway=aerodrome for EKBI post-onboarding.
  billund: {
    site_id: 'billund',
    name: 'Billund Airport (BLL)',
    site_type: 'commercial_airport',
    schema_version: '1.0',
    generated_at: '2026-08-31T00:00:00Z',
    generated_by: 'Positions verified 2026-09-22 against OpenStreetMap features and Danmarks Adresseregister, the official Danish address register. The previous set was authored approximate and was wrong by 800m to 1.4km on seven of nine assets, which on a 3km airfield named a different building every time.',
    airport_reference_point: { lat: 55.740511, lon: 9.158056 },
    // Note: this ARP sits ~62 m east of the runway threshold midpoint
    // and ~139 m east of the aerodrome polygon centroid. Three different
    // definitions of "the airport's position" exist and they disagree.
    // Left as declared because nothing currently uses it as a distance
    // origin; pin down which definition is meant before anything does.

    critical_areas: [
      { id: 'runway_09_27',           name: 'Runway 09/27 (3100m x 45m)', center: { lat: 55.740477, lon: 9.157077 }, criticality: 'critical', verified: 'high',
        // Midpoint of the two mapped landing thresholds (OSM nodes
        // 4038840084 and 4038849890), each corroborated against
        // AIP-derived data to within 6 m.
        //
        // The landing thresholds sit ~148 m INSIDE the physical pavement
        // at both ends. Anything reasoning about "near the runway end"
        // wants the pavement ends (9.132422 W / 9.181723 E), not these.
        reason: 'Single runway. Any obstruction closes the airport entirely — no parallel to fall back on.' },
      { id: 'terminal_passenger',     name: 'Passenger terminal (T1 + T2)', center: { lat: 55.746014, lon: 9.147362 }, criticality: 'high', verified: 'high',
        // OSM way 96215030, aeroway=terminal. The previous coordinate
        // was 1017 m south-east of the actual building.
        reason: '2 passenger terminals, 16 gates. Combined check-in + gates + baggage.' },
      { id: 'apron_cargo',            name: 'Cargo apron (Apron South)', center: { lat: 55.737861, lon: 9.138937 }, criticality: 'high', verified: 'medium',
        // OSM way 401472170, a mapped and named apron. Nothing in OSM
        // tags it as cargo; that role is inferred from its adjacency to
        // the CHBA terminal on Eksportvej. Medium for that reason, not
        // because the apron's position is in doubt.
        reason: 'Denmark\'s largest air cargo hub (Cargo Handling Billund Airport). International freight throughput.' },
      { id: 'apron_ga',               name: 'GA / Business apron', center: { lat: 55.736098, lon: 9.148758 }, criticality: 'medium', verified: 'medium',
        // OSM ways 1278173052/1278173053, mapped aprons surrounded by a
        // hangar cluster. The general-aviation role is inferred from the
        // Sun-Air of Scandinavia office beside them.
        reason: 'General aviation + business terminal (Sun-Air of Scandinavia base). VIP + private aircraft.' },
    ],

    high_value_assets: [
      { id: 'atc_remote_tower',       name: 'ATC precinct (control tower + Naviair Remote Tower Centre)', location: { lat: 55.737575, lon: 9.167302 }, asset_type: 'atc_control_tower', criticality: 'critical', verified: 'medium',
        // This is the EXISTING control tower structure, OSM way
        // 254576245, which is mapped with matching tags.
        //
        // Billund HOSTS Naviair's Remote Tower Centre rather than being
        // controlled from elsewhere: the centre is a modular building
        // beside this tower, and the long-term intent is to control other
        // Danish regional airports FROM here. The modular building's own
        // coordinate could not be verified, and no source confirms the
        // centre went live or that the old tower is decommissioned.
        // Treat this point as the ATC precinct, and both the tower and
        // the centre as status-uncertain.
        reason: 'Single point of airspace control failure for this airport, and the host site for Naviair remote tower operations.' },
      { id: 'ils_09',                 name: 'ILS installation, runway 09 approach', location: { lat: 55.74050, lon: 9.13800 }, asset_type: 'ils_ground_installation', criticality: 'high', verified: 'unverified',
        // Billund has ILS on both ends, but OpenStreetMap contains no
        // ILS feature anywhere on the field: every navigationaid node is
        // lighting, and there is no mapped antenna. This position is the
        // original author's estimate and has NOT been confirmed. The
        // Danish AIP (aim.naviair.dk, AD 2 EKBI) publishes navaid
        // coordinates to sub-second precision and is the place to source
        // it. Kept rather than deleted because the installation is real.
        reason: 'Instrument approach guidance for runway 09.' },
      { id: 'ils_27',                 name: 'ILS installation, runway 27 approach', location: { lat: 55.74050, lon: 9.17200 }, asset_type: 'ils_ground_installation', criticality: 'high', verified: 'unverified',
        // Same as ils_09: real installation, unconfirmed position.
        reason: 'Instrument approach guidance for runway 27.' },
      { id: 'fire_station_arff',      name: 'Airport fire station (ARFF)', location: { lat: 55.745829, lon: 9.151182 }, asset_type: 'emergency_response', criticality: 'high', verified: 'high',
        // OSM way 96217180, amenity=fire_station, operator=Billund
        // Lufthavn. Previous coordinate was 871 m out.
        reason: 'ICAO-required aircraft rescue + firefighting. On-airfield location required for response time SLA.' },
      { id: 'cargo_chba',             name: 'CHBA cargo handling facility', location: { lat: 55.736927, lon: 9.144113 }, asset_type: 'maintenance_facility', criticality: 'high', verified: 'high',
        // Eksportvej 40, from the official Danish address register and
        // confirmed on chba.dk. An address point is a plot access point
        // rather than a building centroid, so expect 10 to 40 m offset
        // from the building centre.
        reason: 'Cargo Handling Billund Airport — largest DK air cargo operator. High-value goods throughput.' },
      { id: 'cargo_bws',              name: 'Blue Water Shipping airside office', location: { lat: 55.735378, lon: 9.150589 }, asset_type: 'maintenance_facility', criticality: 'medium', verified: 'medium',
        // Stratusvej 12, the company's own current published address,
        // via the Danish address register. Third-party directories still
        // list two different Cargo Centervej addresses, so this appears
        // to have moved. No OSM building carries the name. Re-verify
        // before this drives operational reasoning.
        reason: 'Global freight forwarder airside operations. Specialty cargo (project logistics, oversized).' },
    ],

    // Response asset coordination points — NOTIONAL / PROPOSED positions
    // where ISR data would be relayed for external counter-UAS deployment.
    // ISR is detection-only; these are NOT ISR-owned assets and NOT
    // confirmed real deployment sites. Same demo scaffolding convention
    // as the CPH block.
    response_asset_positions: [
      { id: 'cuas_stage_s',   name: 'CUAS staging area, South perimeter', location: { lat: 55.73600, lon: 9.15500 }, asset_type: 'cuas_staging', criticality: 'high',
        reason: 'Pre-cleared ground for mobile counter-UAS units. South side, clear zone from active runway.' },
      { id: 'cuas_stage_n',   name: 'CUAS staging area, North perimeter', location: { lat: 55.74400, lon: 9.15500 }, asset_type: 'cuas_staging', criticality: 'high',
        reason: 'North perimeter deployment point. Covers approach vectors from N/NE.' },
      // Both sat on the pre-correction ATC guess, ~750 m from the
      // verified ATC precinct. Moved with it.
      { id: 'overwatch_atc',  name: 'Overwatch position, ATC precinct', location: { lat: 55.737575, lon: 9.167302 }, asset_type: 'overwatch', criticality: 'high',
        reason: 'Elevated vantage point at the control tower. Coordinated overwatch for critical response.' },
      { id: 'qra_relay',      name: 'QRA dispatch relay (to Flyvestation Karup)', location: { lat: 55.737575, lon: 9.167302 }, asset_type: 'qra_relay', criticality: 'critical',
        reason: 'Tier 4 escalation to Flyvestation Karup (~90km NW). Fastest air-response coordination for Jylland.' },
    ],

    sensitive_setups: [
      { id: 'approach_axis_09',  name: 'Runway 09 approach corridor (from W)', note: 'Airborne track on approach axis within 3 NM triggers ILS interference alert.' },
      { id: 'approach_axis_27',  name: 'Runway 27 approach corridor (from E)', note: 'Reciprocal approach corridor. Same sensitivity.' },
      { id: 'legoland_adjacency', name: 'Legoland Billund Resort (~2km SE)', note: 'Adjacent tourism site with high day-time crowd density. Off-airport but blast-radius adjacent for a payload event at BLL.' },
      { id: 'lego_hq_adjacency', name: 'LEGO Group HQ Billund (~2km S)', note: 'LEGO corporate HQ adjacent to airport. Strategic Danish enterprise site.' },
    ],

    // Partner-declared narrative highlights (FIX-4 pattern).
    // Single-runway airport = runway is EVERYTHING. ATC is next.
    // Cargo hub distinguishes BLL from other Danish regionals.
    highlights: [
      { asset_id: 'runway_09_27',      priority: 1, rationale: 'Single runway. Any obstruction or interference closes the airport entirely. No parallel to fall back on, unlike CPH.' },
      { asset_id: 'atc_remote_tower',  priority: 2, rationale: 'Naviair Remote Tower Centre. Loss cascades to airspace closure and degrades DK regional ATC roadmap (RTC is a strategic Naviair initiative).' },
      { asset_id: 'cargo_chba',        priority: 3, rationale: 'Denmark\'s largest air cargo hub. High-value freight throughput; extended operation into night hours makes cargo apron a distinct target profile.' },
      { asset_id: 'terminal_passenger', priority: 4, rationale: 'Passenger terminal complex (T1 + T2). Combined check-in + gates + baggage. High crowd density.' },
      { asset_id: 'fire_station_arff', priority: 5, rationale: 'ARFF station. Degrading this station lowers emergency response capacity for any concurrent aviation incident.' },
    ],

    normal_patterns: {
      operating_hours: 'Scheduled passenger ops broadly 06:00-23:00 local; cargo + Sun-Air business ops extend into night.',
      typical_ambient_activity: 'Continuous scheduled + charter passenger arrivals/departures. Cargo movements concentrated overnight. Occasional LEGO corporate charter activity.',
      civilian_drone_activity: 'None permitted inside CTR / aerodrome. Restricted airspace over BLL per Trafikstyrelsen.',
    },

    correlator_hints: {
      dwell_alarm_zones: [
        // Kept in step with critical_areas / high_value_assets above.
        // These were left behind when those were corrected on
        // 2026-09-22 and disagreed with them by up to 1.4 km inside
        // this one file, which would have alarmed on a zone no asset
        // occupied.
        { name: 'Runway centre', center: { lat: 55.740477, lon: 9.157077 }, radius_m: 300, threshold_sec: 15 },
        { name: 'Cargo apron (CHBA)', center: { lat: 55.737861, lon: 9.138937 }, radius_m: 200, threshold_sec: 20 },
        { name: 'Passenger terminal', center: { lat: 55.746014, lon: 9.147362 }, radius_m: 250, threshold_sec: 20 },
        { name: 'ATC precinct', center: { lat: 55.737575, lon: 9.167302 }, radius_m: 150, threshold_sec: 8 },
      ],
      unusual_pattern_flags: [
        'Approach-corridor axis with descending altitude = ILS-interference profile',
        'Sustained dwell over CHBA cargo apron in night-hours window = coordinated cargo-theft reconnaissance',
        'Direct overflight of LEGO HQ/Legoland from BLL airspace = corporate-target reconnaissance vector',
      ],
    },

    // Cooperative-aircraft feed. BLL sees heavy commercial + cargo
    // traffic — cooperative_traffic.expected: true.
    cooperative_traffic: {
      expected: true,
      source: 'opensky',
      match_radius_m: 800,
      match_time_window_s: 8,
      bbox_padding_deg: 0.15,
    },

    // Second-busiest DK passenger airport + largest air cargo hub.
    // Similar envelope to CPH but smaller scale. Same full-response
    // capability set applies in principle — actor scaling handled by
    // the branch role (regional Politi, HJV Jylland, etc.).
    response_capabilities: [
      'deploy-patrol', 'set-cordon', 'request-aks',
      'brs-standby', 'brs-deploy',
      'army-c-uas', 'army-ground',
      'issue-notam', 'restrict-airspace',
      'kom-crisis', 'kom-shelter',
      'hjv-reinforce',
      'region-ambulance-standby', 'region-triage-prep',
    ],
  },

  // ── Remaining Energinet substations (schema stubs) ───────────────
  energinet_hovegaard: {
    site_id: 'energinet_hovegaard', name: 'Hovegård Substation', site_type: 'hv_substation',
    schema_version: '1.0', generated_at: '2026-08-05T00:00:00Z', generated_by: 'Positions verified 2026-09-23 against mapped OpenStreetMap power features',
    critical_areas: [
      // OSM way 26452107, voltage 400000;132000, extent 243 x 379 m.
      // Nineteen switch nodes fall into a clear west and east column,
      // a usable proxy for two switchyards, but OSM does not say which
      // carries which voltage so neither is labelled. This is the only
      // transmission site of the six with no fence mapped.
      { id: 'sw_yard_400kv', name: '400/132 kV switchyard', center: { lat: 55.73228, lon: 12.2338 }, criticality: 'critical', verified: 'high',
        reason: 'North Zealand transmission node.' },
    ],
    high_value_assets: [
      // Position solid (OSM node 2097630366) but tagged
      // transformer=auxiliary rather than main, so "autotransformer" goes
      // beyond what the data asserts. Hence medium.
      { id: 'tx_400_132_s', name: 'Transformer 400/132 kV (south)', location: { lat: 55.731535, lon: 12.234478 }, asset_type: 'transformer', criticality: 'critical', verified: 'medium',
        reason: 'Couples the 400 kV bus to the regional 132 kV network.' },
      { id: 'tx_400_132_n', name: 'Transformer 400/132 kV (north)', location: { lat: 55.733128, lon: 12.233866 }, asset_type: 'transformer', criticality: 'critical', verified: 'medium',
        reason: 'Couples the 400 kV bus to the regional 132 kV network.' },
      { id: 'shunt_reactor_w', name: 'Shunt reactor (west)', location: { lat: 55.731833, lon: 12.232478 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'shunt_reactor_e', name: 'Shunt reactor (east)', location: { lat: 55.731991, lon: 12.234407 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'filter_bank', name: 'Filter', location: { lat: 55.731337, lon: 12.235546 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Power-quality filtering.' },
    ],
    sensitive_setups: [],
    normal_patterns: { operating_hours: '24/7 unmanned.', typical_ambient_activity: 'Inspection only.', civilian_drone_activity: 'None permitted.' },
    correlator_hints: { dwell_alarm_zones: [{ name: '400 kV switchyard', center: { lat: 55.732280, lon: 12.233800 }, radius_m: 180, threshold_sec: 10 }], unusual_pattern_flags: ['Any airborne contact within perimeter'] },
    response_capabilities: ['brs-standby', 'hjv-reinforce'],   // Grid TSO — see Amager for rationale
  },
  energinet_landerupgaard: {
    site_id: 'energinet_landerupgaard', name: 'Landerupgård Substation', site_type: 'hv_substation',
    schema_version: '1.0', generated_at: '2026-08-05T00:00:00Z', generated_by: 'Positions verified 2026-09-23 against mapped OpenStreetMap power features',
    critical_areas: [
      // OSM way 42128776, ref LAG, voltage 400000;150000, extent
      // 354 x 409 m. No switch nodes mapped, so the internal layout is
      // sparser here than at Kassoe or Bjaeverskov. Two shunt reactors
      // were added to OSM recently, so the site has likely been expanded.
      { id: 'sw_yard_400kv', name: '400/150 kV switchyard', center: { lat: 55.56394, lon: 9.547258 }, criticality: 'critical', verified: 'high',
        reason: 'Triangle-region transmission node, Kolding kommune.' },
    ],
    high_value_assets: [
      // Tagged transformer=main, a stronger claim than the auxiliary tags
      // at Hovegaard and Ferslev.
      { id: 'main_tx_400_150', name: 'Main transformer 400/150 kV', location: { lat: 55.563302, lon: 9.546611 }, asset_type: 'transformer', criticality: 'critical', verified: 'high',
        reason: 'Couples the 400 kV and 150 kV networks.' },
      { id: 'shunt_reactor_400', name: 'Shunt reactor, 400 kV', location: { lat: 55.563206, lon: 9.546876 }, asset_type: 'compensation', criticality: 'high', verified: 'high',
        reason: 'Reactive compensation on the 400 kV bus.' },
      { id: 'shunt_reactor_ne', name: 'Shunt reactor (north-east)', location: { lat: 55.56425, lon: 9.549504 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'shunt_reactor_n', name: 'Shunt reactor (north)', location: { lat: 55.564572, lon: 9.549791 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'shunt_reactor_nw', name: 'Shunt reactor (north-west)', location: { lat: 55.56537, lon: 9.547224 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'shunt_reactor_w', name: 'Shunt reactor (west)', location: { lat: 55.565172, lon: 9.546513 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'shunt_reactor_s', name: 'Shunt reactor (south)', location: { lat: 55.563018, lon: 9.547529 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'comms_tower', name: 'Communication tower', location: { lat: 55.563308, lon: 9.548728 }, asset_type: 'structure', criticality: 'medium', verified: 'high',
        reason: 'Just outside the fence. Site communications, and a tall structure on approach.' },
    ],
    sensitive_setups: [],
    normal_patterns: { operating_hours: '24/7 unmanned.', typical_ambient_activity: 'Inspection only.', civilian_drone_activity: 'None permitted.' },
    correlator_hints: { dwell_alarm_zones: [{ name: '400 kV switchyard', center: { lat: 55.563940, lon: 9.547258 }, radius_m: 200, threshold_sec: 10 }], unusual_pattern_flags: ['Any airborne contact within perimeter'] },
    response_capabilities: ['brs-standby', 'hjv-reinforce'],   // Grid TSO — see Amager for rationale
  },
  energinet_ferslev: {
    site_id: 'energinet_ferslev', name: 'Ferslev Substation', site_type: 'hv_substation',
    schema_version: '1.0', generated_at: '2026-08-05T00:00:00Z', generated_by: 'Positions verified 2026-09-23 against mapped OpenStreetMap power features',
    critical_areas: [
      // OSM way 98033206, voltage 400000;150000, extent 314 x 266 m,
      // twelve switch nodes in two rows. This polygon has not been edited
      // since 2021, making it the least current of the six.
      { id: 'sw_yard_400kv', name: '400/150 kV switchyard', center: { lat: 56.956533, lon: 9.879134 }, criticality: 'critical', verified: 'high',
        reason: 'North Jutland transmission node serving the Aalborg region.' },
    ],
    high_value_assets: [
      // Tagged transformer=auxiliary, so the autotransformer label is not
      // asserted by the data. Position is solid.
      { id: 'tx_400_150', name: 'Transformer 400/150 kV', location: { lat: 56.956607, lon: 9.878804 }, asset_type: 'transformer', criticality: 'critical', verified: 'medium',
        reason: 'Couples the 400 kV and 150 kV networks.' },
      { id: 'tx_150_60', name: 'Transformer 150/60 kV', location: { lat: 56.95613, lon: 9.877953 }, asset_type: 'transformer', criticality: 'high', verified: 'high',
        reason: 'Steps 150 kV down to the 60 kV distribution network.' },
      { id: 'shunt_reactor_s', name: 'Shunt reactor, 400 kV (south)', location: { lat: 56.956378, lon: 9.878573 }, asset_type: 'compensation', criticality: 'high', verified: 'high',
        reason: 'Reactive compensation on the 400 kV bus.' },
      { id: 'shunt_reactor_w', name: 'Shunt reactor (west)', location: { lat: 56.956835, lon: 9.877413 }, asset_type: 'compensation', criticality: 'medium', verified: 'medium',
        reason: 'Reactive compensation.' },
      { id: 'shunt_reactor_ne', name: 'Shunt reactor, 400 kV (north-east)', location: { lat: 56.957104, lon: 9.880766 }, asset_type: 'compensation', criticality: 'medium', verified: 'high',
        reason: 'Reactive compensation on the 400 kV bus.' },
      { id: 'shunt_reactor_n', name: 'Shunt reactor, 400 kV (north)', location: { lat: 56.957258, lon: 9.880167 }, asset_type: 'compensation', criticality: 'medium', verified: 'high',
        reason: 'Reactive compensation on the 400 kV bus.' },
      { id: 'transition_compound', name: 'Transition compound', location: { lat: 56.956897, lon: 9.881923 }, asset_type: 'switchgear', criticality: 'medium', verified: 'high',
        reason: 'Separate fenced compound about 60 m east, where overhead lines transition.' },
    ],
    sensitive_setups: [],
    normal_patterns: { operating_hours: '24/7 unmanned.', typical_ambient_activity: 'Inspection only.', civilian_drone_activity: 'None permitted.' },
    correlator_hints: { dwell_alarm_zones: [{ name: '400 kV switchyard', center: { lat: 56.956533, lon: 9.879134 }, radius_m: 180, threshold_sec: 10 }], unusual_pattern_flags: ['Any airborne contact within perimeter'] },
    response_capabilities: ['brs-standby', 'hjv-reinforce'],   // Grid TSO — see Amager for rationale
  },
};

// Public accessor. All consumers must go through this so a future
// Mistral-backed dynamic loader can hook in one place.
export function contextForSite(siteId) {
  return SITE_CONTEXT[siteId] || null;
}

// Utility for Agent B: return the closest critical area (by centre) to
// a given point, or null if none within `maxKm`.
export function nearestCriticalArea(siteId, lat, lon, maxKm = 2) {
  const ctx = contextForSite(siteId);
  if (!ctx || !ctx.critical_areas?.length) return null;
  const areas = ctx.critical_areas.filter(a => a.center);
  if (!areas.length) return null;
  const R = 6371;
  const rad = (d) => d * Math.PI / 180;
  const distKm = (a, b) => {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  };
  let best = null;
  for (const a of areas) {
    const d = distKm({ lat, lon }, a.center);
    if (d <= maxKm && (!best || d < best.dist)) best = { area: a, dist: +d.toFixed(3) };
  }
  return best;
}

// Utility for Agent B: return all dwell-alarm zones the point falls
// within. Used to flag "sustained loiter over critical zone" events.
export function dwellZonesAtPoint(siteId, lat, lon) {
  const ctx = contextForSite(siteId);
  const zones = ctx?.correlator_hints?.dwell_alarm_zones;
  if (!zones?.length) return [];
  const R = 6371000;
  const rad = (d) => d * Math.PI / 180;
  const distM = (a, b) => {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  };
  const hits = [];
  for (const z of zones) {
    const d = distM({ lat, lon }, z.center);
    if (d <= z.radius_m) hits.push({ zone: z, range_m: Math.round(d) });
  }
  return hits;
}
