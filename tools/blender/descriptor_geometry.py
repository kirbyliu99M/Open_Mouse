"""Pure GD-1 measurements of triangle shells in mm, X right, Y nose, Z up.

No file access, bpy, decoder, catalogue labels or validation data. See
DESCRIPTOR-GEOMETRY.md for the pre-registered sampling and thresholds.
"""
import math

import numpy as np


def validate_mesh_arrays(vertices, faces):
    """Return independent finite float vertices and integer triangle indices."""
    v = np.array(vertices, dtype=float, copy=True)
    f = np.array(faces, copy=True)
    if v.ndim != 2 or v.shape[1] != 3 or len(v) < 4 or not np.isfinite(v).all():
        raise ValueError("Expected at least four finite XYZ vertices")
    if (f.ndim != 2 or f.shape[1] != 3 or not len(f)
            or not np.issubdtype(f.dtype, np.integer)
            or f.min() < 0 or f.max() >= len(v)):
        raise ValueError("Expected valid integer triangle indices")
    # Unreferenced vertices must never become a peak or extend the body bounds.
    if len(np.unique(f)) != len(v):
        raise ValueError("Unreferenced vertices are not shell geometry")
    if np.any(np.ptp(v, axis=0) <= 0):
        raise ValueError("Shell must span all three axes")
    return v, f.astype(np.int64)


def plane_segments(triangles, axis, coordinate):
    """Intersect triangles with a plane; return segments including coplanar edges.

    Duplicate edges/points are harmless for the outer envelope measurements.
    Exact plane vertices are included, so a section through a mesh ring works.
    """
    triangles = np.asarray(triangles, dtype=float)
    if (triangles.ndim != 3 or triangles.shape[1:] != (3, 3)
            or not np.isfinite(triangles).all() or axis not in (0, 1, 2)
            or not math.isfinite(coordinate)):
        raise ValueError("Expected finite triangles, axis and plane")
    low = triangles[:, :, axis].min(axis=1)
    high = triangles[:, :, axis].max(axis=1)
    selected = triangles[(low <= coordinate) & (high >= coordinate)]
    segments = []
    for tri in selected:
        points = []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            a, b = tri[i], tri[j]
            da, db = a[axis] - coordinate, b[axis] - coordinate
            if da == 0:
                points.append(a)
            if da * db < 0:
                points.append(a + (b - a) * (-da / (db - da)))
        if len(points) == 2:
            segments.append(points)
        elif len(points) > 2:  # A coplanar triangle: all three boundary edges.
            segments.extend([[points[i], points[(i + 1) % len(points)]]
                             for i in range(len(points))])
    if not segments:
        raise ValueError("Plane does not intersect shell")
    return np.array(segments)


def section_wall_bounds(segments, height):
    """Return left/right exterior X at a Z height within a Y cross-section."""
    segments = np.asarray(segments, dtype=float)
    if (segments.ndim != 3 or segments.shape[1:] != (2, 3)
            or not np.isfinite(segments).all() or not math.isfinite(height)):
        raise ValueError("Expected finite section segments and height")
    xs = []
    for a, b in segments:
        da, db = a[2] - height, b[2] - height
        if da == 0:
            xs.append(a[0])
        if db == 0:
            xs.append(b[0])
        if da * db < 0:
            xs.append(a[0] + (b[0] - a[0]) * (-da / (db - da)))
    if len(xs) < 2 or max(xs) <= min(xs):
        raise ValueError("Missing two exterior walls at sample height")
    return np.array([min(xs), max(xs)])


def measure_shell(vertices, faces):
    """Measure peak fraction, plan-width ratio and sidewall bow/section height.

    Faces provide piecewise-linear surface interpolation, avoiding vertex-density
    bias in sections. Peak plateaus use the midpoint of their longitudinal span.
    Positive flare/bow means outward. Diagnostics preserve section asymmetry.
    """
    v, f = validate_mesh_arrays(vertices, faces)
    lo, hi = v.min(axis=0), v.max(axis=0)
    width, length, height = hi - lo
    # Work relative to the bbox to keep numeric tolerances translation-invariant.
    v -= lo
    triangles = v[f]
    peak = v[np.abs(v[:, 2] - height) <= height * 1e-9]
    peak_y = (peak[:, 1].min() + peak[:, 1].max()) / 2
    hump = float(1 - peak_y / length)

    def section(fraction):
        return plane_segments(triangles, 1, length * (1 - fraction))

    front = section(1 / 3)
    front_width = float(np.ptp(front[:, :, 0]))
    sections = []
    for t in np.linspace(.4, .6, 21):
        segments = section(float(t))
        z0, z1 = segments[:, :, 2].min(), segments[:, :, 2].max()
        section_height = z1 - z0
        if section_height <= 0:
            raise ValueError("Zero-height grip section")
        lower, middle, upper = [section_wall_bounds(segments, z0 + h * section_height)
                                for h in (.2, .5, .8)]
        chord = (lower + upper) / 2
        # Left's outward direction is -X, right's is +X.
        bow = (middle - chord) * np.array([-1., 1.])
        sections.append({
            "fractionFromFront": float(t),
            "widthMm": float(np.ptp(segments[:, :, 0])),
            "heightMm": float(section_height),
            "leftBowMm": float(bow[0]), "rightBowMm": float(bow[1]),
            "bowFraction": float(np.mean(bow) / section_height),
            "leftWallSlope": float((upper[0] - lower[0]) / (.6 * section_height)),
            "rightWallSlope": float((upper[1] - lower[1]) / (.6 * section_height)),
        })
    waist = min(sections, key=lambda s: s["widthMm"])
    return {
        "humpPeakFraction": hump,
        "peakSpanFromFront": [float(1 - peak[:, 1].max() / length),
                              float(1 - peak[:, 1].min() / length)],
        "peakLateralFraction": float(np.mean(peak[:, 0]) / width),
        "frontWidthMm": front_width,
        "gripWidthMm": waist["widthMm"],
        "gripFractionFromFront": waist["fractionFromFront"],
        "frontFlareRatio": front_width / waist["widthMm"] - 1,
        "sideCurvatureFraction": float(np.median([s["bowFraction"] for s in sections])),
        "dimensionsXYZmm": [float(width), float(length), float(height)],
        "gripSections": sections,
    }


def map_levels(hump, flare, curvature):
    """Fixed GD-1 rubric mapping; no per-model overrides or fitted parameters."""
    if not all(math.isfinite(x) for x in (hump, flare, curvature)) or not 0 <= hump <= 1:
        raise ValueError("Expected finite measures and a hump fraction in [0, 1]")
    hump_level = ("center" if hump <= .55 else "back_minimal" if hump <= .62
                  else "back_moderate" if hump <= .70 else "back_aggressive")
    if abs(flare) <= .025:
        flare_level = "flat"
    else:
        degree = "slight" if abs(flare) <= .075 else "moderate" if abs(flare) <= .15 else "aggressive"
        flare_level = ("outward_" if flare > 0 else "inward_") + degree
    if abs(curvature) <= .01:
        curvature_level = "flat"
    else:
        curvature_level = "outward" if curvature > 0 else "inward"
        if abs(curvature) > .08:
            curvature_level += "_aggressive"
    return {"humpPlacement": hump_level, "frontFlare": flare_level,
            "sideCurvature": curvature_level}
