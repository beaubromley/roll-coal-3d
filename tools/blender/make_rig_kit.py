"""
Generates the rig prop kit + a jointed crew as .glb files in public/models/.

Run headless:
    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P tools/blender/make_rig_kit.py

Conventions
  * Blender Z-up, metres. FRONT of every model faces Blender -Y (becomes +Z in the game).
  * Props: origin at base centre. Crew parts: each object's origin is its JOINT (geometry hangs below it), so the
    game can parent the parts to pivot nodes and bend knees / elbows.
  * Material names are fixed so the game can recolour them at load: shirt, pants, skin, hat, vest, stripe, glove, boot,
    belt, dark, steel, dsteel, pipe, band, red, blue, bopred, bopblue, white, poly, lamp (emissive), glass.
"""
import math
import os

import bpy

OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "public", "models"))
os.makedirs(OUT_DIR, exist_ok=True)


# ----------------------------------------------------------------- helpers
_MATS = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()


def mat(name, color, metallic=0.0, roughness=0.6, emit=0.0):
    m = _MATS.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        _MATS[name] = m
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if emit > 0:
        b.inputs["Emission Color"].default_value = (*color, 1.0)
        b.inputs["Emission Strength"].default_value = emit
    return m


def palette():
    return {
        "shirt": mat("shirt", (0.2, 0.37, 0.56)), "pants": mat("pants", (0.54, 0.48, 0.35)),
        "skin": mat("skin", (0.85, 0.65, 0.5), 0, 0.7), "hat": mat("hat", (0.95, 0.95, 0.95), 0, 0.4),
        "vest": mat("vest", (0.9, 0.95, 0.15)), "stripe": mat("stripe", (0.8, 0.82, 0.84), 0.1, 0.4),
        "glove": mat("glove", (0.17, 0.13, 0.09)), "boot": mat("boot", (0.16, 0.11, 0.07), 0, 0.5),
        "belt": mat("belt", (0.12, 0.1, 0.08)), "dark": mat("dark", (0.07, 0.07, 0.08), 0.2, 0.5),
        "steel": mat("steel", (0.5, 0.53, 0.57), 0.5, 0.45), "dsteel": mat("dsteel", (0.2, 0.22, 0.25), 0.4, 0.5),
        "pipe": mat("pipe", (0.55, 0.57, 0.6), 0.4, 0.4), "band": mat("band", (0.9, 0.72, 0.14)),
        "red": mat("red", (0.7, 0.14, 0.11)), "blue": mat("blue", (0.17, 0.36, 0.54)),
        "bopred": mat("bopred", (0.66, 0.13, 0.11)), "bopblue": mat("bopblue", (0.14, 0.31, 0.56)),
        "white": mat("white", (0.88, 0.89, 0.9)), "poly": mat("poly", (0.11, 0.44, 0.71)),
        "lamp": mat("lamp", (1.0, 0.92, 0.62), 0, 0.4, emit=3.0), "glass": mat("glass", (0.3, 0.45, 0.55), 0.6, 0.1),
        "rust": mat("rust", (0.45, 0.25, 0.16)), "green": mat("green", (0.18, 0.48, 0.27)),
    }


def _active(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def bevel(o, width=0.02, seg=2):
    _active(o)
    mod = o.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = seg
    mod.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=mod.name)


