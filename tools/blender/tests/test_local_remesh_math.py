import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_remesh_math import (blend_positions, blend_weight, clamp_displacement,
                                ring_distances, smoothstep, target_mask)


class LocalRemeshMathTests(unittest.TestCase):
    def test_target_mask_threshold(self):
        signed = [-0.4, -1.5, 0.0, -1.0001, 2.5, -1.0]
        mask = target_mask(signed, 1.0)
        self.assertEqual(list(mask), [False, True, False, True, False, False])

    def test_ring_distances_bfs(self):
        adjacency = [[1], [0, 2], [1, 3], [2]]
        dist = ring_distances(adjacency, [True, False, False, False])
        self.assertEqual(list(dist), [0, 1, 2, 3])

    def test_ring_distances_unreached(self):
        adjacency = [[1], [0], [3], [2]]
        dist = ring_distances(adjacency, [True, False, False, False])
        self.assertEqual(list(dist), [0, 1, -1, -1])

    def test_smoothstep_bounds(self):
        self.assertEqual(smoothstep(-1), 0)
        self.assertEqual(smoothstep(2), 1)
        self.assertTrue(0 < smoothstep(0.5) < 1)

    def test_blend_weight_zones(self):
        ring = np.array([0, 1, 2, 3, 4, -1])
        w = blend_weight(ring, inner_ring=1, outer_ring=3)
        self.assertEqual(w[0], 1.0)
        self.assertEqual(w[1], 1.0)
        self.assertEqual(w[3], 0.0)
        self.assertEqual(w[4], 0.0)
        self.assertEqual(w[5], 0.0)
        self.assertTrue(0 < w[2] < 1)

    def test_blend_weight_monotonic_falloff(self):
        ring = np.arange(0, 6)
        w = blend_weight(ring, inner_ring=1, outer_ring=4)
        self.assertTrue(all(w[i] >= w[i + 1] for i in range(len(w) - 1)))

    def test_blend_positions_endpoints(self):
        original = np.array([[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]])
        projected = np.array([[1.0, 0.0, 0.0], [2.0, 1.0, 1.0]])
        out0 = blend_positions(original, projected, [0.0, 0.0])
        out1 = blend_positions(original, projected, [1.0, 1.0])
        self.assertTrue(np.allclose(out0, original))
        self.assertTrue(np.allclose(out1, projected))

    def test_blend_positions_half(self):
        original = np.array([[0.0, 0.0, 0.0]])
        projected = np.array([[2.0, 0.0, 0.0]])
        out = blend_positions(original, projected, [0.5])
        self.assertTrue(np.allclose(out, [[1.0, 0.0, 0.0]]))

    def test_clamp_displacement_no_op_within_limit(self):
        original = np.array([[0.0, 0.0, 0.0]])
        proposed = np.array([[0.001, 0.0, 0.0]])
        out = clamp_displacement(original, proposed, max_mm=2.0)
        self.assertTrue(np.allclose(out, proposed))

    def test_clamp_displacement_limits_large_move(self):
        original = np.array([[0.0, 0.0, 0.0]])
        proposed = np.array([[0.010, 0.0, 0.0]])
        out = clamp_displacement(original, proposed, max_mm=2.0)
        self.assertAlmostEqual(np.linalg.norm(out[0] - original[0]), 0.002)

    def test_clamp_displacement_direction_preserved(self):
        original = np.array([[0.0, 0.0, 0.0]])
        proposed = np.array([[3.0, 4.0, 0.0]])
        out = clamp_displacement(original, proposed, max_mm=5000.0)
        self.assertTrue(np.allclose(out, proposed))


if __name__ == '__main__':
    unittest.main()
