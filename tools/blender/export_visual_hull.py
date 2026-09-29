"""D5a step 3 (Blender): decimate the smoothed hull to <=14000 triangles,
transfer UVs from the baseline study (nearest face interpolated), reuse its
material and embedded texture bytes unchanged, recalibrate to the catalogue
bbox, validate topology, and export a Draco-compressed GLB. Appearance is out
of scope; UV stretching is reported, not fixed.

    blender -b --factory-startup --python-exit-code 1 --python \
        tools/blender/export_visual_hull.py -- --directory out/d5/<slug> \
        --baseline out/d1-evidence/<slug> --geometry out/d1-evidence/<slug>/baseline-geometry.json
"""
import argparse
import json
from pathlib import Path
import struct
import sys

import bpy
import bmesh
from mathutils import Vector
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import dimensions_mm, support_margin_mm, validate_mesh
from study_deformation_math import calibrate_bbox

MAX_TRIANGLES = 14000


def read_glb(path):
    blob = path.read_bytes()
    size = struct.unpack_from('<I', blob, 12)[0]
    return json.loads(blob[20:20+size]), blob[28+size:]


def new_mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata((vertices/1000).tolist(), [], faces.tolist())
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def triangle_count(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    count = len(bm.faces)
    bm.free()
    return count


def trial_remesh_triangle_count(obj, voxel_size):
    duplicate = obj.copy()
    duplicate.data = obj.data.copy()
    bpy.context.collection.objects.link(duplicate)
    modifier = duplicate.modifiers.new('Remesh', 'REMESH')
    modifier.mode = 'VOXEL'
    modifier.voxel_size = voxel_size
    modifier.use_smooth_shade = False
    bpy.context.view_layer.objects.active = duplicate
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    count = triangle_count(duplicate)
    bpy.data.objects.remove(duplicate, do_unlink=True)
    return count


def remesh_to_budget(obj, max_triangles):
    """Voxel Remesh (watertight, self-intersection-free by construction)
    bisected on voxel size to land safely under the triangle budget, with a
    gentle Decimate/COLLAPSE only to trim any small remaining excess -- far
    milder than decimating the raw ~14x-oversized hull directly, which
    Blender's edge-collapse decimator can fold into local self-intersections."""
    dims = obj.dimensions
    lo, hi = max(dims)/400, max(dims)/8
    for _ in range(10):
        mid = (lo+hi)/2
        count = trial_remesh_triangle_count(obj, mid)
        if count > max_triangles:
            lo = mid
        else:
            hi = mid
    modifier = obj.modifiers.new('Remesh', 'REMESH')
    modifier.mode = 'VOXEL'
    modifier.voxel_size = hi
    modifier.use_smooth_shade = False
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    count = triangle_count(obj)
    if count > max_triangles:
        modifier = obj.modifiers.new('Decimate', 'DECIMATE')
        modifier.decimate_type = 'COLLAPSE'
        modifier.ratio = max(1e-4, min(1.0, max_triangles/count*0.97))
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        count = triangle_count(obj)
    return count


def transfer_uvs(target, source):
    bpy.context.view_layer.objects.active = target
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    target.select_set(True)
    source.select_set(True)
    bpy.context.view_layer.objects.active = target
    modifier = target.modifiers.new('DataTransfer', 'DATA_TRANSFER')
    modifier.object = source
    modifier.use_loop_data = True
    modifier.data_types_loops = {'UV'}
    modifier.loop_mapping = 'POLYINTERP_NEAREST'
    bpy.ops.object.datalayout_transfer(modifier=modifier.name)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def uv_stretch_report(obj):
    obj.data.calc_loop_triangles()
    uv = obj.data.uv_layers.active.data
    ratios = []
    for tri in obj.data.loop_triangles:
        p = [obj.data.vertices[i].co for i in tri.vertices]
        area3d = (p[1]-p[0]).cross(p[2]-p[0]).length/2
        u = [Vector(uv[l].uv) for l in tri.loops]
        area_uv = abs((u[1]-u[0]).cross(u[2]-u[0]))/2
        if area_uv > 1e-12:
            ratios.append(area3d/area_uv)
    ratios = np.array(ratios)
    return dict(triangleCount=len(ratios), areaRatioMin=float(ratios.min()), areaRatioMax=float(ratios.max()),
                areaRatioP05=float(np.percentile(ratios, 5)), areaRatioP95=float(np.percentile(ratios, 95)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--geometry', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    out = args.directory.resolve()
    assert bpy.app.version == (5, 2, 2) and sys.version_info[:2] == (3, 13)

    dims = json.loads(args.geometry.read_text())['catalogueDimensionsXYZmm']
    smoothed = np.load(out/'smoothed-mesh.npz')

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.baseline/'baseline.glb'))
    baseline_obj = next(o for o in bpy.context.selected_objects if o.type == 'MESH')

    hull_obj = new_mesh_object('candidate', smoothed['vertices'], smoothed['faces'])
    triangles_before_decimate = len(smoothed['faces'])
    triangles = remesh_to_budget(hull_obj, MAX_TRIANGLES)

    # Recalibrate to the exact catalogue bbox before UV transfer, so nearest-
    # face correspondence uses final positions.
    points = np.array([tuple(v.co) for v in hull_obj.data.vertices])*1000
    calibrated = calibrate_bbox(points, dims)
    for vertex, point in zip(hull_obj.data.vertices, calibrated):
        vertex.co = Vector(point/1000)
    hull_obj.data.update()
    bpy.context.view_layer.update()

    transfer_uvs(hull_obj, baseline_obj)
    hull_obj.data.materials.append(baseline_obj.data.materials[0])
    for polygon in hull_obj.data.polygons:
        polygon.material_index = 0
    hull_obj.data.update()

    mesh_stats = validate_mesh(hull_obj, weld=True)
    dimensions = dimensions_mm(hull_obj)
    bbox_error = max(abs(a-b) for a, b in zip(dimensions, dims))
    ground = min((hull_obj.matrix_world @ Vector(c)).z for c in hull_obj.bound_box)
    margin = support_margin_mm(hull_obj)
    stretch = uv_stretch_report(hull_obj)

    path = out/'candidate.glb'
    bpy.ops.object.select_all(action='DESELECT')
    hull_obj.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
        export_animations=False, export_cameras=False, export_lights=False,
        export_draco_mesh_compression_enable=True, export_draco_position_quantization=0,
        export_draco_texcoord_quantization=0)

    baseline_doc, baseline_bin = read_glb(args.baseline/'baseline.glb')
    document, binary = read_glb(path)
    assert len(document['materials']) >= 1
    binary = bytearray(binary)
    image_views = [im['bufferView'] for im in document.get('images', [])]
    for index, image in enumerate(baseline_doc.get('images', [])):
        view = baseline_doc['bufferViews'][image['bufferView']]
        data = baseline_bin[view.get('byteOffset', 0):view.get('byteOffset', 0)+view['byteLength']]
        binary.extend(b'\0'*(-len(binary) % 4))
        document['bufferViews'][image_views[index]] = dict(buffer=0, byteOffset=len(binary), byteLength=len(data))
        binary.extend(data)
    for key in ('materials', 'textures', 'samplers', 'images'):
        if key in baseline_doc:
            document[key] = baseline_doc[key]
    for image, view in zip(document.get('images', []), image_views):
        image['bufferView'] = view
    binary.extend(b'\0'*(-len(binary) % 4))
    document['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' '*(-len(encoded) % 4)
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 28+len(encoded)+len(binary)) +
                    struct.pack('<I4s', len(encoded), b'JSON')+encoded +
                    struct.pack('<I4s', len(binary), b'BIN\0')+binary)

    # Re-import to verify the export round trip (materials/images unchanged,
    # geometry/UV survive Draco compression) exactly as export_study_geometry.py does.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    reimported = next(o for o in bpy.context.selected_objects if o.type == 'MESH')
    reimported_stats = validate_mesh(reimported, weld=True)
    reimported_dims = dimensions_mm(reimported)
    reimported_error = max(abs(a-b) for a, b in zip(reimported_dims, dims))
    reimported_ground = min((reimported.matrix_world @ Vector(c)).z for c in reimported.bound_box)
    reimported_margin = support_margin_mm(reimported)
    vertices = np.array([tuple(reimported.matrix_world @ v.co) for v in reimported.data.vertices])*1000
    faces = np.array([tuple(t.vertices) for t in reimported.data.loop_triangles])
    np.savez_compressed(out/'candidate-mesh.npz', vertices=vertices, faces=faces)

    report = dict(
        rawHullTriangles=triangles_before_decimate, decimatedTriangles=triangles,
        mesh=mesh_stats, dimensionsXYZmm=dimensions, maxBboxErrorMm=bbox_error,
        groundErrorMm=abs(ground)*1000, supportMarginMm=margin, uvAreaStretch=stretch,
        reimported=dict(mesh=reimported_stats, dimensionsXYZmm=reimported_dims,
                        maxBboxErrorMm=reimported_error, groundErrorMm=abs(reimported_ground)*1000,
                        supportMarginMm=reimported_margin),
        bytes=path.stat().st_size)
    assert report['mesh']['triangles'] <= MAX_TRIANGLES
    assert report['maxBboxErrorMm'] <= 0.5 and report['reimported']['maxBboxErrorMm'] <= 0.5
    assert abs(ground) < 1e-5 and abs(reimported_ground) < 1e-5
    assert margin >= 5 and reimported_margin >= 5
    (out/'export-geometry.json').write_text(json.dumps(report, indent=2)+'\n')
    print('HULL_EXPORTED', json.dumps({k: report[k] for k in
          ('decimatedTriangles', 'maxBboxErrorMm', 'groundErrorMm', 'supportMarginMm', 'bytes')}), flush=True)


if __name__ == '__main__':
    main()
