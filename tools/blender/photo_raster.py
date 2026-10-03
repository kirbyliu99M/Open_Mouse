"""UV and perspective G-buffers shared by the M550 photo bake."""
import numpy as np
from photo_bake_math import triangle_pixels, perspective_weights


def uv_buffer(vertices, faces, uvs, corner_normals, resolution):
    xyz = np.zeros((resolution, resolution, 3), np.float32)
    normals = np.zeros_like(xyz)
    triangle_ids = np.full((resolution, resolution), -1, np.int32)
    for i, face in enumerate(faces):
        pixels = uvs[i]*resolution-.5;pixels[:, 1] = resolution-1-pixels[:, 1]
        x, y, weights = triangle_pixels(pixels, (resolution, resolution))
        xyz[y, x] = weights@vertices[face]
        normals[y, x] = weights@corner_normals[i]
        triangle_ids[y, x] = i
    normals /= np.maximum(np.linalg.norm(normals, axis=-1, keepdims=True), 1e-12)
    return xyz, normals, triangle_ids


def camera_buffer(vertices, faces, corner_normals, pixels, depths, size):
    depth = np.full((size[1], size[0]), np.inf, np.float32)
    xyz = np.zeros((*depth.shape, 3), np.float32)
    normals = np.zeros_like(xyz)
    for i, face in enumerate(faces):
        x, y, bary = triangle_pixels(pixels[face], size)
        if not len(x):continue
        weights, z = perspective_weights(bary, depths[face])
        keep = z < depth[y, x]
        x, y, weights, z = x[keep], y[keep], weights[keep], z[keep]
        depth[y, x] = z
        xyz[y, x] = weights@vertices[face]
        normals[y, x] = weights@corner_normals[i]
    normals /= np.maximum(np.linalg.norm(normals, axis=-1, keepdims=True), 1e-12)
    return depth, xyz, normals
