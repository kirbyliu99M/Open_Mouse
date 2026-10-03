"""Pure geometry, blending and relative delighting helpers for photo atlases."""
import numpy as np
from scipy import ndimage


def boundary_gap(a, b, mm_per_pixel):
    """Symmetric boundary Hausdorff gap in the stated image-plane scale."""
    aa = np.asarray(a, bool) & ~ndimage.binary_erosion(a)
    bb = np.asarray(b, bool) & ~ndimage.binary_erosion(b)
    if not aa.any() or not bb.any():
        raise ValueError('Both boundaries must be nonempty')
    return float(max(ndimage.distance_transform_edt(~aa)[bb].max(),
                     ndimage.distance_transform_edt(~bb)[aa].max())*mm_per_pixel)


def triangle_pixels(points, size):
    """Pixel-centre barycentrics for one triangle; no outside extrapolation."""
    p = np.asarray(points, float)
    low = np.maximum(np.ceil(p.min(0)).astype(int), 0)
    high = np.minimum(np.floor(p.max(0)).astype(int), np.array(size)-1)
    if np.any(high < low):
        return np.array([], int), np.array([], int), np.empty((0, 3))
    x, y = np.meshgrid(np.arange(low[0], high[0]+1), np.arange(low[1], high[1]+1))
    x, y = x.ravel(), y.ravel()
    matrix = np.column_stack((p[0]-p[2], p[1]-p[2]))
    if abs(np.linalg.det(matrix)) < 1e-10:
        return np.array([], int), np.array([], int), np.empty((0, 3))
    weights = (np.column_stack((x, y))-p[2]) @ np.linalg.inv(matrix).T
    weights = np.column_stack((weights, 1-weights.sum(1)))
    keep = np.all(weights >= -1e-7, axis=1)
    return x[keep], y[keep], weights[keep]


def perspective_weights(barycentric, depths):
    weights = np.asarray(barycentric)/np.asarray(depths)
    inverse_depth = weights.sum(axis=-1)
    return weights/inverse_depth[..., None], 1/inverse_depth


def blend_weights(cosine, silhouette_distance, depth_error, depth_gradient,
                  power=4, feather=12, tolerance=.35):
    """Angle weighting, alpha-boundary feather, hard depth visibility and crease feather."""
    facing = np.maximum(cosine, 0)**power
    edge = np.clip(np.asarray(silhouette_distance)/feather, 0, 1)
    visible = np.abs(depth_error) <= tolerance
    crease = 1/(1+(np.asarray(depth_gradient)/.6)**2)
    return facing*edge*visible*crease


def sh_design(normals):
    """Real second-order SH span (unnormalised basis), including ambient."""
    x, y, z = np.asarray(normals).T
    return np.column_stack((np.ones(len(x)), x, y, z, x*y, y*z, x*z, x*x-y*y, 3*z*z-1))


def fit_shading(normals, luminance, regularization=.02):
    """Robust ridge fit of log luminance; median fixes the exposure ambiguity."""
    design = sh_design(normals)
    values = np.log(np.maximum(luminance, 1e-6))
    if len(values) < 20:
        raise ValueError('At least 20 flat-region samples are required')
    lo, hi = np.percentile(values, [8, 92]);keep = (values >= lo) & (values <= hi)
    penalty = np.eye(9)*regularization;penalty[0, 0] = 0
    for _ in range(5):
        a, b = design[keep], values[keep]
        coeff = np.linalg.solve(a.T@a/len(a)+penalty, a.T@b/len(a))
        residual = values-design@coeff
        mad = np.median(abs(residual[keep]-np.median(residual[keep])))
        keep = (values >= lo) & (values <= hi) & (abs(residual-np.median(residual[keep])) <= max(.08, 3*1.4826*mad))
    anchor = float(np.median(design[keep]@coeff))
    return coeff, anchor, keep


def shading_scale(normals, coefficients, anchor):
    # A bounded relative correction prevents extrapolation on unsampled normals.
    return np.exp(np.clip(sh_design(normals)@coefficients-anchor, -1.1, 1.1))


def normal_from_height(height, mask, strength=1.):
    """Tangent normal, image rows run opposite UV +V; outside padding stays flat."""
    h = np.asarray(height, float)
    dy, dx = np.gradient(h)
    vector = np.stack((-dx*strength, dy*strength, np.ones_like(h)), axis=-1)
    vector /= np.linalg.norm(vector, axis=-1, keepdims=True)
    vector[~np.asarray(mask, bool)] = [0, 0, 1]
    return vector*.5+.5


def region_ids(points, normals, luminance):
    """M550/M650 shared-family physical footprints, refined by visible ink colour.

    Geometry is in mm, nose +Y. The logo is bright ink within its top footprint;
    wheel and button regions are appearance only on the unchanged study loft.
    """
    x, y, z = np.asarray(points).T
    nz = np.asarray(normals)[:, 2]
    ids = np.ones(len(x), np.uint8)
    ids[(y > 3) & (z > 20)] = 2
    ids[(abs(x) > 17) & (nz < .62) & (z > 5)] = 5
    ids[(abs(x) < 5) & (y > 25) & (y < 46) & (z > 23)] = 3
    ids[(abs(x) < 7) & (y > -36) & (y < -20) & (nz > .5) & (luminance > .12)] = 4
    ids[(nz < -.35) | (z < 3)] = 6
    return ids
