// ═══════════════════════════════════════════════════════════════════
// check:flight-path — a flown path is flyable AND faithful
// ───────────────────────────────────────────────────────────────────
// src/flight_path.js gives the controller back the job it has in
// Blender: it OWNS the trajectory. Two things have to hold, and they
// pull against each other.
//
//   FLYABLE   nothing in the generated path may exceed the airframe:
//             not the top speed, not A_MAX, not the yaw rate. If it
//             does, the generator is not actually integrating.
//   FAITHFUL  the flown path has to still be the authored route. A
//             generator that smooths beautifully while wandering 300 m
//             off a named asset has not solved anything.
// ═══════════════════════════════════════════════════════════════════
import * as FP from '../src/flight_path.js';
import * as D from '../src/drones.js';

const DEG = Math.PI / 180;
let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

const m = (a, b) => Math.hypot((b.lat - a.lat) * 111320,
  (b.lon - a.lon) * 111320 * Math.cos(a.lat * DEG), (b.alt || 0) - (a.alt || 0));
const brg = (a, b) => (Math.atan2((b.lon - a.lon) * 111320 * Math.cos(a.lat * DEG),
  (b.lat - a.lat) * 111320) * 180 / Math.PI + 360) % 360;

check('the constants are the generator\'s, which are blender\'s',
  FP.A_MAX === 6.5 && Math.abs(FP.DRAG_K - 0.0068111) < 1e-9 && FP.KV === 1.2
  && FP.VZ_TAU === 0.6 && FP.YAW_TAU === 0.3 && FP.ATT_TAU === 0.15
  && FP.ATT_RATE_DPS === 120 && Math.abs(FP.SIM_DT - 1 / 60) < 1e-12,
  'this integrates the same airframe as _demoFlightPath and the blender '
  + 'script, or the flown scenarios stop being the aircraft in the render');

const TOP = Math.sqrt(9.81 * Math.tan(FP.MAX_TILT) / FP.DRAG_K);

for (const [key, t] of Object.entries(D.TEMPLATES)) {
  if (!t.flyPath) continue;
  console.log(`\n${key}`);
  const A = t.waypoints, F = D.flownPath(t);

  check(`${key}: the flown path is denser than the authored one`,
    F.length > A.length * 20,
    `${A.length} authored, ${F.length} flown. The whole point is that the `
    + 'direction changes a fraction of a degree at a time.');

  check(`${key}: the duration is preserved exactly`,
    Math.abs(F[F.length - 1].tSec - A[A.length - 1].tSec) < 0.2,
    'the schedule is choreography; guidance targets each waypoint at ITS own '
    + 'tSec so a corner swung wide is made up on the next leg, never by '
    + 'arriving late');

  // ── flyable ──
  let maxV = 0, maxTurn = 0, prevB = null;
  for (let i = 1; i < F.length; i++) {
    const dt = F[i].tSec - F[i - 1].tSec;
    if (dt > 0) maxV = Math.max(maxV, m(F[i - 1], F[i]) / dt);
    const b = brg(F[i - 1], F[i]);
    if (prevB !== null) {
      let d = b - prevB; while (d > 180) d -= 360; while (d < -180) d += 360;
      maxTurn = Math.max(maxTurn, Math.abs(d));
    }
    prevB = b;
  }
  check(`${key}: never exceeds the airframe's top speed`,
    maxV <= TOP + 1.5,
    `peak ${maxV.toFixed(1)} m/s against ${TOP.toFixed(1)}. The tilt limit is `
    + 'the only thing that caps speed, so a path above it means the integration '
    + 'is being bypassed.');

  check(`${key}: turns a fraction of a degree per step, not a corner`,
    maxTurn < 5,
    `worst heading change per step is ${maxTurn.toFixed(2)} deg. The authored `
    + 'polyline is 62, which is what reads as a pivot. If this creeps up, the '
    + 'emit rate was coarsened past what the eye forgives.');

  // ── faithful ──
  const miss = FP.missReport(A, F);
  const sorted = [...miss].sort((a, b) => a.missM - b.missM);
  const median = sorted[sorted.length >> 1].missM;
  check(`${key}: still flies the authored route`,
    median < 5,
    `median miss ${median.toFixed(1)} m across ${A.length} waypoints. A `
    + 'generator that smooths beautifully while wandering off the route has '
    + 'not solved anything: these waypoints are named assets.');

  // Where it DOES drift, it must be because the template outran the airframe.
  const bad = miss.filter((x) => x.missM > 80);
  for (const b of bad) {
    const i = b.idx;
    const dt = i > 0 ? A[i].tSec - A[i - 1].tSec : 1;
    const v = i > 0 ? m(A[i - 1], A[i]) / Math.max(dt, 1e-6) : 0;
    check(`${key}: wp${i} drifts ${b.missM.toFixed(0)} m, and the leg demands ${v.toFixed(0)} m/s`,
      v > TOP,
      `wp${i} is ${b.missM.toFixed(0)} m off but the authored leg only asks `
      + `${v.toFixed(1)} m/s, which the airframe can fly. Drift without an `
      + 'excuse is a guidance bug, not an unflyable template.');
  }
}

if (failures) {
  console.log(`\ncheck:flight-path FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:flight-path passed');
