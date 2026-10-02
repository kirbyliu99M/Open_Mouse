import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from photo_camera_math import camera_axes, project_points, raster_silhouette
from visual_hull_math import (
    carve, grid_points, group_reject_votes, occupancy_volume, orient_outward, pad_for_marching_cubes,
    reject_by_mask, signed_volume, voxel_grid, weighted_votes,
)


def unit_box():
    vertices = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], float)
    idx = lambda x, y, z: (int(x)*4+int(y)*2+int(z))
    quads = [
        [idx(0, 0, 0), idx(0, 1, 0), idx(1, 1, 0), idx(1, 0, 0)],  # bottom, outward = -Z
        [idx(0, 0, 1), idx(1, 0, 1), idx(1, 1, 1), idx(0, 1, 1)],  # top, outward = +Z
        [idx(0, 0, 0), idx(1, 0, 0), idx(1, 0, 1), idx(0, 0, 1)],
        [idx(0, 1, 0), idx(0, 1, 1), idx(1, 1, 1), idx(1, 1, 0)],
        [idx(0, 0, 0), idx(0, 0, 1), idx(0, 1, 1), idx(0, 1, 0)],
        [idx(1, 0, 0), idx(1, 1, 0), idx(1, 1, 1), idx(1, 0, 1)],
    ]
    faces = []
    for q in quads:
        faces.append([q[0], q[1], q[2]])
        faces.append([q[0], q[2], q[3]])
    return vertices, np.array(faces)


class OrientationTests(unittest.TestCase):
    def test_outward_box_has_positive_signed_volume(self):
        vertices, faces = unit_box()
        self.assertAlmostEqual(signed_volume(vertices, faces), 6.0, places=9)  # 6x the unit volume

    def test_inward_winding_has_negative_signed_volume(self):
        vertices, faces = unit_box()
        self.assertLess(signed_volume(vertices, faces[:, ::-1]), 0)

    def test_orient_outward_fixes_inward_winding(self):
        vertices, faces = unit_box()
        flipped = orient_outward(vertices, faces[:, ::-1])
        self.assertGreater(signed_volume(vertices, flipped), 0)

    def test_orient_outward_leaves_correct_winding_alone(self):
        vertices, faces = unit_box()
        result = orient_outward(vertices, faces)
        np.testing.assert_array_equal(result, faces)


class VoxelGridTests(unittest.TestCase):
    def test_covers_box_and_is_centred(self):
        xs, ys, zs, spacing = voxel_grid([70, 100, 40], 0.5)
        self.assertTrue(np.all(np.array(spacing) <= 0.5 + 1e-9))
        self.assertAlmostEqual(xs.min()-spacing[0]/2, -35, places=6)
        self.assertAlmostEqual(xs.max()+spacing[0]/2, 35, places=6)
        self.assertAlmostEqual(zs.min()-spacing[2]/2, 0, places=6)
        self.assertAlmostEqual(zs.max()+spacing[2]/2, 40, places=6)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            voxel_grid([0, 10, 10], 0.5)
        with self.assertRaises(ValueError):
            voxel_grid([10, 10, 10], 0)

    def test_grid_points_shape_and_order(self):
        xs, ys, zs, _ = voxel_grid([4, 6, 8], 2)
        points = grid_points(xs, ys, zs)
        self.assertEqual(points.shape, (len(xs)*len(ys)*len(zs), 3))
        volume = points[:, 2].reshape(len(xs), len(ys), len(zs))
        np.testing.assert_allclose(volume[0, 0], zs)


class RejectByMaskTests(unittest.TestCase):
    def test_inside_mask_accepted_outside_rejected(self):
        mask = np.zeros((10, 10), bool)
        mask[3:7, 3:7] = True
        points = np.array([[5, 5], [0, 0], [-1, 5], [100, 5]])
        np.testing.assert_array_equal(reject_by_mask(points, mask), [False, True, True, True])

    def test_rounds_to_nearest_pixel(self):
        mask = np.zeros((10, 10), bool)
        mask[4, 4] = True
        self.assertFalse(reject_by_mask(np.array([[3.6, 3.6]]), mask)[0])


