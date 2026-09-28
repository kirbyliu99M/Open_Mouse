"""Unwrap M550 without moving vertices; inspect M650 baked PBR in Blender."""
import json
import math
from pathlib import Path
import shutil
import sys
import bpy
import numpy as np
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import activate
OUT = HERE/'out/study-fidelity/b3'


def main():
    source = HERE/'out/polished/logitech-m550/logitech-m550.glb'
    if not (OUT/'old-m550.glb').exists():shutil.copyfile(HERE.parents[1]/'public/models/studies/logitech-m550.glb', OUT/'old-m550.glb')
    if not (OUT/'old-lossless.glb').exists():shutil.copyfile(source, OUT/'old-lossless.glb')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(OUT/'old-lossless.glb'))
    obj = next(o for o in bpy.context.selected_objects if o.type == 'MESH')
    before = np.array([v.co[:] for v in obj.data.vertices])
    activate(obj)
    while obj.data.uv_layers:obj.data.uv_layers.remove(obj.data.uv_layers[0])
    obj.data.uv_layers.new(name='PhotoAtlas')
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.015)
    bpy.ops.object.mode_set(mode='OBJECT')
    assert np.array_equal(before, np.array([v.co[:] for v in obj.data.vertices]))
    obj.data.calc_loop_triangles()
    vertices = np.array([tuple(obj.matrix_world@v.co) for v in obj.data.vertices])
    faces = np.array([t.vertices[:] for t in obj.data.loop_triangles])
    uv = np.array([[obj.data.uv_layers.active.data[i].uv[:] for i in t.loops] for t in obj.data.loop_triangles])
    normals = np.array([[tuple((obj.matrix_world.to_3x3()@obj.data.corner_normals[i].vector).normalized()) for i in t.loops] for t in obj.data.loop_triangles])
    np.savez_compressed(OUT/'atlas.npz', vertices=vertices*1000, faces=faces, uv=uv, normals=normals)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'atlas.blend'))
    print('ATLAS_VERTICES_UNCHANGED', len(vertices), 'TRIANGLES', len(faces), flush=True)
    # Export/reimport position-lossless Draco now, before spending time texturing.
    bpy.ops.export_scene.gltf(filepath=str(OUT/'atlas-position-test.glb'), export_format='GLB',
        use_selection=True, export_animations=False, export_draco_mesh_compression_enable=True,
        export_draco_position_quantization=0)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(OUT/'atlas-position-test.glb'))
    rebuilt = next(o for o in bpy.context.selected_objects if o.type == 'MESH')
    coords = np.array([tuple(rebuilt.matrix_world@v.co) for v in rebuilt.data.vertices])
    assert set(map(tuple, vertices)) == set(map(tuple, coords)), 'Position-lossless Draco roundtrip changed vertices'
    print('DRACO_ZERO_POSITION_QUANTIZATION_EXACT', flush=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(HERE/'out/polished/logitech-m650/logitech-m650.glb'))
    sibling = next(o for o in bpy.context.selected_objects if o.type == 'MESH')
    sibling.data.calc_loop_triangles()
    tri = list(sibling.data.loop_triangles)
    points = np.array([tuple(sibling.matrix_world@t.center) for t in tri])*1000
    normal = np.array([tuple((sibling.matrix_world.to_3x3()@t.normal).normalized()) for t in tri])
    uv = np.array([np.mean([sibling.data.uv_layers.active.data[i].uv[:] for i in t.loops], axis=0) for t in tri])
    images = {}
    for mat in sibling.data.materials:
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                im = node.image;arr = np.array(im.pixels[:], dtype=np.float32).reshape(im.size[1], im.size[0], 4)
                # Blender image pixels are bottom-up; non-colour MR is linear.
                x = np.clip((uv[:, 0]*im.size[0]).astype(int), 0, im.size[0]-1)
                y = np.clip((uv[:, 1]*im.size[1]).astype(int), 0, im.size[1]-1)
                images[im.name] = arr[y, x, :3]
                print('M650_IMAGE', im.name, im.size[:], flush=True)
    np.savez_compressed(OUT/'m650-pbr-samples.npz', points=points, normals=normal, **images)


if __name__ == '__main__':main()
