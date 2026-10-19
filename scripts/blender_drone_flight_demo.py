#!/usr/bin/env python3
"""Spin a drone's propellers and fly it the way a quadcopter actually flies.

Runs INSIDE Blender, headless. Takes any drone file Blender can open
(.blend, .glb/.gltf, .fbx, .obj), finds the propellers, and writes a new
.blend (and optionally an MP4) in which the airframe flies hover, forward,
a banked turn, brake, backward, slide right, slide left, descend, climb.

What is simulated, and why it is simulated rather than keyframed
-------------------------------------------------------------------
A quadcopter has one way to move sideways: lean its thrust. So the whole
motion is driven by a small flight-controller model, the same loop a DJI
runs, and the attitude you see is whatever that loop needed:

  1. The plan commands a velocity (stick input, or a mission waypoint).
  2. A velocity controller asks for an acceleration, capped at what the
     airframe can do (A_MAX).
  3. That plus drag gives a required lean: tan(lean) = |a + drag| / g,
     capped at the airframe's tilt limit (MAX_TILT).
  4. The ATTITUDE FOLLOWS THE DEMAND with a lag and a rate limit, because
     a body has inertia and the rotors have finite authority. This is what
     makes a real one tip into a move and roll out of it rather than snap.
  5. The actual acceleration is g*tan(lean) minus quadratic drag, and that
     is integrated to velocity and position. Nothing is read backwards.

So: nose down to go forward, nose UP to brake or fly backward, roll into
a slide, roll into a turn (the centripetal term), level on vertical legs
because vertical motion is throttle, not lean. Plus the things a real one
does that the shortcut never did:

  * Rotor speed per rotor. Base rate scaled by sqrt(thrust/weight), so it
    rises with lean and with climb and falls in descent; a small dip in
    slow forward flight (translational lift: arXiv 2109.04741 finds ~9%
    less power than hover at the endurance-optimal speed); a differential
    across the four during pitch/roll accelerations (front pair slows and
    rear speeds up to pitch nose-down) and between the CW and CCW pairs
    during yaw accelerations. The average barely moves in cruise. The
    transitions are where it changes, which is what the ear hears.
  * The camera gimbal stays level while the body leans (--gimbal-near).
  * Hover is not still: sub-degree attitude noise and a few centimetres of
    height wander, which the gimbal cancels. That contrast is the most
    recognisable thing about a hovering DJI.
  * The body rotates about its centre of mass (rotor centroid in plan,
    body centre in height), not the bounding-box centre.

The airframe envelope is the C2 platform's: TOP_SPEED_MS and DRAG_K are
the 30 m/s reconnaissance multirotor src/quad_flight_model.js flies, and
scripts/check-quad-flight.mjs gates the two files against each other.

Propellers spin about their own hubs, diagonal pairs counter-rotating the
way a DJI airframe does (front-right and rear-left anticlockwise from
above). The default rate is a readable 18 rps; the physical ~92 rps of an
Air 3 renders as a clear disc under motion blur and reads as no props at
all. Pass --prop-rps 92 for camera-true.

Propeller detection
-------------------
1. Mesh objects whose name (or parent's) matches --props (prop|rotor|blade).
2. Failing that, by shape: a sheet, 15 to 35 percent of the airframe long,
   off the body axis, and then the largest set of near-identical such
   sheets, which is what separates eight blades from two arms. Failing
   that, meshes are split into loose parts and tested the same way.
Whatever is chosen is printed, with what was dropped.

Usage
-----
  /Applications/Blender.app/Contents/MacOS/Blender -b \
      --python scripts/blender_drone_flight_demo.py -- IN.glb --out OUT_DIR \
      --forward +Y --size-m 0.5 [--gimbal-near x,y,z,r] [--prop-rps 18] \
      [--fps 30] [--render] [--stills] [--resolution 1280x720]

--forward is the nose axis in Blender space. Blender's convention is -Y
(the Front view looks along +Y) and glTF's +Z nose imports as -Y, so that
is the default; the DJI Air 3 export has its nose on +Y. If the nose leads
on the BACKWARD leg the axis is reversed.
--size-m is the real length of the longest extent; the file is scaled to
it so that m/s and g mean what they say.
--gimbal-near is a sphere in FILE units around the camera gimbal: meshes
whose centre lies inside are stabilised about that point. For the Air 3:
0,0.94,-0.49,0.13.
"""

