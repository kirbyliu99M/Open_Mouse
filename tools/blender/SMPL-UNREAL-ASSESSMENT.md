# smpl-unreal assessment for Open_Mouse

Reviewed 2026-09-23: <https://github.com/PerceivingSystems/smpl-unreal>.

The repository is a C++ Unreal Engine 5 plugin that computes pose-corrective
morph weights for SMPL-X and SMPL+H body meshes during animation. It is not a
hand generator, a browser renderer, or a GLB runtime. Its own usage guide says
the plugin ships no body mesh: users supply separately licensed SMPL-family
assets in FBX format. The plugin code is MIT licensed, while the body models
and Blender add-on have separate licenses. MANO's published license limits its
model/data to non-commercial uses and prohibits distribution to third parties
without permission.

Our `public/models/hand.glb` has one skin with 21 MediaPipe-named joints and no
morph targets. The plugin expects hundreds of SMPL pose-corrective morph targets,
and its calculation runs in Unreal's animation graph. It cannot improve this
hand or the planned three.js viewer by dropping it into our build. Adopting its
model assets would also undo the deliberate original-hand, license-clean design
in `docs/PLAN.md`.

One useful design idea is to add a small, original set of deformation
correctives at troublesome finger and palm poses, then enable them by joint
rotation or viewer detail level. That would require us to author and validate
those shapes ourselves; this repository supplies neither shapes nor a web
implementation. It is a possible future refinement after the current hand
scaling, posing and contact behavior work is validated.

Sources: [plugin README](https://github.com/PerceivingSystems/smpl-unreal),
[usage and asset prerequisites](https://github.com/PerceivingSystems/smpl-unreal/blob/main/docs/usage.md),
[plugin license](https://github.com/PerceivingSystems/smpl-unreal/blob/main/LICENSE),
[MANO model license](https://mano.is.tue.mpg.de/license.html).
