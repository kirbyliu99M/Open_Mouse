import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from compare_reconstruction import silhouette_metrics, remove_thin_lead
from reconstruct_gallery import cameras, contour


class ReferenceGeometryTests(unittest.TestCase):
    def test_identical_silhouettes_are_exact(self):
        a=np.zeros((40,50),bool);a[10:30,10:40]=True
        result=silhouette_metrics(a,a,.25)
        self.assertEqual(result['silhouetteIoU'],1)
        self.assertEqual(result['boundaryMaxMm'],0)

    def test_translation_measures_physical_distance(self):
        a=np.zeros((40,50),bool);a[10:30,10:40]=True
        b=np.roll(a,2,axis=1)
        result=silhouette_metrics(a,b,.25)
        self.assertAlmostEqual(result['silhouetteIoU'],28/32)
        self.assertAlmostEqual(result['boundaryMaxMm'],.5)

    def test_cable_removed_without_changing_body(self):
        a=np.zeros((70,40),bool);a[20:70,5:35]=True;a[:20,19:21]=True
        b=remove_thin_lead(a)
        self.assertEqual(b.shape[1],30)
        self.assertLessEqual(b.shape[0],51)

    def test_camera_centers_project_to_optical_axis(self):
        target=np.array([.06,.12,.04]);center=np.array([0,0,.02,1])
        for camera in cameras(target):
            matrix=np.array(camera['worldToCamera'])
            point=matrix@center
            np.testing.assert_allclose(point[:2],[0,0],atol=1e-12)
            self.assertLess(point[2],0)
            np.testing.assert_allclose(matrix[:3,:3]@matrix[:3,:3].T,np.eye(3),atol=1e-12)

    def test_contour_uses_each_row_not_a_generic_template(self):
        a=np.zeros((3,9),bool);a[0,3:6]=True;a[1,1:8]=True;a[2,2:7]=True
        low,high=contour(a,0)
        np.testing.assert_array_equal(low,[3,1,2])
        np.testing.assert_array_equal(high,[5,7,6])


if __name__=='__main__':unittest.main()
