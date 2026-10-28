// ═══════════════════════════════════════════════════════════════════
// check:basemap-denmark: over Denmark, the Danish orthophoto, and no
// Google 2D tiles
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-28: the October Google bill was 298.94 kr of 2D Map
// Tiles and 0 kr of Photorealistic 3D. src/basemap_denmark.js draws the
// Danish state orthophoto over Denmark and switches Google's 2D layer
// off there, so it requests no tiles. This gate holds the rule (where,
// at what height, never at night, never when the base is not Google's)
// and the wiring in main.js that makes it hold on screen.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { DK_BASEMAP_CFG as CFG, decideBasemap, overDenmark } from '../src/basemap_denmark.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

// Places, lon/lat.
const CPH_AIRPORT = [12.647, 55.618];
const AARHUS_HARBOUR = [10.2284, 56.1508];
const BILLUND = [9.152, 55.740];
const ESBJERG = [8.45, 55.47];
const SKAGEN = [10.59, 57.72];
const BORNHOLM = [14.91, 55.13];
const MALMO = [13.0, 55.6];
const HAMBURG = [9.99, 53.55];
const OSLO = [10.75, 59.91];
const NEW_YORK = [-74.0, 40.7];

const at = ([lon, lat], height, over = {}) => decideBasemap({
  lon, lat, height, sdfiShown: false, baseHidden: false, pinned: null, allowed: true, billedBase: true, ...over,
});

console.log('\n[where]');
check('Copenhagen Airport, Aarhus harbour, Billund, Esbjerg, Skagen and Bornholm are Denmark',
  [CPH_AIRPORT, AARHUS_HARBOUR, BILLUND, ESBJERG, SKAGEN, BORNHOLM].every(([lo, la]) => overDenmark(lo, la)));
check('Malmö, Hamburg, Oslo and New York are not',
  [MALMO, HAMBURG, OSLO, NEW_YORK].every(([lo, la]) => !overDenmark(lo, la)));
check('a camera with no position is not over Denmark, without throwing',
  overDenmark(NaN, NaN) === false && overDenmark(undefined, 55) === false);

console.log('\n[at a Danish site]');
const settled = { sdfiShown: true, sdfiShownForMs: CFG.googleOffAfterMs + 1 };
for (const [name, p] of [['Copenhagen Airport', CPH_AIRPORT], ['Aarhus harbour', AARHUS_HARBOUR], ['Billund', BILLUND]]) {
  const d = at(p, 2500, settled);
  check(`${name} at 2.5 km: orthophoto on, Google 2D off`, d.sdfi === true && d.hideBase === true, JSON.stringify(d));
}
const first = at(CPH_AIRPORT, 2500);
check('arriving: the orthophoto comes on, Google 2D stays under it until its tiles have had time',
  first.sdfi === true && first.hideBase === false, JSON.stringify(first));
check('...and goes once the orthophoto has been on long enough',
  at(CPH_AIRPORT, 2500, { sdfiShown: true, sdfiShownForMs: CFG.googleOffAfterMs - 1 }).hideBase === false
  && at(CPH_AIRPORT, 2500, { sdfiShown: true, sdfiShownForMs: CFG.googleOffAfterMs }).hideBase === true);
check('once off, Google 2D stays off without waiting again', at(CPH_AIRPORT, 2500, { sdfiShown: true, baseHidden: true, sdfiShownForMs: 0 }).hideBase === true);

console.log('\n[on the way down, the orthophoto comes on before Google goes]');
const mid = at(CPH_AIRPORT, (CFG.sdfiOnBelowM + CFG.googleOffBelowM) / 2, settled);
check('between the two heights the orthophoto is on and Google 2D still on under it', mid.sdfi && !mid.hideBase, JSON.stringify(mid));
check('the heights are staggered: Google goes lower than the orthophoto comes', CFG.googleOffBelowM < CFG.sdfiOnBelowM);
check('and in time: Google waits for the orthophoto, about a second or two', CFG.googleOffAfterMs >= 500 && CFG.googleOffAfterMs <= 5000);
check('each has a band, so a hovering camera does not flicker',
  CFG.sdfiOffAboveM > CFG.sdfiOnBelowM && CFG.googleOnAboveM > CFG.googleOffBelowM && CFG.googleOnAboveM <= CFG.sdfiOffAboveM);
const inBand = (CFG.googleOffBelowM + CFG.googleOnAboveM) / 2;
check('inside Google\'s band, what is on screen stays', at(CPH_AIRPORT, inBand, { ...settled, baseHidden: true }).hideBase === true
  && at(CPH_AIRPORT, inBand, { ...settled, baseHidden: false }).hideBase === false);
