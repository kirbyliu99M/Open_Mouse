# Blender assets — M4a

**This first parametric batch was rejected for insufficient resemblance.**
The current deliverable is the [polished catalogue](POLISH-REVIEW.md):
base down, nose +Y in Blender / -Z in glTF, with baked reference textures.
It extends the [source-based rebuild](REFERENCE-REBUILD.md), with
downloaded per-model references, image-derived geometry and comparison overlays.
The commands and evidence below describe the superseded prototype only.

## Add a mouse to the current catalogue

1. Add its manufacturer dimensions and source URLs to
   `params/reference-catalogue.json` **and** `src/db/seed/logitech.json`.
   Keep the brand/model-derived slug and L/W/H identical; run
   `python tools/blender/check_catalogues.py` to verify both catalogues.
2. Capture its reference source in the ignored `out/reference-library/`.
   For an AR source, run `render_reference_views.py`, `reconstruct_views.py`,
   `finish_reconstruction.py`, and `compare_reconstruction.py`. For a limited
   gallery study, add its two source image names to `reconstruct_gallery.py`
   and run that before `finish_reconstruction.py`.
3. Check orientation in `polish_reconstruction.py`: its `REVERSE` set rotates
   named models 180 degrees; Lift Vertical and MX Vertical use the `axis_fix`
   width/height correction. Add a new model to either rule when its reference
   views require it. The four limited-view studies also have explicit lists in
   `reconstruct_gallery.py` (`CHOICES`), `polish_reconstruction.py` (gallery
   reflection and side colours), `color_reconstruction.py` (palettes), and
   `prepare_gallery_texture.py` (crop exception and palettes). Update all
   relevant lists together for another gallery study.
4. Run `polish_reconstruction.py -- --model <slug>`, then
   `package_reconstruction.py -- --polished`. Packaging checks catalogue slugs
   against the reconstructed models; no model count is hard-coded.
5. After `npm ci`, run `python tools/blender/optimize_glbs.py` to deliver 512 px JPEG maps
   from the ignored, lossless `out/polished/<slug>/<slug>.glb` source files,
   then run `optimize_glbs.py --check` and the background Blender
   `tests/check_assets.py` gate. Review the silhouette and texture.

JPEG is a core glTF image format handled by three.js GLTFLoader without a
texture decoder extension. These files still use Draco geometry, which needs
its own decoder in the viewer.

## Superseded prototype

First authoring batch for issue #7: three procedural shells and one rigged hand.
Kirby authorised construction alongside the earlier milestones on 2026-09-22.
Work is restricted to this directory and generated `public/models/` assets.

## Outputs

- `public/models/shells/logitech-g-pro-x-superlight-2.glb`
- `public/models/shells/logitech-g305-lightspeed.glb`
- `public/models/shells/logitech-g703-lightspeed.glb`
- `public/models/hand.glb`: one skin, 21 bones named `mp_0` through `mp_20`.
- `public/models/manifest.json`: dimensions, provenance, topology and rig evidence.
- `public/models/validation.json`: descriptor fixtures and compressed round trips.
- `out/assets.blend`: original meshes and armature, at metric authoring coordinates.
- `out/review.blend`: source assets plus separate shell and hand review scenes.
- `out/contact-sheet.png`, `out/hand-review.png`: visually inspected previews.

These are **provisional authored fit proxies**, not approved catalogue replicas.
Dimensions come from the first-party pages linked in `models.ts`; descriptors
are manual authoring choices. Reference images stay in ignored `out/references/`
and are not distributed as textures. No private dataset was read.

The hand is an original Skin/subdivision mesh with a palm volume union, voxel
remesh, closed wrist cap and deterministic four-bone weights. Its rest pose is
flat, palm down. Its dimensions are an authored neutral template, **not a sourced
population median**; runtime measurement scaling is required. Bone `mp_i` ends
at landmark i; `mp_0` ends at the wrist and begins 25 mm behind it.

