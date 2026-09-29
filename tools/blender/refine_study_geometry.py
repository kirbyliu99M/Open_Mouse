"""Fit a bounded smooth deformation to training views only; never publish.

Held-out camera files are not opened here. Candidate selection uses only
fitted views. Separate evaluation is a hard delivery gate, not a tuning loop.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy.optimize import minimize

from photo_camera_math import camera_axes, project_points, raster_silhouette, silhouette_iou
from study_deformation_math import deform, deformation_basis


MAX_TRAINING_DROP = .0015  # gate allows .002 at 1440 px; keep margin at fit resolution


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--basis', choices=('symmetric', 'asymmetric'), default='symmetric')
    parser.add_argument('--weighting', choices=('uniform', 'groups'), default='uniform',
                        help='groups: each duplicate group of photos shares one vote, and no fitted view may '
                             'drop more than MAX_TRAINING_DROP (hard constraint)')
    args = parser.parse_args()
    out = args.directory
    mesh = np.load(out/'baseline-mesh.npz')
    vertices,faces = mesh['vertices'],mesh['faces']
    dimensions = json.loads((out/'baseline-geometry.json').read_text())['catalogueDimensionsXYZmm']
    basis = deformation_basis(vertices, asymmetric=args.basis=='asymmetric')
    count = basis.shape[2]
    inventory = json.loads((out/'photo-inventory.json').read_text())
    training = []
    groups = []
    for row in inventory:
        if row['role'] != 'fit':
            continue
        groups.append(row.get('duplicateGroup') or row['file'])
        camera = json.loads((out/('camera-'+Path(row['file']).stem+'.json')).read_text())
        assert camera['role'] == 'fit'
        mask = np.array(Image.open(out/row['maskFile']))>0
        x0,y0,x1,y1 = camera['crop']
        training.append((camera,mask[y0:y1,x0:x1]))
    sizes = {g: groups.count(g) for g in groups}
    weights = np.array([1/sizes[g] if args.weighting == 'groups' else 1. for g in groups])
    params = np.zeros(count)
    stages = []
    for resolution in (320,720):
        views = []
        for camera,mask in training:
            scale = resolution/max(mask.shape)
            size = (round(mask.shape[1]*scale),round(mask.shape[0]*scale))
            target = cv2.resize(mask.astype('uint8'),size,interpolation=cv2.INTER_NEAREST)>0
            views.append((camera,target,scale,size))

        def scores(points):
            result = []
            for camera,target,scale,size in views:
                xy,_ = project_points(points,np.array(camera['axes']),camera['centreMm'],
                    camera['distanceMm'],camera['focalPixels']*scale,camera['translationMm'],
                    (np.array(size)-1)/2)
                result.append(silhouette_iou(raster_silhouette(xy,faces,size),target))
            return np.array(result)

        baseline = scores(vertices)
        calls = 0
        best = [float('inf'),params.copy()]

        def objective(coefficients):
            nonlocal calls
            calls += 1
            if np.any(abs(coefficients)>5):
                return 2.+float(np.maximum(abs(coefficients)-5,0).sum())
            try:
                points = deform(vertices,coefficients,dimensions,basis)
                current = scores(points)
            except ValueError:
                return 2.
            # Tight training guard leaves room for the independent 1440px check.
            regression = np.maximum(baseline-current-.001,0)
            if args.weighting == 'groups':
                drop = float(np.max(baseline-current))
                if drop > MAX_TRAINING_DROP:
                    return 1.+drop  # hard constraint: no fitted view may regress past the limit
            loss = 1-np.average(current,weights=weights)+10*regression.mean()+.000005*np.mean(coefficients**2)
            if loss < best[0]:
                best[:] = [float(loss),coefficients.copy()]
            if calls%50 == 0:
                checkpoint = dict(resolution=resolution,evaluations=calls,loss=best[0],
                                  coefficients=best[1].tolist(),heldOutUsed=False)
                (out/'deformation-wip.json').write_text(json.dumps(checkpoint,indent=2)+'\n')
                print('FIT',checkpoint,flush=True)
            return float(loss)

        objective(params)
        simplex = np.tile(params,(count+1,1))
        for i in range(count):
            simplex[i+1,i] += .75 if resolution==320 else .25
        fit = minimize(objective,params,method='Nelder-Mead',options=dict(
            initial_simplex=simplex,maxiter=1100,maxfev=1800,xatol=.003,fatol=1e-7))
        params = best[1]
        stages.append(dict(resolution=resolution,loss=best[0],evaluations=calls,
                           iterations=int(fit.nit),converged=bool(fit.success),
                           message=str(fit.message),coefficients=params.tolist()))
        (out/'deformation-stages.json').write_text(json.dumps(stages,indent=2)+'\n')
    candidate = deform(vertices,params,dimensions,basis)
    np.savez_compressed(out/'candidate-mesh.npz',vertices=candidate,faces=faces)
    evidence = dict(method=f'{count} smooth Gaussian loft fields; fixed baseline perspective cameras',
                    basis=args.basis, weighting=args.weighting,
                    viewWeights=dict(zip([c['file'] for c,_ in training], weights.tolist())),
                    maxTrainingDrop=MAX_TRAINING_DROP if args.weighting == 'groups' else None,
                    largestCoefficientMm=float(np.max(abs(params))),
                    coefficients=params.tolist(),coefficientBoundMm=5,stages=stages,
                    trainingFiles=[c['file'] for c,_ in training],heldOutUsed=False,
                    maxDisplacementMm=float(np.linalg.norm(candidate-vertices,axis=1).max()),
                    dimensionsXYZmm=np.ptp(candidate,axis=0).tolist(),
                    minZmm=float(candidate[:,2].min()),topologyChanged=False,
                    cameraRefitted=False,materialsChanged=False,uvChanged=False)
    (out/'deformation.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print('CANDIDATE_READY',json.dumps(evidence),flush=True)


if __name__ == '__main__':
    main()
