"""D6: height-only transfer from the D5a visual hull onto the D1 loft, fitted at 1440 px.

Only fitting photos are opened; held-out camera files are never read here. Selection uses
fitting views only, at the delivery evaluation's own resolution (1440 px), with a hard
no-regression constraint per fitted view, so a candidate cannot pass here and fail the
gate for resolution reasons (the D1 lesson). The frozen `evaluate_study_geometry.py` then
judges the candidate once, held-out view included.

    python d6_height_transfer.py --directory out/d6/<slug> [--explore]
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.optimize import minimize

from height_field_math import (hat_basis, height_ratio_field, sample_grid,
                               top_height_map, z_scale_deform)
from photo_camera_fit import evaluation_raster
from photo_camera_math import silhouette_iou

GRID_MM = .5
MAX_TRAINING_DROP = .0015  # gate allows .002; margin for GLB round trip
COEFFICIENT_BOUND = .08    # hat coefficients: at most 8% of local height
SIGMAS_MM = (2., 4., 8.)
ALPHAS = (0., .25, .5, .75, 1.)


def load_training(out):
    inventory = json.loads((out/'photo-inventory.json').read_text())
    views, groups = [], []
    for row in inventory:
        if row['role'] != 'fit':
            continue
        camera = json.loads((out/('camera-'+Path(row['file']).stem+'.json')).read_text())
        assert camera['role'] == 'fit'
        x0, y0, x1, y1 = camera['crop']
        mask = (np.array(Image.open(out/row['maskFile'])) > 0)[y0:y1, x0:x1]
        views.append((row['file'], camera, mask))
        groups.append(row.get('duplicateGroup') or row['file'])
    sizes = {g: groups.count(g) for g in groups}
    weights = np.array([1/sizes[g] for g in groups])  # each duplicate group one vote
    return views, weights


def scores(vertices, faces, views):
    return np.array([silhouette_iou(*evaluation_raster(vertices, faces, mask,
                     camera['fittedParameters'], camera['centreMm'])[:2])
                     for _, camera, mask in views])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--explore', action='store_true', help='print the alpha/sigma sweep and stop')
    args = parser.parse_args()
    out = args.directory
    loft = np.load(out/'baseline-mesh.npz')
    hull = np.load(out/'hull-mesh.npz')
    vertices, faces = loft['vertices'], loft['faces']
    dims = json.loads((out/'baseline-geometry.json').read_text())['catalogueDimensionsXYZmm']
    views, weights = load_training(out)
    base = scores(vertices, faces, views)

    low, high = vertices.min(0), vertices.max(0)
    xs = np.arange(low[0], high[0]+GRID_MM/2, GRID_MM)
    ys = np.arange(low[1], high[1]+GRID_MM/2, GRID_MM)
    t0 = time.time()
    h_loft = top_height_map(vertices, faces, xs, ys)
    h_hull = top_height_map(hull['vertices'], hull['faces'], xs, ys)
    print('HEIGHT_MAPS', dict(seconds=round(time.time()-t0, 1),
          loftCells=int(np.isfinite(h_loft).sum()), hullCells=int(np.isfinite(h_hull).sum())), flush=True)
    ratios = {s: sample_grid(height_ratio_field(h_hull, h_loft, s/GRID_MM), xs, ys, vertices[:, :2])
              for s in SIGMAS_MM}

    def summary(current):
        d = current-base
        return dict(weightedMean=float(np.average(current, weights=weights)),
                    weightedMeanBefore=float(np.average(base, weights=weights)),
                    mean=float(current.mean()), meanBefore=float(base.mean()),
                    worstDrop=float(-d.min()), worstView=views[int(d.argmin())][0])

    sweep = []
    for sigma in SIGMAS_MM:
        for alpha in ALPHAS:
            s = 1+alpha*(ratios[sigma]-1)
            current = scores(z_scale_deform(vertices, s, dims), faces, views)
            sweep.append(dict(sigma=sigma, alpha=alpha, **summary(current),
                              deltas={v[0]: float(c-b) for v, c, b in zip(views, current, base)}))
            print('SWEEP', {k: sweep[-1][k] for k in ('sigma', 'alpha', 'weightedMean', 'worstDrop', 'worstView')}, flush=True)
    (out/'d6-sweep.json').write_text(json.dumps(sweep, indent=2)+'\n')
    if args.explore:
        return

    feasible = [r for r in sweep if r['worstDrop'] <= MAX_TRAINING_DROP]
    start = max(feasible, key=lambda r: r['weightedMean'])
    sigma = start['sigma']
    ratio = ratios[sigma]
    basis = hat_basis(vertices[:, :2], low[:2], high[:2], (4, 6))
    count = 1+basis.shape[1]
    best = [float('inf'), np.r_[start['alpha'], np.zeros(basis.shape[1])]]
    calls = 0

    def field(params):
        return 1+params[0]*(ratio-1)+basis@params[1:]

    def objective(params):
        nonlocal calls
        calls += 1
        if not 0 <= params[0] <= 1.5 or np.any(abs(params[1:]) > COEFFICIENT_BOUND):
            return 2.
        s = field(params)
        if np.any(s <= .5):
            return 2.
        current = scores(z_scale_deform(vertices, s, dims), faces, views)
        drop = float(np.max(base-current))
        if drop > MAX_TRAINING_DROP:
            return 1.+drop  # hard constraint at the evaluation resolution
        loss = 1-float(np.average(current, weights=weights))+1e-4*float(np.mean(params[1:]**2))
        if loss < best[0]:
            best[:] = [loss, params.copy()]
        if calls % 100 == 0:
            print('FIT', dict(evaluations=calls, loss=best[0]), flush=True)
        return loss

    objective(best[1])
    simplex = np.tile(best[1], (count+1, 1))
    simplex[1, 0] += .25
    for i in range(1, count):
        simplex[i+1, i] += .03
    fit = minimize(objective, best[1], method='Nelder-Mead', options=dict(
        initial_simplex=simplex, maxfev=2500, xatol=1e-4, fatol=1e-7))
    params = best[1]
    candidate = z_scale_deform(vertices, field(params), dims)
    current = scores(candidate, faces, views)
    np.savez_compressed(out/'candidate-mesh.npz', vertices=candidate, faces=faces)
    evidence = dict(method='D6 height-only transfer: Z scale = 1 + alpha*(hull/loft top-height ratio, '
                           'Gaussian sigma) + 24 bilinear hat fields; X and Y unchanged; fixed baseline cameras',
                    sigmaMm=sigma, alpha=float(params[0]), hatCoefficients=params[1:].tolist(),
                    coefficientBound=COEFFICIENT_BOUND, fitResolution=1440, maxTrainingDrop=MAX_TRAINING_DROP,
                    weighting='groups', viewWeights=dict(zip([v[0] for v in views], weights.tolist())),
                    evaluations=calls, converged=bool(fit.success), message=str(fit.message),
                    trainingSummary=summary(current), startFromSweep={k: start[k] for k in ('sigma', 'alpha')},
                    trainingFiles=[v[0] for v in views], heldOutUsed=False, cameraRefitted=False,
                    maxDisplacementMm=float(np.linalg.norm(candidate-vertices, axis=1).max()),
                    maxXYDisplacementMm=float(np.linalg.norm(candidate[:, :2]-vertices[:, :2], axis=1).max()),
                    dimensionsXYZmm=np.ptp(candidate, axis=0).tolist(), minZmm=float(candidate[:, 2].min()),
                    topologyChanged=False, materialsChanged=False, uvChanged=False)
    (out/'deformation.json').write_text(json.dumps(evidence, indent=2)+'\n')
    print('CANDIDATE_READY', json.dumps(evidence), flush=True)


if __name__ == '__main__':
    main()
