// Builds src/a320_rigid_flaps.js from the model alone:
//
//   node scripts/build_flap_manifest.mjs public/aircraft/a320_noskin.glb src/a320_rigid_flaps.js
//
// Per flap and slat part, its pose at a quarter, half, three quarters and
// all of its own travel, taken from the model's animation sampled every
// 50 ms through scripts/pose_from_animation.py. Then the piecewise blend
// the driver runs is measured against every sample and the error goes
// into the generated header.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [GLB, OUT] = process.argv.slice(2);
const pose = t => JSON.parse(execFileSync('python3', ['scripts/pose_from_animation.py', GLB, String(t)], { encoding: 'utf8', maxBuffer: 1 << 26 }));
const times = Array.from({ length: 57 }, (_, i) => +(4.6 + i * 0.05).toFixed(2));
const P = times.map(pose);
const FULL = pose(10);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const ang = q => 2 * Math.acos(Math.min(1, Math.abs(q[3])));
const qang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dot(a, b))));
function slerp(a, b, u) {
  let d = dot(a, b); let bb = b; if (d < 0) { d = -d; bb = b.map(x => -x); }
  if (d > 0.99995) { const q = a.map((x, i) => x + (bb[i] - x) * u); const n = Math.hypot(...q); return q.map(x => x / n); }
  const th = Math.acos(d), s = Math.sin(th), k0 = Math.sin((1 - u) * th) / s, k1 = Math.sin(u * th) / s;
  return a.map((x, i) => k0 * x + k1 * bb[i]);
}
const lerp = (a, b, u) => a.map((x, i) => x + (b[i] - x) * u);
const blend = (A, B, u) => ({ t: lerp(A.t, B.t, u), r: slerp(A.r, B.r, u), s: lerp(A.s, B.s, u) });
const IDENT = { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] };
const STOPS = [0.25, 0.5, 0.75, 1];
const joints = Object.keys(FULL).filter(j => /Flaps/.test(j)).sort();
const parts = [];
for (const j of joints) {
  const A = ang(FULL[j].r);
  const fr = P.map(p => ang(p[j].r) / A);
  const k = STOPS.map(st => {
    if (st === 1) return FULL[j];
    for (let i = 1; i < P.length; i++) if (fr[i - 1] <= st && fr[i] >= st) {
      const u = (st - fr[i - 1]) / (fr[i] - fr[i - 1]);
      return blend(P[i - 1][j], P[i][j], u);
    }
    throw new Error(`${j} never reaches ${st}`);
  });
  parts.push({ joint: j, nodes: FULL[j].nodes, kind: /^FrontFlaps/.test(j) ? 'slat' : 'flap', k, fr, A });
}
// Same piecewise blend the driver runs.
function poseAt(p, f) {
  if (f <= 0) return IDENT;
  const seg = Math.min(STOPS.length - 1, Math.floor(f * STOPS.length - 1e-9));
  const lo = seg === 0 ? IDENT : p.k[seg - 1], loF = seg === 0 ? 0 : STOPS[seg - 1];
  return blend(lo, p.k[seg], (f - loF) / (STOPS[seg] - loF));
}
let wt = 0, wr = 0, wj = '';
let lt = 0;
for (const p of parts) P.forEach((s, i) => {
  const f = Math.max(0, Math.min(1, p.fr[i]));
  const m = poseAt(p, f), x = s[p.joint];
  const dt = Math.hypot(...m.t.map((v, k) => v - x.t[k])), dr = qang(m.r, x.r) * 180 / Math.PI;
  if (dt > wt) { wt = dt; wj = `${p.joint}@${times[i]}`; } wr = Math.max(wr, dr);
  // and the straight blend, for comparison
  const l = blend(IDENT, FULL[p.joint], f);
  lt = Math.max(lt, Math.hypot(...l.t.map((v, k) => v - x.t[k])));
});
console.error(`quarter stops: worst ${(wt * 1000).toFixed(1)} mm (${wj}), ${wr.toFixed(2)} deg. straight blend was ${(lt * 1000).toFixed(1)} mm`);
const f5 = a => a.map(x => x.toFixed(5)).join(', ');
const f6 = a => a.map(x => x.toFixed(6)).join(', ');
let out = `// GENERATED from public/aircraft/a320_noskin.glb. Do not edit.
//
// Slats (FrontFlaps*) and flaps (BackFlaps*), each as the delta from its
// bind pose, which is the clean wing, to the model's own animation at a
// quarter, half, three quarters and all of that part's travel. The model
// moves them between about 4.8 and 7.0 s of its single animation and
// holds them out from there, so "all" is taken at 10 s.
//
// Why four stops and not one. A straight blend from clean to fully out
// is right for the parts that turn about their own hinge, but the outer
// segments also travel with the inner one, and a straight line cuts the
// corner of that arc by up to 6 cm at mid travel. Through four stops the
// worst error against the animation sampled every 50 ms is
// ${(wt * 1000).toFixed(1)} mm and ${wr.toFixed(2)} degrees.
//
// Made by scripts/build_flap_manifest.mjs through scripts/pose_from_animation.py,
// the method that reproduces a320_rigid_gearup.js and a320_rigid_brakes.js
// to 0.01 mm and 0.12 deg.
export const FLAP_STOPS = [${STOPS.join(', ')}];
export const FLAPS_OUT = [
`;
for (const p of parts) {
  out += `  { joint: '${p.joint}', kind: '${p.kind}', nodes: ${JSON.stringify(p.nodes)}, k: [\n`;
  for (const q of p.k) out += `    { t: [${f5(q.t)}], r: [${f6(q.r)}], s: [${f5(q.s)}] },\n`;
  out += `  ] },\n`;
}
out += '];\n';
fs.writeFileSync(OUT, out);
console.error('wrote', parts.length, 'parts,', parts.reduce((n, p) => n + p.nodes.length, 0), 'nodes,', out.length, 'bytes');
