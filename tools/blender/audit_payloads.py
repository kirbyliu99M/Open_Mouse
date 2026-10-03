"""Read-only size and format audit of the published mouse GLBs."""

from check_catalogues import check_no_shell_assets
from glb_bounds import read_glb_json
import argparse
import io
import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "public" / "models"


def inspect_glb(path: Path, estimate_1024: bool = False) -> dict:
    data = path.read_bytes()
    document = read_glb_json(path)
    json_length = struct.unpack_from("<I", data, 12)[0]
    views = document.get("bufferViews", [])
    images = document.get("images", [])
    image_bytes = sum(views[image["bufferView"]]["byteLength"] for image in images)
    if any(image.get("mimeType") not in ("image/png", "image/jpeg") for image in images):
        raise ValueError(f"Unexpected image format: {path}")
    if "KHR_draco_mesh_compression" not in document.get("extensionsUsed", []):
        raise ValueError(f"Draco compression missing: {path}")
    result = {"path": str(path.relative_to(MODELS)).replace("\\", "/"),
            "bytes": len(data), "imageBytes": image_bytes, "imageCount": len(images),
            "otherBytes": len(data) - image_bytes}
    if estimate_1024:
        if any(image.get("mimeType") != "image/png" for image in images):
            raise ValueError("--estimate-1024 only applies to the historical PNG build")
        from PIL import Image

        bin_header = 20 + json_length
        bin_length, bin_type = struct.unpack_from("<I4s", data, bin_header)
        if bin_type != b"BIN\0" or bin_header + 8 + bin_length != len(data):
            raise ValueError(f"Invalid GLB BIN chunk: {path}")
        bin_start = bin_header + 8
        resized_bytes = 0
        for image in images:
            view = views[image["bufferView"]]
            start = bin_start + view.get("byteOffset", 0)
            with Image.open(io.BytesIO(data[start : start + view["byteLength"]])) as source:
                source.load()
                if max(source.size) > 1024:
                    scale = 1024 / max(source.size)
                    size = tuple(max(1, round(dimension * scale)) for dimension in source.size)
                    source = source.resize(size, Image.Resampling.LANCZOS)
                output = io.BytesIO()
                source.save(output, format="PNG", optimize=True)
                resized_bytes += output.tell()
        result["estimated1024PngBytes"] = resized_bytes
        result["estimated1024TotalBytes"] = result["otherBytes"] + resized_bytes
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--estimate-1024", action="store_true",
                        help="Re-encode embedded images in memory at up to 1024 px; does not alter GLBs")
    args = parser.parse_args()
    manifest = json.loads((MODELS / "manifest.json").read_text(encoding="utf-8"))
    check_no_shell_assets(manifest, MODELS)
    published = sorted(MODELS.rglob("*.glb"))
    records = [inspect_glb(path, args.estimate_1024) for path in published]
    expected = {entry["path"] for entry in manifest["shells"] + manifest["studies"]}
    actual = {entry["path"] for entry in records}
    # The hand is a separate generated asset with no baked product texture.
    if manifest.get("hand") is not None:
        expected.add("hand.glb")
    if actual != expected:
        raise ValueError(f"Manifest mismatch: missing={expected - actual}, extra={actual - expected}")
    keys = ["bytes", "imageBytes", "imageCount", "otherBytes"]
    if args.estimate_1024:
        keys += ["estimated1024PngBytes", "estimated1024TotalBytes"]
    totals = {key: sum(entry[key] for entry in records) for key in keys}
    print(json.dumps({"files": len(records), "totals": totals,
                      "largest": sorted(records, key=lambda entry: entry["bytes"], reverse=True)[:10],
                      "records": records}, indent=2))


if __name__ == "__main__":
    main()
