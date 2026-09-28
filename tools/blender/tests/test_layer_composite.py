import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from layer_composite import composite_cover, linear_to_srgb, srgb_to_linear


class LayerCompositeTests(unittest.TestCase):
    def test_srgb_round_trip(self):
        values = np.linspace(0, 1, 257)
        np.testing.assert_allclose(linear_to_srgb(srgb_to_linear(values)), values, atol=1e-12)

    def test_opaque_texels_keep_cover_exactly(self):
        cover = np.array([[.3, .4, .5], [.9, .1, .2]])
        body = np.array([[0, 0, 0], [1, 1, 1]])
        np.testing.assert_array_equal(composite_cover(cover, body, np.array([1, 1])), cover)

    def test_transparent_texels_show_body(self):
        body = np.array([[.2, .3, .4]])
        np.testing.assert_allclose(composite_cover([[.9, .9, .9]], body, [0]), body, atol=1e-12)

    def test_mixing_is_linear_light(self):
        # MX Master 4 layer samples (linear): cover 0.11697, body 0.02624, alpha 0.4.
        cover_lin, body_lin, alpha = .1169704795, .0262412727, .4
        result = composite_cover(linear_to_srgb([[cover_lin] * 3]),
                                 linear_to_srgb([[body_lin] * 3]), [alpha])
        expected = alpha * cover_lin + (1 - alpha) * body_lin
        np.testing.assert_allclose(srgb_to_linear(result), expected, atol=1e-12)
        # Mixing encoded values instead would be visibly darker.
        naive = alpha * linear_to_srgb(cover_lin) + (1 - alpha) * linear_to_srgb(body_lin)
        self.assertGreater(float(result[0, 0]) - naive, .02)

    def test_alpha_is_clamped(self):
        cover, body = [[.8, .8, .8]], [[.2, .2, .2]]
        np.testing.assert_array_equal(composite_cover(cover, body, [1.5]), cover)
        np.testing.assert_allclose(composite_cover(cover, body, [-.5]), body, atol=1e-12)


if __name__ == '__main__':
    unittest.main()
