// ═══════════════════════════════════════════════════════════════════
// Collapse the DJI Air 3's node tree without moving a single vertex
// ───────────────────────────────────────────────────────────────────
// WHY. The asset arrived as 702 nodes and 341 primitives. The gun drone
// it replaced is 10 and 6. Cesium pays for both every frame, on the CPU,
// whether or not the GPU is busy:
//
//   Model.updateSceneGraph takes the updateModelMatrix branch
//   unconditionally for any model with a minimumPixelSize, which every
//   drone here has. That marks the root dirty, and
//   ModelMatrixUpdateStage recurses the WHOLE subtree, allocating a
//   fresh Matrix4 per node per frame and doing a matrix multiply plus a
//   determinant per primitive.
//
// Five drones in a formation, before: 3,510 node recursions and Matrix4
// allocations per frame, 1,705 draw commands. After: 30 and 55.
//
// Triangles were never the problem. 60,305 x 5 is nothing on any GPU
// made this decade, which is why cutting 311k to 60k barely moved the
// frame time.
//
// ── WHAT THIS DOES NOT TOUCH, AND WHY EACH ONE MATTERS ────────────
//
// NODE 0, `Sketchfab_model`, is kept bit-identical. It carries a -90
// degree rotation about X, the Z-up to Y-up swap, and that rotation is
// the ONLY thing giving each Rotor_n its local frame. main.js spins the
// rotors about their local Z. Under node 0 that local Z points at world
// +Y, which is up, so the disc turns about its motor. Drop node 0 and
// local Z becomes world Z, which is the nose axis: the propellers would
// cartwheel edge-over-edge vertically through the airframe.
//
// That error is invisible to every static check. Hub positions do not
// move, the nose axis does not move, the extents do not move, and a
// still frame looks correct. It is only wrong while spinning, which is
// always. See the swept-spin assertion in check-dji-air-3.mjs.
//
// THE FOUR Rotor_n TRANSLATIONS are kept bit-identical for the same
// reason, and because src/main.js hardcodes their composed world
// positions in _QUAD_ROTOR_HUBS to drive the rotor differential.
//
// THE THREE GLASS PRIMITIVES are left unmerged. GLASS.001 is alphaMode
// BLEND and Cesium depth-sorts translucent COMMANDS; collapsing three
// into one replaces that sort with fixed index order. Two draw calls
// out of 341 is not worth an irreversible change to how the canopy
// blends.
//
// ── WHAT IT DOES CHANGE, DELIBERATELY ─────────────────────────────
//
// TEXCOORD_2 is dropped. No material references texCoord 2. It sits on
// 53,704 vertices at 8 bytes each: 420 KB of buffer and 8 of the 48
// bytes of vertex stride, for nothing.
//
// Cesium's bounding sphere gets BIGGER, and that is a real visual
// change that has to be compensated. ModelSceneGraph builds the model
// bound by transforming only the min and max CORNER of each primitive's
// local box. Under rotation that under-covers, and how badly depends on
// how the geometry happens to be split. Today it reads radius 2.7622
// against a true 2.9487. After baking, each primitive's box is already
// axis-aligned, so Cesium gets the right answer and the radius grows
// 6.75 percent. minimumPixelSize scales by 1 / (2 * radius), so the
// drone would render 6.3 percent SMALLER. _qT.swarmMinimumPixelSize is
// raised from 14 to 15 in the same change to hold the size Lucas signed
// three scenarios off against.
//
// ── WHY THE LIBRARY AND NOT HAND-ROLLED PACKING ───────────────────
//
// transformPrimitive applies the true inverse-transpose to NORMAL and
// renormalises, which a hand-rolled version forgets: a raw 0.01-scale
// matrix leaves normals at length 0.01. It also reverses winding on a
// negative determinant and handles morph targets. joinPrimitives sizes
// the output index buffer from the vertex count, so the u16 to u32
// promotion happens on its own rather than wrapping silently. The body
// merge lands at 52,742 vertices, which fits u16 with 12,793 to spare,
// by luck rather than design.
//
// ALL_EXTENSIONS is registered because it has to be. An unregistered
// name in extensionsUsed is only a WARNING in @gltf-transform, and the
// data is then dropped on write. This asset carries KHR_texture_transform
// with offset [0,-1] on materials 1 and 3; losing it shifts those UVs by
// a full tile and the camera housing renders wrong.
//
//   node scripts/merge_dji_air_3.mjs <in.glb> <out.glb>
// ═══════════════════════════════════════════════════════════════════
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformPrimitive, joinPrimitives, prune, dedup } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) {
  console.error('usage: node merge_dji_air_3.mjs <in.glb> <out.glb>');
  process.exit(1);
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });

const doc = await io.read(IN);
const root = doc.getRoot();
const scene = root.listScenes()[0];

// ── the two kinds of node we must not disturb ──────────────────────
const sceneRoots = scene.listChildren();
if (sceneRoots.length !== 1) throw new Error(`expected one scene root, found ${sceneRoots.length}`);
const KEEP_ROOT = sceneRoots[0];                       // Sketchfab_model
const ROTOR_NAMES = ['Rotor_1', 'Rotor_2', 'Rotor_3', 'Rotor_4'];

/** Multiply a parent world matrix by a node's local matrix. */
function mul(a, b) {
  const o = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}
