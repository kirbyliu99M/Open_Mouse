"""Pure numpy helpers for Phase D4 local remeshing: target selection, ring-distance
blending and displacement safety clamps. Raycasting and bmesh topology edits are done
in Blender (d4_local_remesh.py); everything testable without bpy lives here.
"""
import numpy as np


def target_mask(signed_mm, inside_threshold_mm=1.0):
    """Vertices sitting inside the source by more than the threshold (signed_mm < 0 is inside)."""
    return np.asarray(signed_mm, float) < -abs(inside_threshold_mm)


def ring_distances(adjacency, seed_mask):
    """BFS ring distance (edge count) from any seed vertex. `adjacency[i]` lists neighbour indices.

    Unreached vertices get -1.
    """
    seed_mask = np.asarray(seed_mask, bool)
    n = len(adjacency)
    dist = np.full(n, -1, dtype=int)
    dist[seed_mask] = 0
    frontier = list(np.nonzero(seed_mask)[0])
    ring = 0
    while frontier:
        ring += 1
        nxt = []
        for v in frontier:
            for nb in adjacency[v]:
                if dist[nb] == -1:
                    dist[nb] = ring
                    nxt.append(nb)
        frontier = nxt
    return dist


def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def blend_weight(ring_dist, inner_ring, outer_ring):
    """1.0 within inner_ring, smooth falloff to 0.0 at outer_ring, 0 beyond and for unreached (-1)."""
    ring_dist = np.asarray(ring_dist, float)
    span = max(outer_ring - inner_ring, 1e-9)
    t = (outer_ring - ring_dist) / span
    w = smoothstep(t)
    w = np.where(ring_dist <= inner_ring, 1.0, w)
    w = np.where(ring_dist >= outer_ring, 0.0, w)
    w = np.where(ring_dist < 0, 0.0, w)
    return w


def blend_positions(original, projected, weight):
    """Blend two (N, 3) position arrays by a per-vertex weight in [0, 1]."""
    weight = np.asarray(weight, float).reshape(-1, 1)
    return np.asarray(original, float) * (1 - weight) + np.asarray(projected, float) * weight


def clamp_displacement(original, proposed, max_mm):
    """Clamp a proposed position to at most max_mm away from the original (metre-scale arrays;
    max_mm is given in millimetres for readability at call sites, converted internally)."""
    original = np.asarray(original, float)
    proposed = np.asarray(proposed, float)
    delta = proposed - original
    length = np.linalg.norm(delta, axis=-1, keepdims=True)
    max_m = max_mm / 1000.0
    scale = np.minimum(1.0, max_m / np.maximum(length, 1e-12))
    return original + delta * scale
