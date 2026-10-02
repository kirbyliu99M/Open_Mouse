"""Build a closed fit envelope with recessed button seams and a scroll wheel."""
import math
import bmesh
import bpy
from mathutils import Vector
from geometry import shell_loft
from asset_utils import activate, apply_modifier, material, mesh_object


def normalize_shell(obj, p):
    vertices = obj.data.vertices
    low = [min(v.co[a] for v in vertices) for a in range(3)]
    high = [max(v.co[a] for v in vertices) for a in range(3)]
    target = [p["width"], p["length"], p["height"]]
    for vert in vertices:
        for a in range(3):
            vert.co[a] = (vert.co[a] - low[a]) / (high[a] - low[a]) * target[a]
        vert.co.x -= target[0] / 2
        vert.co.y -= target[1] / 2
    obj.data.update()
    bpy.context.view_layer.update()


def top_hit(obj, x, y):
    hit, position, _, _ = obj.ray_cast(Vector((x, y, .2)), Vector((0, 0, -1)))
    if not hit:
        raise ValueError("Detail path missed shell")
    return position


def groove(shell, points, name, radius=.00032):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth, curve.bevel_resolution = radius, 2
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for target, point in zip(spline.points, points):
        target.co = (*point, 1)
    cutter = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(cutter)
    activate(cutter)
    bpy.ops.object.convert(target="MESH")
    cutter.data.materials.append(shell.data.materials[0])
    cutter.data.materials.append(shell.data.materials[1])
    for face in cutter.data.polygons:
        face.material_index = 1
    boolean = shell.modifiers.new(name, "BOOLEAN")
    boolean.operation, boolean.solver, boolean.object = "DIFFERENCE", "EXACT", cutter
    apply_modifier(shell, boolean)
    bpy.data.objects.remove(cutter, do_unlink=True)


def generate_shell(p):
    verts, faces = shell_loft(p)
    shell = mesh_object(p["id"] + "_shell", verts, faces)
    shell.data.materials.append(material("Shell_" + p["id"], p["color"]))
    shell.data.materials.append(material("Recess_" + p["id"], (.025, .032, .038), .65))
    sub = shell.modifiers.new("Loft smoothing", "SUBSURF")
    sub.levels = 2
    apply_modifier(shell, sub)
    dec = shell.modifiers.new("Web budget", "DECIMATE")
    dec.ratio = .14
    apply_modifier(shell, dec)
    normalize_shell(shell, p)
    if p["tilt"] >= .1:
        # Handed thumb relief, distinct from the low supporting rest ledge.
        bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24,
            location=(-p["handedness"] * p["width"] * .57, -.04 * p["length"], .34 * p["height"]))
        scoop = bpy.context.object
        scoop.scale = (.18 * p["width"], .22 * p["length"], .27 * p["height"])
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        boolean = shell.modifiers.new("Thumb relief", "BOOLEAN")
        boolean.operation, boolean.solver, boolean.object = "DIFFERENCE", "EXACT", scoop
        apply_modifier(shell, boolean)
        bpy.data.objects.remove(scoop, do_unlink=True)
    # Use actual smoothed surface ray hits so grooves follow the curved deck.
    points = []
    for i in range(24):
        u = .055 + .405 * i / 23
        point = top_hit(shell, 0, (u - .5) * p["length"])
        point.z += .00006
        points.append(tuple(point))
    groove(shell, points, "Center button split")
    points = []
    for i in range(33):
        x = (-.39 + .78 * i / 32) * p["width"]
        u = .46 if p["seam"] == "straight" else .39 + .09 * abs(x) / (.39 * p["width"])
        point = top_hit(shell, x, (u - .5) * p["length"])
        point.z += .00006
        points.append(tuple(point))
    groove(shell, points, "Rear button split")
    # Wheel geometry is a closed serrated cylinder along X, positioned above
    # the forward deck. A shallow closed pocket houses its lower half.
    y = -.30 * p["length"]
    center = top_hit(shell, 0, y)
    wheel_z = center.z + .001
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, y, center.z + .004))
    cutter = bpy.context.object
    cutter.dimensions = (.0065, .015, .04)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = cutter.modifiers.new("Rounded pocket", "BEVEL")
    bevel.width, bevel.segments = .0015, 4
    apply_modifier(cutter, bevel)
    boolean = shell.modifiers.new("Wheel pocket", "BOOLEAN")
    boolean.operation, boolean.solver, boolean.object = "DIFFERENCE", "EXACT", cutter
    apply_modifier(shell, boolean)
    bpy.data.objects.remove(cutter, do_unlink=True)
    vertices, faces = [], []
    for x in (-.0027, .0027):
        for j in range(96):
            angle = math.tau * j / 96
            radius = .0063 + (.00015 if j % 2 else 0)
            vertices.append((x, y + radius * math.sin(angle), wheel_z + radius * math.cos(angle)))
    faces.extend([tuple(reversed(range(96))), tuple(range(96, 192))])
    for j in range(96):
        n = (j + 1) % 96
        faces.append((j, n, 96 + n, 96 + j))
    wheel = mesh_object(p["id"] + "_wheel", vertices, faces)
    wheel.data.materials.append(material("Wheel_" + p["id"], (.018, .025, .032), .7))
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=list(bm.edges))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(shell.data)
    bm.free()
    for face in shell.data.polygons:
        face.use_smooth = face.material_index == 0
    shell["asset_status"] = "provisional-authoring"
    shell["source_url"] = p["sourceUrl"]
    return [shell, wheel]
