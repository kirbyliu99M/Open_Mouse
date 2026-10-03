import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cylinder_fit_math import axis_extent, fit_cylinder, fit_cylinder_fixed_axis, robust_fit_cylinder


def synthetic_cylinder(axis, center, radius, width, n=400, noise=0.0, seed=0):
    rng = np.random.default_rng(seed)
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    seed_vec = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(axis, seed_vec); u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    theta = rng.uniform(0, 2 * np.pi, n)
    t = rng.uniform(-width / 2, width / 2, n)
    points = (center + radius * (np.cos(theta)[:, None] * u + np.sin(theta)[:, None] * v)
              + t[:, None] * axis)
    if noise:
        points = points + rng.normal(0, noise, points.shape)
    return points


class CylinderFitMathTests(unittest.TestCase):
    def test_recovers_axis_aligned_cylinder(self):
        points = synthetic_cylinder(axis=(0, 1, 0), center=(5, 0, 10), radius=8.0, width=6.0)
        fit = fit_cylinder(points)
        alignment = abs(np.dot(fit['axis'], (0, 1, 0)))
        self.assertGreater(alignment, 0.999)
        self.assertAlmostEqual(fit['radius'], 8.0, places=3)
        self.assertLess(fit['rms'], 1e-6)
        self.assertLess(fit['max_abs'], 1e-5)

    def test_recovers_tilted_offset_cylinder(self):
        axis = np.array([0.2, 0.9, 0.1])
        points = synthetic_cylinder(axis=axis, center=(12.0, -3.0, 4.0), radius=11.5, width=9.0)
        fit = fit_cylinder(points)
        alignment = abs(np.dot(fit['axis'], axis / np.linalg.norm(axis)))
        self.assertGreater(alignment, 0.999)
        self.assertAlmostEqual(fit['radius'], 11.5, places=2)
        # centre recovered up to a shift along the axis (unconstrained by radial distance)
        centre_err = np.asarray(fit['center']) - np.array([12.0, -3.0, 4.0])
        along = np.dot(centre_err, fit['axis'])
        perp = centre_err - along * fit['axis']
        self.assertLess(np.linalg.norm(perp), 1e-3)

    def test_noisy_cylinder_bounded_residual(self):
        points = synthetic_cylinder(axis=(0, 0, 1), center=(0, 0, 0), radius=10.0, width=8.0,
                                     n=500, noise=0.05, seed=1)
        fit = fit_cylinder(points)
        self.assertGreater(abs(np.dot(fit['axis'], (0, 0, 1))), 0.99)
        self.assertAlmostEqual(fit['radius'], 10.0, delta=0.05)
        self.assertLess(fit['rms'], 0.1)

    def test_axis_extent_matches_width(self):
        axis = np.array([0.0, 1.0, 0.0])
        points = synthetic_cylinder(axis=axis, center=(0, 0, 0), radius=5.0, width=7.0, n=1000)
        fit = fit_cylinder(points)
        midpoint, width = axis_extent(points, fit['axis'], fit['center'])
        self.assertAlmostEqual(width, 7.0, delta=0.05)
        self.assertLess(np.linalg.norm(np.asarray(midpoint) - np.array([0, 0, 0])), 0.05)

    def test_requires_minimum_points(self):
        with self.assertRaises(ValueError):
            fit_cylinder([[0, 0, 0], [1, 0, 0]])

    def test_robust_fit_rejects_outlier_contamination(self):
        clean = synthetic_cylinder(axis=(1, 0, 0), center=(0, 0, 0), radius=10.0, width=8.0,
                                    n=300, noise=0.02, seed=2)
        rng = np.random.default_rng(3)
        # A small minority of points well off the true cylinder surface: like stray
        # non-cylindrical vertices a proximity crop swept in alongside the real tread.
        outliers = clean[:40] + rng.normal(0, 4.0, (40, 3))
        contaminated = np.vstack([clean, outliers])
        plain = fit_cylinder(contaminated)
        robust, inliers = robust_fit_cylinder(contaminated, keep_fraction=0.85, iterations=6)
        # Trimming drives the residual down a lot further than the untrimmed fit manages,
        # and keeps most (but not all) of the candidate points.
        self.assertLess(robust['rms'], plain['rms'] / 2)
        self.assertLess(robust['rms'], 0.5)
        self.assertLess(len(inliers), len(contaminated))
        self.assertGreater(len(inliers), len(clean) * 0.3)


    def test_fixed_axis_fits_partial_arc(self):
        # Only a 60-degree arc of the tread (e.g. the exposed crown above a slot): a free
        # 5-DOF fit is poorly constrained by an arc this narrow, but a fixed-axis fit
        # (axis known from the wheel's lateral rotation axis) recovers the radius cleanly.
        rng = np.random.default_rng(4)
        axis = np.array([1.0, 0.0, 0.0])
        u, v = np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0])
        theta = rng.uniform(-np.pi / 6, np.pi / 6, 200)
        t = rng.uniform(-3, 3, 200)
        radius, center = 9.5, np.array([2.0, -1.0, 4.0])
        points = center + radius * (np.cos(theta)[:, None] * u + np.sin(theta)[:, None] * v) + t[:, None] * axis
        fit = fit_cylinder_fixed_axis(points, axis=axis)
        self.assertAlmostEqual(fit['radius'], 9.5, delta=0.05)
        self.assertLess(fit['rms'], 1e-6)

    def test_fixed_axis_matches_free_fit_on_full_cylinder(self):
        points = synthetic_cylinder(axis=(1, 0, 0), center=(0, 0, 0), radius=7.0, width=10.0, n=500)
        fixed = fit_cylinder_fixed_axis(points, axis=(1, 0, 0))
        self.assertAlmostEqual(fixed['radius'], 7.0, delta=1e-3)
        self.assertLess(fixed['rms'], 1e-6)


if __name__ == '__main__':
    unittest.main()
