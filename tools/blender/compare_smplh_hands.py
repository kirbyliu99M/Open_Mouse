"""Locally compare the licensed SMPL+H neutral hand with our authored hand.

Run with the SMPL+H .blend as Blender's startup file. Writes only ignored PNGs
under out/mano-comparison; no licensed mesh is exported or copied into public/.
The wrist is cut open, so judge the hand shape and not the cut surface.
"""

from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "out" / "mano-comparison"
OUT.mkdir(exist_ok=True)


def clay(name):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (0.65, 0.43, 0.34, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = mat.diffuse_color
    bsdf.inputs["Roughness"].default_value = 0.72
    return mat


source = bpy.data.objects["SMPLH-mesh-neutral"]
wrist = bpy.data.objects["SMPLH-neutral"].data.bones["right_wrist"].head_local
cutoff = wrist.x + 0.025
kept = {v.index for v in source.data.vertices if v.co.x < cutoff}
faces = [tuple(v for v in poly.vertices) for poly in source.data.polygons
         if all(v in kept for v in poly.vertices)]
used = sorted({v for face in faces for v in face})
index = {old: new for new, old in enumerate(used)}
scale = 0.176 / (wrist.x - min(source.data.vertices[i].co.x for i in used))
vertices = []
for i in used:
    p = source.data.vertices[i].co
    vertices.append(((p.y - wrist.y) * scale, (wrist.x - p.x) * scale,
                     (p.z - wrist.z) * scale))
mano_mesh = bpy.data.meshes.new("Private SMPLH right hand comparison")
mano_mesh.from_pydata(vertices, [], [tuple(index[i] for i in face) for face in faces])
mano_mesh.update()
bm = bmesh.new()
bm.from_mesh(mano_mesh)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(mano_mesh)
bm.free()

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
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

comparison = bpy.data.objects.new("SMPLH neutral", mano_mesh)
scene.collection.objects.link(comparison)
comparison.location.x = -0.145
comparison.data.materials.append(clay("Shared clay"))
for face in comparison.data.polygons:
    face.use_smooth = True

bpy.ops.import_scene.gltf(filepath=str(ROOT / "public/models/hand.glb"))
ours = next(obj for obj in scene.objects if obj.type == "MESH" and obj != comparison)
ours.name = "Open_Mouse current hand"
ours.parent = None
ours.matrix_world.identity()
ours.location.x = 0.145
ours.data.materials.clear()
ours.data.materials.append(comparison.data.materials[0])
for face in ours.data.polygons:
    face.use_smooth = True
for obj in list(scene.objects):
    if obj.type == "ARMATURE":
        bpy.data.objects.remove(obj, do_unlink=True)

camera_data = bpy.data.cameras.new("Comparison camera")
camera = bpy.data.objects.new("Comparison camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = 0.48

light_data = bpy.data.lights.new("Softbox", "AREA")
light = bpy.data.objects.new("Softbox", light_data)
scene.collection.objects.link(light)
light.location = (0, -0.1, 0.55)
light_data.energy = 15
light_data.shape = "DISK"
light_data.size = 0.4

for name, position in (("top", (0, 0.08, 0.7)),
                       ("oblique", (0.22, -0.3, 0.45))):
    camera.location = position
    target = Vector((0, 0.075, 0))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(OUT / f"neutral-{name}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDER", scene.render.filepath, flush=True)
print("COMPARISON", "SMPLH vertices", len(vertices), "faces", len(faces),
      "scale", scale, "our dimensions", tuple(ours.dimensions), flush=True)
