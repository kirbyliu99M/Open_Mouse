"""Synthetic selected-to-active regression; no manufacturer assets required."""
import sys
import unittest
from pathlib import Path
import numpy as np
try:
    import bpy
except ImportError:
    bpy = None
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if bpy is not None:
    from bake_refinement import source_channel


@unittest.skipUnless(bpy is not None, 'Requires Blender bpy')
class BakeAlphaTests(unittest.TestCase):
    def setUp(self):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.sources = []
        for name, z, roughness, alpha in [('part', .001, .1, 1), ('cover', .002, .8, .25)]:
            bpy.ops.mesh.primitive_plane_add(size=.02, location=(0, 0, z))
            obj = bpy.context.object
            mat = bpy.data.materials.new(name)
            shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            shader.inputs['Roughness'].default_value = roughness
            shader.inputs['Alpha'].default_value = alpha
            shader.inputs['Base Color'].default_value = ((.3, .2, .1, 1) if name == 'part' else (.7, .6, .5, 1))
            obj.data.materials.append(mat)
            self.sources.append(obj)
        self.cover = shader
        # Linked alpha exercises restoration of the original graph as well.
        value = mat.node_tree.nodes.new('ShaderNodeValue')
        value.outputs[0].default_value = .25
        mat.node_tree.links.new(value.outputs[0], shader.inputs['Alpha'])
        bpy.ops.mesh.primitive_plane_add(size=.02)
        target = bpy.context.object
        mat = bpy.data.materials.new('receiver');target.data.materials.append(mat)
        self.image = bpy.data.images.new('roughness', width=32, height=32, float_buffer=True)
        self.image.colorspace_settings.name = 'Non-Color'
        node = mat.node_tree.nodes.new('ShaderNodeTexImage');node.image = self.image
        mat.node_tree.nodes.active = node
        scene = bpy.context.scene;scene.render.engine = 'CYCLES';scene.cycles.samples = 1
        scene.render.bake.use_selected_to_active = True
        scene.render.bake.cage_extrusion = .004;scene.render.bake.max_ray_distance = .012
        for obj in self.sources:obj.select_set(True)

    def median_bake(self):
        bpy.ops.object.bake(type='ROUGHNESS')
        return float(np.median(np.array(self.image.pixels[:]).reshape(32, 32, 4)[8:24, 8:24, 0]))

    def test_roughness_hits_opaque_cover_independent_of_previous_channel(self):
        transparent = self.median_bake()
        for preceding in ('Normal', 'Metallic', 'BaseColour'):
            with source_channel(self.sources, preceding):
                self.assertFalse(self.cover.inputs['Alpha'].is_linked)
                self.assertEqual(self.cover.inputs['Alpha'].default_value, 1)
            with source_channel(self.sources, 'Roughness'):
                opaque = self.median_bake()
            self.assertAlmostEqual(opaque, .8, places=4)
            self.assertTrue(self.cover.inputs['Alpha'].is_linked)
            with source_channel(self.sources, 'BaseColour'):
                self.assertFalse(self.cover.inputs['Alpha'].is_linked)
                self.assertEqual(self.cover.inputs['Alpha'].default_value, 1)
            self.assertTrue(self.cover.inputs['Alpha'].is_linked)
            self.assertAlmostEqual(self.cover.inputs['Alpha'].default_value, .25)
        # Negative control proves this scene detects baking through transparency.
        self.assertGreater(opaque - transparent, .1)
        print(f'ALPHA_REGRESSION transparent={transparent:.6f} opaque={opaque:.6f}', flush=True)

    def test_base_colour_hits_cover_and_restores_after_exception(self):
        scene = bpy.context.scene
        scene.render.bake.use_pass_direct = False
        scene.render.bake.use_pass_indirect = False
        scene.render.bake.use_pass_color = True
        def colour_bake():
            bpy.ops.object.bake(type='DIFFUSE')
            return np.median(np.array(self.image.pixels[:]).reshape(32, 32, 4)[8:24, 8:24, :3], axis=(0, 1))
        transparent = colour_bake()
        with source_channel(self.sources, 'BaseColour'):
            rgb = colour_bake()
        # Independent material: opaque from creation, with identical shader
        # settings. DIFFUSE includes Principled's dielectric energy weighting.
        cover_obj = self.sources[1]
        original = cover_obj.data.materials[0]
        control = bpy.data.materials.new('originally opaque control')
        shader = next(n for n in control.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        shader.inputs['Base Color'].default_value = (.7, .6, .5, 1)
        shader.inputs['Roughness'].default_value = .8
        self.assertEqual(shader.inputs['Alpha'].default_value, 1)
        self.assertFalse(shader.inputs['Alpha'].is_linked)
        cover_obj.data.materials[0] = control
        try:
            control_rgb = colour_bake()
            repeat_rgb = colour_bake()
        finally:
            cover_obj.data.materials[0] = original
        spread = float(np.max(np.abs(control_rgb - repeat_rgb)))
        print(f'COLOUR_CONTROL forced={rgb.tolist()} opaque={control_rgb.tolist()} '
              f'transparent={transparent.tolist()} repeat_spread={spread:.9g}', flush=True)
        np.testing.assert_allclose(rgb, control_rgb, atol=1e-5)
        np.testing.assert_allclose(control_rgb, repeat_rgb, atol=1e-5)
        self.assertGreater(float(np.max(np.abs(transparent - control_rgb))), 1e-5)
        with self.assertRaisesRegex(RuntimeError, 'synthetic'):
            with source_channel(self.sources, 'BaseColour'):
                raise RuntimeError('synthetic')
        self.assertTrue(self.cover.inputs['Alpha'].is_linked)
        self.assertAlmostEqual(self.cover.inputs['Alpha'].default_value, .25)


if __name__ == '__main__':
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(BakeAlphaTests))
    if not result.wasSuccessful():raise RuntimeError('Bake alpha tests failed')
