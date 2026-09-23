// ═══════════════════════════════════════════════════════════════════
// Consequence routing — which agencies respond to a scene, per site
// ───────────────────────────────────────────────────────────────────
// Who gets alerted when something detonates or comes down at a site:
// medical coordination, the receiving acute hospital, the municipal
// fire service and the state rescue reinforcement.
//
// Pure data plus one lookup. No imports, no Cesium, nothing Vite-only,
// so it loads under plain Node and scripts/check-impact-cascade.mjs
// verifies every id in it against the real destination and role tables.
//
// WHY THIS EXISTS. The terminal-impact cascade alerted a fixed list of
// six Copenhagen organisations for every site. A detonation at Billund
// Airport summoned Rigshospitalet, Hovedstadens Beredskab and
// Beredskabsstyrelsen Hedehusene, all of them a country away, while the
// services that actually cover Billund were never told. The list was
// correct only because every site that could detonate happened to be in
// the capital region.
//
// EVERY ROLE NAMED HERE ALREADY EXISTED. roles.js carries all five
// regional medical coordination centres, 23 acute hospitals, 29
// municipal fire services and seven Beredskabsstyrelsen centres. What
// was missing was a destination for them and a link from the role, so
// they were unreachable rather than absent. Nothing here invents a
// Danish organisation.
//
// IDS ARE SELF-REFERENTIAL: the destination id equals the role id, and
// the role holds its own id in destinationIds. That is the established
// shape for consequence agencies and it is load-bearing here. Amager
// Koblingsstation's site code is AMK, so its site-scoped destinations
// are amk-t2-politi and friends. A capability check that matched on an
// "amk-" prefix would count a police destination as an ambulance
// service. The gate checks the named fields below instead of prefixes,
// so that trap is closed rather than avoided by luck.
// ═══════════════════════════════════════════════════════════════════

// Region to its Akutmedicinsk Koordinationscenter. Every site manifest
// already declares its region as a casualty-scenario observer, so this
// mapping introduces no new geography.
//
// NOTE that this region mapping is correct for MEDICAL COORDINATION and
// wrong as a general pattern. Beredskabsstyrelsen's rescue centres do
// NOT follow region boundaries: their districts were drawn as drive-time
// isochrones, the stated design priority was response time over
// administrative tidiness, and three kommuner are split between two
// centres with at least one boundary following a road rather than a
// kommune line. Rescue is therefore declared per site below, never
// derived from the region.
//
// Dispatch is also fixed-district rather than nearest-available: the
// requesting authority calls the centre whose area the incident falls
// in. Larger incidents stack additional centres on top rather than
// reassigning, which is why a site declares one centre and not a list.
export const REGION_TO_MEDICAL_COORDINATION = {
  'region-hst': 'amk-hovedstaden',
  'region-sjl': 'amk-sjaelland',
  'region-syd': 'amk-syddanmark',
  'region-midt': 'amk-midtjylland',
  'region-nord': 'amk-nordjylland',
};

