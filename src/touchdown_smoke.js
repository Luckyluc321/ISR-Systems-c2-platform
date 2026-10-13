// Tyre smoke on touchdown.
//
// WHAT IT IS, physically. The wheels are stationary and the runway is
// arriving at about 250 km/h, so the tyres are dragged up to speed in
// under a second. That is the puff on every landing video: rubber
// flash-burning against the surface. It is small, grey-white, lasts
// about a second, and is LEFT BEHIND as the aircraft rolls on.
//
// NOT A PARTICLE SYSTEM. Cesium's ParticleSystem advances on
// viewer.clock, which is frozen here so the sun holds still, so its
// particles would never move. It also would not pause with the
// simulation. Sprites driven off monoNow do, cost almost nothing for a
// second, and are plenty for a puff.
//
// Wheel positions are measured from the model: the mains sit at
// X +/- 3.67 and Z +0.25, a track of 7.35 m against the real A320's
// 7.59. The offset is rotated by the airframe's heading, the same way
// every other body-mounted point in this codebase is.

const PUFFS_PER_WHEEL = 4;
const LIFE_MS = 1400;
const START_R = 0.8;
const END_R = 5.5;
const PEAK_ALPHA = 0.38;
const WHEEL_SIDE_M = 3.67;
const WHEEL_AFT_M = 0.25;

// A RADIAL GRADIENT IS NOT SMOKE. A single falloff reads as a fuzzy
// ball: perfectly circular, perfectly even, unmistakably a sprite. Real
// smoke is irregular at every scale, with torn edges and uneven density.
//
// So the sprite is built from fractal value noise: a coarse random grid
// smoothly interpolated, then three finer octaves on top, each at half
// the amplitude. That gives large-scale lumps with small-scale wisps,
// which is what reads as smoke. The radial falloff then only decides
// where it ENDS, and because the noise modulates it the edge is ragged
// rather than a clean circle.
//
// Several variants are generated so puffs do not repeat, and each puff
// is also rotated at random, so no two are the same sprite twice.
const VARIANTS = 4;
const TEX = 128;

