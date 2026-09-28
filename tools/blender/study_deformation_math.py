"""Smooth, bounded D1 loft deformations in mm; no image or Blender dependency."""
import numpy as np


def calibrate_bbox(vertices, dimensions):
    points = np.asarray(vertices, dtype=float)
    dims = np.asarray(dimensions, dtype=float)
    spans = np.ptp(points, axis=0)
    if points.ndim != 2 or points.shape[1] != 3 or dims.shape != (3,) or np.any(spans <= 0) or np.any(dims <= 0):
        raise ValueError('A nondegenerate 3D mesh and positive XYZ dimensions are required')
    result = (points-points.min(0))/spans*dims
    result[:,:2] -= dims[:2]/2
    return result


def deformation_basis(vertices):
    """12 smooth displacement fields: shoulder width, roof, shoulder height,
    and upper-shell longitudinal shift at rear/middle/front stations.

    Fields vanish at ground Z=0 and depend only on position, preserving UV seam
    duplicates. Coefficients have mm units. No independent vertex noise.
    """
    v = np.asarray(vertices, dtype=float)
    low = v.min(0)
    span = np.ptp(v, axis=0)
    if np.any(span <= 0):
        raise ValueError('Degenerate mesh bounds')
    u = (v-low)/span
    x, y, z = u[:,0]*2-1, u[:,1], u[:,2]
    stations = np.exp(-.5*((y[:,None]-np.array([.2,.5,.8]))/.22)**2)
    basis = np.zeros((len(v),3,12))
    basis[:,0,0:3] = stations*(x*np.sin(np.pi*z))[:,None]
    basis[:,2,3:6] = stations*z[:,None]
    basis[:,2,6:9] = stations*(z*x*x)[:,None]
    basis[:,1,9:12] = stations*z[:,None]
    return basis


def deform(vertices, coefficients, dimensions, basis=None):
    params = np.asarray(coefficients, dtype=float)
    if params.shape != (12,) or not np.isfinite(params).all() or np.any(abs(params)>5):
        raise ValueError('12 finite deformation coefficients bounded to +/-5 mm required')
    if basis is None:
        basis = deformation_basis(vertices)
    moved = np.asarray(vertices)+np.einsum('vcp,p->vc',basis,params)
    if np.any(moved[:,2] < np.min(vertices,axis=0)[2]-1e-9):
        raise ValueError('Deformation crosses the ground plane')
    return calibrate_bbox(moved, dimensions)


def delivery_gate(before, after, held_before, held_after):
    """Unrelaxed D1 gate. All fitted photos and all held-out photos must count."""
    a,b = np.asarray(before,float),np.asarray(after,float)
    h,k = np.atleast_1d(held_before).astype(float),np.atleast_1d(held_after).astype(float)
    if a.shape != b.shape or h.shape != k.shape or not a.size or not h.size:
        raise ValueError('Paired nonempty fitting and held-out scores required')
    if not all(np.isfinite(x).all() and np.all((x>=0)&(x<=1)) for x in (a,b,h,k)):
        raise ValueError('IoU must be finite and in [0,1]')
    reasons = []
    if np.any(b-a < -.002):
        reasons.append('A fitted view drops by more than 0.002')
    if b.mean() <= a.mean():
        reasons.append('Mean fitted IoU does not improve')
    if np.any(k <= h):
        reasons.append('Held-out IoU does not improve')
    return dict(passed=not reasons, reasons=reasons, meanBefore=float(a.mean()),
                meanAfter=float(b.mean()), worstFittedDelta=float((b-a).min()),
                heldOutDeltas=(k-h).tolist())
