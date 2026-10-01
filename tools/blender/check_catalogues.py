"""Ensure the Blender reference catalogue matches the database seed dimensions."""

import json
import math
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
BBOX_TOLERANCE_MM = 0.5


def check_no_shell_assets(manifest: dict, models: Path, validation: dict | None = None) -> None:
    """Reject stale publication routes and files for catalogue-only products."""
    declared = {entry["slug"]: entry["reason"] for entry in manifest["noShell"]}
    if len(declared) != len(manifest["noShell"]) or declared != NO_SHELL:
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


def check_manifest(seed: list[dict], manifest: dict, models: Path,
                   aliases: dict[str, str] = ALIASES,
                   no_shell: dict[str, str] = NO_SHELL) -> None:
    """Require one route per seeded mouse and exactly the delivered GLB files."""
    seeded = entries(seed)
    delivered = manifest["shells"] + manifest.get("studies", [])
    routes = delivered + manifest["noShell"]
    slugs = [entry["slug"] for entry in routes]
    if len(slugs) != len(set(slugs)):
        raise ValueError("Duplicate manifest slug")
    if set(slugs) != seeded.keys():
        raise ValueError(f"Manifest coverage mismatch: missing={sorted(seeded.keys() - set(slugs))}, "
                         f"extra={sorted(set(slugs) - seeded.keys())}")
    declared = {entry["slug"]: entry["reason"] for entry in manifest["noShell"]}
    if declared != no_shell or any(not reason.strip() for reason in declared.values()):
        raise ValueError("Manifest noShell differs from catalogue routing")
    by_slug = {entry["slug"]: entry for entry in delivered}
    expected_paths = set()
    canonical_paths = set()
    for entry in delivered:
        key = entry["slug"]
        length, width, height = seeded[key]
        dims = entry["dimensionsXYZmm"]
        if len(dims) != 3 or any(
            not isinstance(value, (int, float)) or not math.isfinite(value)
            or abs(value - target) > BBOX_TOLERANCE_MM
            for value, target in zip(dims, (width, length, height))
        ):
            raise ValueError(f"Manifest dimensions differ from seed: {key}")
        relative = Path(entry["path"])
        path = models / relative
        if relative.is_absolute() or ".." in relative.parts or path.suffix != ".glb":
            raise ValueError(f"Invalid shell path: {key}")
        if not path.is_file():
            raise ValueError(f"Missing shell file: {key}: {relative}")
        if entry["bytes"] != path.stat().st_size:
            raise ValueError(f"Shell size mismatch: {key}")
        expected_paths.add(relative.as_posix())
        if key in aliases:
            source = by_slug.get(aliases[key])
            if entry.get("aliasOf") != aliases[key] or source is None or any(
                entry[field] != source[field] for field in ("path", "dimensionsXYZmm", "bytes")
            ) or seeded[key] != seeded[aliases[key]]:
                raise ValueError(f"Invalid manifest alias: {key}")
        elif "aliasOf" in entry or relative.as_posix() in canonical_paths:
            raise ValueError(f"Undocumented shared shell: {key}")
        else:
            canonical_paths.add(relative.as_posix())
    if manifest.get("hand") is not None:
        expected_paths.add("hand.glb")
    actual_paths = {path.relative_to(models).as_posix() for path in models.rglob("*.glb")}
    if actual_paths != expected_paths:
        raise ValueError(f"Manifest files mismatch: missing={sorted(expected_paths - actual_paths)}, "
                         f"extra={sorted(actual_paths - expected_paths)}")
    if manifest.get("hand") is not None and manifest["hand"]["bytes"] != (models / "hand.glb").stat().st_size:
        raise ValueError("Hand size mismatch")


if __name__ == "__main__":
    seed = json.loads(SEED.read_text(encoding="utf-8-sig"))
    check(seed, json.loads(REFERENCE.read_text(encoding="utf-8-sig")))
    models = ROOT / "public/models"
    manifest = json.loads((models / "manifest.json").read_text(encoding="utf-8"))
    check_manifest(seed, manifest, models)
    check_no_shell_assets(manifest, models,
                          json.loads((models / "validation.json").read_text(encoding="utf-8")))
    print("CATALOGUES_MATCH")
