"""Blender geometry gates and shared-light four-view renders, no publication."""
import argparse
import json
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from asset_utils import dimensions_mm, support_margin_mm, validate_mesh
from photo_camera_math import camera_axes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    out = args.directory.resolve()
    assert bpy.app.version==(5,2,2) and sys.version_info[:2]==(3,13)
    before = np.load(out/'baseline-mesh.npz')
    after = np.load(out/'candidate-mesh.npz')
    dimensions = json.loads((out/'baseline-geometry.json').read_text())['catalogueDimensionsXYZmm']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(out/'baseline.glb'))
    obj = next(o for o in bpy.context.selected_objects if o.type=='MESH')
    points = np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices])*1000
    np.testing.assert_array_equal(points,before['vertices'])
    uv = [[tuple(v.uv) for v in layer.data] for layer in obj.data.uv_layers]
    materials = list(obj.data.materials)
    material_indices = [p.material_index for p in obj.data.polygons]
    ground = abs(points[:,2]) < 1e-8
    assert np.max(abs(after['vertices'][ground,2])) < 1e-8
    evidence = dict(groundVertexMaxDisplacementZmm=float(np.max(abs(after['vertices'][ground,2]))),
                    topologyUnchanged=bool(np.array_equal(before['faces'],after['faces'])))
    inverse = obj.matrix_world.inverted()
    for vertex, point in zip(obj.data.vertices,after['vertices']):
        vertex.co = inverse @ Vector(point/1000)
    obj.data.update()
    bpy.context.view_layer.update()
    evidence.update(mesh=validate_mesh(obj,weld=True),dimensionsXYZmm=dimensions_mm(obj),
                    supportMarginMm=support_margin_mm(obj),minZmm=float(after['vertices'][:,2].min()))
    evidence['maxBboxErrorMm'] = max(abs(a-b) for a,b in zip(evidence['dimensionsXYZmm'],dimensions))
    assert evidence['mesh']['triangles'] <= 15000 and evidence['maxBboxErrorMm'] <= .5
    assert evidence['supportMarginMm'] >= 5 and abs(evidence['minZmm']) < 1e-8
    assert uv==[[tuple(v.uv) for v in layer.data] for layer in obj.data.uv_layers]
    assert materials==list(obj.data.materials) and material_indices==[p.material_index for p in obj.data.polygons]
    evidence.update(uvUnchanged=True,materialsUnchanged=True,materialAssignmentUnchanged=True)
    faces = before['faces']
    def areas(vertices):
        t = vertices[faces]
        return np.linalg.norm(np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]),axis=1)/2
    ratios = areas(after['vertices'])/areas(before['vertices'])
    evidence['surfaceAreaRatio'] = dict(min=float(ratios.min()),p05=float(np.percentile(ratios,5)),
        median=float(np.median(ratios)),p95=float(np.percentile(ratios,95)),max=float(ratios.max()))
    (out/'candidate-geometry.json').write_text(json.dumps(evidence,indent=2)+'\n')
    scene = bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.samples=16
    scene.render.resolution_x=scene.render.resolution_y=512
    scene.render.resolution_percentage=100
    scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGBA'
    scene.view_settings.view_transform='Standard'
    scene.view_settings.look='None'
    scene.view_settings.exposure=0
    scene.view_settings.gamma=1
    world=bpy.data.worlds.new('D1 shared studio')
    world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.12,.12,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.6
    scene.world=world
    for position,power,size in [((-.20,.15,.4),4,.35),((.25,-.1,.3),2,.3)]:
        data=bpy.data.lights.new('Softbox','AREA')
        data.energy=power
        data.size=size
        light=bpy.data.objects.new('Softbox',data)
        scene.collection.objects.link(light)
        light.location=position
        light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Camera')
    data.type='ORTHO'
    data.ortho_scale=max(dimensions)/1000*1.3
    data.clip_start=.001
    cam=bpy.data.objects.new('Camera',data)
    scene.collection.objects.link(cam)
    scene.camera=cam
    centre=Vector((0,0,dimensions[2]/2000))
    for name,vertices in [('baseline',before['vertices']),('candidate',after['vertices'])]:
        for vertex,point in zip(obj.data.vertices,vertices):
            vertex.co=inverse @ Vector(point/1000)
        obj.data.update()
        for view,angles in [('top',(180,90,0)),('side',(-90,0,0)),
                            ('front',(0,0,0)),('hero',(-145,40,0))]:
            rotation=Matrix(camera_axes(*angles)).transposed()
            cam.matrix_world=rotation.to_4x4()
            cam.location=centre+rotation@Vector((0,0,.4))
            scene.render.filepath=str(out/f'{name}-{view}.png')
            bpy.ops.render.render(write_still=True)
    print('CANDIDATE_GEOMETRY_PASS',json.dumps(evidence),flush=True)


if __name__=='__main__':
    main()
