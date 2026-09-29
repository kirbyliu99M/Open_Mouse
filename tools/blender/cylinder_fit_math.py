"""Pure numpy least-squares cylinder fit for Phase D5b (wheel crowns as a separate feature).

No bpy dependency, so this is unit-testable outside Blender. Given a point cloud sampled
from a wheel's outer tread, `fit_cylinder` recovers the axis direction, a point on the axis,
the radius, and the fit residual (each point's radial distance from the fitted axis minus
the fitted radius). `axis_extent` then measures how far the points span along that axis, for
sizing the built cylinder's width.

Method: initialise the axis from the smallest-variance principal component (a wheel is much
wider across its tread than along its axle for typical scroll wheels... the reverse holds
here since a thin wheel is short along its axis and roughly circular across the tread, so the
axis is the direction of *least* point spread) and the radius from the mean perpendicular
distance, then refine with a few Gauss-Newton steps on a local (2 DOF axis direction, 2 DOF
axis position, 1 DOF radius) parametrisation, re-orthonormalised each iteration so the
5-parameter update never fights the axis's own two redundant degrees of freedom (rotation
about itself, translation along itself).
"""
import numpy as np


def _perp_basis(axis):
    axis = axis / np.linalg.norm(axis)
    seed = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(axis, seed)
    u = u / np.linalg.norm(u)
    v = np.cross(axis, u)
    return u, v


def _radial_distances(points, axis, origin, radius):
    axis = axis / np.linalg.norm(axis)
    rel = points - origin
    proj = rel @ axis
    perp = rel - np.outer(proj, axis)
    return np.linalg.norm(perp, axis=1) - radius


def fit_cylinder(points, iterations=30, tol=1e-12):
    """Least-squares cylinder fit. `points` is (N, 3). Returns axis (unit 3-vector), a
    point on the axis (`center`), `radius`, per-point signed `residuals` (mm-equivalent in
    the input's own units), `rms` and `max_abs` residual magnitude.
    """
    points = np.asarray(points, float)
    if len(points) < 6:
        raise ValueError('Need at least 6 points to fit a cylinder')
    centroid = points.mean(axis=0)
    centered = points - centroid
    cov = centered.T @ centered
    eigvals, eigvecs = np.linalg.eigh(cov)
    axis = eigvecs[:, 0]  # smallest-eigenvalue direction: the initial axis guess
    origin = centroid.copy()
    u, v = _perp_basis(axis)
    rel = points - origin
    perp = rel - np.outer(rel @ axis, axis)
    radius = float(np.mean(np.linalg.norm(perp, axis=1)))

    for _ in range(iterations):
        u, v = _perp_basis(axis)

        def residual_fn(params, axis=axis, origin=origin, radius=radius, u=u, v=v):
            du, dv, da, db, dr = params
            new_axis = axis + du * u + dv * v
            new_axis = new_axis / np.linalg.norm(new_axis)
            new_origin = origin + da * u + db * v
            new_radius = radius + dr
            return _radial_distances(points, new_axis, new_origin, new_radius)

        params0 = np.zeros(5)
        r0 = residual_fn(params0)
        eps = 1e-6
        jacobian = np.empty((len(points), 5))
        for k in range(5):
            step = params0.copy()
            step[k] = eps
            jacobian[:, k] = (residual_fn(step) - r0) / eps
        jtj = jacobian.T @ jacobian + 1e-10 * np.eye(5)
        jtr = jacobian.T @ r0
        try:
            delta = np.linalg.solve(jtj, -jtr)
        except np.linalg.LinAlgError:
            break
        du, dv, da, db, dr = delta
        axis = axis + du * u + dv * v
        axis = axis / np.linalg.norm(axis)
        origin = origin + da * u + db * v
        radius = radius + dr
        if np.linalg.norm(delta) < tol:
            break

    residuals = _radial_distances(points, axis, origin, radius)
    return dict(axis=axis, center=origin, radius=float(radius), residuals=residuals,
                rms=float(np.sqrt(np.mean(residuals ** 2))), max_abs=float(np.max(np.abs(residuals))))


