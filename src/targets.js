// Protected critical-infrastructure targets.
// Not sensor sites (no HaaS). These are assets the platform is aware of and
// can flag when a drone trajectory intersects their protection zone.
// ISR provides detection and alerting only. Response is the responsibility
// of Politi, Forsvaret, and other Danish authorities.

export const TARGETS = [
  // ═══════════════════ GOVERNMENT + ROYAL ═══════════════════
  { id: 'amalienborg',        name: 'Amalienborg',              subtitle: 'Royal Residence',                      kind: 'royal',      lat: 55.6842, lon: 12.5931 },
  { id: 'christiansborg',     name: 'Christiansborg',           subtitle: 'Danish Parliament (Folketinget)',      kind: 'government', lat: 55.6759, lon: 12.5798 },
  { id: 'statsministeriet',   name: 'Statsministeriet',         subtitle: "Prime Minister's Office",              kind: 'government', lat: 55.6767, lon: 12.5805 },
  { id: 'forsvarsmin',        name: 'Forsvarsministeriet',      subtitle: 'Ministry of Defence',                  kind: 'government', lat: 55.6773, lon: 12.5854 },

  // ═══════════════════ MILITARY ═══════════════════
  { id: 'kastellet',          name: 'Kastellet',                subtitle: 'Historic Fortress, Forsvaret installation', kind: 'military', lat: 55.6907, lon: 12.5934 },
  { id: 'skrydstrup',         name: 'Flyvestation Skrydstrup',  subtitle: 'F-35 QRA airbase',                     kind: 'military',   lat: 55.2210, lon: 9.2640  },
  { id: 'karup',              name: 'Flyvestation Karup',       subtitle: 'Air defence command, helicopter wing', kind: 'military',   lat: 56.2975, lon: 9.1247  },
  { id: 'aalborg-airbase',    name: 'Flyvestation Aalborg',     subtitle: 'Transport wing, tactical support',     kind: 'military',   lat: 57.0928, lon: 9.8492  },
  { id: 'frederikshavn-nav',  name: 'Frederikshavn Naval Base', subtitle: 'Søværnet main base',                   kind: 'military',   lat: 57.4419, lon: 10.5460 },
  { id: 'korsoer-nav',        name: 'Korsør Naval Base',        subtitle: 'Søværnet frigates',                    kind: 'military',   lat: 55.3363, lon: 11.1364 },

  // ═══════════════════ TRANSPORT ═══════════════════
  { id: 'cph-central',        name: 'Copenhagen Central Station', subtitle: 'National rail hub, DSB HQ',          kind: 'transport',  lat: 55.6727, lon: 12.5642 },
  { id: 'aarhus-central',     name: 'Aarhus Central Station',   subtitle: 'Jutland rail hub',                     kind: 'transport',  lat: 56.1497, lon: 10.2039 },
  { id: 'metro-control',      name: 'Metroselskabet Control',   subtitle: 'Copenhagen Metro operations centre',   kind: 'transport',  lat: 55.6572, lon: 12.5892 },
  { id: 'oresund-bridge-dk',  name: 'Øresund Bridge (DK anchor)', subtitle: 'Critical DK-SE road/rail link',      kind: 'transport',  lat: 55.5721, lon: 12.7960 },

  // (Energy grid substations are auto-imported from OSM in targets_hv.js.
  //  The 5 Energinet substations that host our sensor mesh live in sites.js.)

  // ═══════════════════ DATA CENTRES (hyperscale, national data critical infra) ═══════════════════
  { id: 'meta-odense',        name: 'Meta Data Centre',         subtitle: 'Odense hyperscale',                    kind: 'data-centre', lat: 55.4038, lon: 10.4033 },
  { id: 'google-fredericia',  name: 'Google Data Centre',       subtitle: 'Fredericia hyperscale',                kind: 'data-centre', lat: 55.5644, lon: 9.7522  },
  { id: 'apple-foulum',       name: 'Apple Data Centre',        subtitle: 'Foulum hyperscale (near Viborg)',      kind: 'data-centre', lat: 56.4967, lon: 9.5744  },

  // ═══════════════════ HEALTHCARE (largest hospitals) ═══════════════════
  { id: 'rigshospitalet',     name: 'Rigshospitalet',           subtitle: 'National tertiary hospital, Copenhagen', kind: 'healthcare', lat: 55.6949, lon: 12.5688 },
  { id: 'bispebjerg',         name: 'Bispebjerg Hospital',      subtitle: 'Copenhagen',                           kind: 'healthcare', lat: 55.7020, lon: 12.5478 },
  { id: 'ah-aarhus',          name: 'Aarhus Universitetshospital', subtitle: 'Largest Jutland hospital',          kind: 'healthcare', lat: 56.1928, lon: 10.1839 },
  { id: 'ouh',                name: 'Odense Universitetshospital', subtitle: 'Funen tertiary hospital',           kind: 'healthcare', lat: 55.3855, lon: 10.4048 },
  { id: 'ah-aalborg',         name: 'Aalborg Universitetshospital', subtitle: 'North Jutland tertiary hospital',  kind: 'healthcare', lat: 57.0325, lon: 9.9106  },

  // ═══════════════════ BROADCASTING + FINANCE ═══════════════════
  { id: 'dr-byen',            name: 'DR Byen',                  subtitle: 'Danish Broadcasting Corporation HQ',   kind: 'broadcasting', lat: 55.6602, lon: 12.5931 },
  { id: 'nationalbanken',     name: 'Nationalbanken',           subtitle: 'Danish Central Bank',                  kind: 'financial',  lat: 55.6779, lon: 12.5859 },

  // ═══════════════════ FOREIGN EMBASSIES (major) ═══════════════════
  { id: 'us-embassy',         name: 'US Embassy',               subtitle: 'Diplomatic mission, USA',              kind: 'embassy',    lat: 55.7013, lon: 12.5766 },
  { id: 'uk-embassy',         name: 'UK Embassy',               subtitle: 'Diplomatic mission, United Kingdom',   kind: 'embassy',    lat: 55.6851, lon: 12.5735 },
  { id: 'ru-embassy',         name: 'Russian Embassy',          subtitle: 'Diplomatic mission, Russia',           kind: 'embassy',    lat: 55.6900, lon: 12.5860 },
  { id: 'cn-embassy',         name: 'Chinese Embassy',          subtitle: "Diplomatic mission, People's Republic of China", kind: 'embassy', lat: 55.7154, lon: 12.5556 },
  { id: 'de-embassy',         name: 'German Embassy',           subtitle: 'Diplomatic mission, Germany',          kind: 'embassy',    lat: 55.6939, lon: 12.5859 },

  // ═══════════════════ STADIUMS + MASS GATHERING VENUES ═══════════════════
  { id: 'parken',             name: 'Parken Stadium',           subtitle: 'National football stadium, 38k capacity', kind: 'stadium',  lat: 55.7027, lon: 12.5723 },
  { id: 'royal-arena',        name: 'Royal Arena',              subtitle: 'Copenhagen indoor arena, Hannemanns Allé, 16k capacity', kind: 'stadium', lat: 55.6321, lon: 12.5793 },
  { id: 'mch-boxen',          name: 'Jyske Bank Boxen',         subtitle: 'Herning indoor arena, 15k capacity',    kind: 'stadium',    lat: 56.1300, lon: 8.9720  },
  { id: 'ceres-park',         name: 'Ceres Park',               subtitle: 'Aarhus stadium',                        kind: 'stadium',    lat: 56.1442, lon: 10.1913 },
  { id: 'nature-energy-park', name: 'Nature Energy Park',       subtitle: 'Odense stadium',                        kind: 'stadium',    lat: 55.4022, lon: 10.4083 },

  // ═══════════════════ AIRPORTS (civilian, beyond CPH which is a sensor site) ═══════════════════
  { id: 'billund-lufthavn',   name: 'Billund Lufthavn',         subtitle: '2nd busiest DK airport, cargo hub',     kind: 'transport',  lat: 55.7403, lon: 9.1517  },
  { id: 'aarhus-lufthavn',    name: 'Aarhus Lufthavn (Tirstrup)', subtitle: 'Jutland regional airport',            kind: 'transport',  lat: 56.3000, lon: 10.6191 },

  // ═══════════════════ MAJOR BRIDGES ═══════════════════
  { id: 'storebaelt',         name: 'Storebæltsbroen',          subtitle: 'Great Belt Bridge, national road/rail spine', kind: 'transport', lat: 55.3411, lon: 11.0350 },
  { id: 'lillebaelt-ny',      name: 'Ny Lillebæltsbro',         subtitle: 'New Little Belt Bridge, Funen to Jutland',    kind: 'transport', lat: 55.5528, lon: 9.7178  },

  // ═══════════════════ MAJOR PORTS (beyond Esbjerg which is a sensor site) ═══════════════════
  { id: 'kbh-havn',           name: 'Københavns Havn (Nordhavn)', subtitle: 'Copenhagen container port + cruise terminal', kind: 'transport', lat: 55.7115, lon: 12.6001 },
  { id: 'aarhus-havn',        name: 'Aarhus Havn',              subtitle: 'Largest container port in DK',          kind: 'transport',  lat: 56.1517, lon: 10.2400 },
  { id: 'fredericia-havn',    name: 'Fredericia Havn',          subtitle: 'Oil + chemical terminal',               kind: 'transport',  lat: 55.5622, lon: 9.7614  },
];
