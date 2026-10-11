// Gate for src/track_clustering.js. Pure functions, no browser, so the
// grouping rule can be proved on coordinates alone.
//
// Each case is one of the situations Lucas described, written as the
// sentence he said it in, so a failure reads as a broken promise rather
// than a broken assertion.
import { clusterTracks, departureCardinality, SWARM_PROXIMITY_M } from '../src/track_clustering.js';

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
  else console.log(`  ✓ ${name}`);
};

// A formation over CPH: five quadcopters a few hundred metres apart.
const base = { lat: 55.618, lon: 12.656 };
const m = (dN, dE) => ({
  lat: base.lat + dN / 111132,
  lon: base.lon + dE / (111320 * Math.cos(base.lat * Math.PI / 180)),
});
const swarm = [
  { key: 'DJI-1', type: 'quadcopter', ...m(0, 0) },
  { key: 'DJI-2', type: 'quadcopter', ...m(200, 120) },
  { key: 'DJI-3', type: 'quadcopter', ...m(-180, 260) },
  { key: 'DJI-4', type: 'quadcopter', ...m(60, -240) },
  { key: 'DJI-5', type: 'quadcopter', ...m(-250, -90) },
];

check('a formation flying together is one group',
  clusterTracks(swarm).map((c) => c.keys),
  [['DJI-1', 'DJI-2', 'DJI-3', 'DJI-4', 'DJI-5']]);

// One breaks away and runs. 4 km clear of the others.
const breakaway = swarm.map((d, i) => (i === 2 ? { ...d, ...m(-4200, 3100) } : d));
check('a drone that breaks away becomes its own group',
  clusterTracks(breakaway).map((c) => c.keys),
  [['DJI-1', 'DJI-2', 'DJI-4', 'DJI-5'], ['DJI-3']]);

// Mixed threats in the same airspace, overlapping in position.
const mixed = [
  { key: 'DJI-1', type: 'quadcopter', ...m(0, 0) },
  { key: 'DJI-2', type: 'quadcopter', ...m(150, 100) },
  { key: 'FW-1',  type: 'fixed-wing', ...m(50, 50) },
  { key: 'LM-1',  type: 'loitering-munition', ...m(-80, 30) },
];
check('different platform types never merge, however close',
  clusterTracks(mixed).map((c) => `${c.type}:${c.keys.join(',')}`),
  ['quadcopter:DJI-1,DJI-2', 'fixed-wing:FW-1', 'loitering-munition:LM-1']);

// Line astern, strung out past the threshold end to end.
const astern = [0, 800, 1600, 2400].map((d, i) => ({ key: `Q-${i}`, type: 'quadcopter', ...m(0, d) }));
check('a strung-out line is still one group if each gap is short',
  clusterTracks(astern).map((c) => c.size), [4]);

// A real gap splits it.
const split = [0, 800, 4000, 4800].map((d, i) => ({ key: `Q-${i}`, type: 'quadcopter', ...m(0, d) }));
check('a real gap splits it in two',
  clusterTracks(split).map((c) => c.keys), [['Q-0', 'Q-1'], ['Q-2', 'Q-3']]);

// Wording.
check('one drone leaving a group of five is named',
  departureCardinality({ leaving: ['DJI-3'], clusterSize: 5 }).kind, 'single');
check('all five leaving is one aggregate marker',
  departureCardinality({ leaving: ['a','b','c','d','e'], clusterSize: 5 }).kind, 'whole');
check('two of five leaving says two of five',
  departureCardinality({ leaving: ['a','b'], clusterSize: 5 }),
  { kind: 'partial', count: 2, of: 5 });

// Robustness: junk in must not throw or silently invent a position.
check('tracks with no position are dropped, not guessed',
  clusterTracks([{ key: 'X', type: 'quadcopter' }, { key: 'Y', type: 'quadcopter', ...m(0,0) }]).map(c => c.keys),
  [['Y']]);
check('empty input is empty output', clusterTracks([]), []);
check('null input does not throw', clusterTracks(null), []);

console.log(`\n  proximity threshold: ${SWARM_PROXIMITY_M} m`);
if (failed) { console.error(`\n✗ track clustering: ${failed} case(s) failed`); process.exit(1); }
console.log('✓ Track clustering behaves as specified.');
