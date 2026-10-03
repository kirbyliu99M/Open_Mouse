from pathlib import Path
import sys
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from photo_bake_math import (boundary_gap, triangle_pixels, perspective_weights,
    blend_weights, sh_design, fit_shading, shading_scale, normal_from_height, region_ids)


class PhotoBakeMathTests(unittest.TestCase):
    def test_boundary_gap_scale_and_symmetry(self):
        a = np.zeros((20, 20), bool);a[3:9, 3:9] = True
        b = np.roll(a, 3, axis=1)
        self.assertEqual(boundary_gap(a, b, .5), 1.5)
        self.assertEqual(boundary_gap(a, a, .5), 0)
        self.assertEqual(boundary_gap(b, a, .5), 1.5)
        with self.assertRaises(ValueError):boundary_gap(a, np.zeros_like(a), 1)

    def test_barycentrics_and_degenerate_triangle(self):
        p = np.array([[0, 0], [4, 0], [0, 4]])
        x, y, b = triangle_pixels(p, (5, 5))
        np.testing.assert_allclose(b@p, np.column_stack((x, y)))
        np.testing.assert_allclose(b.sum(1), 1)
        self.assertEqual(len(x), 15)
        self.assertEqual(len(triangle_pixels([[0, 0]]*3, (5, 5))[0]), 0)

    def test_depth_interpolation_is_perspective_correct(self):
        weights, depth = perspective_weights([[.5, .5, 0]], [1, 2, 3])
        np.testing.assert_allclose(weights, [[2/3, 1/3, 0]])
        np.testing.assert_allclose(depth, [4/3])

    def test_blend_visibility_angle_and_feather(self):
        weights = blend_weights(np.array([1, .5, -1, 1, 1, 1]),
            np.array([12, 12, 12, 12, 0, 6]), np.array([0, 0, 0, 1, 0, 0]), np.zeros(6))
        np.testing.assert_allclose(weights, [1, 1/16, 0, 0, 0, .5])
        self.assertLess(blend_weights(1, 12, 0, 2), .1)

    def test_shading_recovers_known_field_and_rejects_outliers(self):
        rng = np.random.default_rng(42)
        n = rng.normal(size=(1500, 3));n /= np.linalg.norm(n, axis=1)[:, None]
        coefficients = np.array([-2, .25, -.15, .35, .05, 0, 0, 0, .04])
        luminance = np.exp(sh_design(n)@coefficients);luminance[:30] *= 5
        fit, anchor, keep = fit_shading(n, luminance, regularization=1e-5)
        corrected = luminance/shading_scale(n, fit, anchor)
        self.assertLess(np.std(corrected[30:])/np.mean(corrected[30:]), .005)
        self.assertLess(keep[:30].sum(), 3)
        with self.assertRaises(ValueError):fit_shading(n[:5], luminance[:5])

    def test_flat_and_ramp_normal_orientation(self):
        mask = np.ones((6, 6), bool);mask[0, 0] = False
        flat = normal_from_height(np.zeros((6, 6)), mask)
        np.testing.assert_allclose(flat, np.broadcast_to([.5, .5, 1], flat.shape))
        ramp = normal_from_height(np.tile(np.arange(6), (6, 1)), mask)
        self.assertLess(ramp[3, 3, 0], .5)
        np.testing.assert_allclose(np.linalg.norm(ramp*2-1, axis=-1), 1)
        down = normal_from_height(np.tile(np.arange(6)[:, None], (1, 6)), mask)
        self.assertGreater(down[3, 3, 1], .5)

    def test_regions_follow_physical_footprints(self):
        p = [[0, -10, 38], [10, 15, 32], [0, 33, 30], [0, -28, 35], [27, -20, 15], [0, 0, 0]]
        n = [[0, 0, 1]]*4+[[1, 0, 0], [0, 0, -1]]
        np.testing.assert_array_equal(region_ids(p, n, np.ones(6)), [1, 2, 3, 4, 5, 6])
