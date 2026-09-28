"""Bake high-resolution source appearance onto the reconstructed topology."""
import math
import numpy as np
from contextlib import contextmanager
import bpy
from mathutils import Matrix
from asset_utils import activate,material
from color_reconstruction import source_surface
from layer_composite import composite_cover
from bake_ray_math import fallback_selection, fill_from_neighbours, merge_fallback

@contextmanager
def source_channel(objects, channel):
    """Bake the opaque source surface in every channel, then restore its graph.

    Colour channels also bake with metallic 0: Cycles' DIFFUSE colour pass scales
    Base Color by (1 - metallic), which turned metal parts black. Metallic itself
    is baked separately from the untouched socket.
    """
    saved=[]
    def hold(socket):
        value=getattr(socket,'default_value',None)
        saved[-1][1].append((socket,tuple(value) if hasattr(value,'__len__') else value,[link.from_socket for link in socket.links]))
    try:
        for mat in {m for obj in objects for m in obj.data.materials if m}:
            nodes=mat.node_tree.nodes;links=mat.node_tree.links
            shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
            alpha=shader.inputs['Alpha']
            output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL').inputs['Surface']
            saved.append((mat,[],None))
            hold(alpha);hold(output)
            original_alpha=(alpha.links[0].from_socket if alpha.is_linked else None,alpha.default_value)
            for link in list(alpha.links):links.remove(link)
            alpha.default_value=1
            if channel in ('BaseColour','Body'):
                metallic=shader.inputs['Metallic'];hold(metallic)
                for link in list(metallic.links):links.remove(link)
                metallic.default_value=0
            if channel in ('Metallic','CoverAlpha','Hit'):
                emission=nodes.new('ShaderNodeEmission')
                saved[-1]=saved[-1][:2]+(emission,)
                if channel=='Metallic':
                    socket=shader.inputs['Metallic']
                    source,value=(socket.links[0].from_socket if socket.is_linked else None),socket.default_value
                elif channel=='CoverAlpha':source,value=original_alpha
                else:source,value=None,1.0
                if source is not None:links.new(source,emission.inputs['Color'])
                else:emission.inputs['Color'].default_value=(value,)*3+(1,)
                links.new(emission.outputs[0],output)
        yield
    finally:
        for mat,sockets,emission in saved:
            links=mat.node_tree.links
            for socket,value,original in sockets:
                for link in list(socket.links):links.remove(link)
                for source in original:links.new(source,socket)
                if value is not None:socket.default_value=value
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

CHANNELS=[('BaseColour','DIFFUSE'),('Roughness','ROUGHNESS'),('Normal','NORMAL'),('Metallic','EMIT')]
FIRST_REACH=dict(cage_extrusion=.004,max_ray_distance=.012)
# The first pass covers 4 mm above to 8 mm below the shell. The second looks only further
# out (12 to 4 mm above): a deeper miss is a hole in the source skin, and rays through it
# would pick up interior parts, so those texels are filled from neighbours instead.
SECOND_REACH=dict(cage_extrusion=.012,max_ray_distance=.016)

def pixels_of(image):
    pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
    return pixels.reshape(image.size[1],image.size[0],4)

def bake_channel_set(receiver,objects,covers,name,folder,resolution):
    """Bake the four delivered channels with the current bake settings."""
    images={};layers=None
    for channel,bake_type in CHANNELS:
        image=bpy.data.images.new(name+'_'+channel,width=resolution,height=resolution)
        if channel!='BaseColour':image.colorspace_settings.name='Non-Color'
        receiver.image=image
        with source_channel(objects,channel):
            bpy.ops.object.bake(type=bake_type)
        if channel=='BaseColour' and covers:
            layers=composite_cover_layers(receiver,objects,covers,image,folder,resolution)
        images[channel]=image
    return images,layers

def bake_mask(receiver,objects,channel,bake_type,resolution,to_active=True,normal_space='TANGENT'):
    """One temporary float bake with no margin, returned as an (H, W, 4) array."""
    bake=bpy.context.scene.render.bake
    saved=(bake.margin,bake.use_selected_to_active,bake.normal_space)
    image=bpy.data.images.new('mask_'+channel,width=resolution,height=resolution,float_buffer=True)
    image.colorspace_settings.name='Non-Color';receiver.image=image
    bake.margin=0;bake.use_selected_to_active=to_active;bake.normal_space=normal_space
    if not to_active:
        for obj in objects:obj.select_set(False)
    try:
        with source_channel(objects,channel):bpy.ops.object.bake(type=bake_type)
        return pixels_of(image)
    finally:
        if not to_active:
            for obj in objects:obj.select_set(True)
        bake.margin,bake.use_selected_to_active,bake.normal_space=saved
        bpy.data.images.remove(image)

