// ═══════════════════════════════════════════════════════════════════
// check:dji-air-3 — the merged asset is the same aircraft
// ───────────────────────────────────────────────────────────────────
// scripts/merge_dji_air_3.mjs collapses 702 nodes and 341 primitives
// into 6 and 11 by baking node transforms into vertices. Nothing may
// move. These assertions exist because a review found that the obvious
// checks all PASS on an asset whose propellers spin about the wrong
// axis:
//
//   hub positions       unchanged
//   nose axis           unchanged
//   extents at rest     unchanged
//   a still frame       looks correct
//
// and it is wrong on every frame it is animated, because the error
// lives in the ROTOR'S LOCAL FRAME, which only matters once something
// rotates about it. The swept-spin assertion below is the one that
// catches it.
//
// Usage:  node scripts/check-dji-air-3.mjs [reference.glb]
// Without a reference it checks the shipped asset's invariants alone.
// With one it additionally asserts a point-set identity against it.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}`);
  if (why) console.log(`       ${why}`);
};

// ── minimal glTF reader, so this gate needs no dependencies ────────
function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2],
               5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor(g, i) {
  const a = g.json.accessors[i];
  const [Arr, sz] = COMP[a.componentType];
  const n = NUM[a.type];
  const bv = g.json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || n * sz;
  const out = new Float64Array(a.count * n);
  for (let e = 0; e < a.count; e++) {
    const view = new Arr(g.bin.buffer, g.bin.byteOffset + base + e * stride, n);
    for (let c = 0; c < n; c++) out[e * n + c] = view[c];
  }
  return { data: out, count: a.count, n };
}

function mul(a, b) {
  const o = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const rm = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1];
  const sm = [s[0],0,0,0, 0,s[1],0,0, 0,0,s[2],0, 0,0,0,1];
  const tm = [1,0,0,0, 0,1,0,0, 0,0,1,0, t[0],t[1],t[2],1];
  return mul(tm, mul(rm, sm));
}
const xform = (m, v) => [
  m[0]*v[0] + m[4]*v[1] + m[8]*v[2] + m[12],
  m[1]*v[0] + m[5]*v[1] + m[9]*v[2] + m[13],
  m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14]];
const xdir = (m, v) => [
  m[0]*v[0] + m[4]*v[1] + m[8]*v[2],
  m[1]*v[0] + m[5]*v[1] + m[9]*v[2],
  m[2]*v[0] + m[6]*v[1] + m[10]*v[2]];

