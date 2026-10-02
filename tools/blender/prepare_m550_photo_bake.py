"""Read-only geometry preflight for the M550 photo bake (Blender 5.2.2)."""
import json
from pathlib import Path
import sys

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import dimensions_mm, support_margin_mm, validate_mesh


def main():
    out = HERE / 'out/study-fidelity/b3'
    out.mkdir(parents=True, exist_ok=True)
    clouds = []
    for name, path in [
        ('committed', HERE.parents[1] / 'public/models/studies/logitech-m550.glb'),
        ('lossless', HERE / 'out/polished/logitech-m550/logitech-m550.glb'),
    ]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path))
        mesh = next(o for o in bpy.context.selected_objects if o.type == 'MESH')
        mesh.data.calc_loop_triangles()
        vertices = np.array([tuple(mesh.matrix_world @ v.co) for v in mesh.data.vertices])
        faces = np.array([tuple(t.vertices) for t in mesh.data.loop_triangles])
        clouds.append(set(map(tuple, vertices)))
        np.savez_compressed(out / (name + '-mesh.npz'), vertices=vertices, faces=faces)
        if name == 'committed':
            evidence = dict(dimensionsXYZmm=dimensions_mm(mesh), supportMarginMm=support_margin_mm(mesh),
                            mesh=validate_mesh(mesh, weld=True))
    assert clouds[0] == clouds[1], 'Lossless and committed position sets differ'
    evidence['maxVertexDisplacementMm'] = 0.0
    evidence['uniquePositions'] = len(clouds[0])
    (out / 'geometry-preflight.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence), flush=True)


if __name__ == '__main__':
    main()
