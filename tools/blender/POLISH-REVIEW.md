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

Source layers with blended alpha (MX Master 4's clear left/right button
covers; small windows on M720, MX Vertical and Pebble 2) are baked in two
ways. Base colour keeps the blended composite, which is what the reference
shows. Roughness, normal and metallic come from the outer surface with the
sources made opaque. Baked through Cycles transparency, roughness read near 0
and left mirror-like "sticker" patches on MX Master 4's buttons: 17.1% of used
texels had roughness below 0.05, now 0.03%. Only MX Master 4 was re-baked; the
other three changed by 0.3% of texels or less in a diagnostic bake, so they
were left as published. Bakes run at 2048 px and are downsampled for delivery.
Baking directly at 512 px left visible UV seams.

The four gallery studies have their side trace levelled before lofting
(`level_base` in `reconstruct_gallery.py`). Their "profile" photographs are
three-quarter views, so the underside edge rises toward one end. For M100 it
rose 5.9 mm over the mid-length, so the shell touched the desk only at the
nose and its centre of mass sat 24 mm behind the contact footprint. The
removed rise is recorded per study. M100's support margin is now 24.4 mm and
M705's rose from 11.4 to 26.5 mm; SE and M550 moved by less than 0.4 mm.
Levelling assumes a flat base, as iFixit's M100 underside photo shows. It
does not calibrate the side view's perspective.

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
by `package_reconstruction.py --polished`. Packaging and `tests/check_assets.py`
also require each shell to rest on its base: its centre of mass, projected onto
the desk, must lie at least 5 mm inside the footprint of vertices within 0.5 mm
of the ground (`stability.py`, `supportMarginMm`; lowest now M240 at 15.4 mm).
This check fails the previous M100 at −24.1 mm. Measured results are written to
`public/models/validation.json`; source and texture provenance are included in
`public/models/manifest.json`.

The full batch passed those 30 GLB round-trip checks. Maximum bbox difference
after force-scaling to catalogue dimensions was **0.00001894 mm**, with **0 mm
ground offset** on every imported mesh. This is export precision, not independent
evidence of physical dimensional accuracy.
Top, side and bottom contact sheets were visually inspected for all 30 models.
The published set now uses 512 px JPEG maps: 30 mice total **6.70 MiB**,
plus the 158.5 KiB hand (**6.86 MiB** overall). Mouse files range from
74.6 to 384.2 KiB; 4 of 30 meet the original 100 KiB target. All mouse
meshes remain at 13,998–14,000 triangles. This is a payload measurement,
not a mobile loading or texture-quality acceptance test.

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
