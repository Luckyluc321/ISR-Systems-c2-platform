// Landing gear for the airliner, driven on the model primitive directly.
//
// WHY THE MODEL HAS NO SKIN. Cesium's ModelSceneGraph.update calls
// updateJointMatrices() INSIDE its loop over every runtime node:
//
//     for (i = 0; i < this._runtimeNodes.length; i++) {
//       ...
//       if (updateForAnimations) this.updateJointMatrices();
//
// so a single node write costs 190 nodes x 142 joints of matrix work
// every frame, about 27,000 operations to move one wheel. The cost is
// not proportional to what you move, it is proportional to the model
// having a skin at all. That is why four different approaches all
// froze: they were all moving nodes on a skinned model.
//
// a320_noskin.glb has no skin. Every joint's geometry was lifted into a
// plain node by scripts/split_airliner_surfaces.py, which is sound
// because all 51,140 gear vertices were weighted 1.000 to exactly one
// joint: rigid bodies wearing a rig they never needed. With
// _skinnedNodes empty, updateJointMatrices iterates nothing and a node
// write costs what it should.
//
// THREE EARLIER ATTEMPTS blamed the wrong thing. Running
// the model's animation froze the map; 48 skinned joints through
// nodeTransformations froze it; 118 extracted plain nodes froze it. The
// conclusion I kept drawing was "moving parts are expensive on this
// model". That was wrong.
//
// Reading Cesium rather than guessing: the model side is cheap. The
// ModelNode matrix setter only flags _userAnimationDirty, and
// ModelMatrixUpdateStage walks a node solely when _transformDirty,
// updating draw-command matrices. Nothing there justifies a freeze.
//
// The cost is the ENTITY PROPERTY LAYER above it. ModelGraphics
// nodeTransformations is a PropertyBag, and ModelVisualizer re-evaluates
// it EVERY FRAME while it is defined, then for all 48 entries does
//
//     Matrix4.fromTranslationRotationScale(...)   // allocate
//     modelNode.matrix = Matrix4.multiply(...)    // allocate, multiply
//
// whether or not anything changed. Assigning the bag also rebuilds 48
// properties and raises definitionChanged on each.
//
// So this bypasses it. Cesium keeps the Model primitive in the
// ModelVisualizer's own hash, and Model.getNode(name) is public, so the
// gear is driven by setting node matrices directly, only when the pose
// actually changes. Per-frame cost: zero. Per step: 48 matrix writes.
//
// That makes the motion as smooth as we like, because smoothness is no
// longer rationed against frame rate.

import { RIGID_PARTS } from './a320_rigid_gearup.js';
import { RIGID_PARTS as BRAKES_OUT } from './a320_rigid_brakes.js';

// Which extracted parts are landing gear. The manifest covers the whole
// airframe, because the whole airframe had to come out of the skin.
const GEAR = /wheel|gear|wheeldoor/i;

// DOORS CLOSE AGAIN. On an A320 the main gear bay doors and the nose
// gear forward doors open to let the gear down and then SHUT while the
// gear stays extended; only the small leg-mounted fairings travel with
// the strut. The model's rest pose is a static display pose, gear down
// with the bay doors hanging open, which on approach reads as two large
// panels under the fuselage close to the ground.
//
// So doors follow a different curve from the legs. The legs run 0 to 1
// once. The doors open, wait for the legs to travel, then close:
//
//   gear fraction   0 ────────────────────────────────── 1
//   doors           0 ──/‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾\── 0
//                      0.18                    0.82
//
// Door fraction 0 is the RETRACTED delta, which is the door closed, so
// ending at 0 shuts them with the gear still down.
const DOOR = /door/i;
const BRAKE = /AirBrake/i;

