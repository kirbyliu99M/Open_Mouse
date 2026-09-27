"""Ensure the Blender reference catalogue matches the database seed dimensions."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "tools/blender/params/reference-catalogue.json"
SEED = ROOT / "src/db/seed/logitech.json"
FIELDS = ("lengthMm", "widthMm", "heightMm")


def slug(record: dict) -> str:
    model = "".join(c.lower() if c.isalnum() else "-" for c in record["model"]).strip("-")
    return record["brand"].lower() + "-" + model


def entries(records: list[dict]) -> dict[str, tuple]:
    result = {}
    for record in records:
        key = slug(record)
        if key in result:
            raise ValueError(f"Duplicate catalogue slug: {key}")
        result[key] = tuple(record[field] for field in FIELDS)
    return result


def check(seed: list[dict], reference: list[dict]) -> None:
    seeded, referenced = entries(seed), entries(reference)
    if seeded != referenced:
        missing = sorted(seeded.keys() - referenced.keys())
        extra = sorted(referenced.keys() - seeded.keys())
        dimensions = sorted(key for key in seeded.keys() & referenced.keys() if seeded[key] != referenced[key])
        raise ValueError(f"Catalogue mismatch: missing={missing}, extra={extra}, dimensions={dimensions}")


if __name__ == "__main__":
    check(json.loads(SEED.read_text(encoding="utf-8-sig")), json.loads(REFERENCE.read_text(encoding="utf-8-sig")))
    print("CATALOGUES_MATCH")
