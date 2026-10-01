"""Reproduce F9-2 guard mutations in an ignored, isolated repository copy."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
SCRATCH = ROOT / "tools/blender/out/f9/mutation"
# label, source file, exact original, replacement, focused unittest
MUTATIONS = [
    ("shared-path", "check_catalogues.py", ' or relative.as_posix() in canonical_paths', '',
     'test_catalogues.ManifestTests.test_shared_path_without_alias_of'),
    *[(f"alias-{field}", "check_catalogues.py", 'for field in ("path", "dimensionsXYZmm", "bytes")',
       f'for field in {tuple(f for f in ("path", "dimensionsXYZmm", "bytes") if f != field)!r}',
       'test_catalogues.ManifestTests.test_alias_path_dimensions_and_bytes_must_equal_source')
      for field in ("path", "dimensionsXYZmm", "bytes")],
    ("dimension-count", "check_catalogues.py", 'len(dims) != 3 or any(', 'any(',
     'test_catalogues.ManifestTests.test_dimensions_must_have_exactly_three_axes'),
    ("absolute-path", "check_catalogues.py", 'relative.is_absolute() or ', '',
     'test_catalogues.ManifestTests.test_path_cannot_escape_models_directory'),
    ("parent-path", "check_catalogues.py", '".." in relative.parts or ', '',
     'test_catalogues.ManifestTests.test_path_cannot_escape_models_directory'),
    ("reference-extra", "check_catalogues.py", 'or referenced.keys() - seeded.keys() ', '',
     'test_catalogues.CatalogueTests.test_reference_extra_with_seed_fully_covered'),
    ("no-shell-duplicate", "check_catalogues.py", 'len(declared) != len(manifest["noShell"]) or ', '',
     'test_catalogues.CatalogueTests.test_no_shell_assets_reject_duplicate_declaration'),
    ("manifest-no-shell-duplicate", "check_catalogues.py", 'if len(slugs) != len(set(slugs)):', 'if False:',
     'test_catalogues.ManifestTests.test_explicit_no_shell_and_duplicate_no_shell'),
    ("hand-bytes", "check_catalogues.py", 'if manifest.get("hand") is not None and manifest["hand"]["bytes"] != (models / "hand.glb").stat().st_size:', 'if False:',
     'test_catalogues.ManifestTests.test_hand_bytes_must_match_file'),
    ("main-manifest-call", "check_catalogues.py", '    check_manifest(seed, manifest, models)\n', '',
     'test_catalogues.MainTests.test_main_rejects_manifest_drift'),
]


def main():
    repo = SCRATCH / "repo"
    blender = repo / "tools/blender"
    tests = blender / "tests"
    tests.mkdir(parents=True, exist_ok=True)
    for source in (ROOT / "tools/blender").glob("*.py"):
        shutil.copy2(source, blender / source.name)
    for source in (ROOT / "tools/blender/tests").glob("*.py"):
        shutil.copy2(source, tests / source.name)
    for relative in ("tools/blender/params", "public/models", "src/db/seed"):
        shutil.copytree(ROOT / relative, repo / relative, dirs_exist_ok=True)
    results = []
    for label, filename, original, replacement, test in MUTATIONS:
        path = blender / filename
        source = path.read_text(encoding="utf-8")
        if source.count(original) != 1:
            raise RuntimeError(f"Mutation {label}: expected one match, got {source.count(original)}")
        command = [sys.executable, "-B", "-m", "unittest", test]
        baseline = subprocess.run(command, cwd=tests, capture_output=True, text=True)
        if baseline.returncode:
            raise RuntimeError(f"Baseline {label} failed: {baseline.stdout}{baseline.stderr}")
        try:
            path.write_text(source.replace(original, replacement), encoding="utf-8")
            result = subprocess.run(command, cwd=tests, capture_output=True, text=True)
        finally:
            path.write_text(source, encoding="utf-8")
        (SCRATCH / f"{label}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
        # Require an assertion failure, not an import/syntax/environment error.
        killed = result.returncode != 0 and "FAIL:" in result.stderr and "ERROR:" not in result.stderr
        results.append({"mutation": label, "test": test, "killed": killed})
        print(f"{label}: {'KILLED' if killed else 'FAILED TO KILL'}", flush=True)
    (SCRATCH / "results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    if not all(result["killed"] for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
