"""Canonical desk orientation and source-UV material transfer onto rebuilt shells."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
import bmesh
import numpy as np
from mathutils import Matrix,Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from color_reconstruction import LIB,REBUILT
from asset_utils import export_glb,validate_mesh,dimensions_mm,material
OUT=HERE/'out/polished'
REVERSE={'ergo-m575','g-pro-2-lightspeed','g-pro-x-superlight-2-dex','g309','g403-hero','g502-hero','g502-x','g502-x-lightspeed','g502-x-plus','g703-lightspeed','m190','m196','m650','m720-triathlon','mx-anywhere-3s','pop-mouse','g-pro-x-superlight-2-se','m100','m550','m705-marathon'}

def orient(mesh,slug,dimensions):
    rotation=Matrix.Rotation(math.pi if slug.removeprefix('logitech-') in REVERSE else 0,4,'Z')
    if slug=='logitech-mx-vertical':rotation=Matrix.Rotation(math.pi,4,'Z')
    if slug in {'logitech-g-pro-x-superlight-2-se','logitech-m100','logitech-m550','logitech-m705-marathon'}:
        rotation=Matrix.Diagonal((1,-1,1,1))
        bm=bmesh.new();bm.from_mesh(mesh.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(mesh.data);bm.free()
    axis_fix=slug in {'logitech-lift-vertical','logitech-mx-vertical'}
    if axis_fix:rotation=rotation@Matrix.Rotation(math.pi/2,4,'Y')
    coords=np.array([tuple(rotation@v.co) for v in mesh.data.vertices])
    low=coords.min(axis=0);high=coords.max(axis=0)
    coords=(coords-low)/(high-low)*dimensions
    coords[:,:2]-=np.array(dimensions[:2])/2
    for v,co in zip(mesh.data.vertices,coords):v.co=co
    mesh.data.update()
    bpy.context.view_layer.update()
    return {'up':'+Z','forward':'+Y','groundZ':0,'rotationMatrix':[list(row) for row in rotation], 'correctedWidthHeightSwap':axis_fix,'dimensionScale':(np.array(dimensions)/(high-low)).tolist()}

def render(scene,folder,dimensions):
    data=bpy.data.cameras.new('Polish camera');data.type='ORTHO';data.clip_start=.001
    cam=bpy.data.objects.new('Polish camera',data);scene.collection.objects.link(cam);scene.camera=cam
    scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=scene.render.resolution_y=800
    scene.render.resolution_percentage=100;scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.world=bpy.data.worlds.new('Polish studio');scene.world.color=(.3,.3,.3)
    center=Vector((0,0,dimensions[2]/2))
    for pos,power in [((-.25,.15,.5),7),((.3,-.2,.4),4)]:
        light=bpy.data.lights.new('Softbox','AREA');light.energy=power;light.size=.35
        obj=bpy.data.objects.new('Softbox',light);scene.collection.objects.link(obj);obj.location=pos
        obj.rotation_euler=(center-obj.location).to_track_quat('-Z','Y').to_euler()
    (folder/'renders').mkdir(exist_ok=True)
    for name,pos in [('top',(0,0,.6)),('hero',(.25,-.35,.32)),('side',(.5,0,.04)),('bottom',(0,0,-.6))]:
        cam.location=center+Vector(pos)
        cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
        if name=='top':cam.rotation_euler=(0,0,0)
        data.ortho_scale=max(dimensions)*1.35
        scene.render.filepath=str(folder/'renders'/(name+'.png'));bpy.ops.render.render(write_still=True)

def polish(slug):
    record=json.loads((LIB/slug/'sources.json').read_text());report=json.loads((REBUILT/slug/'reconstruction.json').read_text())
    scene=bpy.data.scenes.new('Polished_'+slug);bpy.context.window.scene=scene
    prior=(REBUILT if record['arModels'] else HERE/'out/colored')/slug/(slug+'.blend')
    with bpy.data.libraries.load(str(prior),link=False) as (source,target):target.objects=[slug]
    mesh=target.objects[0];scene.collection.objects.link(mesh)
    calibration=json.loads((HERE/report['cameraFile']).read_text())
    if record['arModels']:
        from bake_refinement import bake_materials
        report['textureRefinement']=bake_materials(mesh,record,calibration,OUT/slug/'textures')
    else:
        width,length,height=report['dimensionsXYZ']
        mesh.data.materials.clear()
        mat=material('Gallery surface',(.08,.08,.08),.58)
        shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        texture=mat.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image=bpy.data.images.load(str(OUT/slug/'textures/GalleryTop.png'));texture.image.pack()
        mat.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
        mesh.data.materials.append(mat)
        base=material('Matte underside',(.012,.014,.016),.7);mesh.data.materials.append(base)
        colours={'logitech-g-pro-x-superlight-2-se':(.515,.014,.024),'logitech-m100':(.033,.036,.041),'logitech-m550':(.06,.063,.067),'logitech-m705-marathon':(.065,.068,.074)}
        side=material('Matched matte side',colours[slug],.58);mesh.data.materials.append(side)
        uv=mesh.data.uv_layers.new(name='GalleryProjection')
        for polygon in mesh.data.polygons:
            polygon.material_index=1 if polygon.normal.z<-.35 else (2 if polygon.normal.z<.5 else 0)
            for loop,idx in zip(polygon.loop_indices,polygon.vertices):
                co=mesh.data.vertices[idx].co;uv.data[loop].uv=(co.x/width+.5,.5-co.y/length)
        report['textureRefinement']={'method':'Model-specific top-gallery image projected onto upper shell; matched matte sides and underside','approximate':True,'source':report['source'][0],'limitation':'Top photograph includes lighting; side detail and raised wheel remain approximate'}
    dims=np.array([record['widthMm'],record['lengthMm'],record['heightMm']])/1000
    report['orientation']=orient(mesh,slug,dims)
    mesh['orientation']='Base on Z=0; buttons up; nose +Y; glTF maps up to +Y and nose to -Z'
    report['mesh']=validate_mesh(mesh);report['dimensionsXYZmm']=dimensions_mm(mesh)
    folder=OUT/slug;folder.mkdir(parents=True,exist_ok=True)
    export_glb([mesh],folder/(slug+'.glb'))
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/(slug+'.blend')))
    (folder/'reconstruction.json').write_text(json.dumps(report,indent=2)+'\n')
    render(scene,folder,dims)
    print('POLISHED',slug,flush=True)
    for obj in list(scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
    bpy.context.window.scene=bpy.data.scenes[0];bpy.data.scenes.remove(scene);bpy.data.orphans_purge(do_recursive=True)

if __name__=='__main__':
    if not bpy.app.background:raise RuntimeError('Background only')
    parser=argparse.ArgumentParser();parser.add_argument('--model');args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    for path in sorted(REBUILT.glob('*/reconstruction.json')):
        if not args.model or path.parent.name in args.model.split(','):polish(path.parent.name)
