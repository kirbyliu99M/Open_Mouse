import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from geometry_audit_math import area_weighted_samples, distance_summary, inside_box, to_pixels


class GeometryAuditMathTests(unittest.TestCase):
    def test_samples_lie_on_the_mesh_and_follow_area(self):
        # Two triangles: a unit square at z=0 and a 4x larger one at z=1.
        vertices = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 0, 1], [0, 2, 1]], float)
        faces = np.array([[0, 1, 2], [3, 4, 5]])
        points = area_weighted_samples(vertices, faces, 20000, np.random.default_rng(1))
        small = points[:, 2] == 0
        self.assertTrue(np.all((points[small, 0] + points[small, 1]) <= 1 + 1e-12))
        self.assertTrue(np.all((points[~small, 0] + points[~small, 1]) <= 2 + 1e-12))
        self.assertAlmostEqual(small.mean(), .2, delta=.01)

    def test_distance_summary(self):
        s = distance_summary([0, 0.5, 1.5, 3])
        self.assertEqual((s['max'], s['shareOver1mm'], s['shareOver2mm']), (3, .5, .25))
        self.assertAlmostEqual(s['mean'], 1.25)

    def test_inside_box_drops_a_cable(self):
        dims = np.array([.06, .12, .04])
        vertices = np.array([[0, 0, 0], [.01, 0, .01], [0, .01, .01],   # body
                             [0, .06, .01], [0, .09, .01], [.001, .09, .01]])  # cable past the front
        faces = np.array([[0, 1, 2], [3, 4, 5]])
        np.testing.assert_array_equal(inside_box(vertices, faces, dims, .001), [[0, 1, 2]])

    def test_to_pixels_flips_vertical_axis(self):
        points = np.array([[0, 0, 0], [1, 1, 1]], float)
        xy = to_pixels(points, np.zeros(3), 1.0, 11, 0, 2)
        np.testing.assert_allclose(xy, [[0, 10], [10, 0]])


if __name__ == '__main__':
    unittest.main()
