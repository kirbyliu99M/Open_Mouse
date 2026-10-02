"""Pure NumPy GD-2 front flare and transverse sidewall curvature; no hump code."""
import math

import numpy as np

from descriptor_geometry import plane_segments, section_wall_bounds, validate_mesh_arrays

FLARE_BOUNDS = (.025, .075, .15)
CURVATURE_BOUNDS = (.025, .10)


def band_width(segments, lower, upper):
    """Exact X extent of section segments clipped to a closed Z band."""
    segments = np.asarray(segments, dtype=float)
    if (segments.ndim != 3 or segments.shape[1:] != (2, 3)
            or not np.isfinite(segments).all()
            or not math.isfinite(lower) or not math.isfinite(upper) or lower >= upper):
        raise ValueError("Expected finite section segments and increasing band")
    xs = []
    for a, b in segments:
        for p in (a, b):
            if lower <= p[2] <= upper:
                xs.append(p[0])
        for z in (lower, upper):
            if (a[2] - z) * (b[2] - z) < 0:
                xs.append(a[0] + (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]))
    if len(xs) < 2 or max(xs) <= min(xs):
        raise ValueError("Missing body width inside band")
    return float(max(xs) - min(xs))


def wall_bow(heights, outward_x):
    """Quadratic mid-chord sagitta / wall-band height, plus mean slope and RMS.

    Fit equally weighted height samples, not mesh vertices. For q in [0, 1],
    x=a*q^2+b*q+c has midpoint departure -a/4 from its endpoint chord.
    A positive sagitta is convex/outward; adding linear taper changes no bow.
    """
    z, x = np.asarray(heights, dtype=float), np.asarray(outward_x, dtype=float)
    if (z.ndim != 1 or x.shape != z.shape or len(z) < 3
            or not np.isfinite(z).all() or not np.isfinite(x).all()
            or np.any(np.diff(z) <= 0)):
        raise ValueError("Expected at least three ordered finite wall samples")
    span = z[-1] - z[0]
    q = (z - z[0]) / span
    a, b, c = np.linalg.lstsq(np.column_stack([q*q, q, np.ones_like(q)]),
                            x - x[0], rcond=None)[0]
    residual = x - x[0] - (a*q*q + b*q + c)
    return {"bowFraction": float(-a / (4 * span)), "slope": float((a+b) / span),
            "fitRmsFraction": float(np.sqrt(np.mean(residual**2)) / span)}


def combine_walls(left, right):
    """Keep the stronger persistent wall; explicitly flag conflicting signs.

    Opposing non-flat walls have no honest single direction: conservative flat,
    with conflict retained for review. No signed averaging can silently cancel.
    """
    if not all(math.isfinite(v) for v in (left, right)):
        raise ValueError("Expected finite wall measures")
    conflict = left * right < 0 and min(abs(left), abs(right)) > CURVATURE_BOUNDS[0]
    value = 0. if conflict else (left if abs(left) >= abs(right) else right)
    return float(value), bool(conflict)


def map_levels_gd2(flare, curvature):
    """Frozen GD-2 mapping. Hump is deliberately absent."""
    if not all(math.isfinite(v) for v in (flare, curvature)):
        raise ValueError("Expected finite measures")
    if abs(flare) <= FLARE_BOUNDS[0]:
        flare_level = "flat"
    else:
        degree = ("slight" if abs(flare) <= FLARE_BOUNDS[1] else
                  "moderate" if abs(flare) <= FLARE_BOUNDS[2] else "aggressive")
        flare_level = ("outward_" if flare > 0 else "inward_") + degree
    if abs(curvature) <= CURVATURE_BOUNDS[0]:
        curvature_level = "flat"
    else:
        curvature_level = "outward" if curvature > 0 else "inward"
        if abs(curvature) > CURVATURE_BOUNDS[1]:
            curvature_level += "_aggressive"
    return {"frontFlare": flare_level, "sideCurvature": curvature_level}


def measure_shell_gd2(vertices, faces):
    """Measure only the redesigned descriptors in the unchanged Blender frame."""
    v, f = validate_mesh_arrays(vertices, faces)
    v -= v.min(axis=0)
    dimensions = np.ptp(v, axis=0)
    triangles = v[f]

    def section(t):
        seg = plane_segments(triangles, 1, dimensions[1] * (1-t))
        z0, z1 = seg[:, :, 2].min(), seg[:, :, 2].max()
        if z1 <= z0:
            raise ValueError("Zero-height section")
        return seg, z0, z1-z0

    front = []
    for t in np.linspace(.2, 1/3, 15):
        seg, z0, h = section(t)
        front.append({"fractionFromFront": float(t),
                      "bodyWidthMm": band_width(seg, z0 + .3*h, z0 + .7*h)})
    grip = []
    for t in np.linspace(.4, .6, 21):
        seg, z0, h = section(t)
        heights = z0 + np.linspace(.25, .55, 13) * h
        walls = np.array([section_wall_bounds(seg, z) for z in heights])
        left = wall_bow(heights, -walls[:, 0])
        right = wall_bow(heights, walls[:, 1])
        grip.append({"fractionFromFront": float(t), "heightMm": float(h),
                     "bodyWidthMm": band_width(seg, z0 + .3*h, z0 + .7*h),
                     "leftWall": left, "rightWall": right})
    widths = [s["bodyWidthMm"] for s in grip]
    smoothed = [float(np.median(widths[i-2:i+3])) for i in range(2, 19)]
    waist_index = int(np.argmin(smoothed))
    waist = smoothed[waist_index]
    front_width = float(np.median([s["bodyWidthMm"] for s in front]))
    left, right = [float(np.median([s[wall]["bowFraction"] for s in grip]))
                   for wall in ("leftWall", "rightWall")]
    curvature, conflict = combine_walls(left, right)
    return {"frontFlareRatio": front_width / waist - 1,
            "frontWidthMm": front_width, "gripWidthMm": waist,
            "gripFractionFromFront": grip[waist_index+2]["fractionFromFront"],
            "sideCurvatureFraction": curvature, "leftWallBowFraction": left,
            "rightWallBowFraction": right, "opposingWallConflict": conflict,
            "dimensionsXYZmm": dimensions.tolist(), "frontSections": front,
            "gripSections": grip}
