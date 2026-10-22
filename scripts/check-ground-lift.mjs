// ═══════════════════════════════════════════════════════════════════
// check:ground-lift — outside CPH, tracks are DRAWN above the ground,
// and nothing but the drawing changed
// ───────────────────────────────────────────────────────────────────
// See src/ground_lift.js. Measured 2026-10-22: 22 of 52 templates were
// drawn partly underground. Lucas: fix the rest, do not touch CPH.
//
// The first version rewrote waypoint altitudes, and an independent
// review showed that moved the "m AGL" readout, the export, the summary
// agent's altitude score, interceptor climb and an advisory threshold.
// So the assertions here are mostly about what must NOT move.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { GROUND_LIFT, groundLiftM } from '../src/ground_lift.js';
import { TEMPLATES, makeSubstationThreats } from '../src/drones.js';
import { SITES } from '../src/sites_registry.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const ALL = { ...TEMPLATES };
for (const s of Object.values(SITES).filter(x => x.siteType === 'energy')) {
  Object.assign(ALL, makeSubstationThreats(s.id, s.name, s.coordinates.lat, s.coordinates.lon, s.sensors.map(x => x.id)));
}
// CPH airport and the routes that are CPH stories even when their
// siteId says otherwise (the two-tier missile to Amalienborg, the recon
// swarm CPH to Amager).
const isCph = k => /cph|amalienborg/.test(k) || ALL[k]?.siteId === 'cph';

console.log('\n[scope]');
check('no Copenhagen airport template is in the table', Object.keys(GROUND_LIFT).every(k => !isCph(k)));
const cphKeys = Object.keys(ALL).filter(isCph);
check(`every CPH template lifts by exactly 0 (${cphKeys.length} templates)`, cphKeys.every(k => groundLiftM(k) === 0));
check('every table entry names a real template', Object.keys(GROUND_LIFT).every(k => ALL[k]),
  Object.keys(GROUND_LIFT).filter(k => !ALL[k]).join(', '));
// Reverse: a new non-CPH site (an Aarhus harbour, a new substation by
// YAML) must be measured before it ships, not silently drawn underground.
const unmeasured = Object.keys(ALL).filter(k => !isCph(k) && !(k in GROUND_LIFT));
check('every non-CPH template has been measured', unmeasured.length === 0,
  `run __isr_altAudit() on a dev instance and add: ${unmeasured.join(', ')}`);

console.log('\n[values]');
check('every lift covers its measured ground', Object.values(GROUND_LIFT).every(e => e.liftM >= e.measuredGroundM));
check('rounding adds at most 5 m', Object.values(GROUND_LIFT).every(e => e.liftM - e.measuredGroundM < 5));
check('the boat is lifted exactly, so it sits on the water',
  GROUND_LIFT.esbjerg_usv_hostile.liftM === GROUND_LIFT.esbjerg_usv_hostile.measuredGroundM);
check('unknown or missing key lifts by 0', groundLiftM('nope') === 0 && groundLiftM(null) === 0 && groundLiftM(undefined) === 0);

console.log('\n[the data did not move]');
// Waypoint altitudes are what the panel, the export, the agents, the
// interceptors and the advisories read. They must be exactly as authored.
const drones = readFileSync(new URL('../src/drones.js', import.meta.url), 'utf8');
check('drones.js does not import or apply the lift', !/ground_lift/.test(drones) && !/applyGroundLift/.test(drones));
check('no template carries a lift marker', Object.values(ALL).every(t => t.groundLiftM === undefined));

console.log('\n[only the drawing moved]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('single track: drawn height adds the lift, nothing else does',
  /state\._absAlt = p\.alt \+ _groundLiftM\(event\.templateKey\);/.test(main));
check('single track: the drop line ends on the ground, not 40-125 m under it',
  /_terrainRel \? \(state\._terrOff \|\| 0\) : _groundLiftM\(event\.templateKey\)\)/.test(main));
check('swarm member, trail and projection add the same lift',
  /fromDegrees\(pos\.lon, pos\.lat, pos\.alt \+ _swLift\)/.test(main)
  && /_safeTrailAlt\(pos\.alt\) \+ _swLift/.test(main)
  && (main.match(/pos\.alt \+ _swLift/g) || []).length === 2);
check('coverage still tests the authored height above ground',
  /_shouldAutoDetect\(pos\.lat, pos\.lon, pos\.alt\)/.test(main));
check('the lift appears nowhere else in main.js',
  (main.match(/_groundLiftM\(/g) || []).length === 3 && (main.match(/_swLift/g) || []).length === 4,
  'a new use is a new behaviour: review it against the list in ground_lift.js first');

if (failures) {
  console.log(`\ncheck:ground-lift FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:ground-lift passed');
