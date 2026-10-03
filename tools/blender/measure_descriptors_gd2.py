"""Freeze GD-2 predictions, copying hump verbatim from the hash-pinned Run 1 file.

No catalogue labels, private fixture access, validator call, or hump recomputation.
"""
import copy
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np

from descriptor_geometry_gd2 import map_levels_gd2, measure_shell_gd2
from measure_descriptors import ROOT, decode_shell

RUN1_SHA256 = "21e7ffcf3e6af66bb492f1bcdffe704a6f672f84c50f7015c54ed25badc5dc37"
HUMP_MEASURES = ("humpPeakFraction", "peakSpanFromFront", "peakLateralFraction")


def build_predictions_gd2(run1, manifest, loader):
    """Pure routing over our predictions and manifest, with injected geometry."""
    entries = manifest["shells"] + manifest["studies"]
    by_slug = {e["slug"]: e for e in entries}
    absent = {e["slug"] for e in manifest["noShell"]}
    old = {r["slug"]: r for r in run1}
    if (len(by_slug) != len(entries) or len(old) != len(run1)
            or len(absent) != len(manifest["noShell"]) or by_slug.keys() & absent
            or by_slug.keys() | absent != old.keys()):
        raise ValueError("Run 1 and manifest must cover the same unique products")
    cache, visiting = {}, set()

    def predict(slug):
        if slug in cache:
            return cache[slug]
        if slug in visiting:
            raise ValueError("Cyclic alias")
        visiting.add(slug)
        row = copy.deepcopy(old[slug])
        if slug in absent:
            if any(row[k] is not None for k in ("humpPlacement", "frontFlare", "sideCurvature", "measures")):
                raise ValueError("Run 1 noShell entry must be null")
        else:
            entry = by_slug[slug]
            if row["model"] != entry["model"] or row["path"] != entry["path"]:
                raise ValueError("Run 1 asset identity mismatch")
            if entry.get("aliasOf"):
                source_slug = entry["aliasOf"]
                if source_slug not in by_slug or entry["path"] != by_slug[source_slug]["path"]:
                    raise ValueError("Invalid alias asset")
                source = predict(source_slug)
                measures = copy.deepcopy(source["measures"])
            else:
                measures = measure_shell_gd2(*loader(entry))
                if not np.allclose(measures["dimensionsXYZmm"], entry["dimensionsXYZmm"], atol=.01, rtol=0):
                    raise ValueError("Decoded dimensions differ from manifest")
            measures.update({k: copy.deepcopy(row["measures"][k]) for k in HUMP_MEASURES})
            row["measures"] = measures
            row.update(map_levels_gd2(measures["frontFlareRatio"], measures["sideCurvatureFraction"]))
        cache[slug] = row
        visiting.remove(slug)
        return row

    return [predict(r["slug"]) for r in run1]


def main():
    directory = ROOT / "tools/blender/out/descriptors"
    source = directory / "predictions.json"
    if hashlib.sha256(source.read_bytes()).hexdigest() != RUN1_SHA256:
        raise ValueError("Run 1 predictions hash changed; cannot preserve approved hump")
    run1 = json.loads(source.read_text(encoding="utf-8"))
    manifest_path = ROOT / "public/models/manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["orientationConvention"] != {
        "blender": "Z up, nose +Y, ground Z=0", "gltf": "Y up, nose -Z, ground Y=0"
    }:
        raise ValueError("Unexpected delivered frame")
    for row in run1:
        if row.get("path") and hashlib.sha256(
                (ROOT / "public/models" / row["path"]).read_bytes()).hexdigest() != row["assetSha256"]:
            raise ValueError("Delivered asset differs from Run 1")
    rows = build_predictions_gd2(run1, manifest,
                                 lambda e: decode_shell(ROOT / "public/models" / e["path"]))
    for old, new in zip(run1, rows):
        assert old["humpPlacement"] == new["humpPlacement"]
        if old["measures"] is not None:
            assert all(old["measures"][k] == new["measures"][k] for k in HUMP_MEASURES)
    output = directory / "predictions-gd2.json"
    output.write_text(json.dumps(rows, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    evidence = {
        "protocol": "GD-2 Run 2: in-sample exploratory redesign; validation not executed",
        "run1Sha256": RUN1_SHA256,
        "predictionsSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "codeSha256": {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                       for name in ("descriptor_geometry_gd2.py", "measure_descriptors_gd2.py",
                                    "descriptor_geometry.py", "measure_descriptors.py")},
        "distributions": {field: dict(sorted(Counter(r[field] or "null" for r in rows).items()))
                          for field in ("humpPlacement", "frontFlare", "sideCurvature")},
        "humpCopiedUnchanged": True,
        "opposingWallConflicts": sum(bool(r["measures"] and r["measures"]["opposingWallConflict"]) for r in rows),
    }
    output.with_suffix(".provenance.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
