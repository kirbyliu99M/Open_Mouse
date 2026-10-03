"""Local-only GD-1 measurement CLI. Never reads the private validation fixture.

Install requirements.descriptors.txt in an ignored Python 3.13 venv. DracoPy is
imported only by the GLB adapter, not by pure maths or ordinary unit tests.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np

from descriptor_geometry import map_levels, measure_shell, validate_mesh_arrays
from glb_bounds import read_glb_json

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ("humpPlacement", "frontFlare", "sideCurvature")


def frame_caution(source_url):
    """Advisory only: special grip frames named by our first-party product URL."""
    path = source_url.lower()
    return "trackball" if "trackball" in path else "vertical" if "vertical" in path else None


def decode_shell(path):
    """Read our static identity-node Draco GLBs; fail on unsupported scene data.

    POSITION is selected by the glTF extension's Draco unique attribute ID,
    never an assumed attribute ordering. All material primitives are combined.
    This deliberately does not attempt to be a general-purpose glTF importer.
    """
    import DracoPy

    path = Path(path)
    document = read_glb_json(path)
    if (document.get("animations") or len(document.get("scenes", [])) != 1
            or document.get("scene", 0) != 0 or len(document.get("nodes", [])) != 1
            or document["scenes"][0].get("nodes") != [0]):
        raise ValueError(f"Expected a single static shell scene: {path}")
    node = document["nodes"][0]
    if (set(node) - {"mesh", "name"} or node.get("mesh") != 0
            or len(document.get("meshes", [])) != 1):
        raise ValueError(f"Expected a single identity shell node: {path}")
    blob = path.read_bytes()
    json_size = struct.unpack_from("<I", blob, 12)[0]
    bin_start = 28 + json_size
    bin_size, bin_kind = struct.unpack_from("<I4s", blob, bin_start - 8)
    if bin_kind != b"BIN\0" or bin_start + bin_size != len(blob):
        raise ValueError(f"Invalid GLB binary chunk: {path}")
    vertices, faces, offset = [], [], 0
    for primitive in document["meshes"][0]["primitives"]:
        if primitive.get("mode", 4) != 4 or primitive.get("targets"):
            raise ValueError(f"Expected static triangle primitives: {path}")
        extension = primitive.get("extensions", {}).get("KHR_draco_mesh_compression")
        if extension is None:
            raise ValueError(f"Missing Draco compression: {path}")
        view = document["bufferViews"][extension["bufferView"]]
        start, size = view.get("byteOffset", 0), view["byteLength"]
        if view.get("buffer", 0) != 0 or start < 0 or size <= 0 or start + size > bin_size:
            raise ValueError(f"Invalid Draco buffer view: {path}")
        decoded = DracoPy.decode(blob[bin_start + start:bin_start + start + size])
        attribute = decoded.get_attribute_by_unique_id(extension["attributes"]["POSITION"])
        if attribute is None:
            raise ValueError(f"Missing decoded POSITION: {path}")
        positions, triangles = validate_mesh_arrays(attribute["data"], decoded.faces)
        accessor = document["accessors"][primitive["attributes"]["POSITION"]]
        if accessor["count"] != len(positions) or accessor["type"] != "VEC3":
            raise ValueError(f"Decoded POSITION count/type mismatch: {path}")
        if not (np.allclose(positions.min(axis=0), accessor["min"], atol=1e-6, rtol=0)
                and np.allclose(positions.max(axis=0), accessor["max"], atol=1e-6, rtol=0)):
            raise ValueError(f"Decoded POSITION bounds mismatch: {path}")
        vertices.append(positions[:, [0, 2, 1]] * np.array([1000., -1000., 1000.]))
        faces.append(triangles + offset)
        offset += len(positions)
    if not vertices:
        raise ValueError(f"No shell triangles: {path}")
    return np.concatenate(vertices), np.concatenate(faces)


def build_predictions(manifest, catalogue, loader):
    """Route shells/studies/aliases/nulls with an injected vertex loader.

    Catalogue supplies our public product names/source URLs only; no existing
    descriptor labels are consumed. Kept separate from filesystem I/O for tests.
    """
    delivered = manifest["shells"] + manifest["studies"]
    by_slug = {e["slug"]: e for e in delivered}
    no_shell = {e["slug"]: e for e in manifest["noShell"]}
    if (len(by_slug) != len(delivered) or len(no_shell) != len(manifest["noShell"])
            or by_slug.keys() & no_shell.keys()
            or by_slug.keys() | no_shell.keys() != catalogue.keys()):
        raise ValueError("Manifest must cover catalogue exactly once")
    studies = {e["slug"] for e in manifest["studies"]}
    cache, visiting = {}, set()

    def predict(slug):
        if slug in cache:
            return cache[slug]
        if slug in visiting:
            raise ValueError("Cyclic shell alias")
        visiting.add(slug)
        model = catalogue[slug]
        record = {"model": model["model"], "slug": slug,
                  "frameCaution": frame_caution(model.get("sourceUrl", ""))}
        if slug in no_shell:
            record.update({field: None for field in FIELDS})
            record.update(measures=None, confidence="none", reason=no_shell[slug]["reason"])
        else:
            entry = by_slug[slug]
            if entry.get("model") != model["model"]:
                raise ValueError(f"Manifest/catalogue name mismatch: {slug}")
            if entry.get("aliasOf"):
                source_slug = entry["aliasOf"]
                if source_slug not in by_slug or entry["path"] != by_slug[source_slug]["path"]:
                    raise ValueError(f"Alias must reference the source asset: {slug}")
                source = predict(source_slug)
                record.update({field: source[field] for field in FIELDS})
                record.update(measures=source["measures"], confidence=source["confidence"],
                              aliasOf=source_slug, path=source["path"])
            else:
                vertices, faces = loader(entry)
                measures = measure_shell(vertices, faces)
                if not np.allclose(measures["dimensionsXYZmm"], entry["dimensionsXYZmm"],
                                   atol=.01, rtol=0):
                    raise ValueError(f"Decoded dimensions differ from manifest: {slug}")
                record.update(map_levels(measures["humpPeakFraction"],
                                         measures["frontFlareRatio"],
                                         measures["sideCurvatureFraction"]))
                record.update(measures=measures, confidence="lower" if slug in studies else "reconstructed",
                              path=entry["path"])
        cache[slug] = record
        visiting.remove(slug)
        return record

    return [predict(e["slug"]) for e in delivered + manifest["noShell"]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "tools/blender/out/descriptors/predictions.json")
    args = parser.parse_args()
    output = args.output.resolve()
    allowed = (ROOT / "tools/blender/out/descriptors").resolve()
    if not output.is_relative_to(allowed):
        raise ValueError("GD-1 outputs must stay in ignored tools/blender/out/descriptors/")
    manifest_path = ROOT / "public/models/manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["orientationConvention"] != {
        "blender": "Z up, nose +Y, ground Z=0", "gltf": "Y up, nose -Z, ground Y=0"
    }:
        raise ValueError("Unexpected delivered frame")
    from check_catalogues import slug
    catalogue_rows = json.loads((ROOT / "src/db/seed/logitech.json").read_text(encoding="utf-8"))
    catalogue = {slug(row): {k: row[k] for k in ("model", "sourceUrl") if k in row}
                 for row in catalogue_rows}
    records = build_predictions(manifest, catalogue,
                                lambda e: decode_shell(ROOT / "public/models" / e["path"]))
    for record in records:
        if record.get("path"):
            record["assetSha256"] = hashlib.sha256(
                (ROOT / "public/models" / record["path"]).read_bytes()).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(records, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    evidence = {
        "protocol": "GD-1 run 1, fixed thresholds",
        "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "predictionsSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "mathSha256": hashlib.sha256(Path(__file__).with_name("descriptor_geometry.py").read_bytes()).hexdigest(),
        "decoderSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "counts": {"products": len(records), "predicted": sum(r["measures"] is not None for r in records),
                   "null": sum(r["measures"] is None for r in records),
                   "lowerConfidence": sum(r["confidence"] == "lower" for r in records),
                   "aliases": sum("aliasOf" in r for r in records)},
    }
    output.with_suffix(".provenance.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    print(f"Wrote {output}; no validation executed.")


if __name__ == "__main__":
    main()
