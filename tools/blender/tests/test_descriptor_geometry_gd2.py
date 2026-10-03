"""Analytic GD-2 shells; no delivered assets or validation fixture required."""
import copy
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from descriptor_geometry import measure_shell
from descriptor_geometry_gd2 import (band_width, combine_walls, map_levels_gd2,
                                     measure_shell_gd2, wall_bow)
from measure_descriptors import build_predictions
from measure_descriptors_gd2 import HUMP_MEASURES, build_predictions_gd2


def shell(width=lambda t: 60., bows=(0., 0.), slope=0., rounding=False, shelf=False):
    """Closed ruled mesh, 40 mm high; prescribed sagitta on the 12 mm wall band."""
    ts = sorted(set([0., .1, .2, 1/3, .8, 1.] + list(np.linspace(.4, .6, 21))))
    zs = sorted(set([0., .1, .2, .6, .7, .8, 1.] + list(np.linspace(.25, .55, 13))))
    ring = [(1, z) for z in zs] + [(-1, z) for z in reversed(zs)]
    vertices, faces = [], []
    for t in ts:
        for side, z in ring:
            q = np.clip((z-.25)/.3, 0, 1)
            radius = width(t)/2 + bows[0 if side == -1 else 1] * 12 * 4*q*(1-q)
            radius += slope * 40 * (z-.4)
            if rounding:
                radius -= 20 * max(z-.6, 0) + 10 * max(.2-z, 0)
            if shelf:
                radius += 20 * max(1-z/.2, 0) * (1 if .4 <= t <= .6 else 0)
            vertices.append([side*radius, 120*(1-t), 40*z])
    n = len(ring)
    for i in range(len(ts)-1):
        for j in range(n):
            a, b = i*n+j, i*n+(j+1)%n
            faces.extend([[a, b, b+n], [a, b+n, a+n]])
    for i in (0, len(ts)-1):
        center = len(vertices)
        vertices.append([0, 120*(1-ts[i]), 20])
        faces.extend([[center, i*n+j, i*n+(j+1)%n] for j in range(n)])
    return np.array(vertices), np.array(faces)


