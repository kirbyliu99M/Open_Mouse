"""Phase D5b diagnostic, stage 3: measure each AR source's own glTF mesh objects (nodes)
directly, in the calibrated reconstruction frame, the way B1's inspection identified
M750's Node5 "Wheel" (16.2 x 25.0 x 25.0 mm raw). Read-only; builds nothing.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/d5_wheel_objects.py -- \
        --data <tools/blender folder> --baseline <out/d5/baseline folder> --slug logitech-m650
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import color_reconstruction


def measure(slug, data, baseline):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    record = json.loads((data / 'out/reference-library' / slug / 'sources.json').read_text())
    report = json.loads((data / 'out/reconstructed' / slug / 'reconstruction.json').read_text())
    calibration = json.loads((data / report['cameraFile']).read_text())
    color_reconstruction.LIB = data / 'out/reference-library'
    bpy.ops.import_scene.gltf(filepath=str(color_reconstruction.LIB / record['arModels'][0]['file']))
    objects = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    points = [obj.matrix_world @ v.co for obj in objects for v in obj.data.vertices]
    low = Vector([min(p[a] for p in points) for a in range(3)])
    high = Vector([max(p[a] for p in points) for a in range(3)])
    trim = calibration.get('cableTrim')
    if trim:
        low[trim['axis']], high[trim['axis']] = trim['after']
    order = calibration['sourceAxisPermutation']
    mapping = Matrix([[int(c == order[r]) for c in range(3)] for r in range(3)])
    if mapping.determinant() < 0:
        mapping[0] = -mapping[0]
    target = calibration['dimensionsXYZ']
    size = high - low

    npz = np.load(baseline / (slug + '.npz'))
    points_deficient, signed = npz['points'], npz['signed_mm']
    inside = points_deficient[signed < -2]

    rows = []
    for obj in objects:
        verts = []
        for vertex in obj.data.vertices:
            p = mapping @ (obj.matrix_world @ vertex.co - (low + high) / 2)
            verts.append([p[a] * target[a] / size[order[a]] + (target[2] / 2 if a == 2 else 0) for a in range(3)])
        verts = np.array(verts)
        bbox = verts.max(0) - verts.min(0)
        if len(inside):
            diffs = verts[:, None, :] - inside[None, :, :]
            dist = float(np.linalg.norm(diffs, axis=-1).min())
        else:
            dist = float('nan')
        rows.append(dict(name=obj.name, vertices=len(verts), bboxMm=(bbox * 1000).round(2).tolist(),
                          distToInsideMm=round(dist * 1000, 2)))
    rows.sort(key=lambda r: r['distToInsideMm'])
    for r in rows:
        print('OBJECT', slug, json.dumps(r), flush=True)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--slug', required=True, nargs='+')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = Path(args.data)
    baseline = Path(args.baseline)
    for slug in args.slug:
        measure(slug, data, baseline)


if __name__ == '__main__':
    main()
