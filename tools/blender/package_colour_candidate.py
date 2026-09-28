"""Install a Phase C re-bake (cover composite, metallic fix, missed-ray fallback) over its AR shell.

Blender only. The candidate must keep the delivered geometry exactly: same
triangle count and 0 mm vertex displacement. Only the GLB, its byte count and
its textureRefinement record change.

    blender -b --factory-startup --python-exit-code 1 \
        --python tools/blender/package_colour_candidate.py -- --model logitech-mx-master-4
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from pretty_json import write_pretty_json

PUBLIC = HERE.parents[1] / 'public/models'
CANDIDATES = HERE / 'out/study-fidelity/c/colour'


def geometry(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if len(meshes) != 1:
        raise RuntimeError(f'Expected one mesh in {path}')
    mesh = meshes[0]
    mesh.data.calc_loop_triangles()
    world = mesh.matrix_world
    points = np.array([tuple(world @ v.co) for v in mesh.data.vertices])
    triangles = np.array([[tuple(world @ mesh.data.vertices[i].co) for i in t.vertices]
                          for t in mesh.data.loop_triangles])
    return points, triangles


def canonical_triangles(triangles):
    # UV seams split vertices differently, so compare the multiset of triangles, each as
    # its sorted corners at 1 micrometre. This is set equality, not index-matched.
    rounded = np.round(triangles * 1e6).astype(np.int64)
    corners = np.sort(rounded.view([('', rounded.dtype)] * 3).reshape(len(rounded), 3), axis=1)
    return np.sort(corners.view(np.int64).reshape(len(rounded), 9), axis=0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    slug = parser.parse_args(sys.argv[sys.argv.index('--') + 1:]).model
    folder = CANDIDATES / slug
    candidate = folder / (slug + '-delivered.glb')
    delivered = PUBLIC / 'shells' / (slug + '.glb')
    report = json.loads((folder / 'reconstruction.json').read_text(encoding='utf-8'))
    if 'missedRayFallback' not in report['textureRefinement']:
        raise RuntimeError('Candidate was not baked with the Phase C pipeline: ' + slug)
    old_points, old_tris = geometry(delivered)
    new_points, new_tris = geometry(candidate)
    if len(old_tris) != len(new_tris):
        raise RuntimeError(f'Triangle count changed: {len(old_tris)} -> {len(new_tris)}')
    displacement = float(np.abs(canonical_triangles(old_tris) - canonical_triangles(new_tris)).max()) / 1e3
    bbox = float(np.abs(np.ptp(old_points, axis=0) - np.ptp(new_points, axis=0)).max()) * 1000
    if displacement > 0 or bbox > 0:
        raise RuntimeError(f'Geometry changed: max corner displacement {displacement} mm, bbox {bbox} mm')
    shutil.copyfile(candidate, delivered)
    for name in ('manifest.json', 'validation.json'):
        path = PUBLIC / name
        data = json.loads(path.read_text(encoding='utf-8'))
        rows = data['shells'] if name == 'manifest.json' else data['roundTrips']
        # Aliases (e.g. ERGO M575S) share the GLB, so they follow its bytes and record.
        for entry in (r for r in rows if r['slug'] == slug or r.get('aliasOf') == slug):
            entry['bytes'] = delivered.stat().st_size
            if 'textureRefinement' in entry or entry['slug'] == slug:
                entry['textureRefinement'] = report['textureRefinement']
        write_pretty_json(path, data)
    print('COLOUR_CANDIDATE_INSTALLED', json.dumps(dict(
        slug=slug, triangles=len(new_tris), maxCornerDisplacementMm=displacement,
        bboxDifferenceMm=bbox, bytes=delivered.stat().st_size)), flush=True)


if __name__ == '__main__':
    main()
