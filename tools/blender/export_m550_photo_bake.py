"""Attach the four lossless maps to one material; export position-lossless Draco."""
from pathlib import Path
import sys
import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from asset_utils import activate, material
OUT=HERE/'out/study-fidelity/b3'


def main():
    bpy.ops.wm.open_mainfile(filepath=str(OUT/'atlas.blend'))
    obj=next(o for o in bpy.context.scene.objects if o.type=='MESH');activate(obj)
    obj.data.materials.clear()
    mat=material('M550 multi-view graphite', (1,1,1), .5);obj.data.materials.append(mat)
    for face in obj.data.polygons:face.material_index=0
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    for name,socket in [('BaseColour','Base Color'),('Roughness','Roughness'),('Metallic','Metallic'),('Normal',None)]:
        image=bpy.data.images.load(str(OUT/(name+'.png')),check_existing=False)
        image.name='M550_'+name
        if name!='BaseColour':image.colorspace_settings.name='Non-Color'
        image.pack();node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
        if socket:mat.node_tree.links.new(node.outputs['Color'],shader.inputs[socket])
        else:
            normal=mat.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.65
            mat.node_tree.links.new(node.outputs['Color'],normal.inputs['Color'])
            mat.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal'])
    bpy.ops.export_scene.gltf(filepath=str(OUT/'logitech-m550-lossless.glb'),export_format='GLB',
        use_selection=True,export_animations=False,export_cameras=False,export_lights=False,
        export_draco_mesh_compression_enable=True,export_draco_position_quantization=0)
    print('M550_LOSSLESS_EXPORTED',flush=True)


if __name__=='__main__':main()