import argparse
import math
import os
import re
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

G = 9.81
PROP_NAME = re.compile(r"(prop|rotor|blade|elic|helic)", re.I)

# The flight plan: (label, body-frame target velocity in m/s, yaw rate in
# deg/s, seconds). Body frame is (forward, right, up) and turns with the
# heading. Speeds are a 30 m/s reconnaissance multirotor, the airframe
# the C2 platform flies (src/quad_flight_model.js), not a shop-bought
# DJI. Durations come from the dynamics, not from taste: with the tilt
# limit at 32 degrees the airframe cannot accelerate harder than
# g*tan(32) = 6.1 m/s^2 whatever A_MAX says, so 0 to 25 m/s takes about
# 6 s against quadratic drag, 25 to 0 about 4 s. A turn at 8 m/s and
# 30 deg/s asks 4.2 m/s^2 of centripetal lean, inside the limit with
# room for drag, so it banks rather than skids; the SLOW leg before it
# is there so the turn is not entered at 25 m/s, where the same yaw rate
# would demand 13 m/s^2 and pin the lean. A pinned lean is the failure
# that shipped to the map once and read as the airframe lying on its
# side.
#
# src/drones.js mirrors this table as _DEMO_PLAN, so the map's
# cph_dji_flight_demo flies the same sequence. Change both.
PLAN = [
    ("HOVER",          (0.0,  0.0,  0.0),   0.0, 2.0),
    ("FORWARD",        (25.0, 0.0,  0.0),   0.0, 6.5),
    ("SLOW",           (8.0,  0.0,  0.0),   0.0, 3.0),
    ("TURN",           (8.0,  0.0,  0.0),  30.0, 6.0),
    ("FORWARD",        (25.0, 0.0,  0.0),   0.0, 5.0),
    ("BRAKE",          (0.0,  0.0,  0.0),   0.0, 4.5),
    ("BACKWARD",       (-8.0, 0.0,  0.0),   0.0, 3.0),
    ("STOP",           (0.0,  0.0,  0.0),   0.0, 2.0),
    ("SLIDE RIGHT",    (0.0,  8.0,  0.0),   0.0, 2.5),
    ("SLIDE LEFT",     (0.0, -8.0,  0.0),   0.0, 3.0),
    ("STOP",           (0.0,  0.0,  0.0),   0.0, 2.0),
    ("DESCEND",        (0.0,  0.0, -3.0),   0.0, 2.5),
    ("CLIMB",          (0.0,  0.0,  4.0),   0.0, 2.5),
    ("HOVER",          (0.0,  0.0,  0.0),   0.0, 2.0),
]

# Airframe and controller. Controller numbers are a DJI Air 3's where a
# public number exists; the airframe envelope is the platform's 30 m/s
# reconnaissance multirotor, because the C2 map and this render must be
# the same aircraft (scripts/check-quad-flight.mjs reads these out of
# this file and fails the build if src/quad_flight_model.js disagrees).
#
# Top speed is not a free parameter. It is fixed by the tilt limit and
# the drag:  v_max = sqrt(g * tan(MAX_TILT) / DRAG_K). So DRAG_K is
# derived from the airframe, DRAG_K = g * tan(MAX_TILT) / TOP_SPEED^2,
# and written here as the literal the gate parses:
#
#     0.0156     32 deg  ->  19.8 m/s   a DJI Air 3 flat out (the old value)
#     0.0068111  32 deg  ->  30.0 m/s   the recon airframe
#
# Asking the PLAN for more than v_max does nothing but pin the lean.
TOP_SPEED_MS = 30.0    # m/s, 108 km/h
MAX_TILT_DEG = 32.0    # DJI limits sport mode to ~35 deg; a little margin
A_MAX = 6.5            # m/s^2 asked of the velocity loop. Moot above g*tan(32) = 6.13:
                       # the tilt limit, not this, sets how hard it can accelerate