// Per site. Kommune for every entry was resolved by point-in-polygon
// against the official Danish municipal boundaries (DAGI, via
// Dataforsyningen), not by name matching. The municipal fire service is
// then the kbr-* role whose member_kommuner contains that kommune, which
// is data already in roles.js.
//
// `hospitals` is ordered: the first entry is the receiving acute
// hospital. Later entries are additional capacity for a mass-casualty
// event, not alternatives.
export const CONSEQUENCE_BY_SITE = {
  cph: {
    region: 'region-hst',
    // Tårnby kommune. Tårnby Brandvæsen covers the airport landside.
    // Airside first response is the airport's own Lufthavnsbrandvæsen,
    // which has no role in roles.js and is therefore not alerted here.
    fire: 'kbr-taarnby',
    // Hvidovre is the catchment akutmodtagelse. Rigshospitalet is
    // geometrically nearer but is Region Hovedstaden's trauma centre
    // rather than a walk-in acute department, so it is listed as
    // escalation, not as the primary receiving hospital.
    hospitals: ['hospital-hvidovre', 'hospital-rigshospitalet', 'hospital-bispebjerg'],
    rescue: 'brs-hedehusene',
  },
  energinet_amager_koblingsstation: {
    region: 'region-hst',
    fire: 'kbr-hovedstaden',   // København kommune
    hospitals: ['hospital-hvidovre', 'hospital-rigshospitalet', 'hospital-bispebjerg'],
    rescue: 'brs-hedehusene',
  },
  energinet_hovegaard: {
    region: 'region-hst',
    fire: 'kbr-frederiksborg',   // Egedal kommune
    // Herlev is the nearest akutmodtagelse. Nordsjællands Hospital in
    // Hillerød is the regional hospital for this beredskab area but is
    // roughly twice as far.
    hospitals: ['hospital-herlev'],
    rescue: 'brs-hedehusene',
  },
  energinet_bjaeverskov: {
    region: 'region-sjl',
    fire: 'kbr-koege',   // Køge kommune
    hospitals: ['hospital-suh-koege'],
    // Beredskabsstyrelsen Sjælland (Næstved), changed from Hedehusene
    // on 2026-09-23. RECORDED AS AN INFERENCE, NOT A CITED FACT.
    //
    // Beredskabsstyrelsen does not publish its coverage areas at kommune
    // level: no map, no kommune list, no per-postnummer assignment
    // exists on brs.dk, and Køge's own risk dimensioning names no
    // centre. So this cannot be sourced the way the police districts
    // were.
    //
    // What supports Næstved: Hedehusene's published mandate is Region
    // Hovedstaden specifically, while Næstved is described only as "one
    // of the operative departments on Zealand". Køge is Region
    // Sjælland. And the two are not equivalent units. Næstved runs a
    // 24/7 conscript watch with a five-minute turnout; Hedehusene is a
    // volunteer centre with no conscripts and a two-person watch, so it
    // cannot deliver the same reinforcement.
    //
    // Confirm with Beredskabsstyrelsen directly before treating this as
    // settled.
    rescue: 'brs-naestved',
  },
  billund: {
    region: 'region-syd',
    fire: 'kbr-trekantbrand',   // Billund kommune
    // Kolding, not the nearer Vejle. Vejle's emergency function runs
    // 07-22; the 24-hour Fælles Akutmodtagelse for Sygehus Lillebælt is
    // at Kolding, so Vejle is not a valid destination for a night event.
    hospitals: ['hospital-kolding-sygehus'],
    rescue: 'brs-haderslev',
  },
  energinet_landerupgaard: {
    region: 'region-syd',
    // Kolding kommune. The site manifest describes this site as
    // Fredericia; the coordinates fall in Kolding. Both are TrekantBrand
    // members so the fire service is the same either way.
    fire: 'kbr-trekantbrand',
    hospitals: ['hospital-kolding-sygehus'],
    rescue: 'brs-haderslev',
  },
  esbjerg: {
    region: 'region-syd',
    fire: 'kbr-sydvestjysk',   // Esbjerg kommune
    hospitals: ['hospital-esbjerg-sygehus'],
    rescue: 'brs-haderslev',
  },
  energinet_kassoe: {
    region: 'region-syd',
    fire: 'kbr-brsj',   // Aabenraa kommune
    hospitals: ['hospital-aabenraa-sygehus'],
    rescue: 'brs-haderslev',
  },
  energinet_ferslev: {
    region: 'region-nord',
    fire: 'kbr-nordjyllands',   // Aalborg kommune
    hospitals: ['hospital-auh-aalborg'],
    rescue: 'brs-thisted',
  },
};

// The agencies to alert for a scene at this site, as destination ids.
//
// Returns an EMPTY array for a site with no entry. It deliberately does
// not fall back to a default set: falling back to Copenhagen is the bug
// this module exists to remove, and a silent wrong answer is worse than
// a visible empty one. The build gate fails if a site that can detonate
// has no entry here, so an empty result cannot reach production
// unnoticed.
export function consequenceAgenciesForSite(siteId) {
  const site = CONSEQUENCE_BY_SITE[siteId];
  if (!site) return [];
  const medical = REGION_TO_MEDICAL_COORDINATION[site.region];
  return [
    ...(medical ? [medical] : []),
    ...(site.hospitals || []),
    ...(site.fire ? [site.fire] : []),
    ...(site.rescue ? [site.rescue] : []),
  ];
}

// Every consequence agency referenced anywhere in the table. Used by the
// build gate to check that each one has a destination and an owning
// role, and by anything that needs to declare the full set up front.
export function allConsequenceAgencyIds() {
  const out = new Set();
  for (const siteId of Object.keys(CONSEQUENCE_BY_SITE)) {
    for (const id of consequenceAgenciesForSite(siteId)) out.add(id);
  }
  return Array.from(out).sort();
}

// Sites this module can route a consequence response for.
export function sitesWithConsequenceRouting() {
  return Object.keys(CONSEQUENCE_BY_SITE).sort();
}
