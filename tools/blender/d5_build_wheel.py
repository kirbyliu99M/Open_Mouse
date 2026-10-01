"""Phase D5b step 3: build each fitted wheel as a separate capped cylinder and merge it
into the shell with Blender's exact boolean union, instead of moving shell vertices (D4
showed that fails: a thin wheel rising through a slot self-intersects a ~14k-triangle
near-uniform shell). Read-only on out/reconstructed and out/reference-library; writes to
out/d5/reconstructed/<slug>/<slug>.blend plus a copied reconstruction.json.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/d5_build_wheel.py -- \
        --data <tools/blender folder> --fits out/d5/wheel-fits.json --slug logitech-m190 [logitech-m750 ...]
"""
import argparse
import json
import math
import shutil
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import clean_export_mesh, dimensions_mm, validate_mesh

OUT = HERE / 'out/d5/reconstructed'
MAX_TRIANGLES = 15000
SEGMENTS = 56
WIDTH_MARGIN = 0.92  # build the cylinder 8% narrower than the measured width


def build_cylinder(name, radius, width, axis, center):
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    depth = width * WIDTH_MARGIN
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=SEGMENTS,
                           radius1=radius, radius2=radius, depth=depth)
    # create_cone builds along local +Z; rotate +Z onto the fitted axis direction.
    z = Vector((0, 0, 1))
    target = Vector(axis.tolist())
    if abs(z.dot(target)) > 0.999999:
        rot = Matrix.Identity(3) if z.dot(target) > 0 else Matrix.Rotation(math.pi, 3, Vector((1, 0, 0)))
    else:
        rot = z.rotation_difference(target).to_matrix()
    for v in bm.verts:
        v.co = rot @ v.co + Vector(center.tolist())
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build(slug, data, fits, out):
    fit = fits[slug]
    if not fit.get('fit'):
        print('D5B_SKIP', slug, 'no valid wheel fit:', fit.get('reason'), flush=True)
        return None

    bpy.ops.wm.read_factory_settings(use_empty=True)
    with bpy.data.libraries.load(str(data / 'out/reconstructed' / slug / (slug + '.blend'))) as (_, target):
        target.objects = [slug]
    shell = target.objects[0]
    bpy.context.scene.collection.objects.link(shell)

    before_stats = validate_mesh(shell)
    before_dims = dimensions_mm(shell)

    axis = np.array(fit['axis'])
    center = np.array(fit['center'])
    radius, width = fit['radiusM'], fit['widthM']
    cylinder = build_cylinder(slug + '_wheel', radius, width, axis, center)

    boolean = shell.modifiers.new('D5b wheel crown', 'BOOLEAN')
    boolean.operation, boolean.solver, boolean.object = 'UNION', 'EXACT', cylinder
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.modifier_apply(modifier=boolean.name)
    bpy.data.objects.remove(cylinder, do_unlink=True)

    clean_export_mesh(shell)
    after_stats = validate_mesh(shell)
    after_dims = dimensions_mm(shell)
    ground = min((shell.matrix_world @ Vector(c)).z for c in shell.bound_box)
    dims_delta = [abs(a - b) for a, b in zip(after_dims, before_dims)]

    report = dict(slug=slug, beforeMesh=before_stats, afterMesh=after_stats,
                  beforeDimsMm=before_dims, afterDimsMm=after_dims, dimsDeltaMm=dims_delta,
                  groundZMm=ground * 1000, wheelFit=fit)
    print('D5B_BUILD', json.dumps({k: v for k, v in report.items() if k != 'wheelFit'}), flush=True)

    if after_stats['triangles'] > MAX_TRIANGLES:
        print('D5B_OVER_BUDGET', slug, after_stats['triangles'], flush=True)

    folder = out / slug
    folder.mkdir(parents=True, exist_ok=True)
    bpy.context.view_layer.objects.active = shell
    bpy.ops.wm.save_as_mainfile(filepath=str(folder / (slug + '.blend')))
    shutil.copyfile(data / 'out/reconstructed' / slug / 'reconstruction.json', folder / 'reconstruction.json')
    (folder / 'd5b-build-report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--fits', required=True)
    parser.add_argument('--slug', required=True, nargs='+')
    parser.add_argument('--out')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = Path(args.data)
    fits = json.loads(Path(args.fits).read_text())
    out = Path(args.out) if args.out else OUT
    for slug in args.slug:
        build(slug, data, fits, out)


if __name__ == '__main__':
    main()
