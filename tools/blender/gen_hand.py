"""Original procedural hand; MediaPipe landmark-index bone naming contract.

Dimensions are an authored neutral template, not a measured population median.
Runtime measurement scaling is required before drawing fit conclusions.
"""
import bpy
import bmesh
from mathutils import Vector
from geometry import hand_skeleton
from asset_utils import activate, apply_modifier, material


def segment_distance(point, start, end):
    delta = end - start
    t = max(0, min(1, (point - start).dot(delta) / delta.length_squared))
    return (point - start - t * delta).length


def generate_hand():
    coordinates, edges = hand_skeleton()
    # Flat palm-down rest pose. A central palm support prevents the Skin
    # modifier from pinching all metacarpals into a single wrist junction.
    points = [Vector((x, y, 0)) for x, y, z in coordinates]
    skin_points = points + [Vector((0, .043, 0))]
    skin_edges = [(a if a else (0 if b == 1 else 21), b) for a, b in edges] + [(0, 21)]
    mesh = bpy.data.meshes.new("Hand_skin_graph")
    mesh.from_pydata(skin_points, skin_edges, [])
    hand = bpy.data.objects.new("Hand", mesh)
    bpy.context.scene.collection.objects.link(hand)
    skin = hand.modifiers.new("Procedural skin", "SKIN")
    radii = {0: (.025, .011), 21: (.029, .011)}
    for chain_start in (1, 5, 9, 13, 17):
        factor = .85 if chain_start == 17 else 1
        for index, radius in enumerate((.009, .0077, .0065, .0045)):
            radii[chain_start + index] = (radius * factor, radius * factor)
    for i, vertex in enumerate(mesh.skin_vertices[0].data):
        vertex.radius = radii[i]
        vertex.use_root = i == 0
    apply_modifier(hand, skin)
    sub = hand.modifiers.new("Organic smoothing", "SUBSURF")
    sub.levels = 2
    apply_modifier(hand, sub)
    # Skin's branch junction can fold inside the palm. Union an authored palm
    # volume before voxel remeshing to fill that interior and give a clean cuff.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=(0, .031, 0))
    palm = bpy.context.object
    palm.scale = (.032, .048, .012)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    activate(hand)
    palm.select_set(True)
    bpy.ops.object.join()
    # Resolve overlapping branch surfaces into one closed skin volume.
    remesh = hand.modifiers.new("Union palm branches", "REMESH")
    remesh.mode, remesh.voxel_size = "VOXEL", .0012
    remesh.use_smooth_shade = True
    apply_modifier(hand, remesh)
    smooth = hand.modifiers.new("Soften voxel surface", "SMOOTH")
    smooth.factor, smooth.iterations = .7, 12
    apply_modifier(hand, smooth)
    decimate = hand.modifiers.new("Web budget", "DECIMATE")
    decimate.ratio = .45
    apply_modifier(hand, decimate)
    bm = bmesh.new()
    bm.from_mesh(hand.data)
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=(0, -.005, 0), plane_no=(0, 1, 0), clear_inner=True, dist=1e-7)
    bmesh.ops.holes_fill(bm, edges=[edge for edge in bm.edges if edge.is_boundary])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(hand.data)
    bm.free()
    hand.data.materials.append(material("Hand warm clay", (.50, .26, .15), .62))
    for face in hand.data.polygons:
        face.use_smooth = True

    armature = bpy.data.armatures.new("MediaPipe21")
    rig = bpy.data.objects.new("HandRig", armature)
    bpy.context.scene.collection.objects.link(rig)
    activate(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    root = armature.edit_bones.new("mp_0")
    root.head, root.tail = (0, -.025, 0), points[0]
    for parent, child in edges:
        bone = armature.edit_bones.new(f"mp_{child}")
        bone.head, bone.tail = points[parent], points[child]
        bone.parent = armature.edit_bones[f"mp_{parent}"]
        bone.use_connect = True
    bpy.ops.object.mode_set(mode="OBJECT")
    segments = [("mp_0", Vector((0, -.025, 0)), points[0])] + [
        (f"mp_{child}", points[parent], points[child]) for parent, child in edges]
    groups = {name: hand.vertex_groups.new(name=name) for name, _, _ in segments}
    for vertex in hand.data.vertices:
        nearest = sorted((segment_distance(vertex.co, a, b), name) for name, a, b in segments)[:4]
        raw = [(1 / max(distance, .002) ** 4, name) for distance, name in nearest]
        total = sum(weight for weight, _ in raw)
        for weight, name in raw:
            groups[name].add([vertex.index], weight / total, "REPLACE")
    modifier = hand.modifiers.new("MediaPipe deformation", "ARMATURE")
    modifier.object = rig
    hand.parent = rig
    hand["template_status"] = "authored-neutral-template; runtime scaling required"
    rig["bone_contract"] = "mp_0 wrist; mp_i ends at MediaPipe landmark i"
    return hand, rig, [list(point) for point in points]
