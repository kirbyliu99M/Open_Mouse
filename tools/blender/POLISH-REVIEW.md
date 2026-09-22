# Model refinement and canonical orientation

Requested by Kirby after the first colour pass. The deliverable is
`out/polished/catalogue-review.blend`, with individual Blender/GLB files and
four-view renders under `out/polished/<slug>/`. The review browser is
`out/polished/index.html`. Earlier neutral and vertex-coloured versions remain
available under `out/reconstructed/` and `out/colored/`.

## Common frame

Blender uses **Z up, nose +Y, base at Z=0**, in metres. Standard glTF export
converts this to **Y up, nose −Z, base at Y=0**. Each mesh is centred across
its width and length. The catalogue display uses translations only, so the
models actually sit on the desk instead of being tilted for presentation.

The reference top views were inspected to identify each model's nose. Lift and
MX Vertical had ambiguous, nearly equal width/height dimensions that caused
the earlier axis inference to swap the physical upright direction. This pass
corrects those axes and recalibrates to published dimensions. Their angled
ergonomic buttons retain their real position; they are not flattened into
ordinary horizontal mice. Gallery-loft coordinate handedness is corrected
without mirroring the printed logos. Every orientation transform is retained
in the per-model `orientation` report.

## Texture refinement

The 26 AR-supported models now have a UV atlas and **2048 × 2048 colour,
roughness, metallic and tangent-normal maps** baked from the calibrated official
reference onto the reconstructed geometry. This replaces vertex-sampled colour
and per-face finish buckets. It improves button seams, wheel tread, logos,
grip texture and colour transitions. Normal strength is 0.65 to keep the
surface relief restrained. These maps are manufacturer-derived appearances;
they are not independent scans or measured reflectance data.

The four gallery-only studies now project their own model's top image onto the
upper shell and use matching matte sides and a matte underside. This makes their buttons, wheel and markings
visible, but the photograph contains lighting and the projected details are
not independently reconstructed 3D components. They remain explicitly limited
studies, not full-detail replicas.

The rebuilt topology is retained. No original manufacturer's mesh is exported.
Some sealed recesses and tiny details still differ from the reference; texture
baking improves their appearance without claiming to replace missing physical
geometry. RGB colours are static; animated illumination is not implemented.

## Verification and reproduction

`tests/test_polish_orientation_blender.py` checks nose reversal, vertical-axis
correction, ground placement, preserved dimensions and outward normals after
the gallery-coordinate reflection. All three tests passed in Blender 5.2.2 /
Python 3.13. The final compressed GLBs are re-imported and checked for topology,
dimension tolerance, ground placement, UVs and embedded texture availability
by `package_reconstruction.py --polished`. Measured results are written to
`public/models/validation.json`; source and texture provenance are included in
`public/models/manifest.json`.

The full batch passed those 30 GLB round-trip checks. Maximum calibrated bbox
error was **0.00001894 mm**, with **0 mm ground offset** on every imported mesh.
Top, side and bottom contact sheets were visually inspected for all 30 models.
The 2K textures increase download size substantially over the earlier flat
materials (about 116 MiB for the full catalogue); the original lightweight
neutral/vertex-coloured versions remain available locally. These are review
assets, and the frontend owner should assess loading/compression before using
the full catalogue in a browser.

```powershell
$blenderExe = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
python tools/blender/prepare_gallery_texture.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/polish_reconstruction.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/package_reconstruction.py -- --polished
python tools/blender/polish_review.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/tests/test_polish_orientation_blender.py
```

Review all top, side and underside overview sheets before accepting the batch.
No physical-scan accuracy, final milestone acceptance, CI or deployment claim
is implied by the local geometry and export checks.
