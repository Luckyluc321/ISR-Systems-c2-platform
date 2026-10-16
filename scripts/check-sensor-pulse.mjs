// Gate: the sensor dot and its pulse ring stay one mark, and the ring
// stays drawable.
//
// WHY THIS EXISTS. Two separate defects kept being mistaken for each
// other across four commits in one afternoon, and neither is visible to
// any other gate because both are silent at runtime.
//
//   1. THE RING LEAVES ITS DOT. Two marks only stay concentric at every
//      camera angle if they are the same graphics type, resolve their
//      height through the same expression, and are occluded by the same
//      rule. Drop any one of those three and the pair comes apart with
//      camera tilt while both positions stay correct, which reads as a
//      coordinate fault and is not one.
//
//   2. THE RING DRAWS NOTHING. An entity `point` with a heightReference
//      is not a PointPrimitive: Cesium's PointVisualizer renders it as a
//      Billboard and bakes the mark into a canvas, cached in the
//      collection's texture atlas under
//
//        JSON.stringify([cssColor, pixelSize, cssOutlineColor, outlineWidth])
//
//      Animate any of those four and a brand new, cold atlas key is
//      minted every frame. A cold key cannot resolve before that frame's
//      afterRender, the next frame cancels it, billboard.ready stays
//      false forever, the image dimensions are written as zero, and the
//      vertex shader produces a zero-area quad. No error, no warning, no
//      ring. Four commits chased depth testing and clamping for this.
//
// So: same type, same height expression, same depth expression, and no
// CallbackProperty on anything the texture key is built from.
//
// Reads src/main.js as text. Imports nothing from the browser.
import fs from 'fs';

// A path argument exists so the gate can be pointed at a deliberately
// broken copy and shown to fail. A gate nobody has seen fail is a
// decoration.
const FILE = process.argv[2] ?? 'src/main.js';
const main = fs.readFileSync(FILE, 'utf8');

