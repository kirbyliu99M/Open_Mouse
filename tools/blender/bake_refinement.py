"""Bake high-resolution source appearance onto the reconstructed topology."""
import math
import numpy as np
from contextlib import contextmanager
import bpy
from mathutils import Matrix
from asset_utils import activate,material
from color_reconstruction import source_surface
from layer_composite import composite_cover

@contextmanager
def source_channel(objects, channel):
    """Bake the opaque source surface in every channel, then restore its graph."""
    saved=[]
    try:
        for mat in {m for obj in objects for m in obj.data.materials if m}:
            nodes=mat.node_tree.nodes;links=mat.node_tree.links
            shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
            alpha=shader.inputs['Alpha']
            output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL').inputs['Surface']
            saved.append((mat,alpha,alpha.default_value,
                          [link.from_socket for link in alpha.links],output,
                          [link.from_socket for link in output.links],None))
            original_alpha=(alpha.links[0].from_socket if alpha.is_linked else None,alpha.default_value)
            for link in list(alpha.links):links.remove(link)
            alpha.default_value=1
            if channel in ('Metallic','CoverAlpha'):
                emission=nodes.new('ShaderNodeEmission')
                saved[-1]=saved[-1][:-1]+(emission,)
                if channel=='Metallic':
                    socket=shader.inputs['Metallic']
                    source,value=(socket.links[0].from_socket if socket.is_linked else None),socket.default_value
                else:source,value=original_alpha
                if source is not None:links.new(source,emission.inputs['Color'])
                else:emission.inputs['Color'].default_value=(value,)*3+(1,)
                links.new(emission.outputs[0],output)
        yield
    finally:
        for mat,alpha,value,alpha_links,output,output_links,emission in saved:
            links=mat.node_tree.links
            for socket,original in ((alpha,alpha_links),(output,output_links)):
                for link in list(socket.links):links.remove(link)
                for source in original:links.new(source,socket)
            alpha.default_value=value
            if emission is not None:mat.node_tree.nodes.remove(emission)

def cover_objects(objects):
    """Source objects with a transparent layer (scalar alpha < 1 or an alpha texture below 1)."""
    covers=[]
    for obj in objects:
        for mat in obj.data.materials:
            if not mat:continue
            alpha=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Alpha']
            if alpha.is_linked:
                node=alpha.links[0].from_node
                if node.type=='VALUE':transparent=node.outputs[0].default_value<1
                elif node.type=='TEX_IMAGE':
                    pixels=np.empty(len(node.image.pixels),dtype=np.float32);node.image.pixels.foreach_get(pixels)
                    transparent=float(pixels[3::4].min())<1
                else:raise RuntimeError('Unsupported source alpha node: '+node.type)
            else:transparent=alpha.default_value<1
            if transparent:covers.append(obj);break
    return covers

def composite_cover_layers(receiver,objects,covers,colour,folder,resolution):
    """Replace the opaque-cover colour with the cover composited over the body beneath it.

    Two extra bakes into `receiver`: the cover alpha (emission of each source's own
    alpha) and the body colour with the cover objects left out of the selection.
    """
    extra={}
    for channel,bake_type in [('CoverAlpha','EMIT'),('Body','DIFFUSE')]:
        image=bpy.data.images.new(colour.name+'_'+channel,width=resolution,height=resolution)
        if channel=='CoverAlpha':image.colorspace_settings.name='Non-Color'
        receiver.image=image
        if channel=='Body':
            for obj in covers:obj.select_set(False)
        try:
            with source_channel(objects,channel):bpy.ops.object.bake(type=bake_type)
        finally:
            for obj in covers:obj.select_set(True)
        image.filepath_raw=str(folder/(channel+'.png'));image.file_format='PNG';image.save();extra[channel]=image
    def read(image):
        pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
        return pixels.reshape(-1,4)
    cover,body,alpha=read(colour),read(extra['Body']),read(extra['CoverAlpha'])[:,0]
    # Byte sRGB images hold encoded values; composite_cover mixes in linear light.
    cover[:,:3]=composite_cover(cover[:,:3],body[:,:3],alpha)
    colour.pixels.foreach_set(cover.ravel());colour.update()
    stats={'coverObjects':[o.name for o in covers],'texelsComposited':int((alpha<1).sum()),
           'alphaRange':[float(alpha.min()),float(alpha.max())]}
    for image in extra.values():bpy.data.images.remove(image)
    return stats

def bake_materials(mesh,record,calibration,folder,resolution=2048):
    tree,verts,tris,samples,objects=source_surface(record,calibration)
    offset=0
    for obj in objects:
        obj.parent=None;obj.matrix_world=Matrix.Identity(4)
        for vertex in obj.data.vertices:vertex.co=verts[offset+vertex.index]
        offset+=len(obj.data.vertices);obj.data.update()
    activate(mesh)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.015)
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh.data.materials.clear();mat=material('Baked reference appearance',(1,1,1),.5);mesh.data.materials.append(mat)
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    receiver=mat.node_tree.nodes.new('ShaderNodeTexImage');mat.node_tree.nodes.active=receiver
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=4
    scene.render.bake.use_selected_to_active=True
    scene.render.bake.cage_extrusion=.004;scene.render.bake.max_ray_distance=.012
    scene.render.bake.margin=12
    scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True
    scene.render.bake.normal_space='TANGENT'
    for obj in scene.objects:obj.select_set(False)
    for obj in objects:obj.select_set(True)
    mesh.select_set(True);bpy.context.view_layer.objects.active=mesh
    images={};folder.mkdir(parents=True,exist_ok=True)
    covers=cover_objects(objects);layers=None
    for channel,bake_type in [('BaseColour','DIFFUSE'),('Roughness','ROUGHNESS'),('Normal','NORMAL'),('Metallic','EMIT')]:
        image=bpy.data.images.new(record['slug']+'_'+channel,width=resolution,height=resolution)
        if channel!='BaseColour':image.colorspace_settings.name='Non-Color'
        receiver.image=image
        with source_channel(objects,channel):
            bpy.ops.object.bake(type=bake_type)
        if channel=='BaseColour' and covers:
            layers=composite_cover_layers(receiver,objects,covers,image,folder,resolution)
        image.filepath_raw=str(folder/(channel+'.png'));image.file_format='PNG';image.save();image.pack();images[channel]=image
    for channel,socket in [('BaseColour','Base Color'),('Roughness','Roughness'),('Metallic','Metallic')]:
        node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=images[channel]
        mat.node_tree.links.new(node.outputs['Color'],shader.inputs[socket])
    normal_tex=mat.node_tree.nodes.new('ShaderNodeTexImage');normal_tex.image=images['Normal']
    normal=mat.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.65
    mat.node_tree.links.new(normal_tex.outputs['Color'],normal.inputs['Color']);mat.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal'])
    mat.node_tree.nodes.remove(receiver)
    for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
    result={'method':'Selected-to-active source appearance baking onto reconstructed UV atlas','resolution':resolution,'maps':list(images),'source':record['arModels'][0],'normalStrength':.65}
    if layers:result['coverComposite']=dict(layers,method='Base colour: transparent cover composited over the body beneath it in linear light (alpha * cover + (1 - alpha) * body); other channels use the opaque cover')
    return result
