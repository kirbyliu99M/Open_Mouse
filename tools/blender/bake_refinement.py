"""Bake high-resolution source appearance onto the reconstructed topology."""
import math
from contextlib import contextmanager
import bpy
from mathutils import Matrix
from asset_utils import activate,material
from color_reconstruction import source_surface

@contextmanager
def source_channel(objects, channel):
    """Use composite alpha only for colour; restore sources after every channel."""
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
            if channel!='BaseColour':
                for link in list(alpha.links):links.remove(link)
                alpha.default_value=1
            if channel=='Metallic':
                emission=nodes.new('ShaderNodeEmission')
                saved[-1]=saved[-1][:-1]+(emission,)
                socket=shader.inputs['Metallic']
                if socket.is_linked:links.new(socket.links[0].from_socket,emission.inputs['Color'])
                else:emission.inputs['Color'].default_value=(socket.default_value,)*3+(1,)
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
    for channel,bake_type in [('BaseColour','DIFFUSE'),('Roughness','ROUGHNESS'),('Normal','NORMAL'),('Metallic','EMIT')]:
        image=bpy.data.images.new(record['slug']+'_'+channel,width=resolution,height=resolution)
        if channel!='BaseColour':image.colorspace_settings.name='Non-Color'
        receiver.image=image
        with source_channel(objects,channel):
            bpy.ops.object.bake(type=bake_type)
        image.filepath_raw=str(folder/(channel+'.png'));image.file_format='PNG';image.save();image.pack();images[channel]=image
    for channel,socket in [('BaseColour','Base Color'),('Roughness','Roughness'),('Metallic','Metallic')]:
        node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=images[channel]
        mat.node_tree.links.new(node.outputs['Color'],shader.inputs[socket])
    normal_tex=mat.node_tree.nodes.new('ShaderNodeTexImage');normal_tex.image=images['Normal']
    normal=mat.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.65
    mat.node_tree.links.new(normal_tex.outputs['Color'],normal.inputs['Color']);mat.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal'])
    mat.node_tree.nodes.remove(receiver)
    for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
    return {'method':'Selected-to-active source appearance baking onto reconstructed UV atlas','resolution':resolution,'maps':list(images),'source':record['arModels'][0],'normalStrength':.65}
