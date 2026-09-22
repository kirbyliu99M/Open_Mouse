# Source-based mouse reconstruction

The subsequent [colour verification pass](COLOUR-VERIFICATION.md) adds
manufacturer-derived colours/materials while retaining these neutral builds.
Current public GLBs are coloured; neutral comparisons remain below.

Kirby's feedback on 2026-09-22 rejected the first generic parametric shells.
This rebuild starts from the 30 mice in the first-party catalogue snapshot at
`params/reference-catalogue.json`. No licensed fixture was accessed.

## Review artifacts

- `out/reference-library/index.html`: source-linked gallery and rotation archive.
- `out/reconstructed/index.html`: per-model comparisons and GLB/Blender links.
- `out/reconstructed/catalogue-review.blend`: all reconstructed/study meshes.
- `out/reconstructed/<slug>/comparison.png`: matched reference, rebuild and
  outline overlay for each model with a calibrated AR reference.
- `reference-inventory.json`: committed source URLs and coverage inventory.
- `public/models/manifest.json` and `validation.json`: final packaged asset
  provenance and actual exported GLB validation. Visual acceptance is pending.

## What was collected

The archive contains **599 manufacturer gallery image files** for all 30 models,
including colour variants. File count is not a count of unique viewing angles.
An additional **36 first-hand review photograph files** cover the M100, M550 and
M705, credited and linked in each model's `sources.json`. Some are different
resolutions of the same photograph; historical revision and perspective must be
checked before using them as dimensional evidence.

The official product pages expose working public AR models for **26 mice**.
Each was captured at **26 calibrated views**: 16 azimuth positions around a full
rotation, eight elevated positions, top and bottom. This produces **676 RGBA
views and 676 depth images**. These are labelled manufacturer AR renders, not
independently photographed turntables. Original models, textures, downloaded
images, source pages and EXR files remain in ignored `out/reference-library/`.

Four models lack a working official AR reference after checking colour entries
and regional pages: **G Pro X Superlight 2 SE, M100, M550 and M705 Marathon**.
Their own top and side gallery silhouettes were traced into explicitly labelled
limited-view studies. Their transverse curves are interpolated; missing views,
button/wheel details and unseen surfaces remain unverified. They belong in
`public/models/studies/`, not the reconstructed catalogue shell set.

## How the new geometry is constructed

`render_reference_views.py` imports the local manufacturer reference into a
separate background Blender process. It records the camera transforms and
normalises the source to published body dimensions. Wired-model cable extensions
are detected and clipped before that calibration: cables must not shrink the
body when the total reference bounding box is normalised.

`reconstruct_views.py` reads only the resulting images and camera calibration.
It carves a **0.45 mm voxel grid** against silhouettes and visible depth, extracts
a new isosurface, closes small sampling gaps and smooths the result.
`finish_reconstruction.py` decimates to about 14,000 triangles, records the raw
dimension discrepancy, applies the physical dimension constraint and exports
Draco GLB. It does not export the manufacturer's original mesh topology or
textures. These assets are nevertheless explicitly reference-derived.

Seven complex models needed stronger gap closing to eliminate tiny handles or
intersections: ERGO M575, G502 X Lightspeed, G502 X Plus, G703 Lightspeed, G Pro 2
Lightspeed, G Pro X Superlight 2 DEX and G403 Hero. Their individual reports retain
`closingIterations`. Micron-scale decimation slivers are cleaned before export;
GLB round trips are checked independently before packaging.

The output is a **fit mesh**, not a CAD replica or photogrammetric scan. Fine
seams, wheel teeth, logos and textures are absent or softened. Silhouette
agreement does not validate physical curvature everywhere. Source-axis
permutations are recorded; front-direction standardisation for the runtime
still needs review, as manufacturer model coordinate conventions differ.

## Evidence and limits

Final local verification on 2026-09-22: all **30 compressed GLB round trips
passed**, with 13,998–14,000 triangles each, zero reported non-manifold edges,
degenerate faces or non-adjacent triangle intersections. Maximum bbox error
after explicit dimension calibration is **0.00002845 mm**; this is numerical
export precision, not physical measurement accuracy. The five reference
geometry unit tests passed.

Across the 26 AR-derived reconstructions, mean silhouette IoU is **99.272%**.
The worst per-view 95th-percentile boundary distance is **2.106 mm**. These
comparisons use the manufacturer reference renders and do not establish a
physical surface-accuracy gate. The final catalogue was loaded and inspected
in live Blender; the four limited-view studies are amber.

The comparisons cover all 26 calibrated views per AR reconstruction. Metrics
and overlays are in each model's `silhouette-validation.json` and
`out/reconstructed/comparison-summary.json`. Independent gallery top views are
also compared when an unambiguous top image exists; those comparisons normalise
the bounding boxes and are **not perspective-calibrated**. A low result,
particularly for vertical mice, requires manual inspection rather than being
discarded or treated as automatic physical-ground-truth failure.

Final topology, triangle counts, file sizes and bbox errors are read from the
**re-imported compressed GLBs** in `public/models/validation.json`. The source
dimension rescaling is explicit in each report; bbox agreement is therefore a
constraint, not independent proof of resemblance.

Kirby's recognisability review, precise surface-detail refinement, validation
against physical mice, complete angular evidence for the four limited-view
studies, and runtime orientation/fit integration remain open. No M4 acceptance
or successful CI/deployment is claimed. Claude owns `docs/STATUS.md`; this file
provides the Blender-side handoff without editing other agents' paths.

## Reproduction

Use Blender **5.2.2 / Python 3.13** for rendering, construction finishing and
export. Image preprocessing in this session used the existing host Python 3.12
with NumPy/SciPy/Pillow/OpenCV and a local scikit-image install under
`out/python-deps`; dependencies are listed in `requirements.references.txt`.
The numerical preprocessing is separate from bpy and may also run in a Python
3.13 environment with those dependencies installed.

From the repo root:

```powershell
python tools/blender/scrape_references.py
python tools/blender/recover_references.py
python tools/blender/supplement_references.py
$blenderExe = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/render_reference_views.py
python tools/blender/reconstruct_views.py
python tools/blender/reconstruct_gallery.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/finish_reconstruction.py
python tools/blender/compare_reconstruction.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/package_reconstruction.py
python tools/blender/reference_report.py
python tools/blender/review_index.py
python -m unittest discover -s tools/blender/tests -p test_reference_geometry.py
```

Use `--model <slug>` to work on one model. Reconstruction/finishing accept a
comma-separated list. For the seven models above, re-carve with `--closing 3`
before finishing. Capture caches are keyed by `captureVersion` in `cameras.json`;
invalidate that record when changing camera or source-processing logic.

`repair_export_precision.py` is the one-time cleanup of the already built batch;
new builds run the same cleanup directly in the finishing stage. The old
`build_assets.py` and `gen_shell.py` are retained only as rejected prototype and
descriptor-fixture history. Do not run them to overwrite this rebuilt catalogue.
