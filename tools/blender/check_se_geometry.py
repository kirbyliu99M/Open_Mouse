"""Verify decoded SE sibling equality and geometry gates before installation."""
import json,sys
from pathlib import Path
import bpy
import numpy as np
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
from asset_utils import validate_mesh,dimensions_mm,support_margin_mm
OUT=HERE/'out/study-fidelity/b2';SE='logitech-g-pro-x-superlight-2-se';SIBLING=SE.removesuffix('-se')

def main():
    coords=[];uvs=[];stats=None
    for path in [HERE.parents[1]/'public/models/shells'/(SIBLING+'.glb'),OUT/(SE+'-delivered.glb')]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path));mesh=next(o for o in bpy.context.selected_objects if o.type=='MESH')
        coords.append(np.array([tuple(mesh.matrix_world@v.co) for v in mesh.data.vertices]))
        uvs.append(np.array([tuple(p.uv) for p in mesh.data.uv_layers.active.data]))
        dimensions=dimensions_mm(mesh);margin=support_margin_mm(mesh);stats=validate_mesh(mesh,weld=True)
    assert np.array_equal(coords[0],coords[1]),'SE positions differ from sibling'
    assert np.array_equal(uvs[0],uvs[1]),'SE UVs differ from sibling'
    error=max(abs(a-b) for a,b in zip(dimensions,[63.5,125,40]));assert error<=.5,(dimensions,error)
    assert margin>=5,margin
    ids=np.load(OUT/'region-ids.npy');mesh.data.calc_loop_triangles()
    areas={'upper':[0.,0.],'side':[0.,0.],'underside':[0.,0.]}
    for triangle in mesh.data.loop_triangles:
        uv=np.mean([mesh.data.uv_layers.active.data[i].uv[:] for i in triangle.loops],axis=0)
        x=min(2047,max(0,int(uv[0]*2048)));y=min(2047,max(0,int((1-uv[1])*2048)))
        normal=(mesh.matrix_world.to_3x3()@triangle.normal).normalized()
        group='upper' if normal.z>.5 else 'underside' if normal.z<-.35 else 'side'
        areas[group][1]+=triangle.area
        if ids[y,x]!=0:areas[group][0]+=triangle.area
    coverage={group:100*hit/total for group,(hit,total) in areas.items()}
    evidence=dict(regionBakeSurfaceCoveragePercent=coverage,maxVertexDisplacementMm=float(np.max(np.abs(coords[0]-coords[1]))*1000),uvsEqual=True,
        dimensionsXYZmm=dimensions,bboxErrorMm=error,supportMarginMm=margin,mesh=stats)
    (OUT/'geometry-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence),flush=True)

if __name__=='__main__':main()
