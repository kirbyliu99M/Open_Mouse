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
    ("main-bounds-call", "check_catalogues.py", 'errors = check_glb_bounds(seed, manifest, models)', 'errors = {}',
     'test_catalogues.MainTests.test_main_runs_accessor_bounds_check'),
    ("bounds-manifest-tolerance", "check_catalogues.py", 'error > BBOX_TOLERANCE_MM or ', '',
     'test_glb_bounds.BoundsTests.test_half_mm_manifest_and_seed_bounds_guards'),
    ("bounds-seed-tolerance", "check_catalogues.py", 'or seed_error > BBOX_TOLERANCE_MM', '',
     'test_glb_bounds.BoundsTests.test_half_mm_manifest_and_seed_bounds_guards'),
    ("bounds-axis-mm", "glb_bounds.py", 'for a in (0, 2, 1)', 'for a in (0, 1, 2)',
     'test_glb_bounds.BoundsTests.test_draco_accessor_bounds_axis_mapping_and_mm'),
    ("bounds-metres", "glb_bounds.py", '(maximum[a] - minimum[a]) * 1000', '(maximum[a] - minimum[a])',
     'test_glb_bounds.BoundsTests.test_draco_accessor_bounds_axis_mapping_and_mm'),
    ("bounds-all-primitives", "glb_bounds.py", 'document["meshes"][node["mesh"]]["primitives"]:', 'document["meshes"][node["mesh"]]["primitives"][:1]:',
     'test_glb_bounds.BoundsTests.test_every_primitive_and_node_in_world_frame'),
    ("bounds-parent-transform", "glb_bounds.py", 'parent_translation[a] + parent_scale[a] * local_translation[a]', 'local_translation[a]',
     'test_glb_bounds.BoundsTests.test_every_primitive_and_node_in_world_frame'),
    ("bounds-parent-scale", "glb_bounds.py", 'parent_scale[a] * local_scale[a]', 'local_scale[a]',
     'test_glb_bounds.BoundsTests.test_every_primitive_and_node_in_world_frame'),
    ("bounds-reflection", "glb_bounds.py", 'min(minimum[axis], *ends)', 'min(minimum[axis], ends[0])',
     'test_glb_bounds.BoundsTests.test_reflected_node_bounds'),
    ("bounds-animations", "glb_bounds.py", 'if document.get("animations"):', 'if False:',
     'test_glb_bounds.BoundsTests.test_animation_and_morph_are_reported'),
    ("bounds-hierarchy", "glb_bounds.py", 'if index in seen:', 'if False:',
     'test_glb_bounds.BoundsTests.test_cycles_and_multiple_parents_are_rejected'),
    *[(f"bounds-{label}", "glb_bounds.py", condition, '',
       'test_glb_bounds.BoundsTests.test_unsupported_node_transforms_and_skin_are_reported')
      for label, condition in (("matrix", '"matrix" in node or '),
                               ("rotation", 'node.get("rotation", [0, 0, 0, 1]) != [0, 0, 0, 1] or '),
                               ("skin", ' or "skin" in node'))],
    ("bounds-morph", "glb_bounds.py", 'if primitive.get("targets"):', 'if False:',
     'test_glb_bounds.BoundsTests.test_animation_and_morph_are_reported'),
    ("bounds-accessor-metadata", "glb_bounds.py", 'if accessor.get("type") != "VEC3" or "min" not in accessor or "max" not in accessor:', 'if False:',
     'test_glb_bounds.BoundsTests.test_missing_position_bounds_or_wrong_type'),
    ("bounds-vector-length", "glb_bounds.py", 'len(values) != 3 or ', '',
     'test_glb_bounds.BoundsTests.test_bounds_and_transforms_need_three_finite_components'),
    ("bounds-finite", "glb_bounds.py", 'not isinstance(v, (int, float)) or not math.isfinite(v)', 'False',
     'test_glb_bounds.BoundsTests.test_bounds_and_transforms_need_three_finite_components'),
    ("bounds-inverted", "glb_bounds.py", 'if any(a > b for a, b in zip(low, high)):', 'if False:',
     'test_glb_bounds.BoundsTests.test_inverted_bounds_are_rejected'),
    ("bounds-default-scene", "glb_bounds.py", 'if "scene" not in document and len(document["scenes"]) != 1:', 'if False:',
     'test_glb_bounds.BoundsTests.test_empty_and_ambiguous_scene_are_rejected'),
    ("bounds-empty-scene", "glb_bounds.py", 'if not all(math.isfinite(v) for v in minimum + maximum):', 'if False:',
     'test_glb_bounds.BoundsTests.test_empty_and_ambiguous_scene_are_rejected'),
    ("glb-header", "glb_bounds.py", 'if len(data) < 20 or data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:', 'if False:',
     'test_glb_bounds.BoundsTests.test_invalid_glb_envelope'),
    ("glb-length", "glb_bounds.py", 'if struct.unpack_from("<I", data, 8)[0] != len(data):', 'if False:',
     'test_glb_bounds.BoundsTests.test_invalid_glb_envelope'),
    ("glb-json-type", "glb_bounds.py", 'kind != b"JSON" or ', '',
     'test_glb_bounds.BoundsTests.test_invalid_glb_envelope'),
    ("glb-json-length", "glb_bounds.py", ' or 20 + size > len(data)', '',
     'test_glb_bounds.BoundsTests.test_invalid_glb_envelope'),
    ("audit-header", "glb_bounds.py", 'if len(data) < 20 or data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:', 'if False:',
     'test_payload_checks.PayloadTests.test_bad_header'),
    ("audit-length", "glb_bounds.py", 'if struct.unpack_from("<I", data, 8)[0] != len(data):', 'if False:',
     'test_payload_checks.PayloadTests.test_bad_length'),
    ("audit-draco", "audit_payloads.py", 'if "KHR_draco_mesh_compression" not in document.get("extensionsUsed", []):', 'if False:',
     'test_payload_checks.PayloadTests.test_missing_draco_extension'),
    ("audit-mime", "audit_payloads.py", 'if any(image.get("mimeType") not in ("image/png", "image/jpeg") for image in images):', 'if False:',
     'test_payload_checks.PayloadTests.test_bad_texture_mime'),
    ("optimizer-png", "optimize_glbs.py", 'if count:', 'if False:',
     'test_payload_checks.PayloadTests.test_optimizer_rejects_leftover_png'),
    ("optimizer-bytes", "optimize_glbs.py", "if path.stat().st_size != entry['bytes']:", 'if False:',
     'test_payload_checks.PayloadTests.test_optimizer_rejects_bytes_mismatch_even_under_O'),
    ("optimizer-assert-under-O", "optimize_glbs.py", "            if path.stat().st_size != entry['bytes']:\n                raise ValueError(f'GLB size mismatch: {path}')",
     "            assert path.stat().st_size == entry['bytes'], f'GLB size mismatch: {path}'",
     'test_payload_checks.PayloadTests.test_optimizer_rejects_bytes_mismatch_even_under_O'),
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
    selected = set(sys.argv[1:])
    for label, filename, original, replacement, test in MUTATIONS:
        if selected and label not in selected:
            continue
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
        # A wrong exception is also a red test (e.g. missing accessor min becomes
        # KeyError). Reject syntax/import failures unrelated to the guard.
        killed = (result.returncode != 0 and ("FAIL:" in result.stderr or "ERROR:" in result.stderr)
                  and not any(error in result.stderr for error in ("SyntaxError", "ImportError", "ModuleNotFoundError")))
        results.append({"mutation": label, "test": test, "killed": killed})
        print(f"{label}: {'KILLED' if killed else 'FAILED TO KILL'}", flush=True)
    (SCRATCH / "results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    if not all(result["killed"] for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
