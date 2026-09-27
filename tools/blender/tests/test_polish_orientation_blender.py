"""Canonical axis and handedness regression tests; run in background Blender."""
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
    from polish_reconstruction import orient
    from asset_utils import validate_mesh,dimensions_mm

@unittest.skipUnless(bpy is not None, "Requires Blender bpy; run with Blender --background")
class OrientationTests(unittest.TestCase):
    def cube(self):
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj=bpy.context.object
        for v in obj.data.vertices:v.co.x*=.06;v.co.y*=.12;v.co.z=v.co.z*.04+.02
        return obj

    def test_reversed_nose_becomes_positive_y(self):
        obj=self.cube();index=next(v.index for v in obj.data.vertices if v.co.y<0)
        orient(obj,'logitech-g403-hero',np.array([.06,.12,.04]))
        self.assertGreater(obj.data.vertices[index].co.y,0)
        self.assertAlmostEqual(min(v.co.z for v in obj.data.vertices),0,places=7)
        np.testing.assert_allclose(dimensions_mm(obj),[60,120,40],atol=.0001)

    def test_vertical_axis_fix_uses_original_base(self):
        obj=self.cube();index=max(range(len(obj.data.vertices)),key=lambda i:obj.data.vertices[i].co.x)
        result=orient(obj,'logitech-lift-vertical',np.array([.07,.108,.071]))
        self.assertTrue(result['correctedWidthHeightSwap'])
        self.assertAlmostEqual(obj.data.vertices[index].co.z,0,places=6)
        validate_mesh(obj)

    def test_gallery_reflection_preserves_outward_normals(self):
        obj=self.cube();index=next(v.index for v in obj.data.vertices if v.co.y<0)
        orient(obj,'logitech-m100',np.array([.062,.113,.038]))
        self.assertGreater(obj.data.vertices[index].co.y,0)
        self.assertGreater(validate_mesh(obj)['volumeMm3'],0)

if __name__ == '__main__':
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(OrientationTests))
    if not result.wasSuccessful():raise RuntimeError('Orientation tests failed')
