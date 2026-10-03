"""Invalid plane/section inputs must fail at the frozen GD-1 public guards."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from descriptor_geometry import (measure_shell, plane_segments, section_wall_bounds,
                                 validate_mesh_arrays)
from test_descriptor_geometry import synthetic_shell


class SectionGuardTests(unittest.TestCase):
    def test_plane_rejects_invalid_shape(self):
        for triangles in (np.zeros((3, 3)), np.zeros((2, 2, 3)), np.zeros((2, 3, 2))):
            with self.subTest(shape=triangles.shape), self.assertRaisesRegex(ValueError, "Expected finite triangles"):
                plane_segments(triangles, 1, 0)

    def test_plane_rejects_nonfinite_triangles_axis_and_coordinate(self):
        triangles = np.array([[[-1., -1., 0.], [1., 1., 0.], [0., 0., 1.]]])
        for value in (np.nan, np.inf, -np.inf):
            bad = triangles.copy()
            bad[0, 0, 0] = value
            with self.subTest(vertex=value), self.assertRaisesRegex(ValueError, "Expected finite triangles"):
                plane_segments(bad, 1, 0)
            with self.subTest(coordinate=value), self.assertRaisesRegex(ValueError, "Expected finite triangles"):
                plane_segments(triangles, 1, value)
        for axis in (-1, 3):
            with self.subTest(axis=axis), self.assertRaisesRegex(ValueError, "Expected finite triangles"):
                plane_segments(triangles, axis, 0)

    def test_plane_rejects_missing_intersection(self):
        triangles = np.array([[[-1., -1., 0.], [1., 1., 0.], [0., 0., 1.]]])
        with self.assertRaisesRegex(ValueError, "Plane does not intersect shell"):
            plane_segments(triangles, 1, 10)

    def test_wall_bounds_reject_invalid_shape(self):
        for segments in (np.zeros((2, 3)), np.zeros((1, 3, 3)), np.zeros((1, 2, 2))):
            with self.subTest(shape=segments.shape), self.assertRaisesRegex(ValueError, "Expected finite section"):
                section_wall_bounds(segments, 0)

    def test_wall_bounds_reject_nonfinite_segments_and_height(self):
        segments = np.array([[[-1., 0., 0.], [-1., 0., 1.]],
                             [[1., 0., 0.], [1., 0., 1.]]])
        for value in (np.nan, np.inf, -np.inf):
            bad = segments.copy()
            bad[0, 0, 0] = value
            with self.subTest(vertex=value), self.assertRaisesRegex(ValueError, "Expected finite section"):
                section_wall_bounds(bad, .5)
            with self.subTest(height=value), self.assertRaisesRegex(ValueError, "Expected finite section"):
                section_wall_bounds(segments, value)

    def test_wall_bounds_require_two_distinct_exterior_walls(self):
        for segments in (np.empty((0, 2, 3)),
                         np.array([[[1., 0., 0.], [1., 0., 1.]]]),
                         np.array([[[1., 0., .5], [1., 0., 1.]],
                                   [[1., 0., 0.], [1., 0., .5]]])):
            with self.subTest(segments=segments.tolist()), self.assertRaisesRegex(ValueError, "Missing two exterior walls"):
                section_wall_bounds(segments, .5)


class MeshGuardTests(unittest.TestCase):
    def test_mesh_rejects_too_few_or_wrong_rank_vertices(self):
        v, f = synthetic_shell()
        for bad in (v[:3], v[0], v[None, :, :]):
            with self.subTest(shape=bad.shape), self.assertRaisesRegex(ValueError, "Expected at least four"):
                validate_mesh_arrays(bad, f)

    def test_mesh_rejects_empty_malformed_or_negative_faces(self):
        v, f = synthetic_shell()
        for bad in (np.empty((0, 3), dtype=int), f[0], f[:, :2], f - 1):
            with self.subTest(shape=bad.shape), self.assertRaisesRegex(ValueError, "Expected valid integer"):
                validate_mesh_arrays(v, bad)

    def test_mesh_rejects_zero_height_grip_section(self):
        v, f = synthetic_shell(height=lambda t: 0. if t == .4 else 40.)
        with self.assertRaisesRegex(ValueError, "Zero-height grip section"):
            measure_shell(v, f)


if __name__ == "__main__":
    unittest.main()
