import sys
from pathlib import Path
import unittest
import tempfile
from copy import deepcopy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_catalogues import NO_SHELL, check, check_manifest, check_no_shell_assets


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.row = {"brand": "Logitech", "model": "Example", "lengthMm": 100, "widthMm": 60, "heightMm": 40}

    def test_matching_catalogues(self):
        check([self.row], [dict(self.row)], aliases={}, no_shell={})

    def test_slug_and_each_dimension_disagreement(self):
        for field, value in (("model", "Different"), ("lengthMm", 101), ("widthMm", 61), ("heightMm", 41)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                check([self.row], [{**self.row, field: value}], aliases={}, no_shell={})

    def test_duplicate_slug(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            check([self.row, dict(self.row)], [self.row], aliases={}, no_shell={})

    def test_only_documented_no_shell_products_may_be_missing(self):
        exempt = [
            {**self.row, "model": "Mobi Fold"},
            {**self.row, "model": "Signature Comfort M840L"},
        ]
        self.assertEqual(len(NO_SHELL), 4)
        check(exempt, [], aliases={}, no_shell={key: NO_SHELL[key] for key in ("logitech-mobi-fold", "logitech-signature-comfort-m840l")})
        with self.assertRaisesRegex(ValueError, "missing=.*logitech-example"):
            check([self.row, *exempt], [], aliases={}, no_shell={key: NO_SHELL[key] for key in ("logitech-mobi-fold", "logitech-signature-comfort-m840l")})
        with self.assertRaisesRegex(ValueError, "staleNoShell"):
            check(exempt, exempt, aliases={}, no_shell={key: NO_SHELL[key] for key in ("logitech-mobi-fold", "logitech-signature-comfort-m840l")})

    def test_no_shell_entry_absent_from_seed_is_stale(self):
        with self.assertRaisesRegex(ValueError, "staleNoShell=.*logitech-mobi-fold"):
            check([self.row], [self.row], aliases={}, no_shell={"logitech-mobi-fold": "missing"})

    def test_no_shell_publication_rejects_stale_entries_and_files(self):
        manifest = {"shells": [], "studies": [], "noShell": [{"slug": k, "reason": v} for k, v in NO_SHELL.items()]}
        with tempfile.TemporaryDirectory() as folder:
            models = Path(folder)
            check_no_shell_assets(manifest, models, {"roundTrips": []})
            for key in ("shells", "studies"):
                stale = deepcopy(manifest)
                stale[key].append({"slug": "logitech-m100"})
                with self.assertRaisesRegex(ValueError, "NO_SHELL assets remain"):
                    check_no_shell_assets(stale, models)
            with self.assertRaisesRegex(ValueError, "NO_SHELL assets remain"):
                check_no_shell_assets(manifest, models, {"roundTrips": [{"slug": "logitech-m100"}]})
            (models / "logitech-m100.glb").touch()
            with self.assertRaisesRegex(ValueError, "NO_SHELL assets remain"):
                check_no_shell_assets(manifest, models)

    def test_m100_remains_catalogue_only_and_cannot_be_reintroduced(self):
        from reconstruct_gallery import CHOICES
        self.assertNotIn("logitech-m100", CHOICES)
        row = {**self.row, "model": "M100"}
        exemption = {"logitech-m100": NO_SHELL["logitech-m100"]}
        check([row], [], aliases={}, no_shell=exemption)
        with self.assertRaisesRegex(ValueError, "staleNoShell"):
            check([row], [row], aliases={}, no_shell=exemption)

    def test_alias_requires_matching_source_dimensions(self):
        source = {**self.row, "model": "ERGO M575", "lengthMm": 134, "widthMm": 100, "heightMm": 48}
        alias = {**source, "model": "ERGO M575S"}
        check([source, alias], [source, alias], aliases={"logitech-ergo-m575s": "logitech-ergo-m575"}, no_shell={})
        with self.assertRaisesRegex(ValueError, "Invalid alias"):
            check([source, {**alias, "heightMm": 49}], [source, {**alias, "heightMm": 49}], aliases={"logitech-ergo-m575s": "logitech-ergo-m575"}, no_shell={})


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.models = Path(self.folder.name)
        (self.models / "example.glb").write_bytes(b"fixture")
        self.seed = [{"brand": "Logitech", "model": "Example", "lengthMm": 100,
                      "widthMm": 60, "heightMm": 40}]
        self.entry = {"slug": "logitech-example", "path": "example.glb", "bytes": 7,
                      "dimensionsXYZmm": [60, 100, 40]}
        self.manifest = {"shells": [self.entry], "studies": [], "noShell": []}

    def check(self, aliases=None, no_shell=None):
        check_manifest(self.seed, self.manifest, self.models,
                       aliases=aliases or {}, no_shell=no_shell or {})

    def test_shell_and_study_use_seed_xyz_dimensions(self):
        self.check()
        self.manifest["studies"] = self.manifest.pop("shells")
        self.manifest["shells"] = []
        self.check()

    def test_existing_half_mm_tolerance_and_nonfinite_rejection(self):
        for axis in range(3):
            original = self.entry["dimensionsXYZmm"][axis]
            for delta in (-0.5, 0.5):
                self.entry["dimensionsXYZmm"][axis] = original + delta
                self.check()
            for value in (original + 0.50001, original - 0.50001, float("nan"), float("inf")):
                self.entry["dimensionsXYZmm"][axis] = value
                with self.subTest(axis=axis, value=value), self.assertRaisesRegex(ValueError, "dimensions"):
                    self.check()
            self.entry["dimensionsXYZmm"][axis] = original

    def test_missing_and_unknown_routes(self):
        self.manifest["shells"] = []
        with self.assertRaisesRegex(ValueError, "coverage.*missing"):
            self.check()
        self.manifest["shells"] = [{**self.entry, "slug": "unknown"}]
        with self.assertRaisesRegex(ValueError, "coverage.*extra"):
            self.check()

    def test_duplicates_within_and_across_routes(self):
        for section in ("shells", "studies", "noShell"):
            self.manifest[section].append(dict(self.entry))
            with self.subTest(section=section), self.assertRaisesRegex(ValueError, "Duplicate"):
                self.check()
            self.manifest[section].pop()

    def test_explicit_no_shell_and_duplicate_no_shell(self):
        self.manifest["shells"] = []
        (self.models / "example.glb").unlink()
        self.manifest["noShell"] = [{"slug": "logitech-example", "reason": "No delivered shell"}]
        self.check(no_shell={"logitech-example": "No delivered shell"})
        with self.assertRaisesRegex(ValueError, "noShell"):
            self.check()
        self.manifest["noShell"] *= 2
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.check(no_shell={"logitech-example": "No delivered shell"})

    def test_missing_stale_files_and_wrong_size(self):
        extra = self.models / "stale.glb"
        extra.touch()
        with self.assertRaisesRegex(ValueError, "files mismatch"):
            self.check()
        extra.unlink()
        self.entry["bytes"] = 8
        with self.assertRaisesRegex(ValueError, "size mismatch"):
            self.check()
        (self.models / "example.glb").unlink()
        with self.assertRaisesRegex(ValueError, "Missing shell"):
            self.check()

    def test_documented_alias_and_undocumented_shared_file(self):
        self.seed.append({**self.seed[0], "model": "Alias"})
        alias = {**self.entry, "slug": "logitech-alias", "aliasOf": "logitech-example"}
        self.manifest["shells"].append(alias)
        mapping = {"logitech-alias": "logitech-example"}
        self.check(aliases=mapping)
        with self.assertRaisesRegex(ValueError, "Undocumented"):
            self.check()
        alias["aliasOf"] = "unknown"
        with self.assertRaisesRegex(ValueError, "Invalid manifest alias"):
            self.check(aliases=mapping)
        alias["aliasOf"] = "logitech-example"
        alias["dimensionsXYZmm"] = [60.1, 100, 40]
        with self.assertRaisesRegex(ValueError, "Invalid manifest alias"):
            self.check(aliases=mapping)

    def test_hand_is_separate_from_seeded_mouse_partition(self):
        (self.models / "hand.glb").touch()
        self.manifest["hand"] = {"path": "hand.glb"}
        self.check()
        (self.models / "hand.glb").unlink()
        with self.assertRaisesRegex(ValueError, "files mismatch"):
            self.check()

    def test_path_cannot_escape_models_directory(self):
        self.entry["path"] = "../example.glb"
        with self.assertRaisesRegex(ValueError, "Invalid shell path"):
            self.check()


if __name__ == "__main__":
    unittest.main()
