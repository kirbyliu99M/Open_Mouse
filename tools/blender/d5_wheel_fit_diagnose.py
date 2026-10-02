"""Phase D5b diagnostic: sweep a crop radius around the D0/D4 "inside > 2mm" deficiency
cluster and report the cylinder fit residual at each radius, per shell. Read-only; builds
nothing. Used to pick a crop radius (and, for M190, confirm the already-isolated wheel
component) before d5_wheel_crowns.py commits to a build.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/d5_wheel_fit_diagnose.py -- \
        --data <tools/blender folder> --baseline <out/d5/baseline folder> --slug logitech-m190
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import color_reconstruction
from cylinder_fit_math import axis_extent, fit_cylinder


def diagnose(slug, data, baseline, radii):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    record = json.loads((data / 'out/reference-library' / slug / 'sources.json').read_text())
    report = json.loads((data / 'out/reconstructed' / slug / 'reconstruction.json').read_text())
    calibration = json.loads((data / report['cameraFile']).read_text())
    color_reconstruction.LIB = data / 'out/reference-library'
    tree, verts, tris, samples, objects = color_reconstruction.source_surface(record, calibration)
    v = np.array([tuple(p) for p in verts])
    npz = np.load(baseline / (slug + '.npz'))
    points, signed = npz['points'], npz['signed_mm']
    inside = points[signed < -2]
    for radius_mm in radii:
        radius = radius_mm / 1000
        diffs = v[:, None, :] - inside[None, :, :]
        dist = np.linalg.norm(diffs, axis=-1).min(axis=1)
        crop = v[dist < radius]
        if len(crop) < 20:
            print('RADIUS', slug, radius_mm, 'points', len(crop), 'SKIP too few', flush=True)
            continue
        fit = fit_cylinder(crop)
        mid, width = axis_extent(crop, fit['axis'], fit['center'])
        print('RADIUS', slug, radius_mm, 'points', len(crop), 'radiusMm', round(fit['radius'] * 1000, 3),
              'widthMm', round(width * 1000, 3), 'rmsMm', round(fit['rms'] * 1000, 4),
              'maxMm', round(fit['max_abs'] * 1000, 4), 'axis', [round(a, 3) for a in fit['axis']], flush=True)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--slug', required=True, nargs='+')
    parser.add_argument('--radii', type=float, nargs='+', default=[6, 8, 10, 12, 14, 16, 18, 20])
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = Path(args.data)
    baseline = Path(args.baseline)
    for slug in args.slug:
        diagnose(slug, data, baseline, args.radii)


if __name__ == '__main__':
    main()
