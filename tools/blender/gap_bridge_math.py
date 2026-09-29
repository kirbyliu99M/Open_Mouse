"""D6b: separate real missing material from gap bridging among the D0 audit's "inside" samples.

D0 signs each shell sample by the normal of the nearest AR-source point: negative ("inside",
the shell misses a bump) when the shell lies behind that face. Where the shell bridges a
slot, a seam or the wheel well, the nearest source surface is a gap wall or the inner wall of
the housing, whose normal faces into the product, so a bridging sample is signed "inside"
although nothing is missing above it.

A sample is real missing material only if the product's outer skin lies just outside it:
a ray from the sample along the shell's outward normal must hit a source face that also faces
outward along the ray (outer skin seen from within), at a depth consistent with the sample's
measured distance. Without the depth condition, rays pass through the slot and meet some far
outer skin 7-13 mm away, which is how the artefact passed D4's earlier ray check.
Pure numpy; lengths in mm.
"""
import numpy as np

T_MIN_MM = .05


def triangle_normals(triangles):
    tri = np.asarray(triangles, float)
    n = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0])
    length = np.linalg.norm(n, axis=1, keepdims=True)
    return n/np.maximum(length, 1e-15)


def first_hit(origin, direction, triangles, t_max):
    """Nearest ray-triangle hit (Moller-Trumbore) with T_MIN_MM < t <= t_max.

    Returns (t, triangle index), or (inf, -1) when nothing is hit.
    """
    tri = np.asarray(triangles, float)
    o, d = np.asarray(origin, float), np.asarray(direction, float)
    v0 = tri[:, 0]
    e1, e2 = tri[:, 1]-v0, tri[:, 2]-v0
    p = np.cross(d, e2)
    det = (e1*p).sum(1)
    ok = abs(det) > 1e-12
    inv = np.where(ok, 1/np.where(ok, det, 1), 0)
    s = o-v0
    u = (s*p).sum(1)*inv
    q = np.cross(s, e1)
    v = (d*q).sum(1)*inv
    t = (e2*q).sum(1)*inv
    hit = ok & (u >= 0) & (v >= 0) & (u+v <= 1) & (t > T_MIN_MM) & (t <= t_max)
    if not hit.any():
        return np.inf, -1
    k = np.flatnonzero(hit)[np.argmin(t[hit])]
    return float(t[k]), int(k)


def classify_inside_samples(points, shell_normals, depth_mm, source_triangles,
                            t_max=15., depth_tolerance=1.5):
    """Label each "inside" sample 'missing-material' or 'bridges-gap'.

    points: (N,3) shell samples flagged inside; shell_normals: (N,3) outward unit normals of
    the shell at those samples; depth_mm: (N,) their unsigned distance to the source.
    """
    pts = np.asarray(points, float)
    ns = np.asarray(shell_normals, float)
    depth = np.abs(np.asarray(depth_mm, float))
    if pts.shape != ns.shape or pts.ndim != 2 or pts.shape[1] != 3 or depth.shape != (len(pts),):
        raise ValueError('points and normals (N,3) and depths (N,) required')
    tri = np.asarray(source_triangles, float)
    tn = triangle_normals(tri)
    labels = []
    for p, n, dist in zip(pts, ns, depth):
        t, k = first_hit(p, n, tri, t_max)
        real = np.isfinite(t) and float(tn[k] @ n) > 0 and t <= dist+depth_tolerance
        labels.append('missing-material' if real else 'bridges-gap')
    return labels
