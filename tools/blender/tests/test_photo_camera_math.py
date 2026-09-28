import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from photo_camera_math import camera_axes, project_points, silhouette_iou


class PhotoCameraTests(unittest.TestCase):
    def test_axes_rotation_and_view_classes(self):
        for angles in [(180, 90, 0), (-90, 0, 0), (-135, 35, 25), (0, -90, 0)]:
            axes = camera_axes(*angles)
            np.testing.assert_allclose(axes@axes.T, np.eye(3), atol=1e-14)
            self.assertAlmostEqual(np.linalg.det(axes), 1)
        np.testing.assert_allclose(camera_axes(180, 90), np.eye(3), atol=1e-14)
        np.testing.assert_allclose(camera_axes(-90, 0)[2], [-1, 0, 0], atol=1e-14)

    def test_perspective_foreshortening_and_translation(self):
        pixels, depth = project_points([[10, 20, 0], [10, 20, 50]], np.eye(3),
                                       [0, 0, 0], 100, 200, [5, -5], [50, 50])
        np.testing.assert_allclose(pixels, [[80, 20], [110, -10]])
        np.testing.assert_array_equal(depth, [100, 50])

    def test_camera_centre_and_behind_rejection(self):
        p, _ = project_points([[1, 2, 3]], np.eye(3), [1, 2, 3], 100, 200, [0, 0], [12, 34])
        np.testing.assert_array_equal(p, [[12, 34]])
        with self.assertRaises(ValueError):
            project_points([[0, 0, 100]], np.eye(3), [0, 0, 0], 100, 200, [0, 0], [0, 0])

    def test_iou_does_not_normalize_away_shape_or_scale(self):
        self.assertEqual(silhouette_iou([1, 1, 0], [0, 1, 1]), 1/3)
        self.assertEqual(silhouette_iou([1, 1], [1, 1]), 1)
        with self.assertRaises(ValueError):
            silhouette_iou([0], [0])
