// ═══════════════════════════════════════════════════════════════════
// Ground lift — making a template's altitude mean height above ground
// ───────────────────────────────────────────────────────────────────
// Every template's `alt` was written as height above the ground ("the
// quad flies at 60 m"). The map renders it as height above the WGS84
// ellipsoid, which sits 36 to 125 m BELOW Danish ground depending on
// the site. At CPH that cost 40 m and hid itself. Inland it put 22 of 52
// scenarios partly underground: substation quads and missiles, the whole
// of Billund, the Esbjerg surface drone under the harbour water.
//
// Measured, not estimated. __isr_altAudit (alt_audit.js) sampled the
// map's own terrain under every template on 2026-10-22. measuredGroundM
// is the terrain's ellipsoid height at each template's LOWEST point
// above ground. Adding it to the drawn height lifts that lowest point to
// exactly its authored height, and every other point to at least its own
// authored height relative to that, so nothing on the sampled path is
// drawn underground. liftM rounds that up to the next 5 m.
//
// One exception to the rounding: the Esbjerg surface drone is a boat,
// so it gets the measured value exactly. Rounding would float it.
//
// DRAWN HEIGHT ONLY. The waypoint `alt` is NOT changed, because the rest
// of the system already reads it as height above ground, correctly: the
// panel labels it "m AGL", recordings and the export write it as
// altitude_agl_m, the summary agent scores it against a substation
// baseline, interceptors climb to it, and the attack-profile advisory
// tests it against 500 m. A first version of this fix rewrote the
// waypoints and an independent review showed every one of those moving:
// a Billund quad at 60 m reading "175 m AGL", the Esbjerg advisory
// firing 10 s late. So the number stays true and only the picture moves.
// main.js adds groundLiftM(templateKey) where a live threat track is
// drawn, and nowhere else.
//
// COPENHAGEN AIRPORT IS DELIBERATELY ABSENT. Lucas, 2026-10-22: do not
// touch anything at CPH. Its scenarios were tuned by eye against the
// current drawing, and two of them are in the promo video. Absent means
// a lift of 0, so every CPH track is drawn exactly as before.
//
// NOT YET COVERED: replay and the analysis debrief draw recorded
// trajectories through their own code and do not add the lift, so a
// closed substation, Billund or Esbjerg event replays at the old height.

export const GROUND_LIFT_MEASURED_AT = '2026-10-22';

const L = (measuredGroundM, liftM) => ({ measuredGroundM, liftM });

export const GROUND_LIFT = {
  // Energinet substations
  energinet_landerupgaard_missile_hostile:            L(104, 105),
  energinet_landerupgaard_quad_hostile:               L(104, 105),
  energinet_landerupgaard_fixedwing_hostile:          L(104, 105),
  energinet_kassoe_missile_hostile:                   L(77, 80),
  energinet_kassoe_quad_hostile:                      L(77, 80),
  energinet_kassoe_fixedwing_hostile:                 L(77, 80),
  energinet_bjaeverskov_missile_hostile:              L(74, 75),
  energinet_bjaeverskov_quad_hostile:                 L(74, 75),
  energinet_bjaeverskov_fixedwing_hostile:            L(74, 75),
  energinet_ferslev_missile_hostile:                  L(69, 70),
  energinet_ferslev_quad_hostile:                     L(93, 95),
  energinet_ferslev_fixedwing_hostile:                L(116, 120),
  energinet_hovegaard_missile_hostile:                L(51, 55),
  energinet_hovegaard_quad_hostile:                   L(45, 45),
  energinet_hovegaard_fixedwing_hostile:              L(45, 45),
  energinet_amager_koblingsstation_missile_hostile:   L(42, 45),
  energinet_amager_koblingsstation_quad_hostile:      L(42, 45),
  energinet_amager_koblingsstation_fixedwing_hostile: L(42, 45),
  // Billund
  billund_missile_hostile:   L(107, 110),
  billund_commercial_survey: L(106, 110),
  billund_lego_recon:        L(102, 105),
  billund_quad_hostile:      L(113, 115),
  billund_swarm_recon:       L(110, 110),
  billund_fixedwing_hostile: L(125, 125),
  billund_geran2_north:      L(104, 105),
  billund_geran4_north:      L(104, 105),
  billund_geran5_north:      L(104, 105),
  // Esbjerg
  esbjerg_usv_hostile:       L(44, 44),   // a boat: exact, see header
  esbjerg_missile_hostile:   L(41, 45),
  esbjerg_quad_hostile:      L(41, 45),
  esbjerg_fixedwing_hostile: L(49, 50),
};

/** Metres to add to a track's drawn height. 0 for anything not in the
 *  table, which includes every Copenhagen airport template. */
export function groundLiftM(templateKey, table = GROUND_LIFT) {
  const e = templateKey ? table[templateKey] : null;
  return e && typeof e.liftM === 'number' ? e.liftM : 0;
}