// GROUND SPOILERS. Armed on approach, they fire automatically on wheel
// spin-up and are fully out in about a second: this is a touchdown
// event, not an altitude ramp. 73.3 degrees, the artist's own figure,
// measured as the rotation relative to each panel's rest pose.
const BRAKE_DEPLOY_MS = 900;
// And stowed again once the aircraft is down to taxi speed, which is
// what the crew does on the roll: the panels are no longer doing
// anything useful below about 15 kt, and an aircraft taxiing to its
// stand with its spoilers still up is not a thing you see.
// Retracted at about 55 kt, not at taxi speed. Spoiler drag falls with
// the square of the speed, so by this point the panels have stopped
// doing anything useful and the crew stows them during the roll. 8 m/s,
// which is 15 kt, left them standing up almost to the point of stopping,
// which is not something you see.
const BRAKE_STOW_BELOW_MS = 28;    // metres per second, about 55 kt
const BRAKE_STOW_MS = 2500;        // they retract slower than they deploy

// ENGINE FANS. The model animates them at 687 rpm, which is real but
// useless to us: with 22 blades that is 252 blade passes a second
// against 60 frames, so the disc would strobe or appear to run
// backwards. Without motion blur the only honest option is a rate whose
// BLADE PASS frequency reads as rotation, and 0.5 rev/s gives 11 passes
// a second: clearly turning, no aliasing. Avoid anything near 60/22 and
// 30/22 rev/s, which are the strobe and half-frame cases.
const FAN_NODES = [
  'rigid_Engine.L_082__173', 'rigid_Engine.L_082__175',
  'rigid_Engine.R_083__174', 'rigid_Engine.R_083__176',
];
const FAN_REV_S = 0.5;

const DOOR_OPEN_BY = 0.18;
const DOOR_SHUT_FROM = 0.82;

function doorFraction(f) {
  if (f <= 0) return 0;
  if (f < DOOR_OPEN_BY) return f / DOOR_OPEN_BY;
  if (f <= DOOR_SHUT_FROM) return 1;
  return Math.max(0, (1 - f) / (1 - DOOR_SHUT_FROM));
}

/** Find the Model primitive Cesium built for an entity, or null while it
 *  is still loading. ModelVisualizer keeps it in _modelHash, keyed by
 *  entity id. Private, so every access is guarded: if the shape of this
 *  ever changes the gear simply stays down rather than throwing. */
function findModelPrimitive(viewer, entity) {
  try {
    const ds = viewer?.dataSourceDisplay;
    const buckets = [ds?.defaultDataSource, ...(ds?.dataSources?._dataSources || [])];
    for (const b of buckets) {
      for (const v of (b?._visualizers || [])) {
        const hash = v?._modelHash;
        const hit = hash && hash[entity.id];
        if (hit?.modelPrimitive?.getNode) return hit.modelPrimitive;
      }
    }
  } catch (_) { /* fall through: no gear rather than a broken tick */ }
  return null;
}

/**
 * Gear driver for one track.
 * @param extendBelowAglM  height above ground at which gear is selected
 * @param extendMs         travel time; a real A320 is 10 to 15 seconds
 */
