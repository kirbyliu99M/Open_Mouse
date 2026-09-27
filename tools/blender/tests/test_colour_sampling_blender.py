"""Run with Blender --background --factory-startup --python-exit-code 1 --python."""
import sys
import unittest
from pathlib import Path
try:
    import bpy
except ImportError:
    bpy = None
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
if bpy is not None:
    from mathutils import Vector
    from color_reconstruction import socket_value, image_pixels

@unittest.skipUnless(bpy is not None, "Requires Blender bpy; run with Blender --background")
class ColourSamplingTests(unittest.TestCase):
    def test_srgb_midpoint_is_linearized(self):
        image=bpy.data.images.new('gamma fixture',width=1,height=1,float_buffer=True)
        image.colorspace_settings.name='sRGB';image.pixels[:]=[.5,.5,.5,1]
        self.assertAlmostEqual(float(image_pixels(image,{})[0,0,0]),.21404114,places=5)
        bpy.data.images.remove(image)

    def test_texture_uv_and_pbr_channels(self):
        mat=bpy.data.materials.new('sampling fixture')
        nodes=mat.node_tree.nodes
        shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
        image=bpy.data.images.new('PBR fixture',width=2,height=2,float_buffer=True)
        image.colorspace_settings.name='Non-Color'
        image.pixels[:]=[.1,.2,.3,1, .4,.5,.6,1, .7,.8,.9,1, 1,1,1,1]
        tex=nodes.new('ShaderNodeTexImage');tex.image=image
        split=nodes.new('ShaderNodeSeparateColor')
        mat.node_tree.links.new(tex.outputs['Color'],split.inputs[0])
        mat.node_tree.links.new(split.outputs[1],shader.inputs['Roughness'])
        mat.node_tree.links.new(split.outputs[2],shader.inputs['Metallic'])
        self.assertAlmostEqual(float(socket_value(shader.inputs['Roughness'],Vector((.25,.25)),{})),.2,places=5)
        self.assertAlmostEqual(float(socket_value(shader.inputs['Metallic'],Vector((.25,.25)),{})),.3,places=5)
        self.assertAlmostEqual(float(socket_value(shader.inputs['Roughness'],Vector((.5,.25)),{})),.35,places=5)
        bpy.data.materials.remove(mat);bpy.data.images.remove(image)

    def test_uniform_unlinked_colour(self):
        mat=bpy.data.materials.new('constant fixture')
        node=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        node.inputs['Base Color'].default_value=(.1,.2,.3,1)
        np.testing.assert_allclose(socket_value(node.inputs['Base Color'],Vector((0,0)),{}),[.1,.2,.3,1],atol=1e-6)
        bpy.data.materials.remove(mat)

if __name__ == '__main__':
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(ColourSamplingTests))
    if not result.wasSuccessful():raise RuntimeError('Colour sampling tests failed')
