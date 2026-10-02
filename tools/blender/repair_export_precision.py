"""One-time cleanup for the existing reconstruction batch; no re-carving."""
import json
from pathlib import Path
import sys
import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from asset_utils import clean_export_mesh,validate_mesh,export_glb,dimensions_mm
if not bpy.app.background:raise RuntimeError('Background only')
failures=[]
for folder in sorted((HERE/'out/reconstructed').glob('*')):
    metadata=folder/'reconstruction.json'
    if not metadata.exists():continue
    record=json.loads(metadata.read_text())
    bpy.ops.wm.open_mainfile(filepath=str(folder/(folder.name+'.blend')))
    mesh=bpy.data.objects[folder.name]
    clean_export_mesh(mesh)
    try:
        record['mesh']=validate_mesh(mesh)
        record['exportCleanupToleranceMm']=.001
        record['dimensionsXYZmm']=dimensions_mm(mesh)
        path=folder/(folder.name+'.glb')
        export_glb([mesh],path)
        bpy.ops.wm.save_as_mainfile(filepath=str(folder/(folder.name+'.blend')))
        metadata.write_text(json.dumps(record,indent=2)+'\n')
        print('CLEANED',folder.name,flush=True)
    except Exception as error:
        failures.append({'slug':folder.name,'error':str(error)})
        print('FAILED',folder.name,str(error),flush=True)
(HERE/'out/export-cleanup-failures.json').write_text(json.dumps(failures,indent=2)+'\n')
if failures:raise SystemExit(1)
