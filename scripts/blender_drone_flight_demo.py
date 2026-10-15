#!/usr/bin/env python3
"""Spin a drone's propellers and fly it through every attitude a quadcopter has.

Runs INSIDE Blender, headless. Takes any drone file Blender can open
(.blend, .glb/.gltf, .fbx, .obj), finds the propellers, and writes a new
.blend (and optionally an MP4) in which:

  * every propeller spins about its own hub, at a real hover rate, with
    diagonal pairs counter-rotating the way a DJI airframe does
    (front-right and rear-left anticlockwise seen from above, the other
    diagonal clockwise), and
  * the airframe flies a fixed sequence: hover, forward, brake, backward,
    slide right, slide left, descend, climb. Attitude is not keyframed by
    hand. A quadcopter can only move by tilting its thrust, so the tilt is
    derived every frame from acceleration plus drag:

        tilt axis   = up x (a + c_d * v)        horizontal
        tilt angle  = atan(|a + c_d * v| / g)   clamped to a real max

    which gives the behaviour people recognise without being told: nose
    down to go forward, nose UP (front rising, back dropping) to go
    backward or to brake, roll into a sideways slide, and a level body
    while descending or climbing because vertical motion is throttle,
    not tilt.

Why a script rather than hand animation
---------------------------------------
Because the asset is going to change. The DJI Mavic 3 Pro file is bought
and dropped in later; the assault_drone_concept.glb already in
public/aircraft/ stands in until then. The same command produces the same
demo from either, so the demo is reproducible and the propeller search is
written down rather than clicked.

Propeller detection
-------------------
1. Mesh objects whose name matches prop/rotor/blade/elice.
2. Failing that, every mesh is split into loose parts and the parts that
   are thin sheets (long in two axes, thin in the third), small relative
   to the airframe and sitting away from the centre are taken as blades.
   Whatever is chosen is printed, so a wrong pick is visible in the log.

Usage
-----
  /Applications/Blender.app/Contents/MacOS/Blender -b \
      --python scripts/blender_drone_flight_demo.py -- IN.glb --out OUT_DIR \
      [--forward -Y] [--prop-rps 92] [--fps 30] [--render] [--stills] \
      [--resolution 1280x720]

--forward is the model's nose axis in Blender space. Blender's own
convention is -Y (the Front view looks along +Y), and glTF's +Z nose
imports as -Y, so that is the default. Check the first still: if the nose
leads on the BACKWARD leg the axis is reversed, pass --forward +Y.
"""

import argparse
import math
import os
import re
import sys

import bpy
from mathutils import Quaternion, Vector

G = 9.81                      # m/s^2, the model is assumed to be in metres
PROP_NAME = re.compile(r"(prop|rotor|blade|elic|helic)", re.I)

# The flight plan: (label, body-frame target velocity in m/s, yaw rate in
# deg/s, seconds). Body frame is (forward, right, up) and turns with the
# heading, so a TURN is forward speed plus a yaw rate, and the roll into
# it is not scripted: it falls out of the centripetal acceleration the
# same way the pitch falls out of the linear one. Speeds are modest so
# the tilt stays readable; an Air 3 will do 21 m/s, which is not the
# point.
PLAN = [
    ("HOVER",          (0.0,  0.0,  0.0),   0.0, 1.5),
    ("FORWARD",        (6.0,  0.0,  0.0),   0.0, 3.0),
    ("TURN",           (5.0,  0.0,  0.0),  60.0, 3.0),
    ("FORWARD",        (6.0,  0.0,  0.0),   0.0, 1.5),
    ("BRAKE",          (0.0,  0.0,  0.0),   0.0, 2.0),
    ("BACKWARD",       (-4.0, 0.0,  0.0),   0.0, 3.0),
    ("STOP",           (0.0,  0.0,  0.0),   0.0, 1.5),
    ("SLIDE RIGHT",    (0.0,  4.0,  0.0),   0.0, 2.5),
    ("SLIDE LEFT",     (0.0, -4.0,  0.0),   0.0, 3.0),
    ("STOP",           (0.0,  0.0,  0.0),   0.0, 1.5),
    ("DESCEND",        (0.0,  0.0, -2.5),   0.0, 2.5),
    ("CLIMB",          (0.0,  0.0,  3.0),   0.0, 2.5),
    ("HOVER",          (0.0,  0.0,  0.0),   0.0, 1.5),
]
TAU_S = 1.2          # velocity time constant: how quickly it reaches target
DRAG = 0.30          # 1/s. c_d * v is the steady tilt at cruise: 6 m/s -> 10 deg
MAX_TILT_DEG = 32.0  # DJI's own limit is ~35 deg in sport mode


# ----------------------------------------------------------------------------
# Loading
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


