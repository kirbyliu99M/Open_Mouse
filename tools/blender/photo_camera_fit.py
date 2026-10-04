"""Reusable B3 perspective registration, independent of study and appearance.

Inputs are an actual mesh in mm and a fixed, cropped boolean photo mask.
Square pixels, triangle-union raster, three distance starts, 320/720 fitting
and independent 1440 evaluation retain the B3 method. No geometry mutation.
"""
import cv2
import numpy as np
from scipy import ndimage
from scipy.optimize import minimize

from photo_camera_math import camera_axes, project_points, raster_silhouette, silhouette_iou


def clean_mask(mask):
    labels, _ = ndimage.label(np.asarray(mask, bool))
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    if not counts.any():
        raise ValueError('Empty photo mask')
    return ndimage.binary_fill_holes(labels == counts.argmax())


def crop_mask(mask, padding=40):
    ys, xs = np.where(mask)
    if not len(xs):
        raise ValueError('Empty photo mask')
    crop = [max(0, int(xs.min())-padding), max(0, int(ys.min())-padding),
            min(mask.shape[1], int(xs.max())+padding+1),
            min(mask.shape[0], int(ys.max())+padding+1)]
    return mask[crop[1]:crop[3], crop[0]:crop[2]], crop


def evaluation_raster(vertices, faces, target_full, params, centre, resolution=1440):
    h, w = target_full.shape
    scale = resolution/max(w, h)
    size = (round(w*scale), round(h*scale))
    target = cv2.resize(target_full.astype('uint8'), size, interpolation=cv2.INTER_NEAREST)>0
    distance = np.exp(params[3])
    focal = np.exp(params[4])*distance*scale
    points, _ = project_points(vertices, camera_axes(*params[:3]), centre,
                               distance, focal, params[5:7], (np.array(size)-1)/2)
    return raster_silhouette(points, faces, size), target, scale


def fit_camera(vertices, faces, target_full, angles, progress=None):
    centre = (vertices.min(0)+vertices.max(0))/2
    h, w = target_full.shape
    best = None
    stages = []
    for resolution in (320, 720):
        def objective(params):
            if not np.isfinite(params).all() or not np.log(120) <= params[3] <= np.log(10000) or abs(params[2])>180:
                return 2.
            try:
                rendered, target, _ = evaluation_raster(vertices, faces, target_full, params, centre, resolution)
            except (ValueError, OverflowError):
                return 2.
            return 1-silhouette_iou(rendered, target)

        if best is None:
            starts = []
            for distance in (300, 900, 4000):
                xy, _ = project_points(vertices, camera_axes(*angles), centre,
                                       distance, distance, [0, 0], [0, 0])
                # The tight mask extent handles crops near a canvas boundary.
                ys, xs = np.where(target_full)
                zoom = min((xs.max()-xs.min())/np.ptp(xy[:, 0]),
                           (ys.max()-ys.min())/np.ptp(xy[:, 1]))
                starts.append(np.array([*angles, np.log(distance), np.log(zoom), 0., 0.]))
        else:
            starts = [best]
        candidates = []
        for initial in starts:
            simplex = np.tile(initial, (8, 1))
            for i, step in enumerate((4, 4, 4, .2, .03, 1.5, 1.5)):
                simplex[i+1, i] += step
            candidates.append(minimize(objective, initial, method='Nelder-Mead', options=dict(
                initial_simplex=simplex, maxiter=1100, xatol=.002, fatol=1e-7)))
        winner = min(candidates, key=lambda r:r.fun)
        best = winner.x
        stages.append(dict(resolution=resolution, iou=1-winner.fun,
                           iterations=int(winner.nit), converged=bool(winner.success)))
        if progress:
            progress(stages[-1])
    rendered, target, scale = evaluation_raster(vertices, faces, target_full, best, centre)
    return dict(fittedParameters=best.tolist(), centreMm=centre.tolist(),
                anglesDegrees=best[:3].tolist(), axes=camera_axes(*best[:3]).tolist(),
                distanceMm=float(np.exp(best[3])), focalPixels=float(np.exp(best[4]+best[3])),
                translationMm=best[5:7].tolist(), iou=silhouette_iou(rendered, target),
                evaluationSize=list(rendered.shape[::-1]), stages=stages)


def silhouette_gap_mm(rendered, target, mm_per_pixel):
    """Symmetric boundary Hausdorff distance at the fitted target plane."""
    a, b = np.asarray(rendered, bool), np.asarray(target, bool)
    if not a.any() or not b.any() or a.shape != b.shape or mm_per_pixel <= 0:
        raise ValueError('Nonempty equal masks and positive pixel scale required')
    ae = a ^ ndimage.binary_erosion(a)
    be = b ^ ndimage.binary_erosion(b)
    return float(max(ndimage.distance_transform_edt(~ae)[be].max(),
                     ndimage.distance_transform_edt(~be)[ae].max())*mm_per_pixel)
