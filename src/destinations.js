// Escalation destination catalog (mock)
// Real product: this comes from customer's Config module + server API.
// Each destination represents someone who receives escalations.
//
// Tiers:
//   1 = Internal site personnel + integrated systems (immediate)
//   2 = Local law enforcement + operational coordination (5 to 15 min response)
//   3 = National authorities (coordinated national response)
//   4 = Military response (real airborne or maritime threat)
//   5 = NATO / international (cross border or high-severity)

const DESTINATIONS = [
  // ═══════════════════════════════════════════════════════════
  // CPH AIRPORT
  // ═══════════════════════════════════════════════════════════

  // Tier 1, site personnel
  { id: 'cph-t1-sec-ops', siteId: 'cph', tier: 1, type: 'internal',
    name: 'Copenhagen Airport Security Operations Centre',
    contactMethods: ['in-app', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'cph-t1-duty-mgr', siteId: 'cph', tier: 1, type: 'internal',
    name: 'Copenhagen Airport Duty Manager',
    contactMethods: ['phone', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'cph-t1-fire', siteId: 'cph', tier: 1, type: 'internal',
    name: 'Copenhagen Airport Fire and Rescue Service',
    contactMethods: ['phone', 'in-app'], availabilityStatus: 'on-shift' },
  { id: 'cph-t1-atc', siteId: 'cph', tier: 1, type: 'internal',
    name: 'Copenhagen Air Traffic Control Tower',
    contactMethods: ['phone', 'api'], availabilityStatus: 'on-shift' },
  { id: 'cph-t1-ground', siteId: 'cph', tier: 1, type: 'internal',
    name: 'Copenhagen Airport Ground Operations',
    contactMethods: ['in-app', 'phone'], availabilityStatus: 'on-shift' },
  // Tier 1, integrated systems
  { id: 'cph-sys-genetec', siteId: 'cph', tier: 1, type: 'system',
    name: 'Copenhagen Airport Camera Surveillance System',
    contactMethods: ['webhook'], availabilityStatus: 'on-shift' },
  { id: 'cph-sys-scada', siteId: 'cph', tier: 1, type: 'system',
    name: 'Copenhagen Airport Operations Data Broker',
    contactMethods: ['mqtt'], availabilityStatus: 'on-shift' },

  // Tier 2, local law enforcement + aviation coordination
  { id: 'cph-t2-politi', siteId: 'cph', tier: 2, type: 'agency',
    name: 'Politi København',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'cph-t2-pet', siteId: 'cph', tier: 2, type: 'agency',
    name: 'PET, Politiets Efterretningstjeneste',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'cph-sys-eurocontrol', siteId: 'cph', tier: 2, type: 'system',
    name: 'Eurocontrol NOTAM System',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },

  // Tier 3, national authorities
  { id: 'cph-t3-rigspoliti', siteId: 'cph', tier: 3, type: 'agency',
    name: 'Rigspolitiet',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'cph-t3-fe', siteId: 'cph', tier: 3, type: 'agency',
    name: 'Forsvarets Efterretningstjeneste (FE)',
    contactMethods: ['api'], availabilityStatus: 'off-hours' },
  { id: 'cph-t3-beredskab', siteId: 'cph', tier: 3, type: 'agency',
    name: 'Beredskabsstyrelsen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 4, military response (airborne priority for CPH)
  { id: 'cph-t4-flv-luftfor', siteId: 'cph', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Kontrolgruppen og Luftforsvarsgruppen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'cph-t4-qra', siteId: 'cph', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Quick Reaction Alert, Skrydstrup (F-16 / F-35)',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'cph-t4-forsvar', siteId: 'cph', tier: 4, type: 'agency',
    name: 'Forsvarskommandoen',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'cph-t4-hjv', siteId: 'cph', tier: 4, type: 'agency',
    name: 'Hjemmeværnet',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 5, NATO / international
  { id: 'cph-t5-aircom', siteId: 'cph', tier: 5, type: 'agency',
    name: 'NATO Allied Air Command, Ramstein',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'cph-t5-caoc', siteId: 'cph', tier: 5, type: 'agency',
    name: 'Combined Air Operations Centre, Uedem',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },

  // ═══════════════════════════════════════════════════════════
  // ESBJERG HARBOUR
  // ═══════════════════════════════════════════════════════════

  // Tier 1, site personnel
  { id: 'esb-t1-sec-ops', siteId: 'esbjerg', tier: 1, type: 'internal',
    name: 'Port of Esbjerg Security Operations Centre',
    contactMethods: ['in-app', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'esb-t1-duty', siteId: 'esbjerg', tier: 1, type: 'internal',
    name: 'Port of Esbjerg Duty Officer',
    contactMethods: ['phone', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'esb-t1-control', siteId: 'esbjerg', tier: 1, type: 'internal',
    name: 'Port Authority Control Room',
    contactMethods: ['in-app', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'esb-t1-terminal', siteId: 'esbjerg', tier: 1, type: 'internal',
    name: 'Terminal Operations Centre',
    contactMethods: ['in-app', 'phone'], availabilityStatus: 'on-shift' },
  // Tier 1, integrated systems
  { id: 'esb-sys-milestone', siteId: 'esbjerg', tier: 1, type: 'system',
    name: 'Port of Esbjerg Camera Surveillance System',
    contactMethods: ['webhook'], availabilityStatus: 'on-shift' },
  { id: 'esb-sys-scada', siteId: 'esbjerg', tier: 1, type: 'system',
    name: 'Port of Esbjerg Operations Data Broker',
    contactMethods: ['mqtt'], availabilityStatus: 'on-shift' },

  // Tier 2, local law enforcement + maritime coordination
  { id: 'esb-t2-politi', siteId: 'esbjerg', tier: 2, type: 'agency',
    name: 'Politi Sydvestjylland',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'esb-t2-pet', siteId: 'esbjerg', tier: 2, type: 'agency',
    name: 'PET, Politiets Efterretningstjeneste',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'esb-sys-vts', siteId: 'esbjerg', tier: 2, type: 'system',
    name: 'Vessel Traffic Services',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },

  // Tier 3, national authorities
  { id: 'esb-t3-rigspoliti', siteId: 'esbjerg', tier: 3, type: 'agency',
    name: 'Rigspolitiet',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'esb-t3-fe', siteId: 'esbjerg', tier: 3, type: 'agency',
    name: 'Forsvarets Efterretningstjeneste (FE)',
    contactMethods: ['api'], availabilityStatus: 'off-hours' },
  { id: 'esb-t3-beredskab', siteId: 'esbjerg', tier: 3, type: 'agency',
    name: 'Beredskabsstyrelsen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 4, military response (maritime priority for Esbjerg)
  { id: 'esb-t4-navy', siteId: 'esbjerg', tier: 4, type: 'agency',
    name: 'Søværnets Operative Kommando',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'esb-t4-coastguard', siteId: 'esbjerg', tier: 4, type: 'agency',
    name: 'Kystvagten (Coast Guard)',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'esb-t4-qra', siteId: 'esbjerg', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Quick Reaction Alert, Skrydstrup (F-16 / F-35)',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'esb-t4-airforce', siteId: 'esbjerg', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Kontrolgruppen og Luftforsvarsgruppen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'esb-t4-forsvar', siteId: 'esbjerg', tier: 4, type: 'agency',
    name: 'Forsvarskommandoen',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'esb-t4-hjv', siteId: 'esbjerg', tier: 4, type: 'agency',
    name: 'Hjemmeværnet',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 5, NATO / international
  { id: 'esb-t5-marcom', siteId: 'esbjerg', tier: 5, type: 'agency',
    name: 'NATO Allied Maritime Command, Northwood',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'esb-t5-nordefco', siteId: 'esbjerg', tier: 5, type: 'agency',
    name: 'Nordic Defence Cooperation (NORDEFCO)',
    contactMethods: ['api'], availabilityStatus: 'off-hours' },

  // ═══════════════════════════════════════════════════════════
  // ENERGINET · Hovegård
  // ═══════════════════════════════════════════════════════════

  // Tier 1, site personnel + integrated systems
  { id: 'hvg-t1-sec', siteId: 'energinet_hovegaard', tier: 1, type: 'internal',
    name: 'Energinet Site Security, Hovegård',
    contactMethods: ['in-app', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'hvg-t1-nk', siteId: 'energinet_hovegaard', tier: 1, type: 'internal',
    name: 'Energinet Nationalt Kontrolcenter, Fredericia',
    contactMethods: ['phone', 'api'], availabilityStatus: 'on-shift' },
  { id: 'hvg-t1-scada', siteId: 'energinet_hovegaard', tier: 1, type: 'system',
    name: 'Energinet SCADA Broker',
    contactMethods: ['mqtt'], availabilityStatus: 'on-shift' },

  // Tier 2, local law enforcement
  { id: 'hvg-t2-politi', siteId: 'energinet_hovegaard', tier: 2, type: 'agency',
    name: 'Nordsjællands Politi',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'hvg-t2-pet', siteId: 'energinet_hovegaard', tier: 2, type: 'agency',
    name: 'PET, Politiets Efterretningstjeneste',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 3, national authorities
  { id: 'hvg-t3-rigspoliti', siteId: 'energinet_hovegaard', tier: 3, type: 'agency',
    name: 'Rigspolitiet',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'hvg-t3-fe', siteId: 'energinet_hovegaard', tier: 3, type: 'agency',
    name: 'Forsvarets Efterretningstjeneste (FE)',
    contactMethods: ['api'], availabilityStatus: 'off-hours' },
  { id: 'hvg-t3-beredskab', siteId: 'energinet_hovegaard', tier: 3, type: 'agency',
    name: 'Beredskabsstyrelsen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 4, military response (grid infra: no QRA priority, ground reinforcement + national coordination)
  { id: 'hvg-t4-qra', siteId: 'energinet_hovegaard', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Quick Reaction Alert, Skrydstrup (F-16 / F-35)',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'hvg-t4-forsvar', siteId: 'energinet_hovegaard', tier: 4, type: 'agency',
    name: 'Forsvarskommandoen',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'hvg-t4-hjv', siteId: 'energinet_hovegaard', tier: 4, type: 'agency',
    name: 'Hjemmeværnet Region Hovedstaden',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 5, cross border grid coordination
  { id: 'hvg-t5-entsoe', siteId: 'energinet_hovegaard', tier: 5, type: 'agency',
    name: 'ENTSO-E, European Network of Transmission System Operators for Electricity',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },

  // ═══════════════════════════════════════════════════════════
  // ENERGINET · Bjæverskov HVDC
  // ═══════════════════════════════════════════════════════════

  // Tier 1, site personnel + integrated systems
  { id: 'bjk-t1-sec', siteId: 'energinet_bjaeverskov', tier: 1, type: 'internal',
    name: 'Energinet Site Security, Bjæverskov HVDC',
    contactMethods: ['in-app', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'bjk-t1-nk', siteId: 'energinet_bjaeverskov', tier: 1, type: 'internal',
    name: 'Energinet Nationalt Kontrolcenter, Fredericia',
    contactMethods: ['phone', 'api'], availabilityStatus: 'on-shift' },
  { id: 'bjk-t1-scada', siteId: 'energinet_bjaeverskov', tier: 1, type: 'system',
    name: 'Energinet SCADA Broker',
    contactMethods: ['mqtt'], availabilityStatus: 'on-shift' },

  // Tier 2, local law enforcement
  { id: 'bjk-t2-politi', siteId: 'energinet_bjaeverskov', tier: 2, type: 'agency',
    name: 'Sydsjællands og Lolland-Falsters Politi',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'bjk-t2-pet', siteId: 'energinet_bjaeverskov', tier: 2, type: 'agency',
    name: 'PET, Politiets Efterretningstjeneste',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 3, national authorities
  { id: 'bjk-t3-rigspoliti', siteId: 'energinet_bjaeverskov', tier: 3, type: 'agency',
    name: 'Rigspolitiet',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'bjk-t3-fe', siteId: 'energinet_bjaeverskov', tier: 3, type: 'agency',
    name: 'Forsvarets Efterretningstjeneste (FE)',
    contactMethods: ['api'], availabilityStatus: 'off-hours' },
  { id: 'bjk-t3-beredskab', siteId: 'energinet_bjaeverskov', tier: 3, type: 'agency',
    name: 'Beredskabsstyrelsen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 4, military response (grid infra: no QRA priority, ground reinforcement + national coordination)
  { id: 'bjk-t4-qra', siteId: 'energinet_bjaeverskov', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Quick Reaction Alert, Skrydstrup (F-16 / F-35)',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'bjk-t4-forsvar', siteId: 'energinet_bjaeverskov', tier: 4, type: 'agency',
    name: 'Forsvarskommandoen',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'bjk-t4-hjv', siteId: 'energinet_bjaeverskov', tier: 4, type: 'agency',
    name: 'Hjemmeværnet Region Sjælland',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 5, cross border grid coordination
  { id: 'bjk-t5-entsoe', siteId: 'energinet_bjaeverskov', tier: 5, type: 'agency',
    name: 'ENTSO-E, European Network of Transmission System Operators for Electricity',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },

  // ═══════════════════════════════════════════════════════════
  // ENERGINET · Landerupgård
  // ═══════════════════════════════════════════════════════════

  // Tier 1, site personnel + integrated systems
  { id: 'ldg-t1-sec', siteId: 'energinet_landerupgaard', tier: 1, type: 'internal',
    name: 'Energinet Site Security, Landerupgård',
    contactMethods: ['in-app', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'ldg-t1-nk', siteId: 'energinet_landerupgaard', tier: 1, type: 'internal',
    name: 'Energinet Nationalt Kontrolcenter, Fredericia',
    contactMethods: ['phone', 'api'], availabilityStatus: 'on-shift' },
  { id: 'ldg-t1-scada', siteId: 'energinet_landerupgaard', tier: 1, type: 'system',
    name: 'Energinet SCADA Broker',
    contactMethods: ['mqtt'], availabilityStatus: 'on-shift' },

  // Tier 2, local law enforcement
  { id: 'ldg-t2-politi', siteId: 'energinet_landerupgaard', tier: 2, type: 'agency',
    name: 'Sydøstjyllands Politi',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'ldg-t2-pet', siteId: 'energinet_landerupgaard', tier: 2, type: 'agency',
    name: 'PET, Politiets Efterretningstjeneste',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 3, national authorities
  { id: 'ldg-t3-rigspoliti', siteId: 'energinet_landerupgaard', tier: 3, type: 'agency',
    name: 'Rigspolitiet',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'ldg-t3-fe', siteId: 'energinet_landerupgaard', tier: 3, type: 'agency',
    name: 'Forsvarets Efterretningstjeneste (FE)',
    contactMethods: ['api'], availabilityStatus: 'off-hours' },
  { id: 'ldg-t3-beredskab', siteId: 'energinet_landerupgaard', tier: 3, type: 'agency',
    name: 'Beredskabsstyrelsen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 4, military response (grid infra: no QRA priority, ground reinforcement + national coordination)
  { id: 'ldg-t4-qra', siteId: 'energinet_landerupgaard', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Quick Reaction Alert, Skrydstrup (F-16 / F-35)',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'ldg-t4-forsvar', siteId: 'energinet_landerupgaard', tier: 4, type: 'agency',
    name: 'Forsvarskommandoen',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'ldg-t4-hjv', siteId: 'energinet_landerupgaard', tier: 4, type: 'agency',
    name: 'Hjemmeværnet Region Syddanmark',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 5, cross border grid coordination
  { id: 'ldg-t5-entsoe', siteId: 'energinet_landerupgaard', tier: 5, type: 'agency',
    name: 'ENTSO-E, European Network of Transmission System Operators for Electricity',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },

  // ═══════════════════════════════════════════════════════════
  // ENERGINET · Kassø
  // ═══════════════════════════════════════════════════════════

  // Tier 1, site personnel + integrated systems
  { id: 'kas-t1-sec', siteId: 'energinet_kassoe', tier: 1, type: 'internal',
    name: 'Energinet Site Security, Kassø',
    contactMethods: ['in-app', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'kas-t1-nk', siteId: 'energinet_kassoe', tier: 1, type: 'internal',
    name: 'Energinet Nationalt Kontrolcenter, Fredericia',
    contactMethods: ['phone', 'api'], availabilityStatus: 'on-shift' },
  { id: 'kas-t1-scada', siteId: 'energinet_kassoe', tier: 1, type: 'system',
    name: 'Energinet SCADA Broker',
    contactMethods: ['mqtt'], availabilityStatus: 'on-shift' },

  // Tier 2, local law enforcement
  { id: 'kas-t2-politi', siteId: 'energinet_kassoe', tier: 2, type: 'agency',
    name: 'Syd- og Sønderjyllands Politi',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'kas-t2-pet', siteId: 'energinet_kassoe', tier: 2, type: 'agency',
    name: 'PET, Politiets Efterretningstjeneste',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 3, national authorities
  { id: 'kas-t3-rigspoliti', siteId: 'energinet_kassoe', tier: 3, type: 'agency',
    name: 'Rigspolitiet',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'kas-t3-fe', siteId: 'energinet_kassoe', tier: 3, type: 'agency',
    name: 'Forsvarets Efterretningstjeneste (FE)',
    contactMethods: ['api'], availabilityStatus: 'off-hours' },
  { id: 'kas-t3-beredskab', siteId: 'energinet_kassoe', tier: 3, type: 'agency',
    name: 'Beredskabsstyrelsen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 4, military response (grid infra: no QRA priority, ground reinforcement + national coordination)
  { id: 'kas-t4-qra', siteId: 'energinet_kassoe', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Quick Reaction Alert, Skrydstrup (F-16 / F-35)',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'kas-t4-forsvar', siteId: 'energinet_kassoe', tier: 4, type: 'agency',
    name: 'Forsvarskommandoen',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'kas-t4-hjv', siteId: 'energinet_kassoe', tier: 4, type: 'agency',
    name: 'Hjemmeværnet Region Syddanmark',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 5, cross border grid coordination
  { id: 'kas-t5-entsoe', siteId: 'energinet_kassoe', tier: 5, type: 'agency',
    name: 'ENTSO-E, European Network of Transmission System Operators for Electricity',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },

  // ═══════════════════════════════════════════════════════════
  // ENERGINET · Ferslev
  // ═══════════════════════════════════════════════════════════

  // Tier 1, site personnel + integrated systems
  { id: 'frv-t1-sec', siteId: 'energinet_ferslev', tier: 1, type: 'internal',
    name: 'Energinet Site Security, Ferslev',
    contactMethods: ['in-app', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'frv-t1-nk', siteId: 'energinet_ferslev', tier: 1, type: 'internal',
    name: 'Energinet Nationalt Kontrolcenter, Fredericia',
    contactMethods: ['phone', 'api'], availabilityStatus: 'on-shift' },
  { id: 'frv-t1-scada', siteId: 'energinet_ferslev', tier: 1, type: 'system',
    name: 'Energinet SCADA Broker',
    contactMethods: ['mqtt'], availabilityStatus: 'on-shift' },

  // Tier 2, local law enforcement
  { id: 'frv-t2-politi', siteId: 'energinet_ferslev', tier: 2, type: 'agency',
    name: 'Nordjyllands Politi',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'frv-t2-pet', siteId: 'energinet_ferslev', tier: 2, type: 'agency',
    name: 'PET, Politiets Efterretningstjeneste',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 3, national authorities
  { id: 'frv-t3-rigspoliti', siteId: 'energinet_ferslev', tier: 3, type: 'agency',
    name: 'Rigspolitiet',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'frv-t3-fe', siteId: 'energinet_ferslev', tier: 3, type: 'agency',
    name: 'Forsvarets Efterretningstjeneste (FE)',
    contactMethods: ['api'], availabilityStatus: 'off-hours' },
  { id: 'frv-t3-beredskab', siteId: 'energinet_ferslev', tier: 3, type: 'agency',
    name: 'Beredskabsstyrelsen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 4, military response (grid infra: no QRA priority, ground reinforcement + national coordination)
  { id: 'frv-t4-qra', siteId: 'energinet_ferslev', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Quick Reaction Alert, Skrydstrup (F-16 / F-35)',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'frv-t4-forsvar', siteId: 'energinet_ferslev', tier: 4, type: 'agency',
    name: 'Forsvarskommandoen',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'frv-t4-hjv', siteId: 'energinet_ferslev', tier: 4, type: 'agency',
    name: 'Hjemmeværnet Region Nordjylland',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 5, cross border grid coordination
  { id: 'frv-t5-entsoe', siteId: 'energinet_ferslev', tier: 5, type: 'agency',
    name: 'ENTSO-E, European Network of Transmission System Operators for Electricity',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },

  // ═══════════════════════════════════════════════════════════
  // BILLUND AIRPORT (BLL / EKBI)
  // ═══════════════════════════════════════════════════════════
  // Second-busiest DK passenger airport + largest air cargo hub.
  // Municipal-owned. Sydøstjyllands Politi + TrekantBrand + Karup
  // for air response. Naviair Remote Tower Centre is the ATC seat.

  // Tier 1, site personnel + integrated systems
  { id: 'bll-t1-sec-ops', siteId: 'billund', tier: 1, type: 'internal',
    name: 'Billund Airport Security Operations Centre',
    contactMethods: ['in-app', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'bll-t1-duty-mgr', siteId: 'billund', tier: 1, type: 'internal',
    name: 'Billund Airport Duty Manager',
    contactMethods: ['phone', 'sms'], availabilityStatus: 'on-shift' },
  { id: 'bll-t1-atc', siteId: 'billund', tier: 1, type: 'internal',
    name: 'Naviair Remote Tower Centre, Billund',
    contactMethods: ['phone', 'in-app'], availabilityStatus: 'on-shift' },
  { id: 'bll-t1-arff', siteId: 'billund', tier: 1, type: 'internal',
    name: 'Billund Airport ARFF (fire station)',
    contactMethods: ['in-app', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'bll-t1-ground', siteId: 'billund', tier: 1, type: 'internal',
    name: 'Ground Operations Control',
    contactMethods: ['in-app', 'phone'], availabilityStatus: 'on-shift' },
  // Integrated systems
  { id: 'bll-sys-cameras', siteId: 'billund', tier: 1, type: 'system',
    name: 'Billund Airport CCTV / Video Management System',
    contactMethods: ['webhook'], availabilityStatus: 'on-shift' },
  { id: 'bll-sys-broker', siteId: 'billund', tier: 1, type: 'system',
    name: 'Billund Airport Operations Data Broker',
    contactMethods: ['mqtt'], availabilityStatus: 'on-shift' },

  // Tier 2, local law enforcement + national security service
  { id: 'bll-t2-politi', siteId: 'billund', tier: 2, type: 'agency',
    name: 'Sydøstjyllands Politi',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'bll-t2-pet', siteId: 'billund', tier: 2, type: 'agency',
    name: 'PET, Politiets Efterretningstjeneste',
    contactMethods: ['encrypted-email', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'bll-t2-trekantbrand', siteId: 'billund', tier: 2, type: 'agency',
    name: 'Trekantområdets Brandvæsen',
    contactMethods: ['phone', 'in-app'], availabilityStatus: 'on-shift' },
  { id: 'bll-sys-eurocontrol', siteId: 'billund', tier: 2, type: 'system',
    name: 'EUROCONTROL Network Manager',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },

  // Tier 3, national authorities
  { id: 'bll-t3-rigspoliti', siteId: 'billund', tier: 3, type: 'agency',
    name: 'Rigspolitiet',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'bll-t3-fe', siteId: 'billund', tier: 3, type: 'agency',
    name: 'Forsvarets Efterretningstjeneste (FE)',
    contactMethods: ['api'], availabilityStatus: 'off-hours' },
  { id: 'bll-t3-beredskab', siteId: 'billund', tier: 3, type: 'agency',
    name: 'Beredskabsstyrelsen',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },
  { id: 'bll-t3-traf', siteId: 'billund', tier: 3, type: 'agency',
    name: 'Trafikstyrelsen (Danish Civil Aviation Authority)',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },

  // Tier 4, military response (air priority for Billund — Karup is nearest base)
  { id: 'bll-t4-qra', siteId: 'billund', tier: 4, type: 'agency',
    name: 'Flyvestation Karup (nearest air response base)',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'bll-t4-qra-skrydstrup', siteId: 'billund', tier: 4, type: 'agency',
    name: 'Flyvevåbnet Quick Reaction Alert, Skrydstrup (F-35)',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
  { id: 'bll-t4-forsvar', siteId: 'billund', tier: 4, type: 'agency',
    name: 'Forsvarskommandoen',
    contactMethods: ['api', 'encrypted-email'], availabilityStatus: 'on-shift' },
  { id: 'bll-t4-hjv', siteId: 'billund', tier: 4, type: 'agency',
    name: 'Hærhjemmeværnsdistrikt Syd- og Sønderjylland',
    contactMethods: ['api', 'phone'], availabilityStatus: 'on-shift' },

  // Tier 5, NATO / international air coordination
  { id: 'bll-t5-nato-airc', siteId: 'billund', tier: 5, type: 'agency',
    name: 'NATO Combined Air Operations Centre, Uedem',
    contactMethods: ['api'], availabilityStatus: 'on-shift' },
];

// ═══════════════════════════════════════════════════════════════════
// P75 additions — new Danish agencies + universal tier-5 destinations
// ───────────────────────────────────────────────────────────────────
// Rather than duplicate ~15 destinations across 8 sites by hand, expand
// programmatically. Preserves existing site-specific IDs; new IDs use
// per-site prefix + tier/agency suffix.
// ═══════════════════════════════════════════════════════════════════

// Rename existing generic Politi entries to match official Politikreds naming
DESTINATIONS.forEach(d => {
  if (d.id === 'cph-t2-politi') d.name = 'Københavns Politi';
  if (d.id === 'esb-t2-politi') d.name = 'Syd- og Sønderjyllands Politi';
});

const _SITE_PREFIXES = {
  cph: 'cph',
  esbjerg: 'esb',
  energinet_hovegaard: 'hvg',
  energinet_bjaeverskov: 'bjk',
  energinet_landerupgaard: 'ldg',
  energinet_kassoe: 'kas',
  energinet_ferslev: 'frv',
  energinet_amager_koblingsstation: 'amk',
};

const _UNIVERSAL_CYBER_INTEL = [
  { tier: 3, type: 'agency', name: 'CFCS · Centre for Cybersecurity', suffix: 't3-cfcs',    ch: ['api', 'encrypted-email'] },
  { tier: 3, type: 'agency', name: 'PET · Center for Terror Analyse (CTA)', suffix: 't3-cta', ch: ['encrypted-email', 'phone'] },
  { tier: 3, type: 'agency', name: 'Rigspolitiet · NC3 (National Cyber Crime Center)', suffix: 't3-nc3', ch: ['api'] },
];
const _UNIVERSAL_TIER5 = [
  { tier: 5, type: 'agency', name: 'Statsministeriet · Kriseberedskab', suffix: 't5-stm',      ch: ['phone', 'encrypted-email'] },
  { tier: 5, type: 'agency', name: 'NOST · National Operativ Stab',     suffix: 't5-nost',     ch: ['api', 'encrypted-email'] },
  { tier: 5, type: 'agency', name: 'NORDEFCO · Nordic Defence Cooperation', suffix: 't5-nordefco', ch: ['api'] },
  { tier: 5, type: 'agency', name: 'EUROPOL',                            suffix: 't5-europol',  ch: ['api'] },
  { tier: 5, type: 'agency', name: 'NATO Air Policing Baltic',           suffix: 't5-nap-baltic', ch: ['api'] },
];
const _CPH_ONLY = [
  { tier: 3, type: 'agency', name: 'Trafikstyrelsen · Aviation Authority', suffix: 't3-trafikstyr', ch: ['api', 'encrypted-email'] },
];
const _ESBJERG_ONLY = [
  { tier: 2, type: 'agency', name: 'JRCC Denmark · Joint Rescue Coordination Centre', suffix: 't2-jrcc', ch: ['api', 'phone'] },
];
const _ENERGY_SITE = [
  { tier: 1, type: 'agency', name: 'Energinet Kontrolcenter · Grid Control Room', suffix: 't1-kontrol', ch: ['api', 'phone'] },
  { tier: 3, type: 'agency', name: 'Energistyrelsen · Danish Energy Agency', suffix: 't3-enagency',  ch: ['api'] },
  { tier: 3, type: 'agency', name: 'Sektorberedskab Energi',                 suffix: 't3-sektorber', ch: ['api', 'phone'] },
];

function _pushForSite(siteId, entries) {
  const pfx = _SITE_PREFIXES[siteId];
  if (!pfx) return;
  for (const e of entries) {
    DESTINATIONS.push({
      id: `${pfx}-${e.suffix}`,
      siteId, tier: e.tier, type: e.type, name: e.name,
      contactMethods: e.ch, availabilityStatus: 'on-shift',
    });
  }
}

// Apply universal cyber/intel + tier-5 to every configured site
for (const sid of Object.keys(_SITE_PREFIXES)) {
  _pushForSite(sid, _UNIVERSAL_CYBER_INTEL);
  _pushForSite(sid, _UNIVERSAL_TIER5);
}
_pushForSite('cph',     _CPH_ONLY);
_pushForSite('esbjerg', _ESBJERG_ONLY);
for (const sid of ['energinet_hovegaard', 'energinet_bjaeverskov', 'energinet_landerupgaard', 'energinet_kassoe', 'energinet_ferslev', 'energinet_amager_koblingsstation']) {
  _pushForSite(sid, _ENERGY_SITE);
}
// AMK (Amager Koblingsstation) missed the original CPH-metro Politi row —
// add its local Politikreds now (Amager is under Københavns Politi).
_pushForSite('energinet_amager_koblingsstation', [
  { tier: 2, type: 'agency', name: 'Københavns Politi', suffix: 't2-politi', ch: ['encrypted-email', 'phone'] },
]);

// Load overrides from localStorage (destination edits persist across refreshes)
// Storage key bumped 2026-08-11 to v5 — invalidates cached v4 overrides that
// don't include the P75 additions (CFCS, NOST, NORDEFCO, JRCC, Energistyrelsen etc).
const STORAGE_KEY = 'isr_c2_destinations_overrides_v5';
function loadOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function saveOverrides() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DESTINATIONS));
  } catch (e) {}
}
const overrides = loadOverrides();
if (Array.isArray(overrides) && overrides.length) {
  DESTINATIONS.length = 0;
  DESTINATIONS.push(...overrides);
}

// Auto-add Aktionsstyrken destinations per site. AKS is the national
// police tactical unit that responds to any critical incident. Rather
// than adding one entry per site inline in every site's block above
// (repetitive, easy to miss when adding a new site), add them at boot
// by scanning existing site IDs and adding a matching AKS entry per
// site if one doesn't already exist. Same pattern any national-role
// service could adopt (PET, FE, Beredskabsstyrelsen national coord).
(() => {
  const existingSiteIds = new Set(DESTINATIONS.map(d => d.siteId));
  const existingAksIds = new Set(DESTINATIONS.filter(d => /-t3-aks$/.test(d.id)).map(d => d.siteId));
  for (const sid of existingSiteIds) {
    if (existingAksIds.has(sid)) continue;
    // Site-code prefix derived from existing destinations. Falls back
    // to the siteId itself if no naming convention detected.
    const sample = DESTINATIONS.find(d => d.siteId === sid);
    const prefix = sample?.id?.split('-')[0] || sid;
    DESTINATIONS.push({
      id: `${prefix}-t3-aks`,
      siteId: sid,
      tier: 3,
      type: 'agency',
      name: 'Aktionsstyrken, national police tactical unit',
      contactMethods: ['api', 'encrypted-email', 'phone'],
      availabilityStatus: 'on-shift',
      domains: ['ground'],
    });
  }
})();

const _listeners = new Set();
function _notify() { _listeners.forEach(fn => fn()); }
export function onDestinationsChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

export function destinationsForSite(siteId) {
  return DESTINATIONS.filter(d => d.siteId === siteId).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

// ── Domain relevance layer ──
// Every destination declares which operational domains it cares about
// (maritime, aviation, ground, intel, cyber). Every event carries a
// domainScope Set that starts from site type + platform and grows as
// the trajectory evolves or linked shadow events are added at other
// sites. destinationsForEvent applies the intersection so an inland
// event never routes to Kystvagten but a drone that crosses the
// coastline does. Additive to destinationsForSite — same base list,
// domain filter on top.
export const DOMAIN_VOCAB = ['maritime', 'aviation', 'ground', 'intel', 'cyber', 'all'];

// Inference used at module boot to attach `domains: [...]` to every
// destination in DESTINATIONS. Keeps the catalog readable without
// hand-tagging every one of ~250 entries. Fallback is `['all']` so a
// mis-classified destination stays visible rather than silently hidden.
function _inferDomainsForDestination(dest) {
  const n = (dest.name || '').toLowerCase();
  // Explicit override wins over inference.
  if (Array.isArray(dest.domains) && dest.domains.length) return dest.domains;
  // Internal site staff own the site regardless of domain.
  if (dest.type === 'internal') return ['all'];
  // System integrations: NOTAM feeds are aviation, SCADA + camera stay ground.
  if (dest.type === 'system') {
    if (/eurocontrol|notam|aviation/.test(n)) return ['aviation'];
    if (/scada|mqtt|broker/.test(n)) return ['all'];
    if (/camera|surveillance/.test(n)) return ['all'];
    return ['all'];
  }
  // Agency mapping (order matters — most specific first).
  if (/kystvagt|søværn|soevaern|marcom|jrcc|joint rescue|vessel traffic|vts/.test(n)) return ['maritime'];
  if (/søfartsstyrelsen/.test(n)) return ['maritime'];
  if (/nato allied air|allied air command|ramstein|air policing|combined air operations|caoc/.test(n)) return ['aviation'];
  if (/flyvevåbnet|flyvevaabnet|quick reaction|f-35|f-16|karup|skrydstrup|luftforsvar|kontrolgruppen/.test(n)) return ['aviation'];
  if (/trafikstyrelsen|eurocontrol/.test(n)) return ['aviation'];
  if (/cfcs|nc3|cyber/.test(n)) return ['cyber'];
  if (/rigspoliti/.test(n)) return ['all'];
  if (/\bpet\b|efterretning/.test(n)) return ['all'];
  if (/\bpoliti\b/.test(n)) return ['ground'];
  if (/hæren|haeren|slagelse|høvelte|hoevelte|varde|bornholm|oksbøl|oksboel/.test(n)) return ['ground'];
  if (/hjemmev|beredskab|region|kommune/.test(n)) return ['all'];
  if (/forsvarskommand|nordefco|nato/.test(n)) return ['all'];
  return ['all'];
}
function _annotateDomains() {
  DESTINATIONS.forEach(d => { d.domains = _inferDomainsForDestination(d); });
}
_annotateDomains();

// Filter destinations for a site by an event's live domainScope.
// A destination is included when it declares 'all' OR shares at least
// one domain with the event scope. Falls back to the raw per-site list
// when event.domainScope is missing (backwards-compat for callers that
// haven't been event-aware wired up yet).
export function destinationsForEvent(event) {
  if (!event || !event.siteId) return [];
  const base = destinationsForSite(event.siteId);
  const scope = Array.isArray(event.domainScope) ? event.domainScope : null;
  if (!scope || !scope.length) return base;
  return base.filter(d => {
    const domains = Array.isArray(d.domains) && d.domains.length ? d.domains : ['all'];
    if (domains.includes('all')) return true;
    return domains.some(dom => scope.includes(dom));
  });
}

// Companion to destinationsForSite() — same hand-configured destinations
// PLUS a `geoContext` object describing which kommune/politikreds/region
// this site's coordinates fall inside. Non-authoritative for routing;
// intended for UI display + narrative enrichment + audit trails.
// Returns null geoContext if the sovereign geo router isn't primed or
// the site has no lat/lon.
export function destinationsForSiteWithGeoContext(siteId, siteLatLon) {
  const destinations = destinationsForSite(siteId);
  let geoContext = null;
  try {
    const resolver = (typeof window !== 'undefined' && window.__isr_geo_routing) ? window.__isr_geo_routing : null;
    const stats = resolver?.stats?.();
    if (resolver && stats?.primed && siteLatLon?.lat != null && siteLatLon?.lon != null) {
      const geo = resolver.forPoint(siteLatLon.lat, siteLatLon.lon);
      if (geo?.admins) geoContext = { ...geo.admins, receiverIds: geo.ids || [] };
    }
  } catch (_) { /* fail-safe */ }
  return { destinations, geoContext };
}

// Infer the parent agency short name from the raw destination name.
// Groups everything under one banner so escalate/rules UI can collapse
// tier-4's "Flyvevåbnet Kontrolgruppen + Flyvevåbnet QRA + ..." into a
// single "Flyvevåbnet" row with a departments dropdown.
export function destinationParent(dest) {
  const n = dest.name || '';
  // Site-scoped operations + systems
  if (n.startsWith('Copenhagen Airport') || n.startsWith('Port of Esbjerg')) {
    return dest.type === 'system' ? 'Site Systems' : 'Site Operations';
  }
  if (/Energinet/.test(n)) return dest.type === 'system' ? 'Energinet Systems' : 'Energinet Operations';
  // Danish agencies
  if (n.startsWith('Politi ') || /\bPolitikreds\b/.test(n)) return 'Politi';
  // Politikreds names by district — group under 'Politi' even without prefix
  if (/(Københavns|Nordsjællands|Vestegnens|Midt- og Vestsjællands|Sydsjællands|Fyns|Syd- og Sønderjyllands|Sydøstjyllands|Midt- og Vestjyllands|Østjyllands|Nordjyllands|Bornholms) Politi/.test(n)) return 'Politi';
  if (n.startsWith('PET')) return 'PET';
  if (n.startsWith('Rigspoliti')) return 'Rigspolitiet';
  if (n.startsWith('Forsvarets Efterretning') || /\bFE\b/.test(n)) return 'FE';
  if (n.startsWith('Beredskabsstyrelsen')) return 'Beredskabsstyrelsen';
  if (n.startsWith('Sektorberedskab')) return 'Beredskabsstyrelsen';
  if (n.startsWith('Flyvevåbnet') || /Quick Reaction/i.test(n)) return 'Flyvevåbnet';
  if (n.startsWith('Forsvarskommandoen')) return 'Forsvarskommandoen';
  if (n.startsWith('Hjemmeværnet')) return 'Hjemmeværnet';
  if (n.startsWith('Søværnet') || n.startsWith('Kystvagt')) return 'Søværnet';
  if (n.startsWith('JRCC')) return 'JRCC';
  if (n.startsWith('CFCS')) return 'CFCS';
  if (n.startsWith('Trafikstyrelsen')) return 'Trafikstyrelsen';
  if (n.startsWith('Energistyrelsen')) return 'Energistyrelsen';
  if (n.startsWith('Statsministeriet')) return 'Statsministeriet';
  if (n.startsWith('NOST')) return 'NOST';
  // International + aviation
  if (n.startsWith('Eurocontrol')) return 'Eurocontrol';
  if (n.startsWith('NATO') || n.startsWith('Combined Air') || /Ramstein|Uedem/.test(n)) return 'NATO';
  if (n.startsWith('NORDEFCO')) return 'NORDEFCO';
  if (n.startsWith('EUROPOL')) return 'EUROPOL';
  if (n.startsWith('ENTSO-E')) return 'ENTSO-E';
  return dest.type === 'internal' ? 'Site Operations' : (dest.type === 'system' ? 'Site Systems' : 'Other');
}

// Short department label — what appears in the dropdown after parent
// agency is expanded. Strips redundant agency prefix + trailing location.
export function destinationShortLabel(dest) {
  const parent = destinationParent(dest);
  let label = dest.name || '';
  // Strip parent prefix
  const prefixes = [
    parent + ' ',
    'Copenhagen Airport ',
    'Port of Esbjerg ',
  ];
  for (const p of prefixes) {
    if (label.startsWith(p)) label = label.slice(p.length);
  }
  // Strip trailing "(F-16 / F-35)" or similar parenthetical location hints
  return label.trim();
}

// Group destinations by parent agency within a single tier.
// Returns [{ parent, departments: [dest, ...] }, ...] alphabetically
// ordered by parent name — but 'Other' (catch-all bucket) always sorts
// to the bottom of its tier so it doesn't wedge into the middle.
export function groupByParent(destinations) {
  const map = new Map();
  for (const d of destinations) {
    const p = destinationParent(d);
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(d);
  }
  return Array.from(map.entries())
    .map(([parent, departments]) => ({ parent, departments }))
    .sort((a, b) => {
      if (a.parent === 'Other' && b.parent !== 'Other') return 1;
      if (b.parent === 'Other' && a.parent !== 'Other') return -1;
      return a.parent.localeCompare(b.parent);
    });
}

export function getDestination(id) {
  return DESTINATIONS.find(d => d.id === id);
}

export function destinationTypeLabel(type) {
  return { internal: 'Internal', agency: 'External Agency', system: 'External System' }[type] || type;
}

// ── Channel metadata (icon + latency + delivery description) ──
export const CHANNEL_META = {
  'in-app':          { icon: '💬', label: 'In-app',  latency: 'instant',      fmt: 'Displays in the operator console with the full event. Single-click acknowledgment.', urgency: 'live' },
  'sms':             { icon: '📱', label: 'SMS',     latency: 'under 30 sec', fmt: 'Text message with event summary and secure evidence link.',                            urgency: 'high' },
  'phone':           { icon: '📞', label: 'Phone',   latency: 'under 2 min',  fmt: 'Automated voice call. Press 1 to acknowledge.',                                        urgency: 'high' },
  'encrypted-email': { icon: '📧', label: 'Email',   latency: 'under 5 min',  fmt: 'Encrypted email with full brief and evidence link.',                                   urgency: 'med'  },
  'webhook':         { icon: '🔌', label: 'Webhook', latency: 'instant',      fmt: 'Machine push. JSON payload to integrated endpoint.',                                   urgency: 'sys'  },
  'mqtt':            { icon: '📡', label: 'MQTT',    latency: 'instant',      fmt: 'Broker message. Retained topic for late subscribers.',                                 urgency: 'sys'  },
  'api':             { icon: '⚙️', label: 'API',     latency: 'under 10 sec', fmt: 'Direct integration call to Genetec, Milestone, or equivalent platform.',              urgency: 'sys'  },
};

// ── Destination guidance (use cases, exclusions, operational notes) ──
const _DEST_GUIDANCE_BY_TIER_TYPE = {
  '1-internal': {
    useCases: [
      'Any confirmed threat within site perimeter',
      'Primary physical response on the ground',
      'Hostile drone detected on the property',
    ],
    notAppropriate: [
      'False positives already dismissed',
      'Friendly identifications (log only)',
    ],
    notes: 'Primary site responders. Dispatch for any confirmed threat. Continuous shift coverage.',
  },
  '1-system': {
    useCases: [
      'Every confirmed event, for audit record',
      'Downstream integration with VMS, SCADA, or SIEM',
      'Machine readable event distribution',
    ],
    notAppropriate: [
      'Any workflow requiring human decision',
    ],
    notes: 'Machine integration. Automatic dispatch on every escalation. No acknowledgment expected.',
  },
  '2-agency': {
    useCases: [
      'Confirmed hostile within site perimeter',
      'Persistent unknown platform',
      'Any incident requiring police involvement',
    ],
    notAppropriate: [
      'High altitude reconnaissance (Tier 3 domain)',
      'Registered inspection flights on schedule',
    ],
    notes: 'Response window 5 to 15 minutes. Await acknowledgment before Tier 3 escalation.',
  },
  '2-system': {
    useCases: [
      'Aviation impact (Eurocontrol NOTAM)',
      'Maritime impact (Vessel Traffic Services)',
      'Coordination required with airspace or waterway operators',
    ],
    notAppropriate: [
      'Ground only threats without aviation or maritime impact',
    ],
    notes: 'Machine coordination. Automatic dispatch when threat class matches operational impact rules.',
  },
  '3-agency': {
    useCases: [
      'High altitude reconnaissance exceeding 10 minutes',
      'Weapon visually confirmed',
      'Incident spanning multiple jurisdictions',
    ],
    notAppropriate: [
      'Any incident resolvable at Tier 1 or Tier 2',
    ],
    notes: 'National level dispatch. Reserved for events exceeding local response capability.',
  },
  '4-agency': {
    useCases: [
      'Unauthorised aircraft in restricted airspace',
      'Missile signature confirmed',
      'Coordinated multi drone attack',
    ],
    notAppropriate: [
      'Any threat resolvable without military response',
    ],
    notes: 'Radio silence protocol on dispatch. Flyvevåbnet assumes operational control. Nonrecallable.',
  },
  '5-agency': {
    useCases: [
      'Confirmed cross border origin',
      'Missile with foreign launch signature',
      'Attack pattern indicating state actor',
    ],
    notAppropriate: [
      'Domestic scale incidents',
    ],
    notes: 'International handoff. Automatic dispatch only for precleared threat classes (missile, fighter jet incursion).',
  },
};

export function getDestinationGuidance(dest) {
  const key = `${dest.tier}-${dest.type}`;
  return _DEST_GUIDANCE_BY_TIER_TYPE[key] || {
    useCases: ['Use per site specific escalation policy'],
    notAppropriate: [],
    notes: 'No guidance defined for this destination class.',
  };
}

// ── Mutation API ──
let _idCounter = 9000;
function nextDestinationId(siteId) {
  _idCounter++;
  return `${siteId}-custom-${_idCounter}`;
}

export function addDestination(dest) {
  if (!dest.id) dest.id = nextDestinationId(dest.siteId);
  DESTINATIONS.push(dest);
  saveOverrides(); _notify();
  return dest.id;
}

export function updateDestination(id, patch) {
  const idx = DESTINATIONS.findIndex(d => d.id === id);
  if (idx < 0) return;
  DESTINATIONS[idx] = { ...DESTINATIONS[idx], ...patch };
  saveOverrides(); _notify();
}

export function removeDestination(id) {
  const idx = DESTINATIONS.findIndex(d => d.id === id);
  if (idx < 0) return;
  DESTINATIONS.splice(idx, 1);
  saveOverrides(); _notify();
}

export function resetDestinationsToDefault() {
  localStorage.removeItem(STORAGE_KEY);
  // Caller must reload for defaults to reapply (module state cannot un-mutate cleanly).
}

export function getAllDestinations() { return [...DESTINATIONS]; }
