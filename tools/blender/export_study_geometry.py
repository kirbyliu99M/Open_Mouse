"""Export a frozen D1 candidate and verify its actual Draco round trip (Blender).

Original embedded images and material JSON are retained exactly. Never publishes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Vector
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import dimensions_mm, support_margin_mm, validate_mesh


def read_glb(path):
    blob = path.read_bytes()
    size = struct.unpack_from('<I', blob, 12)[0]
    return json.loads(blob[20:20+size]), blob[28+size:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    out = args.directory.resolve()
    assert bpy.app.version == (5, 2, 2) and sys.version_info[:2] == (3, 13)
    baseline = np.load(out/'baseline-mesh.npz')
    candidate = np.load(out/'candidate-mesh.npz')
    dims = json.loads((out/'baseline-geometry.json').read_text())['catalogueDimensionsXYZmm']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(out/'baseline.glb'))
    obj = next(o for o in bpy.context.selected_objects if o.type == 'MESH')
    points = np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices])*1000
    np.testing.assert_array_equal(points, baseline['vertices'])
    np.testing.assert_array_equal(baseline['faces'], candidate['faces'])
    inverse = obj.matrix_world.inverted()
    for vertex, point in zip(obj.data.vertices, candidate['vertices']):
        vertex.co = inverse @ Vector(point/1000)
    obj.data.update()
    bpy.context.view_layer.update()
    validate_mesh(obj, weld=True)

    # Triangle corner positions, UVs and material indices survive vertex reordering.
    def corners(mesh):
        mesh.data.calc_loop_triangles()
        result = []
        for tri in mesh.data.loop_triangles:
            row = []
            for vertex, loop in zip(tri.vertices, tri.loops):
                p = tuple(mesh.matrix_world @ mesh.data.vertices[vertex].co)
                uv = tuple(mesh.data.uv_layers.active.data[loop].uv)
                row.append((*p, *uv))
            result.append((tri.material_index, tuple(sorted(row))))
        return sorted(result)

    expected = corners(obj)
    path = out/'candidate.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
        use_selection=True, export_animations=False, export_cameras=False,
        export_lights=False, export_draco_mesh_compression_enable=True,
        export_draco_position_quantization=0, export_draco_texcoord_quantization=0)
    original, original_bin = read_glb(out/'baseline.glb')
    document, binary = read_glb(path)
    assert len(document['images']) == len(original['images'])
    assert [m['name'] for m in document['materials']] == [m['name'] for m in original['materials']]
    # Keep the original texture bytes and all appearance settings, with image views relocated.
    image_views = [im['bufferView'] for im in document['images']]
    binary = bytearray(binary)
    for index, image in enumerate(original['images']):
        view = original['bufferViews'][image['bufferView']]
        data = original_bin[view.get('byteOffset', 0):view.get('byteOffset', 0)+view['byteLength']]
        binary.extend(b'\0'*(-len(binary)%4))
        document['bufferViews'][image_views[index]] = dict(buffer=0, byteOffset=len(binary), byteLength=len(data))
        binary.extend(data)
    for key in ('materials', 'textures', 'samplers', 'images'):
        document[key] = original[key]
    for image, view in zip(document['images'], image_views):
        image['bufferView'] = view
    binary.extend(b'\0'*(-len(binary)%4))
    document['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' '*(-len(encoded)%4)
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 28+len(encoded)+len(binary))+
                    struct.pack('<I4s', len(encoded), b'JSON')+encoded+
                    struct.pack('<I4s', len(binary), b'BIN\0')+binary)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    obj = next(o for o in bpy.context.selected_objects if o.type == 'MESH')
    actual = corners(obj)
    assert expected == actual, 'Triangle positions, per-corner UVs or material assignments changed in export'
    vertices = np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices])*1000
    faces = np.array([tuple(t.vertices) for t in obj.data.loop_triangles])
    np.savez_compressed(out/'roundtrip-mesh.npz', vertices=vertices, faces=faces)
    dimensions = dimensions_mm(obj)
    report = dict(mesh=validate_mesh(obj, weld=True), dimensionsXYZmm=dimensions,
        maxBboxErrorMm=max(abs(a-b) for a,b in zip(dimensions,dims)),
        supportMarginMm=support_margin_mm(obj), minZmm=float(vertices[:,2].min()),
        uvUnchanged=True, materialsUnchanged=True, textureBytesUnchanged=True,
        trianglePositionsMatchFloat32Candidate=True, bytes=path.stat().st_size,
        roundtripMeshSHA256=hashlib.sha256((out/'roundtrip-mesh.npz').read_bytes()).hexdigest(),
        candidateSHA256=hashlib.sha256(path.read_bytes()).hexdigest())
    assert report['mesh']['triangles'] <= 15000 and report['maxBboxErrorMm'] <= .5
    assert report['supportMarginMm'] >= 5 and abs(report['minZmm']) < 1e-8
    (out/'roundtrip-geometry.json').write_text(json.dumps(report, indent=2)+'\n')
    print('ROUNDTRIP_GEOMETRY_PASS', json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
