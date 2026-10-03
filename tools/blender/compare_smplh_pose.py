"""Private SMPL+H bend test using the public SMPL pose-corrective formula.

Run with an authorized SMPL+H .blend as Blender's startup file. This script
does not load the add-on or export a model; it writes only ignored PNGs under
out/mano-comparison. Rotation-axis alignment is experimental pending a check
against the official add-on.
"""

import math
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

OUT = Path(__file__).resolve().parent / "out" / "mano-comparison"
OUT.mkdir(exist_ok=True)
source = bpy.data.objects["SMPLH-mesh-neutral"]
rig = bpy.data.objects["SMPLH-neutral"]
wrist = rig.data.bones["right_wrist"].head_local
cutoff = wrist.x + 0.025
faces = [tuple(p.vertices) for p in source.data.polygons
         if all(source.data.vertices[i].co.x < cutoff for i in p.vertices)]
used = sorted({i for f in faces for i in f})
index = {old: new for new, old in enumerate(used)}
scale = 0.176 / (wrist.x - min(source.data.vertices[i].co.x for i in used))

joint_names = [f"right_{finger}{i}" for finger in ("index", "middle", "pinky", "ring", "thumb") for i in (1, 2, 3)]
assert len(source.data.shape_keys.key_blocks) == 760
for finger in ("index", "middle", "pinky", "ring", "thumb"):
    for segment, angle in enumerate((-35, -50, -35), 1):
        name = f"right_{finger}{segment}"
        bone = rig.pose.bones[name]
        local_axis = rig.data.bones[name].matrix_local.to_3x3().inverted() @ Vector((0, 1, 0))
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = Quaternion(local_axis, math.radians(angle))

def extract(correctives):
    for j, name in enumerate(joint_names):
        bone = rig.pose.bones[name]
        # SMPL+H pose-corrective order: 21 body joints, then 15 left finger
        # joints, then the 15 right finger joints. Each contributes row-major
        # entries of local (R-I), per the MIT smpl-unreal implementation.
        full_index = 37 + j
        angle = (-35, -50, -35)[j % 3]
        rotation = Quaternion((0, 1, 0), math.radians(angle)).to_matrix()
        for row in range(3):
            for col in range(3):
                key = source.data.shape_keys.key_blocks[f"Pose{(full_index - 1) * 9 + row * 3 + col:03d}"]
                key.slider_min = -2
                key.slider_max = 2
                key.value = (rotation[row][col] - (1 if row == col else 0)) if correctives else 0
    bpy.context.view_layer.update()
    evaluated_obj = source.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated = evaluated_obj.to_mesh()
    points = [evaluated.vertices[i].co.copy() for i in used]
    evaluated_obj.to_mesh_clear()
    coordinates = [((p.y - wrist.y) * scale, (wrist.x - p.x) * scale,
                    (p.z - wrist.z) * scale) for p in points]
    mesh = bpy.data.meshes.new("Hand pose corrected" if correctives else "Hand pose skinning only")
    mesh.from_pydata(coordinates, [], [tuple(index[i] for i in f) for f in faces])
    mesh.update()
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location.x = 0.14 if correctives else -0.14
    for face in mesh.polygons:
        face.use_smooth = True
    return obj, points

uncorrected, points_a = extract(False)
corrected, points_b = extract(True)
print("CORRECTION_MAX_MM", max((a-b).length for a,b in zip(points_a,points_b))*1000, flush=True)
for obj in list(bpy.context.scene.objects):
    if obj not in (uncorrected, corrected):
        bpy.data.objects.remove(obj, do_unlink=True)

material = bpy.data.materials.new("Shared clay")
material.diffuse_color = (0.65, 0.43, 0.34, 1)
material.use_nodes = True
material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = material.diffuse_color
for obj in (uncorrected, corrected):
    obj.data.materials.append(material)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.render.resolution_x = 1400
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.world.color = (0.18, 0.18, 0.18)
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
light_data = bpy.data.lights.new("Softbox", "AREA")
light = bpy.data.objects.new("Softbox", light_data)
scene.collection.objects.link(light)
light.location = (0, -0.1, 0.55)
light_data.energy = 15
light_data.shape = "DISK"
light_data.size = 0.4
camera_data = bpy.data.cameras.new("Comparison camera")
camera = bpy.data.objects.new("Comparison camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = 0.48
for name, position in (("top", (0, 0.08, 0.7)), ("oblique", (0.22, -0.3, 0.45))):
    camera.location = position
    camera.rotation_euler = (Vector((0, 0.075, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(OUT / f"curl-{name}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDER", scene.render.filepath, flush=True)
