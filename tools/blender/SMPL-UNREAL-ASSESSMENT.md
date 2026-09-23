# MANO and smpl-unreal fit for Open_Mouse

Reviewed 2026-09-23 after Kirby clarified that the project is noncommercial and
that visual quality takes priority. Sources are linked below. This is a
technical and license-feasibility assessment. The subsequent private comparison
uses Kirby's official SMPL+H Blender DLC; no model or render is committed.

## What could help

MANO is a learned hand shape and articulation model. It is a credible candidate
for improving the hand's anatomy and bent-finger appearance over our original
Skin/subdivision template. A fair visual test would compare both hands at the
same measured dimensions, grip poses, material and lighting. Shading and
material work remains necessary with either mesh.

`smpl-unreal` itself computes SMPL-X/SMPL+H pose-corrective morph weights in an
Unreal Engine animation graph. It ships no model mesh and supplies no web or
Blender runtime. Our current `public/models/hand.glb` has 21 MediaPipe-named
joints and zero morph targets, while that plugin expects a compatible SMPL
body mesh with hundreds of pose correctives. Its code cannot be inserted into
the planned three.js viewer. The useful part to evaluate is MANO's hand model,
not the Unreal plugin.

## License boundary

The Unreal plugin code is MIT licensed; its README explicitly separates the
licenses for SMPL-family model assets. MANO's published grant is for specific
noncommercial research, education or artistic purposes, rather than every
noncommercial application. It also says the model/data may not be made
available to third parties without prior written permission. A public site
serving a MANO-derived hand GLB therefore needs clarification or written
permission from the licensor even if the site charges nothing. We should not
put downloaded model parameters, exported meshes, or derivative assets in the
repository or `public/` on the strength of the plugin's MIT license.

Kirby placed the official SMPL+H Blender DLC outside the repository. It is a
full-body model with MANO-based hands, not a standalone MANO hand download. Its
bundled data-license file points to the same MANO/SMPL+H license. Access to the
files makes a local technical comparison possible; it does not itself grant
public distribution rights.

## Local neutral-hand comparison

`compare_smplh_hands.py` crops the right hand from the neutral SMPL+H body,
matches its wrist-to-fingertip length to our authored hand, applies one clay
material and shared lighting, and renders top and oblique views under ignored
`out/mano-comparison/`. The script only reads the licensed source and writes
private PNGs. The SMPL+H hand shows a more natural palm/finger silhouette in
these two views; our authored hand has visibly tubular fingers and a broader,
less defined palm. The crop has an open wrist, and the test uses the base pose
without shape fitting or pose correctives. It does not establish grip-pose
quality or user-specific fit.

Run locally with Blender 5.2.2 and an authorized SMPL+H file:

```powershell
$blenderExe = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
$smplhBlend = '<local authorized smplh_model_20260511.blend path>'
& $blenderExe --background --factory-startup $smplhBlend --python-exit-code 1 --python tools/blender/compare_smplh_hands.py
```

## Integration work if the visual test succeeds

1. Extend the private comparison from this flat pose to claw and palm grips,
   with the SMPL+H pose correctives actually applied. Check finger joint folds,
   palm volume, and contact with three representative mouse shells. Preserve
   all comparison assets locally until distribution rights are clear.
2. Fit hand shape to the scan. Today the browser detects 21 MediaPipe points
   but sends only hand length, palm length/width, optional finger lengths and
   other derived measurements. Those few values do not uniquely determine
   MANO shape. For better personalization, retain the calibrated landmark
   geometry temporarily in the browser and fit shape there; validate against
   ruler measurements. This is a new M4b algorithm, not a GLB swap.
3. Map MediaPipe's 21 landmark convention to MANO's wrist and finger joints,
   with fingertips represented by mesh vertices rather than extra finger
   bones. The existing `mp_0`–`mp_20` rig contract cannot be assumed to fit.
   Pose a hand around the selected mouse and validate penetration/contact.
   The current scan is a flat hand photo, so grip pose must be estimated or
   explicitly chosen rather than claimed to be measured.
4. Export and test a web-ready GLB only after rights are settled. Compare the
   result on a mid-range phone, including loading, joint deformation and
   lighting. Keep the better-looking hand at an acceptable interaction cost.

Kirby's quality preference means the 1024 px shell-texture experiment in
`PAYLOAD-AUDIT.md` is only a bandwidth estimate. It is not a decision to reduce
the shipped textures. Any compression or resolution change needs side-by-side
visual review of seams, labels, surface finish and normal detail.

Sources: [smpl-unreal README](https://github.com/PerceivingSystems/smpl-unreal),
[plugin usage and prerequisites](https://github.com/PerceivingSystems/smpl-unreal/blob/main/docs/usage.md),
[plugin MIT license](https://github.com/PerceivingSystems/smpl-unreal/blob/main/LICENSE),
[MANO license](https://mano.is.tue.mpg.de/license.html),
[MANO registered download](https://mano.is.tue.mpg.de/download.php),
[SMPL-X loader documentation](https://github.com/vchoutas/smplx),
[MediaPipe landmark definitions](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/python/vision/hand_landmarker.py).
