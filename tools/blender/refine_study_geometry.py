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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    out = args.directory
    mesh = np.load(out/'baseline-mesh.npz')
    vertices,faces = mesh['vertices'],mesh['faces']
    dimensions = json.loads((out/'baseline-geometry.json').read_text())['catalogueDimensionsXYZmm']
    basis = deformation_basis(vertices)
    inventory = json.loads((out/'photo-inventory.json').read_text())
    training = []
    for row in inventory:
        if row['role'] != 'fit':
            continue
        camera = json.loads((out/('camera-'+Path(row['file']).stem+'.json')).read_text())
        assert camera['role'] == 'fit'
        mask = np.array(Image.open(out/row['maskFile']))>0
        x0,y0,x1,y1 = camera['crop']
        training.append((camera,mask[y0:y1,x0:x1]))
    params = np.zeros(12)
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
            loss = 1-current.mean()+10*regression.mean()+.000005*np.mean(coefficients**2)
            if loss < best[0]:
                best[:] = [float(loss),coefficients.copy()]
            if calls%50 == 0:
                checkpoint = dict(resolution=resolution,evaluations=calls,loss=best[0],
                                  coefficients=best[1].tolist(),heldOutUsed=False)
                (out/'deformation-wip.json').write_text(json.dumps(checkpoint,indent=2)+'\n')
                print('FIT',checkpoint,flush=True)
            return float(loss)

        objective(params)
        simplex = np.tile(params,(13,1))
        for i in range(12):
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
    evidence = dict(method='12 smooth Gaussian loft fields; fixed baseline perspective cameras',
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