/** Every drawn vertex in world space, plus per-node bookkeeping. */
function survey(path) {
  const g = readGlb(path);
  const nodes = g.json.nodes;
  const pts = [];
  const rotors = {};          // name -> { world, local, parentChain, verts }
  let prims = 0, tris = 0;
  const walk = (i, parent) => {
    const n = nodes[i];
    const m = mul(parent, nodeMatrix(n));
    const rotorName = /^Rotor_\d$/.test(n.name || '') ? n.name : null;
    if (rotorName) rotors[rotorName] = { world: m, parentChain: parent, verts: [] };
    if (n.mesh != null) {
      for (const pr of g.json.meshes[n.mesh].primitives) {
        prims++;
        const pos = accessor(g, pr.attributes.POSITION);
        const idx = pr.indices != null ? accessor(g, pr.indices) : null;
        tris += (idx ? idx.count : pos.count) / 3;
        for (let v = 0; v < pos.count; v++) {
          const w = xform(m, [pos.data[v*3], pos.data[v*3+1], pos.data[v*3+2]]);
          pts.push(w);
          if (rotorName) rotors[rotorName].verts.push(
            [pos.data[v*3], pos.data[v*3+1], pos.data[v*3+2]]);
        }
      }
    }
    for (const c of (n.children || [])) walk(c, m);
  };
  for (const r of g.json.scenes[g.json.scene || 0].nodes) walk(r, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  return { g, pts, rotors, prims, tris, nodes: nodes.length };
}

const ASSET = new URL('../public/aircraft/dji_air_3.glb', import.meta.url).pathname;
const REF = process.argv[2];
const a = survey(ASSET);

console.log(`Merged asset: ${a.nodes} nodes, ${a.prims} primitives, ${a.tris.toLocaleString()} triangles`);
console.log('');
console.log('The rotor frame, which is the thing a still frame cannot show');

// ── 1. THE SPIN AXIS, IN WORLD SPACE ───────────────────────────────
// main.js rotates each Rotor_n about its LOCAL Z. That local Z has to
// point at world up, or the disc cartwheels about the nose axis.
for (const name of ['Rotor_1', 'Rotor_2', 'Rotor_3', 'Rotor_4']) {
  const r = a.rotors[name];
  if (!r) { check(`${name} exists`, false, 'the node is gone; main.js drives it by name'); continue; }
  const z = xdir(r.world, [0, 0, 1]);
  const len = Math.hypot(...z);
  const unit = z.map(v => v / len);
  const up = Math.abs(unit[1]);
  check(`${name} local Z points at world up`,
    up > 0.9999,
    `it points (${unit.map(v => v.toFixed(4)).join(', ')}). The spin axis must be world `
    + 'up or the propeller turns edge-over-edge through the airframe. This is the '
    + 'assertion that catches a dropped root rotation, and NOTHING else does.');
}

// ── 2. SWEPT SPIN ──────────────────────────────────────────────────
// Rotate the blades the way Cesium will and assert they stay in their
// own plane. A rest-pose check cannot see an axis error; this can.
for (const name of ['Rotor_1', 'Rotor_2', 'Rotor_3', 'Rotor_4']) {
  const r = a.rotors[name];
  if (!r || !r.verts.length) continue;
  let worst = 0;
  const base = r.verts.map(v => xform(r.world, v));
  const upAt = base.map(p => p[1]);
  for (const deg of [45, 90, 135, 180, 270]) {
    const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    const spin = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const m = mul(r.world, spin);
    r.verts.forEach((v, i) => {
      const p = xform(m, v);
      worst = Math.max(worst, Math.abs(p[1] - upAt[i]));
    });
  }
  check(`${name} stays in its own plane through a full turn`,
    worst < 1e-6,
    `a vertex moved ${worst.toFixed(4)} m vertically while spinning. The disc is `
    + 'turning about the wrong axis.');
}

// ── 3. DISC THINNESS IN THE LOCAL FRAME ────────────────────────────
const THIN = { Rotor_1: 0.1245, Rotor_2: 0.1926, Rotor_3: 0.1222, Rotor_4: 0.2242 };
for (const [name, expect] of Object.entries(THIN)) {
  const r = a.rotors[name];
  if (!r || !r.verts.length) continue;
  const ext = [0, 1, 2].map(k => {
    const vals = r.verts.map(v => v[k]);
    return Math.max(...vals) - Math.min(...vals);
  });
  const thinAxis = ext.indexOf(Math.min(...ext));
  check(`${name} is still thin in LOCAL Z, ${ext[2].toFixed(4)} m`,
    thinAxis === 2 && Math.abs(ext[2] - expect) < 1e-3,
    `thin axis is ${'XYZ'[thinAxis]} at ${ext[thinAxis].toFixed(4)}, expected Z at ${expect}`);
}

// ── 4. THE HUBS src/main.js HARDCODES ──────────────────────────────
console.log('');
console.log('The values src/main.js depends on');
// READ OUT OF src/main.js, not copied. check-quad-flight.mjs held these
// as a literal and never opened the GLB, so it validated its own copy
// and would have passed a broken asset. This reads the real table and
// compares it to the real file.
const HUBS = (() => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  // Up to the DOUBLE close bracket. A lazy match to the first `],`
  // stops inside the array after the first triple and silently reads
  // three of the twelve numbers, which fails three of four rotors.
  const m = /dji_air_3: \{\s*hubs: \[([\s\S]*?)\]\],/.exec(main);
  if (!m) throw new Error('could not find _QUAD_ROTOR_HUBS.dji_air_3 in src/main.js');
  const nums = (m[1] + ']').match(/-?\d+\.?\d*/g).map(Number);
  const out = {};
  ['Rotor_1', 'Rotor_2', 'Rotor_3', 'Rotor_4'].forEach((n, i) => {
    out[n] = nums.slice(i * 3, i * 3 + 3);
  });
  return out;
})();
for (const [name, want] of Object.entries(HUBS)) {
  const r = a.rotors[name];
  if (!r) continue;
  const got = xform(r.world, [0, 0, 0]);
  const d = Math.max(...got.map((v, i) => Math.abs(v - want[i])));
  check(`${name} hub is where _QUAD_ROTOR_HUBS says`,
    d < 1e-3,
    `got (${got.map(v => v.toFixed(4)).join(', ')}), main.js has (${want.join(', ')}). `
    + 'These drive the flight model rotor differential.');
}

// ── 5. THE FILE'S OWN INVARIANTS ───────────────────────────────────
console.log('');
console.log('The asset');
const used = a.g.json.extensionsUsed || [];
check('the glTF extensions survived the rewrite',
  ['EXT_texture_webp', 'KHR_materials_specular', 'KHR_texture_transform'].every(e => used.includes(e)),
  `extensionsUsed is [${used.join(', ')}]. An unregistered extension is only a WARNING `
  + 'in gltf-transform and the data is dropped on write; KHR_texture_transform carries a '
  + 'full-tile UV offset on two materials.');

const mats = a.g.json.materials || [];
check('all five materials are intact, with their alpha modes',
  mats.length === 5
  && mats.filter(m => (m.alphaMode || 'OPAQUE') === 'BLEND').length === 2,
  `found ${mats.length} materials, ${mats.filter(m => m.alphaMode === 'BLEND').length} blended`);

check('the three glass primitives were NOT merged',
  (() => {
    const glass = mats.findIndex(m => (m.name || '').startsWith('GLASS'));
    if (glass < 0) return false;
    let n = 0;
    for (const m of a.g.json.meshes) for (const p of m.primitives) if (p.material === glass) n++;
    return n === 3;
  })(),
  'Cesium depth-sorts translucent COMMANDS. Collapsing three into one replaces that '
  + 'sort with fixed index order, which is an irreversible change to how the canopy blends.');

