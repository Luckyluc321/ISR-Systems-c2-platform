// Real geographic coordinates for every Danish government installation
// that can dispatch a physical response asset to a critical
// infrastructure incident. Every entry verified against OpenStreetMap
// Nominatim + the agency's own website. No fabricated coordinates.
//
// receiver_assets.js imports nothing, so this direction creates no
// cycle. It is imported for baseForReceiverRole below, which reads the
// baseId each role declares beside its vehicles rather than relying on
// a hand-kept alias table that had already drifted twice.
import { RECEIVER_ASSETS } from './receiver_assets.js';
//
// Used by the receiver-side dispatch flow (main.js) to spawn asset
// billboards at the correct home base before animating them toward
// the incident site. Real distances feed real ETAs feed real
// operational credibility during customer conversations.
//
// Every entry: { lat, lon, name, verified }
//   lat, lon: WGS84 decimal degrees, ~5-20 m building precision
//   name:     full postal address of the primary HQ or entrance
//   verified: source citation (OSM Nominatim URL, agency website URL,
//             or a flag when a location is genuinely restricted)
//
// Coordinates good as of 2026-09-07 research pass. When an agency
// moves or adds a district, update this file and note the date.
//
// Keys stay ASCII-safe (used as internal identifiers). Name fields
// use full Danish letters (æ, ø, å) because they render in the UI.