def _finish(o, m, bev):
    _active(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if bev:
        bevel(o, bev, 2 if bev > 0.012 else 1)
    o.data.materials.append(m)
    return o


def box(size, loc, m, bev=0.015, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    return _finish(o, m, bev)


def cyl(r, depth, loc, m, verts=16, rot=(0, 0, 0), bev=0.0, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    o = bpy.context.active_object
    return _finish(o, m, bev)


def sphere(r, loc, m, scale=(1, 1, 1), segs=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=segs, ring_count=max(8, segs // 2), location=loc)
    o = bpy.context.active_object
    o.scale = scale
    return _finish(o, m, 0)


def group(name, objs, smooth=False):
    """Join objs into one object called `name` (origin stays at world 0,0,0)."""
    _active(objs[0])
    if len(objs) > 1:
        for o in objs:
            o.select_set(True)
        bpy.ops.object.join()
    j = bpy.context.active_object
    j.name = name
    j.data.name = name
    if smooth:
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
        except Exception:
            bpy.ops.object.shade_smooth()
    else:
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))
        except Exception:
            bpy.ops.object.shade_flat()
    return j


def export(filename, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, filename), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)
    print("wrote", filename, "objects:", len(objs), "tris~", sum(len(o.data.polygons) for o in objs))


# ----------------------------------------------------------------- CREW (joint-space parts)
def make_human():
    reset()
    M = palette()
    parts = []
    R = lambda *a, **k: None  # noqa

    # ---- torso & trunk (origin = feet root)
    torso = [box((0.46, 0.25, 0.66), (0, 0, 1.15), M["shirt"], 0.05),
             box((0.52, 0.26, 0.2), (0, 0, 1.36), M["shirt"], 0.07),
             box((0.42, 0.24, 0.2), (0, 0, 0.88), M["pants"], 0.06)]
    pelvis = torso[2]
    parts.append(group("torso_shirt", torso[:2], True))
    parts.append(group("pelvis_pants", [pelvis], True))
    parts.append(group("belt_belt", [box((0.48, 0.27, 0.06), (0, 0, 0.84), M["belt"], 0.01)]))
    parts.append(group("buckle_dark", [box((0.07, 0.02, 0.05), (0, -0.14, 0.84), M["steel"], 0.005)]))
    parts.append(group("vest_vest", [box((0.5, 0.285, 0.46), (0, 0, 1.18), M["vest"], 0.045)], True))
    parts.append(group("stripe_stripe", [box((0.505, 0.29, 0.045), (0, 0, 1.08), M["stripe"], 0.004), box((0.505, 0.29, 0.045), (0, 0, 1.26), M["stripe"], 0.004),
                                          box((0.05, 0.292, 0.42), (-0.12, 0, 1.18), M["stripe"], 0.004), box((0.05, 0.292, 0.42), (0.12, 0, 1.18), M["stripe"], 0.004)]))
    parts.append(group("neck_skin", [cyl(0.052, 0.1, (0, 0, 1.52), M["skin"], 12)], True))
    # head (front = -Y)
    parts.append(group("head_skin", [sphere(0.5, (0, 0, 1.64), M["skin"], (0.205, 0.235, 0.265), 20),
                                      sphere(0.03, (-0.104, 0.0, 1.64), M["skin"]), sphere(0.03, (0.104, 0.0, 1.64), M["skin"])], True))
    parts.append(group("nose_skin", [box((0.03, 0.045, 0.05), (0, -0.128, 1.62), M["skin"], 0.01)], True))
    parts.append(group("eyes_dark", [sphere(0.017, (-0.047, -0.112, 1.655), M["dark"], segs=8), sphere(0.017, (0.047, -0.112, 1.655), M["dark"], segs=8),
                                      box((0.07, 0.01, 0.014), (-0.047, -0.118, 1.69), M["dark"], 0), box((0.07, 0.01, 0.014), (0.047, -0.118, 1.69), M["dark"], 0)]))
    # hard hat
    parts.append(group("hat_hat", [sphere(0.5, (0, 0, 1.72), M["hat"], (0.33, 0.37, 0.24), 20), cyl(0.17, 0.05, (0, 0, 1.69), M["hat"], 20, bev=0.015),
                                    cyl(0.215, 0.022, (0, 0, 1.685), M["hat"], 24), box((0.17, 0.13, 0.016), (0, -0.2, 1.685), M["hat"], 0.006, rot=(math.radians(-8), 0, 0)),
                                    box((0.03, 0.3, 0.025), (0, 0, 1.845), M["hat"], 0.008)], True))

    # ---- limbs: each part hangs below its joint (z <= 0)
    parts.append(group("upperarm_shirt", [cyl(0.056, 0.30, (0, 0, -0.15), M["shirt"], 12, r2=0.048), sphere(0.064, (0, 0, 0.0), M["shirt"], segs=14), sphere(0.052, (0, 0, -0.3), M["shirt"], segs=12)], True))
    parts.append(group("forearm_shirt", [cyl(0.048, 0.26, (0, 0, -0.13), M["shirt"], 12, r2=0.041), cyl(0.05, 0.035, (0, 0, -0.25), M["shirt"], 12)], True))
    parts.append(group("hand_glove", [sphere(0.05, (0, -0.005, -0.055), M["glove"], (0.9, 1.05, 1.25), 12), sphere(0.02, (0.04, -0.03, -0.035), M["glove"], segs=8)], True))
    parts.append(group("thigh_pants", [cyl(0.094, 0.44, (0, 0, -0.22), M["pants"], 14, r2=0.074), sphere(0.074, (0, 0, -0.44), M["pants"], segs=14)], True))
    parts.append(group("shin_pants", [cyl(0.072, 0.40, (0, 0, -0.2), M["pants"], 14, r2=0.056)], True))
    parts.append(group("kneepad_dark", [sphere(0.06, (0, -0.062, -0.025), M["dark"], (1.0, 0.55, 1.05), 12)], True))
    parts.append(group("boot_boot", [box((0.11, 0.31, 0.13), (0, -0.045, -0.02), M["boot"], 0.035), box((0.1, 0.1, 0.05), (0, 0.095, -0.075), M["boot"], 0.02)], True))
    parts.append(group("sole_dark", [box((0.118, 0.32, 0.03), (0, -0.04, -0.085), M["dark"], 0.008)]))
    export("human_parts.glb", parts)


# ----------------------------------------------------------------- PROPS
def make_bop():
    """BOP stack on a wellhead. Base at z=0, centred, front (rams' hydraulics + valves) toward -Y. ~7.1 m tall."""
    reset()
    M = palette()
    p = []

    def flange(z, r=0.7, h=0.14):
        p.append(cyl(r, h, (0, 0, z), M["dsteel"], 24, bev=0.012))
        for i in range(12):
            a = i / 12 * math.tau
            p.append(cyl(0.035, h + 0.07, (math.cos(a) * (r - 0.1), math.sin(a) * (r - 0.1), z), M["steel"], 6))

    # wellhead / casing head (0..1.0)
    p.append(cyl(0.5, 1.0, (0, 0, 0.5), M["steel"], 24, bev=0.01))
    p.append(cyl(0.58, 0.12, (0, 0, 0.1), M["dsteel"], 24))
    p.append(box((0.2, 1.6, 0.2), (0, 0, 0.62), M["steel"], 0.02))                       # side-outlet pipe
    p.append(cyl(0.13, 0.5, (0.55, 0.0, 0.62), M["steel"], 14, rot=(0, math.radians(90), 0)))
    flange(1.12)
    # double ram preventer (1.35..2.65): body + 4 bonnets with hydraulic cylinders
    p.append(box((1.8, 1.5, 1.3), (0, 0, 2.0), M["bopblue"], 0.06))
    p.append(box((1.2, 1.3, 0.9), (0, 0, 2.0), M["bopblue"], 0.04))
    for sz in (1.72, 2.28):
        for sx in (-1, 1):
            p.append(box((0.7, 0.7, 0.5), (sx * 1.2, 0, sz), M["bopred"], 0.04))                       # bonnet
            p.append(cyl(0.16, 0.7, (sx * 1.82, 0, sz), M["steel"], 16, rot=(0, math.radians(90), 0)))  # hydraulic cylinder
            p.append(cyl(0.085, 0.4, (sx * 2.3, 0, sz), M["dsteel"], 12, rot=(0, math.radians(90), 0)))  # operating rod
            for dy in (-0.25, 0.25):
                p.append(cyl(0.04, 0.12, (sx * 0.86, dy, sz + 0.18), M["steel"], 6, rot=(0, math.radians(90), 0)))
    # kill / choke outlets on the front (-Y) with gate valves
    for sx, z in ((-0.5, 1.85), (0.5, 2.3)):
        p.append(cyl(0.11, 1.1, (sx, -1.3, z), M["steel"], 14, rot=(math.radians(90), 0, 0)))
        p.append(box((0.4, 0.36, 0.5), (sx, -1.55, z), M["red"], 0.04))
        p.append(cyl(0.2, 0.05, (sx, -1.55, z + 0.38), M["dsteel"], 16))
        p.append(cyl(0.025, 0.4, (sx, -1.55, z + 0.25), M["steel"], 8))
    flange(2.74)
    # single ram (3.0..3.9)
    p.append(box((1.5, 1.3, 0.85), (0, 0, 3.42), M["bopblue"], 0.05))
    for sx in (-1, 1):
        p.append(box((0.55, 0.6, 0.5), (sx * 1.0, 0, 3.42), M["bopred"], 0.04))
        p.append(cyl(0.14, 0.6, (sx * 1.5, 0, 3.42), M["steel"], 16, rot=(0, math.radians(90), 0)))
        p.append(cyl(0.075, 0.35, (sx * 1.9, 0, 3.42), M["dsteel"], 12, rot=(0, math.radians(90), 0)))
    flange(3.95)
    p.append(cyl(0.6, 0.3, (0, 0, 4.1), M["steel"], 20, bev=0.01))
    flange(4.3)
    # annular preventer (4.4..5.75)
    p.append(cyl(0.92, 1.1, (0, 0, 4.98), M["bopred"], 28, bev=0.05, r2=0.78))
    p.append(cyl(0.86, 0.22, (0, 0, 5.62), M["bopred"], 28, bev=0.03))
    for i in range(6):
        a = i / 6 * math.tau + 0.3
        p.append(cyl(0.07, 0.8, (math.cos(a) * 0.9, math.sin(a) * 0.9, 4.95), M["dsteel"], 8))   # piston ports
    p.append(cyl(0.45, 0.2, (0, 0, 4.5), M["dsteel"], 20))
    flange(5.78, 0.62)
    # bell nipple + flowline stub (5.8..7.1)
    p.append(cyl(0.4, 1.35, (0, 0, 6.45), M["steel"], 22, bev=0.01))
    p.append(cyl(0.5, 0.12, (0, 0, 7.12), M["dsteel"], 22))
    p.append(cyl(0.28, 0.7, (0, 0.55, 6.5), M["steel"], 16, rot=(math.radians(90), 0, 0)))
    p.append(cyl(0.36, 0.1, (0, 0.95, 6.5), M["dsteel"], 16, rot=(math.radians(90), 0, 0)))
    export("bop.glb", [group("bop", p)])


def make_pump():
    """Triplex mud pump skid 2.8 (x) x 5.0 (y) x ~2.4 tall. Fluid end toward -Y (front), power end behind."""
    reset()
    M = palette()
    p = []
    # skid frame
    p.append(box((2.8, 5.0, 0.18), (0, 0, 0.09), M["dsteel"], 0.02))
    for sx in (-1.3, 1.3):
        p.append(box((0.22, 5.0, 0.3), (sx, 0, 0.3), M["dsteel"], 0.03))
    for sy in (-2.2, -0.8, 0.8, 2.2):
        p.append(box((2.6, 0.18, 0.2), (0, sy, 0.26), M["dsteel"], 0.02))
    # power end (rear): red housing with stepped cover, belt guard & motor-coupling
    p.append(box((2.4, 2.3, 1.15), (0, 1.1, 1.0), M["red"], 0.07))
    p.append(box((2.2, 1.9, 0.5), (0, 1.2, 1.7), M["red"], 0.06))
    for i in range(8):
        p.append(cyl(0.05, 0.05, (-0.95 + i * 0.27, -0.06, 1.15), M["steel"], 6, rot=(math.radians(90), 0, 0)))   # cover bolts
    p.append(box((2.5, 0.12, 0.8), (0, 0.0, 1.0), M["dsteel"], 0.02))                                                  # frame plate
    p.append(box((0.5, 1.5, 1.5), (-1.45, 1.4, 1.05), M["dsteel"], 0.05))                                              # belt guard
    p.append(cyl(0.3, 0.12, (1.28, 1.2, 1.1), M["steel"], 20, rot=(0, math.radians(90), 0)))
    # crosshead guides + fluid end (front, -Y)
    for sx in (-0.78, 0, 0.78):
        p.append(cyl(0.16, 1.1, (sx, -0.65, 1.05), M["steel"], 16, rot=(math.radians(90), 0, 0)))                 # extension rod housing
        p.append(cyl(0.2, 0.18, (sx, -1.22, 1.05), M["dsteel"], 16, rot=(math.radians(90), 0, 0)))                 # stuffing box
        p.append(box((0.62, 0.9, 0.62), (sx, -1.75, 1.05), M["steel"], 0.05))                                      # fluid cylinder block
        p.append(cyl(0.17, 0.12, (sx, -2.25, 1.05), M["dsteel"], 16, rot=(math.radians(90), 0, 0)))                # liner cap
        p.append(cyl(0.12, 0.5, (sx, -1.7, 1.55), M["steel"], 12))                                                  # discharge valve cover
        p.append(cyl(0.12, 0.5, (sx, -1.7, 0.55), M["steel"], 12))                                                  # suction valve cover
        for k in range(6):
            a = k / 6 * math.tau
            p.append(cyl(0.025, 0.1, (sx + math.cos(a) * 0.23, -2.3, 1.05 + math.sin(a) * 0.23), M["steel"], 6, rot=(math.radians(90), 0, 0)))
    # manifolds
    p.append(cyl(0.22, 2.9, (0, -1.75, 1.95), M["steel"], 18, rot=(0, math.radians(90), 0)))                       # discharge manifold
    p.append(cyl(0.3, 2.9, (0, -1.75, 0.42), M["steel"], 18, rot=(0, math.radians(90), 0)))                        # suction manifold
    for x in (-1.45, 1.45):
        p.append(cyl(0.3, 0.1, (x, -1.75, 1.95), M["dsteel"], 18, rot=(0, math.radians(90), 0)))
        p.append(cyl(0.38, 0.1, (x, -1.75, 0.42), M["dsteel"], 18, rot=(0, math.radians(90), 0)))
    # pulsation dampener + relief valve
    p.append(cyl(0.08, 0.35, (1.0, -1.75, 2.2), M["steel"], 10))
    p.append(sphere(0.42, (1.0, -1.75, 2.6), M["bopblue"], segs=20))
    p.append(cyl(0.1, 0.18, (1.0, -1.75, 3.04), M["dsteel"], 12))
    p.append(cyl(0.07, 0.4, (-1.0, -1.75, 2.2), M["bopred"], 10))
    export("pump.glb", [group("pump", p)])


def make_genset():
    """Engine-generator container 6.5 (x) x 6.0 (y) x 2.8 tall, louvered door face toward +X, exhaust stack on the roof."""
    reset()
    M = palette()
    p = []
    p.append(box((6.5, 6.0, 0.3), (0, 0, 0.15), M["dsteel"], 0.03))                                   # fuel skid base
    p.append(box((6.3, 5.8, 2.5), (0, 0, 1.55), M["poly"], 0.08))                                      # container
    p.append(box((6.4, 5.9, 0.12), (0, 0, 2.86), M["blue"], 0.03))                                     # roof cap
    for x in (-3.1, 3.1):
        for y in (-2.9, 2.9):
            p.append(box((0.18, 0.18, 2.5), (x, y, 1.55), M["dsteel"], 0.03))                           # corner posts
    # louvered intake wall on +X
    for i in range(14):
        p.append(box((0.09, 4.4, 0.06), (3.2, 0, 0.55 + i * 0.14), M["dsteel"], 0.008, rot=(0, math.radians(-20), 0)))
    p.append(box((0.08, 4.5, 1.9), (3.14, 0, 1.55), M["dsteel"], 0.03))
    # personnel doors with handles on the front (-Y)
    for x in (-1.6, 1.4):
        p.append(box((1.1, 0.07, 2.0), (x, -2.92, 1.5), M["steel"], 0.025))
        p.append(box((0.07, 0.05, 0.3), (x + 0.42, -2.98, 1.5), M["dsteel"], 0.01))
        p.append(box((0.5, 0.04, 0.18), (x, -2.95, 2.35), M["glass"], 0.01))
    # control panel + indicator
    p.append(box((0.9, 0.12, 1.1), (-2.6, -2.95, 1.6), M["dsteel"], 0.02))
    p.append(box((0.6, 0.03, 0.4), (-2.6, -3.02, 1.85), M["glass"], 0.005))
    p.append(box((0.12, 0.03, 0.08), (-2.4, -3.03, 1.45), M["lamp"], 0))
    # roof: exhaust muffler + stack with rain cap, radiator box, lifting eyes
    p.append(cyl(0.34, 1.6, (-1.4, 0.4, 3.7), M["steel"], 20, rot=(math.radians(90), 0, 0), bev=0.02))
    p.append(cyl(0.2, 2.6, (-1.4, 1.1, 4.2), M["dsteel"], 16))
    p.append(cyl(0.3, 0.08, (-1.4, 1.1, 5.55), M["dsteel"], 16))
    p.append(box((2.2, 2.0, 0.55), (1.5, -0.5, 3.18), M["dsteel"], 0.04))
    for i in range(8):
        p.append(box((2.0, 0.04, 0.4), (1.5, -1.4 + i * 0.25, 3.28), M["steel"], 0.005))
    for x, y in ((-3.0, -2.8), (3.0, -2.8), (-3.0, 2.8), (3.0, 2.8)):
        p.append(cyl(0.1, 0.05, (x, y, 3.0), M["steel"], 10))
    # cable tray + conduit down the back
    p.append(box((5.0, 0.16, 0.12), (0, 2.98, 2.5), M["dsteel"], 0.01))
    export("genset.glb", [group("genset", p)])


def make_lighttower():
    """9 m telescoping light tower on an outrigger base, 4 lamp lenses facing -Y and +Y."""
    reset()
    M = palette()
    p = []
    p.append(box((2.4, 2.4, 0.3), (0, 0, 0.45), M["dsteel"], 0.03))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(box((0.9, 0.12, 0.12), (sx * 1.5, sy * 1.0, 0.4), M["dsteel"], 0.01, rot=(0, 0, math.radians(sx * sy * 25))))
            p.append(cyl(0.14, 0.08, (sx * 1.9, sy * 1.18, 0.1), M["steel"], 10))
    p.append(box((1.2, 1.2, 0.9), (0, 0, 1.1), M["white"], 0.05))
    p.append(cyl(0.2, 3.0, (0, 0, 2.6), M["steel"], 12, bev=0.01, r2=0.18))
    p.append(cyl(0.16, 3.0, (0, 0, 5.4), M["steel"], 12, r2=0.14))
    p.append(cyl(0.12, 3.2, (0, 0, 8.0), M["steel"], 12, r2=0.1))
    for z in (1.6, 4.0, 6.9):
        p.append(cyl(0.24, 0.1, (0, 0, z), M["dsteel"], 12))
    p.append(box((2.0, 0.34, 0.16), (0, 0, 9.55), M["dsteel"], 0.02))
    for i, x in enumerate((-0.75, -0.25, 0.25, 0.75)):
        p.append(box((0.4, 0.3, 0.42), (x, -0.2, 9.8), M["dsteel"], 0.03))
        p.append(box((0.34, 0.05, 0.34), (x, -0.38, 9.8), M["lamp"], 0))
        p.append(box((0.4, 0.3, 0.42), (x, 0.2, 9.8), M["dsteel"], 0.03))
        p.append(box((0.34, 0.05, 0.34), (x, 0.38, 9.8), M["lamp"], 0))
    export("lighttower.glb", [group("lighttower", p)])


def make_trailer():
    """Skid-mounted office trailer 3.6 (x) x 12.0 (y) x 3.4 tall. Door + steps on -X side, AC units on the roof."""
    reset()
    M = palette()
    p = []
    p.append(box((3.7, 12.1, 0.7), (0, 0, 0.35), M["dsteel"], 0.03))                                 # skid frame
    p.append(box((3.6, 12.0, 2.8), (0, 0, 2.1), M["white"], 0.07))                                   # body
    p.append(box((3.7, 12.1, 0.1), (0, 0, 3.55), M["steel"], 0.02))                                  # roof
    p.append(box((3.64, 12.04, 0.2), (0, 0, 0.9), M["steel"], 0.02))                                 # skirt band
    for y in (-3.5, -1.0, 1.5, 4.0):                                                                  # windows on +X
        p.append(box((0.06, 1.3, 0.9), (1.83, y, 2.25), M["dsteel"], 0.02))
        p.append(box((0.04, 1.15, 0.75), (1.86, y, 2.25), M["glass"], 0.01))
    for y in (-3.5, 4.0):                                                                              # windows on -X (door at y=0)
        p.append(box((0.06, 1.3, 0.9), (-1.83, y, 2.25), M["dsteel"], 0.02))
        p.append(box((0.04, 1.15, 0.75), (-1.86, y, 2.25), M["glass"], 0.01))
    p.append(box((0.08, 1.2, 2.2), (-1.83, 0, 2.0), M["steel"], 0.03))                                # door
    p.append(box((0.06, 0.08, 0.22), (-1.9, 0.4, 2.0), M["dsteel"], 0.01))
    for i in range(3):
        p.append(box((0.5, 1.3, 0.06), (-2.2 - i * 0.0, 0, 0.35 + i * 0.25), M["steel"], 0.01))        # steps
    p.append(box((0.08, 0.08, 1.0), (-2.4, 0.7, 1.0), M["steel"], 0.01)); p.append(box((0.08, 0.08, 1.0), (-2.4, -0.7, 1.0), M["steel"], 0.01))
    for y in (-3.5, 3.0):                                                                              # roof A/C units
        p.append(box((1.1, 1.2, 0.55), (0, y, 3.9), M["steel"], 0.04))
        p.append(cyl(0.38, 0.05, (0, y, 4.2), M["dsteel"], 18))
    p.append(cyl(0.12, 0.6, (1.0, -0.6, 3.85), M["steel"], 10)); p.append(cyl(0.18, 0.05, (1.0, -0.6, 4.18), M["dsteel"], 10))
    p.append(box((0.1, 1.0, 0.5), (1.85, 5.0, 1.3), M["dsteel"], 0.02))                                # utility panel
    p.append(cyl(0.08, 0.4, (0.0, -6.5, 0.5), M["dsteel"], 8, rot=(math.radians(90), 0, 0)))             # hitch arm
    export("trailer.glb", [group("trailer", p)])


def make_pipe():
    """One drill-pipe joint, 15.2 m along Y, with upset tool-joint ends. Body 0.23 dia, joints 0.28 dia (scaled up for readability)."""
    reset()
    M = palette()
    body = [cyl(0.115, 14.3, (0, 0, 0), M["pipe"], 12, rot=(math.radians(90), 0, 0))]
    for sgn in (-1, 1):
        body.append(cyl(0.115, 0.5, (0, sgn * 7.4, 0), M["pipe"], 12, rot=(math.radians(90), 0, 0), r2=0.14))
    bands = []
    for sgn in (-1, 1):
        bands.append(cyl(0.142, 0.42, (0, sgn * 7.45, 0), M["band"], 12, rot=(math.radians(90), 0, 0)))
        bands.append(cyl(0.125, 0.03, (0, sgn * 6.85, 0), M["dsteel"], 12, rot=(math.radians(90), 0, 0)))
    # body is built along Z by cylinder defaults; rotate whole thing onto Y
    for o in body:
        pass
    b = group("pipe_pipe", body, True)
    k = group("band_band", bands)
    export("pipe.glb", [b, k])


if __name__ == "__main__":
    make_human()
    make_bop()
    make_pump()
    make_genset()
    make_lighttower()
    make_trailer()
    make_pipe()
