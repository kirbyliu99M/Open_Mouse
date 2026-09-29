"""D5a: build a visual-hull candidate for a study from its frozen D1 cameras
and fitting-role photo masks only. Chooses the voting rule and threshold by
leave-one-duplicate-group-out cross-validation among fitting views alone
(never the held-out photo), then carves the full-resolution grid and runs
marching cubes. Writes `hull-mesh.npz` (raw, pre-smoothing) plus a JSON
record of the chosen parameters and the cross-validation table.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.measure import marching_cubes

from photo_camera_fit import crop_mask, evaluation_raster
from photo_camera_math import camera_axes, project_points, silhouette_iou
from visual_hull_math import (
    carve, grid_points, group_reject_votes, occupancy_volume, pad_for_marching_cubes,
    reject_by_mask, voxel_grid, weighted_votes,
)


def load_fitting_views(directory):
    rows = [r for r in json.loads((directory/'photo-inventory.json').read_text()) if r['role'] == 'fit']
    group_key = {}
    for row in rows:
        key = row.get('duplicateGroup') or ('__singleton__', row['file'])
        group_key.setdefault(key, len(group_key))
    views = []
    for row in rows:
        camera = json.loads((directory/('camera-'+Path(row['file']).stem+'.json')).read_text())
        full = np.array(Image.open(directory/row['maskFile'])) > 0
        target, crop = crop_mask(full)
        assert crop == camera['crop'], f"Stored crop drifted for {row['file']}"
        views.append(dict(file=row['file'], group=group_key[row.get('duplicateGroup') or ('__singleton__', row['file'])],
                          camera=camera, mask=target))
    return views, len(group_key)


def voxel_reject_for_view(points, view, resolution):
    import cv2
    camera = view['camera']
    params, centre = camera['fittedParameters'], camera['centreMm']
    h, w = view['mask'].shape
    scale = resolution/max(w, h)
    size = (round(w*scale), round(h*scale))
    target = cv2.resize(view['mask'].astype('uint8'), size, interpolation=cv2.INTER_NEAREST) > 0
    distance = np.exp(params[3])
    focal = np.exp(params[4])*distance*scale
    xy, depth = project_points(points, camera_axes(*params[:3]), centre, distance, focal,
                               params[5:7], (np.array(size)-1)/2)
    return reject_by_mask(xy, target)


def mesh_iou_against_view(survive, shape, spacing, origin, view, resolution):
    """Marching-cubes the (coarse) leave-one-out hull and score it against a
    view's own mask with the same rendering path the delivery gate uses
    (`evaluation_raster`/`silhouette_iou`), so parameter selection uses the
    real metric, not an approximation."""
    volume = occupancy_volume(survive, shape)
    if not volume.any() or volume.all():
        return 0.0
    padded = pad_for_marching_cubes(volume)
    verts, faces, _, _ = marching_cubes(padded.astype(float), level=0.5, spacing=spacing)
    vertices = verts+origin
    camera = view['camera']
    rendered, target, _ = evaluation_raster(vertices, faces.astype(np.int64), view['mask'],
                                            camera['fittedParameters'], camera['centreMm'], resolution)
    return silhouette_iou(rendered, target)


def choose_parameters(views, n_groups, dims, cv_voxel_size, resolution=720):
    xs, ys, zs, spacing = voxel_grid(dims, cv_voxel_size)
    points = grid_points(xs, ys, zs)
    shape = (len(xs), len(ys), len(zs))
    origin = np.array([xs[0]-spacing[0], ys[0]-spacing[1], zs[0]-spacing[2]])
    print(f'CV grid: {points.shape[0]} voxels at {cv_voxel_size} mm', flush=True)
    photo_reject = np.array([voxel_reject_for_view(points, v, resolution) for v in views])
    group_ids = np.array([v['group'] for v in views])
    trials = []
    for rule in ('majority', 'any'):
        groups_all = group_reject_votes(photo_reject, group_ids, rule=rule)
        for threshold in range(n_groups):
            scores = []
            for leave_out in range(n_groups):
                keep = [g for g in range(n_groups) if g != leave_out]
                if not keep:
                    continue
                votes = weighted_votes(groups_all[keep], np.ones(len(keep)))
                survive = carve(votes, len(keep), threshold)
                held_view = next(v for v in views if v['group'] == leave_out)
                scores.append(mesh_iou_against_view(survive, shape, spacing, origin, held_view, resolution))
            if scores:
                trials.append(dict(rule=rule, threshold=threshold, meanLeaveOneOutIoU=float(np.mean(scores)),
                                   perGroupIoU=scores))
    best = max(trials, key=lambda t: t['meanLeaveOneOutIoU'])
    return best, trials


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True, help='out/d1-evidence/<slug>')
    parser.add_argument('--output', type=Path, required=True, help='out/d5/<slug>')
    parser.add_argument('--voxel-size', type=float, default=0.5)
    parser.add_argument('--cv-voxel-size', type=float, default=1.5)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    geometry = json.loads((args.directory/'baseline-geometry.json').read_text())
    dims = geometry['catalogueDimensionsXYZmm']
    views, n_groups = load_fitting_views(args.directory)
    print(f'{len(views)} fitting photos in {n_groups} duplicate-collapsed groups', flush=True)

    best, trials = choose_parameters(views, n_groups, dims, args.cv_voxel_size)
    print('Chosen rule', best, flush=True)

    xs, ys, zs, spacing = voxel_grid(dims, args.voxel_size)
    points = grid_points(xs, ys, zs)
    print(f'Final grid: {points.shape[0]} voxels at spacing {spacing}', flush=True)
    photo_reject = np.array([voxel_reject_for_view(points, v, 1440) for v in views])
    group_ids = np.array([v['group'] for v in views])
    groups_all = group_reject_votes(photo_reject, group_ids, rule=best['rule'])
    votes = weighted_votes(groups_all, np.ones(n_groups))
    survive = carve(votes, n_groups, best['threshold'])
    volume = occupancy_volume(survive, (len(xs), len(ys), len(zs)))
    print(f'Surviving voxel fraction: {survive.mean():.4f}', flush=True)

    padded = pad_for_marching_cubes(volume)
    verts_idx, faces, normals, _ = marching_cubes(padded.astype(float), level=0.5, spacing=spacing)
    # skimage places a padded-array sample at world coordinate index*spacing
    # (index 0 at the origin), and treats each sample as a cell *centre*.
    # Padded index p=1 is unpadded voxel i=0, whose true centre is at
    # xs[0] (= grid_min + spacing/2); solving grid_min + (i+.5)*spacing =
    # (i+1)*spacing + offset gives offset = xs[0] - spacing, per axis.
    origin = np.array([xs[0]-spacing[0], ys[0]-spacing[1], zs[0]-spacing[2]])
    vertices = verts_idx+origin
    faces = faces.astype(np.int64)

    np.savez_compressed(args.output/'hull-mesh.npz', vertices=vertices, faces=faces)
    record = dict(method='visual-hull voxel carving', voxelSizeMm=args.voxel_size, cvVoxelSizeMm=args.cv_voxel_size,
                  chosenRule=best['rule'], chosenThreshold=best['threshold'],
                  meanLeaveOneOutIoU=best['meanLeaveOneOutIoU'], groups=n_groups,
                  fittingPhotos=[v['file'] for v in views], survivingVoxelFraction=float(survive.mean()),
                  hullVertices=int(len(vertices)), hullTriangles=int(len(faces)), crossValidationTrials=trials)
    (args.output/'hull-build.json').write_text(json.dumps(record, indent=2)+'\n')
    print('HULL_BUILT', json.dumps({k: record[k] for k in
          ('chosenRule', 'chosenThreshold', 'meanLeaveOneOutIoU', 'hullVertices', 'hullTriangles')}), flush=True)


if __name__ == '__main__':
    main()