Authoring axes: metres, X width, Y front-to-back, Z up; shell front is negative Y.
GLB uses standard Y-up conversion: X width, Y height, Z front/back, front +Z.
Shell origins are centered in plan, bottom at zero. Hand origin is the wrist;
fingertips point along authoring +Y, hence GLB -Z.

## Build and check

Use the installed **Blender 5.2.2 / Python 3.13**, or the pinned bpy wheel.
From the repository root, after `npm ci`:

```powershell
node --import tsx tools/blender/export-parameters.ts
node node_modules/vitest/vitest.mjs run --config tools/blender/vitest.config.ts
$blenderExe = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
$blenderPython = 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe'
& $blenderPython -m unittest discover -s tools/blender/tests -p test_geometry.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/build_assets.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python tools/blender/tests/check_assets.py
& $blenderExe --background tools/blender/out/assets.blend --python-exit-code 1 --python tools/blender/preview.py
```

For one shell, append `-- --model logitech-g305-lightspeed` to the preview command.
The pure TypeScript mapping consumes the shared descriptor types. Synthetic
fixtures in `params/coverage.ts` cover all hump, flare and side-curvature levels,
all shapes, both handed directions, ambidextrous compatibility and both rests.

Generation lofts sections, subdivides and decimates, cuts button grooves, wheel
pockets and ergonomic thumb relief, cleans micron-scale boolean slivers and
triangulates before export. Draco positions use 24-bit quantisation: the default
14-bit setting introduced intersections around very small seam triangles.
The check reimports the actual GLBs and tests them again. Normal/material seam
duplicates are welded within 0.0001 mm in a temporary validation mesh.

Build in a separate background process. Do not reset a user's live scene.
The live review scene can be appended from `out/review.blend` without replacing
the original scene. `preflight.py` remains an independent toolchain smoke test.

## Measured evidence — 2026-09-22

| Shell                | Triangles, including wheel | GLB bytes | Source bbox error, mm | GLB round-trip error, mm |
| -------------------- | -------------------------: | --------: | --------------------: | -----------------------: |
| G Pro X Superlight 2 |                     11,738 |    73,188 |           0.000002027 |              0.000014901 |
| G305 Lightspeed      |                     11,856 |    75,324 |           0.000001562 |              0.000011176 |
| G703 Lightspeed      |                     12,212 |    79,064 |           0.000003695 |              0.000007451 |

The numbers above measure force-scaled prototype export precision, not independent
physical or silhouette accuracy.

All 20 synthetic fixtures pass the 0.5 mm bbox and 15k triangle limits
(largest fixture: 12,106 triangles). All source and imported meshes report zero
non-manifold edges, degenerate faces and non-adjacent triangle intersection pairs.
Shell/wheel assembly surface intersections: zero for fixtures and exports.

Hand: 22,718 triangles, 162,260 bytes, 21 exported joints, no unweighted vertices;
maximum source weight-sum error 0.0000000522. The hand is not subject to the shell's
15k budget. TypeScript tests: 9 passed; Python geometry tests: 4 passed across
23 parameter sets. Typecheck and scoped ESLint pass.

## Remaining acceptance work / orchestrator handoff

- These three models are an initial review batch, not completion of the 30-model
  catalogue. Consume approved M1 descriptors when they land, and handle vertical
  and trackball form factors separately; the horizontal generator rejects
  height/length above 0.55 instead of inventing an inappropriate shell.
- Kirby's recognisability review remains pending. Numeric bbox agreement alone
  does not establish silhouette fidelity or fit accuracy.
- Source a median-adult segment-length reference before calling the canonical
  hand anthropometrically validated. Current template is explicitly authored.
- `workflow-dispatch.yml` is a handoff template, not an active or CI-tested action.
  Claude owns `.github/` and should install/review it there. This keeps bpy out of
  default CI and respects the revised Blender-only ownership boundary.
- Claude owns `docs/STATUS.md` under the revised workload. The evidence above is
  ready for its status update; the earlier preflight-only status is superseded.
- Runtime posing, measurement scaling, collision and three.js belong to M4b.

No milestone gate, PR review, CI deployment or catalogue acceptance is claimed.
