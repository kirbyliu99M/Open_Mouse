import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from se_colour_math import (srgb_to_linear,linear_to_srgb,recolour_region,
    remove_smooth_shading,recolour_print,connected_components,component_region,remove_neutral_specular)

class SEColourTests(unittest.TestCase):
    def test_transfer_functions(self):
        rgb=np.array([0,.04045,.5,1])
        np.testing.assert_allclose(linear_to_srgb(srgb_to_linear(rgb)),rgb,atol=3e-8)
        self.assertAlmostEqual(srgb_to_linear(.5),.21404114048223255)

    def test_ratio_preserves_detail_and_black(self):
        rgb=np.array([[.2,.3,.4],[.1,.15,.2],[0,0,0]])
        np.testing.assert_allclose(recolour_region(rgb,rgb[0],[.8,.02,.03]),
            [[.8,.02,.03],[.4,.01,.015],[0,0,0]])
        with self.assertRaises(ValueError):recolour_region(rgb,[0,.1,.1],[1,1,1])

    def test_shading_removes_known_spatial_gradient(self):
        x,y=np.meshgrid(np.linspace(-1,1,40),np.linspace(-1,1,40));xy=np.column_stack([x.ravel(),y.ravel()])
        field=np.exp(.3*xy[:,0]-.2*xy[:,1]+.1*xy[:,0]**2)
        rgb=np.array([.4,.03,.02])[None,:]*field[:,None]
        corrected,keep,_=remove_smooth_shading(rgb,xy)
        self.assertLess(np.std(corrected[:,0]),1e-9)
        np.testing.assert_allclose(corrected[:,0]/corrected[:,1],np.full(len(rgb),.4/.03))
        self.assertGreater(keep.sum(),len(rgb)*.6)

    def test_print_edges_and_ink_can_reverse_contrast(self):
        rgb=np.array([[.6]*3,[.5]*3,[.4]*3])
        result,coverage=recolour_print(rgb,[.6]*3,[.4]*3,[.8,.01,.02],[.5]*3)
        np.testing.assert_allclose(coverage,[0,.5,1])
        np.testing.assert_allclose(result,[[.8,.01,.02],[.65,.255,.26],[.5,.5,.5]])
        with self.assertRaises(ValueError):recolour_print(rgb,[.6]*3,[.6]*3,[0]*3,[1]*3)

    def test_components_use_connectivity_not_colour(self):
        self.assertEqual(connected_components(6,[(0,1),(2,3),(3,4)]),[[2,3,4],[0,1],[5]])
        for upper,part,expected in [(True,1,1),(True,4,2),(True,15,3),(True,0,4),
                (True,8,5),(False,0,6),(False,3,7),(False,9,12),(True,35,10),(True,99,11)]:
            self.assertEqual(component_region(upper,part),expected)

    def test_neutral_specular_subtraction_on_saturated_red(self):
        np.testing.assert_allclose(remove_neutral_specular([[.7,.1,.12],[.6,0,.02]]),[[.6,0,.02],[.6,0,.02]])
