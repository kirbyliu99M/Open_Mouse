"""Pure shell loft and canonical hand skeleton; coordinates are metres."""
import math


def top_profile(u, p):
    peak = p["peakU"]
    if u <= peak:
        t = u / peak
        return p["height"] * (p["frontHeight"] + (1 - p["frontHeight"]) * math.sin(t * math.pi / 2))
    t = (u - peak) / (1 - peak)
    return p["height"] * (p["rearHeight"] + (1 - p["rearHeight"]) * math.cos(t * math.pi / 2))


def section_point(u, angle, p):
    front, rear = p["frontCap"], p["rearCap"]
    cap = 1.0
    if u < front:
        cap = math.sqrt(max(0, 1 - (1 - u / front) ** 2))
    if u > 1 - rear:
        cap = math.sqrt(max(0, 1 - ((u - 1 + rear) / rear) ** 2))
    # A broad rear with a narrower grip waist; flare affects only the front.
    outline = 0.94 + 0.06 * math.exp(-((u - 0.68) / 0.22) ** 2)
    outline += p["flare"] * math.exp(-((u - 0.19) / 0.22) ** 2)
    c, s = math.cos(angle), math.sin(angle)
    x = math.copysign(abs(c) ** 0.60, c) * p["width"] * 0.5 * cap * outline
    base = p["height"] * 0.115
    if s >= 0:
        t = s ** 0.68
        z = base + (top_profile(u, p) - base) * t
        x *= 1 - p["concavity"] * math.exp(-((t - 0.26) / 0.25) ** 2)
        z -= p["tilt"] * p["handedness"] * (x / p["width"]) * p["height"] * t
        x += p["tilt"] * p["handedness"] * p["width"] * 0.18 * t * math.sin(math.pi * u)
    else:
        t = (-s) ** 0.22
        z = base * (1 - t)
    shelf = p["thumbShelf"] if x * p["handedness"] < 0 else p["ringShelf"]
    x *= 1 + shelf * math.exp(-((u - 0.48) / 0.20) ** 2) * math.exp(-((z / p["height"] - 0.12) / 0.15) ** 2)
    return (x, (u - 0.5) * p["length"], z)


def shell_loft(p, rings=48, segments=48):
    if rings < 4 or segments < 8 or segments % 4:
        raise ValueError("Need at least 4 rings and a multiple of 4 angular segments")
    vertices = [(0, -p["length"] / 2, top_profile(0, p) * 0.5)]
    for i in range(1, rings):
        u = i / rings
        for j in range(segments):
            vertices.append(section_point(u, 2 * math.pi * j / segments, p))
    end = len(vertices)
    vertices.append((0, p["length"] / 2, top_profile(1, p) * 0.5))
    faces = []
    for j in range(segments):
        faces.append((0, 1 + j, 1 + (j + 1) % segments))
    for i in range(rings - 2):
        a, b = 1 + i * segments, 1 + (i + 1) * segments
        for j in range(segments):
            n = (j + 1) % segments
            faces.append((a + j, b + j, b + n, a + n))
    last = 1 + (rings - 2) * segments
    for j in range(segments):
        faces.append((last + j, end, last + (j + 1) % segments))
    return vertices, faces


# Authored neutral adult right hand; not an anatomical dataset or a user scan.
HAND_POINTS_MM = [
    (0, 0, 0), (-20, 28, -2), (-39, 48, -3), (-53, 65, -5), (-64, 81, -7),
    (-25, 75, 0), (-26, 113, -1), (-26, 137, -2), (-26, 158, -3),
    (-6, 81, 1), (-6, 124, 0), (-6, 152, -1), (-6, 176, -2),
    (14, 77, 0), (16, 117, -1), (17, 143, -2), (18, 165, -3),
    (32, 68, -2), (37, 99, -3), (40, 120, -4), (42, 138, -5),
]
HAND_CHAINS = [list(range(start, start + 4)) for start in (1, 5, 9, 13, 17)]


def hand_skeleton():
    points = [tuple(value / 1000 for value in point) for point in HAND_POINTS_MM]
    edges = []
    for chain in HAND_CHAINS:
        edges.extend(zip([0] + chain[:-1], chain))
    return points, list(edges)