# ----------------------------------------------------------------------------
# Propellers
# ----------------------------------------------------------------------------
def looks_like_blade(obj, airframe_size, centre):
    """A blade: a sheet, a fifth to a third of the airframe long, out at a
    corner. Measured on the DJI Air 3 (polyman): blades 0.96 x 0.76 x 0.19
    at ~1500 tris, flatness 4.4-5.4 because the blade is pitched so its
    box is not flat; the arm beside it is 1.51 long (0.38 of the
    airframe) and the body is 1.66. On assault_drone_concept the blades
    are 0.93 long at flatness 10.5 and the arms 0.93 at 5.1 but sit
    inboard. Length band plus flatness separates all of them."""
    lo, hi = world_bbox(obj)
    d = sorted([hi.x - lo.x, hi.y - lo.y, hi.z - lo.z])
    thin, mid, long = d
    if not (0.15 * airframe_size <= long <= 0.35 * airframe_size):
        return False
    if thin <= 0 or long / thin < 4.0:         # not a sheet
        return False
    c = (lo + hi) / 2
    if (c - centre).xy.length < 0.2 * airframe_size:   # on the body
        return False
    if len(obj.data.polygons) < 100:
        return False
    return True


def blade_length(obj):
    lo, hi = world_bbox(obj)
    return max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)


def majority_size(cands):
    """The blades are the largest set of near-identical sheets. On the Air 3
    the shape test also passes the two rear arms (1.51 long against the
    blades' 0.96 to 1.05); eight of one length beats two of another."""
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

    # Many exports already have one object per part; test those first.
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

    blades = majority_size([o for o in meshes() if looks_like_blade(o, airframe_size, centre)])
    print(f"props by geometry (loose parts): {[o.name for o in blades]}")
    return blades


