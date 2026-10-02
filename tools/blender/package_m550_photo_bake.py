"""SUPERSEDED by Phase D2 (package_m550_sibling.py, 2026-09-28): M550 is now delivered on the
M650 shell. Running this would reinstall or check the old B3 study; kept for the B3 record.

Install only the geometry-verified M550 candidate and its photo provenance."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
from pretty_json import write_pretty_json

HERE=Path(__file__).resolve().parent;OUT=HERE/'out/study-fidelity/b3'


def main():
    public=HERE.parents[1]/'public/models';slug='logitech-m550'
    geometry=json.loads((OUT/'geometry-evidence.json').read_text())
    cameras=json.loads((OUT/'camera-evidence.json').read_text())
    bake=json.loads((OUT/'bake-evidence.json').read_text())
    patch=json.loads((OUT/'delighting-patch.json').read_text())
    candidate=OUT/'logitech-m550-delivered.glb'
    assert hashlib.sha256(candidate.read_bytes()).hexdigest()==geometry['candidateSHA256']
    assert geometry['maxVertexDisplacementMm']==0 and geometry['trianglePositionsIdentical']
    assert geometry['bboxErrorMm']<=.5 and geometry['supportMarginMm']>=5
    assert all(row['iou']>=.95 for row in cameras['views'] if row['usedForTexturing'])
    assert any(not row['usedForTexturing'] for row in cameras['views'])
    assert not any(c['mirrored'] for c in bake['contributions']) or cameras['topMirrorIoU']>=.98
    assert patch['cvAfter']<patch['cvBefore']
    manifest=json.loads((public/'manifest.json').read_text(encoding='utf-8'))
    entry=next(e for e in manifest['studies'] if e['slug']==slug)
    untouched={e['slug']:deepcopy(e) for e in manifest['shells']+manifest['studies'] if e['slug']!=slug}
    refinement=dict(method=bake['method'],approximate=True,resolution=2048,
        maps=['BaseColour','Roughness','Metallic','Normal'],normalStrength=.65,
        photos=cameras['views'],cameraEvidence={k:v for k,v in cameras.items() if k!='views'},
        coverage=bake['coverage'],contributors=bake['contributions'],fill=bake['fill'],
        coverageMap='tools/blender/out/study-fidelity/b3/coverage-bits.png',
        perTexelWeights='tools/blender/out/study-fidelity/b3/contribution-weights.npz',
        delighting=bake['photoShading'],flatPatchEvidence=patch,
        pbrReference='logitech-m650 lossless AR bake: spatial/colour-labelled triangle-centroid samples',
        pbrRegions=bake['pbrRegions'],normalMethod='Log-luminance 2px high-pass, clamped shallow height, UV-gradient tangent normal; shader strength 0.65',
        limitation=bake['limitations'],positionEncoding='Draco, position quantisation disabled; exact original triangle positions',
        geometryBaseline='d448cc6:public/models/studies/logitech-m550.glb')
    entry.update(bytes=geometry['bytes'],textureRefinement=refinement,
        mesh=geometry['mesh'],dimensionsXYZmm=geometry['dimensionsXYZmm'],
        supportMarginMm=geometry['supportMarginMm'],calibratedBboxRoundTripDifferenceMm=geometry['bboxErrorMm'],
        deliveredTexture=geometry['deliveredTexture'])
    entry['limitations']=[v for v in entry['limitations'] if v!='Side image perspective has not been camera-calibrated']
    for text in [cameras['heldOutFinding'],bake['limitations']]:
        if text not in entry['limitations']:entry['limitations'].append(text)
    assert entry['status']=='limited-view-study'
    assert untouched=={e['slug']:e for e in manifest['shells']+manifest['studies'] if e['slug']!=slug}
    manifest['note']=manifest['note'].replace('5 gallery projections remain approximate.',
        '4 single-photo gallery projections and the M550 multi-view photo bake remain approximate.')
    validation=json.loads((public/'validation.json').read_text(encoding='utf-8'))
    validation['roundTrips']=[deepcopy(entry) if e['slug']==slug else e for e in validation['roundTrips']]
    folder=HERE/'out/polished'/slug
    report=json.loads((folder/'reconstruction.json').read_text())
    report.update(textureRefinement=refinement,limitations=entry['limitations'])
    shutil.copyfile(OUT/'logitech-m550-lossless.glb',folder/(slug+'.glb'))
    shutil.copyfile(candidate,public/entry['path'])
    write_pretty_json(folder/'reconstruction.json',report)
    write_pretty_json(public/'manifest.json',manifest);write_pretty_json(public/'validation.json',validation)
    print('M550_PACKAGED',entry['bytes'],flush=True)


if __name__=='__main__':main()
