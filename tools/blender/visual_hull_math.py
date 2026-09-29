"""Visual-hull voxel carving and robust multi-view voting; no image or Blender
dependency. World coordinates are millimetres, Z up, base at Z=0.

Carving tests a voxel-centre grid against each fitting-role photo's silhouette
mask, using the frozen perspective camera for that photo (`photo_camera_math`).
Because near-duplicate photos of the same physical setup are correlated
observations rather than independent evidence (see STUDY-FIDELITY.md D1b),
duplicate-group photos are collapsed to a single vote per group before the
vote is weighted and thresholded. A voxel survives unless enough weighted
group votes reject it.
"""
import numpy as np


def voxel_grid(dimensions_mm, voxel_size_mm):
    """Cell centres filling a box of `dimensions_mm`, base at Z=0, XY centred
    at 0 like `study_deformation_math.calibrate_bbox`. Returns per-axis centre
    coordinate arrays and the (sx, sy, sz) cell spacing actually used (at most
    `voxel_size_mm`, so the box is covered by a whole number of cells)."""
    dims = np.asarray(dimensions_mm, dtype=float)
    if dims.shape != (3,) or np.any(dims <= 0) or voxel_size_mm <= 0:
        raise ValueError('Positive XYZ dimensions and a positive voxel size are required')
    counts = np.maximum(2, np.ceil(dims/voxel_size_mm).astype(int))
    spacing = dims/counts
    xs = (np.arange(counts[0])+.5)*spacing[0]-dims[0]/2
    ys = (np.arange(counts[1])+.5)*spacing[1]-dims[1]/2
    zs = (np.arange(counts[2])+.5)*spacing[2]
    return xs, ys, zs, tuple(spacing)


def grid_points(xs, ys, zs):
    """Flatten the three axis arrays to an (N, 3) point cloud in 'ij'-index
    (X fastest-varying-last) order matching `np.reshape(..., (nx, ny, nz))`."""
    gx, gy, gz = np.meshgrid(xs, ys, zs, indexing='ij')
    return np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)


def reject_by_mask(points_xy, mask):
    """True where a projected point falls outside the image or outside the
    (already full-resolution, boolean) silhouette mask. Nearest-pixel lookup,
    matching `raster_silhouette`'s own `np.rint` convention."""
    mask = np.asarray(mask, bool)
    h, w = mask.shape
    px = np.rint(points_xy[:, 0]).astype(np.int64)
    py = np.rint(points_xy[:, 1]).astype(np.int64)
    inside = (px >= 0) & (px < w) & (py >= 0) & (py < h)
    reject = np.ones(len(points_xy), bool)
    reject[inside] = ~mask[py[inside], px[inside]]
    return reject


def group_reject_votes(photo_reject, group_ids, rule='majority'):
    """Collapse per-photo reject votes (photos x voxels, bool) into one
    reject vote per duplicate group (groups x voxels, bool). `rule` is
    'majority' (more than half of the group's photos reject), 'any' (at
    least one photo rejects) or 'all' (every photo in the group rejects).
    `group_ids` holds each photo's 0-based group index; a photo with no
    duplicates is its own singleton group."""
    photo_reject = np.asarray(photo_reject, bool)
    group_ids = np.asarray(group_ids, int)
    if photo_reject.ndim != 2 or group_ids.shape != (photo_reject.shape[0],):
        raise ValueError('photo_reject rows must match group_ids')
    if rule not in ('majority', 'any', 'all'):
        raise ValueError("rule must be 'majority', 'any' or 'all'")
    n_groups = int(group_ids.max())+1 if len(group_ids) else 0
    result = np.zeros((n_groups, photo_reject.shape[1]), bool)
    for g in range(n_groups):
        members = photo_reject[group_ids == g]
        if not len(members):
            continue
        if rule == 'any':
            result[g] = members.any(axis=0)
        elif rule == 'all':
            result[g] = members.all(axis=0)
        else:
            result[g] = members.sum(axis=0)*2 > len(members)
    return result


def weighted_votes(group_reject, weights):
    """Per-voxel sum of rejecting groups' weights."""
    group_reject = np.asarray(group_reject, bool)
    weights = np.asarray(weights, float)
    if weights.shape != (group_reject.shape[0],) or np.any(weights < 0):
        raise ValueError('One nonnegative weight per group is required')
    return weights @ group_reject


def carve(votes, total_weight, threshold):
    """A voxel survives unless its weighted reject vote exceeds `threshold`
    (a weight, not a fraction). `threshold=0` carves on any rejecting group;
    `threshold` approaching `total_weight` tolerates near-unanimous rejection."""
    votes = np.asarray(votes, float)
    if not 0 <= threshold <= total_weight:
        raise ValueError('threshold must lie within [0, total_weight]')
    return votes <= threshold + 1e-9


def occupancy_volume(survive, shape):
    """Reshape a flat survive/reject boolean array back to the (nx, ny, nz)
    grid, matching `grid_points`'s 'ij' ordering."""
    survive = np.asarray(survive, bool)
    if survive.shape != (np.prod(shape),):
        raise ValueError('survive must have nx*ny*nz elements')
    return survive.reshape(shape)


def signed_volume(vertices, faces):
    """Six times the signed volume enclosed by the (triangulated) mesh, using
    the divergence theorem; positive for outward-wound triangles."""
    vertices = np.asarray(vertices, dtype=float)
    faces = np.asarray(faces, dtype=np.int64)
    a, b, c = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    return float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum())


def orient_outward(vertices, faces):
    """Flip every triangle's winding if the mesh's signed volume is negative,
    so normals point outward (as `bmesh`'s `calc_volume(signed=True)` and
    the delivery gate's mesh validation expect). `marching_cubes`'s winding
    convention is a documented implementation detail, not a physical one."""
    faces = np.asarray(faces, dtype=np.int64)
    if signed_volume(vertices, faces) < 0:
        faces = faces[:, ::-1].copy()
    return faces


def pad_for_marching_cubes(volume):
    """One empty voxel border on every side, so `skimage.measure.marching_cubes`
    always closes the surface, including a flat cap at the true Z=0 base
    (the padded layer below is uniformly empty, so the isosurface between it
    and a uniformly occupied bottom layer falls at one consistent height)."""
    volume = np.asarray(volume, bool)
    padded = np.zeros(np.array(volume.shape)+2, bool)
    padded[1:-1, 1:-1, 1:-1] = volume
    return padded