def fit_cylinder_fixed_axis(points, axis=(1.0, 0.0, 0.0), iterations=30, tol=1e-12):
    """Cylinder fit with the axis direction held fixed (only the axis position, in the two
    directions perpendicular to it, and the radius are solved for). 3 degrees of freedom
    instead of `fit_cylinder`'s 5, which is far better conditioned for a candidate point set
    that only covers a partial arc of the tread (a free axis direction is poorly constrained
    by an arc; a known axis, e.g. a scroll wheel's lateral rotation axis, is not).
    """
    points = np.asarray(points, float)
    if len(points) < 4:
        raise ValueError('Need at least 4 points to fit a cylinder at a fixed axis')
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    u, v = _perp_basis(axis)
    centroid = points.mean(axis=0)
    origin = centroid - (np.dot(centroid, axis)) * axis  # any point on the axis line through the origin's perp offset
    rel = points - origin
    perp = rel - np.outer(rel @ axis, axis)
    radius = float(np.mean(np.linalg.norm(perp, axis=1)))

    for _ in range(iterations):
        def residual_fn(params, origin=origin, radius=radius):
            da, db, dr = params
            new_origin = origin + da * u + db * v
            new_radius = radius + dr
            return _radial_distances(points, axis, new_origin, new_radius)

        params0 = np.zeros(3)
        r0 = residual_fn(params0)
        eps = 1e-6
        jacobian = np.empty((len(points), 3))
        for k in range(3):
            step = params0.copy()
            step[k] = eps
            jacobian[:, k] = (residual_fn(step) - r0) / eps
        jtj = jacobian.T @ jacobian + 1e-10 * np.eye(3)
        jtr = jacobian.T @ r0
        try:
            delta = np.linalg.solve(jtj, -jtr)
        except np.linalg.LinAlgError:
            break
        da, db, dr = delta
        origin = origin + da * u + db * v
        radius = radius + dr
        if np.linalg.norm(delta) < tol:
            break

    residuals = _radial_distances(points, axis, origin, radius)
    return dict(axis=axis, center=origin, radius=float(radius), residuals=residuals,
                rms=float(np.sqrt(np.mean(residuals ** 2))), max_abs=float(np.max(np.abs(residuals))))


def robust_fit_cylinder(points, iterations=4, keep_fraction=0.7, min_points=20, fit_iterations=30, fit_fn=None):
    """Trimmed iterative refit: fit, drop the worst-residual fraction of points, refit.

    Used when the candidate point cloud mixes genuine cylinder (tread) points with a
    minority of contaminating non-cylindrical points (e.g. an adjoining slot wall that a
    proximity crop also picked up). Returns `(fit, inlier_points)` from the final round.
    `fit_fn` defaults to `fit_cylinder`; pass e.g. `fit_cylinder_fixed_axis` to keep the
    axis constrained throughout the trimming.
    """
    fit_fn = fit_fn or (lambda pts: fit_cylinder(pts, iterations=fit_iterations))
    points = np.asarray(points, float)
    current = points
    fit = fit_fn(current)
    for _ in range(iterations):
        if len(current) <= min_points:
            break
        keep = max(min_points, int(len(current) * keep_fraction))
        order = np.argsort(np.abs(fit['residuals']))
        current = current[order[:keep]]
        fit = fit_fn(current)
    return fit, current


def axis_extent(points, axis, origin):
    """Span of `points` projected onto `axis` (through `origin`): (midpoint, width)."""
    points = np.asarray(points, float)
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    proj = (points - origin) @ axis
    lo, hi = float(proj.min()), float(proj.max())
    midpoint = origin + axis * (lo + hi) / 2
    return midpoint, hi - lo
