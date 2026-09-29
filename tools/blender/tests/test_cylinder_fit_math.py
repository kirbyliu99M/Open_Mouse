import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cylinder_fit_math import axis_extent, fit_cylinder


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


if __name__ == '__main__':
    unittest.main()
