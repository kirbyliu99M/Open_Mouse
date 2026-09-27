"""Pure desk-stability check: does a closed shell rest on its base?

Coordinates are metres, Z up. A shell that only touches the desk at one end
(as a tilted photo trace does) has its centre of mass outside the contact
footprint and would rock. A mouse's centre must sit well inside its feet.
"""


def centre_of_mass(vertices, triangles):
    """Centroid of the solid bounded by outward-wound triangles."""
    volume = 0.0
    total = [0.0, 0.0, 0.0]
    for a, b, c in triangles:
        p, q, r = vertices[a], vertices[b], vertices[c]
        v = (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6
        volume += v
        for axis in range(3):
            total[axis] += v * (p[axis] + q[axis] + r[axis]) / 4
    if volume <= 0:
        raise ValueError("Shell must be closed with outward normals")
    return [t / volume for t in total]


def convex_hull(points):
    """Counter-clockwise hull of 2D points (monotone chain)."""
    points = sorted(set(points))
    if len(points) < 3:
        return points

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def support_margin(vertices, triangles, contact=.0005):
    """Distance (m) from the centre of mass, projected onto the desk, to the
    edge of the contact footprint: vertices within `contact` of the lowest
    point. Negative means the centre lies outside and the shell would tip."""
    ground = min(v[2] for v in vertices)
    hull = convex_hull([(v[0], v[1]) for v in vertices if v[2] - ground <= contact])
    if len(hull) < 3:
        return float("-inf")
    x, y, _ = centre_of_mass(vertices, triangles)
    margin = float("inf")
    for i, (ax, ay) in enumerate(hull):
        bx, by = hull[(i + 1) % len(hull)]
        length = ((bx - ax) ** 2 + (by - ay) ** 2) ** .5
        margin = min(margin, ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / length)
    return margin
