"""Phase D4: local remeshing where the shell sits inside its AR source (scroll-wheel
crowns and G903's channel/seams). Read-only on out/reconstructed and out/reference-library;
writes refined shells to out/d4/reconstructed/<slug>/<slug>.blend.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/d4_local_remesh.py -- \
        --data <tools/blender folder with out/reference-library and out/reconstructed> \
        --slug logitech-m190 [--diagnose] [--inner 1] [--outer 4] [--threshold 1.0] [--max-triangles 15000]
"""
import argparse
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import color_reconstruction
from local_remesh_math import blend_positions, blend_weight, clamp_displacement, ring_distances, target_mask
from asset_utils import validate_mesh

OUT = HERE / 'out/d4/reconstructed'
RAY_MAX_M = 0.02  # 20 mm: far enough to cross a wheel/channel, short enough to reject stray hits
MAX_CLAMP_MM = 6.0
UP = Vector((0.0, 0.0, 1.0))  # reconstruction frame: Z is height, ground at 0


def vertex_adjacency(bm):
    return [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]


def outward_hit(tree, origin, direction):
    """Ray-cast outward from a shell vertex; returns the hit location or None."""
    hit = tree.ray_cast(origin, direction, RAY_MAX_M)
    return hit[0] if hit[0] is not None else None


def classify(bm, tree, threshold_mm):
    """Per-vertex signed distance (mm, - = inside) and a ray-confirmed inside mask."""
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    positions = np.array([v.co[:] for v in bm.verts])
    normals = np.array([v.normal[:] for v in bm.verts])
    signed_mm = np.empty(len(bm.verts))
    confirmed = np.zeros(len(bm.verts), bool)
    for i, v in enumerate(bm.verts):
        loc, nrm, _, dist = tree.find_nearest(v.co)
        sign = np.sign(np.dot(np.asarray(v.co) - np.asarray(loc), np.asarray(nrm))) or 1.0
        signed_mm[i] = dist * 1000 * sign
        if signed_mm[i] < -abs(threshold_mm):
            confirmed[i] = outward_hit(tree, v.co, UP) is not None
    mask = target_mask(signed_mm, threshold_mm) & confirmed
    return positions, normals, signed_mm, mask


def project_positions(bm, tree, indices):
    """For each vertex index, the vertically-upward ray hit on the source (fallback: nearest point).

    A straight-up ray (rather than the vertex normal, which flips sharply between a slot's
    near-vertical wall and its floor) keeps every moved vertex's displacement parallel to its
    neighbours', so the local patch rises as a block instead of fanning out and folding.
    """
    bm.verts.ensure_lookup_table()
    out = {}
    for i in indices:
        v = bm.verts[i]
        hit = outward_hit(tree, v.co, UP)
        if hit is None:
            hit, _, _, _ = tree.find_nearest(v.co)
        out[i] = tuple(hit)
    return out


def refine(slug, data, threshold_mm, inner_ring, outer_ring, subdivide_ring, max_triangles, diagnose,
           cuts=1, max_clamp_mm=MAX_CLAMP_MM, strict=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    record = json.loads((data / 'out/reference-library' / slug / 'sources.json').read_text())
    report = json.loads((data / 'out/reconstructed' / slug / 'reconstruction.json').read_text())
    calibration = json.loads((data / report['cameraFile']).read_text())
    with bpy.data.libraries.load(str(data / 'out/reconstructed' / slug / (slug + '.blend'))) as (_, target):
        target.objects = [slug]
    shell = target.objects[0]
    bpy.context.scene.collection.objects.link(shell)
    color_reconstruction.LIB = data / 'out/reference-library'
    tree, verts, tris, _, objects = color_reconstruction.source_surface(record, calibration)

    bm = bmesh.new()
    bm.from_mesh(shell.data)
    bm.verts.ensure_lookup_table()
    _, _, signed0, mask0 = classify(bm, tree, threshold_mm)
    adjacency = vertex_adjacency(bm)
    ring0 = ring_distances(adjacency, mask0)
    print('D4_CLASSIFY', slug, 'targets', int(mask0.sum()), 'verts', len(bm.verts),
          'triangles', len(bm.faces), flush=True)
    if diagnose:
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        bm.free()
        return None

    if not mask0.any():
        print('D4_SKIP', slug, 'no target vertices past threshold', flush=True)
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        bm.free()
        return None

    # Select faces to subdivide: a face touching a vertex within subdivide_ring of a target.
    combiner = all if strict else any
    subdivide_faces = [f for f in bm.faces if combiner(0 <= ring0[v.index] <= subdivide_ring for v in f.verts)]
    edges = {e for f in subdivide_faces for e in f.edges}
    before_faces = len(bm.faces)
    if edges:
        bmesh.ops.subdivide_edges(bm, edges=list(edges), cuts=cuts, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    print('D4_SUBDIVIDE', slug, 'faces', before_faces, '->', len(bm.faces), flush=True)
    if len(bm.faces) > max_triangles:
        print('D4_FAIL', slug, 'triangle budget exceeded after subdivision', len(bm.faces), flush=True)
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        bm.free()
        return None

    # Reclassify on the refined topology (new vertices exist now).
    _, _, signed1, mask1 = classify(bm, tree, threshold_mm)
    adjacency = vertex_adjacency(bm)
    ring1 = ring_distances(adjacency, mask1)
    weight = blend_weight(ring1, inner_ring, outer_ring)
    move = np.nonzero(weight > 0)[0]
    projected_map = project_positions(bm, tree, move)

    original = np.array([bm.verts[i].co[:] for i in move])
    projected = np.array([projected_map[i] for i in move])
    projected = clamp_displacement(original, projected, max_clamp_mm)
    blended = blend_positions(original, projected, weight[move])
    for idx, pos in zip(move, blended):
        bm.verts[idx].co = Vector(pos)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    print('D4_PROJECT', slug, 'moved', len(move), 'max_disp_mm',
          float(np.max(np.linalg.norm(blended - original, axis=1)) * 1000) if len(move) else 0.0, flush=True)

    bm.to_mesh(shell.data)
    shell.data.update()
    bm.free()

    stats = validate_mesh(shell)
    print('D4_VALIDATE', slug, json.dumps(stats), flush=True)

    folder = OUT / slug
    folder.mkdir(parents=True, exist_ok=True)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(folder / (slug + '.blend')))
    (folder / 'reconstruction.json').write_text(json.dumps(report, indent=2) + '\n')
    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--slug', required=True, nargs='+')
    parser.add_argument('--threshold', type=float, default=1.0)
    parser.add_argument('--inner', type=int, default=1)
    parser.add_argument('--outer', type=int, default=4)
    parser.add_argument('--subdivide-ring', type=int, default=1)
    parser.add_argument('--max-triangles', type=int, default=15000)
    parser.add_argument('--diagnose', action='store_true')
    parser.add_argument('--cuts', type=int, default=1)
    parser.add_argument('--max-clamp', type=float, default=MAX_CLAMP_MM)
    parser.add_argument('--strict', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = Path(args.data)
    for slug in args.slug:
        refine(slug, data, args.threshold, args.inner, args.outer, args.subdivide_ring,
               args.max_triangles, args.diagnose, cuts=args.cuts, max_clamp_mm=args.max_clamp,
               strict=args.strict)


if __name__ == '__main__':
    main()
