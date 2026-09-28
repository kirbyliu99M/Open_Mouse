"""SUPERSEDED by Phase D2 (package_m550_sibling.py, 2026-09-28): M550 is now delivered on the
M650 shell. Running this would reinstall or check the old B3 study; kept for the B3 record.

Blender gate of the delivered candidate before replacing any public asset."""
import hashlib
import json
from pathlib import Path
import sys
import bpy
import numpy as np
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
from asset_utils import validate_mesh, dimensions_mm, support_margin_mm, glb_json
OUT=HERE/'out/study-fidelity/b3'


def main():
    position_sets=[];triangle_sets=[]
    for path in [OUT/'old-m550.glb',OUT/'logitech-m550-delivered.glb']:
        bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(path))
        obj=next(o for o in bpy.context.selected_objects if o.type=='MESH')
        obj.data.calc_loop_triangles()
        positions=[tuple(obj.matrix_world@v.co) for v in obj.data.vertices]
        position_sets.append(set(positions))
        triangle_sets.append(sorted(tuple(sorted(positions[i] for i in t.vertices)) for t in obj.data.loop_triangles))
    assert position_sets[0]==position_sets[1],'Decoded positions differ'
    assert triangle_sets[0]==triangle_sets[1],'Triangle position connectivity differs'
    assert len(obj.data.materials)==1
    document=glb_json(OUT/'logitech-m550-delivered.glb')
    assert len(document['materials'])==1 and len(document['images'])==3
    assert document['materials'][0]['normalTexture']['scale']==float(np.float32(.65))
    assert all(i['mimeType']=='image/jpeg' for i in document['images'])
    images={n.image for n in obj.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE'}
    assert all(tuple(im.size)==(512,512) for im in images)
    dimensions=dimensions_mm(obj);error=max(abs(a-b) for a,b in zip(dimensions,[61,108.2,38.8]))
    margin=support_margin_mm(obj);stats=validate_mesh(obj,weld=True)
    assert error<=.5 and margin>=5
    result=dict(maxVertexDisplacementMm=0,trianglePositionsIdentical=True,dimensionsXYZmm=dimensions,
        bboxErrorMm=error,supportMarginMm=margin,mesh=stats,materials=1,
        deliveredTexture=dict(format='JPEG',maxResolution=512,maps=3,normalEncoding='JPEG q90 4:4:4'),
        normalStrength=.65,bytes=(OUT/'logitech-m550-delivered.glb').stat().st_size,
        candidateSHA256=hashlib.sha256((OUT/'logitech-m550-delivered.glb').read_bytes()).hexdigest())
    (OUT/'geometry-evidence.json').write_text(json.dumps(result,indent=2)+'\n')
    print('M550_GEOMETRY_AND_MATERIAL_PASSED',json.dumps(result),flush=True)


if __name__=='__main__':main()
