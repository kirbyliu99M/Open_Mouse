import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bake_ray_math import fallback_selection, fill_from_neighbours, merge_fallback


class BakeRayMathTests(unittest.TestCase):
    def test_only_valid_misses_with_forward_source_normals_are_repaired(self):
        target = np.tile([0., 0., 1.], (5, 1))
        source = target.copy(); source[3] *= -1
        selected = fallback_selection([True, False, False, False, False],
                                      [True, True, False, True, True],
                                      source, target, [True, True, True, True, False])
        np.testing.assert_array_equal(selected, [False, True, False, False, False])

    def test_merge_preserves_every_unselected_value_exactly(self):
        first = np.arange(20, dtype=np.float32).reshape(5, 4)/7
        second = first+10
        selected = np.array([False, True, False, False, False])
        merged = merge_fallback(first, second, selected)
        np.testing.assert_array_equal(merged[~selected], first[~selected])
        np.testing.assert_array_equal(merged[selected], second[selected])
        self.assertFalse(np.shares_memory(first, merged))

    def test_fill_grows_from_known_texels_inside_region_only(self):
        values = np.zeros((5, 5, 3), np.float32)
        values[:, 0] = [1, 2, 3]
        known = np.zeros((5, 5), bool); known[:, 0] = True
        region = np.zeros((5, 5), bool); region[:, :3] = True
        filled, count, left = fill_from_neighbours(values, known, region)
        np.testing.assert_allclose(filled[:, :3], np.broadcast_to([1, 2, 3], (5, 3, 3)))
        np.testing.assert_array_equal(filled[:, 3:], 0)
        self.assertEqual((count, left), (10, 0))

    def test_fill_keeps_known_texels_and_reports_unreachable(self):
        values = np.arange(12, dtype=np.float32).reshape(2, 6, 1)
        known = np.zeros((2, 6), bool); known[0, 0] = True
        region = np.ones((2, 6), bool); region[:, 2] = False  # gap splits two islands
        filled, count, left = fill_from_neighbours(values, known, region)
        self.assertEqual(filled[0, 0, 0], 0)
        self.assertEqual((count, left), (3, 6))
        np.testing.assert_array_equal(filled[:, 3:], values[:, 3:])
