// ═══════════════════════════════════════════════════════════════════
// check:google-guard — development loads do not touch Google
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-28: the Google bill. Every page load created a Google
// 3D session and pulled Google 2D tiles, development reloads included.
// src/google_tiles_guard.js makes Google opt-in during development
// (?google=1 in the address) and leaves production and key-less
// servers exactly as they were. This gate holds the rule and the
// wiring in main.js: no Google request is reachable on a held-back
// load, the held-back base map is offline and never ion, and the
// 3D tileset is only added to the scene when it exists.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { googleTilesAllowed } from '../src/google_tiles_guard.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

console.log('\n[the rule]');
check('production loads Google, whatever the address says', googleTilesAllowed({ isDev: false, search: '' }) && googleTilesAllowed({ isDev: false, search: '?google=0' }));
check('development without the switch does not', googleTilesAllowed({ isDev: true, search: '' }) === false);
check('development with ?google=1 does', googleTilesAllowed({ isDev: true, search: '?google=1' }) === true);
check('the switch works beside other parameters', googleTilesAllowed({ isDev: true, search: '?profile=photoreal&google=1' }) === true);
check('only an explicit 1 counts', ['?google=0', '?google=true', '?google', '?googl=1'].every(q => googleTilesAllowed({ isDev: true, search: q }) === false));
check('a malformed address fails closed, without throwing', googleTilesAllowed({ isDev: true, search: undefined }) === false && googleTilesAllowed({ isDev: true, search: null }) === false);

console.log('\n[the wiring in main.js]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const count = (re) => (main.match(re) || []).length;
check('the guard is computed once, from the build mode and the address',
  /const _googleOk = googleTilesAllowed\(\{ isDev: import\.meta\.env\.DEV, search: window\.location\.search \}\);/.test(main));
check('Google 2D is created in exactly one place, and only when allowed',
  count(/Google2DImageryProvider\.fromUrl/g) === 1 && /if \(_gKey2d && _googleOk\) \{[\s\S]{0,160}Google2DImageryProvider\.fromUrl/.test(main));
check('Google 3D is created in exactly one place, behind the held-back branch',
  count(/createGooglePhotorealistic3DTileset\(/g) === 1
  && /if \(_gKey && !_googleOk\) \{[\s\S]{0,600}\} else if \(_gKey\) \{[\s\S]{0,1600}createGooglePhotorealistic3DTileset\(/.test(main));
const heldBack2d = /\} else if \(_gKey2d\) \{([\s\S]*?)\} else \{/.exec(main);
check('the held-back base map is the bundled offline imagery, never ion',
  !!heldBack2d && /TileMapServiceImageryProvider\.fromUrl\(\s*Cesium\.buildModuleUrl\('Assets\/Textures\/NaturalEarthII'\)\)/.test(heldBack2d[1]) && !/Ion/.test(heldBack2d[1]));
check('a held-back load that fails stays offline instead of falling back to ion',
  /if \(_googleHeldBack\) \{\s*console\.error\('Offline base imagery failed/.test(main));
check('the 3D tileset is only added to the scene when it exists',
  /if \(googlePhotoreal\) \{\s*viewer\.scene\.primitives\.add\(googlePhotoreal\);/.test(main) && count(/primitives\.add\(googlePhotoreal\)/g) === 1);
check('a server with no key keeps the ion path it always had',
  /\} else \{\s*const bing = await Cesium\.IonImageryProvider\.fromAssetId\(2\);/.test(main)
  && /\} else \{\s*googlePhotoreal = await Cesium\.Cesium3DTileset\.fromIonAssetId\(2275207\);/.test(main));

console.log('\n[nothing else loads Google at startup]');
const ROOT = new URL('../src/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap(n => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : (f.endsWith('.js') ? [f] : []); });
const others = walk(ROOT).filter(f => !f.endsWith('main.js'))
  .filter(f => /Google2DImageryProvider|createGooglePhotorealistic3DTileset|GoogleMaps\.defaultApiKey/.test(readFileSync(f, 'utf8')));
check('no other source file creates Google tiles', !others.length, others.join(', '));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
