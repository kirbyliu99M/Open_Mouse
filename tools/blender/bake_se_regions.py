"""Bake source component/UV annotation IDs onto the unchanged sibling atlas.

Blender 5.2.2: --background --factory-startup --python-exit-code 1 --python this_file.
No colour thresholds define physical regions. Component indices are sorted by
vertex count in the SHA256-pinned official source; printed marks have UV boxes.
"""
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from color_reconstruction import source_surface
from asset_utils import activate
from se_colour_math import connected_components,component_region

SIBLING = 'logitech-g-pro-x-superlight-2'
SE = SIBLING + '-se'
OUT = HERE / 'out/study-fidelity/b2'
REGIONS = {1:'shell', 2:'main_buttons', 3:'side_buttons', 4:'wheel_rubber',
           5:'wheel_rim', 6:'underside', 7:'feet', 8:'logo', 9:'side_wordmark',
           10:'indicator', 11:'ports_and_recesses',12:'underside_logo'}
# UV image coordinates, top-left origin, normalised from the source atlas.
PRINT_BOXES = {8:(.166,.768,.216,.832), 9:(.389,.949,.510,.985)}


def components(mesh):
    lookup={}
    for index,group in enumerate(connected_components(len(mesh.vertices),[e.vertices[:] for e in mesh.edges])):
        for vertex in group:lookup[vertex]=index
    return lookup


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path=HERE/'out/polished'/SIBLING/(SIBLING+'.glb')
    bpy.ops.import_scene.gltf(filepath=str(path))
    mesh=next(o for o in bpy.context.selected_objects if o.type=='MESH')
    coords=np.array([tuple(mesh.matrix_world@v.co) for v in mesh.data.vertices])
    mesh.data.calc_loop_triangles()
    np.savez_compressed(OUT/'sibling-mesh.npz', vertices=coords,
                        faces=np.array([t.vertices[:] for t in mesh.data.loop_triangles]))
    folder=HERE/'out/reference-library'/SIBLING
    record=json.loads((folder/'sources.json').read_text())
    calibration=json.loads((folder/'views/cameras.json').read_text())
    source_path=HERE/'out/reference-library'/record['arModels'][0]['file']
    assert hashlib.sha256(source_path.read_bytes()).hexdigest()=='ce7f19702694eaf41f2b4c5e9793eb9cd13c17e6b451d6d508a4038a94bc5888', 'Source component annotations require the pinned Superlight 2 AR file'
    _,verts,_,_,objects=source_surface(record,calibration)
    mats={}
    for number,name in REGIONS.items():
        mat=bpy.data.materials.new('Region_'+name);nodes=mat.node_tree.nodes
        output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
        emit=nodes.new('ShaderNodeEmission');emit.inputs['Color'].default_value=(number/255,)*3+(1,)
        mat.node_tree.links.new(emit.outputs[0],output.inputs['Surface']);mats[number]=mat
    # Explicit print ROIs within the shell's source UV atlas; no RGB classification.
    mat=mats[1];emit=next(n for n in mat.node_tree.nodes if n.type=='EMISSION')
    image=bpy.data.images.new('Source spatial region annotations',width=2048,height=2048,float_buffer=True)
    image.colorspace_settings.name='Non-Color'
    pixels=np.ones((2048,2048,4),np.float32);pixels[:,:,:3]=1/255
    for number,(x0,y0,x1,y1) in PRINT_BOXES.items():
        pixels[int((1-y1)*2048):int((1-y0)*2048),int(x0*2048):int(x1*2048),:3]=number/255
    image.pixels.foreach_set(pixels.ravel());node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;node.interpolation='Closest'
    mat.node_tree.links.new(node.outputs['Color'],emit.inputs['Color'])
    offset=0;assignments=[]
    for obj in objects:
        lookup=components(obj.data)
        upper=obj.data.materials[0].name.split('.')[0]=='Material1'
        obj.parent=None;obj.matrix_world=Matrix.Identity(4)
        for vertex in obj.data.vertices:vertex.co=verts[offset+vertex.index]
        offset+=len(obj.data.vertices);obj.data.update()
        obj.data.materials.clear()
        for mat in mats.values():obj.data.materials.append(mat)
        component_ids={}
        for polygon in obj.data.polygons:
            part=lookup[polygon.vertices[0]]
            region=component_region(upper,part)
            polygon.material_index=region-1;component_ids[part]=region
        assignments.append(dict(object=obj.name,upper=upper,components=component_ids))
    activate(mesh);mesh.data.materials.clear()
    mat=bpy.data.materials.new('ID receiver');mesh.data.materials.append(mat)
    node=mat.node_tree.nodes.new('ShaderNodeTexImage');mat.node_tree.nodes.active=node
    image=bpy.data.images.new('Region ID',width=2048,height=2048,float_buffer=True);image.colorspace_settings.name='Non-Color';node.image=image
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1
    scene.render.bake.use_selected_to_active=True;scene.render.bake.cage_extrusion=.004;scene.render.bake.max_ray_distance=.012;scene.render.bake.margin=12
    for obj in objects:obj.select_set(True)
    bpy.ops.object.bake(type='EMIT')
    pixels=np.array(image.pixels[:],dtype=np.float32).reshape(2048,2048,4)
    np.save(OUT/'region-ids.npy',np.rint(pixels[::-1,:,0]*255).astype(np.uint8))
    (OUT/'region-annotations.json').write_text(json.dumps(dict(regions=REGIONS,printBoxes=PRINT_BOXES,assignments=assignments),indent=2))
    print('REGION_BAKE_COMPLETE',np.unique(np.rint(pixels[:,:,0]*255),return_counts=True),flush=True)


if __name__=='__main__':main()
