"""Fit five graphite-medium photos before baking; never changes source assets.

Run with the local Python image-analysis environment (NumPy/SciPy/Pillow/OpenCV).
The front three-quarter image is held out from all appearance sampling.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.optimize import minimize

from photo_camera_math import camera_axes, project_points, silhouette_iou, raster_silhouette

HERE = Path(__file__).resolve().parent
OUT = HERE / 'out/study-fidelity/b3'
REFERENCE = HERE / 'out/reference-library/logitech-m550'
VIEWS = {
    'top': ('top-angle-gallery-1', 180, 90),
    'left': ('profile-angle-gallery-4', -90, 0),
    'bottom': ('bottom-angle-gallery-3', 0, -90),
    'rear': ('3qtr-back-angle-gallery-2', -135, 35),
    'front-held-out': ('3qtr-front-angle-gallery-5', -45, 45),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--views', nargs='+', default=list(VIEWS))
    args = parser.parse_args()
    mesh = np.load(OUT / 'lossless-mesh.npz')
    vertices, faces = mesh['vertices']*1000, mesh['faces']
    centre = (vertices.min(0)+vertices.max(0))/2
    sources = json.loads((REFERENCE/'sources.json').read_text())['images']
    results = []
    for view in args.views:
        suffix, az, el = VIEWS[view]
        path = REFERENCE / ('m550-medium-graphite-'+suffix+'.png')
        alpha = np.array(Image.open(path))[:, :, 3]
        # Preserve openings and notches. Only enclosed holes and isolated alpha
        # speckles are removed, matching A2's stated mask convention.
        labels, _ = ndimage.label(alpha > 180)
        counts = np.bincount(labels.ravel()); counts[0] = 0
        full = ndimage.binary_fill_holes(labels == counts.argmax())
        ys, xs = np.where(full)
        crop = [max(0, int(xs.min())-40), max(0, int(ys.min())-40),
                min(full.shape[1], int(xs.max())+41), min(full.shape[0], int(ys.max())+41)]
        target_full = full[crop[1]:crop[3], crop[0]:crop[2]]
        h, w = target_full.shape
        # Params: degrees az/el/roll, log(distance mm), log(focal/distance),
        # camera-space translation x/y in mm. Focal length and distance both fit.
        best = None
        for resolution in [320, 720]:
            scale = resolution/max(w, h)
            size = (round(w*scale), round(h*scale))
            target = cv2.resize(target_full.astype('uint8'), size, interpolation=cv2.INTER_NEAREST)>0
            image_centre = (np.array(size)-1)/2

            def render(params):
                distance = np.exp(params[3])
                focal = np.exp(params[4])*distance*scale
                points, _ = project_points(vertices, camera_axes(*params[:3]), centre,
                                           distance, focal, params[5:7], image_centre)
                return raster_silhouette(points, faces, size)

            def objective(params):
                if not 120 <= np.exp(params[3]) <= 10000 or abs(params[2])>180:
                    return 2
                return 1-silhouette_iou(render(params), target)

            if best is None:
                starts = []
                for distance in [300, 900, 4000]:
                    axes = camera_axes(az, el)
                    xy, _ = project_points(vertices, axes, centre, distance, distance, [0, 0], [0, 0])
                    zoom = min((w-80)/np.ptp(xy[:, 0]), (h-80)/np.ptp(xy[:, 1]))
                    initial = np.array([az, el, 0, np.log(distance), np.log(zoom), 0., 0.])
                    starts.append(initial)
            else:
                starts = [best]
            candidates = []
            for initial in starts:
                simplex = np.tile(initial, (8, 1))
                for i, step in enumerate([4, 4, 4, .2, .03, 1.5, 1.5]):
                    simplex[i+1, i] += step
                fit = minimize(objective, initial, method='Nelder-Mead',
                               options=dict(initial_simplex=simplex, maxiter=1100, xatol=.002, fatol=1e-7))
                candidates.append(fit)
            winner = min(candidates, key=lambda r:r.fun)
            best = winner.x
            print(view, resolution, 1-winner.fun, best.tolist(), flush=True)
        # Report at 1440 maximum image dimension, independent of fit raster.
        scale = 1440/max(w, h);size = (round(w*scale), round(h*scale))
        target = cv2.resize(target_full.astype('uint8'), size, interpolation=cv2.INTER_NEAREST)>0
        image_centre = (np.array(size)-1)/2
        rendered = render(best)
        overlay = np.zeros((*target.shape, 3), np.uint8)
        overlay[target] = [225, 70, 70]; overlay[rendered] = [40, 170, 240]
        overlay[target & rendered] = [180, 195, 195]
        Image.fromarray(overlay).save(OUT / ('fit-'+view+'.png'))
        # Translate principal point from crop centre back to full image centre.
        distance = np.exp(best[3]); focal = np.exp(best[4])*distance
        crop_centre = np.array([(crop[0]+crop[2]-1)/2, (crop[1]+crop[3]-1)/2])
        result = dict(view=view, usedForTexturing=False,
                      appearanceRole='held-out' if view=='front-held-out' else 'candidate',
                      file=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                      sourceURL=next(p['url'] for p in sources if Path(p['file']).name==path.name),
                      iou=silhouette_iou(rendered, target), evaluationSize=size,
                      anglesDegrees=best[:3].tolist(), axes=camera_axes(*best[:3]).tolist(),
                      centreMm=centre.tolist(), distanceMm=float(distance), focalPixels=float(focal),
                      translationMm=best[5:7].tolist(), principalPointPixels=crop_centre.tolist(),
                      imageSize=[full.shape[1], full.shape[0]], crop=crop,
                      fittedParameters=best.tolist(), mask='alpha >180; largest component; filled enclosed holes',
                      mirrored=False, target=.95)
        (OUT/('camera-'+view+'.json')).write_text(json.dumps(result, indent=2)+'\n')
        results.append(result)
        print('EVALUATED', view, result['iou'], flush=True)
    failures = [r for r in results if r['iou'] < r['target']]
    if failures:
        raise SystemExit('CAMERA_GATE_FAILED: '+', '.join(f"{r['view']} {r['iou']:.9f} < {r['target']}" for r in failures))


if __name__ == '__main__':
    main()