function valueNoise(size, cells, rand) {
  // One lattice of random values, smoothly interpolated. Smoothstep
  // rather than linear, or the lattice shows as diamonds.
  const g = [];
  for (let i = 0; i <= cells; i++) {
    g[i] = [];
    for (let j = 0; j <= cells; j++) g[i][j] = rand();
  }
  const sstep = (t) => t * t * (3 - 2 * t);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = sstep(fx - ix), ty = sstep(fy - iy);
      const a = g[iy][ix] * (1 - tx) + g[iy][ix + 1] * tx;
      const b = g[iy + 1][ix] * (1 - tx) + g[iy + 1][ix + 1] * tx;
      out[y * size + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

function smokeSprite(seed) {
  // Deterministic per variant, so the same four textures every run.
  let s = seed * 9301 + 49297;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  // Five octaves. Fewer and it reads as a lumpy ball; the fine ones are
  // what give it torn, wispy edges.
  const oct = [
    { cells: 4,  amp: 1.00 },
    { cells: 8,  amp: 0.55 },
    { cells: 16, amp: 0.30 },
    { cells: 32, amp: 0.17 },
    { cells: 64, amp: 0.09 },
  ].map(o => ({ ...o, n: valueNoise(TEX, o.cells, rand) }));

  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(TEX, TEX);
  const half = TEX / 2;
  const sstep = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      let n = 0, amp = 0;
      for (const o of oct) { n += o.n[i] * o.amp; amp += o.amp; }
      n = Math.min(1, Math.max(0, ((n / amp) - 0.5) * 2.4 + 0.5));   // contrast

      // LINEAR falloff, not a bell. A squared falloff is a gradient
      // again and swamps the noise, which is how the first attempt
      // ended up as a fuzzy ball.
      const dx = (x - half) / half, dy = (y - half) / half;
      const fall = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));

      // The noise decides density, the falloff only decides where it
      // ends, so the edge tears instead of ending on a circle.
      let a = fall * (0.15 + n * 1.35);
      a = sstep(0.30, 0.80, a);        // wide ramp: translucent, not solid
      a *= 0.55 + n * 0.45;            // holes right through it

      // Burnt rubber is grey and lit unevenly. White reads as steam.
      const lum = 192 + n * 54;
      const o4 = i * 4;
      img.data[o4] = lum;
      img.data[o4 + 1] = lum - 3;
      img.data[o4 + 2] = lum - 8;
      img.data[o4 + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function createTouchdownSmoke(viewer, Cesium, { monoNow }) {
  let images = null;
  const live = [];

  const build = () => {
    if (!images) images = Array.from({ length: VARIANTS }, (_, i) => smokeSprite(i + 1));
  };

  return {
    /** Build the textures ahead of time. Four 128px sprites at five
     *  octaves is a few hundred thousand operations: nothing, except in
     *  the single frame the wheels touch, which is the one frame that
     *  must not stutter. Called from the tick, a no-op after the first. */
    prime() { build(); },
    /**
     * @param cart     the aircraft's position at the moment of touchdown
     * @param heading  compass heading in radians
     */
    fire(cart, heading) {
      if (!cart) return 0;
      build();
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(cart);
      const axis = (i) => new Cesium.Cartesian3(enu[i], enu[i + 1], enu[i + 2]);
      const east = axis(0), north = axis(4);
      const t0 = monoNow();

      for (const side of [-WHEEL_SIDE_M, WHEEL_SIDE_M]) {
        for (let k = 0; k < PUFFS_PER_WHEEL; k++) {
          // Scatter slightly, and trail a little behind the wheel.
          const fwd = -WHEEL_AFT_M - k * 1.6 - Math.random() * 0.8;
          const lat = side + (Math.random() - 0.5) * 0.7;
          // Body offset into the world: heading's unit vector is
          // (sin, cos) in east/north, a quarter turn gives the side.
          const dE = Math.sin(heading) * fwd + Math.cos(heading) * lat;
          const dN = Math.cos(heading) * fwd - Math.sin(heading) * lat;
          const pos = Cesium.Cartesian3.clone(cart, new Cesium.Cartesian3());
          Cesium.Cartesian3.add(pos,
            Cesium.Cartesian3.multiplyByScalar(east, dE, new Cesium.Cartesian3()), pos);
          Cesium.Cartesian3.add(pos,
            Cesium.Cartesian3.multiplyByScalar(north, dN, new Cesium.Cartesian3()), pos);

          const born = t0 + k * 55;      // the wheels do not all touch at once
          const ent = viewer.entities.add({
            id: `touchdown-smoke-${born}-${side}-${k}`,
            // STATIONARY. The smoke is left on the runway; the aircraft
            // rolls away from it. Anything that follows the aircraft
            // reads as an exhaust trail, not a tyre mark.
            position: pos,
            billboard: {
              image: images[(k + (side > 0 ? 1 : 0)) % VARIANTS],
              // Random roll, so four puffs from one texture set never
              // read as the same shape repeated.
              rotation: Math.random() * Math.PI * 2,
              sizeInMeters: true,
              width: new Cesium.CallbackProperty(() => {
                const u = Math.min(1, Math.max(0, (monoNow() - born) / LIFE_MS));
                return START_R + (END_R - START_R) * Math.sqrt(u);
              }, false),
              height: new Cesium.CallbackProperty(() => {
                const u = Math.min(1, Math.max(0, (monoNow() - born) / LIFE_MS));
                return START_R + (END_R - START_R) * Math.sqrt(u);
              }, false),
              color: new Cesium.CallbackProperty(() => {
                const u = Math.min(1, Math.max(0, (monoNow() - born) / LIFE_MS));
                // Up fast, out slow, which is how a puff actually reads.
                const a = u < 0.15 ? (u / 0.15) * PEAK_ALPHA
                                   : PEAK_ALPHA * (1 - (u - 0.15) / 0.85);
                return Cesium.Color.WHITE.withAlpha(Math.max(0, a));
              }, false),
            },
          });
          live.push({ ent, dieAt: born + LIFE_MS + 200 });
        }
      }
      return live.length;
    },

    /** Called from the tick: clears spent puffs. */
    sweep() {
      if (!live.length) return;
      const now = monoNow();
      for (let i = live.length - 1; i >= 0; i--) {
        if (now >= live[i].dieAt) {
          viewer.entities.remove(live[i].ent);
          live.splice(i, 1);
        }
      }
    },
  };
}
