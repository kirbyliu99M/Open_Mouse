import sys
from pathlib import Path
import unittest
import tempfile
from copy import deepcopy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_catalogues import NO_SHELL, check, check_no_shell_assets


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


if __name__ == "__main__":
    unittest.main()
