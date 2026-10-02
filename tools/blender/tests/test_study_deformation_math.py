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

    def test_extended_basis_contains_original_as_special_case(self):
        basis = deformation_basis(self.vertices, asymmetric=True)
        np.testing.assert_array_equal(basis[:,:,:12], deformation_basis(self.vertices))
        params = np.linspace(-1,1,12)
        np.testing.assert_array_equal(deform(self.vertices,np.r_[params,np.zeros(12)],[60,100,40]),
                                      deform(self.vertices,params,[60,100,40]))

    def test_asymmetry_can_move_only_one_side(self):
        basis = deformation_basis(self.vertices, asymmetric=True)
        left = basis[:,:,16]
        right = basis[:,:,19]
        np.testing.assert_array_equal(left[self.vertices[:,0]>=0],0)
        np.testing.assert_array_equal(right[self.vertices[:,0]<=0],0)
        self.assertGreater(np.linalg.norm(left[self.vertices[:,0]<0]),0)
        self.assertGreater(np.linalg.norm(right[self.vertices[:,0]>0]),0)
        # Reflected counterpart has equal outward magnitude and opposite sign.
        np.testing.assert_allclose(left[self.vertices[:,0]<0],-right[self.vertices[:,0]>0])
        params = np.zeros(24)
        params[16] = .5
        moved = deform(self.vertices,params,[60,100,40])
        self.assertFalse(np.allclose(moved[self.vertices[:,0]<0,0],
                                    -moved[self.vertices[:,0]>0,0]))

    def test_extended_ground_seams_bbox_smoothness_and_bound(self):
        points = np.vstack([self.vertices,[0,8,17],[1e-5,8,17],self.vertices[12]])
        basis = deformation_basis(points, asymmetric=True)
        np.testing.assert_array_equal(basis[points[:,2]==0],0)
        self.assertLess(abs(basis[-2]-basis[-3]).max(),1e-5)
        moved = deform(points,np.linspace(-.5,.5,24),[60,100,40])
        np.testing.assert_allclose(np.ptp(moved,axis=0),[60,100,40],atol=1e-12)
        np.testing.assert_array_equal(moved[points[:,2]==0,2],0)
        np.testing.assert_array_equal(moved[12],moved[-1])
        for bad in (np.full(24,5.001),np.full(24,np.nan),np.zeros(23)):
            with self.assertRaises(ValueError):
                deform(points,bad,[60,100,40])

    def test_lateral_shift_even_and_roof_tilt_odd(self):
        basis = deformation_basis(self.vertices, asymmetric=True)
        left, right = self.vertices[:,0]<0, self.vertices[:,0]>0
        np.testing.assert_array_equal(basis[left,0,12:15],basis[right,0,12:15])
        np.testing.assert_array_equal(basis[left,2,21:24],-basis[right,2,21:24])
        self.assertGreater(np.linalg.norm(basis[left,0,12:15]),0)
        self.assertGreater(np.linalg.norm(basis[left,2,21:24]),0)

    def test_delivery_all_three_requirements_and_held_out_strict(self):
        self.assertTrue(delivery_gate([.9,.9],[.901,.902],[.8],[.81])['passed'])
        self.assertTrue(delivery_gate([.9,.9],[.898,.91],[.8],[.81])['passed'])
        self.assertFalse(delivery_gate([.9,.9],[.897,.99],[.8],[.81])['passed'])
        self.assertFalse(delivery_gate([.9,.9],[.9,.9],[.8],[.81])['passed'])
        self.assertFalse(delivery_gate([.9,.9],[.91,.91],[.8],[.8])['passed'])
        with self.assertRaises(ValueError):
            delivery_gate([.9],[float('nan')],[.8],[.81])


if __name__ == '__main__':
    unittest.main()
