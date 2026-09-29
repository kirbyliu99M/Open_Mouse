import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from height_field_math import (hat_basis, height_ratio_field, sample_grid,
                               top_height_map, z_scale_deform)


def box(width, length, height):
    """Closed axis-aligned box centred in X/Y, base on Z=0."""
    x, y = width/2, length/2
    v = np.array([[sx*x, sy*y, z] for z in (0, height) for sy in (-1, 1) for sx in (-1, 1)], float)
    f = np.array([[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4],
                  [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]])
    return v, f


class TopHeightMapTests(unittest.TestCase):
    def test_box_top_is_flat_and_outside_is_nan(self):
        v, f = box(20, 40, 10)
        xs, ys = np.linspace(-15, 15, 31), np.linspace(-25, 25, 51)
        h = top_height_map(v, f, xs, ys)
        inside = (abs(xs)[None] < 9.9) & (abs(ys)[:, None] < 19.9)
        np.testing.assert_allclose(h[inside], 10)
        self.assertTrue(np.isnan(h[(abs(xs)[None] > 10.1) | (abs(ys)[:, None] > 20.1)]).all())

    def test_sloped_roof_is_interpolated(self):
        v = np.array([[-10, -10, 0], [10, -10, 20], [10, 10, 20], [-10, 10, 0]], float)
        f = np.array([[0, 1, 2], [0, 2, 3]])
        xs = ys = np.linspace(-9, 9, 19)
        h = top_height_map(v, f, xs, ys)
        np.testing.assert_allclose(h, np.broadcast_to(xs+10, h.shape), atol=1e-9)

    def test_rejects_bad_grids(self):
        v, f = box(2, 2, 2)
        with self.assertRaises(ValueError):
            top_height_map(v, f, [0.], [0., 1.])
        with self.assertRaises(ValueError):
            top_height_map(v, f, [1., 0.], [0., 1.])


class RatioFieldTests(unittest.TestCase):
    def test_constant_ratio_is_kept_and_filled_everywhere(self):
        loft = np.full((20, 30), 10.)
        loft[:, :5] = np.nan
        hull = loft*1.1
        r = height_ratio_field(hull, loft, sigma_px=3)
        self.assertTrue(np.isfinite(r).all())
        np.testing.assert_allclose(r, 1.1, atol=1e-9)

    def test_thin_rim_carries_no_evidence_and_ratio_is_clamped(self):
        loft = np.full((10, 10), 10.)
        loft[0] = 1.  # rim thinner than the minimum height
        hull = loft*2.
        hull[0] = 50.  # wild ratio on the rim must not leak
        r = height_ratio_field(hull, loft, sigma_px=0, clamp=(.8, 1.25))
        np.testing.assert_allclose(r, 1.25)

    def test_needs_evidence(self):
        with self.assertRaises(ValueError):
            height_ratio_field(np.full((3, 3), np.nan), np.ones((3, 3)), 1)


class SamplingAndBasisTests(unittest.TestCase):
    def test_bilinear_sample_is_exact_on_a_plane(self):
        xs, ys = np.linspace(0, 10, 11), np.linspace(0, 5, 6)
        field = xs[None]*2+ys[:, None]
        pts = np.array([[2.5, 1.25], [9.9, 4.9], [0, 0]])
        np.testing.assert_allclose(sample_grid(field, xs, ys, pts), pts[:, 0]*2+pts[:, 1])

    def test_hat_basis_partition_of_unity(self):
        pts = np.random.default_rng(1).uniform(-30, 30, (200, 2))
        b = hat_basis(pts, (-30, -30), (30, 30), (4, 6))
        self.assertEqual(b.shape, (200, 24))
        np.testing.assert_allclose(b.sum(1), 1)
        self.assertTrue((b >= 0).all())


class ZScaleDeformTests(unittest.TestCase):
    def test_keeps_xy_and_ground_and_recalibrates_height(self):
        v, _ = box(20, 40, 10)
        v = np.vstack([v, [[0, 0, 5]]])
        s = np.array([1.]*8+[1.2])
        out = z_scale_deform(v, s, [20, 40, 10])
        np.testing.assert_allclose(out[:, :2], v[:, :2])
        np.testing.assert_allclose(out[v[:, 2] == 0, 2], 0)
        self.assertAlmostEqual(out[:, 2].max(), 10)
        self.assertAlmostEqual(out[-1, 2], 6)

    def test_identity_scale_is_identity_and_input_is_not_mutated(self):
        v, _ = box(20, 40, 10)
        before = v.copy()
        np.testing.assert_allclose(z_scale_deform(v, np.ones(len(v)), [20, 40, 10]), v, atol=1e-12)
        np.testing.assert_array_equal(v, before)

    def test_rejects_non_positive_scale(self):
        v, _ = box(2, 2, 2)
        with self.assertRaises(ValueError):
            z_scale_deform(v, np.zeros(len(v)), [2, 2, 2])


if __name__ == '__main__':
    unittest.main()
