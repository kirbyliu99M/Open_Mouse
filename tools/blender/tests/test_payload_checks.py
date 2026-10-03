import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import audit_payloads
from check_catalogues import NO_SHELL
from glb_fixture import shell_document, write_glb


class PayloadTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.models = Path(folder.name)
        self.path = self.models / "shell.glb"
        self.doc = shell_document()
        self.doc["images"] = [{"bufferView": 0, "mimeType": "image/jpeg"}]
        write_glb(self.path, self.doc)
        model_patch = patch.object(audit_payloads, "MODELS", self.models)
        model_patch.start()
        self.addCleanup(model_patch.stop)

    def test_valid_payload_counts(self):
        record = audit_payloads.inspect_glb(self.path)
        self.assertEqual(record, {"path": "shell.glb", "bytes": self.path.stat().st_size,
                                  "imageBytes": 4, "imageCount": 1, "otherBytes": self.path.stat().st_size - 4})

    def test_bad_header(self):
        original = self.path.read_bytes()
        for data in (b"glTF", b"bad!" + original[4:], original[:4] + struct.pack("<I", 1) + original[8:]):
            self.path.write_bytes(data)
            with self.subTest(data=data[:12]), self.assertRaisesRegex(ValueError, "Invalid GLB header"):
                audit_payloads.inspect_glb(self.path)

    def test_bad_length(self):
        data = self.path.read_bytes()
        self.path.write_bytes(data[:8] + struct.pack("<I", len(data) + 4) + data[12:])
        with self.assertRaisesRegex(ValueError, "GLB length mismatch"):
            audit_payloads.inspect_glb(self.path)

    def test_missing_draco_extension(self):
        del self.doc["extensionsUsed"]
        write_glb(self.path, self.doc)
        with self.assertRaisesRegex(ValueError, "Draco compression missing"):
            audit_payloads.inspect_glb(self.path)

    def test_bad_texture_mime(self):
        self.doc["images"][0]["mimeType"] = "image/webp"
        write_glb(self.path, self.doc)
        with self.assertRaisesRegex(ValueError, "Unexpected image format"):
            audit_payloads.inspect_glb(self.path)

    def optimizer(self, *, byte_delta=0, optimized=False):
        manifest = {"shells": [{"slug": "logitech-example", "path": "shell.glb",
                                "bytes": self.path.stat().st_size + byte_delta}], "studies": [],
                    "noShell": [{"slug": slug, "reason": reason} for slug, reason in NO_SHELL.items()]}
        (self.models / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        script = Path(__file__).resolve().parents[1] / "optimize_glbs.py"
        # Execute the real main/--check path with only the fixture root replaced.
        code = (
            "import runpy,sys; from pathlib import Path; "
            "script,root=sys.argv[1:]; sys.path.insert(0,str(Path(script).parent)); "
            "ns=runpy.run_path(script); ns['main'].__globals__['ROOT']=Path(root); "
            "sys.argv=[script,'--check']; ns['main']()"
        )
        return subprocess.run([sys.executable, *(['-O'] if optimized else []), '-B', '-c', code,
                               str(script), str(self.models)], capture_output=True, text=True)

    def test_optimizer_valid_check_is_read_only(self):
        before = self.path.read_bytes()
        for optimized in (False, True):
            result = self.optimizer(optimized=optimized)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.path.read_bytes(), before)

    def test_optimizer_rejects_leftover_png(self):
        self.doc["images"][0]["mimeType"] = "image/png"
        write_glb(self.path, self.doc)
        for optimized in (False, True):
            with self.subTest(optimized=optimized):
                result = self.optimizer(optimized=optimized)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Uncompressed PNG maps remain", result.stderr)

    def test_optimizer_rejects_bytes_mismatch_even_under_O(self):
        for optimized in (False, True):
            with self.subTest(optimized=optimized):
                result = self.optimizer(byte_delta=1, optimized=optimized)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("GLB size mismatch", result.stderr)