DRAG_K = 0.0068111     # 1/m, quadratic: 9.81 * tan(32 deg) / 30^2
KV = 1.2               # 1/s, velocity loop gain: 1 m/s error asks 1.2 m/s^2
ATT_TAU = 0.15         # s, attitude loop time constant. DJI inner loops are fast
ATT_RATE_DPS = 120.0   # deg/s, attitude slew limit, the rotors' authority
VZ_TAU = 0.6           # s, vertical speed response
YAW_TAU = 0.3          # s, yaw rate response
YAW_RATE_MAX_DPS = 100.0

# Rotor speed model. Thrust goes with the square of rotor speed.
TL_DIP = 0.03          # fractional speed dip from translational lift...
TL_SPEED = 7.0         # ...centred here (m/s)...
TL_WIDTH = 5.0         # ...and this wide. ~9% power is ~3% speed (power ~ w^3)
ATT_DIFF = 0.08        # +-8% across the airframe at full attitude acceleration
ATT_DIFF_REF = 14.0    # rad/s^2: the slew limit reached in one time constant
YAW_DIFF = 0.08        # +-8% between CW and CCW pairs at...
YAW_DIFF_REF = 3.5     # ...rad/s^2 of yaw acceleration
YAW_DAMP_DIFF = 0.02   # steady differential holding a 60 deg/s yaw against drag

# Hover noise: the flight controller correcting a body that drifts in its
# own downwash. Sub-degree, sub-Hertz to a couple of Hertz, a few cm.
NOISE_LEAN_DEG = (0.45, 0.30, 0.20)
NOISE_LEAN_HZ = (0.37, 0.91, 1.70)
NOISE_ALT_M = 0.03
NOISE_ALT_HZ = 0.29
NOISE_YAW_DEG = 0.4
NOISE_YAW_HZ = 0.23


