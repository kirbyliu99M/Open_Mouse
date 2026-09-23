"""Read-only size and format audit of the published mouse GLBs."""

import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "public" / "models"


def inspect_glb(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise ValueError(f"Invalid GLB header: {path}")
    if struct.unpack_from("<I", data, 8)[0] != len(data):
        raise ValueError(f"GLB length mismatch: {path}")
    json_length, json_type = struct.unpack_from("<I4s", data, 12)
    if json_type != b"JSON":
        raise ValueError(f"Missing GLB JSON chunk: {path}")
    document = json.loads(data[20 : 20 + json_length])
    views = document.get("bufferViews", [])
    images = document.get("images", [])
    image_bytes = sum(views[image["bufferView"]]["byteLength"] for image in images)
    if any(image.get("mimeType") != "image/png" for image in images):
        raise ValueError(f"Unexpected image format: {path}")
    if "KHR_draco_mesh_compression" not in document.get("extensionsUsed", []):
        raise ValueError(f"Draco compression missing: {path}")
    return {"path": str(path.relative_to(MODELS)).replace("\\", "/"),
            "bytes": len(data), "imageBytes": image_bytes, "imageCount": len(images),
            "otherBytes": len(data) - image_bytes}


def main() -> None:
    manifest = json.loads((MODELS / "manifest.json").read_text(encoding="utf-8"))
    published = sorted(MODELS.rglob("*.glb"))
    records = [inspect_glb(path) for path in published]
    expected = {entry["path"] for entry in manifest["shells"] + manifest["studies"]}
    actual = {entry["path"] for entry in records}
    # The hand is a separate generated asset with no baked product texture.
    if manifest.get("hand") is not None:
        expected.add("hand.glb")
    if actual != expected:
        raise ValueError(f"Manifest mismatch: missing={expected - actual}, extra={actual - expected}")
    totals = {key: sum(entry[key] for entry in records) for key in ("bytes", "imageBytes", "imageCount", "otherBytes")}
    print(json.dumps({"files": len(records), "totals": totals,
                      "largest": sorted(records, key=lambda entry: entry["bytes"], reverse=True)[:10],
                      "records": records}, indent=2))


if __name__ == "__main__":
    main()
