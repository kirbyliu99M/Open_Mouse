import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gap_bridge_math import classify_inside_samples, first_hit, triangle_normals


def quad(x0, x1, y0, y1, z, up=True):
    """Two triangles in the plane z, normal +Z when up, -Z otherwise."""
    a, b, c, d = [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]
    tris = [[a, b, c], [a, c, d]] if up else [[a, c, b], [a, d, c]]
    return np.array(tris, float)


class FirstHitTests(unittest.TestCase):
    def test_hits_the_nearest_face_along_the_ray(self):
        tri = np.vstack([quad(-5, 5, -5, 5, 3), quad(-5, 5, -5, 5, 8)])
        t, k = first_hit([0, 0, 0], [0, 0, 1], tri, 20)
        self.assertAlmostEqual(t, 3)
        self.assertIn(k, (0, 1))

    def test_misses_beyond_range_and_behind(self):
        tri = quad(-5, 5, -5, 5, 30)
        self.assertEqual(first_hit([0, 0, 0], [0, 0, 1], tri, 15), (np.inf, -1))
        self.assertEqual(first_hit([0, 0, 0], [0, 0, -1], quad(-5, 5, -5, 5, 3), 15), (np.inf, -1))

    def test_normals(self):
        np.testing.assert_allclose(triangle_normals(quad(0, 1, 0, 1, 0))[:, 2], 1)
        np.testing.assert_allclose(triangle_normals(quad(0, 1, 0, 1, 0, up=False))[:, 2], -1)


class ClassifyTests(unittest.TestCase):
    def test_shell_under_a_real_bump_is_missing_material(self):
        # Product skin 3 mm above the shell sample, facing outward (+Z).
        source = quad(-10, 10, -10, 10, 3)
        labels = classify_inside_samples([[0, 0, 0]], [[0, 0, 1]], [3.], source)
        self.assertEqual(labels, ['missing-material'])

    def test_shell_over_a_slot_with_an_inner_wall_below_bridges_a_gap(self):
        # Nearest surface is the housing's inner wall 4 mm below, facing down into the product;
        # above the sample there is only air.
        source = quad(-10, 10, -10, 10, -4, up=False)
        labels = classify_inside_samples([[0, 0, 0]], [[0, 0, 1]], [4.], source)
        self.assertEqual(labels, ['bridges-gap'])

    def test_a_ray_through_the_slot_to_far_skin_is_not_missing_material(self):
        # Near gap wall 3 mm away (measured depth), outer skin only 12 mm up through the slot.
        source = quad(-10, 10, -10, 10, 12)
        labels = classify_inside_samples([[0, 0, 0]], [[0, 0, 1]], [3.], source)
        self.assertEqual(labels, ['bridges-gap'])

    def test_inward_facing_face_above_does_not_count(self):
        # A face above the sample that faces down is the underside of something, not outer skin.
        source = quad(-10, 10, -10, 10, 3, up=False)
        self.assertEqual(classify_inside_samples([[0, 0, 0]], [[0, 0, 1]], [3.], source),
                         ['bridges-gap'])

    def test_known_limit_tall_steep_bump_near_its_wall_is_under_counted(self):
        # Shell sample 1 mm from a 6 mm-tall bump's vertical wall: the nearest source point is
        # the wall (1 mm), but the outward ray meets the bump's top skin at 6 mm > 1 + 1.5.
        # Documented limit, not desired behaviour: the no-depth-check share bounds it.
        top = quad(0, 10, -10, 10, 6)
        self.assertEqual(classify_inside_samples([[-1, 0, 0]], [[0, 0, 1]], [1.], top),
                         ['bridges-gap'])
        top_under = quad(-10, 10, -10, 10, 6)
        self.assertEqual(classify_inside_samples([[-1, 0, 0]], [[0, 0, 1]], [1.], top_under,
                                                 depth_tolerance=15.), ['missing-material'])

    def test_rejects_mismatched_inputs(self):
        with self.assertRaises(ValueError):
            classify_inside_samples([[0, 0, 0]], [[0, 0, 1], [0, 0, 1]], [1.], quad(0, 1, 0, 1, 1))


if __name__ == '__main__':
    unittest.main()
