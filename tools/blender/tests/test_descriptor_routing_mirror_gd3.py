"""Non-flat routing and asymmetric wall diagnostics for the frozen GD code."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from descriptor_geometry import measure_shell
from descriptor_geometry_gd2 import measure_shell_gd2
from measure_descriptors import build_predictions
from measure_descriptors_gd2 import build_predictions_gd2
from test_descriptor_geometry import synthetic_shell
from test_descriptor_geometry_gd2 import shell


def routing_inputs(vertices):
    entry = {"slug": "source", "model": "Source", "path": "source.glb",
             "dimensionsXYZmm": np.ptp(vertices, axis=0).tolist()}
    manifest = {"shells": [dict(entry, slug="alias", model="Alias", aliasOf="source"), entry],
                "studies": [dict(entry, slug="study", model="Study", path="study.glb")],
                "noShell": []}
    catalogue = {s: {"model": s.title()} for s in ("source", "alias", "study")}
    return manifest, catalogue


class DistinctRoutingTests(unittest.TestCase):
    def test_gd1_routes_distinct_hump_flare_and_curvature(self):
        # Inward bow does not expand projected width. Thus H=.65, F=.10,
        # C=-.04 independently: every pairwise argument swap changes a level.
        v, f = synthetic_shell(
            width=lambda t: 66. if t <= 1/3 else 60.,
            height=lambda t: 40 - 20 * abs(t - .65), bow=-.04)
        manifest, catalogue = routing_inputs(v)
        rows = build_predictions(manifest, catalogue, lambda e: (v, f))
        for row in rows:
            with self.subTest(slug=row["slug"]):
                for key, value in (("humpPeakFraction", .65), ("frontFlareRatio", .1),
                                   ("sideCurvatureFraction", -.04)):
                    self.assertAlmostEqual(row["measures"][key], value)
                self.assertEqual({k: row[k] for k in ("humpPlacement", "frontFlare", "sideCurvature")},
                                 {"humpPlacement": "back_moderate", "frontFlare": "outward_moderate",
                                  "sideCurvature": "inward"})

    def test_gd2_routes_distinct_flare_and_curvature(self):
        # Concave walls retain 60/66 mm band widths at the straight upper band.
        v, f = shell(width=lambda t: 66. if t <= 1/3 else 60., bows=(-.06, -.06))
        manifest, catalogue = routing_inputs(v)
        run1 = build_predictions(manifest, catalogue, lambda e: (v, f))
        for row in run1:
            row["humpPlacement"] = "back_aggressive"
            row["measures"].update(humpPeakFraction=.81, peakSpanFromFront=[.81, .81],
                                   peakLateralFraction=.37)
        rows = build_predictions_gd2(run1, manifest, lambda e: (v, f))
        for row in rows:
            with self.subTest(slug=row["slug"]):
                self.assertAlmostEqual(row["measures"]["frontFlareRatio"], .1)
                self.assertAlmostEqual(row["measures"]["sideCurvatureFraction"], -.06)
                self.assertEqual(row["frontFlare"], "outward_moderate")
                self.assertEqual(row["sideCurvature"], "inward")
                self.assertEqual(row["humpPlacement"], "back_aggressive")
                self.assertEqual(row["measures"]["humpPeakFraction"], .81)


class AsymmetricMirrorTests(unittest.TestCase):
    def test_gd1_both_wall_bows_and_slopes_exchange_under_mirror(self):
        v, f = synthetic_shell()
        # Distinct bow AND taper on each wall, specified in outward coordinates.
        for side, bow, slope in ((-1, -.04, .10), (1, .07, -.20)):
            selected = np.sign(v[:, 0]) == side
            z = v[selected, 2] / 40
            v[selected, 0] += side * (40 * bow * (z == .5) + slope * 40 * (z - .5))
        for mirror in (False, True):
            with self.subTest(mirror=mirror):
                measured = measure_shell(v * ([-1, 1, 1] if mirror else [1, 1, 1]), f)
                expected = ((2.8, -1.6, .20, .10) if mirror else (-1.6, 2.8, -.10, -.20))
                for section in measured["gripSections"]:
                    for key, value in zip(("leftBowMm", "rightBowMm", "leftWallSlope", "rightWallSlope"), expected):
                        self.assertAlmostEqual(section[key], value)
                self.assertAlmostEqual(measured["sideCurvatureFraction"], .015)

    def test_gd2_both_wall_fits_exchange_under_mirror(self):
        v, f = shell(bows=(-.06, .09))
        for side, slope in ((-1, .12), (1, -.23)):
            selected = np.sign(v[:, 0]) == side
            v[selected, 0] += side * slope * (v[selected, 2] - 16)
        for mirror in (False, True):
            with self.subTest(mirror=mirror):
                measured = measure_shell_gd2(v * ([-1, 1, 1] if mirror else [1, 1, 1]), f)
                expected = ((.09, -.23), (-.06, .12)) if mirror else ((-.06, .12), (.09, -.23))
                for name, (bow, slope) in zip(("left", "right"), expected):
                    self.assertAlmostEqual(measured[name + "WallBowFraction"], bow)
                    for section in measured["gripSections"]:
                        wall = section[name + "Wall"]
                        self.assertAlmostEqual(wall["bowFraction"], bow)
                        self.assertAlmostEqual(wall["slope"], slope)
                        self.assertAlmostEqual(wall["fitRmsFraction"], 0)
                self.assertTrue(measured["opposingWallConflict"])
                self.assertEqual(measured["sideCurvatureFraction"], 0)


if __name__ == "__main__":
    unittest.main()
