"""Analytic GD-1 shells, independent of assets and private classification data."""
import copy
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from descriptor_geometry import (map_levels, measure_shell, plane_segments,
                                 section_wall_bounds, validate_mesh_arrays)
from measure_descriptors import build_predictions, frame_caution


def synthetic_shell(width=lambda t: 60., height=lambda t: 40., bow=0., slope=0.):
    """Closed ruled shell: bow*H at mid-wall, zero bow at 20/80% height."""
    ts = sorted(set([0., 1 / 3, .4, .5, .55, .6, .62, .65, .7, .75, 1.]))
    vertices, faces = [], []
    for t in ts:
        h, w = height(t), width(t)
        for side, z in [(-1, 0), (1, 0), (1, .2), (1, .5), (1, .8), (1, 1),
                        (-1, 1), (-1, .8), (-1, .5), (-1, .2)]:
            x = side * (w / 2 + (bow * h if z == .5 else 0) + slope * h * (z - .5))
            vertices.append([x, 120 * (1 - t), z * h])
    n = 10
    for i in range(len(ts) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            faces.extend([[a, b, b + n], [a, b + n, a + n]])
    for ring in (0, len(ts) - 1):
        center = len(vertices)
        vertices.append([0, 120 * (1 - ts[ring]), height(ts[ring]) / 2])
        faces.extend([[center, ring * n + j, ring * n + (j + 1) % n] for j in range(n)])
    return np.array(vertices), np.array(faces)


class GeometryDescriptorTests(unittest.TestCase):
    def test_known_peak_and_plateau(self):
        v, f = synthetic_shell(height=lambda t: 40 - 20 * abs(t - .65))
        self.assertAlmostEqual(measure_shell(v, f)["humpPeakFraction"], .65)
        v, f = synthetic_shell(height=lambda t: 40 - 20 * max(.6 - t, t - .7, 0))
        m = measure_shell(v, f)
        self.assertAlmostEqual(m["humpPeakFraction"], .65)
        np.testing.assert_allclose(m["peakSpanFromFront"], [.6, .7])
        self.assertEqual(measure_shell(*synthetic_shell())["humpPeakFraction"], .5)

    def test_known_flare_sign_and_ratio(self):
        for ratio in (-.2, -.1, -.05, 0, .05, .1, .2):
            with self.subTest(ratio=ratio):
                # Constant grip width; front third has specified ratio.
                v, f = synthetic_shell(width=lambda t: 60 * (1 + ratio * min(1, max(0, (.4 - t) / (.4 - 1/3)))))
                m = measure_shell(v, f)
                self.assertAlmostEqual(m["frontFlareRatio"], ratio)
                self.assertAlmostEqual(m["gripWidthMm"], 60)

    def test_known_curvature_and_taper(self):
        for bow in (-.1, -.04, 0, .04, .1):
            for slope in (0, .12):
                with self.subTest(bow=bow, slope=slope):
                    m = measure_shell(*synthetic_shell(bow=bow, slope=slope))
                    self.assertAlmostEqual(m["sideCurvatureFraction"], bow)
                    for s in m["gripSections"]:
                        self.assertAlmostEqual(s["leftBowMm"], bow * 40)
                        self.assertAlmostEqual(s["rightBowMm"], bow * 40)
                        self.assertAlmostEqual(s["rightWallSlope"], slope)

    def test_translation_scale_mirror_and_triangle_order(self):
        v, f = synthetic_shell(bow=-.04, height=lambda t: 40 - 20 * abs(t - .65))
        original = v.copy()
        expected = measure_shell(v, f)
        for scale in (.01, 10):
            modified = v * scale * np.array([-1, 1, 1]) + [14, -53, 19]
            actual = measure_shell(modified, f[::-1, ::-1])
            for key in ("humpPeakFraction", "frontFlareRatio", "sideCurvatureFraction"):
                self.assertAlmostEqual(actual[key], expected[key])
        np.testing.assert_array_equal(v, original)

    def test_triangle_subdivision_does_not_reweight_sections(self):
        v, f = synthetic_shell(bow=.04)
        centers = v[f].mean(axis=1)
        refined_v = np.concatenate([v, centers])
        refined_f = [[a, b, len(v) + i] for i, face in enumerate(f)
                     for a, b in zip(face, np.roll(face, -1))]
        a, b = measure_shell(v, f), measure_shell(refined_v, refined_f)
        for key in ("humpPeakFraction", "frontFlareRatio", "sideCurvatureFraction"):
            self.assertAlmostEqual(a[key], b[key])

    def test_invalid_arrays_and_missing_sections(self):
        v, f = synthetic_shell()
        for bad_v, bad_f in ((v * np.nan, f), (v[:, :2], f), (v, f.astype(float)),
                             (v, f + len(v)), (v * [1, 0, 1], f),
                             (np.concatenate([v, [[0, 0, 200]]]), f)):
            with self.assertRaises(ValueError):
                validate_mesh_arrays(bad_v, bad_f)
        with self.assertRaises(ValueError):
            plane_segments(v[f], 1, 999)
        with self.assertRaises(ValueError):
            section_wall_bounds(plane_segments(v[f], 1, 60), 999)

    def test_mapping_boundaries(self):
        for t, expected in ((.55, "center"), (.550001, "back_minimal"),
                            (.62, "back_minimal"), (.620001, "back_moderate"),
                            (.70, "back_moderate"), (.700001, "back_aggressive")):
            self.assertEqual(map_levels(t, 0, 0)["humpPlacement"], expected)
        for sign, direction in ((-1, "inward"), (1, "outward")):
            for ratio, degree in ((.025, "flat"), (.025001, "slight"), (.075, "slight"),
                                  (.075001, "moderate"), (.15, "moderate"), (.150001, "aggressive")):
                expected = "flat" if degree == "flat" else direction + "_" + degree
                self.assertEqual(map_levels(.5, sign * ratio, 0)["frontFlare"], expected)
            for bow, suffix in ((.01, "flat"), (.010001, ""), (.08, ""), (.080001, "_aggressive")):
                expected = "flat" if suffix == "flat" else direction + suffix
                self.assertEqual(map_levels(.5, 0, sign * bow)["sideCurvature"], expected)
        for args in ((-.1, 0, 0), (1.1, 0, 0), (.5, np.nan, 0), (.5, 0, np.inf)):
            with self.assertRaises(ValueError):
                map_levels(*args)


class PredictionRoutingTests(unittest.TestCase):
    def setUp(self):
        self.entry = {"slug": "source", "model": "Source", "path": "source.glb",
                      "dimensionsXYZmm": [60, 120, 40]}
        self.manifest = {"shells": [dict(self.entry), dict(self.entry, slug="alias", model="Alias", aliasOf="source")],
                         "studies": [dict(self.entry, slug="study", model="Study", path="study.glb")],
                         "noShell": [{"slug": "missing", "reason": "No shell"}]}
        self.catalogue = {slug: {"model": slug.title()} for slug in ("source", "alias", "study", "missing")}

    def test_alias_study_and_null_routing(self):
        calls = []
        def load(entry):
            calls.append(entry["slug"])
            return synthetic_shell()
        original = copy.deepcopy(self.manifest)
        rows = build_predictions(self.manifest, self.catalogue, load)
        self.assertEqual(calls, ["source", "study"])
        self.assertEqual(rows[1]["measures"], rows[0]["measures"])
        self.assertEqual(rows[1]["humpPlacement"], rows[0]["humpPlacement"])
        self.assertEqual(rows[1]["aliasOf"], "source")
        self.assertEqual(rows[2]["confidence"], "lower")
        self.assertEqual(rows[3]["confidence"], "none")
        for field in ("humpPlacement", "frontFlare", "sideCurvature", "measures"):
            self.assertIsNone(rows[3][field])
        self.assertEqual(self.manifest, original)

    def test_frame_cautions_come_from_first_party_url(self):
        self.assertEqual(frame_caution("https://example.test/m575-ergo-wireless-trackball"), "trackball")
        self.assertEqual(frame_caution("https://example.test/lift-VERTICAL-ergonomic-mouse"), "vertical")
        self.assertIsNone(frame_caution("https://example.test/regular-mouse"))

    def test_invalid_coverage_alias_and_dimensions(self):
        for kind in ("coverage", "path", "cycle", "dimensions"):
            manifest = copy.deepcopy(self.manifest)
            if kind == "coverage":
                manifest["noShell"] = []
            elif kind == "path":
                manifest["shells"][1]["path"] = "other.glb"
            elif kind == "cycle":
                manifest["shells"][0]["aliasOf"] = "alias"
            else:
                manifest["shells"][0]["dimensionsXYZmm"] = [60, 100, 40]
            with self.assertRaises(ValueError):
                build_predictions(manifest, self.catalogue, lambda e: synthetic_shell())


if __name__ == "__main__":
    unittest.main()