class GD2GeometryTests(unittest.TestCase):
    def test_quadratic_sagitta_sign_scale_and_taper(self):
        z = np.linspace(10, 22, 13)
        q = (z-10)/12
        for bow in (-.15, -.06, 0, .06, .15):
            for slope in (-.4, 0, .4):
                result = wall_bow(z, 30 + slope*z + 4*bow*12*q*(1-q))
                self.assertAlmostEqual(result["bowFraction"], bow)
                self.assertAlmostEqual(result["slope"], slope)
                self.assertAlmostEqual(result["fitRmsFraction"], 0)

    def test_mesh_known_concavity_convexity_and_linear_taper(self):
        for bow in (-.15, -.06, 0, .06, .15):
            m = measure_shell_gd2(*shell(bows=(bow, bow), slope=.12))
            self.assertAlmostEqual(m["sideCurvatureFraction"], bow)
            self.assertAlmostEqual(m["leftWallBowFraction"], bow)
            self.assertAlmostEqual(m["rightWallBowFraction"], bow)

    def test_deck_rounding_and_base_chamfer_are_not_wall_bow(self):
        v, f = shell(rounding=True)
        self.assertGreater(measure_shell(v, f)["sideCurvatureFraction"], .01)
        self.assertAlmostEqual(measure_shell_gd2(v, f)["sideCurvatureFraction"], 0)

    def test_shelf_does_not_change_body_flare_or_bow(self):
        base = measure_shell_gd2(*shell())
        altered = measure_shell_gd2(*shell(shelf=True))
        for key in ("frontFlareRatio", "sideCurvatureFraction", "frontWidthMm", "gripWidthMm"):
            self.assertAlmostEqual(base[key], altered[key])
        self.assertLess(measure_shell(*shell(shelf=True))["frontFlareRatio"], -.15)

    def test_front_band_known_ratios_and_cap_exclusion(self):
        for ratio in (-.2, -.1, -.05, 0, .05, .1, .2):
            def width(t):
                if t < .2:
                    return 60*(1+ratio) * (.5 + .5*t/.2)
                return 60*(1+ratio*max(0, min(1, (.4-t)/(.4-1/3))))
            m = measure_shell_gd2(*shell(width=width))
            self.assertAlmostEqual(m["frontFlareRatio"], ratio)
            self.assertAlmostEqual(m["gripWidthMm"], 60)

    def test_front_band_detects_narrowing_missed_by_one_third(self):
        v, f = shell(width=lambda t: 60*(1-.1*max(0, min(1, (1/3-t)/(1/3-.2)))))
        self.assertAlmostEqual(measure_shell(v, f)["frontFlareRatio"], 0)
        self.assertAlmostEqual(measure_shell_gd2(v, f)["frontFlareRatio"], -.05)

    def test_single_station_notch_does_not_define_waist(self):
        v, f = shell(width=lambda t: 50 if abs(t-.5) < 1e-8 else 60)
        m = measure_shell_gd2(v, f)
        self.assertAlmostEqual(m["gripWidthMm"], 60)
        self.assertGreater(measure_shell(v, f)["frontFlareRatio"], .15)

    def test_longitudinal_taper_is_not_transverse_curvature(self):
        m = measure_shell_gd2(*shell(width=lambda t: 50+20*t))
        self.assertAlmostEqual(m["sideCurvatureFraction"], 0)
        self.assertLess(m["frontFlareRatio"], 0)

    def test_one_wall_is_not_diluted_and_opposition_is_flagged(self):
        m = measure_shell_gd2(*shell(bows=(-.06, 0)))
        self.assertAlmostEqual(m["sideCurvatureFraction"], -.06)
        self.assertFalse(m["opposingWallConflict"])
        m = measure_shell_gd2(*shell(bows=(-.06, .1)))
        self.assertEqual(m["sideCurvatureFraction"], 0)
        self.assertTrue(m["opposingWallConflict"])
        self.assertEqual(combine_walls(.02, -.06), (-.06, False))

    def test_band_clips_edges_and_preserves_interior_extrema(self):
        segments = np.array([[[-10, 0, 0], [-30, 0, 40]],
                             [[10, 0, 0], [40, 0, 17]], [[40, 0, 17], [10, 0, 40]]])
        self.assertAlmostEqual(band_width(segments, 10, 30), 65)
        with self.assertRaises(ValueError):
            band_width(segments, 50, 60)

    def test_scale_translation_mirror_order_and_subdivision(self):
        v, f = shell(bows=(-.06, 0), width=lambda t: 50+20*t)
        original = v.copy()
        expected = measure_shell_gd2(v, f)
        for scale in (.01, 10):
            actual = measure_shell_gd2(v*scale*[-1, 1, 1] + [14, -53, 19], f[::-1, ::-1])
            for key in ("frontFlareRatio", "sideCurvatureFraction"):
                self.assertAlmostEqual(actual[key], expected[key])
            self.assertAlmostEqual(actual["rightWallBowFraction"], expected["leftWallBowFraction"])
        centers = v[f].mean(axis=1)
        refined_f = [[a, b, len(v)+i] for i, face in enumerate(f)
                     for a, b in zip(face, np.roll(face, -1))]
        actual = measure_shell_gd2(np.concatenate([v, centers]), refined_f)
        for key in ("frontFlareRatio", "sideCurvatureFraction"):
            self.assertAlmostEqual(actual[key], expected[key])
        np.testing.assert_array_equal(v, original)

    def test_mapping_every_boundary(self):
        for sign, direction in ((-1, "inward"), (1, "outward")):
            for x, degree in ((.025, "flat"), (.025001, "slight"), (.075, "slight"),
                              (.075001, "moderate"), (.15, "moderate"), (.150001, "aggressive")):
                expected = "flat" if degree == "flat" else direction+"_"+degree
                self.assertEqual(map_levels_gd2(sign*x, 0)["frontFlare"], expected)
            for x, suffix in ((.025, "flat"), (.025001, ""), (.10, ""), (.100001, "_aggressive")):
                expected = "flat" if suffix == "flat" else direction+suffix
                self.assertEqual(map_levels_gd2(0, sign*x)["sideCurvature"], expected)
        self.assertNotIn("humpPlacement", map_levels_gd2(0, 0))

    def test_invalid_inputs_fail(self):
        for args in (([0, 1], [1, 2]), ([0, 0, 1], [1, 2, 3]),
                     ([0, 1, 2], [1, np.nan, 3])):
            with self.assertRaises(ValueError):
                wall_bow(*args)
        with self.assertRaises(ValueError):
            combine_walls(np.inf, 0)
        with self.assertRaises(ValueError):
            map_levels_gd2(0, np.nan)
        with self.assertRaises(ValueError):
            band_width(np.zeros((1, 2, 3)), 1, 0)
        v, f = shell()
        with self.assertRaises(ValueError):
            measure_shell_gd2(v*np.nan, f)


