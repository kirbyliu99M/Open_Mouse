"""Ensure the Blender reference catalogue matches the database seed dimensions."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "tools/blender/params/reference-catalogue.json"
SEED = ROOT / "src/db/seed/logitech.json"
FIELDS = ("lengthMm", "widthMm", "heightMm")
# Catalogue products with verified dimensions but insufficient shell references.
NO_SHELL = {
    "logitech-m100": "M100: removed by Kirby 2026-09-28; limited-view study not accepted (detail and proportions) and no official AR source found",
    "logitech-mobi-fold": "Mobi Fold: only a folded side photo exists",
    "logitech-signature-comfort-m840l": "M840L: no top-down photo",
    "logitech-mx-ergo-s": "only front-oblique side photos; study was not recognisable",
}
ALIASES = {"logitech-ergo-m575s": "logitech-ergo-m575"}


def check_no_shell_assets(manifest: dict, models: Path, validation: dict | None = None) -> None:
    """Reject stale publication routes and files for catalogue-only products."""
    declared = {entry["slug"]: entry["reason"] for entry in manifest["noShell"]}
    if declared != NO_SHELL:
        raise ValueError("Manifest noShell differs from catalogue routing")
    delivered = manifest["shells"] + manifest.get("studies", [])
    if validation is not None:
        delivered += validation["roundTrips"]
    stale = {entry["slug"] for entry in delivered} & NO_SHELL.keys()
    stale_files = [str(path.relative_to(models)) for path in models.rglob("*.glb")
                   if path.stem in NO_SHELL]
    if stale or stale_files:
        raise ValueError(f"NO_SHELL assets remain: entries={sorted(stale)}, files={stale_files}")


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


def check(seed: list[dict], reference: list[dict], aliases: dict[str, str] = ALIASES,
          no_shell: dict[str, str] = NO_SHELL) -> None:
    seeded, referenced = entries(seed), entries(reference)
    expected_missing = no_shell.keys() & seeded.keys()
    if seeded.keys() - referenced.keys() != expected_missing or any(
        seeded[key] != referenced[key] for key in seeded.keys() & referenced.keys()
    ) or referenced.keys() - seeded.keys() or no_shell.keys() - (seeded.keys() - referenced.keys()):
        missing = sorted(seeded.keys() - referenced.keys() - no_shell.keys())
        extra = sorted(referenced.keys() - seeded.keys())
        dimensions = sorted(key for key in seeded.keys() & referenced.keys() if seeded[key] != referenced[key])
        stale_exemptions = sorted(no_shell.keys() - (seeded.keys() - referenced.keys()))
        raise ValueError(f"Catalogue mismatch: missing={missing}, extra={extra}, dimensions={dimensions}, staleNoShell={stale_exemptions}")
    for alias, source in aliases.items():
        if alias not in seeded or source not in seeded or seeded[alias] != seeded[source]:
            raise ValueError(f"Invalid alias dimensions or seed entry: {alias} -> {source}")


if __name__ == "__main__":
    check(json.loads(SEED.read_text(encoding="utf-8-sig")), json.loads(REFERENCE.read_text(encoding="utf-8-sig")))
    models = ROOT / "public/models"
    check_no_shell_assets(json.loads((models / "manifest.json").read_text(encoding="utf-8")), models,
                          json.loads((models / "validation.json").read_text(encoding="utf-8")))
    print("CATALOGUES_MATCH")