class GroupVoteTests(unittest.TestCase):
    def test_majority_rule(self):
        photo_reject = np.array([[True, False], [True, False], [False, False]])
        group_ids = [0, 0, 0]
        result = group_reject_votes(photo_reject, group_ids, rule='majority')
        # voxel 0: 2 of 3 reject -> group rejects. voxel 1: 0 of 3 -> accepts.
        np.testing.assert_array_equal(result, [[True, False]])

    def test_any_and_all_rules_bracket_majority(self):
        photo_reject = np.array([[True, False, True], [False, False, True]])
        group_ids = [0, 0]
        any_result = group_reject_votes(photo_reject, group_ids, rule='any')
        all_result = group_reject_votes(photo_reject, group_ids, rule='all')
        np.testing.assert_array_equal(any_result, [[True, False, True]])
        np.testing.assert_array_equal(all_result, [[False, False, True]])

    def test_singleton_groups_are_independent(self):
        photo_reject = np.array([[True], [False]])
        result = group_reject_votes(photo_reject, [0, 1], rule='any')
        np.testing.assert_array_equal(result, [[True], [False]])

    def test_bad_shape_rejected(self):
        with self.assertRaises(ValueError):
            group_reject_votes(np.zeros((2, 3), bool), [0, 0, 1])
        with self.assertRaises(ValueError):
            group_reject_votes(np.zeros((2, 3), bool), [0, 1], rule='vote')


class WeightedCarveTests(unittest.TestCase):
    def test_equal_weight_groups_vote(self):
        # 3 groups, 2 voxels. Voxel 0 rejected by 2/3 groups; voxel 1 by 0/3.
        group_reject = np.array([[True, False], [True, False], [False, False]])
        votes = weighted_votes(group_reject, [1, 1, 1])
        np.testing.assert_array_equal(votes, [2, 0])
        # threshold 0: any single rejecting group carves voxel 0 and would carve
        # a voxel rejected by just one group too.
        np.testing.assert_array_equal(carve(votes, 3, 0), [False, True])
        # threshold 2: tolerate up to 2 weighted rejects; voxel 0 now survives.
        np.testing.assert_array_equal(carve(votes, 3, 2), [True, True])

    def test_official_group_outweighs_a_whole_thirdparty_duplicate_group(self):
        # One official (singleton, weight 1) group and one third-party duplicate
        # group of 3 photos collapsed to a single weight-1 vote: equal say.
        photo_reject = np.array([[True], [True], [True], [False]])  # 3 duplicates + 1 official
        group_ids = [0, 0, 0, 1]
        groups = group_reject_votes(photo_reject, group_ids, rule='majority')
        votes = weighted_votes(groups, [1, 1])
        # The duplicate group (weight 1) and the official group (weight 1) are
        # equally weighted regardless of the duplicate group's photo count.
        self.assertEqual(votes[0], 1)

    def test_threshold_bounds_enforced(self):
        with self.assertRaises(ValueError):
            carve(np.array([1.0]), 2, -0.1)
        with self.assertRaises(ValueError):
            carve(np.array([1.0]), 2, 2.1)

    def test_weight_shape_enforced(self):
        with self.assertRaises(ValueError):
            weighted_votes(np.zeros((2, 4), bool), [1, 1, 1])
        with self.assertRaises(ValueError):
            weighted_votes(np.zeros((2, 4), bool), [1, -1])


class OccupancyTests(unittest.TestCase):
    def test_reshape_matches_grid_points_order(self):
        xs, ys, zs, _ = voxel_grid([4, 6, 8], 2)
        shape = (len(xs), len(ys), len(zs))
        survive = np.arange(np.prod(shape)) % 2 == 0
        volume = occupancy_volume(survive, shape)
        self.assertEqual(volume.shape, shape)
        np.testing.assert_array_equal(volume.ravel(), survive)

    def test_bad_size_rejected(self):
        with self.assertRaises(ValueError):
            occupancy_volume(np.zeros(5, bool), (2, 2, 2))

    def test_padding_adds_one_empty_shell(self):
        volume = np.ones((2, 3, 4), bool)
        padded = pad_for_marching_cubes(volume)
        self.assertEqual(padded.shape, (4, 5, 6))
        self.assertFalse(padded[0].any())
        self.assertFalse(padded[-1].any())
        np.testing.assert_array_equal(padded[1:-1, 1:-1, 1:-1], volume)


