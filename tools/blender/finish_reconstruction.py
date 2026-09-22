"""Make review GLBs from image-derived isosurfaces and render matched views."""
import argparse
import json
from pathlib import Path
import sys
import bpy
import numpy as np
from mathutils import Matrix, Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from asset_utils import mesh_object, material, apply_modifier, validate_mesh, export_glb, dimensions_mm, clean_export_mesh


def finish(folder):
    report=json.loads((folder/'reconstruction.json').read_text())
    scene=bpy.data.scenes.new('Rebuilt_'+report['slug'])
    bpy.context.window.scene=scene
    data=np.load(folder/'mesh.npz')
    mesh=mesh_object(report['slug'],data['vertices'].tolist(),data['faces'].tolist())
    smooth=mesh.modifiers.new('Sampling smoothing','SMOOTH')
    smooth.factor,smooth.iterations=.65,(2 if report.get('referenceMode')=='gallery-only' else 12)
    apply_modifier(mesh,smooth)
    dec=mesh.modifiers.new('Web topology budget','DECIMATE')
    dec.ratio=min(1,14000/len(mesh.data.polygons))
    apply_modifier(mesh,dec)
    # Physical dimensions are a separate measured constraint. Record the raw
    # reconstruction discrepancy before applying this explicit calibration.
    vertices=mesh.data.vertices
    low=np.array([min(v.co[a] for v in vertices) for a in range(3)])
    high=np.array([max(v.co[a] for v in vertices) for a in range(3)])
    wanted=np.asarray(report['dimensionsXYZ'])
    report['uncalibratedDimensionsXYZmm']=((high-low)*1000).tolist()
    report['dimensionCalibrationScale']=(wanted/(high-low)).tolist()
    for vertex in vertices:
        point=(np.array(vertex.co)-low)/(high-low)*wanted
        point[:2]-=wanted[:2]/2
        vertex.co=point
    mesh.data.update()
    clean_export_mesh(mesh)
    for p in mesh.data.polygons:
        p.use_smooth=True
    mesh.data.materials.append(material('Neutral reconstruction',(.24,.40,.46),.52))
    bpy.context.view_layer.update()
    measured=dimensions_mm(mesh)
    target=np.asarray(report['dimensionsXYZ'])*1000
    report['dimensionsXYZmm']=measured
    report['bboxErrorMm']=max(abs(np.asarray(measured)-target)).item()
    report['mesh']=validate_mesh(mesh)
    if report['mesh']['triangles']>15000 or report['bboxErrorMm']>.5:
        raise RuntimeError(f"Geometry gate failed: {report['slug']} {report['bboxErrorMm']} {report['mesh']['triangles']}")
    mesh['provenance']=report['method']
    export_glb([mesh],folder/(report['slug']+'.glb'))
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/(report['slug']+'.blend')))
    calibration=json.loads((HERE/report['cameraFile']).read_text())
    camera_data=bpy.data.cameras.new('MatchedCamera')
    camera_data.type='ORTHO'
    camera_data.clip_start=.0001
    camera=bpy.data.objects.new('MatchedCamera',camera_data)
    scene.collection.objects.link(camera)
    scene.camera=camera
    scene.render.resolution_x=scene.render.resolution_y=512
    scene.render.resolution_percentage=100
    scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGBA'
    if hasattr(scene,'eevee'):
        scene.eevee.taa_render_samples=8
    scene.world=bpy.data.worlds.new('RebuiltWorld')
    scene.world.color=(.3,.3,.3)
    for i,pos in enumerate([(-.3,-.3,.6),(.3,.15,.45)]):
        light_data=bpy.data.lights.new('Light','AREA')
        light_data.energy=8 if i==0 else 4
        light_data.size=.35
        light=bpy.data.objects.new('Light',light_data)
        scene.collection.objects.link(light)
        light.location=pos
        light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
    (folder/'renders').mkdir(exist_ok=True)
    for view in calibration['views']:
        camera.matrix_world=Matrix(view['worldToCamera']).inverted()
        camera_data.ortho_scale=view['orthoScale']
        scene.render.filepath=str(folder/'renders'/view['image'])
        bpy.ops.render.render(write_still=True)
    (folder/'reconstruction.json').write_text(json.dumps(report,indent=2)+'\n')
    print('FINISHED',report['slug'],report['bboxErrorMm'],report['mesh']['triangles'],flush=True)
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj,do_unlink=True)
    bpy.context.window.scene=bpy.data.scenes[0]
    bpy.data.scenes.remove(scene)
    bpy.data.orphans_purge(do_recursive=True)


if __name__=='__main__':
    if not bpy.app.background:
        raise RuntimeError('Background only')
    parser=argparse.ArgumentParser()
    parser.add_argument('--model')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    failures=[]
    for folder in sorted((HERE/'out/reconstructed').glob('*')):
        if (folder/'mesh.npz').exists() and (not args.model or folder.name in args.model.split(',')):
            try:
                finish(folder)
            except Exception as error:
                failures.append({'slug':folder.name,'error':str(error)})
                print('FAILED',folder.name,str(error),flush=True)
    (HERE/'out/reconstruction-failures.json').write_text(json.dumps(failures,indent=2)+'\n')
    if failures:
        raise SystemExit(1)
