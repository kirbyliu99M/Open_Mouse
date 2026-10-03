"""Pure numpy helpers for the Phase D0 geometry audit."""
import numpy as np

# Orthographic views in the reconstruction frame: (name, horizontal axis, vertical axis).
VIEWS = (('top', 0, 1), ('side', 1, 2), ('front', 0, 2))


def area_weighted_samples(vertices, faces, count, rng):
    """Uniform random points on a triangle mesh (probability proportional to area)."""
    corners = np.asarray(vertices)[np.asarray(faces)]
    areas = np.linalg.norm(np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1) / 2
    chosen = rng.choice(len(faces), size=count, p=areas / areas.sum())
    u, v = rng.random(count), rng.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    a, b, c = corners[chosen, 0], corners[chosen, 1], corners[chosen, 2]
    return a + u[:, None] * (b - a) + v[:, None] * (c - a)


def distance_summary(distances):
    d = np.asarray(distances, float)
    return dict(mean=float(d.mean()), p50=float(np.percentile(d, 50)), p95=float(np.percentile(d, 95)),
                max=float(d.max()), shareOver1mm=float((d > 1).mean()), shareOver2mm=float((d > 2).mean()))


def inside_box(vertices, faces, dims, margin):
    """Faces whose corners all lie in the calibrated product box (x, y centred; z from 0), plus a margin.

    Drops a trimmed cable and anything else outside the product's catalogue box.
    """
    v = np.asarray(vertices)[np.asarray(faces)]
    half = np.asarray(dims[:2]) / 2 + margin
    ok = (np.abs(v[..., 0]) <= half[0]) & (np.abs(v[..., 1]) <= half[1])
    ok &= (v[..., 2] >= -margin) & (v[..., 2] <= dims[2] + margin)
    return np.asarray(faces)[ok.all(axis=1)]


def to_pixels(points, lo, span, size, h, v):
    """Map two coordinates of 3-D points onto a size x size pixel grid (row 0 at the top)."""
    xy = np.column_stack([(points[:, h] - lo[h]) / span, 1 - (points[:, v] - lo[v]) / span]) * (size - 1)
    return xy
