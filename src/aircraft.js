// Danish military air response assets by base. Every airframe currently
// operated by Flyvevåbnet or Søværnet with the specs an operator needs to
// make a dispatch decision. Reads live in the receiver Response Overlay
// via info icon popups.
//
// Structure lets the operator see WHY an asset is chosen (F-35 for cruise
// missile intercept because it's the only supersonic AAM platform), and
// contextualises non intercept assets (Karup helicopters can't touch a
// Mach 0.7 cruise missile but are relevant for SAR / evacuation).

// ── SVG silhouettes ──────────────────────────────────────────────
// Clean line art side profiles. Rendered on a dark charcoal panel with
// cyan accent — matches the operator surface. Deliberately abstracted
// so they read at small sizes and don't feel like clip art.

const SVG_F35 = `
<svg viewBox="0 0 320 140" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="f35grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4dd2ff" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#4dd2ff" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="#4dd2ff" stroke-width="1.5" stroke-linejoin="round">
    <!-- fuselage -->
    <path d="M 22 76 L 60 68 L 130 62 L 200 60 L 258 66 L 288 76 L 258 82 L 200 84 L 130 84 L 60 82 Z" fill="url(#f35grad)"/>
    <!-- main wing -->
    <path d="M 120 74 L 160 42 L 200 44 L 210 74 L 200 96 L 160 100 L 130 74 Z" fill="url(#f35grad)"/>
    <!-- vertical tail -->
    <path d="M 232 60 L 254 32 L 268 34 L 260 62 Z" fill="url(#f35grad)"/>
    <path d="M 232 84 L 254 108 L 268 106 L 260 82 Z" fill="url(#f35grad)"/>
    <!-- canopy -->
    <path d="M 190 68 L 220 66 L 230 72 L 218 78 L 190 76 Z" fill="#4dd2ff" fill-opacity="0.28"/>
    <!-- exhaust glow -->
    <line x1="22" y1="76" x2="8" y2="72" stroke-opacity="0.5"/>
    <line x1="22" y1="76" x2="6" y2="80" stroke-opacity="0.5"/>
  </g>
</svg>`;

const SVG_HELO = `
<svg viewBox="0 0 320 140" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hgrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4dd2ff" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#4dd2ff" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="#4dd2ff" stroke-width="1.5" stroke-linejoin="round">
    <!-- rotor disc -->
    <ellipse cx="150" cy="42" rx="128" ry="4" fill="#4dd2ff" fill-opacity="0.10"/>
    <line x1="150" y1="46" x2="150" y2="60"/>
    <!-- cabin -->
    <path d="M 60 60 L 240 60 L 264 74 L 240 90 L 90 92 L 60 82 Z" fill="url(#hgrad)"/>
    <!-- cockpit window -->
    <path d="M 210 66 L 240 66 L 258 74 L 234 82 L 210 80 Z" fill="#4dd2ff" fill-opacity="0.28"/>
    <!-- tail boom -->
    <path d="M 60 74 L 20 76 L 8 82 L 30 82 L 60 80 Z" fill="url(#hgrad)"/>
    <!-- tail rotor -->
    <ellipse cx="18" cy="70" rx="4" ry="18" fill="#4dd2ff" fill-opacity="0.15"/>
    <line x1="18" y1="52" x2="18" y2="88" stroke-opacity="0.6"/>
    <!-- skids -->
    <line x1="90" y1="98" x2="220" y2="98"/>
    <line x1="100" y1="92" x2="100" y2="102"/>
    <line x1="210" y1="92" x2="210" y2="102"/>
  </g>
</svg>`;

const SVG_TRANSPORT = `
<svg viewBox="0 0 320 140" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tgrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4dd2ff" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#4dd2ff" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="#4dd2ff" stroke-width="1.5" stroke-linejoin="round">
    <!-- fuselage -->
    <path d="M 16 78 L 60 66 L 240 62 L 280 66 L 300 76 L 288 84 L 260 88 L 60 88 Z" fill="url(#tgrad)"/>
    <!-- cockpit -->
    <path d="M 258 66 L 288 68 L 296 76 L 282 80 L 258 78 Z" fill="#4dd2ff" fill-opacity="0.28"/>
    <!-- high wing -->
    <path d="M 100 62 L 240 40 L 260 42 L 220 66 L 110 68 Z" fill="url(#tgrad)"/>
    <!-- 4 propellers -->
    <g fill="#4dd2ff" fill-opacity="0.5">
      <circle cx="122" cy="52" r="14" fill="none" stroke-opacity="0.4"/>
      <circle cx="122" cy="52" r="2"/>
      <circle cx="162" cy="48" r="14" fill="none" stroke-opacity="0.4"/>
      <circle cx="162" cy="48" r="2"/>
      <circle cx="202" cy="46" r="14" fill="none" stroke-opacity="0.4"/>
      <circle cx="202" cy="46" r="2"/>
      <circle cx="238" cy="44" r="14" fill="none" stroke-opacity="0.4"/>
      <circle cx="238" cy="44" r="2"/>
    </g>
    <!-- tail -->
    <path d="M 34 74 L 60 44 L 74 44 L 60 74 Z" fill="url(#tgrad)"/>
    <path d="M 34 82 L 20 90 L 32 92 L 46 82 Z" fill="url(#tgrad)"/>
    <!-- landing gear pods -->
    <path d="M 130 88 L 130 94 L 165 94 L 165 88 Z" fill="url(#tgrad)"/>
  </g>
</svg>`;