def repair_missed_rays(mesh,receiver,objects,covers,images,name,folder,resolution):
    """O1: second pass, further out, only where the production ray missed.

    A second-pass hit is used only if its source normal faces the same side as the
    shell normal, so rays cannot take colour from the far side of the source.
    Texels still unresolved take the mean of their resolved neighbours on the same
    island instead of staying black. Texels the first pass hit are never changed.
    """
    bake=bpy.context.scene.render.bake
    # The shell's own object-space normals; unbaked atlas texels stay (0, 0, 0).
    own=bake_mask(receiver,objects,'Normal','NORMAL',resolution,to_active=False,normal_space='OBJECT')[...,:3]
    valid=own.sum(-1)>0
    target=own*2-1
    first=bake_mask(receiver,objects,'Hit','EMIT',resolution)[...,0]>.5
    missed=valid&~first
    stats={'validTexels':int(valid.sum()),'firstPassMissedTexels':int(missed.sum()),
           'firstPassMissedShare':float(missed.sum()/max(valid.sum(),1)),'secondReachMm':[SECOND_REACH['cage_extrusion']*1000,SECOND_REACH['max_ray_distance']*1000]}
    if not missed.any():
        return dict(stats,repairedTexels=0,filledTexels=0,unresolvedTexels=0)
    for key,value in SECOND_REACH.items():setattr(bake,key,value)
    try:
        second=bake_mask(receiver,objects,'Hit','EMIT',resolution)[...,0]>.5
        source=bake_mask(receiver,objects,'Normal','NORMAL',resolution,normal_space='OBJECT')[...,:3]*2-1
        extra,_=bake_channel_set(receiver,objects,covers,name+'_reach',folder,resolution)
    finally:
        for key,value in FIRST_REACH.items():setattr(bake,key,value)
    selected=fallback_selection(first,second,source,target,valid)
    resolved=(valid&first)|selected
    filled=unresolved=0
    for channel,image in images.items():
        merged=merge_fallback(pixels_of(image),pixels_of(extra[channel]),selected)
        merged,filled,unresolved=fill_from_neighbours(merged,resolved,valid)
        image.pixels.foreach_set(merged.ravel());image.update()
    for image in extra.values():bpy.data.images.remove(image)
    return dict(stats,repairedTexels=int(selected.sum()),filledTexels=int(filled),unresolvedTexels=int(unresolved),
                method='Second selected-to-active pass for first-pass misses only, looking further out (12 to 4 mm '
                       'above the shell, cage 12 mm, reach 16 mm) and rejecting hits whose source normal faces away '
                       'from the shell; remaining misses (holes in the source skin) filled from resolved neighbours '
                       'on the same island')

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
    folder.mkdir(parents=True,exist_ok=True)
    covers=cover_objects(objects)
    images,layers=bake_channel_set(receiver,objects,covers,record['slug'],folder,resolution)
    fallback=repair_missed_rays(mesh,receiver,objects,covers,images,record['slug'],folder,resolution)
    for channel,image in images.items():
        image.filepath_raw=str(folder/(channel+'.png'));image.file_format='PNG';image.save();image.pack()
    for channel,socket in [('BaseColour','Base Color'),('Roughness','Roughness'),('Metallic','Metallic')]:
        node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=images[channel]
        mat.node_tree.links.new(node.outputs['Color'],shader.inputs[socket])
    normal_tex=mat.node_tree.nodes.new('ShaderNodeTexImage');normal_tex.image=images['Normal']
    normal=mat.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.65
    mat.node_tree.links.new(normal_tex.outputs['Color'],normal.inputs['Color']);mat.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal'])
    mat.node_tree.nodes.remove(receiver)
    for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
    result={'method':'Selected-to-active source appearance baking onto reconstructed UV atlas','resolution':resolution,'maps':list(images),'source':record['arModels'][0],'normalStrength':.65}
    result['missedRayFallback']=fallback
    if layers:result['coverComposite']=dict(layers,method='Base colour: transparent cover composited over the body beneath it in linear light (alpha * cover + (1 - alpha) * body); other channels use the opaque cover')
    return result