export function createGearDriver(Cesium, viewer, {
  monoNow, extendBelowAglM = 300, extendMs = 12000,
} = {}) {
  let model = null;
  let t0 = null;          // when gear was selected down
  let td = null;          // when the wheels touched
  let ts = null;          // when the spoilers began to stow
  let tUp = null;         // when the gear was selected UP again
  let minAgl = null;      // lowest point reached, for spotting a climb
  let lastPos = null;     // for ground speed, measured not assumed
  let lastPosMs = 0;
  let applied = null;     // last fraction written, so we only write on change
  const scratch = new Cesium.Matrix4();

  // Precomputed delta per node: bind (gear DOWN, the model's rest pose)
  // -> retracted. One joint can own several nodes, because a part may
  // appear in several meshes with different materials.
  const parts = [];
  const add = (p, kind) => {
    for (const node of p.nodes) {
      parts.push({
        node, kind,
        isDoor: DOOR.test(p.joint),
        t: new Cesium.Cartesian3(p.t[0], p.t[1], p.t[2]),
        r: new Cesium.Quaternion(p.r[0], p.r[1], p.r[2], p.r[3]),
        s: new Cesium.Cartesian3(p.s[0], p.s[1], p.s[2]),
      });
    }
  };
  // GEAR runs FROM its delta (retracted) TO identity (down), because
  // identity is the model as it ships, which is gear down.
  for (const p of RIGID_PARTS) if (GEAR.test(p.joint)) add(p, 'gear');
  // BRAKES run the other way: identity is stowed and the delta is
  // deployed, so they go from identity out to the delta.
  for (const p of BRAKES_OUT) if (BRAKE.test(p.joint)) add(p, 'brake');
  const ONE = new Cesium.Cartesian3(1, 1, 1);
  const IDENT = new Cesium.Quaternion(0, 0, 0, 1);

  function write(entity, f, bf, report) {
    if (!model) model = findModelPrimitive(viewer, entity);
    if (!model) return false;               // not built yet, try next tick
    const T = new Cesium.Cartesian3();
    const S = new Cesium.Cartesian3();
    const R = new Cesium.Quaternion();
    // FINDING THE MODEL IS NOT THE SAME AS IT BEING READY. Model.getNode
    // THROWS until the glTF has loaded, and the primitive exists well
    // before that. Counting actual writes is the difference between
    // "applied" and "found something and wrote to nothing", and getting
    // that wrong is why the aircraft kept starting with its wheels out:
    // the first call found the model, silently wrote nothing, recorded
    // success, and the change guard then blocked every retry.
    let written = 0;
    for (const p of parts) {
      let node;
      try { node = model.getNode(p.node); } catch (_) { node = null; }
      if (!node) continue;
      if (p.kind === 'brake') {
        // identity -> deployed
        Cesium.Cartesian3.lerp(Cesium.Cartesian3.ZERO, p.t, bf, T);
        Cesium.Cartesian3.lerp(ONE, p.s, bf, S);
        Cesium.Quaternion.slerp(IDENT, p.r, bf, R);
      } else {
        // retracted -> down, and doors run their own profile within it
        const pf = p.isDoor ? doorFraction(f) : f;
        Cesium.Cartesian3.lerp(p.t, Cesium.Cartesian3.ZERO, pf, T);
        Cesium.Cartesian3.lerp(p.s, ONE, pf, S);
        Cesium.Quaternion.slerp(p.r, IDENT, pf, R);
      }
      // Same composition ModelVisualizer uses: the node's ORIGINAL local
      // matrix times the delta. A node transform is a delta, not a pose.
      Cesium.Matrix4.fromTranslationQuaternionRotationScale(T, R, S, scratch);
      node.matrix = Cesium.Matrix4.multiply(
        node.originalMatrix, scratch, new Cesium.Matrix4());
      written++;
    }
    if (report) {
      const brakes = parts.filter(p => p.kind === 'brake').length;
      console.log(`[surfaces] wrote ${written} of ${parts.length} nodes`
        + ` (${brakes} are spoiler panels), gear ${f}, spoilers ${bf}`);
      return written;
    }
    return written > 0;
  }

  // Fans spin every FRAME, not every tick, because a tick-rate disc
  // steps visibly. It costs four node matrix writes: with no skin on
  // this model, Cesium's joint-matrix loop iterates nothing, which is
  // the whole reason any of this is affordable.
  const fanAxis = new Cesium.Cartesian3(0, 0, 1);
  const fanQ = new Cesium.Quaternion();
  const fanM = new Cesium.Matrix4();
  let fanNodes = null;
  const spin = () => {
    if (!model) return;
    if (!fanNodes) {
      // getNode THROWS until the glTF has loaded, and the Model
      // primitive exists well before that. The first version caught the
      // throw and returned leaving fanNodes as an empty ARRAY, which is
      // truthy, so it never rebuilt and the fans never turned. Same trap
      // the gear fell into: finding the model is not the same as it
      // being ready.
      const found = [];
      for (const n of FAN_NODES) {
        let nd = null;
        try { nd = model.getNode(n); } catch (_) { return; }   // retry next frame
        if (nd) found.push(nd);
      }
      if (!found.length) return;                                // retry next frame
      fanNodes = found;
      console.log(`[surfaces] engine fans engaged, ${found.length} nodes`);
    }
    const a = ((monoNow() / 1000) * FAN_REV_S * Math.PI * 2) % (Math.PI * 2);
    Cesium.Quaternion.fromAxisAngle(fanAxis, a, fanQ);
    Cesium.Matrix4.fromTranslationQuaternionRotationScale(
      Cesium.Cartesian3.ZERO, fanQ, new Cesium.Cartesian3(1, 1, 1), fanM);
    for (const nd of fanNodes) {
      nd.matrix = Cesium.Matrix4.multiply(nd.originalMatrix, fanM, new Cesium.Matrix4());
    }
  };
  const removeSpin = viewer.scene.preRender.addEventListener(spin);

  return {
    dispose() { try { removeSpin(); } catch (_) {} },
    /** Call from the tick with height above ground. */
    update(entity, aglM) {
      if (t0 === null && typeof aglM === 'number' && aglM > 0 && aglM <= extendBelowAglM) {
        t0 = monoNow();
      }
      // GEAR UP ON A POSITIVE RATE OF CLIMB. On a go-around the crew
      // calls for gear up as soon as the aircraft is climbing, and
      // without this it would fly its missed approach with the wheels
      // hanging out. Detected from the aircraft's own height rather than
      // from a flag, so any route that climbs away gets it for free.
      if (typeof aglM === 'number') {
        minAgl = minAgl === null ? aglM : Math.min(minAgl, aglM);
        if (t0 !== null && tUp === null && aglM > minAgl + 80) tUp = monoNow();
      }
      let f = t0 === null ? 0 : Math.min(1, (monoNow() - t0) / extendMs);
      if (tUp !== null) f = Math.max(0, f - (monoNow() - tUp) / extendMs);
      // Spoilers fire on touchdown, not on height.
      if (td === null && typeof aglM === 'number' && aglM <= 1.0) {
        td = monoNow();
        // One line, once, so a landing run says plainly whether the
        // spoilers fired. Everything about this path checks out on
        // paper, which is exactly when a log beats another theory.
        console.log('[surfaces] touchdown, ground spoilers deploying');
      }
      // Ground speed, measured from the entity's own movement rather
      // than assumed from the waypoint table, so a change to the braking
      // profile cannot leave this stale.
      const now = monoNow();
      if (td !== null && now - lastPosMs > 250) {
        const c = entity?.position?.getValue?.(Cesium.JulianDate.now());
        if (c) {
          if (lastPos) {
            const v = Cesium.Cartesian3.distance(c, lastPos)
              / ((now - lastPosMs) / 1000);
            if (ts === null && v > 0 && v < BRAKE_STOW_BELOW_MS) ts = now;
          }
          lastPos = Cesium.Cartesian3.clone(c, lastPos || new Cesium.Cartesian3());
          lastPosMs = now;
        }
      }
      let bf = td === null ? 0 : Math.min(1, (now - td) / BRAKE_DEPLOY_MS);
      if (ts !== null) bf *= Math.max(0, 1 - (now - ts) / BRAKE_STOW_MS);
      // Write only on a real change, and keep retrying until the model
      // finishes loading, otherwise it renders in its rest pose, which
      // for this asset is gear DOWN with the bay doors hanging open.
      if (applied !== null && Math.abs(f - applied.f) < 0.002
          && Math.abs(bf - applied.bf) < 0.002) return;
      if (write(entity, f, bf)) applied = { f, bf };
    },
    /** Force a pose, for settling on screen what argument cannot:
     *    window.__isr_surfaces(1, 1)   gear down, spoilers out
     *    window.__isr_surfaces(0, 0)   gear up, spoilers stowed
     *  Returns how many nodes were actually written, which is the
     *  number that matters: zero means the model is not loaded or the
     *  names do not resolve. */
    force(entity, gearF, brakeF) {
      const n = write(entity, gearF, brakeF, true);
      applied = { f: gearF, bf: brakeF };
      return n;
    },
  };
}
