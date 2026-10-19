// ═══════════════════════════════════════════════════════════════════
// check:quad-axes — the airframe tips the way the manoeuvre says
// ───────────────────────────────────────────────────────────────────
// A quadcopter has no control surfaces: it goes where it leans. So the
// ONLY thing that tells a viewer what a drone is doing is its attitude,
// and an attitude that is right for cruise can still be wrong for every
// other manoeuvre.
//
// It was. glTF is Y-up and Cesium converts to its Z-up model frame as
// (x, y, z) -> (x, -z, y). Both quad assets are authored nose-on-Z, so
// after that conversion the nose lands on +-Y, which is 90 degrees off
// Cesium's forward (+X). That is why both carry a 90 or 270 heading
// offset, and both were found by eye rather than derived.
//
// The consequence was missed for months. Cesium composes
// Rz(heading) . Ry(pitch) . Rx(roll), so pitch turns about the frame's Y
// and roll about its X. With the nose sitting on Y, the PITCH slot
// rotates the airframe about its own nose, which is roll, and the ROLL
// slot pitches it. A sign flip cannot turn pitch into roll, so a steady
// cruise still looked plausible (a 23 degree lean is a lean whichever
// axis it is about) while accelerating banked the airframe sideways and
// sliding sideways pitched its nose down.
//
// This gate builds the EXACT quaternion main.js builds, from the real
// rotor-hub geometry, and asserts what the airframe actually does.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import * as C from '@cesium/engine';

const DEG = Math.PI / 180;
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

// ── read the two tables straight out of main.js ────────────────────
// Scoped to each table: both keys appear in BOTH tables, so an unscoped
// search finds the rotor hubs when it wants the model spec.
function table(name) {
  const i = main.indexOf(`const ${name} = {`);
  if (i < 0) return '';
  const j = main.indexOf('\n  };', i);
  return j < 0 ? main.slice(i) : main.slice(i, j);
}
const SPECS = table('_QUAD_MODELS');
const HUBS = table('_QUAD_ROTOR_HUBS');

function readSpec(key) {
  const re = new RegExp(`${key}:\\s*\\{([\\s\\S]*?)\\n    \\},`, 'm');
  const m = re.exec(SPECS);
  if (!m) return null;
  const body = m[1];
  const num = (n) => { const x = new RegExp(`${n}:\\s*(-?[0-9.]+)`).exec(body); return x ? Number(x[1]) : null; };
  return {
    headingOffsetDeg: num('headingOffsetDeg'),
    pitchSign: num('pitchSign') ?? 1,
    rollSign: num('rollSign') ?? 1,
    swap: /swapPitchRoll:\s*true/.test(body),
  };
}
function readNose(key) {
  const re = new RegExp(`${key}:\\s*\\{[\\s\\S]*?nose:\\s*'([+-][xyz])'`, 'm');
  const m = re.exec(HUBS);
  return m ? m[1] : null;
}

const AX = { '+x':[1,0,0], '-x':[-1,0,0], '+y':[0,1,0], '-y':[0,-1,0], '+z':[0,0,1], '-z':[0,0,-1] };
// Cesium's glTF Y-up -> Z-up model frame conversion.
const g2c = ([x, y, z]) => new C.Cartesian3(x, -z, y);

function body(noseKey, upKey) {
  const n = g2c(AX[noseKey]), u = g2c(AX[upKey]);
  const r = C.Cartesian3.cross(n, u, new C.Cartesian3());
  return { n, u, r: C.Cartesian3.normalize(r, r) };
}

// Exactly what _quadOrientation builds.
function render(B, spec, pitchDeg, rollDeg) {
  const mp = pitchDeg * DEG, mr = rollDeg * DEG;
  const hpr = new C.HeadingPitchRoll(
    spec.headingOffsetDeg * DEG,
    (spec.swap ? -mr : mp) * spec.pitchSign,
    (spec.swap ?  mp : mr) * spec.rollSign);
  const R = C.Matrix3.fromQuaternion(C.Quaternion.fromHeadingPitchRoll(hpr));
  const t = (v) => C.Matrix3.multiplyByVector(R, v, new C.Cartesian3());
  const o = { nose: t(B.n), up: t(B.u) };
  const cl = (x) => Math.max(-1, Math.min(1, x));
  return {
    noseUp: Math.asin(cl(o.nose.z)) / DEG,        // + nose up
    bankRight: -Math.asin(cl(o.up.y)) / DEG,      // + right wing down
    yawPort: Math.atan2(o.nose.y, o.nose.x) / DEG, // + nose off to port
  };
}

// The flight model's convention, from src/quad_flight_model.js:
//   "leaning forward is nose DOWN, so negative in Cesium's convention"
//   "leaning right is right wing down, positive"
const CASES = [
  ['hovers level',                      0,   0,   0,   0],
  ['pitches nose DOWN to accelerate', -25,   0, -25,   0],
  ['pitches nose UP to brake',         25,   0,  25,   0],
  ['pitches nose UP in reverse',       20,   0,  20,   0],
  ['drops the RIGHT wing sliding right', 0,  25,   0,  25],
  ['drops the LEFT wing sliding left',   0, -25,   0, -25],
];

for (const [key, label] of [['dji_air_3', 'DJI Air 3 (recon)'],
                            ['assault_drone_concept', 'assault drone (counter-UAS swarms)']]) {
  console.log(`\n${label}`);
  const spec = readSpec(key), noseKey = readNose(key);
  check(`${key}: spec and rotor geometry both readable`,
    spec && spec.headingOffsetDeg !== null && noseKey,
    'the gate parses main.js; if the tables moved, fix the gate, do not delete it');
  if (!spec || !noseKey) continue;
  const B = body(noseKey, '+y');

  check(`${key}: the nose points along the track at level`,
    Math.abs(render(B, spec, 0, 0).yawPort) < 0.5,
    `headingOffsetDeg ${spec.headingOffsetDeg} with a nose on ${noseKey} leaves the `
    + 'airframe flying sideways. These two have to agree: a nose on -z needs 90, '
    + 'a nose on +z needs 270.');

  for (const [what, p, r, wantNoseUp, wantBank] of CASES) {
    const got = render(B, spec, p, r);
    check(`${key}: ${what}`,
      Math.abs(got.noseUp - wantNoseUp) < 0.5 && Math.abs(got.bankRight - wantBank) < 0.5,
      `flight model said pitch ${p}, roll ${r}. Expected nose ${wantNoseUp} deg and `
      + `bank ${wantBank} deg; the rendered airframe does nose ${got.noseUp.toFixed(1)} `
      + `and bank ${got.bankRight.toFixed(1)}. A quadcopter goes where it leans, so a `
      + 'swapped axis is not cosmetic: it shows the operator a drone sliding sideways '
      + 'when it is accelerating.');
  }
}

if (failures) {
  console.log(`\ncheck:quad-axes FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:quad-axes passed');
