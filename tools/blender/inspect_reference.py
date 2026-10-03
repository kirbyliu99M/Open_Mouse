import bpy
from pathlib import Path
from mathutils import Vector
path = next((Path(__file__).resolve().parent / 'out/reference-library/logitech-g-pro-x-superlight-2').glob('*.glb'))
scene = bpy.data.scenes.new('ReferenceInspection')
bpy.context.window.scene = scene
bpy.ops.import_scene.gltf(filepath=str(path))
for obj in scene.objects:
    if obj.type == 'MESH':
        pts = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
        print(obj.name, 'bounds', [min(v[i] for v in pts) for i in range(3)], [max(v[i] for v in pts) for i in range(3)], 'triangles', len(obj.data.polygons))
print('engines',scene.render.engine)
print('studio color enum', [i.identifier for i in scene.display.shading.bl_rna.properties['color_type'].enum_items])
print('transparent',scene.render.film_transparent)