check('every index accessor is wide enough for its primitive',
  (() => {
    for (const m of a.g.json.meshes) for (const p of m.primitives) {
      if (p.indices == null) continue;
      const verts = a.g.json.accessors[p.attributes.POSITION].count;
      const ct = a.g.json.accessors[p.indices].componentType;
      if (verts > 65535 && ct !== 5125) return false;
    }
    return true;
  })(),
  'a merged primitive past 65535 vertices on 16-bit indices wraps silently');

check('TEXCOORD_2 is gone, since no material reads it',
  (() => {
    for (const m of a.g.json.meshes) for (const p of m.primitives) {
      if (p.attributes.TEXCOORD_2 != null) return false;
    }
    return true;
  })(),
  '8 of 48 bytes of vertex stride for an unused UV set');

// ── CESIUM'S OWN BOUNDING SPHERE, WHICH SETS APPARENT SIZE ─────────
//
// ModelSceneGraph builds the model bound by transforming only the MIN
// and MAX corner of each primitive's local box. Under rotation that is
// wrong, and how wrong depends on how the geometry is split into
// primitives, so a merge changes it. minimumPixelSize scales by
// 1 / (2 * radius), so a change here changes how big the drone looks
// whenever the pixel floor binds, which is at every range these are
// drawn at.
//
// Measured across this merge: 3.0246 to 2.9487, so the drone renders
// 2.6 percent LARGER. On a 14 px floor that is 0.36 of a pixel and
// needs no compensation. A future asset change that moves it further
// must be a deliberate decision, with _qT.swarmMinimumPixelSize
// adjusted to match, not a surprise on screen.
const CESIUM_RADIUS = 2.9487;
check(`Cesium's bounding sphere radius is ${CESIUM_RADIUS}`,
  (() => {
    let lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18];
    const nodes = a.g.json.nodes;
    const walk = (i, par) => {
      const n = nodes[i];
      const m = mul(par, nodeMatrix(n));
      if (n.mesh != null) {
        for (const pr of a.g.json.meshes[n.mesh].primitives) {
          const acc = a.g.json.accessors[pr.attributes.POSITION];
          if (!acc.min) continue;
          for (const corner of [acc.min, acc.max]) {
            const w = xform(m, corner);
            for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
          }
        }
      }
      for (const c of (n.children || [])) walk(c, m);
    };
    for (const r of a.g.json.scenes[a.g.json.scene || 0].nodes)
      walk(r, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    const d = [0,1,2].map(k => hi[k] - lo[k]);
    const radius = Math.hypot(...d) / 2;
    return Math.abs(radius - CESIUM_RADIUS) < 0.01;
  })(),
  'if this moved, the drone changed size on screen. Decide it deliberately and '
  + 'adjust _qT.swarmMinimumPixelSize, do not discover it in a run.');

check('the node count is down to the gun drone budget',
  a.nodes <= 12 && a.prims <= 16,
  `${a.nodes} nodes and ${a.prims} primitives. Cesium recurses every node and allocates a `
  + 'Matrix4 per node per frame for any model with a minimumPixelSize, which these have.');

// ── 6. AGAINST A REFERENCE, IF GIVEN ───────────────────────────────
if (REF) {
  console.log('');
  console.log(`Against ${REF}`);
  const b = survey(REF);
  check('the triangle count is unchanged',
    a.tris === b.tris, `${a.tris} against ${b.tris}`);
  // NEAREST NEIGHBOUR, NOT STRING EQUALITY.
  //
  // Baking a transform into float32 vertices rounds in the last bits.
  // Measured here, the worst vertex moves 7.8e-8 m, which is 78
  // nanometres on a 1.16 m aircraft. An exact key comparison calls that
  // a failure the moment a point sits on a rounding bucket boundary:
  // it reported 44 of 55,387 "moved" when not one of them had.
  //
  // A distance tolerance is the honest test, and 1e-5 m is four orders
  // of magnitude tighter than anything that could be seen while still
  // being far above float32 noise.
  const TOL = 1e-5;
  check(`every drawn vertex is within ${TOL} m of where it was`,
    (() => {
      if (a.pts.length !== b.pts.length) return false;
      const cell = 0.01;
      const grid = new Map();
      for (const p of b.pts) {
        const k = p.map(v => Math.round(v / cell)).join(',');
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(p);
      }
      for (const p of a.pts) {
        const c = p.map(v => Math.round(v / cell));
        let best = Infinity;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          for (const q of (grid.get([c[0]+dx, c[1]+dy, c[2]+dz].join(',')) || [])) {
            const d = Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]);
            if (d < best) best = d;
          }
        }
        if (best > TOL) return false;
      }
      return true;
    })(),
    `${a.pts.length} points against ${b.pts.length}. A point-set identity is `
    + 'method-independent, unlike an extent, which depends on whether you transform '
    + '2 corners or 8 and changes by 10 percent after baking with nothing moved.');
}

if (failures) {
  console.log(`\ncheck:dji-air-3 FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:dji-air-3 passed');
