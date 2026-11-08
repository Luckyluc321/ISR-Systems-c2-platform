// ═══════════════════════════════════════════════════════════════════
// check:ion-lazy — ion imagery sessions only when the view needs them
// ───────────────────────────────────────────────────────────────────
// Earth at Night and Bing each cost one ion imagery session per page
// load. This holds that neither loads at boot any more, that each loads
// once, lands where it always sat in the layer stack, and that a failure
// is contained. Pure node, Cesium faked.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { createLazyIonImagery } from '../src/lazy_ion_imagery.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};
const quiet = async (fn) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };

console.log('\n[1] the lazy layer');
let calls = 0, fail = false;
const stack = ['offline', 'sdfi'];
const viewer = { imageryLayers: {
  indexOf: (l) => stack.indexOf(l),
  addImageryProvider: (p, at) => { const layer = { p }; if (at === undefined) stack.push(layer); else stack.splice(at, 0, layer); return layer; },
} };
const Cesium = { IonImageryProvider: { fromAssetId: async (id) => { calls++; if (fail) throw new Error('quota'); return { id }; } } };
let handed = null;
const lazy = createLazyIonImagery({ Cesium, viewer, assetId: 2, label: 'Bing', insertAbove: () => 'offline', configure: (l) => { l.dayAlpha = 1; }, onLoaded: (l) => { handed = l; } });
check('nothing loads until asked', calls === 0 && lazy.state() === 'waiting');
await quiet(() => Promise.all([lazy.load('a'), lazy.load('b')]));
check('two calls, one session', calls === 1 && lazy.state() === 'loaded');
check('inserted directly above the base, under the Danish photo', stack[1] === handed && stack[2] === 'sdfi');
check('configured and handed over', handed.dayAlpha === 1);
fail = true; calls = 0;
const bad = createLazyIonImagery({ Cesium, viewer, assetId: 3812, label: 'Earth at Night' });
const r = await quiet(() => bad.load('night'));
check('a failure is contained and not retried in a loop', r === null && bad.state() === 'failed' && calls === 1);

console.log('\n[2] wiring');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('Earth at Night is never loaded at boot', !/await Cesium\.IonImageryProvider\.fromAssetId\(3812\)/.test(main));
check('Earth at Night loads on night or auto', /_lazyEarthAtNight\.load\(/.test(main) && /imageryMode === 'night' \|\| imageryMode === 'auto'/.test(main));
check('Google refusing its satellite gives an offline base and a deferred Bing', /bingLayer = viewer\.imageryLayers\.addImageryProvider\(offline\);\s*_bingDeferred = true;/.test(main));
check('deferred Bing is checked at rest, only where the Danish photo is not showing', /moveEnd\.addEventListener\(\(\) => setTimeout[\s\S]{0,200}LAZY_BING_BELOW_M && !\(sdfiLayer && sdfiLayer\.show\)/.test(main));
check('Google\'s 3D city is untouched', /fromIonAssetId\(2275207\)/.test(main) && /createGooglePhotorealistic3DTileset/.test(main));

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
