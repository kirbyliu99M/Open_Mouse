import json
from pathlib import Path
import math
import unittest
import sys
HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from geometry import hand_skeleton, section_point, shell_loft, top_profile


class GeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.models = json.loads((HERE / "out/parameters.json").read_text())["models"] + json.loads((HERE / "out/coverage.json").read_text())

    def test_closed_loft_and_bounds(self):
        for p in self.models:
            vertices, faces = shell_loft(p)
            edges = {}
            for face in faces:
                for a, b in zip(face, face[1:] + face[:1]):
                    edge = tuple(sorted((a, b)))
                    edges[edge] = edges.get(edge, 0) + 1
            self.assertEqual(set(edges.values()), {2})
            self.assertEqual(len(vertices) - len(edges) + len(faces), 2)
            self.assertAlmostEqual(max(v[1] for v in vertices) - min(v[1] for v in vertices), p["length"])
            self.assertTrue(all(math.isfinite(x) for v in vertices for x in v))

    def test_peak_and_symmetry_and_handedness(self):
        for base in self.models:
            p = dict(base, tilt=0, concavity=0, thumbShelf=0, ringShelf=0)
            self.assertAlmostEqual(top_profile(p["peakU"], p), p["height"])
            self.assertGreater(top_profile(p["peakU"], p), top_profile(0, p))
            for u in (.1, .3, .6, .8):
                a = section_point(u, .7, p)
                b = section_point(u, math.pi - .7, p)
                self.assertAlmostEqual(a[0], -b[0])
                self.assertAlmostEqual(a[2], b[2])
                right = section_point(u, .7, dict(p, tilt=.1, handedness=1))
                left = section_point(u, math.pi - .7, dict(p, tilt=.1, handedness=-1))
                self.assertAlmostEqual(right[0], -left[0])
                self.assertAlmostEqual(right[2], left[2])

    def test_reject_bad_resolution(self):
        with self.assertRaises(ValueError):
            shell_loft(self.models[0], rings=2)

    def test_hand_is_21_joint_tree(self):
        points, edges = hand_skeleton()
        self.assertEqual(len(points), 21)
        self.assertEqual(len(edges), 20)
        self.assertEqual({b for _, b in edges}, set(range(1, 21)))
        self.assertEqual(points[0], (0, 0, 0))
        for a, b in edges:
            self.assertGreater(math.dist(points[a], points[b]), .01)


if __name__ == "__main__":
    unittest.main()