const SVG_JET = `
<svg viewBox="0 0 320 140" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="jgrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4dd2ff" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#4dd2ff" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="#4dd2ff" stroke-width="1.5" stroke-linejoin="round">
    <!-- fuselage -->
    <path d="M 24 76 L 60 68 L 230 64 L 274 70 L 292 78 L 274 82 L 230 86 L 60 84 Z" fill="url(#jgrad)"/>
    <!-- cockpit -->
    <path d="M 248 68 L 282 70 L 292 78 L 278 82 L 248 80 Z" fill="#4dd2ff" fill-opacity="0.28"/>
    <!-- swept wing -->
    <path d="M 90 74 L 170 54 L 200 56 L 160 74 Z" fill="url(#jgrad)"/>
    <path d="M 90 78 L 170 98 L 200 96 L 160 78 Z" fill="url(#jgrad)"/>
    <!-- rear mounted engines -->
    <ellipse cx="70" cy="62" rx="18" ry="6" fill="url(#jgrad)"/>
    <ellipse cx="70" cy="90" rx="18" ry="6" fill="url(#jgrad)"/>
    <!-- T tail -->
    <path d="M 40 74 L 20 44 L 32 44 L 48 74 Z" fill="url(#jgrad)"/>
    <path d="M 4 42 L 44 40 L 40 46 L 4 48 Z" fill="url(#jgrad)"/>
  </g>
</svg>`;

// ── Fleet catalog ────────────────────────────────────────────────
// Every airframe: base assignment, real world specs, and operational
// notes. bestFor / notAppropriate give the operator immediate context
// on why the asset is / isn't suited for the current threat.

