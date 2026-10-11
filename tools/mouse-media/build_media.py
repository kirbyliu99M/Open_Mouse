#!/usr/bin/env python3
"""Build the committed mouse photo assets and src/data/mouse-media.json.

Inputs live OUTSIDE the repo (see README.md). Nothing from them is copied in:
only the derived WebP files and the JSON are written.
"""
import argparse
import csv
import io
import json
import sys
from pathlib import Path

from PIL import Image

STD_SIZE = (800, 800)
ALPHA_THRESHOLD = 10
MARGIN = 0.02
OUT_HEIGHT = 480
MAX_BYTES = 30 * 1024
QUALITIES = [80, 75, 70, 65, 60]
KIND = {
    "direct_product_page": "product",
    "lineup_page": "brand",
    "support_page": "brand",
}


def key(brand, model):
    return (brand.strip().casefold(), model.strip().casefold())


def encode(img, quality):
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6, exif=b"")
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pics", required=True, type=Path)
    ap.add_argument("--csv", required=True, type=Path)
    ap.add_argument("--catalogue", required=True, type=Path)
    ap.add_argument("--out-images", required=True, type=Path)
    ap.add_argument("--out-json", required=True, type=Path)
    a = ap.parse_args()

    catalogue = json.loads(a.catalogue.read_text(encoding="utf-8"))
    slug_by_key = {key(e["brand"], e["model"]): e["slug"] for e in catalogue}
    if len(slug_by_key) != len(catalogue):
        sys.exit("catalogue has duplicate (brand, model) keys")

    with a.csv.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    seen = {}
    for r in rows:
        k = key(r["brand"], r["model"])
        if k not in slug_by_key:
            sys.exit(f"CSV row without catalogue match: {r['brand']} / {r['model']}")
        if k in seen:
            sys.exit(f"duplicate CSV row: {r['brand']} / {r['model']}")
        seen[k] = r
    missing = [s for k, s in slug_by_key.items() if k not in seen]
    if missing:
        sys.exit(f"catalogue rows without CSV match: {missing}")

    # Choose one image per model.
    chosen = {}  # slug -> Path | None
    for k, r in seen.items():
        slug = slug_by_key[k]
        name = r["hero_image"].strip() or f"{r['image_prefix']}_01.png"
        p = a.pics / name
        if p.is_file():
            with Image.open(p) as im:
                if im.size != STD_SIZE:
                    # A non-standard hero (e.g. a wide callout diagram) cannot
                    # share the crop window: use the standard _01 cut-out.
                    alt = a.pics / f"{r['image_prefix']}_01.png"
                    print(f"{slug}: hero {name} is {im.size}, using {alt.name}")
                    p = alt if alt.is_file() else None
        else:
            p = None
        chosen[slug] = p

    # One shared crop window: union of alpha>threshold boxes plus margin.
    x0 = y0 = 10**9
    x1 = y1 = -1
    size = None
    for slug, p in chosen.items():
        if p is None:
            continue
        with Image.open(p) as im:
            im = im.convert("RGBA")
            if im.size != STD_SIZE:
                sys.exit(f"{p.name}: size {im.size} is not {STD_SIZE}")
            size = im.size
            bbox = im.getchannel("A").point(
                lambda v: 255 if v > ALPHA_THRESHOLD else 0
            ).getbbox()
        if bbox is None:
            sys.exit(f"{p.name}: fully transparent")
        x0, y0 = min(x0, bbox[0]), min(y0, bbox[1])
        x1, y1 = max(x1, bbox[2]), max(y1, bbox[3])
    w, h = size
    mx, my = round((x1 - x0) * MARGIN), round((y1 - y0) * MARGIN)
    window = (max(0, x0 - mx), max(0, y0 - my), min(w, x1 + mx), min(h, y1 + my))
    out_w = round((window[2] - window[0]) * OUT_HEIGHT / (window[3] - window[1]))
    print(f"crop window {window}, output {out_w}x{OUT_HEIGHT}")

    a.out_images.mkdir(parents=True, exist_ok=True)
    lowered = {}
    sizes = []
    media = {}
    for k, r in seen.items():
        slug = slug_by_key[k]
        p = chosen[slug]
        image = None
        if p is not None:
            with Image.open(p) as im:
                im = im.convert("RGBA").crop(window).resize(
                    (out_w, OUT_HEIGHT), Image.LANCZOS
                )
            for q in QUALITIES:
                data = encode(im, q)
                if len(data) <= MAX_BYTES:
                    break
            else:
                sys.exit(f"{slug}: {len(data)} bytes at quality {QUALITIES[-1]}")
            if q != QUALITIES[0]:
                lowered[slug] = (q, len(data))
            (a.out_images / f"{slug}.webp").write_bytes(data)
            sizes.append(len(data))
            image = f"/images/mice/{slug}.webp"
        media[slug] = {
            "officialUrl": r["official_url"].strip(),
            "officialKind": KIND[r["url_type"].strip()],
            "image": image,
        }

    ordered = {s: media[s] for s in sorted(media)}
    a.out_json.parent.mkdir(parents=True, exist_ok=True)
    with a.out_json.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n")

    sizes.sort()
    n = len(sizes)
    kb = lambda b: b / 1024
    print(f"files {n}, total {sum(sizes) / 1048576:.2f} MB")
    print(
        f"p50 {kb(sizes[n // 2]):.1f} KB, p95 {kb(sizes[int(n * 0.95)]):.1f} KB, "
        f"max {kb(sizes[-1]):.1f} KB"
    )
    print("lowered quality:", lowered or "none")
    print("null images:", [s for s, v in ordered.items() if v["image"] is None])


if __name__ == "__main__":
    main()
