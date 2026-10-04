import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mesh_smoothing_math import laplacian_step, taubin_smooth, vertex_adjacency


def octahedron():
    vertices = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], float)
    faces = np.array([
        [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
        [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
    ])
    return vertices, faces


class AdjacencyTests(unittest.TestCase):
    def test_symmetric_unweighted_no_self_loops(self):
        vertices, faces = octahedron()
        adjacency = vertex_adjacency(len(vertices), faces)
        dense = adjacency.toarray()
        np.testing.assert_array_equal(dense, dense.T)
        self.assertEqual(np.diag(dense).sum(), 0)
        # Every octahedron vertex has 4 neighbours.
        np.testing.assert_array_equal(dense.sum(axis=1), [4, 4, 4, 4, 4, 4])
        self.assertTrue(set(np.unique(dense[dense > 0]).tolist()) <= {1})

    def test_rejects_bad_faces(self):
        with self.assertRaises(ValueError):
            vertex_adjacency(3, [[0, 1]])
        with self.assertRaises(ValueError):
            vertex_adjacency(3, [[0, 1, 5]])


class LaplacianStepTests(unittest.TestCase):
    def test_zero_factor_is_identity(self):
        vertices, faces = octahedron()
        adjacency = vertex_adjacency(len(vertices), faces)
        result = laplacian_step(vertices, adjacency, 0.0)
        np.testing.assert_allclose(result, vertices)

    def test_moves_toward_neighbour_mean(self):
        vertices, faces = octahedron()
        adjacency = vertex_adjacency(len(vertices), faces)
        perturbed = vertices.copy()
        perturbed[4] = [0, 0, 5]  # push the +Z apex far out
        result = laplacian_step(perturbed, adjacency, 1.0)
        # A full step (factor 1) snaps the vertex exactly to its neighbours' mean.
        neighbours = perturbed[[0, 1, 2, 3]]
        np.testing.assert_allclose(result[4], neighbours.mean(axis=0))

    def test_pinned_vertices_never_move(self):
        vertices, faces = octahedron()
        adjacency = vertex_adjacency(len(vertices), faces)
        pinned = np.zeros(len(vertices), bool)
        pinned[4] = True
        result = laplacian_step(vertices, adjacency, 1.0, pinned=pinned)
        np.testing.assert_array_equal(result[4], vertices[4])

    def test_isolated_vertex_unchanged(self):
        vertices = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [5, 5, 5]], float)
        faces = np.array([[0, 1, 2]])
        adjacency = vertex_adjacency(4, faces)
        result = laplacian_step(vertices, adjacency, 1.0)
        np.testing.assert_array_equal(result[3], vertices[3])


class TaubinSmoothTests(unittest.TestCase):
    def test_zero_iterations_is_identity(self):
        vertices, faces = octahedron()
        result = taubin_smooth(vertices, faces, iterations=0)
        np.testing.assert_array_equal(result, vertices)

    def test_rejects_bad_parameters(self):
        vertices, faces = octahedron()
        with self.assertRaises(ValueError):
            taubin_smooth(vertices, faces, iterations=-1)
        with self.assertRaises(ValueError):
            taubin_smooth(vertices, faces, lam=-0.5, mu=-0.53)
        with self.assertRaises(ValueError):
            taubin_smooth(vertices, faces, lam=0.5, mu=0.53)

    def test_removes_high_frequency_noise_more_than_a_smooth_bump(self):
        # Taubin's defining property versus plain Laplacian smoothing: it is
        # a low-pass filter. Build a flat grid with (a) high-frequency
        # checkerboard noise and (b) a smooth low-frequency bump of the same
        # starting amplitude, and check the checkerboard is damped much more.
        n = 12
        x, y = np.meshgrid(np.linspace(0, 1, n), np.linspace(0, 1, n), indexing='ij')
        vertices = np.stack([x.ravel(), y.ravel(), np.zeros(n*n)], axis=1)
        faces = []
        for i in range(n-1):
            for j in range(n-1):
                a, b, c, d = i*n+j, i*n+j+1, (i+1)*n+j, (i+1)*n+j+1
                faces.append([a, b, c])
                faces.append([b, d, c])
        faces = np.array(faces)
        checkerboard = ((-1.0)**(np.arange(n)[:, None]+np.arange(n)[None, :])).ravel()
        smooth_bump = (np.sin(np.pi*x)*np.sin(np.pi*y)).ravel()
        boundary = (x.ravel() == 0) | (x.ravel() == 1) | (y.ravel() == 0) | (y.ravel() == 1)

        def amplitude_ratio(pattern):
            perturbed = vertices.copy()
            perturbed[:, 2] = pattern*0.1
            smoothed = taubin_smooth(perturbed, faces, iterations=20, pinned=boundary)
            interior = ~boundary
            return np.abs(smoothed[interior, 2]).mean()/np.abs(perturbed[interior, 2]).mean()

        noise_ratio = amplitude_ratio(checkerboard)
        bump_ratio = amplitude_ratio(smooth_bump)
        self.assertLess(noise_ratio, bump_ratio)
        self.assertLess(noise_ratio, 0.3)
        self.assertGreater(bump_ratio, 0.5)

    def test_plain_laplacian_shrinks_more_than_taubin(self):
        vertices, faces = octahedron()
        adjacency = vertex_adjacency(len(vertices), faces)
        laplacian_only = vertices.copy()
        for _ in range(30):
            laplacian_only = laplacian_step(laplacian_only, adjacency, 0.5)
        taubin = taubin_smooth(vertices, faces, iterations=30)
        before = np.linalg.norm(vertices, axis=1).mean()
        shrink_plain = before-np.linalg.norm(laplacian_only, axis=1).mean()
        shrink_taubin = before-np.linalg.norm(taubin, axis=1).mean()
        self.assertGreater(shrink_plain, shrink_taubin)

    def test_pinned_base_vertices_stay_flat(self):
        # A small box-ish mesh with a flat Z=0 base; base vertices pinned.
        vertices = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (0, 2)], float)
        faces = np.array([
            [0, 1, 3], [0, 3, 2],  # bottom (z=0)
            [4, 6, 7], [4, 7, 5],  # top
            [0, 4, 5], [0, 5, 1],
            [1, 5, 7], [1, 7, 3],
            [3, 7, 6], [3, 6, 2],
            [2, 6, 4], [2, 4, 0],
        ])
        pinned = vertices[:, 2] == 0
        smoothed = taubin_smooth(vertices, faces, iterations=15, pinned=pinned)
        np.testing.assert_array_equal(smoothed[pinned], vertices[pinned])
        self.assertTrue(np.all(smoothed[:, 2] >= -1e-12))


if __name__ == '__main__':
    unittest.main()
