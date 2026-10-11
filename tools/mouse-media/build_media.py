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
LARGE_HEIGHT = 960
LARGE_MAX_BYTES = 70 * 1024
LARGE_TOTAL_BYTES = 30 * 1024 * 1024
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


def crop_window(chosen):
    """One shared crop window: union of alpha>threshold boxes plus margin."""
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
    return (max(0, x0 - mx), max(0, y0 - my), min(w, x1 + mx), min(h, y1 + my))


def encode_to_budget(im, slug, max_bytes):
    for q in QUALITIES:
        data = encode(im, q)
        if len(data) <= max_bytes:
            return q, data
    sys.exit(f"{slug}: {len(data)} bytes at quality {QUALITIES[-1]}")


def report(label, sizes, lowered):
    sizes = sorted(sizes)
    n = len(sizes)
    kb = lambda b: b / 1024
    print(f"{label}files {n}, total {sum(sizes) / 1048576:.2f} MB")
    print(
        f"{label}p50 {kb(sizes[n // 2]):.1f} KB, "
        f"p95 {kb(sizes[int(n * 0.95)]):.1f} KB, max {kb(sizes[-1]):.1f} KB"
    )
    print(f"{label}lowered quality:", lowered or "none")


def build_large(a, seen, slug_by_key, chosen, window):
    """Encode the enlarged files: the same window, LARGE_HEIGHT px high."""
    out_w = round((window[2] - window[0]) * LARGE_HEIGHT / (window[3] - window[1]))
    print(f"large output {out_w}x{LARGE_HEIGHT}")
    a.out_large.mkdir(parents=True, exist_ok=True)
    lowered = {}
    sizes = []
    for k in seen:
        slug = slug_by_key[k]
        p = chosen[slug]
        if p is None:
            continue
        with Image.open(p) as im:
            im = im.convert("RGBA").crop(window).resize(
                (out_w, LARGE_HEIGHT), Image.LANCZOS
            )
        q, data = encode_to_budget(im, slug, LARGE_MAX_BYTES)
        if q != QUALITIES[0]:
            lowered[slug] = (q, len(data))
        (a.out_large / f"{slug}.webp").write_bytes(data)
        sizes.append(len(data))
    report("large ", sizes, lowered)
    if sum(sizes) > LARGE_TOTAL_BYTES:
        sys.exit(f"large total {sum(sizes)} bytes is over {LARGE_TOTAL_BYTES}")


def write_json(a, seen, slug_by_key, chosen):
    media = {}
    for k, r in seen.items():
        slug = slug_by_key[k]
        media[slug] = {
            "officialUrl": r["official_url"].strip(),
            "officialKind": KIND[r["url_type"].strip()],
            "image": None if chosen[slug] is None else f"/images/mice/{slug}.webp",
        }
    ordered = {s: media[s] for s in sorted(media)}
    a.out_json.parent.mkdir(parents=True, exist_ok=True)
    with a.out_json.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n")
    return ordered


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pics", required=True, type=Path)
    ap.add_argument("--csv", required=True, type=Path)
    ap.add_argument("--catalogue", required=True, type=Path)
    ap.add_argument("--out-images", required=True, type=Path)
    ap.add_argument("--out-json", required=True, type=Path)
    ap.add_argument(
        "--only-json",
        action="store_true",
        help="write the JSON only; do not crop or encode, and require every "
        "non-null image to exist already in --out-images and no other WebP to",
    )
    ap.add_argument(
        "--out-large",
        type=Path,
        help="also write the enlarged (960 px high) files here, one per photo, "
        "from the same chosen image and crop window",
    )
    ap.add_argument(
        "--only-large",
        action="store_true",
        help="encode only the enlarged files into --out-large: leave --out-images "
        "and --out-json untouched",
    )
    a = ap.parse_args()
    if a.only_large and a.only_json:
        ap.error("--only-large and --only-json cannot be combined")
    if a.only_large and a.out_large is None:
        ap.error("--only-large needs --out-large")

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
        if int(r["image_count"]) == 0:
            # The maker lists no photo for this model: any <prefix>_01.png in
            # the pics folder is another model's photo, so there is no image.
            chosen[slug] = None
            continue
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

    if a.only_json:
        want = {f"{s}.webp" for s, p in chosen.items() if p is not None}
        have = {f.name for f in a.out_images.glob("*.webp")}
        if want != have:
            sys.exit(
                f"WebP files differ from the rule: missing {sorted(want - have)}, "
                f"extra {sorted(have - want)}"
            )
        write_json(a, seen, slug_by_key, chosen)
        print(f"json only: {len(want)} images, {len(chosen) - len(want)} null")
        return

    window = crop_window(chosen)
    out_w = round((window[2] - window[0]) * OUT_HEIGHT / (window[3] - window[1]))
    print(f"crop window {window}, output {out_w}x{OUT_HEIGHT}")

    if a.only_large:
        build_large(a, seen, slug_by_key, chosen, window)
        return

    a.out_images.mkdir(parents=True, exist_ok=True)
    lowered = {}
    sizes = []
    media = {}
    for k, r in seen.items():
        slug = slug_by_key[k]
        p = chosen[slug]
        if p is not None:
            with Image.open(p) as im:
                im = im.convert("RGBA").crop(window).resize(
                    (out_w, OUT_HEIGHT), Image.LANCZOS
                )
            q, data = encode_to_budget(im, slug, MAX_BYTES)
            if q != QUALITIES[0]:
                lowered[slug] = (q, len(data))
            (a.out_images / f"{slug}.webp").write_bytes(data)
            sizes.append(len(data))

    ordered = write_json(a, seen, slug_by_key, chosen)

    report("", sizes, lowered)
    print("null images:", [s for s, v in ordered.items() if v["image"] is None])

    if a.out_large is not None:
        build_large(a, seen, slug_by_key, chosen, window)


if __name__ == "__main__":
    main()
