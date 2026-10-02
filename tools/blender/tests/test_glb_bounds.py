from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
import struct

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_catalogues import check_glb_bounds
from glb_bounds import glb_dimensions_mm
from glb_fixture import shell_document, write_glb


class BoundsTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "shell.glb"
        self.doc = shell_document()

    def dimensions(self):
        write_glb(self.path, self.doc)
        return glb_dimensions_mm(self.path)

    def test_draco_accessor_bounds_axis_mapping_and_mm(self):
        self.assertEqual(self.dimensions(), [60, 100, 40])

    def test_invalid_glb_envelope(self):
        self.dimensions()
        original = self.path.read_bytes()
        for label, data, message in (
            ("short", b"glTF", "header"),
            ("magic", b"bad!" + original[4:], "header"),
            ("version", original[:4] + struct.pack("<I", 1) + original[8:], "header"),
            ("length", original[:8] + struct.pack("<I", len(original) + 4) + original[12:], "length"),
            ("chunk-type", original[:16] + b"JUNK" + original[20:], "JSON chunk"),
            ("chunk-length", original[:12] + struct.pack("<I", len(original)) + original[16:], "JSON chunk"),
        ):
            with self.subTest(label=label), self.assertRaisesRegex(ValueError, message):
                self.path.write_bytes(data)
                glb_dimensions_mm(self.path)

    def test_every_primitive_and_node_in_world_frame(self):
        # Two primitives and a second instance under a translated/scaled parent.
        self.doc["accessors"].append({**self.doc["accessors"][0], "min": [-.01, 0, 0], "max": [0, .08, .2]})
        self.doc["meshes"][0]["primitives"].append({"attributes": {"POSITION": 1}})
        self.doc["nodes"] += [{"translation": [1, 2, 3], "scale": [-2, 3, 4], "children": [2]},
                              {"mesh": 0, "translation": [.1, .2, .3], "scale": [2, 1, .5]}]
        self.doc["scenes"][0]["nodes"].append(1)
        for actual, expected in zip(self.dimensions(), [850, 4600, 2840]):
            self.assertAlmostEqual(actual, expected)

    def test_reflected_node_bounds(self):
        self.doc["nodes"][0].update(scale=[-2, 3, -4], translation=[.5, .7, .9])
        for actual, expected in zip(self.dimensions(), [120, 400, 120]):
            self.assertAlmostEqual(actual, expected)

    def test_unsupported_node_transforms_and_skin_are_reported(self):
        for key, value in (("rotation", [0, 0, .5, .8660254]), ("matrix", [1] * 16), ("skin", 0)):
            with self.subTest(key=key):
                self.doc["nodes"][0][key] = value
                with self.assertRaisesRegex(ValueError, "Unsupported"):
                    self.dimensions()
                del self.doc["nodes"][0][key]

    def test_animation_and_morph_are_reported(self):
        self.doc["animations"] = [{}]
        with self.assertRaisesRegex(ValueError, "animated"):
            self.dimensions()
        del self.doc["animations"]
        self.doc["meshes"][0]["primitives"][0]["targets"] = [{"POSITION": 0}]
        with self.assertRaisesRegex(ValueError, "morph"):
            self.dimensions()

    def test_missing_position_bounds_or_wrong_type(self):
        original = deepcopy(self.doc["accessors"][0])
        for field in ("min", "max", "type"):
            self.doc["accessors"][0] = deepcopy(original)
            self.doc["accessors"][0].pop(field)
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "POSITION VEC3"):
                self.dimensions()

    def test_bounds_and_transforms_need_three_finite_components(self):
        for field in ("min", "max", "translation", "scale"):
            target = self.doc["accessors"][0] if field in ("min", "max") else self.doc["nodes"][0]
            for value in ([0, 0], [0, 0, 0, 0], [0, float("nan"), 0], [0, float("inf"), 0]):
                target[field] = value
                with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, "three finite"):
                    self.dimensions()
            self.doc = shell_document()

    def test_inverted_bounds_are_rejected(self):
        self.doc["accessors"][0]["min"] = [.07, 0, 0]
        with self.assertRaisesRegex(ValueError, "Inverted"):
            self.dimensions()

    def test_cycles_and_multiple_parents_are_rejected(self):
        for children in ([0], [1, 1]):
            self.doc["nodes"] = [{"children": children}, {"mesh": 0}]
            with self.assertRaisesRegex(ValueError, "hierarchy"):
                self.dimensions()

    def test_empty_and_ambiguous_scene_are_rejected(self):
        self.doc["scenes"] = [{"nodes": []}]
        with self.assertRaisesRegex(ValueError, "scene bounds"):
            self.dimensions()
        self.doc = shell_document()
        del self.doc["scene"]
        self.assertEqual(self.dimensions(), [60, 100, 40])
        self.doc["scenes"] *= 2
        with self.assertRaisesRegex(ValueError, "default scene"):
            self.dimensions()

    def test_half_mm_manifest_and_seed_bounds_guards(self):
        self.dimensions()
        seed = [{"brand": "Logitech", "model": "Example", "lengthMm": 100, "widthMm": 60, "heightMm": 40}]
        entry = {"slug": "logitech-example", "path": "shell.glb", "dimensionsXYZmm": [60, 100, 40]}
        manifest = {"shells": [entry], "studies": []}
        self.assertEqual(check_glb_bounds(seed, manifest, self.path.parent), {"logitech-example": 0})
        for axis, field in enumerate(("widthMm", "lengthMm", "heightMm")):
            for delta in (-.5, .5, -.50001, .50001):
                for target in ("manifest", "seed"):
                    with self.subTest(axis=axis, delta=delta, target=target):
                        entry["dimensionsXYZmm"] = [60, 100, 40]
                        seed[0].update(widthMm=60, lengthMm=100, heightMm=40)
                        if target == "manifest":
                            entry["dimensionsXYZmm"][axis] += delta
                        else:
                            seed[0][field] += delta
                        if abs(delta) == .5:
                            check_glb_bounds(seed, manifest, self.path.parent)
                        else:
                            with self.assertRaisesRegex(ValueError, "GLB bounds mismatch"):
                                check_glb_bounds(seed, manifest, self.path.parent)
