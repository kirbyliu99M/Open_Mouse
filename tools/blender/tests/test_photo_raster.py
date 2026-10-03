from pathlib import Path
import sys
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from photo_raster import uv_buffer, camera_buffer


class PhotoRasterTests(unittest.TestCase):
    def test_uv_interpolates_surface_and_respects_empty_atlas(self):
        vertices = np.array([[0., 0, 0], [4, 0, 0], [0, 4, 0]])
        uv = np.array([[[.1, .9], [.9, .9], [.1, .1]]])
        xyz, normals, ids = uv_buffer(vertices, np.array([[0, 1, 2]]), uv, np.array([[[0., 0, 1]]*3]), 5)
        np.testing.assert_allclose(xyz[2, 2], [2, 2, 0], atol=1e-7)
        np.testing.assert_allclose(normals[2, 2], [0, 0, 1])
        self.assertEqual(ids[4, 4], -1)

    def test_depth_test_selects_near_triangle_independent_of_order(self):
        vertices = np.array([[0., 0, 2], [4, 0, 2], [0, 4, 2], [0, 0, 1], [4, 0, 1], [0, 4, 1]])
        faces = np.array([[0, 1, 2], [3, 4, 5]])
        normal = np.array([[[0., 0, 1]]*3]*2)
        for fs in [faces, faces[::-1]]:
            depth, xyz, _ = camera_buffer(vertices, fs, normal, vertices[:, :2], vertices[:, 2], (5, 5))
            self.assertEqual(depth[1, 1], 1)
            np.testing.assert_allclose(xyz[1, 1], [1, 1, 1])
            self.assertTrue(np.isinf(depth[4, 4]))
