import math
import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from stability import centre_of_mass, convex_hull, support_margin
from reconstruct_gallery import level_base


def box(w, l, h, tilt=0.0):
    """Closed outward box on the desk; `tilt` lifts the rear (-Y) base edge."""
    v = [(x * w / 2, y * l / 2, z * h) for z in (0, 1) for y in (-1, 1) for x in (-1, 1)]
    v = [(x, y, z + (tilt if z == 0 and y < 0 else 0)) for x, y, z in v]
    f = [(0, 2, 3), (0, 3, 1), (4, 5, 7), (4, 7, 6), (0, 1, 5), (0, 5, 4),
         (2, 6, 7), (2, 7, 3), (0, 4, 6), (0, 6, 2), (1, 3, 7), (1, 7, 5)]
    return v, f


class StabilityTests(unittest.TestCase):
    def test_centre_of_box(self):
        v, f = box(.06, .12, .04)
        np.testing.assert_allclose(centre_of_mass(v, f), [0, 0, .02], atol=1e-12)

    def test_flat_base_margin_is_half_width(self):
        v, f = box(.06, .12, .04)
        self.assertAlmostEqual(support_margin(v, f), .03)

    def test_rear_lifted_base_tips(self):
        # Only the nose edge touches the desk: a line, not a footprint.
        v, f = box(.06, .12, .04, tilt=.007)
        self.assertEqual(support_margin(v, f), float("-inf"))

    def test_inverted_winding_rejected(self):
        v, f = box(.06, .12, .04)
        with self.assertRaises(ValueError):
            centre_of_mass(v, [(a, c, b) for a, b, c in f])

    def test_hull_drops_interior_points(self):
        hull = convex_hull([(0, 0), (1, 0), (1, 1), (0, 1), (.5, .5)])
        self.assertEqual(len(hull), 4)
        self.assertNotIn((.5, .5), hull)


class LevelBaseTests(unittest.TestCase):
    def test_tilted_base_is_levelled_and_height_kept(self):
        u = np.linspace(0, 1, 201)
        dome = 100 - 60 * np.sin(u * math.pi)      # image rows: small = high
        tilt = 400 + 30 * (u - .5)                  # underside rises toward u=0
        upper, lower, slope = level_base(u, dome + 30 * (u - .5), tilt)
        self.assertAlmostEqual(slope, 30)
        np.testing.assert_allclose(lower, 400, atol=1e-9)
        np.testing.assert_allclose(lower - upper, tilt - dome - 30 * (u - .5), atol=1e-9)

    def test_level_base_is_unchanged(self):
        u = np.linspace(0, 1, 101)
        upper, lower, slope = level_base(u, 100 + 0 * u, 400 + 0 * u)
        self.assertAlmostEqual(slope, 0)
        np.testing.assert_allclose(lower, 400)


if __name__ == "__main__":
    unittest.main()
