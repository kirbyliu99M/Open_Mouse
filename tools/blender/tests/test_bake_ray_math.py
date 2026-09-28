import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bake_ray_math import fallback_selection, merge_fallback


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
