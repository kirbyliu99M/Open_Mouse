"""GD-3 frame regression tests through the frozen GLB decoder itself."""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from descriptor_geometry import measure_shell
from measure_descriptors import decode_shell

ROOT = Path(__file__).resolve().parents[3]


class DecodeFrameTests(unittest.TestCase):
    def setUp(self):
        # Origin and three independent metre-space directions; all referenced.
        self.positions = np.array([[0., 0., 0.], [.002, 0., 0.],
                                   [0., .003, 0.], [0., 0., -.005]])
        self.faces = np.array([[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]])
        attribute = Mock(return_value={"data": self.positions})
        decoder = Mock(return_value=SimpleNamespace(
            get_attribute_by_unique_id=attribute, faces=self.faces))
        document = {
            "asset": {"version": "2.0"}, "scene": 0,
            "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
            "meshes": [{"primitives": [{
                "attributes": {"POSITION": 0},
                "extensions": {"KHR_draco_mesh_compression": {
                    "bufferView": 0, "attributes": {"POSITION": 7}}}}]}],
            "accessors": [{"count": 4, "type": "VEC3", "componentType": 5126,
                           "min": self.positions.min(axis=0).tolist(),
                           "max": self.positions.max(axis=0).tolist()}],
            "buffers": [{"byteLength": 4}],
            "bufferViews": [{"buffer": 0, "byteLength": 4}],
        }
        encoded = json.dumps(document).encode("utf-8")
        encoded += b" " * (-len(encoded) % 4)
        payload = b"stub"
        blob = (struct.pack("<4sII", b"glTF", 2, 28 + len(encoded) + len(payload))
                + struct.pack("<I4s", len(encoded), b"JSON") + encoded
                + struct.pack("<I4s", len(payload), b"BIN\0") + payload)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.glb"
            path.write_bytes(blob)
            # Only the codec is replaced: parsing, accessor validation, array
            # validation, axis conversion and primitive assembly all run.
            with patch.dict(sys.modules, {"DracoPy": SimpleNamespace(decode=decoder)}):
                self.vertices, faces = decode_shell(path)
        decoder.assert_called_once_with(payload)
        attribute.assert_called_once_with(7)
        np.testing.assert_array_equal(faces, self.faces)

    def test_gltf_negative_z_nose_becomes_blender_positive_y(self):
        np.testing.assert_array_equal(self.vertices[3], [0., 5., 0.])

    def test_gltf_up_becomes_blender_positive_z(self):
        np.testing.assert_array_equal(self.vertices[2], [0., 0., 3.])

    def test_metres_become_millimetres_on_every_axis(self):
        np.testing.assert_allclose(np.linalg.norm(self.vertices[1:], axis=1),
                                   [2., 3., 5.], rtol=0, atol=1e-12)
        np.testing.assert_array_equal(self.vertices[1], [2., 0., 0.])

    def test_frame_rotation_preserves_handedness(self):
        # Recover the actual linear transform from decode_shell's output.
        # The rotation has det +1; with mm scaling the determinant is 1000**3.
        transform = np.linalg.solve(self.positions[1:] - self.positions[0],
                                    self.vertices[1:] - self.vertices[0])
        self.assertAlmostEqual(np.linalg.det(transform / 1000.), 1.)
        np.testing.assert_allclose((transform / 1000.) @ (transform / 1000.).T,
                                   np.eye(3), rtol=0, atol=1e-12)


class DeliveredDecodeTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("DracoPy") is not None,
                         "Optional delivered-GLB check requires DracoPy")
    def test_delivered_bounds_and_gd1_peak(self):
        manifest = json.loads((ROOT / "public/models/manifest.json").read_text(encoding="utf-8"))
        entry = next(e for e in manifest["shells"] if e["model"] == "G305 Lightspeed")
        vertices, faces = decode_shell(ROOT / "public/models" / entry["path"])
        np.testing.assert_allclose(np.ptp(vertices, axis=0), entry["dimensionsXYZmm"],
                                   atol=.01, rtol=0)
        # Geometry prediction in DESCRIPTOR-GEOMETRY.md's GD-1 table, NOT a
        # private fixture label. Tolerance is half its six-decimal rounding unit.
        self.assertAlmostEqual(measure_shell(vertices, faces)["humpPeakFraction"],
                               .647423, delta=.0000005)


if __name__ == "__main__":
    unittest.main()