const sBand = (CFG.sdfiOnBelowM + CFG.sdfiOffAboveM) / 2;
check('inside the orthophoto\'s band, what is on screen stays', at(CPH_AIRPORT, sBand, { sdfiShown: true }).sdfi === true
  && at(CPH_AIRPORT, sBand, { sdfiShown: false }).sdfi === false);

console.log('\n[everywhere else, as before]');
check('high over Denmark (whole-country view): Google 2D, no orthophoto', (() => { const d = at(CPH_AIRPORT, 500000); return !d.sdfi && !d.hideBase; })());
check('low over Malmö, Hamburg, New York: Google 2D, no orthophoto',
  [MALMO, HAMBURG, NEW_YORK].every((p) => { const d = at(p, 2500); return !d.sdfi && !d.hideBase; }));
check('a camera with no height counts as far away', (() => { const d = at(CPH_AIRPORT, undefined); return !d.sdfi && !d.hideBase; })());

console.log('\n[night, pins, and bases that are not billed]');
check('night mode: nothing changes, whatever the camera', (() => { const d = at(CPH_AIRPORT, 2500, { ...settled, allowed: false }); return !d.sdfi && !d.hideBase; })());
check('night mode overrides a pin', (() => { const d = at(CPH_AIRPORT, 2500, { allowed: false, pinned: 'sdfi' }); return !d.sdfi && !d.hideBase; })());
check("force('bing') is Google 2D everywhere, as before", (() => { const d = at(CPH_AIRPORT, 2500, { pinned: 'bing' }); return !d.sdfi && !d.hideBase; })());
check("force('sdfi') is the orthophoto, Google 2D off", (() => { const d = at(NEW_YORK, 2500, { pinned: 'sdfi' }); return d.sdfi && d.hideBase; })());
check('when the base is not Google (offline or ion), it is never hidden',
  [at(CPH_AIRPORT, 2500, { ...settled, billedBase: false }), at(CPH_AIRPORT, 2500, { billedBase: false, pinned: 'sdfi' })].every((d) => d.hideBase === false));
check('...and the orthophoto still shows over Denmark there', at(CPH_AIRPORT, 2500, { billedBase: false }).sdfi === true);

console.log('\n[the layer]');
check('the key colour is a plain #rrggbb the service can take as bgcolor', /^#[0-9a-f]{6}$/i.test(CFG.keyColor));
check('the key threshold swallows JPEG noise and no more', CFG.keyThreshold > 0 && CFG.keyThreshold <= 0.15);
check('level 20, so the 12.5 cm photo reaches the screen', CFG.maximumLevel === 20);
check('the credit is the one the data licence asks for, not CC BY',
  /Styrelsen for Dataforsyning og Infrastruktur/.test(CFG.credit) && /WMS-tjeneste/.test(CFG.credit) && !/CC BY/.test(CFG.credit));

console.log('\n[the wiring in main.js]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('the Denmark rule is what window.__isr_basemap is',
  /const meshBasemap = createDenmarkBasemap\(\{[\s\S]{0,200}baseLayer: bingLayer, billedBase: _baseBilled/.test(main)
  && /window\.__isr_basemap = meshBasemap;/.test(main) && !/createMeshedSiteBasemap\(/.test(main));
check('Google 2D is marked billed, and only in its own branch',
  /bingLayer = viewer\.imageryLayers\.addImageryProvider\(g2d\);\s*_baseBilled = true;/.test(main)
  && (main.match(/_baseBilled = true/g) || []).length === 1);
check('the free backdrop goes under Google 2D, at index 0, in the same branch',
  /_baseBilled = true;[\s\S]{0,900}NaturalEarthII'\)\);\s*viewer\.imageryLayers\.addImageryProvider\(backdrop, 0\);/.test(main));
check('the orthophoto asks for the key colour and makes it see-through',
  /bgcolor: `0x\$\{_dk\.keyColor/.test(main)
  && /sdfiLayer\.colorToAlpha = Cesium\.Color\.fromCssColorString\(_dk\.keyColor\);/.test(main)
  && /sdfiLayer\.colorToAlphaThreshold = _dk\.keyThreshold;/.test(main));
check('the orthophoto stays JPEG (PNG weighed 13 times more)', /format: 'image\/jpeg'/.test(main));
check('the colour lift Lucas picked is the default (saturation 1.4, contrast 1.15)',
  CFG.saturation === 1.4 && CFG.contrast === 1.15
  && /sdfiLayer\.saturation = _dk\.saturation;\s*sdfiLayer\.contrast = _dk\.contrast;/.test(main));
check('a mode switch hands the layers back to the rule', /try \{ meshBasemap\.apply\('imagery mode'\); \} catch/.test(main));

const mod = readFileSync(new URL('../src/basemap_denmark.js', import.meta.url), 'utf8');
check('the rule touches no Cesium global, only two layers\' show flags',
  !/scene\.(globe|light|skyAtmosphere|fog)\s*[.=]|percentageChanged\s*=/.test(mod));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
