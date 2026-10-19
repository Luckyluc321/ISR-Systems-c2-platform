#!/usr/bin/env python3
"""Fly a fixed-wing UAV the way a fixed-wing UAV flies, in Blender, headless.

The sibling of scripts/blender_drone_flight_demo.py, for an airframe that
cannot hover: it shares that file's loading, propeller detection, staging
and parenting helpers, and replaces the quadcopter's thrust-lean loop with
a light-aircraft one. Same principle: NOTHING IS KEYFRAMED BY HAND. The
plan commands speed, climb rate and turn rate; a small autopilot turns
those into bank and pitch; the aircraft's path follows from the attitude
it actually has.

What is simulated
-----------------
  * A COORDINATED TURN. The plan asks for a turn rate; the bank needed is
    atan(V w / g); the aircraft rolls toward it at a finite roll rate with
    a lag; and the turn rate it GETS is g tan(bank) / V from the bank it
    HAS. So the heading starts changing as the wings go over, not before,
    and a faster aircraft needs more bank for the same turn.
  * PITCH LEADS THE FLIGHT PATH. A climb is commanded as a climb rate; the
    nose pitches toward the flight-path angle plus angle of attack at a
    finite pitch rate, and the flight path follows the nose with a lag.
    The nose goes up, THEN the aircraft climbs.
  * ANGLE OF ATTACK. Grows as the square of (cruise speed / speed) and
    with the load factor 1/cos(bank): slow down and the nose rides high;
    bank hard and it rises a little to hold altitude.
  * SPEED. Follows the command through a longitudinal acceleration cap,
    which for a 100 hp class airframe is modest. Throttle is inferred
    from the speed held plus the acceleration asked, and drives the
    propeller rate: it rises on the climb and the fast pass, falls in the
    descent and on the slow leg.
  * TURBULENCE. Sub-degree pitch and roll at a few tenths of a Hertz, so
    a straight leg is not a frozen render.

The numbers are TB2-class and stated as assumptions. The asset this was
written against is Baykar's Sivrisinek loitering munition (Ozcan Ozaltin,
Sketchfab, CC-BY), for which Baykar publishes no performance data.

Usage
-----
  /Applications/Blender.app/Contents/MacOS/Blender -b \
      --python scripts/blender_fixedwing_flight_demo.py -- IN.glb --out OUT_DIR \
      [--forward -Y] [--size-m 4.25] [--prop-rps 18] [--props REGEX] \
      [--pivot x,y,z] [--render] [--stills] [--resolution 1280x720]
"""

import argparse
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

import blender_drone_flight_demo as Q  # noqa: E402

G = 9.81
PROP_NAME = re.compile(r"(prop|pervane|elic|helic|airscrew)", re.I)

# The plan: (label, speed m/s, climb rate m/s, turn rate deg/s, seconds).
# Turn rate positive is LEFT (anticlockwise from above). Durations come
# from the dynamics: at 36 m/s a 10 deg/s turn needs 33 degrees of bank,
# which takes about a second to roll into, and 90 degrees of heading then
# takes nine seconds. Speed changes are slow on 100 hp: 36 to 50 m/s
# takes twelve seconds at the acceleration cap and 50 to 27 about
# thirteen at the deceleration cap, so those legs are long. The slow leg
# is where the nose rides highest.
PLAN = [
    ("CRUISE",      36.0,  0.0,   0.0,  4.0),
    ("CLIMB",       36.0,  4.0,   0.0,  7.0),
    ("LEVEL",       36.0,  0.0,   0.0,  3.0),
    ("LEFT TURN",   36.0,  0.0,  10.0,  9.0),
    ("LEVEL",       36.0,  0.0,   0.0,  3.0),
    ("DESCENT",     40.0, -4.0,   0.0,  7.0),
    ("LEVEL",       36.0,  0.0,   0.0,  3.0),
    ("RIGHT TURN",  36.0,  0.0, -10.0,  9.0),
    ("FAST",        50.0,  0.0,   0.0, 13.0),
    ("SLOW",        27.0,  0.0,   0.0, 14.0),
    ("CRUISE",      36.0,  0.0,   0.0,  5.0),
]

