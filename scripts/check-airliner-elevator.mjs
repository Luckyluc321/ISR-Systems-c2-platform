// ═══════════════════════════════════════════════════════════════════
// check:airliner-elevator — the tail moves when the nose does
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-24, asked for the flaps in the tail to work. I told him
// the model had none. It has two, named BackAileron, at the tail. This
// gate holds what was measured before they were wired: the parts are
// where elevators are, the driver's "up" lifts the trailing edge on the
// real vertices, and the logic moves them with the pitch rate, neutral
// when the nose is steady and on the ground, inside limits and a slew.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { RIGID_PARTS } from '../src/a320_rigid_gearup.js';
import { createElevator, ELEVATOR_CFG } from '../src/airliner_elevator.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

// ── glTF, read directly ──────────────────────────────────────────────
const glb = readFileSync(new URL('../public/aircraft/a320_noskin.glb', import.meta.url));
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const parent = new Map();
gltf.nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
// Column-major 4x4, as glTF stores it.
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const trs = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
    (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
    (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};
const local = n => n.matrix ? n.matrix.slice() : trs(n.translation, n.rotation, n.scale);
const world = i => { let m = local(gltf.nodes[i]); while (parent.has(i)) { i = parent.get(i); m = mul(local(gltf.nodes[i]), m); } return m; };
const apply = (m, v) => [0, 1, 2].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
const verts = i => {
  const out = [];
  for (const p of gltf.meshes[gltf.nodes[i].mesh].primitives) {
    const a = gltf.accessors[p.attributes.POSITION], bv = gltf.bufferViews[a.bufferView];
    const off = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || 12;
    for (let k = 0; k < a.count; k++) out.push([0, 4, 8].map(d => glb.readFloatLE(off + k * stride + d)));
  }
  return out;
};
// The driver's rotation for a deflection, exactly as written:
// fromAxisAngle(UNIT_X, -deg) for trailing edge up.
const elevatorDelta = upDeg => {
  const h = -upDeg * Math.PI / 360;
  return trs([0, 0, 0], [Math.sin(h), 0, 0, Math.cos(h)], [1, 1, 1]);
};

console.log('\n[the parts]');
const parts = RIGID_PARTS.filter(p => /^BackAileron/.test(p.joint));
const nodeNames = parts.flatMap(p => p.nodes);
check('two elevator joints, left and right', parts.length === 2
  && parts.some(p => /\.L_/.test(p.joint)) && parts.some(p => /\.R_/.test(p.joint)));
const idx = new Map(gltf.nodes.map((n, i) => [n.name, i]));
const missing = nodeNames.filter(n => !idx.has(n));
check(`all ${nodeNames.length} elevator nodes exist in a320_noskin.glb`, !missing.length, missing.join(', '));
check('no elevator node is gear', !nodeNames.some(n => /wheel|gear|wheeldoor/i.test(n)));

console.log('\n[where they are, and which way is up, on the real vertices]');
for (const name of nodeNames) {
  const i = idx.get(name); if (i === undefined) continue;
  const W = world(i), V = verts(i);
  const w0 = V.map(v => apply(W, v));
  const zs = w0.map(p => p[2]), xs = w0.map(p => Math.abs(p[0]));
  // Nose is -Z, so the tail is high Z. The fuselage runs about -18 to +19.6.
  check(`${name}: at the tail, 17 to 19 m aft, inside 4 m of the centreline`,
    Math.min(...zs) > 16 && Math.max(...zs) < 19.5 && Math.max(...xs) < 4.2,
    `z ${Math.min(...zs).toFixed(2)}..${Math.max(...zs).toFixed(2)}, |x| up to ${Math.max(...xs).toFixed(2)}`);
  const W1 = mul(W, elevatorDelta(10));
  const w1 = V.map(v => apply(W1, v));
  const aft = zs.indexOf(Math.max(...zs));
  const rise = w1[aft][1] - w0[aft][1];
  check(`${name}: 10 degrees up lifts the trailing edge`, rise > 0.05, `trailing edge moves ${rise.toFixed(3)} m in height`);
  const fwd = zs.indexOf(Math.min(...zs));
  const hingeMove = Math.hypot(...[0, 1, 2].map(k => w1[fwd][k] - w0[fwd][k]));
  check(`${name}: the hinge side stays put`, hingeMove < 0.05, `front edge moves ${hingeMove.toFixed(3)} m`);
}

console.log('\n[the logic]');
const DEG = Math.PI / 180;
const C = ELEVATOR_CFG;
// Run a pitch trace (deg) and a height trace (m), both functions of
// seconds, through a fresh elevator.
const run = (pitchAt, seconds, { agl = () => 500, on = () => true, dt = 0.05 } = {}) => {
  const e = createElevator(); const out = [];
  for (let i = 0; i * dt <= seconds + 1e-9; i++) { const t = i * dt; out.push({ t, d: e.step(pitchAt(t) * DEG, agl(t), t * 1000, on(t)) }); }
  return out;
};
const S = C.settleS;
const peak = tr => Math.max(...tr.map(s => s.d));
{
  check('nose steady: neutral', run(() => 4, 20).every(s => s.d === 0));
}
{
  // The rig's nose wanders a degree or two in the climb out; that must not move the tail.
  const tr = run(t => 16 + 1 * Math.sin(t * 2 * Math.PI / 3), 30);
  check('a 1 degree wander on a 3 s period: neutral', tr.every(s => s.d === 0), `peak ${peak(tr).toFixed(1)}`);
}
{
  const tr = run(t => (t < S + 2 ? 4 : Math.min(16, 4 + 3 * (t - S - 2))), S + 12);
  check('go-around rotation at 3 deg/s: trailing edge up 8 to 15', peak(tr) >= 8 && peak(tr) <= C.maxUpDeg, `peak ${peak(tr).toFixed(1)}`);
  check('and back near neutral once the nose has stopped', Math.abs(tr[tr.length - 1].d) < 0.5, `ends at ${tr[tr.length - 1].d.toFixed(2)}`);
}
{
  const tr = run(t => (t < S + 2 ? 16 : Math.max(4, 16 - 6 * (t - S - 2))), S + 6);
  const low = Math.min(...tr.map(s => s.d));
  check(`a steep nose-down: trailing edge down, no more than ${C.maxDownDeg}`, low < 0 && low >= -C.maxDownDeg, `lowest ${low.toFixed(1)}`);
}
{
  // Flare: steady nose, descending through the last 15 m to the runway at 1.5 m/s, then rolling out.
  const T0 = S + 5;
  const agl = t => (t < T0 ? 30 - (t / T0) * 15 : Math.max(0, 15 - 1.5 * (t - T0)));
  const tr = run(() => 4, T0 + 20, { agl });
  const td = T0 + 10;
  const atTd = tr.find(s => s.t >= td - 0.7).d;
  check(`the flare: about ${C.flareUpDeg} up as the wheels reach the runway`, atTd > C.flareUpDeg * 0.7 && atTd <= C.flareUpDeg, `${atTd.toFixed(1)}`);
  check('nothing before the flare starts', tr.filter(s => s.t < T0 - 0.1).every(s => s.d === 0));
  let fastest = 0;
  for (let i = 1; i < tr.length; i++) if (tr[i].t > td + 0.1) fastest = Math.max(fastest, Math.abs(tr[i].d - tr[i - 1].d) / 0.05);
  check(`on the runway: eases back no faster than ${C.groundRelaxDegS} deg/s`, fastest <= C.groundRelaxDegS + 1e-6, `${fastest.toFixed(2)} deg/s`);
  check('and comes to rest at neutral', tr[tr.length - 1].d === 0, `${tr[tr.length - 1].d}`);
}
{
  // A go-around never flares: the height is climbing, not descending.
  const tr = run(() => 10, S + 10, { agl: t => 5 + t });
  check('climbing at low height: no flare', tr.every(s => s.d === 0));
}
{
  const tr = run(t => 4 + 3 * t, S - 0.1);
  check(`the first ${S} s after a track appears: neutral whatever the rig does`, tr.every(s => s.d === 0));
}
{
  const tr = run(t => (t < S + 2 ? 4 : 4 + 3 * (t - S - 2)), S + 8, { on: t => t < S + 4 });
  check('switch off: neutral at once', tr.filter(s => s.t >= S + 4).every(s => s.d === 0));
}
{
  const tr = run(t => (t < S + 2 ? 0 : 30 * Math.sign(Math.sin(t * 3))), S + 10);
  let worst = 0;
  for (let i = 1; i < tr.length; i++) worst = Math.max(worst, Math.abs(tr[i].d - tr[i - 1].d) / 0.05);
  check(`never moves faster than ${C.slewDegS} deg/s`, worst <= C.slewDegS + 1e-6, `${worst.toFixed(1)} deg/s`);
}
{
  const e = createElevator();
  e.step(0.05, 500, 0); const d = e.step(NaN, 500, 50);
  check('no pitch: holds where it is', d === 0);
}

console.log('\n[the wiring]');
const surf = readFileSync(new URL('../src/airliner_surfaces.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('the driver writes trailing edge up as a negative turn about local X',
  /fromAxisAngle\(Cesium\.Cartesian3\.UNIT_X,\s*-\(pose\.elevator \|\| 0\)/.test(surf));
check('the driver steps the elevator with pitch, height and the switch', /elevator\.step\(pitchRad, aglM, now, elevatorOn\(\)\)/.test(surf));
check('the tick passes the drawn pitch', /_gear\.update\(state\.billboard, p\.alt, state\.stateHolder\?\.attitude\?\.pitch\)/.test(main));
check('main.js reads the switch from __isr_airliner_tuning.elevator',
  /elevatorOn:\s*\(\)\s*=>\s*\(window\.__isr_airliner_tuning \|\| \{\}\)\.elevator \?\? true/.test(main));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
