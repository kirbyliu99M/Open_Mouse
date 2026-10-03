"""Phase D5b diagnostic: locate the wheel component in each AR source and report candidates.

Read-only. Loads the source in the reconstruction frame exactly as geometry_audit.py does,
finds the AR source's connected topological components (a union-find over the source
triangle list), and reports the components nearest the D5 baseline's "inside > 2mm" sample
cluster (the D0/D4 evidence that the shell sits below the wheel crown). Prints candidates;
builds nothing.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/d5_wheel_diagnose.py -- \
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


def connected_components(n_verts, triangles):
    parent = list(range(n_verts))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b, c in triangles:
        ra, rb, rc = find(a), find(b), find(c)
        if ra != rb:
            parent[ra] = rb
        rc = find(c)
        rb = find(b)
        if rb != rc:
            parent[rb] = rc
    return np.array([find(i) for i in range(n_verts)])


def diagnose(slug, data, baseline):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    record = json.loads((data / 'out/reference-library' / slug / 'sources.json').read_text())
    report = json.loads((data / 'out/reconstructed' / slug / 'reconstruction.json').read_text())
    calibration = json.loads((data / report['cameraFile']).read_text())
    color_reconstruction.LIB = data / 'out/reference-library'
    tree, verts, tris, samples, objects = color_reconstruction.source_surface(record, calibration)
    v = np.array([tuple(p) for p in verts])
    t = np.array(tris)
    npz = np.load(baseline / (slug + '.npz'))
    points, signed = npz['points'], npz['signed_mm']
    inside = points[signed < -2]
    centroid = inside.mean(axis=0)
    print('INSIDE_CLUSTER', slug, 'n', len(inside), 'centroid', centroid.tolist(), flush=True)

    labels = connected_components(len(v), t)
    unique, counts = np.unique(labels, return_counts=True)
    rows = []
    for label, count in zip(unique, counts):
        if count < 10:
            continue
        mask = labels == label
        pts = v[mask]
        # Nearest-point distance to the D0/D4 "inside > 2mm" sample cloud, not just its
        # centroid: the deficiency spreads over the crown's top, so the centroid can sit
        # well away from any actual wheel vertex even when the wheel is the right part.
        diffs = pts[:, None, :] - inside[None, :, :]
        dist_to_cluster = float(np.linalg.norm(diffs, axis=-1).min())
        bbox = pts.max(0) - pts.min(0)
        diag = float(np.linalg.norm(bbox))
        rows.append(dict(label=int(label), vertices=int(count), distToClusterMm=float(dist_to_cluster * 1000),
                          bboxMm=(bbox * 1000).tolist(), diagMm=diag * 1000,
                          centroid=(pts.mean(0) * 1000).tolist()))
    for r in rows:
        bbox = sorted(r['bboxMm'])
        # A wheel is short along its axle and roughly circular across the tread: the two
        # largest bbox extents should be close, the smallest much shorter (the width).
        r['circularity'] = abs(bbox[2] - bbox[1]) / max(bbox[2], 1e-6)
        r['axialFraction'] = bbox[0] / max(bbox[2], 1e-6)
        r['sortedBboxMm'] = bbox
    rows.sort(key=lambda r: r['distToClusterMm'])
    print('--- nearest to cluster ---', flush=True)
    for r in rows[:10]:
        print('COMPONENT', slug, json.dumps(r), flush=True)
    print('--- most circular within 25mm of cluster ---', flush=True)
    near = [r for r in rows if r['distToClusterMm'] < 25 and 20 < r['vertices'] < 4000]
    near.sort(key=lambda r: r['circularity'])
    for r in near[:10]:
        print('COMPONENT_CIRC', slug, json.dumps(r), flush=True)
    print('--- most circular anywhere, thin axially, wheel-plausible diameter ---', flush=True)
    anywhere = [r for r in rows if 20 < r['vertices'] < 8000 and r['axialFraction'] < 0.9
                and 10 < r['sortedBboxMm'][1] < 40]
    anywhere.sort(key=lambda r: r['circularity'])
    for r in anywhere[:15]:
        print('COMPONENT_ANY', slug, json.dumps(r), flush=True)
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
        diagnose(slug, data, baseline)


if __name__ == '__main__':
    main()
