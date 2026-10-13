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

function smokeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  // Soft, and grey rather than white: burnt rubber, not steam.
  grd.addColorStop(0.0, 'rgba(228,226,222,0.95)');
  grd.addColorStop(0.45, 'rgba(198,195,190,0.45)');
  grd.addColorStop(1.0, 'rgba(180,177,172,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

export function createTouchdownSmoke(viewer, Cesium, { monoNow }) {
  let image = null;
  const live = [];

  return {
    /**
     * @param cart     the aircraft's position at the moment of touchdown
     * @param heading  compass heading in radians
     */
    fire(cart, heading) {
      if (!cart) return 0;
      if (!image) image = smokeSprite();
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
              image,
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