let failures = 0;
function check(label, ok, why) {
  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${label}${why ? `\n       ${why}` : ''}`);
}

// Whitespace and line breaks are formatting, not contract.
const flat = (s) => s.replace(/\s+/g, ' ').trim();

function slice(from, to, what) {
  const a = main.indexOf(from);
  if (a === -1) throw new Error(`${what}: could not find the opening anchor ${JSON.stringify(from)}`);
  const b = main.indexOf(to, a);
  if (b === -1) throw new Error(`${what}: could not find the closing anchor ${JSON.stringify(to)}`);
  return main.slice(a, b);
}

// The dot, in renderSite. Same anchors check:live-sensor already uses,
// so a rename breaks both gates together rather than silently one.
const dot = slice(
  '// Sensor dots — clamped to ground',
  '// Coverage ring — hidden by default',
  'sensor dot',
);
// The ring, built once after the render loop rather than rebuilt every
// tick. A one-frame entity never receives Cesium's asynchronous clamped
// height, which is what put the pulse about 38 m below its own sensor.
const ring = slice(
  '// ── THE PULSE RING IS BUILT ONCE, HERE, NOT ON EVERY TICK ──',
  '// Load the reconstructed buildings',
  'pulse ring',
);

console.log('The dot and the ring are one mark');

check(`both blocks were found in ${FILE}`,
  dot.length > 200 && dot.length < 4000 && ring.length > 500 && ring.length < 8000,
  `dot ${dot.length} chars, ring ${ring.length} chars`);

// 1. Same graphics type. A clamped point and a clamped billboard are in
//    fact the same Cesium class, but mixing the two entity graphics in
//    this codebase is what the confusion was built on, so the gate holds
//    the line at the entity API.
check('the dot is a point', /\bpoint:\s*\{/.test(dot) && !/\bbillboard:\s*\{/.test(dot));
check('the ring is a point too, not a billboard',
  /\bpoint:\s*\{/.test(ring) && !/\bbillboard:\s*\{/.test(ring),
  'a billboard ring and a point dot are occluded and sized by different\n       attribute paths, and reconciling them cost an afternoon');

// 2. Same heightReference expression, character for character once
//    whitespace is normalised. Not merely both clamping: the pinned
//    branch has to match too, or a pinned dot clamps its ring.
// Anchored at the start of a line so the prose above renderSite, which
// quotes both property names, is never mistaken for the code.
// renderSite calls the site id `site.id` and updateContributingRings
// calls it `sid`; that is a local name, not a difference in behaviour.
// The two blocks name the site id differently depending on which loop
// they sit in. Compare the expression, not the local variable.
const sameSite = (s) => s.replace(/site\.id/g, 'sid').replace(/\bsiteKey\b/g, 'sid');
const hrOf = (block) => {
  const m = block.match(/^[ \t]+heightReference:[\s\S]*?,[ \t]*$/m);
  return m ? sameSite(flat(m[0])) : null;
};
const dotHR = hrOf(dot);
const ringHR = hrOf(ring);
// NEITHER MARK CLAMPS. That is the invariant now, and it is the only
// configuration with no asynchrony in it. Cesium resolves a clamped
// height per entity and only where tiles are loaded, so two entities
// asked to clamp will always disagree somewhere, for as long as one has
// its answer and the other does not. Both take their height from the
// terrain sweep instead, which writes one number to both in the same
// loop.
// Comments are stripped first. Both of these blocks EXPLAIN at length
// why they do not clamp, and a gate that greps the prose it is
// documented with passes or fails on wording.
const code = (t) => t.replace(/^\s*\/\/.*$/gm, '');
check('neither mark clamps',
  !/heightReference/.test(code(dot)) && !/heightReference/.test(code(ring)));
check('both take their height from the shared terrain sweep',
  /_sensorGroundH\.set\(/.test(main)
  && /_sensorGroundH\.get\(/.test(ring));

// The depth expression, pulled off each block and compared as text.
const depthOf = (t) => {
  const m = code(t).match(/disableDepthTestDistance:\s*([^,\n]+)/);
  return m ? `disableDepthTestDistance: ${flat(m[1])}` : null;
};
const dotDepth = depthOf(dot);
const ringDepth = depthOf(ring);

check('the disableDepthTestDistance expression is identical', dotDepth === ringDepth,
  `dot:  ${dotDepth}\n       ring: ${ringDepth}`);
check('both go through the _sensorDepthValue() switch',
  dotDepth === 'disableDepthTestDistance: _sensorDepthValue()');

// 4. The ring takes its position from the dot, so there is one authority
//    for where a sensor is. renderSite's position is rewritten after boot
//    by the terrain sweep and again by __isr_pinSensors.
// Built once in renderSite, never rebuilt per tick. Cesium resolves a
// clamped height asynchronously, so a one-frame entity never receives it
// and renders at its declared height instead: about 38 m below its own
// dot at CPH, which is the drift this gate exists to prevent.
check('the ring is built once, not rebuilt per tick',
  /sensor-pulse-\$\{siteKey\}-\$\{sensor\.id\}/.test(ring)
  && !/contributingRingEntities\.push/.test(main));

console.log('\nNothing on the ring animates the texture key');

// 5. The four texture inputs must be constants. This is the actual
//    root cause of four invisible rings.
const TEXTURE_INPUTS = ['color', 'outlineColor', 'outlineWidth', 'pixelSize'];
// Everything from `point: {` to the end of the block, so a
// CallbackProperty elsewhere in the spec is not mistaken for one here.
const ringPoint = ring.slice(ring.indexOf('point: {'));
for (const prop of TEXTURE_INPUTS) {
  // The property's own value: up to the next property at the same level.
  // Indentation-agnostic: the block has moved depth once already and a
  // gate that breaks on whitespace teaches people to delete the gate.
  const m = ringPoint.match(new RegExp(`\\n(\\s+)${prop}:([\\s\\S]*?)\\n\\1[a-zA-Z]`));
  const value = m ? flat(m[2]) : null;
  check(`${prop} is a constant`,
    !!value && !/CallbackProperty/.test(value),
    value === null
      ? `could not find ${prop} on the ring's point graphics`
      : `${prop}: ${value}\n       a CallbackProperty here re-keys the atlas every frame and the ring\n       never becomes ready, so it is written as a zero-area quad`);
}

// 6. And it still pulses, through the one property that is forwarded to
//    the billboard without touching the texture.
check('the pulse runs on scaleByDistance',
  /scaleByDistance:\s*new Cesium\.CallbackProperty/.test(ringPoint)
  && /Cesium\.NearFarScalar\(/.test(ringPoint),
  'scaleByDistance is not part of the texture key, so it is the only free\n       per-frame animation a clamped point has');
check('nearValue and farValue are the same number, so it is not a distance ramp',
  /NearFarScalar\(1\.0,\s*([A-Za-z_$][\w$]*),\s*1\.0e7,\s*\1\)/.test(flat(ringPoint).replace(/\s+/g, ' ')));

console.log('\nStatus still decides whether a sensor pulses at all');

check('an offline sensor gets no ring',
  /if \(sensor\.status === 'offline'\) continue;/.test(ring));

console.log('');
if (failures > 0) {
  console.log(`check:sensor-pulse FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('check:sensor-pulse passed');
