# tools/mouse-media

Builds the committed product photos (`public/images/mice/<slug>.webp`) and the
official-link data (`src/data/mouse-media.json`) for the results page.

## Inputs (outside the repo, never committed)

- `mouse_official_urls.csv` with columns `brand, model, official_url, domain,
url_type, image_prefix, image_count, hero_image` (one row per catalogue mouse,
  joined to `src/db/seed/catalogue.json` on brand and model, case-insensitive).
- `Mice Pics/*.png`: 800x800 RGBA cut-outs from the makers' own sites.

The originals and the CSV are not copied into the repo; `*.csv` is gitignored.

## Regenerate

```
python tools/mouse-media/build_media.py \
  --pics "<path>/Mice Pics" --csv "<path>/mouse_official_urls.csv" \
  --catalogue src/db/seed/catalogue.json \
  --out-images public/images/mice --out-json src/data/mouse-media.json
```

Needs Python 3 with Pillow. The script fails if a CSV row has no catalogue match
or the reverse. Slow on purpose (WebP `method=6`): about five minutes.

## Rules

- Image per mouse: `hero_image`, or `<image_prefix>_01.png` when it is blank. A
  hero that is not 800x800 (for example a wide callout diagram) is replaced by
  `<image_prefix>_01.png`; a mouse with no file gets `"image": null`.
- Crop: one window for every image, the union of all alpha > 10 bounding boxes
  plus a 2 % margin, so alignment and relative scale stay consistent. Resized to
  480 px high (width follows), lossy WebP with alpha, quality 80, no EXIF.
- Size budget: at most 30 KB per file (quality steps down 80, 75, 70, 65, 60 until
  it fits) and 10 MB in total. `tests/unit/mouse-media.test.ts` enforces both.
- `officialKind`: `direct_product_page` is `product`; `lineup_page` and
  `support_page` are `brand`.