class GD2RoutingTests(unittest.TestCase):
    def setUp(self):
        entry = {"slug": "source", "model": "Source", "path": "source.glb",
                 "dimensionsXYZmm": [60, 120, 40]}
        self.manifest = {"shells": [dict(entry, slug="alias", model="Alias", aliasOf="source"), entry],
                         "studies": [dict(entry, slug="study", model="Study", path="study.glb")],
                         "noShell": [{"slug": "missing", "reason": "No shell"}]}
        catalogue = {s: {"model": s.title()} for s in ("source", "alias", "study", "missing")}
        self.run1 = build_predictions(self.manifest, catalogue, lambda e: shell())
        # Sentinel deliberately differs from this mesh: proves copying, not recalculation.
        for row in self.run1:
            if row["measures"]:
                row["humpPlacement"] = "back_aggressive"
                row["measures"]["humpPeakFraction"] = .8123456789

    def test_exact_hump_copy_alias_null_study_and_no_input_mutation(self):
        before = copy.deepcopy(self.run1)
        calls = []
        def loader(e):
            calls.append(e["slug"])
            return shell()
        rows = build_predictions_gd2(self.run1, self.manifest, loader)
        self.assertEqual(calls, ["source", "study"])
        for old, new in zip(before, rows):
            self.assertEqual(old["humpPlacement"], new["humpPlacement"])
            if old["measures"]:
                for key in HUMP_MEASURES:
                    self.assertEqual(old["measures"][key], new["measures"][key])
        self.assertEqual(rows[0]["measures"], rows[1]["measures"])
        self.assertEqual(rows[2]["confidence"], "lower")
        self.assertEqual(rows[3], before[3])
        self.assertEqual(self.run1, before)

    def test_invalid_coverage_identity_alias_cycle_dimensions_and_nulls(self):
        for case in ("coverage", "identity", "alias", "cycle", "dimensions", "nulls"):
            manifest, rows = copy.deepcopy(self.manifest), copy.deepcopy(self.run1)
            if case == "coverage":
                rows.pop()
            elif case == "identity":
                rows[1]["path"] = "other.glb"
            elif case == "alias":
                manifest["shells"][0]["aliasOf"] = "missing"
            elif case == "cycle":
                manifest["shells"][1]["aliasOf"] = "alias"
            elif case == "dimensions":
                manifest["shells"][1]["dimensionsXYZmm"] = [60, 119, 40]
            else:
                rows[3]["humpPlacement"] = "center"
            with self.assertRaises(ValueError, msg=case):
                build_predictions_gd2(rows, manifest, lambda e: shell())


if __name__ == "__main__":
    unittest.main()
