"""Archive manufacturer gallery images and public AR assets for local reference.

No guessed image names: every asset path must occur on its product page.
Original manufacturer media stays in ignored out/reference-library/.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import urllib.parse
import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE / "out/reference-library"


def slugify(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def fetch(url, path):
    if path.exists() and path.stat().st_size:
        return path.read_bytes()
    response = requests.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0 (reference collection)", "Accept": "*/*"})
    response.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(response.content)
    return response.content


def archive(model):
    slug = slugify(model["brand"] + " " + model["model"])
    result = {**model, "slug": slug, "retrievedAt": datetime.now(timezone.utc).isoformat(), "images": [], "arModels": [], "errors": []}
    try:
        page = fetch(model["sourceUrl"], ROOT / "pages" / (slug + ".html")).decode("utf-8")
        page = html.unescape(page.replace(r"\/", "/"))
        paths = list(dict.fromkeys(re.findall(r'/content/dam/[^\s"<>\\,;()]+?\.(?:png|jpg|jpeg|webp|glb)', page, re.I)))
        galleries = [p for p in paths if "gallery" in p.lower()]
        # Gallery assets from the current product share its first gallery root.
        if galleries:
            first = galleries[0]
            if "/products/" in first:
                prefix, suffix = first.split("/products/", 1)
                parts = suffix.split("/")
                depth = 2 if parts[0] in {"mice", "combos", "keyboards"} else 1
                product_root = prefix + "/products/" + "/".join(parts[:depth]) + "/"
                galleries = [p for p in galleries if p.startswith(product_root)]
        host = "resource.logitechg.com" if "logitechg.com" in model["sourceUrl"] else "resource.logitech.com"
        for path in galleries:
            url = "https://" + host + path
            destination = ROOT / slug / Path(path).name
            try:
                data = fetch(url, destination)
                with Image.open(destination) as image:
                    width, height = image.size
                    mode = image.mode
                result["images"].append({"url": url, "file": destination.relative_to(ROOT).as_posix(),
                    "width": width, "height": height, "mode": mode, "sha256": hashlib.sha256(data).hexdigest(),
                    "viewHint": view_hint(path)})
            except Exception as error:
                result["errors"].append({"url": url, "error": str(error)})
        ar_paths = [p for p in paths if p.lower().endswith(".glb")]
        # One colour variant is sufficient for complete geometric rotation.
        if ar_paths:
            path = ar_paths[0]
            url = "https://" + host + path
            destination = ROOT / slug / Path(path).name
            try:
                data = fetch(url, destination)
                if data[:4] != b"glTF":
                    raise ValueError("Not a GLB")
                result["arModels"].append({"url": url, "file": destination.relative_to(ROOT).as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            except Exception as error:
                result["errors"].append({"url": url, "error": str(error)})
        result["viewHints"] = sorted(set(image["viewHint"] for image in result["images"]))
    except Exception as error:
        result["errors"].append({"url": model["sourceUrl"], "error": str(error)})
    destination = ROOT / slug / "sources.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(slug, "images", len(result["images"]), "AR",len(result["arModels"]), "errors",len(result["errors"]), flush=True)
    return result


def view_hint(path):
    name = Path(path).stem.lower()
    for token, label in [("lifestyle","lifestyle"),("in-use","lifestyle"),("bottom","bottom"),("underside","bottom"),
        ("profile-left","left"),("profile-right","right"),("side-left","left"),("side-right","right"),
        ("top","top"),("front","front"),("back","rear"),("rear","rear"),("angle","oblique")]:
        if token in name:
            return label
    return "unclassified"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalogue", type=Path, default=HERE / "params/reference-catalogue.json")
    parser.add_argument("--model")
    args = parser.parse_args()
    catalogue = json.loads(args.catalogue.read_text(encoding="utf-8-sig"))
    if args.model:
        catalogue = [p for p in catalogue if args.model.lower() in p["model"].lower()]
    ROOT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(archive, catalogue))
    (ROOT / "index.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print("TOTAL", len(results), "models", sum(len(p["images"]) for p in results), "images",sum(bool(p["arModels"]) for p in results), "AR models", flush=True)


if __name__ == "__main__":
    main()
