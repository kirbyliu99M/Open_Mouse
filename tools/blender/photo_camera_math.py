"""Perspective photo registration maths; world coordinates are in millimetres.

Camera rows are right/up/back. Square pixels, no anisotropic scaling, no lens
distortion. The principal point is the canvas centre. Silhouettes alone cannot
uniquely recover the physical focal length, so fitted cameras are registrations.
"""
import numpy as np


def camera_axes(azimuth, elevation, roll=0):
    az, el, angle = np.deg2rad([azimuth, elevation, roll])
    back = np.array([np.sin(az)*np.cos(el), np.cos(az)*np.cos(el), np.sin(el)])
    right = np.array([-np.cos(az), np.sin(az), 0])
    up = np.cross(back, right)
    return np.array([right*np.cos(angle)+up*np.sin(angle),
                     -right*np.sin(angle)+up*np.cos(angle), back])


def project_points(vertices, axes, centre, distance, focal, translation, image_centre):
    camera = (np.asarray(vertices)-centre) @ np.asarray(axes).T
    depth = distance-camera[:, 2]
    if np.any(depth <= 0):
        raise ValueError('Points must lie in front of the camera')
    xy = (camera[:, :2]+translation)/depth[:, None]*focal
    xy[:, 1] *= -1
    return xy+image_centre, depth


def silhouette_iou(rendered, target):
    a, b = np.asarray(rendered, bool), np.asarray(target, bool)
    union = np.count_nonzero(a | b)
    if union == 0:
        raise ValueError('Empty silhouette union')
    return float(np.count_nonzero(a & b)/union)