function inverse(m) {
  // General 4x4 inverse. These matrices are affine, but a rotation plus
  // a scale plus a translation is not worth special-casing wrongly.
  const inv = new Array(16);
  inv[0] = m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
  inv[4] = -m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
  inv[8] = m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
  inv[1] = -m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
  inv[5] = m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
  inv[9] = -m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
  inv[13] = m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
  inv[2] = m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
  inv[6] = -m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
  inv[10] = m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
  inv[3] = -m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
  inv[7] = m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
  inv[15] = m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
  let det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
  if (!det) throw new Error('singular matrix');
  det = 1 / det;
  return inv.map(v => v * det);
}

// ── walk the tree, recording every mesh primitive with the matrix that
//    takes it into the frame of the node we are going to keep ────────
const buckets = new Map();   // key -> { parent: Node, prims: [{prim, matrix}] }
const toDelete = [];

function bucketKeyFor(prim, rotorName) {
  if (rotorName) return `rotor:${rotorName}`;
  const mat = prim.getMaterial();
  const name = mat ? mat.getName() : '(none)';
  // Each glass primitive keeps its own bucket: Cesium depth-sorts
  // translucent commands and merging them replaces that with index
  // order.
  if (mat && mat.getAlphaMode() === 'BLEND' && name === 'GLASS.001') {
    return `glass:${prim.listParents().map(p => p.getName()).join('|')}`;
  }
  return `mat:${name}`;
}

function walk(node, parentMatrix, rotorName, keptParentMatrix) {
  const local = node.getMatrix();
  const world = mul(parentMatrix, local);
  const isRotor = ROTOR_NAMES.includes(node.getName());
  const rn = isRotor ? node.getName() : rotorName;
  // The frame we bake INTO: the kept node's own frame.
  const keptM = isRotor ? world : keptParentMatrix;

  const mesh = node.getMesh();
  if (mesh) {
    const toKept = mul(inverse(keptM), world);
    for (const prim of mesh.listPrimitives()) {
      const key = bucketKeyFor(prim, rn);
      if (!buckets.has(key)) {
        buckets.set(key, { rotorName: rn, prims: [] });
      }
      buckets.get(key).prims.push({ prim, matrix: toKept, mesh });
    }
    if (node !== KEEP_ROOT && !isRotor) toDelete.push(node);
  } else if (node !== KEEP_ROOT && !isRotor) {
    toDelete.push(node);
  }

  for (const child of node.listChildren()) walk(child, world, rn, keptM);
}

const rootMatrix = KEEP_ROOT.getMatrix();
for (const child of KEEP_ROOT.listChildren()) {
  walk(child, rootMatrix, null, rootMatrix);
}

console.log(`buckets: ${buckets.size}`);

// ── bake, then join each bucket ────────────────────────────────────
const rotorNodes = new Map();
(function findRotors(node) {
  if (ROTOR_NAMES.includes(node.getName())) rotorNodes.set(node.getName(), node);
  for (const c of node.listChildren()) findRotors(c);
})(KEEP_ROOT);
if (rotorNodes.size !== 4) throw new Error(`expected 4 rotor nodes, found ${rotorNodes.size}`);

const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const isIdentity = (m) => m.every((v, i) => Math.abs(v - IDENT[i]) < 1e-12);

const bodyMesh = doc.createMesh('Body');
const bodyNode = doc.createNode('Body').setMesh(bodyMesh);

for (const [key, bucket] of buckets) {
  const prims = [];
  for (const { prim, matrix } of bucket.prims) {
    if (!isIdentity(matrix)) transformPrimitive(prim, matrix);
    // TEXCOORD_2 is referenced by no material.
    if (prim.getAttribute('TEXCOORD_2')) prim.setAttribute('TEXCOORD_2', null);
    prims.push(prim);
  }
  const joined = prims.length === 1 ? prims[0] : joinPrimitives(prims);
  if (bucket.rotorName) {
    const rm = doc.createMesh(bucket.rotorName + '_blades');
    rm.addPrimitive(joined);
    rotorNodes.get(bucket.rotorName).setMesh(rm);
  } else {
    bodyMesh.addPrimitive(joined);
  }
}

KEEP_ROOT.addChild(bodyNode);

// RE-PARENT THE ROTORS BEFORE DELETING ANYTHING.
//
// Rotor_n are grandchildren of node 0, under an intermediate `root`
// node. Deleting that intermediate takes its whole subtree with it,
// which is how the first run produced 2 nodes and lost all four
// rotors. They are lifted onto node 0 first.
//
// That is only safe because every node between node 0 and a Rotor_n is
// the identity, so the lift cannot move them. Asserted, not assumed: if
// a future asset puts a transform in that chain, this throws rather
// than silently relocating the propellers.
for (const [name, rn] of rotorNodes) {
  let chain = IDENT.slice();
  let p = rn.getParentNode();
  while (p && p !== KEEP_ROOT) {
    chain = mul(p.getMatrix(), chain);
    p = p.getParentNode();
  }
  if (!p) throw new Error(`${name} is not under the kept root`);
  if (!isIdentity(chain)) {
    throw new Error(`${name} sits under a non-identity chain; lifting it would move it`);
  }
  rn.getParentNode().removeChild(rn);
  KEEP_ROOT.addChild(rn);
}

for (const n of toDelete) {
  n.setMesh(null);
  if (n.getParentNode()) n.getParentNode().removeChild(n);
  n.dispose();
}

await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const after = await io.read(OUT);
const nodes = after.getRoot().listNodes().length;
const prims = after.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);
console.log(`wrote ${OUT}: ${nodes} nodes, ${prims} primitives`);
