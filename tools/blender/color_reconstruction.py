"""Sample official AR albedo/PBR onto rebuilt geometry; never change its vertices.

Output retains source attribution. Vertex colours intentionally limit texture
detail; this is a material approximation, not measured colour calibration.
"""
import argparse
import json
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from asset_utils import material, export_glb, validate_mesh
LIB=HERE/'out/reference-library'
REBUILT=HERE/'out/reconstructed'
OUT=HERE/'out/colored'

def image_pixels(image, cache):
    if image.name not in cache:
        pixels=np.empty(len(image.pixels),dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels=pixels.reshape(image.size[1],image.size[0],image.channels)
        if image.colorspace_settings.name=='sRGB':
            rgb=pixels[:,:,:3]
            pixels[:,:,:3]=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
        cache[image.name]=pixels
    return cache[image.name]

def socket_value(socket, uv, cache):
    if not socket.is_linked:
        value=socket.default_value
        return np.array(value) if hasattr(value,'__len__') else float(value)
    link=socket.links[0];node=link.from_node
    if node.type=='TEX_IMAGE':
        pixels=image_pixels(node.image,cache)
        # Imported glTF UVs are already in Blender's bottom-up image convention.
        h,w=pixels.shape[:2]
        x=float(uv.x%1)*w-.5;y=float(uv.y%1)*h-.5
        ix,iy=int(np.floor(x)),int(np.floor(y));fx,fy=x-ix,y-iy
        return ((pixels[iy%h,ix%w]*(1-fx)+pixels[iy%h,(ix+1)%w]*fx)*(1-fy)
                +(pixels[(iy+1)%h,ix%w]*(1-fx)+pixels[(iy+1)%h,(ix+1)%w]*fx)*fy)
    if node.type=='SEPARATE_COLOR':
        value=socket_value(node.inputs[0],uv,cache)
        return value[list(node.outputs).index(link.from_socket)]
    if node.type=='MATH' and node.operation=='MULTIPLY':
        return socket_value(node.inputs[0],uv,cache)*socket_value(node.inputs[1],uv,cache)
    raise RuntimeError('Unsupported source material node: '+node.type)

def source_surface(record, calibration):
    bpy.ops.import_scene.gltf(filepath=str(LIB/record['arModels'][0]['file']))
    objects=[o for o in bpy.context.selected_objects if o.type=='MESH']
    points=[obj.matrix_world@v.co for obj in objects for v in obj.data.vertices]
    low=Vector([min(p[a] for p in points) for a in range(3)])
    high=Vector([max(p[a] for p in points) for a in range(3)])
    trim=calibration.get('cableTrim')
    if trim:low[trim['axis']],high[trim['axis']]=trim['after']
    order=calibration['sourceAxisPermutation']
    mapping=Matrix([[int(c==order[r]) for c in range(3)] for r in range(3)])
    if mapping.determinant()<0:mapping[0]=-mapping[0]
    target=calibration['dimensionsXYZ'];size=high-low
    vertices=[];triangles=[];samples=[]
    for obj in objects:
        offset=len(vertices)
        for vertex in obj.data.vertices:
            p=mapping@(obj.matrix_world@vertex.co-(low+high)/2)
            vertices.append(Vector([p[a]*target[a]/size[order[a]]+(target[2]/2 if a==2 else 0) for a in range(3)]))
        obj.data.calc_loop_triangles()
        uvdata=obj.data.uv_layers.active.data if obj.data.uv_layers.active else None
        for tri in obj.data.loop_triangles:
            triangles.append(tuple(offset+i for i in tri.vertices))
            uv=[Vector((*uvdata[i].uv,0)) for i in tri.loops] if uvdata else [Vector((0,0,0))]*3
            mat=obj.data.materials[tri.material_index]
            shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            samples.append((uv,shader))
    return BVHTree.FromPolygons(vertices,triangles,all_triangles=True),vertices,triangles,samples,objects

def colorize(slug):
    record=json.loads((LIB/slug/'sources.json').read_text())
    report=json.loads((REBUILT/slug/'reconstruction.json').read_text())
    scene=bpy.data.scenes.new('Colour_'+slug);bpy.context.window.scene=scene
    with bpy.data.libraries.load(str(REBUILT/slug/(slug+'.blend')),link=False) as (source,target):
        target.objects=[slug]
    mesh=target.objects[0];scene.collection.objects.link(mesh)
    before=np.array([v.co[:] for v in mesh.data.vertices])
    cache={};distances=[];values=[]
    calibration=json.loads((HERE/report['cameraFile']).read_text())
    if record['arModels']:
        tree,verts,tris,samples,source_objects=source_surface(record,calibration)
        for vertex in mesh.data.vertices:
            position,normal,index,distance=tree.find_nearest(vertex.co)
            uv,shader=samples[index];tri=tris[index]
            coord=barycentric_transform(position,*(verts[i] for i in tri),*uv)
            color=np.asarray(socket_value(shader.inputs['Base Color'],coord,cache))[:3]
            rough=float(socket_value(shader.inputs['Roughness'],coord,cache))
            metal=float(socket_value(shader.inputs['Metallic'],coord,cache))
            values.append((color,rough,metal));distances.append(distance*1000)
        for obj in source_objects:bpy.data.objects.remove(obj,do_unlink=True)
        provenance={'method':'Nearest-surface sampling of official AR base colour, roughness and metallic maps onto unchanged rebuilt mesh','source':record['arModels'][0],
                    'distanceP95mm':float(np.percentile(distances,95)),'distanceMaxMm':max(distances)}
    else:
        # Conservative, photo-matched shell palette only: no invented component boundaries.
        choices={'logitech-g-pro-x-superlight-2-se':('#be202b','red'), 'logitech-m100':('#333539','charcoal'),
                 'logitech-m550':('#454749','graphite'),'logitech-m705-marathon':('#484a4d','charcoal'),
                 'logitech-m750':('#4a4c50','graphite'),'logitech-m325s':('#3c3e42','graphite'),
                 'logitech-signature-comfort-plus-m850l':('#454749','graphite'),'logitech-mx-ergo-s':('#424548','graphite'),
                 'logitech-ergo-m575s':('#3c3e42','black'),'logitech-g903-hero':('#292a2c','black')}
        hexcode,variant=choices[slug]
        srgb=np.array([int(hexcode[i:i+2],16)/255 for i in (1,3,5)])
        color=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)
        values=[(color,.58,0) for vertex in mesh.data.vertices]
        provenance={'method':'Approximate shell palette from model-specific gallery; component colours remain unverified','variant':variant,'sRGB':hexcode,'source':report['source']}
    mesh.data.materials.clear()
    attribute=mesh.data.color_attributes.new(name='ReferenceColour',type='FLOAT_COLOR',domain='POINT')
    for item,(color,rough,metal) in zip(attribute.data,values):item.color=(*np.clip(color,0,1),1)
    mesh.data.color_attributes.active_color=attribute
    slots={}
    for polygon in mesh.data.polygons:
        rough=np.mean([values[i][1] for i in polygon.vertices]);metal=np.mean([values[i][2] for i in polygon.vertices])
        key=(max(.15,min(.95,round(float(rough)*4)/4)),round(float(metal)*2)/2)
        if key not in slots:
            mat=material('Reference finish '+str(key),(1,1,1),key[0])
            shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            shader.inputs['Metallic'].default_value=key[1]
            node=mat.node_tree.nodes.new('ShaderNodeVertexColor');node.layer_name=attribute.name
            mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
            mat.diffuse_color=(*np.median([v[0] for v in values],axis=0),1)
            slots[key]=len(mesh.data.materials);mesh.data.materials.append(mat)
        polygon.material_index=slots[key]
    assert np.array_equal(before,np.array([v.co[:] for v in mesh.data.vertices]))
    stats=validate_mesh(mesh)
    folder=OUT/slug;folder.mkdir(parents=True,exist_ok=True)
    report['colourVerification']={**provenance,'geometryUnchanged':True,'materials':len(slots),'textureDetail':'Vertex-sampled; small logos/seams may blur. Roughness/metallic quantized. No normal-map transfer.'}
    report['mesh']=stats
    export_glb([mesh],folder/(slug+'.glb'))
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/(slug+'.blend')))
    (folder/'reconstruction.json').write_text(json.dumps(report,indent=2)+'\n')
    # Identical reference cameras make colour/finish comparison reviewable.
    camera_data=bpy.data.cameras.new('ColourCamera');camera_data.type='ORTHO';camera_data.clip_start=.0001
    camera=bpy.data.objects.new('ColourCamera',camera_data);scene.collection.objects.link(camera);scene.camera=camera
    scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=scene.render.resolution_y=640
    scene.render.resolution_percentage=100;scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.world=bpy.data.worlds.new('Colour studio');scene.world.color=(.35,.35,.35)
    for pos,power in [((-.3,-.3,.6),8),((.3,.15,.45),4)]:
        data=bpy.data.lights.new('Softbox','AREA');data.energy=power;data.size=.35
        obj=bpy.data.objects.new('Softbox',data);scene.collection.objects.link(obj)
        obj.location=pos;obj.rotation_euler=(-obj.location).to_track_quat('-Z','Y').to_euler()
    (folder/'renders').mkdir(exist_ok=True)
    for view in calibration['views']:
        if view['name'] not in ['top','elevated-225']:continue
        camera.matrix_world=Matrix(view['worldToCamera']).inverted();camera_data.ortho_scale=view['orthoScale']
        scene.render.filepath=str(folder/'renders'/view['image']);bpy.ops.render.render(write_still=True)
    print('COLOURED',slug,json.dumps(report['colourVerification']),flush=True)
    for obj in list(scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
    bpy.context.window.scene=bpy.data.scenes[0];bpy.data.scenes.remove(scene);bpy.data.orphans_purge(do_recursive=True)

if __name__=='__main__':
    if not bpy.app.background:raise RuntimeError('Background only')
    parser=argparse.ArgumentParser();parser.add_argument('--model');args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    for path in sorted(REBUILT.glob('*/reconstruction.json')):
        if not args.model or path.parent.name in args.model.split(','):colorize(path.parent.name)
