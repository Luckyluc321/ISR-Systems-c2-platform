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
      { id: 'runway_04L_22R', name: 'Runway 04L/22R (primary)', center: { lat: 55.62267, lon: 12.64620 }, criticality: 'critical', verified: 'approximate',
        reason: 'Primary arrival axis. Airborne obstruction on approach triggers go-around; ground incursion closes the runway.' },
      { id: 'runway_04R_22L', name: 'Runway 04R/22L (parallel)', center: { lat: 55.61019, lon: 12.63982 }, criticality: 'critical', verified: 'approximate',
        reason: 'Parallel arrival axis. Simultaneous ops with 04L; obstruction cascades to full airfield closure.' },
      { id: 'runway_12_30',   name: 'Runway 12/30 (crosswind)',   center: { lat: 55.61643, lon: 12.65258 }, criticality: 'high', verified: 'approximate',
        reason: 'Secondary crosswind runway. Used in NE/SW wind conditions.' },

      // Terminal 1 — INACTIVE since 29 Mar 2015 (Wikipedia). Retained for
      // completeness but flagged; do not target for operational alerts.
      { id: 'terminal_1', name: 'Terminal 1 (INACTIVE since 2015)', center: { lat: 55.62778, lon: 12.65030 }, criticality: 'low', verified: 'approximate', status: 'inactive',
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
      { id: 'cargo_postnord', name: 'PostNord mail terminal area', center: { lat: 55.62029, lon: 12.67621 }, criticality: 'medium', verified: 'approximate',
        source: 'https://www.openstreetmap.org/node/3717655615',
        reason: 'National postal sorting. Includes classified government correspondence. Bus stop tagged; precise building footprint pending on-site survey.' },
    ],

    high_value_assets: [
      // Air traffic control + navigation (4)
      { id: 'atc_tower_syd',   name: 'Tower Syd (ATC control tower)',    location: { lat: 55.61180, lon: 12.65760 }, asset_type: 'atc_control_tower', criticality: 'critical',
        reason: 'Single point of airspace control. Loss = airspace closure with national-scale impact.' },
      { id: 'ils_04L',         name: 'ILS Glideslope 04L',               location: { lat: 55.62267, lon: 12.64620 }, asset_type: 'ils_ground_installation', criticality: 'high',
        reason: 'Instrument approach guidance for primary runway. Any interference triggers ILS re-certification.' },
      { id: 'ils_22R',         name: 'ILS Glideslope 22R',               location: { lat: 55.60800, lon: 12.63500 }, asset_type: 'ils_ground_installation', criticality: 'high',
        reason: 'Reciprocal approach guidance. Same sensitivity as 04L.' },
      { id: 'atis_broadcast',  name: 'ATIS broadcast antenna',           location: { lat: 55.61240, lon: 12.65810 }, asset_type: 'nav_broadcast', criticality: 'medium',
        reason: 'Continuous weather / operations broadcast. Loss forces manual radio queries.' },
      // Maintenance + hangars (3)
      { id: 'sas_hangar_141',  name: 'SAS Hangar 141 (maintenance)',     location: { lat: 55.61289, lon: 12.65980 }, asset_type: 'maintenance_facility', criticality: 'medium',
        reason: 'Deep maintenance of Nordic fleet. Fire risk and jet fuel storage.' },
      { id: 'hangar_2',        name: 'Hangar 2 (widebody)',              location: { lat: 55.61360, lon: 12.66130 }, asset_type: 'maintenance_facility', criticality: 'medium',
        reason: 'Widebody deep maintenance. Contains active aircraft during scheduled works.' },
      { id: 'hangar_3',        name: 'Hangar 3, N Maintenance',          location: { lat: 55.62946, lon: 12.65673 }, asset_type: 'maintenance_facility', criticality: 'medium',
        reason: 'North apron maintenance. Adjacent to N23/N24 perimeter sensor line.' },
      // Fuel + utility (3)
      { id: 'fuel_farm',       name: 'Fuel farm (Jet A-1 storage)',      location: { lat: 55.60400, lon: 12.65000 }, asset_type: 'fuel_storage', criticality: 'critical',
        reason: 'Bulk aviation fuel. Vulnerability to standoff attack; fire hazard cascades to airfield.' },
      { id: 'fuel_hydrant_c',  name: 'Central fuel hydrant network',     location: { lat: 55.61850, lon: 12.65450 }, asset_type: 'fuel_infrastructure', criticality: 'high',
        reason: 'Underground fuel distribution to all pier stands. Rupture cascades to airfield closure.' },
      { id: 'main_gpu_station', name: 'Main GPU (ground power) station', location: { lat: 55.61490, lon: 12.65540 }, asset_type: 'ground_power', criticality: 'medium',
        reason: 'Ground power supply. Loss strands parked aircraft, cascades to Tier 2 escalation.' },
      // Emergency + response (2)
      { id: 'fire_station_n',  name: 'Airport fire station North',       location: { lat: 55.62130, lon: 12.65900 }, asset_type: 'emergency_response', criticality: 'high',
        reason: 'Category 10 CFR (crash fire rescue). Attack on this station degrades emergency response for any incident.' },
      { id: 'fire_station_s',  name: 'Airport fire station South',       location: { lat: 55.60580, lon: 12.64150 }, asset_type: 'emergency_response', criticality: 'high',
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
        { name: 'Runway 04L threshold', center: { lat: 55.60400, lon: 12.63000 }, radius_m: 250, threshold_sec: 15 },
        { name: 'Runway 04R threshold', center: { lat: 55.60800, lon: 12.63500 }, radius_m: 250, threshold_sec: 15 },
        { name: 'ATC Tower Syd', center: { lat: 55.61180, lon: 12.65760 }, radius_m: 150, threshold_sec: 20 },
        { name: 'Fuel farm', center: { lat: 55.60400, lon: 12.65000 }, radius_m: 250, threshold_sec: 15 },
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
      { id: 'sw_yard_400kv', name: '400 kV switchyard', center: { lat: 55.6410, lon: 12.6088 }, criticality: 'critical',
        reason: 'Primary transmission node feeding CPH region. Fault at this bus cascades to city-scale outage.' },
      { id: 'sw_yard_132kv', name: '132 kV switchyard', center: { lat: 55.6408, lon: 12.6082 }, criticality: 'high',
        reason: 'Regional distribution feed. Loss affects Amager + parts of central København.' },
      { id: 'control_building', name: 'Control + relay building', center: { lat: 55.6412, lon: 12.6086 }, criticality: 'critical',
        reason: 'SCADA + protection relays. Loss = manual control only, national-grid coordination degraded.' },
    ],

    high_value_assets: [
      { id: 'auto_tx_1', name: 'Autotransformer 1 (400/132 kV)', location: { lat: 55.6409, lon: 12.6087 }, asset_type: 'autotransformer', criticality: 'critical',
        reason: 'Large oil-filled autotransformer. Replacement lead time 12-18 months.' },
      { id: 'auto_tx_2', name: 'Autotransformer 2 (400/132 kV)', location: { lat: 55.6411, lon: 12.6087 }, asset_type: 'autotransformer', criticality: 'critical',
        reason: 'Redundant unit. Loss of both = full regional interruption.' },
      { id: 'reactor_bank', name: 'Shunt reactor bank', location: { lat: 55.6407, lon: 12.6090 }, asset_type: 'reactor', criticality: 'high',
        reason: 'Voltage regulation. Loss degrades grid stability during light-load conditions.' },
    ],

    sensitive_setups: [
      { id: 'line_entry_n', name: 'North 400 kV line entry (from Bjæverskov)', note: 'Overhead entry gantry. Physical attack at this point severs the ring.' },
      { id: 'battery_room', name: 'DC battery + UPS room', note: 'Backup protection power. Loss disables trip circuits during grid disturbance.' },
    ],

    // Partner-declared narrative highlights per site (FIX-4 pattern).
    // Substation scope is tight — 3 entries covering the two switchyards
    // + control building. Everything else is either redundant or already
    // implied by these three.
    highlights: [
      { asset_id: 'sw_yard_400kv',    priority: 1, rationale: 'Primary 400 kV transmission node feeding CPH region. Fault at this bus cascades to city-scale outage.' },
      { asset_id: 'control_building', priority: 2, rationale: 'SCADA + protection relays. Loss forces manual control and degrades national-grid coordination.' },
      { asset_id: 'sw_yard_132kv',    priority: 3, rationale: 'Regional 132 kV distribution feed. Loss affects Amager + parts of central København.' },
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
      { id: 'sw_yard_400kv', name: '400 kV switchyard', center: { lat: 55.03682, lon: 9.26960 }, criticality: 'critical',
        reason: 'Largest 400 kV node in southern Jylland. Feeds cross-border interconnect.' },
      { id: 'hvdc_converter', name: 'HVDC converter station (to Germany)', center: { lat: 55.0371, lon: 9.2705 }, criticality: 'critical',
        reason: 'Cross-border HVDC to Kontek / German grid. Loss degrades Nordic-European power exchange.' },
      { id: 'reactive_comp_bay', name: 'Reactive compensation bay', center: { lat: 55.0366, lon: 9.2692 }, criticality: 'high',
        reason: 'Filter + SVC installation supporting HVDC valve operation.' },
    ],

    high_value_assets: [
      { id: 'hvdc_valve_hall', name: 'HVDC valve hall', location: { lat: 55.0371, lon: 9.2705 }, asset_type: 'hvdc_valve_hall', criticality: 'critical',
        reason: 'Contains thyristor / IGBT valves. Highly specialised replacement, multi-year lead time.' },
      { id: 'converter_transformer', name: 'HVDC converter transformer', location: { lat: 55.0370, lon: 9.2702 }, asset_type: 'converter_transformer', criticality: 'critical',
        reason: 'Custom-built transformer supporting HVDC valves. Fire risk from oil volume.' },
      { id: 'auto_tx_400', name: 'Autotransformer (400/220 kV)', location: { lat: 55.0369, lon: 9.2698 }, asset_type: 'autotransformer', criticality: 'critical',
        reason: 'Main step-down. Replacement lead time 12-18 months.' },
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
      { id: 'sw_yard_400kv', name: '400 kV switchyard', center: { lat: 55.45151, lon: 12.00729 }, criticality: 'critical',
        reason: 'Central Zealand transmission node feeding CPH region via Amager Koblingsstation.' },
      { id: 'control_building', name: 'Control + relay building', center: { lat: 55.4517, lon: 12.0075 }, criticality: 'critical',
        reason: 'SCADA + protection. Loss compromises regional coordination.' },
    ],

    high_value_assets: [
      { id: 'auto_tx_1', name: 'Autotransformer (400/132 kV)', location: { lat: 55.4515, lon: 12.0074 }, asset_type: 'autotransformer', criticality: 'critical',
        reason: 'Main step-down for regional distribution. Long lead time on replacement.' },
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
      { id: 'quay_deep',       name: 'Deepwater quays (4 + 5)', center: { lat: 55.467, lon: 8.450 }, criticality: 'high',
        reason: 'Heavy-lift quays for offshore wind installation vessels and diplomatic cargo.' },
      { id: 'ow_o_and_m',      name: 'Offshore wind O&M base', center: { lat: 55.469, lon: 8.446 }, criticality: 'high',
        reason: 'Servicing Horns Rev and North Sea assets. Base for Danish offshore wind fleet.' },
      { id: 'lng_terminal_planned', name: 'LNG terminal area (planned)', center: { lat: 55.465, lon: 8.454 }, criticality: 'medium',
        reason: 'Future LNG capacity supporting Baltic Pipe backup. Currently pre-construction.' },
    ],

    high_value_assets: [
      { id: 'ow_installation_vessel', name: 'Offshore wind installation vessel (typically berthed)', location: { lat: 55.468, lon: 8.449 }, asset_type: 'specialty_vessel', criticality: 'high',
        reason: 'Heavy-lift jack-up vessels. Multi-hundred-million EUR asset.' },
      { id: 'fuel_storage',        name: 'Fuel storage tanks',                        location: { lat: 55.464, lon: 8.453 }, asset_type: 'fuel_storage', criticality: 'high',
        reason: 'Marine fuel bulk storage. Fire hazard.' },
    ],

    // Partner-declared narrative highlights (FIX-4 per architecture review).
    // Port-side priorities lead with the highest-value physical assets
    // (installation vessel, deepwater quays) then the operational choke
    // points (pilot dock, LNG area). See CPH block above for schema notes.
    highlights: [
      { asset_id: 'ow_installation_vessel', priority: 1, rationale: 'Heavy-lift jack-up vessel typically berthed here. Multi-hundred-million EUR asset. Loss or damage cascades to Nordic offshore wind installation schedule.' },
      { asset_id: 'quay_deep',              priority: 2, rationale: 'Deepwater quays 4-5 handle offshore wind installation vessels and diplomatic cargo. Denial of service to these quays halts North Sea wind buildout.' },
      { asset_id: 'ow_o_and_m',             priority: 3, rationale: 'Servicing base for Horns Rev and North Sea offshore wind fleet. Base for Danish offshore O&M operations.' },
      { asset_id: 'fuel_storage',           priority: 4, rationale: 'Marine fuel bulk storage. Standoff attack creates fire hazard that cascades to full port evacuation.' },
      { asset_id: 'lng_terminal_planned',   priority: 5, rationale: 'Future LNG terminal supporting Baltic Pipe backup. Site is pre-construction but reconnaissance activity here has strategic-signalling weight.' },
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
    generated_by: 'ARP + runway orientation from Naviair AIP EKBI. Asset positions approximate — refine from OSM post-onboarding.',
    airport_reference_point: { lat: 55.740511, lon: 9.158056 },

    critical_areas: [
      { id: 'runway_09_27',           name: 'Runway 09/27 (3100m x 45m)', center: { lat: 55.74050, lon: 9.15800 }, criticality: 'critical', verified: 'high',
        reason: 'Single runway. Any obstruction closes the airport entirely — no parallel to fall back on.' },
      { id: 'terminal_passenger',     name: 'Passenger terminal (T1 + T2)', center: { lat: 55.73780, lon: 9.15450 }, criticality: 'high', verified: 'approximate',
        reason: '2 passenger terminals, 16 gates. Combined check-in + gates + baggage.' },
      { id: 'apron_cargo',            name: 'Cargo apron (CHBA hub)', center: { lat: 55.73780, lon: 9.16200 }, criticality: 'high', verified: 'approximate',
        reason: 'Denmark\'s largest air cargo hub (Cargo Handling Billund Airport). International freight throughput.' },
      { id: 'apron_ga',               name: 'GA / Business apron', center: { lat: 55.73780, lon: 9.16800 }, criticality: 'medium', verified: 'approximate',
        reason: 'General aviation + business terminal (Sun-Air of Scandinavia base). VIP + private aircraft.' },
    ],

    high_value_assets: [
      { id: 'atc_remote_tower',       name: 'Naviair Remote Tower Centre', location: { lat: 55.73900, lon: 9.15500 }, asset_type: 'atc_control_tower', criticality: 'critical', verified: 'approximate',
        reason: 'Naviair Remote Tower Centre — first RTC in DK, provides ATC services for BLL and (in future) other regional airports. Single point of airspace control failure.' },
      { id: 'ils_09',                 name: 'ILS Glideslope 09 (W approach)', location: { lat: 55.74050, lon: 9.13800 }, asset_type: 'ils_ground_installation', criticality: 'high', verified: 'approximate',
        reason: 'Instrument approach guidance for runway 09.' },
      { id: 'ils_27',                 name: 'ILS Glideslope 27 (E approach)', location: { lat: 55.74050, lon: 9.17200 }, asset_type: 'ils_ground_installation', criticality: 'high', verified: 'approximate',
        reason: 'Instrument approach guidance for runway 27.' },
      { id: 'fire_station_arff',      name: 'Airport fire station (ARFF)', location: { lat: 55.73900, lon: 9.15800 }, asset_type: 'emergency_response', criticality: 'high', verified: 'approximate',
        reason: 'ICAO-required aircraft rescue + firefighting. On-airfield location required for response time SLA.' },
      { id: 'cargo_chba',             name: 'CHBA cargo handling facility', location: { lat: 55.73800, lon: 9.16100 }, asset_type: 'maintenance_facility', criticality: 'high', verified: 'approximate',
        reason: 'Cargo Handling Billund Airport — largest DK air cargo operator. High-value goods throughput.' },
      { id: 'cargo_bws',              name: 'Blue Water Shipping airside office', location: { lat: 55.73800, lon: 9.16500 }, asset_type: 'maintenance_facility', criticality: 'medium', verified: 'approximate',
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
      { id: 'overwatch_atc',  name: 'Overwatch position, ATC Remote Tower', location: { lat: 55.73900, lon: 9.15500 }, asset_type: 'overwatch', criticality: 'high',
        reason: 'Elevated vantage point at RTC. Coordinated overwatch for critical response.' },
      { id: 'qra_relay',      name: 'QRA dispatch relay (to Flyvestation Karup)', location: { lat: 55.73900, lon: 9.15500 }, asset_type: 'qra_relay', criticality: 'critical',
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
        { name: 'Runway centre', center: { lat: 55.74050, lon: 9.15800 }, radius_m: 300, threshold_sec: 15 },
        { name: 'Cargo apron (CHBA)', center: { lat: 55.73780, lon: 9.16200 }, radius_m: 200, threshold_sec: 20 },
        { name: 'Naviair Remote Tower', center: { lat: 55.73900, lon: 9.15500 }, radius_m: 150, threshold_sec: 8 },
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
    schema_version: '1.0', generated_at: '2026-08-05T00:00:00Z', generated_by: 'Agent A (stub)',
    critical_areas: [{ id: 'sw_yard_400kv', name: '400 kV switchyard', center: { lat: 55.73231, lon: 12.23379 }, criticality: 'critical', reason: 'North Zealand transmission node.' }],
    high_value_assets: [{ id: 'auto_tx_1', name: 'Autotransformer (400/132 kV)', location: { lat: 55.73231, lon: 12.23379 }, asset_type: 'autotransformer', criticality: 'critical', reason: 'Main step-down.' }],
    sensitive_setups: [],
    normal_patterns: { operating_hours: '24/7 unmanned.', typical_ambient_activity: 'Inspection only.', civilian_drone_activity: 'None permitted.' },
    correlator_hints: { dwell_alarm_zones: [{ name: '400 kV switchyard', center: { lat: 55.73231, lon: 12.23379 }, radius_m: 180, threshold_sec: 10 }], unusual_pattern_flags: ['Any airborne contact within perimeter'] },
    response_capabilities: ['brs-standby', 'hjv-reinforce'],   // Grid TSO — see Amager for rationale
  },
  energinet_landerupgaard: {
    site_id: 'energinet_landerupgaard', name: 'Landerupgård Substation', site_type: 'hv_substation',
    schema_version: '1.0', generated_at: '2026-08-05T00:00:00Z', generated_by: 'Agent A (stub)',
    critical_areas: [{ id: 'sw_yard_400kv', name: '400 kV switchyard', center: { lat: 55.56398, lon: 9.54762 }, criticality: 'critical', reason: 'Southern Jylland transmission node.' }],
    high_value_assets: [{ id: 'auto_tx_1', name: 'Autotransformer (400/220 kV)', location: { lat: 55.56398, lon: 9.54762 }, asset_type: 'autotransformer', criticality: 'critical', reason: 'Main step-down.' }],
    sensitive_setups: [],
    normal_patterns: { operating_hours: '24/7 unmanned.', typical_ambient_activity: 'Inspection only.', civilian_drone_activity: 'None permitted.' },
    correlator_hints: { dwell_alarm_zones: [{ name: '400 kV switchyard', center: { lat: 55.56398, lon: 9.54762 }, radius_m: 180, threshold_sec: 10 }], unusual_pattern_flags: ['Any airborne contact within perimeter'] },
    response_capabilities: ['brs-standby', 'hjv-reinforce'],   // Grid TSO — see Amager for rationale
  },
  energinet_ferslev: {
    site_id: 'energinet_ferslev', name: 'Ferslev Substation', site_type: 'hv_substation',
    schema_version: '1.0', generated_at: '2026-08-05T00:00:00Z', generated_by: 'Agent A (stub)',
    critical_areas: [{ id: 'sw_yard_400kv', name: '400 kV switchyard', center: { lat: 56.95653, lon: 9.87912 }, criticality: 'critical', reason: 'North Jylland transmission node.' }],
    high_value_assets: [{ id: 'auto_tx_1', name: 'Autotransformer (400/150 kV)', location: { lat: 56.95653, lon: 9.87912 }, asset_type: 'autotransformer', criticality: 'critical', reason: 'Main step-down.' }],
    sensitive_setups: [],
    normal_patterns: { operating_hours: '24/7 unmanned.', typical_ambient_activity: 'Inspection only.', civilian_drone_activity: 'None permitted.' },
    correlator_hints: { dwell_alarm_zones: [{ name: '400 kV switchyard', center: { lat: 56.95653, lon: 9.87912 }, radius_m: 180, threshold_sec: 10 }], unusual_pattern_flags: ['Any airborne contact within perimeter'] },
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
