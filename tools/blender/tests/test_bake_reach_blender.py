"""Synthetic check of the two bake reaches: where along the shell normal each pass can hit.

Blender only. A target plane sits at z = 0 (normal +Z); one source plane at a time sits
at a known height. Rays start at the cage and travel inward, so the first pass (cage
4 mm, reach 12 mm) spans +4 to -8 mm and the second (cage 12 mm, reach 16 mm) spans +12
to -4 mm. A texel the first pass missed can therefore only gain a hit 4-12 mm above.
"""
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
    from bake_refinement import FIRST_REACH, SECOND_REACH, bake_mask

# Source height (mm) -> (first pass hits, second pass hits)
EXPECTED = {2: (True, True), 8: (False, True), -2: (True, True),
            -6: (True, False), -10: (False, False), 14: (False, False)}


@unittest.skipUnless(bpy is not None, 'Requires Blender bpy')
class BakeReachTests(unittest.TestCase):
    def hits(self, height_mm, reach):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.mesh.primitive_plane_add(size=.02, location=(0, 0, height_mm / 1000))
        source = bpy.context.object
        source.data.materials.append(bpy.data.materials.new('source'))
        bpy.ops.mesh.primitive_plane_add(size=.02)
        target = bpy.context.object
        mat = bpy.data.materials.new('receiver'); target.data.materials.append(mat)
        receiver = mat.node_tree.nodes.new('ShaderNodeTexImage'); mat.node_tree.nodes.active = receiver
        scene = bpy.context.scene; scene.render.engine = 'CYCLES'; scene.cycles.samples = 1
        bake = scene.render.bake
        bake.use_selected_to_active = True
        for key, value in reach.items():
            setattr(bake, key, value)
        source.select_set(True); target.select_set(True); bpy.context.view_layer.objects.active = target
        mask = bake_mask(receiver, [source], 'Hit', 'EMIT', 32)[8:24, 8:24, 0]
        return bool(np.median(mask) > .5)

    def test_reach_bands(self):
        observed = {}
        for height, (first, second) in EXPECTED.items():
            observed[height] = (self.hits(height, FIRST_REACH), self.hits(height, SECOND_REACH))
        print('BAKE_REACH', observed, flush=True)
        self.assertEqual(observed, EXPECTED)
        # The only texels the second pass can newly resolve are 4-12 mm above the shell.
        gained = [h for h, (first, second) in observed.items() if second and not first]
        self.assertEqual(gained, [8])


if __name__ == '__main__':
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(BakeReachTests))
    if not result.wasSuccessful():
        raise RuntimeError('Bake reach tests failed')
