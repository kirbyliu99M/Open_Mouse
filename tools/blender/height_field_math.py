"""D6 height-only deformation maths in mm; numpy/scipy only, no image or Blender dependency.

The D1 lofts already match the top and bottom photos to ~0.995. Their errors are in the
height profile, which the side and oblique photos see. A deformation that moves vertices
only in Z keeps every vertex's X and Y, so the plan outline (what the top and bottom views
see, up to perspective) is kept, the topology and UVs are untouched, and the frozen D1
evaluator applies unchanged.

The Z scale field is 1 + a*(R_sigma - 1) + sum_k c_k*phi_k(x, y):
- R is the ratio of the visual hull's top-surface height to the loft's (D5a hull, carved
  from the fitting photos only), smoothed with a Gaussian of sigma mm;
- phi_k are bilinear hat functions on a coarse grid over the footprint.
Ground vertices (z = 0) never move; the result is recalibrated to the catalogue box.
"""
import numpy as np
from scipy import ndimage

from study_deformation_math import calibrate_bbox


def top_height_map(vertices, faces, x_centres, y_centres):
    """Highest surface Z above each (x, y) grid centre; NaN where no triangle covers it.

    A z-buffer over triangle XY projections with barycentric interpolation of Z.
    """
    v = np.asarray(vertices, float)
    f = np.asarray(faces, int)
    xs, ys = np.asarray(x_centres, float), np.asarray(y_centres, float)
    if v.ndim != 2 or v.shape[1] != 3 or f.ndim != 2 or f.shape[1] != 3:
        raise ValueError('vertices (N,3) and faces (M,3) required')
    if xs.size < 2 or ys.size < 2 or np.any(np.diff(xs) <= 0) or np.any(np.diff(ys) <= 0):
        raise ValueError('grid centres must be increasing with at least two values per axis')
    dx, dy = xs[1]-xs[0], ys[1]-ys[0]
    height = np.full((ys.size, xs.size), -np.inf)
    tri = v[f]
    for (ax, ay, az), (bx, by, bz), (cx, cy, cz) in tri:
        det = (by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
        if abs(det) < 1e-12:
            continue  # vertical triangle: no area in plan
        i0 = max(int(np.ceil((min(ax, bx, cx)-xs[0])/dx)), 0)
        i1 = min(int(np.floor((max(ax, bx, cx)-xs[0])/dx)), xs.size-1)
        j0 = max(int(np.ceil((min(ay, by, cy)-ys[0])/dy)), 0)
        j1 = min(int(np.floor((max(ay, by, cy)-ys[0])/dy)), ys.size-1)
        if i0 > i1 or j0 > j1:
            continue
        gx, gy = np.meshgrid(xs[i0:i1+1], ys[j0:j1+1])
        w0 = ((by-cy)*(gx-cx)+(cx-bx)*(gy-cy))/det
        w1 = ((cy-ay)*(gx-cx)+(ax-cx)*(gy-cy))/det
        w2 = 1-w0-w1
        inside = (w0 >= -1e-9) & (w1 >= -1e-9) & (w2 >= -1e-9)
        if not inside.any():
            continue
        z = w0*az+w1*bz+w2*cz
        block = height[j0:j1+1, i0:i1+1]
        np.maximum(block, np.where(inside, z, -np.inf), out=block)
    height[~np.isfinite(height)] = np.nan
    return height


def height_ratio_field(hull_height, loft_height, sigma_px, min_height_mm=4., clamp=(.8, 1.25)):
    """Smoothed hull/loft height ratio, defined everywhere on the grid.

    Cells where either height is missing or the loft is thinner than `min_height_mm`
    (the rim, where a ratio is noise) carry no evidence; the Gaussian is normalised by
    the evidence weight, and cells with no evidence nearby take the nearest value.
    """
    hull = np.asarray(hull_height, float)
    loft = np.asarray(loft_height, float)
    if hull.shape != loft.shape or hull.ndim != 2:
        raise ValueError('hull and loft height maps must be 2D and the same shape')
    valid = np.isfinite(hull) & np.isfinite(loft) & (loft >= min_height_mm)
    if not valid.any():
        raise ValueError('no cell has both heights')
    ratio = np.where(valid, hull/np.where(valid, loft, 1), 0.)
    ratio = np.clip(ratio, *clamp)*valid
    if sigma_px > 0:
        num = ndimage.gaussian_filter(ratio, sigma_px, mode='nearest')
        den = ndimage.gaussian_filter(valid.astype(float), sigma_px, mode='nearest')
        smooth = np.where(den > 1e-6, num/np.maximum(den, 1e-12), np.nan)
    else:
        smooth = np.where(valid, ratio, np.nan)
    missing = ~np.isfinite(smooth)
    if missing.any():
        _, (iy, ix) = ndimage.distance_transform_edt(missing, return_indices=True)
        smooth = smooth[iy, ix]
    return np.clip(smooth, *clamp)


def sample_grid(field, x_centres, y_centres, points_xy):
    """Bilinear sample of a grid field at (x, y) points, clamped to the grid."""
    grid = np.asarray(field, float)
    xs, ys = np.asarray(x_centres, float), np.asarray(y_centres, float)
    p = np.asarray(points_xy, float)
    fx = np.clip((p[:, 0]-xs[0])/(xs[1]-xs[0]), 0, xs.size-1)
    fy = np.clip((p[:, 1]-ys[0])/(ys[1]-ys[0]), 0, ys.size-1)
    i0 = np.minimum(np.floor(fx).astype(int), xs.size-2)
    j0 = np.minimum(np.floor(fy).astype(int), ys.size-2)
    tx, ty = fx-i0, fy-j0
    return ((1-tx)*(1-ty)*grid[j0, i0]+tx*(1-ty)*grid[j0, i0+1]
            +(1-tx)*ty*grid[j0+1, i0]+tx*ty*grid[j0+1, i0+1])


def hat_basis(points_xy, low, high, nodes=(4, 6)):
    """Bilinear hat functions on a nodes[0] x nodes[1] grid spanning low..high in X and Y.

    Returns (N, K) with K = nodes[0]*nodes[1]; rows sum to 1 inside the box.
    """
    p = np.asarray(points_xy, float)
    nx, ny = nodes
    if nx < 2 or ny < 2:
        raise ValueError('at least two nodes per axis')
    u = np.clip((p[:, 0]-low[0])/(high[0]-low[0]), 0, 1)*(nx-1)
    w = np.clip((p[:, 1]-low[1])/(high[1]-low[1]), 0, 1)*(ny-1)
    hx = np.maximum(0, 1-abs(u[:, None]-np.arange(nx)[None]))
    hy = np.maximum(0, 1-abs(w[:, None]-np.arange(ny)[None]))
    return (hy[:, :, None]*hx[:, None, :]).reshape(len(p), nx*ny)


def z_scale_deform(vertices, scale, dimensions):
    """Multiply each vertex's Z by its scale, keep X and Y, recalibrate to the catalogue box."""
    v = np.asarray(vertices, float)
    s = np.asarray(scale, float)
    if s.shape != (len(v),) or not np.isfinite(s).all() or np.any(s <= 0):
        raise ValueError('one finite positive scale per vertex required')
    ground = v[:, 2].min()
    moved = v.copy()
    moved[:, 2] = ground+(v[:, 2]-ground)*s
    return calibrate_bbox(moved, dimensions)
