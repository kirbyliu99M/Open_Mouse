"""Phase D5b diagnostic, stage 2: cluster the D0/D4 "inside > 2mm" deficiency samples
themselves (not the source mesh topology) to separate the wheel crown from any other
deficiency region (G903's button channel and wing seams), then widen with a coarse
cylindrical band around the cluster's PCA axis to gather the full tread ring from the AR
source, regardless of how the source mesh happens to be split into topological islands
(a grooved tread is often many small disconnected "teeth"). Read-only; builds nothing.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/d5_wheel_locate.py -- \
        --data <tools/blender folder> --baseline <out/d5/baseline folder> --slug logitech-g903-hero
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
from cylinder_fit_math import axis_extent, robust_fit_cylinder


def cluster_points(points, link_mm=3.0):
    n = len(points)
    if n == 0:
        return np.array([], int)
    diffs = points[:, None, :] - points[None, :, :]
    dist = np.linalg.norm(diffs, axis=-1)
    adjacency = dist < (link_mm / 1000)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(n):
        neighbours = np.nonzero(adjacency[i])[0]
        for j in neighbours:
            ri, rj = find(i), find(int(j))
            if ri != rj:
                parent[ri] = rj
    return np.array([find(i) for i in range(n)])


def locate(slug, data, baseline, band_radial_mm, band_axial_mm, link_mm=3.0):
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
    labels = cluster_points(inside, link_mm)
    unique, counts = np.unique(labels, return_counts=True)
    print('CLUSTERS', slug, len(unique), flush=True)
    for label, count in sorted(zip(unique, counts), key=lambda x: -x[1]):
        mask = labels == label
        cluster = inside[mask]
        centroid = cluster.mean(0)
        bbox = cluster.max(0) - cluster.min(0)
        print('CLUSTER', slug, 'label', int(label), 'n', int(count),
              'centroidMm', (centroid * 1000).round(2).tolist(),
              'bboxMm', (bbox * 1000).round(2).tolist(), flush=True)
        if count < 8:
            continue
        centered = cluster - centroid
        cov = centered.T @ centered
        eigvals, eigvecs = np.linalg.eigh(cov)
        axis_guess = eigvecs[:, 0]
        axial = (v - centroid) @ axis_guess
        perp = (v - centroid) - np.outer(axial, axis_guess)
        radial = np.linalg.norm(perp, axis=1)
        band = v[(np.abs(axial) < band_axial_mm / 1000) & (radial < band_radial_mm / 1000)]
        if len(band) < 20:
            print('  BAND too few points', len(band), flush=True)
            continue
        fit, inliers = robust_fit_cylinder(band)
        mid, width = axis_extent(inliers, fit['axis'], fit['center'])
        print('  BAND', slug, 'label', int(label), 'bandPoints', len(band), 'inliers', len(inliers),
              'radiusMm', round(fit['radius'] * 1000, 3), 'widthMm', round(width * 1000, 3),
              'rmsMm', round(fit['rms'] * 1000, 4), 'maxMm', round(fit['max_abs'] * 1000, 4),
              'axis', [round(a, 3) for a in fit['axis']],
              'centerMm', (np.asarray(mid) * 1000).round(2).tolist(), flush=True)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--slug', required=True, nargs='+')
    parser.add_argument('--band-radial', type=float, default=20.0)
    parser.add_argument('--band-axial', type=float, default=15.0)
    parser.add_argument('--link-mm', type=float, default=3.0)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = Path(args.data)
    baseline = Path(args.baseline)
    for slug in args.slug:
        locate(slug, data, baseline, args.band_radial, args.band_axial, args.link_mm)


if __name__ == '__main__':
    main()
