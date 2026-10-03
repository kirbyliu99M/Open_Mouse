import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from photo_camera_fit import clean_mask, crop_mask, evaluation_raster, silhouette_gap_mm
from photo_camera_math import silhouette_iou
from study_photo_inventory import specifications


class SharedCameraTests(unittest.TestCase):
    def test_mask_keeps_open_notch_fills_hole_removes_speck(self):
        mask = np.zeros((12,12), bool)
        mask[2:10,2:10] = True
        mask[5,5] = False
        mask[2:4,5] = False
        mask[0,0] = True
        result = clean_mask(mask)
        self.assertTrue(result[5,5])
        self.assertFalse(result[0,0])
        self.assertFalse(result[2:4,5].any())
        with self.assertRaises(ValueError):
            clean_mask(np.zeros((3,3), bool))

    def test_crop_preserves_full_mask_and_clips_padding(self):
        mask = np.zeros((20,30), bool)
        mask[1:10,4:12] = True
        cropped, crop = crop_mask(mask, 3)
        self.assertEqual(crop, [1,0,15,13])
        self.assertEqual(cropped.sum(), mask.sum())

    def test_target_plane_gap_known_pixel_translation(self):
        a = np.zeros((30,30),bool)
        b = a.copy()
        a[5:15,5:15] = True
        b[5:15,8:18] = True
        self.assertAlmostEqual(silhouette_gap_mm(a,b,.2), .6)
        self.assertEqual(silhouette_gap_mm(a,a,.2), 0)

    def test_evaluation_actual_triangle_union_with_fixed_camera(self):
        verts = np.array([[-5,-5,0],[5,-5,0],[5,5,0],[-5,5,0]])
        faces = np.array([[0,1,2],[0,2,3],[2,1,0],[3,2,0]])
        params = [180,90,0,np.log(300),np.log(1),0,0]
        target = np.zeros((21,21),bool)
        target[5:16,5:16] = True
        rendered, truth, scale = evaluation_raster(verts,faces,target,params,[0,0,0],21)
        self.assertEqual(silhouette_iou(rendered,truth), 1)
        self.assertEqual(scale, 1)

    def test_inventory_split_all_usable_files_and_no_duplicate_leak(self):
        specs = specifications()
        self.assertEqual(sum(map(len,specs.values())), 35)
        self.assertEqual(sum(r['role']!='excluded' for rows in specs.values() for r in rows), 30)
        for rows in specs.values():
            self.assertEqual(sum(r['role']=='held-out' for r in rows),1)
            groups = {}
            for r in rows:
                if 'duplicateGroup' in r:
                    groups.setdefault(r['duplicateGroup'],set()).add(r['role'])
            self.assertTrue(all(len(roles)==1 for roles in groups.values()))


if __name__ == '__main__':
    unittest.main()
