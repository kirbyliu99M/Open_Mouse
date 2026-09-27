"""Validate final GLB round trips, package reviewed-as-provisional meshes,
and assemble a Blender catalogue scene. Does not publish or merge anything.
"""
import json
import argparse
import math
from pathlib import Path
import shutil
import sys
import bpy
from mathutils import Matrix, Euler
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from asset_utils import validate_mesh,dimensions_mm,studio,label,material
from pretty_json import write_pretty_json
ROOT=HERE/'out/reconstructed'
PUBLIC=HERE.parent.parent/'public/models'


def main():
    global ROOT
    if not bpy.app.background:raise RuntimeError('Background process only')
    parser=argparse.ArgumentParser();parser.add_argument('--colored',action='store_true');parser.add_argument('--polished',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if args.colored:ROOT=HERE/'out/colored'
    if args.polished:ROOT=HERE/'out/polished'
    old_manifest=json.loads((PUBLIC/'manifest.json').read_text())
    catalogue=json.loads((HERE/'params/reference-catalogue.json').read_text(encoding='utf-8-sig'))
    specs={m['brand'].lower()+'-'+''.join(c.lower() if c.isalnum() else '-' for c in m['model']).strip('-'):m for m in catalogue}
    review=bpy.data.scenes.new('Open_Mouse_Polished_Review' if args.polished else 'Open_Mouse_Colour_Review' if args.colored else 'Open_Mouse_Reference_Rebuild')
    results=[]
    for folder in sorted(ROOT.glob('*')):
        metadata=folder/'reconstruction.json'
        if not metadata.exists():continue
        record=json.loads(metadata.read_text())
        if 'mesh' not in record:raise RuntimeError('Unvalidated source mesh: '+folder.name)
        path=folder/(folder.name+'.glb')
        scene=bpy.data.scenes.new('RoundTrip_'+folder.name)
        bpy.context.window.scene=scene
        bpy.ops.import_scene.gltf(filepath=str(path))
        meshes=[obj for obj in scene.objects if obj.type=='MESH']
        if len(meshes)!=1:raise RuntimeError('Expected one fit mesh')
        mesh=meshes[0]
        stats=validate_mesh(mesh,weld=True)
        actual=dimensions_mm(mesh)
        specification=specs[folder.name]
        target=[specification['widthMm'],specification['lengthMm'],specification['heightMm']]
        error=max(abs(a-b) for a,b in zip(actual,target))
        if error>.5 or stats['triangles']>15000:raise RuntimeError('Round trip failed: '+folder.name)
        study=record.get('referenceMode')=='gallery-only'
        results.append({'slug':folder.name,'model':specification['model'],'status':'limited-view-study' if study else 'reference-derived-review',
            'method':record['method'],'source':record['source'],'mesh':stats,'dimensionsXYZmm':actual,'calibratedBboxRoundTripDifferenceMm':error,
            'uncalibratedDimensionsXYZmm':record['uncalibratedDimensionsXYZmm'],'dimensionCalibrationScale':record['dimensionCalibrationScale'],
            'bytes':path.stat().st_size,'path':('studies/' if study else 'shells/')+path.name})
        if args.colored:
            results[-1]['colourVerification']=record['colourVerification']
            from asset_utils import glb_json
            primitives=[p for m in glb_json(path)['meshes'] for p in m['primitives']]
            if not all('COLOR_0' in p['attributes'] for p in primitives):raise RuntimeError('Missing exported vertex colour: '+folder.name)
        if args.polished:
            from asset_utils import glb_json
            data=glb_json(path)
            if not data.get('textures') or not all('TEXCOORD_0' in p['attributes'] for m in data['meshes'] for p in m['primitives']):raise RuntimeError('Missing texture/UV data: '+folder.name)
            from mathutils import Vector
            ground=min((mesh.matrix_world@Vector(p)).z for p in mesh.bound_box)
            if abs(ground)>.00001:raise RuntimeError('Base not on ground: '+folder.name)
            results[-1].update(orientation=record['orientation'],textureRefinement=record['textureRefinement'],groundErrorMm=abs(ground)*1000)
        # A display copy keeps exported geometry in its original metric frame.
        display=mesh.copy();display.data=mesh.data.copy();review.collection.objects.link(display)
        index=len(results)-1;col=index%6;row=index//6
        display.parent=None
        display.matrix_world=Matrix.Translation(((col-2.5)*.22,(2-row)*.22,0)) @ (Matrix.Identity(4) if args.polished else Euler((math.radians(45),0,math.radians(25))).to_matrix().to_4x4()) @ mesh.matrix_world
        if study and not args.colored and not args.polished:
            display.data.materials.clear();display.data.materials.append(material('Limited-view amber',(.45,.25,.08),.6))
        for obj in list(scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.context.window.scene=review;bpy.data.scenes.remove(scene)
        title=label(specification['model'],display.location.x-.09,display.location.y-.085,.007)
        status=label('2-VIEW STUDY' if study else 'TEXTURED REBUILD' if args.polished else 'REFERENCE REBUILD',display.location.x-.09,display.location.y-.1,.0045)
        if args.polished:title.location.z=status.location.z=.0005
    expected=set(specs)
    actual={r['slug'] for r in results}
    if actual!=expected:raise RuntimeError(f'Catalogue mismatch: missing={sorted(expected-actual)}, extra={sorted(actual-expected)}')
    # All checks complete before installing any replacement shell.
    archive=HERE/'out/legacy-first-batch';archive.mkdir(exist_ok=True)
    for entry in old_manifest.get('shells',[]):
        old=PUBLIC/'shells'/((entry.get('id') or entry.get('slug'))+'.glb')
        if old.exists() and not (archive/old.name).exists():shutil.copy2(old,archive/old.name)
    for result in results:
        destination=PUBLIC/result['path'];destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/result['slug']/(result['slug']+'.glb'),destination)
    report={'status':'visual-review-pending','galleryImageCount':658,'fullRotationReferenceModels':26,'viewsPerRotation':26,
        'shells':[r for r in results if r['status']=='reference-derived-review'],
        'studies':[r for r in results if r['status']=='limited-view-study'],
        'hand':old_manifest.get('hand'),'measurementNotes':{'calibratedBboxRoundTripDifferenceMm':'Export precision after forced scaling to catalogue L/W/H; not independent physical accuracy','silhouetteIoU':'In-sample comparison with the same reference views used for reconstruction; not independent validation'},'note':'Manufacturer AR-render depth reconstruction plus explicitly limited gallery studies. Fine detail and runtime orientation require review. Colour pass samples manufacturer albedo/PBR maps when available; twelve gallery palettes are approximate.' if args.colored else 'Manufacturer AR-render depth reconstruction plus explicitly limited gallery studies. Original reference files remain local. Fine detail and runtime orientation require review.'}
    write_pretty_json(PUBLIC/'manifest.json', report)
    write_pretty_json(PUBLIC/'validation.json', {'roundTrips':results,'maxCalibratedBboxRoundTripDifferenceMm':max(r['calibratedBboxRoundTripDifferenceMm'] for r in results),'passed':True})
    bpy.context.window.scene=review
    studio(review,1.5,1.3)
    title=label('OPEN_MOUSE / POLISHED CATALOGUE' if args.polished else 'OPEN_MOUSE / REFERENCE REBUILD',-.70,.60,.015)
    caption=label('Base down / nose +Y / 26 baked materials + 12 gallery studies' if args.polished else '26 source reconstructions + 12 limited-view studies / visual acceptance pending',-.70,.575,.007)
    if args.polished:
        title.location.z=caption.location.z=.0005
        review.camera.location=(0,-1.4,1.9)
        review.camera.rotation_euler=(-review.camera.location).to_track_quat('-Z','Y').to_euler()
        review.camera.data.ortho_scale=1.65
        bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.0001))
        plane=bpy.context.object;plane.name='Desk surface';plane.data.materials.append(material('Desk',(.025,.033,.044),.8))
        report['orientationConvention']={'blender':'Z up, nose +Y, ground Z=0','gltf':'Y up, nose -Z, ground Y=0'}
        report['note']='Polished source-derived texture bakes on reconstructed geometry; canonical desk orientation. Twelve gallery projections remain approximate. Physical verification and final acceptance pending.'
        write_pretty_json(PUBLIC/'manifest.json', report)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'catalogue-review.blend'))
    print('PACKAGED',len(results),'MAX_BBOX_ERROR_MM',max(r['calibratedBboxRoundTripDifferenceMm'] for r in results),flush=True)


if __name__=='__main__':main()
