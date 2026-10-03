import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_calibration import source_calibration


class SourceCalibrationTests(unittest.TestCase):
    def test_identity_axes(self):
        result = source_calibration([.06, .12, .04], [0, 1, 2], [.063, .12, .038])
        self.assertEqual(result['uncalibratedDimensionsXYZmm'], [60, 120, 40])
        for actual, expected in zip(result['dimensionCalibrationScale'], [1.05, 1, .95]):
            self.assertAlmostEqual(actual, expected)
        self.assertIsNone(result['cableTrim'])

    def test_non_self_inverse_axis_permutation_and_trim(self):
        original = [.04, .06, .12]
        permutation = [1, 2, 0]
        trim = {'axis': 2, 'limit': .12}
        result = source_calibration(original, permutation, [.063, .108, .044], trim)
        self.assertEqual(result['uncalibratedDimensionsXYZmm'], [60, 120, 40])
        for actual, expected in zip(result['dimensionCalibrationScale'], [1.05, .9, 1.1]):
            self.assertAlmostEqual(actual, expected)
        self.assertEqual(result['cableTrim'], trim)
        self.assertEqual(original, [.04, .06, .12])
        self.assertEqual(permutation, [1, 2, 0])
