import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_catalogues import check


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.row = {"brand": "Logitech", "model": "Example", "lengthMm": 100, "widthMm": 60, "heightMm": 40}

    def test_matching_catalogues(self):
        check([self.row], [dict(self.row)])

    def test_slug_and_each_dimension_disagreement(self):
        for field, value in (("model", "Different"), ("lengthMm", 101), ("widthMm", 61), ("heightMm", 41)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                check([self.row], [{**self.row, field: value}])

    def test_duplicate_slug(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            check([self.row, dict(self.row)], [self.row])


if __name__ == "__main__":
    unittest.main()