export const RECEIVER_BASES = {

  // ── Danish National Police (Politi) ─────────────────────────

  'rigspolitiet': {
    lat: 55.670176, lon: 12.570270,
    name: 'Polititorvet 14, 1780 København V',
    verified: 'OSM Nominatim + politi.dk',
  },
  'politi-koebenhavn': {
    lat: 55.670176, lon: 12.570270,
    name: 'Polititorvet 14, 1780 København V (Politigården)',
    verified: 'da.wikipedia.org/wiki/Københavns_Politigård',
  },
  'politi-nordjylland': {
    lat: 57.042884, lon: 9.924607,
    name: 'Jyllandsgade 27, 9000 Aalborg',
    verified: 'politi.dk/nordjyllands-politi/aalborg-politigaard',
  },
  'politi-oestjylland': {
    lat: 56.152924, lon: 10.210838,
    name: 'Ridderstræde 1, 8000 Aarhus C',
    verified: 'politi.dk/oestjyllands-politi/aarhus-hovedpolitistation',
  },
  'politi-midtvestjylland': {
    lat: 56.370607, lon: 8.624585,
    name: 'Stationsvej 74, 7500 Holstebro',
    verified: 'politi.dk/midt-og-vestjyllands-politi',
  },
  'politi-sydoestjylland': {
    lat: 55.857055, lon: 9.847221,
    name: 'Holmboes Allé 2, 8700 Horsens',
    verified: 'politi.dk/sydoestjyllands-politi',
  },
  // Key was 'politi-sydsonderjylland' until 2026-09-22. The role is
  // 'politi-sydsonderjyl', so this verified base resolved for nobody.
  'politi-sydsonderjyl': {
    lat: 55.472712, lon: 8.450967,
    name: 'Kirkegade 76, 6700 Esbjerg (kredsens hovedstation)',
    verified: 'politi.dk/syd-og-soenderjyllands-politi/esbjerg-hovedpolitistation',
  },
  'politi-fyn': {
    lat: 55.398545, lon: 10.394595,
    name: 'Hans Mules Gade 1-3, 5000 Odense C',
    verified: 'politi.dk/politikredse/fyns-politi',
  },
  'politi-sydsjaelland': {
    lat: 55.214525, lon: 11.760414,
    name: 'Parkvej 50, 4700 Næstved',
    verified: 'politi.dk/sydsjaellands-og-lolland-falsters-politi',
  },
  'politi-midtvestsjaelland': {
    lat: 55.636992, lon: 12.077779,
    name: 'Skovbogade 3, 4000 Roskilde',
    verified: 'politi.dk/midt-og-vestsjaellands-politi',
  },
  'politi-nordsjaelland': {
    lat: 55.929506, lon: 12.305633,
    name: 'Østergade 1, 3400 Hillerød',
    verified: 'politi.dk/nordsjaellands-politi/station-midt',
  },
  'politi-koebenhavnsvestegn': {
    lat: 55.666970, lon: 12.348865,
    name: 'Birkelundsvej 2, 2620 Albertslund',
    verified: 'politi.dk/politikredse/koebenhavns-vestegns-politi',
  },
  'politi-bornholm': {
    lat: 55.095580, lon: 14.710570,
    name: 'Zahrtmannsvej 44, 3700 Rønne',
    verified: 'politi.dk/bornholms-politi',
  },

  // Police specialized units
  'aks-cta': {
    lat: 55.698497, lon: 12.418724,
    name: 'Ejby Industrivej ~125, 2600 Glostrup (approximate, exact building restricted)',
    verified: 'restricted, coordinate for Ejby Industrivej Rigspolitiet complex',
  },
  'pet-soeborg': {
    lat: 55.746064, lon: 12.493112,
    name: 'Klausdalsbrovej 1, 2860 Søborg',
    verified: 'pet.dk/pet/kontakt-pet',
  },
  'nc3-koebenhavn': {
    lat: 55.670176, lon: 12.570270,
    name: 'Polititorvet 14, 1780 København V (co-located with Rigspolitiet)',
    verified: 'politi.dk/rigspolitiet',
  },
  'livvagt-koebenhavn': {
    lat: 55.670176, lon: 12.570270,
    name: 'Polititorvet 14, 1780 København V (co-located with Rigspolitiet)',
    verified: 'politi.dk/rigspolitiet',
  },

  // ── Danish Air Force (Flyvevåbnet) ───────────────────────────

  'flyvestation-skrydstrup': {
    lat: 55.22540, lon: 9.25946,
    name: 'Flyvestation Skrydstrup (F-35 base), Vojens',
    verified: 'en.wikipedia.org/wiki/Skrydstrup_Air_Base + OSM',
  },
  'flyvestation-karup': {
    lat: 56.30810, lon: 9.09541,
    name: 'Flyvestation Karup (Helicopter Wing, Air Control Wing, joint command)',
    verified: 'en.wikipedia.org/wiki/Karup_Air_Base + OSM',
  },

  // ── Danish Army (Hæren) ──────────────────────────────────────

  'slagelse-gardehusar': {
    lat: 55.38028, lon: 11.37914,
    name: 'Antvorskov Kaserne (Gardehusarregimentet), Slagelse',
    verified: 'OSM Nominatim + forsvaret.dk',
  },
  'hovelte-livgarden': {
    lat: 55.85489, lon: 12.39787,
    name: 'Høvelte Kaserne (Den Kongelige Livgarde)',
    verified: 'OSM Nominatim + forsvaret.dk',
  },
  'varde-efterretning': {
    lat: 55.60762, lon: 8.46988,
    name: 'Varde Kaserne (Efterretningsregimentet)',
    verified: 'OSM Nominatim + forsvaret.dk',
  },
  'bornholm-almegaard': {
    lat: 55.12169, lon: 14.71973,
    name: 'Almegårds Kaserne (Bornholms Værn), Rønne',
    verified: 'OSM Nominatim + forsvaret.dk',
  },
  'oksbol-kampskole': {
    lat: 55.62070, lon: 8.23745,
    name: 'Oksbøl Kaserne (Hærens Kampskole)',
    verified: 'OSM Nominatim + forsvaret.dk',
  },

  // ── Danish Navy (Søværnet) ───────────────────────────────────

  'frederikshavn-nav': {
    lat: 57.43194, lon: 10.53996,
    name: 'Flådestation Frederikshavn',
    verified: 'OSM Nominatim + forsvaret.dk',
  },
  'korsor-nav': {
    lat: 55.33155, lon: 11.13230,
    name: 'Flådestation Korsør',
    verified: 'OSM Nominatim + forsvaret.dk',
  },

  // ── Special Operations (Specialoperationskommandoen) ─────────

  'jaegerkorpset-aalborg': {
    lat: 57.09445, lon: 9.85549,
    name: 'Jægerkorpset, Flyvestation Aalborg (exact building restricted)',
    verified: 'en.wikipedia.org/wiki/Aalborg_Air_Base + OSM (airbase gate)',
  },
  'fromandskorpset-kongsore': {
    lat: 55.82501, lon: 11.73297,
    name: 'Frømandskorpset, Marinestation Kongsøre, Odsherred',
    verified: 'OSM Nominatim + da.wikipedia.org/wiki/Marinestation_Kongsøre',
  },

  // ── Defence Command + Intelligence ───────────────────────────

  'fko-karup': {
    lat: 56.30810, lon: 9.09541,
    name: 'Forsvarskommandoen, Flyvestation Karup (co-located)',
    verified: 'OSM Nominatim + forsvaret.dk',
  },
  'fe-kastellet': {
    lat: 55.69138, lon: 12.59374,
    name: 'Forsvarets Efterretningstjeneste, Kastellet, København',
    verified: 'en.wikipedia.org/wiki/Kastellet,_Copenhagen + OSM',
  },

  // ── Beredskabsstyrelsen (Emergency Management Agency) ────────

  'brs-hq-birkerod': {
    lat: 55.835345, lon: 12.411320,
    name: 'Beredskabsstyrelsen HQ, Datavej 16, 3460 Birkerød',
    verified: 'brs.dk/da/om-os/organisation/hovedkvarter',
  },
  'brs-nordjylland-thisted': {
    lat: 56.948541, lon: 8.663374,
    name: 'Beredskabsstyrelsen Nordjylland, Simons Bakke 25, 7700 Thisted',
    verified: 'brs.dk',
  },
  'brs-midtjylland-herning': {
    lat: 56.144466, lon: 8.946683,
    name: 'Beredskabsstyrelsen Midtjylland, H.P. Hansens Vej 100, 7400 Herning',
    verified: 'brs.dk',
  },
  'brs-sydjylland-haderslev': {
    lat: 55.230273, lon: 9.494796,
    name: 'Beredskabsstyrelsen Sydjylland, Vilstrupvej 55, 6100 Haderslev',
    verified: 'brs.dk',
  },
  'brs-sjaelland-naestved': {
    lat: 55.222463, lon: 11.770811,
    name: 'Beredskabsstyrelsen Sjælland, Bag Bakkerne 26, 4700 Næstved',
    verified: 'brs.dk',
  },
  'brs-bornholm-allinge': {
    lat: 55.270470, lon: 14.799458,
    name: 'Beredskabsstyrelsen Bornholm, Rønnevej 1, 3770 Allinge',
    verified: 'brs.dk',
  },
  'brs-hovedstaden-hedehusene': {
    lat: 55.649054, lon: 12.185789,
    name: 'Beredskabsstyrelsen Hovedstaden, Hedelykken 10, 2640 Hedehusene',
    verified: 'brs.dk',
  },

  // ── Hjemmeværnet (Home Guard) ────────────────────────────────

  'hjv-hq-vordingborg': {
    lat: 55.018415, lon: 11.906432,
    name: 'Hjemmeværnskommandoen, Vordingborg Kaserne, Sankelmarksvej 26, 4760 Vordingborg',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-lrgnv-skive': {
    lat: 56.535668, lon: 9.041929,
    name: 'Landsdelsregion Vest, Skive Kaserne',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-lrgne-koebenhavn': {
    lat: 55.717537, lon: 12.573152,
    name: 'Landsdelsregion Øst, Svanemøllens Kaserne, 2100 København Ø',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-nordjylland': {
    lat: 57.086933, lon: 9.957035,
    name: 'Hjemmeværnsdistrikt Nordjylland, 9400 Nørresundby',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-midtvestjylland': {
    lat: 56.535668, lon: 9.041929,
    name: 'Hjemmeværnsdistrikt Midt- og Vestjylland, Skive Kaserne',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-ostjylland': {
    lat: 56.167196, lon: 10.121558,
    name: 'Hjemmeværnsdistrikt Østjylland, Holmstrupgårdvej 22, 8220 Brabrand',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-sydostjylland': {
    lat: 55.724715, lon: 9.571498,
    name: 'Hjemmeværnsdistrikt Sydøstjylland, Niels Finsensvej 4, 7100 Vejle',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-sydsoenderjylland': {
    lat: 54.940888, lon: 9.451111,
    name: 'Hjemmeværnsdistrikt Syd- og Sønderjylland, Søgård Hovvej 1, 6200 Aabenraa',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-fyn': {
    lat: 55.398292, lon: 10.318528,
    name: 'Hjemmeværnsdistrikt Fyn, Vibelundvej 70, 5200 Odense V',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-sydsjaelland': {
    lat: 55.018415, lon: 11.906432,
    name: 'Hjemmeværnsdistrikt Sydsjælland og Lolland-Falster, Vordingborg Kaserne',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-midtvestsjalland': {
    lat: 55.584041, lon: 12.112574,
    name: 'Hjemmeværnsdistrikt Midt- og Vestsjælland, Flyvestation Skalstrup, 4621 Gadstrup',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-nordsjalland': {
    lat: 55.967339, lon: 12.391973,
    name: 'Hjemmeværnsdistrikt Nordsjælland, Kratbjerg 340, 3480 Fredensborg',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-vestegn': {
    lat: 55.754220, lon: 12.342214,
    name: 'Hjemmeværnsdistrikt Københavns Vestegn, Jonstruplejren, 2750 Ballerup',
    verified: 'hjemmevaernet.dk',
  },
  'hjv-hd-bornholm': {
    lat: 55.121787, lon: 14.717345,
    name: 'Det Bornholmske Hjemmeværn, Almegårds Kaserne, 3700 Rønne',
    verified: 'hjemmevaernet.dk',
  },

  // ── Regulatory Agencies ──────────────────────────────────────

  'trafikstyrelsen-cph': {
    lat: 55.663242, lon: 12.558689,
    name: 'Trafikstyrelsen, Carsten Niebuhrs Gade 43, 1577 København V',
    verified: 'trafikstyrelsen.dk',
  },
  'soefartsstyrelsen-korsor': {
    lat: 55.329672, lon: 11.140572,
    name: 'Søfartsstyrelsen, Caspar Brands Plads 9, 4220 Korsør',
    verified: 'soefartsstyrelsen.dk',
  },
  'cfcs-kastellet': {
    lat: 55.690466, lon: 12.594068,
    name: 'Center for Cybersikkerhed, Kastellet 30, 2100 København Ø',
    verified: 'cfcs.dk (co-located with Forsvarets Efterretningstjeneste at Kastellet)',
  },

  // ── 5 Danish Regions (medical response coordination) ─────────

  'region-hovedstaden-hillerod': {
    lat: 55.931741, lon: 12.349049,
    name: 'Region Hovedstaden, Kongens Vænge 2, 3400 Hillerød',
    verified: 'regionh.dk',
  },
  'region-sjaelland-soro': {
    lat: 55.438033, lon: 11.559259,
    name: 'Region Sjælland, Alléen 15, 4180 Sorø',
    verified: 'regionsjaelland.dk',
  },
  'region-syddanmark-vejle': {
    lat: 55.704788, lon: 9.524795,
    name: 'Region Syddanmark, Damhaven 12, 7100 Vejle',
    verified: 'regionsyddanmark.dk',
  },
  'region-nordjylland-aalborg': {
    lat: 57.017297, lon: 9.985707,
    name: 'Region Nordjylland, Niels Bohrs Vej 30, 9220 Aalborg Øst',
    verified: 'rn.dk',
  },
  'region-midtjylland-viborg': {
    lat: 56.453537, lon: 9.401334,
    name: 'Region Midtjylland, Skottenborg 26, 8800 Viborg',
    verified: 'rm.dk',
  },

  // ── Medical + rescue (impact / mass-casualty response) ────────
  // Coordinates verified 2026-09-17 via OSM Nominatim (agent pass,
  // cross-checked against agency websites for the non-hospital sites).

  'hospital-rigshospitalet': {
    lat: 55.695976, lon: 12.566650,
    name: 'Rigshospitalet, Blegdamsvej 9, 2100 København Ø',
    verified: 'OSM Nominatim (address point Blegdamsvej 9)',
  },
  'hospital-herlev': {
    lat: 55.731165, lon: 12.442664,
    name: 'Herlev Hospital, Borgmester Ib Juuls Vej 1, 2730 Herlev',
    verified: 'OSM Nominatim',
  },
  'hospital-hvidovre': {
    lat: 55.648669, lon: 12.470252,
    name: 'Hvidovre Hospital, Kettegård Allé 30, 2650 Hvidovre',
    verified: 'OSM Nominatim (address point Kettegård Allé 30)',
  },
  'hospital-bispebjerg': {
    lat: 55.714557, lon: 12.540180,
    name: 'Bispebjerg Hospital, Bispebjerg Bakke 23, 2400 København NV',
    verified: 'OSM Nominatim',
  },
  'akutberedskabet-ballerup': {
    lat: 55.730301, lon: 12.343056,
    name: 'Region Hovedstadens Akutberedskab, Telegrafvej 5, 2750 Ballerup',
    verified: 'OSM Nominatim + proff.dk registry',
  },
  'brs-hedehusene': {
    lat: 55.649054, lon: 12.185789,
    name: 'Beredskabsstyrelsen Hovedstaden, Hedelykken 10, 2640 Hedehusene',
    verified: 'OSM Nominatim + brs.dk (address point Hedelykken 10)',
  },
  // ── Acute hospitals outside the capital ──────────────────────
  // Added 2026-09-22. Each coordinate is an OSM house node with a
  // matching house number, road and postcode, cross-checked against the
  // hospital's own published akutmodtagelse address. None fell back to
  // a street centroid.
  //
  // These are plot address points, not ambulance-bay doors. On a large
  // campus the emergency entrance can sit 50 to 250 metres away, which
  // is fine for road routing and is not door-level precision.
  'hospital-suh-koege': {
    lat: 55.477321, lon: 12.165950,
    name: 'Sjællands Universitetshospital Køge, Akutafdelingen, Lykkebækvej 1, 4600 Køge',
    verified: 'sjaellandsuniversitetshospital.dk akutafdeling kontakt + OSM house node',
  },
  'hospital-kolding-sygehus': {
    lat: 55.501749, lon: 9.484188,
    // Akutafdelingen has its own entrance, indgang 26. No separate
    // coordinate is published for it, so this is the campus address.
    name: 'Kolding Sygehus, Akutafdelingen (indgang 26), Sygehusvej 24, 6000 Kolding',
    verified: 'sygehuslillebaelt.dk akutafdeling find-vej + OSM house node',
  },
  'hospital-esbjerg-sygehus': {
    lat: 55.473859, lon: 8.456703,
    // Renamed. 'Sydvestjysk Sygehus' became Esbjerg Sygehus, part of
    // Esbjerg og Grindsted Sygehus, in October 2022;
    // sydvestjysksygehus.dk now redirects. The Faelles Akutmodtagelse
    // covers both the Esbjerg and Grindsted sites; this is Esbjerg.
    name: 'Esbjerg Sygehus, Fælles Akutmodtagelse, Finsensgade 35, 6700 Esbjerg',
    verified: 'esbjerggrindstedsygehus.dk FAM kontakt + OSM house node',
  },
  'hospital-aabenraa-sygehus': {
    lat: 55.061763, lon: 9.378778,
    name: 'Sygehus Sønderjylland Aabenraa, Fælles Akut Modtagelse, Kresten Philipsens Vej 15, 6200 Aabenraa',
    verified: 'sygehussonderjylland.dk FAM kontakt + OSM house node',
  },
  'hospital-auh-aalborg': {
    lat: 57.008624, lon: 9.996871,
    // RELOCATED 22 March 2026. The akutmodtagelse moved from Aalborg UH
    // Syd (Hobrovej 18-22) to Akuthuset in Hospitalsbyen and Hobrovej's
    // emergency department closed. Routing to Hobrovej would send
    // ambulances to a department that is no longer there.
    //
    // Selma Lagerloefs Vej 347 is the Akuthuset address the hospital
    // publishes for patients going to the akutmodtagelse, not the
    // general postal address (Hospitalsbyen 1), which is ~200 m away.
    name: 'Aalborg Universitetshospital, Akuthuset indgang 1, Selma Lagerløfs Vej 347, 9260 Gistrup',
    verified: 'aalborguh.rn.dk/akuthuset + flytteplan + OSM house node',
  },

  // ── Municipal fire services outside the capital ──────────────
  // Added 2026-09-22. Every coordinate is an OpenStreetMap house node
  // with a matching house number, not a street centroid, independently
  // confirmed against DAWA (api.dataforsyningen.dk), the authoritative
  // Danish address register. Agreement to six decimals in every case.
  // These are registered access points for the plot, not apparatus-bay
  // doors, which is the right precision for road routing.
  'svjb-esbjerg': {
    lat: 55.485604, lon: 8.464906,
    name: 'Sydvestjysk Brandvæsen, Station Esbjerg, Vibevej 18, 6705 Esbjerg Ø',
    verified: 'svjb.dk/operativ/stationer + OSM node 3037439323 + DAWA',
  },
  'brsj-aabenraa': {
    lat: 55.031194, lon: 9.413771,
    // Brand & Redning Sønderjylland publishes Kallemosen 18 as its own
    // address and it is described as their largest station with the
    // central workshop. An operational station record lists Pilemosen
    // 21, roughly 47 metres away on the adjacent frontage, which reads
    // as the same site with two address faces. Which one holds the
    // apparatus bays could not be verified: BRSJ does not publish
    // per-station addresses. The organisation's own published address
    // wins.
    name: 'Brand & Redning Sønderjylland, Kallemosen 18, 6200 Aabenraa',
    verified: 'brsj.dk/kontakt-os + OSM node 8171511817 + DAWA',
  },
  'nobr-aalborg': {
    lat: 57.042911, lon: 9.928891,
    // Administration and the operational main station share this
    // building, and it is the organisation's only around-the-clock
    // crewed station. Deliberately NOT the vagtcentral at Hjulmagervej
    // 20, which is a shared dispatch control room rather than a fire
    // station and which company registries sometimes mislabel as the
    // headquarters.
    name: 'Nordjyllands Beredskab, Aalborg Brandstation, Thomas Boss Gade 6, 9000 Aalborg',
    verified: 'nordjyllandsberedskab.dk/om-os/kontakt + OSM node 343065789 + DAWA',
  },
  'hbr-hovedbrandstationen': {
    lat: 55.674664, lon: 12.571536,
    name: 'Hovedbrandstationen, Bag Rådhuset 3, 1550 København V',
    verified: 'OSM Nominatim fire_station polygon (way 148223100) + hbr.dk/kontakt',
  },
};