export const AIRCRAFT = {
  'f-35a': {
    // Specs per Lockheed Martin F-35A product card (FG19-00608_001).
    // Numbers Lockheed doesn't publish on that card (MTOW, ceiling,
    // weapons stations) intentionally omitted — no fill in from
    // secondary sources.
    designation: 'F-35A Lightning II',
    role: 'Multi role fighter · Air superiority · QRA',
    operator: 'Flyvevåbnet',
    baseId: 'skrydstrup',
    baseName: 'Flyvestation Skrydstrup',
    inventory: '27 airframes',
    crew: 1,
    maxSpeed: 'Mach 1.6',
    combatRadius: '>590 nm · 1 093 km (internal fuel)',
    range: '>1 200 nm · 2 200 km (internal fuel)',
    internalFuel: '18 250 lb · 8 278 kg',
    maxG: '9.0',
    propulsion: 'Pratt & Whitney F135-PW-100',
    thrust: '40 000 lb (afterburner) · 25 000 lb (military dry)',
    armament: 'AIM-120C/D AMRAAM · AIM-9X Sidewinder · GBU-31/38 JDAM · GAU-22/A 25 mm cannon',
    payload: '18 000 lb · 8 160 kg weapons',
    dimensions: '15.7 m length · 10.7 m wingspan · 42.7 m² wing area',
    bestFor: 'Airborne intercept · air superiority · SEAD · precision strike',
    notAppropriate: 'SAR · troop lift · sustained low speed patrol',
    image: '/aircraft/f-35a.png',
    specSource: 'Lockheed Martin F-35A product card',
    svg: SVG_F35,
    icon: 'fighter',
  },
  'mh-60r': {
    designation: 'MH-60R Seahawk',
    role: 'Naval helicopter · ASW · maritime patrol · SAR',
    operator: 'Flyvevåbnet · Søværnet integration',
    baseId: 'karup',
    baseName: 'Flyvestation Karup',
    inventory: '9 airframes',
    crew: '3 to 4',
    maxSpeed: '267 km/h',
    cruiseSpeed: '246 km/h',
    ceiling: '3 700 m',
    range: '834 km · 3.5 h endurance',
    armament: 'AGM-114 Hellfire · Mk 54 torpedo · door mounted M240 / GAU-16 machine guns',
    payload: 'Sensor suite + towed dipping sonar + sonobuoys',
    dimensions: '19.8 m length · 16.4 m rotor',
    bestFor: 'Ship deck operations · anti submarine · maritime SAR · fast rope insertion',
    notAppropriate: 'Cruise missile intercept · high altitude interception',
    image: '/aircraft/mh-60r.png',
    svg: SVG_HELO,
    icon: 'helo',
  },
  'aw-101-merlin': {
    designation: 'AW-101 Merlin (EH-101)',
    role: 'Medium heavy helicopter · SAR · troop transport',
    operator: 'Flyvevåbnet',
    baseId: 'karup',
    baseName: 'Flyvestation Karup',
    inventory: '14 airframes',
    crew: '3 (pilot, copilot, crew chief) + up to 26 troops',
    maxSpeed: '309 km/h',
    cruiseSpeed: '278 km/h',
    ceiling: '4 575 m',
    range: '1 389 km · 6 h endurance',
    armament: 'Door mounted machine guns (SAR variant unarmed)',
    payload: '5 443 kg external · 26 troops or 16 stretchers',
    dimensions: '22.8 m length · 18.6 m rotor',
    bestFor: 'Long range SAR · casualty evacuation · troop lift · maritime rescue',
    notAppropriate: 'Airborne intercept · precision strike',
    image: '/aircraft/aw-101.png',
    svg: SVG_HELO,
    icon: 'helo',
  },
  'c-130j-30': {
    designation: 'C-130J-30 Super Hercules',
    role: 'Tactical transport · airdrop · MEDEVAC',
    operator: 'Flyvevåbnet',
    baseId: 'aalborg',
    baseName: 'Flyvestation Aalborg',
    inventory: '4 airframes',
    crew: 3,
    maxSpeed: '671 km/h',
    cruiseSpeed: '644 km/h',
    ceiling: '8 615 m (loaded)',
    range: '5 250 km with 15 000 kg payload',
    armament: 'None (unarmed transport)',
    payload: '19 000 kg cargo · 92 troops · 64 paratroopers · 74 stretchers',
    dimensions: '34.4 m length · 40.4 m wingspan',
    bestFor: 'Tactical airlift · airdrop · MEDEVAC · humanitarian resupply',
    notAppropriate: 'Any kinetic response · combat intercept',
    image: '/aircraft/c-130j.png',
    svg: SVG_TRANSPORT,
    icon: 'transport',
  },
  'challenger-604': {
    designation: 'Bombardier Challenger CL-604',
    role: 'Maritime patrol · VIP transport · sovereignty patrol',
    operator: 'Flyvevåbnet',
    baseId: 'aalborg',
    baseName: 'Flyvestation Aalborg',
    inventory: '4 airframes',
    crew: '2 flight + 2 mission crew',
    maxSpeed: '870 km/h',
    cruiseSpeed: '817 km/h',
    ceiling: '12 500 m',
    range: '7 400 km · 8 h endurance',
    armament: 'None · sensor suite (radar, EO/IR, AIS)',
    payload: 'Mission systems + 9 passengers',
    dimensions: '20.9 m length · 19.6 m wingspan',
    bestFor: 'Maritime surveillance · sovereignty patrol Arctic · Greenland / Faroe Islands coverage',
    notAppropriate: 'Kinetic intercept · troop lift',
    image: '/aircraft/cl-604.png',
    svg: SVG_JET,
    icon: 'jet',
  },
};

// Base → aircraft assignments. Used to render the full fleet at a given
// site (e.g. "all Skrydstrup options" in the dispatch card).
export const BASE_AIRCRAFT = {
  skrydstrup: ['f-35a'],
  karup:      ['mh-60r', 'aw-101-merlin'],
  aalborg:    ['c-130j-30', 'challenger-604'],
};

export function aircraftById(id) {
  return AIRCRAFT[id] || null;
}

export function aircraftAtBase(baseId) {
  return (BASE_AIRCRAFT[baseId] || []).map(id => AIRCRAFT[id]).filter(Boolean);
}

// Given a response asset (from response_assets.js) return the matching
// aircraft ids relevant to that asset. Enables info popups on the
// tactical assets list in the receiver overlay.
export function aircraftForResponseAsset(assetId) {
  const map = {
    'flv-skrydstrup': ['f-35a'],
    'flv-karup':      ['mh-60r', 'aw-101-merlin'],
    'flv-aalborg':    ['c-130j-30', 'challenger-604'],
  };
  return (map[assetId] || []).map(id => AIRCRAFT[id]).filter(Boolean);
}
