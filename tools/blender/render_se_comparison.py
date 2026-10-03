"""Render old SE, new SE and sibling in identical cameras and lighting."""
import json,sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix,Vector
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
OUT=HERE/'out/study-fidelity/b2';SE='logitech-g-pro-x-superlight-2-se';SIBLING=SE.removesuffix('-se')

def main():
    poses=json.loads((OUT/'camera-evidence.json').read_text())['views']
    axes={p['view']:p['axes'] for p in poses}
    axes['side']=axes['left'];axes['front']=[[-1,0,0],[0,0,1],[0,1,0]];axes['hero']=axes['hero-held-out']
    public=HERE.parents[1]/'public/models'
    paths={'old':OUT/'old-se.glb','new':OUT/(SE+'-delivered.glb'),'sibling':public/'shells'/(SIBLING+'.glb')}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.render.resolution_x=scene.render.resolution_y=700;scene.render.resolution_percentage=100
    scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    world=bpy.data.worlds.new('Shared neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.12,.12,1);world.node_tree.nodes['Background'].inputs[1].default_value=.6;scene.world=world
    for pos,power,size in [((-.20,.15,.4),4,.35),((.25,-.1,.3),2,.3)]:
        data=bpy.data.lights.new('Shared softbox','AREA');data.energy=power;data.size=size
        light=bpy.data.objects.new('Shared softbox',data);scene.collection.objects.link(light);light.location=pos;light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Camera');data.type='ORTHO';data.ortho_scale=.15;data.clip_start=.001
    cam=bpy.data.objects.new('Camera',data);scene.collection.objects.link(cam);scene.camera=cam
    center=Vector((0,0,.02))
    for name,path in paths.items():
        bpy.ops.import_scene.gltf(filepath=str(path));objects=list(bpy.context.selected_objects)
        for view in ['top','side','front','hero']:
            rotation=Matrix(axes[view]).transposed();cam.matrix_world=rotation.to_4x4();cam.location=center+rotation@Vector((0,0,.4))
            scene.render.filepath=str(OUT/f'{name}-{view}.png');bpy.ops.render.render(write_still=True)
        for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
    print('B2_RENDERS_COMPLETE',flush=True)

if __name__=='__main__':main()