// Convenience lookup by receiver role id. Some roles map to a specific
// base id; others (a national body without a physical dispatch base)
// return null. Callers that need a base but get null fall back to the
// nearest sensible default (usually the incident site itself, which
// spawns the asset "on arrival" without a route animation).
export function baseForReceiverRole(roleId) {
  if (!roleId) return null;

  // 1. The asset registry already declares where each role's vehicles
  //    live. Read it first: it is the authoritative statement, kept
  //    next to the vehicles themselves, and it cannot drift from them.
  //
  //    This used to be step three, behind a hand-kept alias map, and
  //    that ordering caused two shipped bugs. The map duplicated three
  //    mappings the asset registry already had and forgot two others,
  //    and the two it forgot were the ambulance service and the fire
  //    brigade. Both returned null, so their vehicles took the "no home
  //    base" path: materialising on top of the incident having driven
  //    nothing, while the interface promised road routing, and carrying
  //    no owner so they vanished from the report's contributor list.
  //    A later per-site alert resolver made the identical mistake
  //    independently and would have dropped both agencies from every
  //    detonation alert.
  const declared = RECEIVER_ASSETS?.[roleId]?.baseId;
  if (declared && RECEIVER_BASES[declared]) return RECEIVER_BASES[declared];

  // 2. Role id used directly as the base key. The common case.
  if (RECEIVER_BASES[roleId]) return RECEIVER_BASES[roleId];

  // 3. Aliases for roles that own a base but declare no vehicles, so
  //    have no asset entry to read a baseId from. Do NOT add a mapping
  //    here for a role that has vehicles: declare baseId on its asset
  //    entry instead, where step 1 will find it and where it sits
  //    beside the thing it describes.
  const alias = {
    'pet': 'pet-soeborg',
    'fe': 'fe-kastellet',
    // Retained as a safety net. All three also declare baseId on their
    // asset entry, so step 1 resolves them first.
    'rigspoliti': 'rigspolitiet',
    'politi-kbh': 'politi-koebenhavn',
    'politi-aks': 'aks-cta',
  };
  return alias[roleId] ? RECEIVER_BASES[alias[roleId]] : null;
}
