"""Phase D0: geometry audit of every AR-derived shell against its calibrated AR source.

Blender only; read-only on assets. Works in the reconstruction frame, where
`source_surface` has already calibrated the AR source (including cable trims) and
the reconstructed shell was fitted. For each shell it records one-sided surface
distance (area-weighted samples on the shell, nearest point on the source) and
exports both meshes for the silhouette step in `geometry_audit_report.py`.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/geometry_audit.py -- \
        --data <tools/blender folder that holds out/reference-library and out/reconstructed>
"""
import argparse
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import color_reconstruction
from geometry_audit_math import area_weighted_samples, distance_summary

OUT = HERE / 'out/geometry-audit'
SAMPLES = 20000


def shell_slugs(manifest):
    """AR-derived shells with their own geometry: no aliases, no inherited-shell recolours."""
    return [e['slug'] for e in manifest['shells']
            if e['path'] == 'shells/' + e['slug'] + '.glb' and 'aliasOf' not in e and 'inheritedShell' not in e]


def mesh_arrays(obj):
    obj.data.calc_loop_triangles()
    world = obj.matrix_world
    vertices = np.array([tuple(world @ v.co) for v in obj.data.vertices])
    faces = np.array([tuple(t.vertices) for t in obj.data.loop_triangles])
    return vertices, faces


def winding_suspect_triangles(objects):
    """Flag source triangles next to an edge whose two faces disagree in winding.

    source_surface builds its triangle list object by object from loop_triangles, so the
    flags follow the same order. A signed-distance reading on a flagged triangle may be
    a normal-orientation artefact rather than a shape difference.
    """
    flags = []
    for obj in objects:
        bm = bmesh.new(); bm.from_mesh(obj.data); bm.faces.ensure_lookup_table()
        bad = {f.index for e in bm.edges if len(e.link_faces) == 2 and not e.is_contiguous for f in e.link_faces}
        bm.free()
        obj.data.calc_loop_triangles()
        flags.extend(t.polygon_index in bad for t in obj.data.loop_triangles)
    return np.array(flags, bool)


def audit(slug, data):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    record = json.loads((data / 'out/reference-library' / slug / 'sources.json').read_text())
    report = json.loads((data / 'out/reconstructed' / slug / 'reconstruction.json').read_text())
    calibration = json.loads((data / report['cameraFile']).read_text())
    with bpy.data.libraries.load(str(data / 'out/reconstructed' / slug / (slug + '.blend'))) as (_, target):
        target.objects = [slug]
    shell = target.objects[0]
    bpy.context.scene.collection.objects.link(shell)
    tree, verts, tris, _, objects = color_reconstruction.source_surface(record, calibration)
    shell_v, shell_f = mesh_arrays(shell)
    rng = np.random.default_rng(0)
    points = area_weighted_samples(shell_v, shell_f, SAMPLES, rng)
    suspect = winding_suspect_triangles(objects)
    nearest = [tree.find_nearest(Vector(p)) for p in points]
    distances = np.array([n[3] for n in nearest]) * 1000
    # Sign by the source normal at the nearest point: + means the shell lies outside the
    # source (it seals over a recess or opening), - means inside (it misses a bump).
    signed = np.array([np.sign(np.dot(np.asarray(p) - np.asarray(n[0]), np.asarray(n[1]))) for p, n in zip(points, nearest)])
    source_v = np.array([tuple(v) for v in verts])
    source_f = np.array(tris)
    dims = np.array(calibration['dimensionsXYZ'])
    np.savez_compressed(OUT / (slug + '.npz'), shell_v=shell_v, shell_f=shell_f, points=points,
                        signed_mm=distances * signed,
                        source_v=source_v, source_f=source_f, dims=dims)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    return dict(slug=slug, samples=SAMPLES, cableTrim=bool(calibration.get('cableTrim')),
                shellTriangles=int(len(shell_f)), sourceTriangles=int(len(source_f)),
                distanceMm=distance_summary(distances),
                over2mmOutsideShare=float(((distances > 2) & (signed > 0)).mean()),
                over2mmInsideShare=float(((distances > 2) & (signed < 0)).mean()),
                windingSuspectSourceTriangleShare=float(suspect.mean()),
                over2mmInsideOnSuspectTriangles=int(((distances > 2) & (signed < 0) & suspect[[n[2] for n in nearest]]).sum()),
                over2mmInsideSamples=int(((distances > 2) & (signed < 0)).sum()))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--only', nargs='*')
    parser.add_argument('--out')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = Path(args.data)
    global OUT
    if args.out:
        OUT = Path(args.out)
    color_reconstruction.LIB = data / 'out/reference-library'
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((HERE.parents[1] / 'public/models/manifest.json').read_text(encoding='utf-8'))
    results = []
    for slug in args.only or shell_slugs(manifest):
        row = audit(slug, data)
        results.append(row)
        print('AUDIT', json.dumps(row), flush=True)
    (OUT / 'distances.json').write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__':
    main()
