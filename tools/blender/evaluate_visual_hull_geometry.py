"""D5a's independent 1440px evaluation of the frozen visual-hull candidate.

`evaluate_study_geometry.py` is the D1 delivery gate and is not modified:
it asserts `baseline['faces'] == candidate['faces']`, which only holds for
a topology-preserving deformation. D5a is a declared full rebuild (new
topology by design -- marching cubes, remesh, UV transfer), so this script
re-implements the *same* gate computation from the *same* tested library
functions (`evaluation_raster`, `silhouette_iou` from photo_camera_fit /
photo_camera_math; `delivery_gate` from study_deformation_math), with the
same frozen cameras, the same 1440px resolution, and no relaxation. It
only drops the single topology-identity bookkeeping assertion that does
not apply to a rebuild. Writes the same evidence shape (`*-silhouette-
evaluation.json`, a comparison sheet) as evaluate_study_geometry.py.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from photo_camera_fit import evaluation_raster, silhouette_gap_mm
from photo_camera_math import silhouette_iou
from study_deformation_math import delivery_gate

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True, help='out/d5/<slug>, with a copy of the D1 evidence')
    parser.add_argument('--reference-slug', help='slug to find original photos under out/reference-library (defaults to --directory name)')
    args = parser.parse_args()
    out = args.directory
    baseline = np.load(out/'baseline-mesh.npz')
    candidate = np.load(out/'candidate-mesh.npz')
    deformation = json.loads((out/'hull-deformation.json').read_text())
    assert deformation['topologyChanged'] and not deformation['heldOutUsed'] and not deformation['cameraRefitted']
    rows = [r for r in json.loads((out/'photo-inventory.json').read_text()) if r['role'] != 'excluded']
    sheet = Image.new('RGB', (1200, 300*len(rows)), '#e4e7eb')
    draw = ImageDraw.Draw(sheet)
    results = []
    reference_slug = args.reference_slug or out.name
    for i, row in enumerate(rows):
        camera = json.loads((out/('camera-'+Path(row['file']).stem+'.json')).read_text())
        x0, y0, x1, y1 = camera['crop']
        mask = np.array(Image.open(out/row['maskFile'])) > 0
        mask = mask[y0:y1, x0:x1]
        rendered, gaps, scores = [], [], []
        for mesh in (baseline, candidate):
            prediction, truth, scale = evaluation_raster(mesh['vertices'], mesh['faces'], mask,
                camera['fittedParameters'], camera['centreMm'])
            scores.append(silhouette_iou(prediction, truth))
            gaps.append(silhouette_gap_mm(prediction, truth, camera['distanceMm']/camera['focalPixels']/scale))
            overlay = np.full((*truth.shape, 3), 235, np.uint8)
            overlay[truth] = [225, 70, 70]
            overlay[prediction] = [40, 170, 240]
            overlay[truth & prediction] = [160, 180, 180]
            rendered.append(Image.fromarray(overlay))
        assert abs(scores[0]-camera['iou']) < 1e-12, 'Baseline camera/mask evidence drift'
        entry = dict(file=row['file'], view=row['view'], role=row['role'],
                     beforeIoU=scores[0], afterIoU=scores[1], deltaIoU=scores[1]-scores[0],
                     beforeGapMm=gaps[0], afterGapMm=gaps[1])
        results.append(entry)
        source = HERE/'out/reference-library'/reference_slug/row['file']
        photo = Image.open(source).convert('RGBA').crop((x0, y0, x1, y1))
        bg = Image.new('RGBA', photo.size, '#e4e7eb')
        photo = Image.alpha_composite(bg, photo).convert('RGB')
        for j, pic in enumerate([photo, *rendered]):
            pic.thumbnail((390, 240))
            sheet.paste(pic, (400*j+(400-pic.width)//2, 300*i))
        draw.text((8, 300*i+244), row['file']+' | '+row['role'], fill='black')
        draw.text((8, 300*i+263), row['view'], fill='black')
        draw.text((410, 300*i+244), f'Baseline IoU {scores[0]:.9f} | gap {gaps[0]:.4f} mm', fill='black')
        draw.text((810, 300*i+244), f'Candidate IoU {scores[1]:.9f} | gap {gaps[1]:.4f} mm', fill='black')
        rendered[1].save(out/('candidate-fit-'+Path(row['file']).stem+'.png'))
    fitting = [r for r in results if r['role'] == 'fit']
    held = [r for r in results if r['role'] == 'held-out']
    gate = delivery_gate([r['beforeIoU'] for r in fitting], [r['afterIoU'] for r in fitting],
                         [r['beforeIoU'] for r in held], [r['afterIoU'] for r in held])
    report = dict(views=results, gate=gate, camerasFrozen=True, evaluationMaxDimension=1440,
                  largestRemainingGapMm=max(r['afterGapMm'] for r in results),
                  gapInterpretation='Projected boundary Hausdorff gap at fitted target plane, not 3D surface error',
                  method='D5a visual-hull rebuild; re-implements evaluate_study_geometry.py\'s gate '
                         'computation from the same tested functions because the candidate has new '
                         'topology by design, which the frozen script\'s face-equality check does not accept')
    (out/'silhouette-evaluation.json').write_text(json.dumps(report, indent=2)+'\n')
    sheet.save(out/'silhouette-comparison.png')
    print(json.dumps(report), flush=True)
    if not gate['passed']:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