def cluster_by_hub(blades, airframe_size):
    """Blades that share a hub spin together. Two blades of one rotor sit
    about one blade-length apart, centre to centre; neighbouring rotors sit
    more than two apart. 1.6 blade lengths splits them."""
    Ls = sorted(blade_length(b) for b in blades)
    radius = 1.6 * Ls[len(Ls) // 2]
    groups = []
    for b in blades:
        lo, hi = world_bbox(b)
        c = (lo + hi) / 2
        for g in groups:
            if (g["centre"] - c).xy.length < radius:
                g["objs"].append(b)
                n = len(g["objs"])
                g["centre"] = (g["centre"] * (n - 1) + c) / n
                break
        else:
            groups.append({"centre": c.copy(), "objs": [b]})
    return groups


def fcurves_of(obj):
    """Blender 4.4+ stores F-curves in layered actions; older ones on the action."""
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


def rig_props(groups, root, centre, fwd, right, rps, fps, frame_end):
    hubs = []
    for i, g in enumerate(groups, 1):
        lo, hi = scene_bbox(g["objs"])
        hub_pos = (lo + hi) / 2
        ext = [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z]
        axis_i = ext.index(min(ext))           # the disc is thin along its axis
        axis = Vector((0, 0, 0))
        axis[axis_i] = 1.0

        hub = bpy.data.objects.new(f"PropHub_{i}", None)
        hub.empty_display_size = 0.05
        bpy.context.scene.collection.objects.link(hub)
        hub.location = hub_pos
        hub.parent = root
        hub.matrix_parent_inverse = root.matrix_world.inverted()
        for o in g["objs"]:
            mw = o.matrix_world.copy()
            o.parent = hub
            o.matrix_parent_inverse = hub.matrix_world.inverted()
            o.matrix_world = mw

        # DJI sense: front-right and rear-left anticlockwise from above.
        rel = hub_pos - centre
        sense = 1.0 if (rel.dot(fwd) * rel.dot(right)) > 0 else -1.0
        if axis.z < 0:  # keep "from above" meaning the same whichever way the axis came out
            sense = -sense
        total = sense * 2 * math.pi * rps * (frame_end - 1) / fps
        hub.rotation_mode = "AXIS_ANGLE"
        hub.rotation_axis_angle = (0.0, axis.x, axis.y, axis.z)
        hub.keyframe_insert("rotation_axis_angle", frame=1)
        hub.rotation_axis_angle = (total, axis.x, axis.y, axis.z)
        hub.keyframe_insert("rotation_axis_angle", frame=frame_end)
        for fc in fcurves_of(hub):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
        print(f"  {hub.name}: {len(g['objs'])} blade(s) at {tuple(round(v, 3) for v in hub_pos)} "
              f"axis={'XYZ'[axis_i]} {'CCW' if sense > 0 else 'CW'} {rps} rps")
        hubs.append(hub)
    return hubs


# ----------------------------------------------------------------------------
# Flight
# ----------------------------------------------------------------------------
def fly(root, fwd, right, fps):
    up = Vector((0, 0, 1))
    root.rotation_mode = "QUATERNION"
    dt = 1.0 / fps
    pos = root.location.copy()
    v = Vector((0, 0, 0))
    max_tilt = math.radians(MAX_TILT_DEG)
    frame = 1
    phase_frames = []
    yaw = 0.0
    for label, body_v, yaw_dps, secs in PLAN:
        start = frame
        for _ in range(int(round(secs * fps))):
            yaw += math.radians(yaw_dps) * dt
            yaw_q = Quaternion(up, yaw)
            target = (yaw_q @ fwd) * body_v[0] + (yaw_q @ right) * body_v[1] + up * body_v[2]
            v_new = v + (target - v) * (1 - math.exp(-dt / TAU_S))
            a = (v_new - v) / dt
            v = v_new
            pos += v * dt
            # Thrust must cancel drag and provide the acceleration, so the
            # body tilts toward a + c_d v. Vertical speed is throttle only.
            eff = Vector((a.x + DRAG * v.x, a.y + DRAG * v.y, 0.0))
            if eff.length > 1e-6:
                angle = min(max_tilt, math.atan(eff.length / G))
                tilt_q = Quaternion(up.cross(eff).normalized(), angle)
            else:
                tilt_q = Quaternion((1, 0, 0, 0))
            # Yaw in the body first, then tilt about a world-horizontal
            # axis, so the thrust leans toward where it is going whatever
            # way the nose points.
            root.location = pos
            root.rotation_quaternion = tilt_q @ yaw_q
            root.keyframe_insert("location", frame=frame)
            root.keyframe_insert("rotation_quaternion", frame=frame)
            frame += 1
        phase_frames.append((label, start, frame - 1))
    return frame - 1, phase_frames


# ----------------------------------------------------------------------------
# Stage: camera, light, ground, labels
# ----------------------------------------------------------------------------
def stage(root, size, phase_frames, res):
    scene = bpy.context.scene
    coll = scene.collection

    # Ground: a checker so translation is visible even though the camera
    # follows the aircraft.
    # Big enough that forty metres of travel never reaches an edge, and
    # far enough below that four metres of descent never reaches it. A
    # quadcopter in a demo flies at a few metres, not at arm's length.
    floor = root.location.z - max(1.5 * size, 6.0)
    bpy.ops.mesh.primitive_plane_add(size=max(size * 600, 400.0), location=(0, 0, floor))
    ground = bpy.context.active_object
    ground.name = "Ground"
    mat = bpy.data.materials.new("GroundChecker")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    chk = nt.nodes.new("ShaderNodeTexChecker")
    # Checker scale is cells per object unit, and the plane's object
    # units are metres, so 1/size gives one cell per airframe length.
    # At 60 the cells were 1.7 cm and averaged to a flat grey.
    chk.inputs["Scale"].default_value = 1.0 / size
    chk.inputs["Color1"].default_value = (0.22, 0.24, 0.27, 1)
    chk.inputs["Color2"].default_value = (0.42, 0.44, 0.48, 1)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(coord.outputs["Object"], chk.inputs["Vector"])
    nt.links.new(chk.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    ground.data.materials.append(mat)

    # Camera on a pivot that copies the aircraft's position, so the
    # aircraft stays framed while the ground slides past.
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
    cam.location = Vector((2.6, -3.2, 1.5)) * size
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

    # One text label per phase, parented to the camera, shown only for
    # its own frames.
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
    scene.render.motion_blur_shutter = 0.5
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
    ap.add_argument("--prop-rps", type=float, default=92.0, help="Mavic 3 hover is ~5500 rpm")
    ap.add_argument("--size-m", type=float, default=None,
                    help="real length of the airframe's longest extent in metres; the file is "
                         "scaled to it so m/s and g mean what they say")
    ap.add_argument("--props", default=PROP_NAME.pattern,
                    help="regex for propeller object or parent names, overrides the shape test")
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

    # Drop any camera or light the file came with; we stage our own.
    for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(o)

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

    # One root empty everything hangs from; the flight is keyframed on it.
    root = bpy.data.objects.new("FlightRig", None)
    root.empty_display_size = size * 0.5
    scene.collection.objects.link(root)
    root.location = centre
    for o in [o for o in bpy.data.objects if o.parent is None and o is not root]:
        mw = o.matrix_world.copy()
        o.parent = root
        o.matrix_parent_inverse = root.matrix_world.inverted()
        o.matrix_world = mw

    bpy.context.view_layer.update()
    blades = find_props(centre, size, re.compile(args.props, re.I))
    if not blades:
        sys.exit("no propellers found: name them, or check the geometry heuristics")
    groups = cluster_by_hub(blades, size)
    print(f"{len(blades)} blade(s) in {len(groups)} rotor(s)")

    total_s = sum(p[3] for p in PLAN)
    frame_end = int(round(total_s * args.fps))
    scene.frame_start = 1
    scene.frame_end = frame_end
    rig_props(groups, root, centre, fwd, right, args.prop_rps, args.fps, frame_end)
    bpy.context.view_layer.update()

    if args.size_m:
        k = args.size_m / size
        root.scale = (k, k, k)
        root.location = centre * k
        size = args.size_m
        print(f"scaled by {k:.4f} to {size} m")
    bpy.context.view_layer.update()

    frame_end, phase_frames = fly(root, fwd, right, args.fps)
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
        # Blender 5 gates the movie formats behind media_type; older
        # builds expose FFMPEG directly on file_format.
        if hasattr(scene.render.image_settings, "media_type"):
            scene.render.image_settings.media_type = "VIDEO"
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
        scene.render.filepath = os.path.join(args.out, f"{stem}_flight_demo.mp4")
        bpy.ops.render.render(animation=True)
        print(f"wrote {scene.render.filepath}")


main()
