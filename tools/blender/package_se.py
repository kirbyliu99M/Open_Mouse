"""Install only the validated SE candidate; preserve every other manifest entry/GLB."""
from copy import deepcopy
import hashlib,json,shutil
from pathlib import Path
from pretty_json import write_pretty_json
from recolour_se import HERE,OUT,SE,SIBLING


def main():
    public=HERE.parents[1]/'public/models'
    delivery=json.loads((OUT/'delivery-evidence.json').read_text())
    geometry=json.loads((OUT/'geometry-evidence.json').read_text())
    colours=json.loads((OUT/'colour-evidence.json').read_text())
    cameras=json.loads((OUT/'camera-evidence.json').read_text())
    candidate=OUT/(SE+'-delivered.glb')
    assert hashlib.sha256(candidate.read_bytes()).hexdigest()==delivery['candidateSHA256']
    assert geometry['maxVertexDisplacementMm']==0 and geometry['uvsEqual']
    assert geometry['bboxErrorMm']<=.5 and geometry['supportMarginMm']>=5
    assert all(row['deliveredDeltaE2000']<=5 for row in delivery['regions'] if row['region'] in ('shell','main_buttons','side_buttons'))
    assert all(row['iou']>=.95 for row in cameras['views'])
    manifest=json.loads((public/'manifest.json').read_text(encoding='utf-8'))
    sibling=next(e for e in manifest['shells'] if e['slug']==SIBLING)
    entry=deepcopy(sibling)
    sources=json.loads((HERE/'out/reference-library'/SE/'sources.json').read_text())
    # Look up exact photo source URLs in local first-party provenance.
    photo_records=[]
    for value in colours['photos'].values():
        if any(p['file']==value['file'] for p in photo_records):continue
        match=next(p for p in sources['images'] if p['file']==value['file'])
        photo_records.append(dict(file=value['file'],url=match['url'],sha256=value['sha256']))
    inheritance=dict(slug=SIBLING,deliveredSHA256=delivery['sourceSHA256'],
        geometryAndUV='Byte-identical compressed geometry and UV atlas; decoded vertex displacement 0 mm',
        detailMaps='Byte-identical sibling tangent normal and packed metallic/roughness maps',
        preservedBufferViews=delivery['preservedBufferViews'],
        decision='Kirby approved the Superlight 2 sibling shell and detail-map route for red SE on 2026-09-28',
        a2=dict(topIoU=.994485,sideIoU=.989098,topMaxBoundaryGapMm=1.008,sideMaxBoundaryGapMm=2.338,
            interpretation='Original same-shell gate inconclusive at a narrow seam; substitution is Kirby-approved, not a changed gate'))
    refinement=dict(method=colours['method'],resolution=2048,maps=['BaseColour','Roughness','Normal','Metallic'],
        source=sibling['source'],normalStrength=.65,baseColourPhotos=photo_records,
        baseColourRegions=delivery['regions'],cameraRegistration=cameras,
        regionBakeSurfaceCoveragePercent=geometry['regionBakeSurfaceCoveragePercent'],
        colourLimitation=colours['limitation'],
        smallFeatureLimitations='512px JPEG red chroma bleed shifts side wordmark and subpixel indicator; filtered high-contrast inherited underside logo shifts its median. Underside regulatory glyphs retain sibling artwork and relative contrast; not SE serial/model-label evidence.')
    entry.update(slug=SE,model='G Pro X Superlight 2 SE',status='reference-derived-review',
        method='Kirby-approved Superlight 2 AR-derived sibling shell with photo-measured red SE base colour',
        path='shells/'+SE+'.glb',bytes=delivery['bytes'],dimensionsXYZmm=geometry['dimensionsXYZmm'],
        calibratedBboxRoundTripDifferenceMm=geometry['bboxErrorMm'],mesh=geometry['mesh'],
        supportMarginMm=geometry['supportMarginMm'],textureRefinement=refinement,inheritedShell=inheritance)
    manifest['studies']=[e for e in manifest['studies'] if e['slug']!=SE]
    manifest['shells']=[e for e in manifest['shells'] if e['slug']!=SE]+[entry]
    manifest['shells'].sort(key=lambda e:e['slug'])
    manifest['fullRotationReferenceModels']=sum(not e.get('aliasOf') for e in manifest['shells'])
    manifest['note']=manifest['note'].replace('6 gallery projections','5 gallery projections')
    validation=json.loads((public/'validation.json').read_text(encoding='utf-8'))
    validation['roundTrips']=[entry if e['slug']==SE else e for e in validation['roundTrips']]
    report=deepcopy(json.loads((HERE/'out/polished'/SIBLING/'reconstruction.json').read_text()))
    report.update(slug=SE,status='reference-derived review mesh; sibling route approved; colour visual acceptance pending',
        method=entry['method'],textureRefinement=refinement,inheritedShell=inheritance)
    write_pretty_json(HERE/'out/polished'/SE/'reconstruction.json',report)
    shutil.copyfile(candidate,public/entry['path'])
    (public/'studies'/(SE+'.glb')).unlink(missing_ok=True)
    write_pretty_json(public/'manifest.json',manifest);write_pretty_json(public/'validation.json',validation)
    print('PACKAGED_SE',entry['bytes'],flush=True)

if __name__=='__main__':main()