# ----------------------------------------------------------------------------
# Loading and geometry
# ----------------------------------------------------------------------------
def load(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        sys.exit(f"unsupported input: {path}")


def meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def world_bbox(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def scene_bbox(objs):
    los, his = zip(*(world_bbox(o) for o in objs))
    lo = Vector((min(v.x for v in los), min(v.y for v in los), min(v.z for v in los)))
    hi = Vector((max(v.x for v in his), max(v.y for v in his), max(v.z for v in his)))
    return lo, hi


def bbox_centre(obj):
    lo, hi = world_bbox(obj)
    return (lo + hi) / 2


def reparent(obj, parent, parent_world):
    """Parent with explicit matrices. A freshly made object's matrix_world is
    identity until the depsgraph runs, so reading it back to build the
    parent inverse silently parents with a zero offset. Been there."""
    mw = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = parent_world.inverted()
    obj.matrix_basis = mw


def fcurves_of(obj):
    act = obj.animation_data.action
    if hasattr(act, "fcurves"):
        return act.fcurves
    slot = obj.animation_data.action_slot
    for layer in act.layers:
        for strip in layer.strips:
            bag = strip.channelbag(slot)
            if bag is not None:
                return bag.fcurves
    return []


# ----------------------------------------------------------------------------
# Propellers
# ----------------------------------------------------------------------------
def blade_length(obj):
    lo, hi = world_bbox(obj)
    return max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)


def looks_like_blade(obj, airframe_size, centre):
    """A sheet, a fifth to a third of the airframe long, out at a corner.
    Measured on the DJI Air 3: blades 0.96 x 0.76 x 0.19 at ~1500 tris,
    flatness 4.4-5.4 because a pitched blade's box is not flat; the arm
    beside it is 1.51 long and the body 1.66."""
    lo, hi = world_bbox(obj)
    thin, mid, long = sorted([hi.x - lo.x, hi.y - lo.y, hi.z - lo.z])
    if not (0.15 * airframe_size <= long <= 0.35 * airframe_size):
        return False
    if thin <= 0 or long / thin < 4.0:
        return False
    if (((lo + hi) / 2) - centre).xy.length < 0.2 * airframe_size:
        return False
    return len(obj.data.polygons) >= 100


def majority_size(cands):
    """The blades are the largest set of near-identical sheets. The Air 3's
    two rear arms also pass the shape test; eight of one length beats two
    of another."""
    groups = []
    for o in sorted(cands, key=blade_length):
        L = blade_length(o)
        for g in groups:
            if abs(g["L"] - L) <= 0.15 * g["L"]:
                g["objs"].append(o)
                break
        else:
            groups.append({"L": L, "objs": [o]})
    best = max(groups, key=lambda g: len(g["objs"]), default={"objs": []})
    dropped = [o.name for g in groups if g is not best for o in g["objs"]]
    if dropped:
        print(f"dropped as not blade-sized: {dropped}")
    return best["objs"]


def find_props(centre, airframe_size, name_re):
    named = [o for o in meshes() if name_re.search(o.name)
             or (o.parent is not None and name_re.search(o.parent.name))]
    if len(named) >= 2:
        print(f"props by name: {[o.name for o in named]}")
        return named
    blades = majority_size([o for o in meshes() if looks_like_blade(o, airframe_size, centre)])
    if len(blades) >= 2:
        print(f"props by geometry (separate objects): {[o.name for o in blades]}")
        return blades

    print("no propeller objects found, splitting meshes into loose parts")
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes():
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes()[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    blades = majority_size([o for o in meshes() if looks_like_blade(o, airframe_size, centre)])
    print(f"props by geometry (loose parts): {[o.name for o in blades]}")
    return blades


def cluster_by_hub(blades):
    """Two blades of one rotor sit about one blade-length apart, centre to
    centre; neighbouring rotors more than two. 1.6 blade lengths splits
    them."""
    Ls = sorted(blade_length(b) for b in blades)
    radius = 1.6 * Ls[len(Ls) // 2]
    groups = []
    for b in blades:
        c = bbox_centre(b)
        for g in groups:
            if (g["centre"] - c).xy.length < radius:
                g["objs"].append(b)
                n = len(g["objs"])
                g["centre"] = (g["centre"] * (n - 1) + c) / n
                break
        else:
            groups.append({"centre": c.copy(), "objs": [b]})
    return groups


def rig_props(groups, root, root_world, cg, fwd, right):
    """One empty per rotor at its hub, blades parented to it. Returns the
    rotor records fly() needs: the hub, its spin axis, its sense, and its
    position in the body frame."""
    rotors = []
    for i, g in enumerate(groups, 1):
        lo, hi = scene_bbox(g["objs"])
        hub_pos = (lo + hi) / 2
        ext = [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z]
        axis = Vector((0, 0, 0))
        axis["XYZ".index("XYZ"[ext.index(min(ext))])] = 1.0

        hub = bpy.data.objects.new(f"PropHub_{i}", None)
        hub.empty_display_size = 0.05
        bpy.context.scene.collection.objects.link(hub)
        hub_world = Matrix.Translation(hub_pos)
        hub.parent = root
        hub.matrix_parent_inverse = root_world.inverted()
        hub.matrix_basis = hub_world
        for o in g["objs"]:
            reparent(o, hub, hub_world)

        rel = hub_pos - cg
        bf, br = rel.dot(fwd), rel.dot(right)
        # DJI sense: front-right and rear-left anticlockwise from above.
        sense = 1.0 if bf * br > 0 else -1.0
        if axis.z < 0:
            sense = -sense
        hub.rotation_mode = "AXIS_ANGLE"
        rotors.append({"hub": hub, "axis": axis, "sense": sense,
                       "bf": bf, "br": br, "pos": hub_pos})
        print(f"  {hub.name}: {len(g['objs'])} blade(s) at {tuple(round(v, 3) for v in hub_pos)} "
              f"axis={'XYZ'[ext.index(min(ext))]} {'CCW' if sense > 0 else 'CW'}"
              f" body=({bf:+.2f} fwd, {br:+.2f} right)")
    return rotors


# ----------------------------------------------------------------------------
# Gimbal
# ----------------------------------------------------------------------------
def rig_gimbal(spec, root, root_world):
    if not spec:
        return None
    x, y, z, r = (float(v) for v in spec.split(","))
    pivot = Vector((x, y, z))
    parts = [o for o in meshes() if (bbox_centre(o) - pivot).length <= r]
    if not parts:
        print("gimbal: nothing inside the sphere, skipping")
        return None
    gim = bpy.data.objects.new("Gimbal", None)
    gim.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(gim)
    gim_world = Matrix.Translation(pivot)
    gim.parent = root
    gim.matrix_parent_inverse = root_world.inverted()
    gim.matrix_basis = gim_world
    gim.rotation_mode = "QUATERNION"
    for o in parts:
        reparent(o, gim, gim_world)
    print(f"gimbal: {len(parts)} mesh(es) about {tuple(round(v, 3) for v in pivot)}: "
          f"{[o.name for o in parts]}")
    return gim


# ----------------------------------------------------------------------------
# Flight
# ----------------------------------------------------------------------------
def clamp_len(v, m):
    return v * (m / v.length) if v.length > m else v


def noise(t, amps, hzs, phase):
    return sum(a * math.sin(2 * math.pi * h * t + phase + 0.7 * k)
               for k, (a, h) in enumerate(zip(amps, hzs)))


def fly(root, rotors, gimbal, fwd, right, fps, rps):
    up = Vector((0, 0, 1))
    root.rotation_mode = "QUATERNION"
    dt = 1.0 / fps
    pos = root.location.copy()
    z0 = pos.z
    v = Vector((0, 0, 0))            # world velocity, m/s
    lean = Vector((0, 0, 0))         # horizontal lean vector, radians, world
    lean_rate_prev = Vector((0, 0, 0))
    yaw, yaw_rate, yaw_rate_prev = 0.0, 0.0, 0.0
    theta = [0.0] * len(rotors)      # accumulated prop angle, rad
    max_tilt = math.radians(MAX_TILT_DEG)
    slew = math.radians(ATT_RATE_DPS) * dt
    yaw_max = math.radians(YAW_RATE_MAX_DPS)
    lean_amps = [math.radians(a) for a in NOISE_LEAN_DEG]

    frame = 1
    phase_frames = []
    for label, body_v, yaw_dps, secs in PLAN:
        start = frame
        for _ in range(int(round(secs * fps))):
            t = frame * dt

            # --- yaw: rate command, first-order response, rate limit
            yaw_rate_cmd = max(-yaw_max, min(yaw_max, math.radians(yaw_dps)))
            yaw_rate += (yaw_rate_cmd - yaw_rate) * (1 - math.exp(-dt / YAW_TAU))
            yaw_acc = (yaw_rate - yaw_rate_prev) / dt
            yaw_rate_prev = yaw_rate
            yaw += yaw_rate * dt
            yaw_q = Quaternion(up, yaw)
            f_w, r_w = yaw_q @ fwd, yaw_q @ right

            # --- horizontal: velocity loop -> lean demand -> attitude -> accel
            v_t = f_w * body_v[0] + r_w * body_v[1]
            v_h = Vector((v.x, v.y, 0.0))
            a_des = clamp_len((v_t - v_h) * KV, A_MAX)
            drag = v_h * (DRAG_K * v_h.length)
            need = a_des + drag                      # what the thrust must supply
            lean_des = Vector((0, 0, 0))
            if need.length > 1e-6:
                lean_des = need.normalized() * min(max_tilt, math.atan(need.length / G))
            step = (lean_des - lean) * (1 - math.exp(-dt / ATT_TAU))
            lean += clamp_len(step, slew)
            lean_rate = (lean - (lean - clamp_len(step, slew))) / dt
            lean_acc = (lean_rate - lean_rate_prev) / dt
            lean_rate_prev = lean_rate
            a_h = Vector((0, 0, 0))
            if lean.length > 1e-9:
                a_h = lean.normalized() * (G * math.tan(lean.length)) - drag

            # --- vertical: throttle, first-order response
            vz_t = body_v[2]
            v.z += (vz_t - v.z) * (1 - math.exp(-dt / VZ_TAU))
            az = (vz_t - v.z) / VZ_TAU
            v.x += a_h.x * dt
            v.y += a_h.y * dt
            pos += v * dt

            # --- hover noise on top; the gimbal will cancel the attitude part
            n_lean = Vector((noise(t, lean_amps, NOISE_LEAN_HZ, 0.0),
                             noise(t, lean_amps, NOISE_LEAN_HZ, 2.1), 0.0))
            n_alt = NOISE_ALT_M * math.sin(2 * math.pi * NOISE_ALT_HZ * t)
            n_yaw = math.radians(NOISE_YAW_DEG) * math.sin(2 * math.pi * NOISE_YAW_HZ * t + 1.3)
            lean_shown = lean + n_lean
            yaw_shown_q = Quaternion(up, yaw + n_yaw)
            tilt_q = Quaternion((1, 0, 0, 0))
            if lean_shown.length > 1e-9:
                tilt_q = Quaternion(up.cross(lean_shown).normalized(), lean_shown.length)

            root.location = Vector((pos.x, pos.y, pos.z + n_alt))
            root.rotation_quaternion = tilt_q @ yaw_shown_q
            root.keyframe_insert("location", frame=frame)
            root.keyframe_insert("rotation_quaternion", frame=frame)

            if gimbal is not None:
                # World rotation must be yaw only: body @ local = yaw.
                gimbal.rotation_quaternion = yaw_shown_q.inverted() @ tilt_q.inverted() @ yaw_shown_q
                gimbal.keyframe_insert("rotation_quaternion", frame=frame)

            # --- rotor speeds
            thrust_w = math.sqrt((need.length / G) ** 2 + (1 + az / G) ** 2)
            speed = v_h.length
            tl = 1 - TL_DIP * math.exp(-((speed - TL_SPEED) / TL_WIDTH) ** 2)
            base = rps * math.sqrt(max(0.2, thrust_w)) * tl
            # Leaning toward d needs the rotors on the +d side to drop and
            # the -d side to rise. lean_acc is in world; take it to body.
            acc_f, acc_r = lean_acc.dot(f_w), lean_acc.dot(r_w)
            for i, R in enumerate(rotors):
                reach = math.hypot(R["bf"], R["br"]) or 1.0
                d_att = -ATT_DIFF * (R["bf"] * acc_f + R["br"] * acc_r) / reach / ATT_DIFF_REF
                # Reaction torque opposes spin: to yaw the body anticlockwise
                # the CLOCKWISE rotors speed up. Hence minus sense.
                d_yaw = -R["sense"] * (YAW_DIFF * yaw_acc / YAW_DIFF_REF
                                       + YAW_DAMP_DIFF * yaw_rate / math.radians(60))
                w = base * (1 + max(-0.2, min(0.2, d_att + d_yaw)))
                theta[i] += R["sense"] * 2 * math.pi * w * dt
                R["hub"].rotation_axis_angle = (theta[i], R["axis"].x, R["axis"].y, R["axis"].z)
                R["hub"].keyframe_insert("rotation_axis_angle", frame=frame)
            frame += 1
        phase_frames.append((label, start, frame - 1))

    for R in rotors:
        for fc in fcurves_of(R["hub"]):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    return frame - 1, phase_frames


# ----------------------------------------------------------------------------
# Stage: camera, light, ground, labels
# ----------------------------------------------------------------------------
def stage(root, size, phase_frames, res, floor_below=None, cam_offset=(2.6, -3.2, 1.5)):
    """Ground, chase camera, sun, phase labels. floor_below is metres under
    the start height (default: 1.5 airframes, at least 6 m, a quadcopter
    demo); cam_offset is in airframe lengths."""
    scene = bpy.context.scene
    coll = scene.collection

    floor = root.location.z - (floor_below if floor_below is not None else max(1.5 * size, 6.0))
    bpy.ops.mesh.primitive_plane_add(size=max(size * 600, 1200.0), location=(0, 0, floor))
    ground = bpy.context.active_object
    ground.name = "Ground"
    mat = bpy.data.materials.new("GroundChecker")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    chk = nt.nodes.new("ShaderNodeTexChecker")
    chk.inputs["Scale"].default_value = 1.0 / size      # one cell per airframe length
    chk.inputs["Color1"].default_value = (0.22, 0.24, 0.27, 1)
    chk.inputs["Color2"].default_value = (0.42, 0.44, 0.48, 1)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(coord.outputs["Object"], chk.inputs["Vector"])
    nt.links.new(chk.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    ground.data.materials.append(mat)

    pivot = bpy.data.objects.new("CamPivot", None)
    coll.objects.link(pivot)
    c = pivot.constraints.new("COPY_LOCATION")
    c.target = root
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 50
    cam_data.clip_end = 2000.0
    cam = bpy.data.objects.new("Camera", cam_data)
    coll.objects.link(cam)
    cam.parent = pivot
    cam.location = Vector(cam_offset) * size
    t = cam.constraints.new("TRACK_TO")
    t.target = root
    t.track_axis = "TRACK_NEGATIVE_Z"
    t.up_axis = "UP_Y"
    scene.camera = cam

    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = 3.0
    sun_data.angle = math.radians(2)
    sun = bpy.data.objects.new("Sun", sun_data)
    coll.objects.link(sun)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.55, 0.62, 0.72, 1)
        bg.inputs["Strength"].default_value = 1.0

    font_mat = bpy.data.materials.new("Label")
    font_mat.use_nodes = True
    font_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1, 1, 1, 1)
    font_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 2.0
    last = phase_frames[-1][2]
    for i, (label, f0, f1) in enumerate(phase_frames):
        cur = bpy.data.curves.new(f"Label_{i}", "FONT")
        cur.body = label
        cur.size = 0.035
        txt = bpy.data.objects.new(f"Label_{i}_{label}", cur)
        coll.objects.link(txt)
        txt.data.materials.append(font_mat)
        txt.parent = cam
        # Camera space, 1 unit in front of a 50 mm lens on a 36 mm sensor:
        # the frame spans +-0.36 across and +-0.2025 down at 16:9.
        txt.location = (-0.33, -0.18, -1.0)
        for f, hidden in ((1, True), (f0, False), (f1 + 1, True)):
            if f > last:
                continue
            txt.hide_render = hidden
            txt.hide_viewport = hidden
            txt.keyframe_insert("hide_render", frame=f)
            txt.keyframe_insert("hide_viewport", frame=f)

    w, h = res
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.engine = "BLENDER_EEVEE" if hasattr(bpy.types, "SceneEEVEE") else "BLENDER_EEVEE_NEXT"
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.3
    try:
        scene.eevee.motion_blur_steps = 8
    except AttributeError:
        pass
    scene.render.film_transparent = False


# ----------------------------------------------------------------------------
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("--out", required=True)
    ap.add_argument("--forward", default="-Y", help="nose axis in Blender space: +X -X +Y -Y")
    ap.add_argument("--prop-rps", type=float, default=18.0,
                    help="hover rotor speed, revolutions per second. An Air 3 hovers at ~92, "
                         "which under motion blur at 30 fps renders as a clear disc and reads "
                         "as no propellers. 18 is a visible 65 degree blur arc per frame.")
    ap.add_argument("--size-m", type=float, default=None,
                    help="real length of the airframe's longest extent in metres")
    ap.add_argument("--props", default=PROP_NAME.pattern,
                    help="regex for propeller object or parent names, overrides the shape test")
    ap.add_argument("--gimbal-near", default=None,
                    help="x,y,z,r in file units: meshes centred inside the sphere are the "
                         "camera gimbal and are kept level about (x,y,z)")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--resolution", default="1280x720")
    ap.add_argument("--render", action="store_true", help="also render the MP4")
    ap.add_argument("--stills", action="store_true", help="render one PNG per phase midpoint")
    args = ap.parse_args(argv)

    load(args.input)
    os.makedirs(args.out, exist_ok=True)
    stem = os.path.splitext(os.path.basename(args.input))[0]
    scene = bpy.context.scene
    scene.render.fps = args.fps
    for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(o)
    bpy.context.view_layer.update()

    ms = meshes()
    if not ms:
        sys.exit("no meshes in file")
    lo, hi = scene_bbox(ms)
    centre = (lo + hi) / 2
    size = max(hi - lo)
    print(f"airframe bbox {tuple(round(v,3) for v in lo)} .. {tuple(round(v,3) for v in hi)}, size {size:.3f}")

    sign = -1.0 if args.forward.startswith("-") else 1.0
    fwd = Vector((0, 0, 0))
    fwd["XYZ".index(args.forward[-1].upper())] = sign
    up = Vector((0, 0, 1))
    right = fwd.cross(up)
    print(f"forward {tuple(fwd)}, right {tuple(right)}")

    # Find the blades before anything is reparented, then put the pivot at
    # the centre of mass: rotor centroid in plan, body centre in height.
    blades = find_props(centre, size, re.compile(args.props, re.I))
    if not blades:
        sys.exit("no propellers found: name them, pass --props, or check the shape test")
    groups = cluster_by_hub(blades)
    hub_xy = sum((g["centre"] for g in groups), Vector()) / len(groups)
    cg = Vector((hub_xy.x, hub_xy.y, centre.z))
    print(f"{len(blades)} blade(s) in {len(groups)} rotor(s); pivot at {tuple(round(v,3) for v in cg)}")

    root = bpy.data.objects.new("FlightRig", None)
    root.empty_display_size = size * 0.5
    scene.collection.objects.link(root)
    root_world = Matrix.Translation(cg)
    root.matrix_basis = root_world
    for o in [o for o in bpy.data.objects if o.parent is None and o is not root]:
        reparent(o, root, root_world)
    rotors = rig_props(groups, root, root_world, cg, fwd, right)
    gimbal = rig_gimbal(args.gimbal_near, root, root_world)

    if args.size_m:
        k = args.size_m / size
        root.scale = (k, k, k)
        root.location = cg * k
        size = args.size_m
        print(f"scaled by {k:.4f} to {size} m")
    bpy.context.view_layer.update()

    total_s = sum(p[3] for p in PLAN)
    scene.frame_start = 1
    scene.frame_end = int(round(total_s * args.fps))
    frame_end, phase_frames = fly(root, rotors, gimbal, fwd, right, args.fps, args.prop_rps)
    scene.frame_end = frame_end
    w, h = (int(x) for x in args.resolution.lower().split("x"))
    stage(root, size, phase_frames, (w, h))
    for label, f0, f1 in phase_frames:
        print(f"  {label:12} frames {f0:4}-{f1:4}")

    blend_path = os.path.join(args.out, f"{stem}_flight_demo.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"wrote {blend_path}")

    if args.stills:
        if hasattr(scene.render.image_settings, "media_type"):
            scene.render.image_settings.media_type = "IMAGE"
        scene.render.image_settings.file_format = "PNG"
        for label, f0, f1 in phase_frames:
            mid = (f0 + f1) // 2
            scene.frame_set(mid)
            scene.render.filepath = os.path.join(args.out, f"{stem}_{mid:04d}_{label.replace(' ', '_')}.png")
            bpy.ops.render.render(write_still=True)
            print(f"wrote {scene.render.filepath}")

    if args.render:
        if hasattr(scene.render.image_settings, "media_type"):
            scene.render.image_settings.media_type = "VIDEO"
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "HIGH"
        scene.render.filepath = os.path.join(args.out, f"{stem}_flight_demo.mp4")
        bpy.ops.render.render(animation=True)
        print(f"wrote {scene.render.filepath}")


if __name__ == "__main__":
    main()
