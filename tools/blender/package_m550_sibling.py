"""Phase D2: deliver M550 on the M650 AR-derived shell (Part 3 candidate) as a shell.

Blender only. Replaces the limited-view M550 study: deletes studies/logitech-m550.glb,
writes shells/logitech-m550.glb, and moves the manifest and validation entries from
`studies` to `shells`. Mesh statistics are measured on the re-imported delivered GLB,
as package_reconstruction.py does. Kirby approved delivering this route on 2026-09-28.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/package_m550_sibling.py -- \
        --candidate <folder with m550-on-m650-candidate-delivered.glb, candidate.json, camera-*.json>
"""
import argparse
import hashlib
import json
import shutil
import sys
from copy import deepcopy
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import MIN_SUPPORT_MARGIN_MM, dimensions_mm, support_margin_mm, validate_mesh
from pretty_json import write_pretty_json

PUBLIC = HERE.parents[1] / 'public/models'
SLUG, SIBLING = 'logitech-m550', 'logitech-m650'
VIEWS = ('top', 'left', 'bottom', 'rear', 'front-held-out')


def measure(path, target):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if len(meshes) != 1:
        raise RuntimeError('Expected one mesh')
    mesh = meshes[0]
    stats = validate_mesh(mesh, weld=True)
    actual = dimensions_mm(mesh)
    error = max(abs(a - b) for a, b in zip(actual, target))
    ground = min((mesh.matrix_world @ Vector(c)).z for c in mesh.bound_box)
    margin = support_margin_mm(mesh)
    if error > .5 or stats['triangles'] > 15000 or abs(ground) > 1e-5 or margin < MIN_SUPPORT_MARGIN_MM:
        raise RuntimeError(f'Gate failed: bbox {error} mm, {stats}, ground {ground}, support {margin}')
    return stats, actual, error, abs(ground) * 1000, margin


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', required=True)
    folder = Path(parser.parse_args(sys.argv[sys.argv.index('--') + 1:]).candidate)
    glb = folder / 'm550-on-m650-candidate-delivered.glb'
    built = json.loads((folder / 'candidate.json').read_text())
    cameras = {v: json.loads((folder / f'camera-{v}.json').read_text()) for v in VIEWS}
    manifest = json.loads((PUBLIC / 'manifest.json').read_text(encoding='utf-8'))
    validation = json.loads((PUBLIC / 'validation.json').read_text(encoding='utf-8'))
    study = next(e for e in manifest['studies'] if e['slug'] == SLUG)
    sibling = next(e for e in manifest['shells'] if e['slug'] == SIBLING)
    target = study['dimensionsXYZmm']
    stats, actual, error, ground, margin = measure(glb, target)
    delivered = PUBLIC / 'shells' / (SLUG + '.glb')
    shutil.copyfile(glb, delivered)
    (PUBLIC / study['path']).unlink()
    entry = deepcopy(sibling)
    entry.update(
        slug=SLUG, model=study['model'], status='reference-derived-review',
        method='M650 AR-derived sibling shell with the two thumb buttons removed by biharmonic fairing '
               'and the light wheel-to-LED plate refilled with surrounding graphite (Phase D2)',
        mesh=stats, dimensionsXYZmm=actual, calibratedBboxRoundTripDifferenceMm=error,
        bytes=delivered.stat().st_size, path='shells/' + delivered.name,
        groundErrorMm=ground, supportMarginMm=margin,
        inheritedShell=dict(
            slug=SIBLING, deliveredSHA256=hashlib.sha256((PUBLIC / sibling['path']).read_bytes()).hexdigest(),
            geometry='M650 shell with the thumb-button region faired (max displacement '
                     f"{built['fairing']['maxDisplacementMm']:.2f} mm over {built['removedRegionAreaMm2']:.0f} mm²)",
            appearance='M650 bake; thumb region and plate filled with surrounding plastic; no colour work (Kirby: model quality)',
            photoIoU={v: cameras[v]['iou'] for v in VIEWS},
            studyPhotoIoU={'top': 0.9951, 'left': 0.9823, 'bottom': 0.9929, 'rear': 0.9325, 'front-held-out': 0.9571},
            decision='Kirby approved delivering M550 on the M650 shell on 2026-09-28 (Phase D2)',
            limitations=['Faint outline of the M650 plate remains (sub-millimetre relief)',
                         'Filled thumb area lacks the M550 side grip ridges', 'M550 centre seam not modelled']))
    manifest['studies'] = [e for e in manifest['studies'] if e['slug'] != SLUG]
    manifest['shells'].append(entry)
    manifest['shells'].sort(key=lambda e: e['slug'])
    write_pretty_json(PUBLIC / 'manifest.json', manifest)
    rows = validation['roundTrips']
    old = next(r for r in rows if r['slug'] == SLUG)
    row = {k: entry[k] for k in old if k in entry}
    for key in next(r for r in rows if r['slug'] == SIBLING):
        if key in entry:
            row[key] = entry[key]
    rows[rows.index(old)] = row
    validation['maxCalibratedBboxRoundTripDifferenceMm'] = max(r['calibratedBboxRoundTripDifferenceMm'] for r in rows)
    write_pretty_json(PUBLIC / 'validation.json', validation)
    print('M550_SIBLING_DELIVERED', json.dumps(dict(bytes=entry['bytes'], mesh=stats, dims=actual,
                                                    bboxErrorMm=error, supportMarginMm=margin)), flush=True)


if __name__ == '__main__':
    main()
