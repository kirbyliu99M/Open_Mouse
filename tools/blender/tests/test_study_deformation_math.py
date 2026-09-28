import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from study_deformation_math import calibrate_bbox, deform, deformation_basis, delivery_gate


class StudyDeformationTests(unittest.TestCase):
    def setUp(self):
        self.vertices = np.array([[x,y,z] for x in (-30,0,30)
                                  for y in (-50,0,50) for z in (0,20,40)], float)

    def test_zero_parameters_identity_and_no_input_mutation(self):
        original = self.vertices.copy()
        np.testing.assert_allclose(deform(original,np.zeros(12),[60,100,40]),original,atol=1e-14)
        np.testing.assert_array_equal(original,self.vertices)

    def test_deformation_ground_bbox_and_seam_duplicates(self):
        points = np.vstack([self.vertices,self.vertices[12]])
        moved = deform(points,np.linspace(-1,1,12),[60,100,40])
        np.testing.assert_allclose(np.ptp(moved,axis=0),[60,100,40],atol=1e-12)
        np.testing.assert_array_equal(moved[points[:,2]==0,2],0)
        np.testing.assert_array_equal(moved[12],moved[-1])
        self.assertGreater(np.linalg.norm(moved-points),0)

    def test_basis_is_smooth_and_ground_fixed(self):
        epsilon = 1e-5
        points = np.vstack([self.vertices,[4,8,17],[4+epsilon,8,17]])
        basis = deformation_basis(points)
        np.testing.assert_array_equal(basis[points[:,2]==0],0)
        self.assertLess(abs(basis[-1]-basis[-2]).max(),epsilon)

    def test_reject_bad_parameters(self):
        with self.assertRaises(ValueError):
            deform(self.vertices,np.full(12,6),[60,100,40])
        with self.assertRaises(ValueError):
            calibrate_bbox(np.zeros((8,3)),[60,100,40])

    def test_delivery_all_three_requirements_and_held_out_strict(self):
        self.assertTrue(delivery_gate([.9,.9],[.901,.902],[.8],[.81])['passed'])
        self.assertFalse(delivery_gate([.9,.9],[.897,.99],[.8],[.81])['passed'])
        self.assertFalse(delivery_gate([.9,.9],[.9,.9],[.8],[.81])['passed'])
        self.assertFalse(delivery_gate([.9,.9],[.91,.91],[.8],[.8])['passed'])
        with self.assertRaises(ValueError):
            delivery_gate([.9],[float('nan')],[.8],[.81])


if __name__ == '__main__':
    unittest.main()
