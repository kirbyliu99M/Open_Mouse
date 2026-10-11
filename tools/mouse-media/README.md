# tools/mouse-media

Builds the committed product photos (`public/images/mice/<slug>.webp`, plus the
enlarged `public/images/mice/l/<slug>.webp`) and the official-link data (`src/data/mouse-media.json`) for the results page.

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
or the reverse. Slow on purpose (WebP `method=6`): about seven minutes.

Add `--out-large public/images/mice/l` to write the enlarged files in the same
run, after the 480 px ones. To encode only the enlarged files (the 480 px files
and the JSON stay untouched; the same chosen image and crop window are used), add
`--only-large` as well:

```
python tools/mouse-media/build_media.py   --pics "<path>/Mice Pics" --csv "<path>/mouse_official_urls.csv"   --catalogue src/db/seed/catalogue.json   --out-images public/images/mice --out-json src/data/mouse-media.json   --out-large public/images/mice/l --only-large
```

`--only-large` still needs `--out-images` and `--out-json` (they are required
arguments) but writes to neither. Method 6 at 960 px is slower than the 480 px
run. The script stops if a file is still over 70 KB at quality 60, or if the
total is over 30 MB.

To rewrite only the JSON (no cropping or encoding), add `--only-json`. It also
checks that the WebP files in `--out-images` are exactly the ones the rule says
should exist, so it can confirm that a hand edit matches a fresh run.

## Rules

- Image per mouse: `hero_image`. A row with `image_count` 0 has no photo
  (`"image": null`, no WebP): a `<image_prefix>_01.png` found for it is another
  model's photo, so it is never used as a fallback. A hero that is not 800x800
  (for example a wide callout diagram) is replaced by `<image_prefix>_01.png`.
- Crop: one window for every image, the union of all alpha > 10 bounding boxes
  plus a 2 % margin, so alignment and relative scale stay consistent. Resized to
  480 px high (width follows), lossy WebP with alpha, quality 80, no EXIF.
- Size budget: at most 30 KB per file (quality steps down 80, 75, 70, 65, 60 until
  it fits) and 10 MB in total. `tests/unit/mouse-media.test.ts` enforces both.
- Enlarged photo (click to enlarge): the same chosen image and the same crop
  window, so the aspect ratio is the same, 960 px high (1109 wide), lossy
  WebP with alpha, no EXIF. Quality steps 80, 75, 70, 65, 60 until a file is at
  most 70 KB; at most 30 MB in total. `src/data/mouse-media.json` keeps the 480 px
  path in `image`; `largePhotoPath` in `src/lib/results/mouseMedia.ts` derives the
  enlarged path from it. `tests/unit/mouse-media.test.ts` checks that every photo
  has one, no stray file, both budgets, and the header size.
- `officialKind`: `direct_product_page` is `product`; `lineup_page` and
  `support_page` are `brand`.
