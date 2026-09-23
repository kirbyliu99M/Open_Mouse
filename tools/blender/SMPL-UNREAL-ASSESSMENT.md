# MANO and smpl-unreal fit for Open_Mouse

Reviewed 2026-09-23 after Kirby clarified that the project is noncommercial and
that visual quality takes priority. Sources are linked below. This is a
technical and license-feasibility assessment; no MANO model file was available
in the workspace, so it is not a visual comparison or a license grant.

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

An offline visual experiment may be feasible after an authorized user obtains
the official model under terms that cover the experiment. The download page
requires registration. No MANO model file was found in this workspace.

## Integration work if the visual test succeeds

1. Load official left and right MANO models in an isolated, gitignored local
   workspace. Produce flat, claw and palm-grip renders alongside our hand at
   the same scale and view. Check silhouettes, finger joint folds, palm volume,
   and contact with three representative mouse shells. Preserve all comparison
   assets locally until distribution rights are clear.
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
