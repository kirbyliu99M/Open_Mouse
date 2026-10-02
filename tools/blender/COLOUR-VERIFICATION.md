# Colour and finish pass — 2026-09-22

Superseded for current delivery by the [polished texture and orientation pass](POLISH-REVIEW.md).
This file records the earlier vertex-colour iteration.

Kirby approved the appearance of the reconstructed models and requested more
realistic web-based colours. The colour catalogue is saved at
`out/colored/catalogue-review.blend` and loaded in the live Blender scene
`Open_Mouse_Colour_Review`. Source comparisons for all 30 models are at
`out/colored/index.html`. Neutral builds and their silhouette evidence remain
under `out/reconstructed/`.

## Sources and method

For 26 models, `color_reconstruction.py` samples the official AR reference's
base colour, roughness and metallic maps, using the original reconstruction
calibration and nearest source surface. The colourway follows the downloaded
reference filename: for example Superlight 2 off-white, G203 blue, MX Master 3S
graphite, and Pebble/POP rose. It does not assume every product has one colour.
Source URLs and hashes are retained in each `colourVerification` record.

The manufacturer pages were checked again for
[Superlight 2](https://www.logitechg.com/en-us/shop/p/pro-x2-superlight-wireless-mouse),
[G203](https://www.logitechg.com/en-us/shop/p/g203-lightsync-rgb-gaming-mouse),
[MX Master 3S](https://www.logitech.com/en-us/shop/p/mx-master-3s) and
[M550](https://www.logitech.com/en-us/shop/p/m550-signature-wireless-mouse).
Current page defaults can differ from the archived AR colourway; selected
variant provenance is the downloaded model, not the page's current default.

The four gallery studies use approximate, model-specific shell palettes:
Superlight 2 SE red, M100 charcoal, M550 graphite and M705 charcoal. Their
component colours and missing details remain unverified. The review page links
each model to its own manufacturer gallery/page.

The base colour is sampled into linear vertex colours, with explicit sRGB
conversion. Roughness and metallic values are grouped into material slots.
Manufacturer colour information is now present in these derivative assets;
the earlier neutral-pass statement that no source textures/colour were used
does not describe this pass. Original image texture files and original mesh
topology are not embedded in the new GLBs.

## Verification

- All 30 source meshes had exactly unchanged vertex positions during colouring.
- All 30 compressed GLBs passed re-imported topology and dimension checks.
- Each exported material primitive includes `COLOR_0`.
- 13,998–14,000 triangles per mesh; combined GLBs approximately 2.61 MiB.
- Maximum calibrated bounding-box discrepancy: 0.00002845 mm. This is export
  precision, not independently measured physical accuracy.
- Three Blender/Python 3.13 tests pass: sRGB conversion, UV interpolation with
  roughness/metallic channel separation, and constant material fallback.
- All three catalogue contact sheets and the live material-preview scene were
  visually inspected. Individual pilot renders were also inspected closely.

## Remaining visual limits

This is a first material pass. Vertex sampling blurs small logos and can produce
jagged material boundaries. Quantized finishes and missing normal maps make
some wheel and grip regions look smoother or glossier than the reference.
Closed recesses do not always correspond closely to a source surface; transfer
distances are recorded per model (the largest nearest-surface distance is
11.13 mm). These values are diagnostics, not a claimed physical-accuracy score.
Fine-detail texture baking and material-boundary cleanup remain useful future
refinements. No calibrated physical colour measurement or final M4 gate is
claimed.

## Reproduce

```powershell
$blenderExe = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/color_reconstruction.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/package_reconstruction.py -- --colored
python tools/blender/color_review.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/tests/test_colour_sampling_blender.py
```

`color_reconstruction.py --model <slug>` supports individual or comma-separated
models. Packaging validates the complete catalogue before replacing public
shell/study GLBs. The neutral source meshes remain available for comparison.
