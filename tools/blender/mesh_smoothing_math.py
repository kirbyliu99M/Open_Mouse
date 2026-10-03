"""Taubin (lambda/mu) mesh smoothing; no Blender dependency.

A voxel-carved, marching-cubes mesh is blocky. Plain Laplacian smoothing
shrinks it and erodes the silhouette; Taubin's two-pass lambda/mu update
(a small inflate step after every shrink step) removes the staircasing
while keeping the model close to its original size. Vertices in `pinned`
(the flat Z=0 base, by convention) never move, so the ground plane and
support footprint survive smoothing exactly.
"""
import numpy as np
from scipy import sparse


def vertex_adjacency(n_vertices, faces):
    """Unweighted, symmetric vertex-vertex adjacency as a sparse CSR matrix."""
    faces = np.asarray(faces, dtype=np.int64)
    if faces.ndim != 2 or faces.shape[1] != 3:
        raise ValueError('Triangular faces (N, 3) are required')
    if faces.size and (faces.min() < 0 or faces.max() >= n_vertices):
        raise ValueError('Face indices out of range')
    i = np.concatenate([faces[:, 0], faces[:, 1], faces[:, 2], faces[:, 1], faces[:, 2], faces[:, 0]])
    j = np.concatenate([faces[:, 1], faces[:, 2], faces[:, 0], faces[:, 0], faces[:, 1], faces[:, 2]])
    data = np.ones(len(i))
    adjacency = sparse.coo_matrix((data, (i, j)), shape=(n_vertices, n_vertices)).tocsr()
    adjacency.data[:] = 1  # collapse duplicate edges (shared between two triangles) to a single weight
    adjacency.setdiag(0)
    adjacency.eliminate_zeros()
    return adjacency


def laplacian_step(vertices, adjacency, factor, pinned=None):
    """One uniform-weight Laplacian update: v_i += factor*(mean(neighbours)-v_i).
    Isolated vertices (no neighbours) and `pinned` vertices are left in place."""
    vertices = np.asarray(vertices, dtype=float)
    degree = np.asarray(adjacency.sum(axis=1)).ravel()
    safe_degree = np.where(degree > 0, degree, 1)
    mean_neighbour = adjacency @ vertices/safe_degree[:, None]
    delta = factor*(mean_neighbour-vertices)
    delta[degree == 0] = 0
    if pinned is not None:
        delta[np.asarray(pinned, bool)] = 0
    return vertices+delta


def taubin_smooth(vertices, faces, iterations=10, lam=0.5, mu=-0.53, pinned=None):
    """Alternating shrink (lambda>0) / inflate (mu<0, |mu|>lambda) passes.
    Returns a new vertex array; `faces`/topology are unchanged."""
    if iterations < 0:
        raise ValueError('iterations must be nonnegative')
    if not (lam > 0 and mu < 0):
        raise ValueError('lambda must be positive and mu negative for the Taubin filter')
    adjacency = vertex_adjacency(len(vertices), faces)
    result = np.asarray(vertices, dtype=float).copy()
    for _ in range(iterations):
        result = laplacian_step(result, adjacency, lam, pinned)
        result = laplacian_step(result, adjacency, mu, pinned)
    return result
