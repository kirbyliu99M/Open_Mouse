"""Independent 1440px evaluation of the frozen candidate, including holdout.

Writes evidence and comparison sheets only. A failed gate returns exit 2;
never retry/tune a shape against held-out results.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from photo_camera_fit import evaluation_raster, silhouette_gap_mm
from photo_camera_math import silhouette_iou
from study_deformation_math import delivery_gate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--round-trip', action='store_true')
    args = parser.parse_args()
    out = args.directory
    baseline = np.load(out/'baseline-mesh.npz')
    candidate = np.load(out/('roundtrip-mesh.npz' if args.round_trip else 'candidate-mesh.npz'))
    if not args.round_trip:
        assert np.array_equal(baseline['faces'],candidate['faces'])
    deformation = json.loads((out/'deformation.json').read_text())
    assert not deformation['heldOutUsed'] and not deformation['cameraRefitted']
    rows = [r for r in json.loads((out/'photo-inventory.json').read_text()) if r['role']!='excluded']
    sheet = Image.new('RGB',(1200,300*len(rows)), '#e4e7eb')
    draw = ImageDraw.Draw(sheet)
    results = []
    for i,row in enumerate(rows):
        camera = json.loads((out/('camera-'+Path(row['file']).stem+'.json')).read_text())
        x0,y0,x1,y1 = camera['crop']
        mask = np.array(Image.open(out/row['maskFile']))>0
        mask = mask[y0:y1,x0:x1]
        rendered = []
        gaps = []
        scores = []
        for mesh in (baseline,candidate):
            prediction,truth,scale = evaluation_raster(mesh['vertices'],mesh['faces'],mask,
                camera['fittedParameters'],camera['centreMm'])
            scores.append(silhouette_iou(prediction,truth))
            gaps.append(silhouette_gap_mm(prediction,truth,camera['distanceMm']/camera['focalPixels']/scale))
            overlay = np.full((*truth.shape,3),235,np.uint8)
            overlay[truth] = [225,70,70]
            overlay[prediction] = [40,170,240]
            overlay[truth & prediction] = [160,180,180]
            rendered.append(Image.fromarray(overlay))
        assert abs(scores[0]-camera['iou']) < 1e-12, 'Baseline camera/mask evidence drift'
        entry = dict(file=row['file'],view=row['view'],role=row['role'],
                     beforeIoU=scores[0],afterIoU=scores[1],deltaIoU=scores[1]-scores[0],
                     beforeGapMm=gaps[0],afterGapMm=gaps[1])
        results.append(entry)
        source = Path(__file__).resolve().parent/'out/reference-library'/out.name/row['file']
        photo = Image.open(source).convert('RGBA').crop((x0,y0,x1,y1))
        bg = Image.new('RGBA',photo.size,'#e4e7eb')
        photo = Image.alpha_composite(bg,photo).convert('RGB')
        for j,pic in enumerate([photo,*rendered]):
            pic.thumbnail((390,240))
            sheet.paste(pic,(400*j+(400-pic.width)//2,300*i))
        draw.text((8,300*i+244),row['file']+' | '+row['role'],fill='black')
        draw.text((8,300*i+263),row['view'],fill='black')
        draw.text((410,300*i+244),f'Baseline IoU {scores[0]:.9f} | gap {gaps[0]:.4f} mm',fill='black')
        draw.text((810,300*i+244),f'Candidate IoU {scores[1]:.9f} | gap {gaps[1]:.4f} mm',fill='black')
        rendered[1].save(out/('candidate-fit-'+Path(row['file']).stem+'.png'))
    fitting = [r for r in results if r['role']=='fit']
    held = [r for r in results if r['role']=='held-out']
    gate = delivery_gate([r['beforeIoU'] for r in fitting],[r['afterIoU'] for r in fitting],
                         [r['beforeIoU'] for r in held],[r['afterIoU'] for r in held])
    report = dict(views=results,gate=gate,camerasFrozen=True,evaluationMaxDimension=1440,
                  largestRemainingGapMm=max(r['afterGapMm'] for r in results),
                  gapInterpretation='Projected boundary Hausdorff gap at fitted target plane, not 3D surface error')
    if args.round_trip:
        geometry = json.loads((out/'roundtrip-geometry.json').read_text())
        assert geometry['roundtripMeshSHA256'] == hashlib.sha256((out/'roundtrip-mesh.npz').read_bytes()).hexdigest()
        assert geometry['candidateSHA256'] == hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest()
        report['candidateSHA256'] = geometry['candidateSHA256']
    prefix = 'roundtrip-' if args.round_trip else ''
    (out/(prefix+'silhouette-evaluation.json')).write_text(json.dumps(report,indent=2)+'\n')
    sheet.save(out/(prefix+'silhouette-comparison.png'))
    print(json.dumps(report),flush=True)
    if not gate['passed']:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