# Airframe, TB2-class. Cruise 130 km/h and a 120 kt maximum are Baykar's
# published TB2 figures; the rest are judgements for a 100 hp pusher of
# that size and are named so they can be argued with.
V_CRUISE = 36.0        # m/s, 130 km/h
V_MIN = 24.0           # m/s, just above the stall; the plan never goes there
A_LONG = 1.2           # m/s^2, acceleration cap: 100 hp pushing 600 kg has little spare
A_DECEL = 1.8          # m/s^2, deceleration cap: idle throttle and drag come faster
KV = 0.6               # 1/s, speed loop gain
MAX_BANK_DEG = 45.0
ROLL_RATE_DPS = 40.0   # deg/s
ROLL_TAU = 0.35        # s
ALPHA_CRUISE_DEG = 3.5 # angle of attack at cruise, level; ~6 deg at the slow leg's 27 m/s
ALPHA_MAX_DEG = 11.0
GAMMA_MAX_DEG = 12.0   # flight-path angle limit
PITCH_RATE_DPS = 6.0   # deg/s
PITCH_TAU = 0.5        # s
GAMMA_TAU = 1.2        # s, the flight path's lag behind the nose
THR_IDLE = 0.15
TURB_PITCH_DEG = (0.25, 0.15)
TURB_PITCH_HZ = (0.21, 0.47)
TURB_ROLL_DEG = (0.45, 0.25)
TURB_ROLL_HZ = (0.17, 0.39)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def ease(cur, target, tau, dt, slew=None):
    step = (target - cur) * (1 - math.exp(-dt / tau))
    if slew is not None:
        step = clamp(step, -slew, slew)
    return cur + step


def noise(t, amps, hzs, phase):
    return sum(a * math.sin(2 * math.pi * h * t + phase + 0.9 * k)
               for k, (a, h) in enumerate(zip(amps, hzs)))