class CarvingRecoversAKnownShapeTests(unittest.TestCase):
    """End-to-end: carve a voxel grid against two orthogonal silhouettes of an
    actual box rendered with the real perspective camera/raster maths, and
    check the surviving voxels approximate that box (the classic visual-hull
    property for a convex shape seen from enough directions)."""

    def test_carving_recovers_octahedron_and_removes_bbox_corners(self):
        dims = np.array([40.0, 60.0, 30.0])
        # An octahedron inscribed in the box's bounding box: its own bbox
        # equals the box (so calibrate-style framing still matches `dims`),
        # but it occupies much less volume, so carving should remove the
        # bounding box's corners while keeping the octahedron's interior.
        half = dims/2
        corners = np.array([
            [-half[0], 0, half[2]], [half[0], 0, half[2]],
            [0, -half[1], half[2]], [0, half[1], half[2]],
            [0, 0, 0], [0, 0, dims[2]],
        ])
        apex_bottom, apex_top = 4, 5
        ring = [0, 2, 1, 3]
        faces = []
        for i in range(4):
            a, b = ring[i], ring[(i+1) % 4]
            faces.append([apex_bottom, a, b])
            faces.append([apex_top, b, a])
        faces = np.array(faces)
        centre = corners.mean(0)
        cameras = [dict(azimuth=0, elevation=90, distance=1000), dict(azimuth=0, elevation=0, distance=1000),
                   dict(azimuth=45, elevation=30, distance=1000)]
        size = (300, 300)
        masks = []
        for cam in cameras:
            axes = camera_axes(cam['azimuth'], cam['elevation'])
            points, _ = project_points(corners, axes, centre, cam['distance'], 3000, [0, 0],
                                        (np.array(size)-1)/2)
            masks.append(raster_silhouette(points, faces, size))

        xs, ys, zs, spacing = voxel_grid(dims, 2.0)
        points = grid_points(xs, ys, zs)
        photo_reject = []
        for cam, mask in zip(cameras, masks):
            axes = camera_axes(cam['azimuth'], cam['elevation'])
            xy, depth = project_points(points, axes, centre, cam['distance'], 3000, [0, 0],
                                        (np.array(size)-1)/2)
            photo_reject.append(reject_by_mask(xy, mask))
        groups = group_reject_votes(np.array(photo_reject), [0, 1, 2], rule='any')
        votes = weighted_votes(groups, [1, 1, 1])
        survive = carve(votes, 3, 0)
        volume = occupancy_volume(survive, (len(xs), len(ys), len(zs)))
        all_points = grid_points(xs, ys, zs)
        margin = 2*spacing[0]  # a conservative shrink, well inside the true octahedron
        l1 = (np.abs(all_points[:, 0])/half[0]+np.abs(all_points[:, 1])/half[1] +
              np.abs(all_points[:, 2]-half[2])/half[2])
        inside = l1 <= 1-margin/half.min()
        outside_bbox_corner = (np.abs(all_points[:, 0]) > dims[0]/2-spacing[0]) & \
                               (np.abs(all_points[:, 1]) > dims[1]/2-spacing[1]) & \
                               (np.abs(all_points[:, 2]-half[2]) > half[2]-spacing[2])
        # Every voxel well inside the octahedron must survive three exact silhouettes...
        self.assertTrue(survive[inside].all())
        # ...and the bounding box's own corners, far outside the octahedron, must be carved.
        self.assertGreater(outside_bbox_corner.sum(), 0)
        self.assertFalse(survive[outside_bbox_corner].any())
        self.assertLess(survive.mean(), 1.0)
        self.assertGreater(volume.mean(), 0.05)


if __name__ == '__main__':
    unittest.main()
