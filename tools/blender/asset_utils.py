"""Blender-only build, validation and export utilities."""
import json
import struct
from pathlib import Path
import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def activate(obj):
    for selected in bpy.context.selected_objects:
        selected.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifier(obj, modifier):
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def material(name, color, roughness=.44):
    result = bpy.data.materials.new(name)
    node = next(n for n in result.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    node.inputs["Base Color"].default_value = (*color, 1)
    node.inputs["Roughness"].default_value = roughness
    return result


def mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return obj


def validate_mesh(obj, weld=False):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if weld:
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
    bm.normal_update()
    non_manifold = sum(not edge.is_manifold for edge in bm.edges)
    degenerate = sum(face.calc_area() < 1e-14 for face in bm.faces)
    volume = bm.calc_volume(signed=True)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    bm.faces.ensure_lookup_table()
    vertices = [v.co.copy() for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    tree = BVHTree.FromPolygons(vertices, faces, all_triangles=True, epsilon=0)
    intersections = sum(1 for a, b in tree.overlap(tree) if a < b and not set(faces[a]).intersection(faces[b]))
    result = {"vertices": len(vertices), "triangles": len(faces), "nonManifoldEdges": non_manifold, "degenerateFaces": degenerate, "nonAdjacentIntersectionPairs": intersections, "volumeMm3": volume * 1e9}
    bm.free()
    if non_manifold or degenerate or intersections or volume <= 0:
        raise RuntimeError(f"Invalid mesh {obj.name}: {result}")
    return result


def dimensions_mm(obj):
    points = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
    return [(max(p[a] for p in points) - min(p[a] for p in points)) * 1000 for a in range(3)]


def clean_export_mesh(obj):
    """Remove micron-scale decimation slivers before Draco quantisation."""
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-6)
    for edge in list(bm.edges):
        if not edge.link_faces:bm.edges.remove(edge)
    for vertex in list(bm.verts):
        if not vertex.link_edges:bm.verts.remove(vertex)
    boundary=[edge for edge in bm.edges if edge.is_boundary]
    if boundary:bmesh.ops.holes_fill(bm,edges=boundary)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data);bm.free();obj.data.update()


def validate_assembly(objects):
    """Distinct closed parts must not cross each other's surfaces."""
    trees = []
    for obj in objects:
        obj.data.calc_loop_triangles()
        trees.append(BVHTree.FromPolygons(
            [obj.matrix_world @ vertex.co for vertex in obj.data.vertices],
            [tuple(tri.vertices) for tri in obj.data.loop_triangles], all_triangles=True))
    count = sum(len(a.overlap(b)) for i, a in enumerate(trees) for b in trees[i+1:])
    if count:
        raise RuntimeError(f"Assembly has {count} intersecting triangle pairs")
    return count


def glb_json(path):
    raw = Path(path).read_bytes()
    if struct.unpack_from("<4sI", raw) != (b"glTF", 2):
        raise RuntimeError("Invalid GLB")
    size = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20 + size])


def export_glb(objects, path, compressed=True):
    import io_scene_gltf2
    if "GLB" not in {i[0] for i in io_scene_gltf2.get_format_items(None, bpy.context)}:
        raise RuntimeError("GLB export missing")
    if compressed and not io_scene_gltf2.is_draco_available():
        raise RuntimeError("Draco unavailable")
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
        use_active_scene=True, export_animations=False, export_cameras=False,
        export_lights=False, export_yup=True, export_draco_mesh_compression_enable=compressed,
        export_draco_position_quantization=24)
    metadata = glb_json(path)
    if compressed and "KHR_draco_mesh_compression" not in metadata.get("extensionsUsed", []):
        raise RuntimeError("Draco was not written")
    return metadata


def studio(scene, width=.48, height=.40):
    camera_data = bpy.data.cameras.new("Review_Camera")
    camera = bpy.data.objects.new("Review_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0, 0, 1.2)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = width
    scene.camera = camera
    for name, location, power, size in [
        ("Key", (-.25, -.25, .8), 10, .55), ("Fill", (.35, .1, .6), 5, .4),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (-obj.location).to_track_quat("-Z", "Y").to_euler()
        data.energy, data.size = power, size
    scene.world = bpy.data.worlds.new("Review_Background")
    scene.world.color = (.055, .065, .08)
    scene.render.resolution_x = 1600
    scene.render.resolution_y = round(1600 * height / width)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"


def label(text, x, y, size=.005, color=(.7, .78, .82)):
    data = bpy.data.curves.new("Label", "FONT")
    data.body, data.size = text, size
    obj = bpy.data.objects.new("Label", data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = (x, y, .15)
    mat = material("Label", color)
    shader = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Emission Color"].default_value = (*color, 1)
    shader.inputs["Emission Strength"].default_value = .4
    data.materials.append(mat)
    return obj