def fly(root, rotors, fwd0, right0, fps, rps):
    up = Vector((0, 0, 1))
    root.rotation_mode = "QUATERNION"
    dt = 1.0 / fps
    pos = root.location.copy()
    V = PLAN[0][1]
    psi = 0.0                       # heading, rad, +ve left
    bank = 0.0                      # rad, +ve right wing down
    theta = math.radians(ALPHA_CRUISE_DEG)   # pitch
    gamma = 0.0                     # flight-path angle
    theta_shown = [0.0] * len(rotors)
    max_bank = math.radians(MAX_BANK_DEG)
    roll_slew = math.radians(ROLL_RATE_DPS) * dt
    pitch_slew = math.radians(PITCH_RATE_DPS) * dt
    gamma_max = math.radians(GAMMA_MAX_DEG)
    tp = [math.radians(a) for a in TURB_PITCH_DEG]
    tr = [math.radians(a) for a in TURB_ROLL_DEG]

    frame = 1
    phase_frames = []
    for label, v_t, vz_t, turn_dps, secs in PLAN:
        start = frame
        for _ in range(int(round(secs * fps))):
            t = frame * dt

            # --- speed
            dV = clamp((v_t - V) * KV, -A_DECEL, A_LONG)
            V = max(V_MIN, V + dV * dt)
            # Throttle: what holds this speed, plus what the acceleration
            # and the climb ask. Inferred, for the propeller.
            thr = clamp(0.55 * (V / V_CRUISE) ** 2 + 0.25 * dV / A_LONG
                        + 0.6 * math.sin(gamma) * V / 4.0 + 0.15, THR_IDLE, 1.0)

            # --- bank, and the turn that the bank produces
            w_t = math.radians(turn_dps)
            bank_des = clamp(-math.atan(V * w_t / G), -max_bank, max_bank)
            bank = ease(bank, bank_des, ROLL_TAU, dt, roll_slew)
            w = -G * math.tan(bank) / V
            psi += w * dt

            # --- pitch leads, flight path follows
            n = 1 / max(0.3, math.cos(bank))
            alpha = clamp(math.radians(ALPHA_CRUISE_DEG) * (V_CRUISE / V) ** 2 * n,
                          math.radians(0.5), math.radians(ALPHA_MAX_DEG))
            gamma_des = clamp(math.asin(clamp(vz_t / V, -0.5, 0.5)), -gamma_max, gamma_max)
            theta = ease(theta, gamma_des + alpha, PITCH_TAU, dt, pitch_slew)
            gamma = ease(gamma, theta - alpha, GAMMA_TAU, dt)

            # --- motion
            yaw_q = Quaternion(up, psi)
            f_w = yaw_q @ fwd0
            vel = f_w * (V * math.cos(gamma)) + up * (V * math.sin(gamma))
            pos += vel * dt

            # --- attitude: yaw, then pitch about the body right axis,
            # then roll about the body forward axis (aerospace Z-Y-X)
            th = theta + noise(t, tp, TURB_PITCH_HZ, 0.3)
            ph = bank + noise(t, tr, TURB_ROLL_HZ, 1.9)
            q = yaw_q @ Quaternion(right0, th) @ Quaternion(fwd0, ph)
            root.location = pos
            root.rotation_quaternion = q
            root.keyframe_insert("location", frame=frame)
            root.keyframe_insert("rotation_quaternion", frame=frame)

            # --- propeller, throttle-driven
            w_prop = rps * (0.55 + 0.45 * thr)
            for i, R in enumerate(rotors):
                theta_shown[i] += R["sense"] * 2 * math.pi * w_prop * dt
                R["hub"].rotation_axis_angle = (theta_shown[i], R["axis"].x, R["axis"].y, R["axis"].z)
                R["hub"].keyframe_insert("rotation_axis_angle", frame=frame)
            frame += 1
        phase_frames.append((label, start, frame - 1))

    for R in rotors:
        for fc in Q.fcurves_of(R["hub"]):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    return frame - 1, phase_frames


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("--out", required=True)
    ap.add_argument("--forward", default="-Y")
    ap.add_argument("--prop-rps", type=float, default=18.0,
                    help="cruise propeller rate. A Rotax-class pusher turns ~40; 18 reads on camera")
    ap.add_argument("--size-m", type=float, default=None, help="real length of the longest extent")
    ap.add_argument("--props", default=PROP_NAME.pattern)
    ap.add_argument("--pivot", default=None, help="x,y,z in file units; default is the wing's centre")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--resolution", default="1280x720")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--stills", action="store_true")
    args = ap.parse_args(argv)

    Q.load(args.input)
    # The file's own animation (this one carries a propeller clip) would
    # fight the hub we drive. Drop it; the propeller is ours now.
    for o in bpy.data.objects:
        o.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    os.makedirs(args.out, exist_ok=True)
    stem = os.path.splitext(os.path.basename(args.input))[0]
    scene = bpy.context.scene
    scene.render.fps = args.fps
    for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(o)
    bpy.context.view_layer.update()

    ms = Q.meshes()
    lo, hi = Q.scene_bbox(ms)
    centre = (lo + hi) / 2
    size = max(hi - lo)
    print(f"airframe bbox {tuple(round(v,3) for v in lo)} .. {tuple(round(v,3) for v in hi)}, size {size:.3f}")

    sign = -1.0 if args.forward.startswith("-") else 1.0
    fwd = Vector((0, 0, 0))
    fwd["XYZ".index(args.forward[-1].upper())] = sign
    up = Vector((0, 0, 1))
    right = fwd.cross(up)
    print(f"forward {tuple(fwd)}, right {tuple(right)}")

    blades = Q.find_props(centre, size, re.compile(args.props, re.I))
    if not blades:
        sys.exit("no propeller found: pass --props")
    groups = Q.cluster_by_hub(blades)

    # Pivot: the wing's centre if a wing is named, else the bbox centre.
    if args.pivot:
        cg = Vector(float(v) for v in args.pivot.split(","))
    else:
        wings = [o for o in ms if re.search(r"(wing|kanat)", o.name, re.I)]
        cg = Q.bbox_centre(max(wings, key=lambda o: len(o.data.polygons))) if wings else centre
    print(f"{len(blades)} blade(s) in {len(groups)} propeller(s); pivot at {tuple(round(v,3) for v in cg)}")

    root = bpy.data.objects.new("FlightRig", None)
    root.empty_display_size = size * 0.5
    scene.collection.objects.link(root)
    root_world = Matrix.Translation(cg)
    root.matrix_basis = root_world
    for o in [o for o in bpy.data.objects if o.parent is None and o is not root]:
        Q.reparent(o, root, root_world)
    rotors = Q.rig_props(groups, root, root_world, cg, fwd, right)

    if args.size_m:
        k = args.size_m / size
        root.scale = (k, k, k)
        root.location = cg * k
        size = args.size_m
        print(f"scaled by {k:.4f} to {size} m")
    bpy.context.view_layer.update()

    total_s = sum(p[4] for p in PLAN)
    scene.frame_start = 1
    scene.frame_end = int(round(total_s * args.fps))
    frame_end, phase_frames = fly(root, rotors, fwd, right, args.fps, args.prop_rps)
    scene.frame_end = frame_end
    w, h = (int(x) for x in args.resolution.lower().split("x"))
    # An aircraft flies high over its ground and is watched from further
    # back than a quadcopter.
    Q.stage(root, size, phase_frames, (w, h), floor_below=max(10.0 * size, 40.0),
            cam_offset=(2.2, -3.0, 0.9))
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
