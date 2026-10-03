"""Fit every nonexcluded inventory photo to a supplied committed study mesh."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from photo_camera_fit import crop_mask, evaluation_raster, fit_camera, silhouette_gap_mm


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--views', nargs='+')
    args = parser.parse_args()
    out = args.directory
    mesh = np.load(out/'baseline-mesh.npz')
    for row in json.loads((out/'photo-inventory.json').read_text()):
        if row['role'] == 'excluded' or (args.views and row['file'] not in args.views):
            continue
        dest = out/('camera-'+Path(row['file']).stem+'.json')
        if dest.exists():
            continue
        full = np.array(Image.open(out/row['maskFile']))>0
        target, crop = crop_mask(full)
        fit = fit_camera(mesh['vertices'], mesh['faces'], target, row['initialAngles'],
                         lambda stage: print(row['file'], stage, flush=True))
        fit.update(row)
        fit.update(crop=crop, principalPointPixels=[(crop[0]+crop[2]-1)/2,(crop[1]+crop[3]-1)/2],
                   meshUnits='mm', geometrySource='baseline-mesh.npz', mirrored=False)
        rendered, truth, scale = evaluation_raster(mesh['vertices'], mesh['faces'], target,
                                                  fit['fittedParameters'], fit['centreMm'])
        fit['largestGapMm'] = silhouette_gap_mm(rendered, truth, fit['distanceMm']/fit['focalPixels']/scale)
        overlay = np.zeros((*truth.shape,3), np.uint8)
        overlay[truth] = [225,70,70]
        overlay[rendered] = [40,170,240]
        overlay[truth & rendered] = [180,195,195]
        Image.fromarray(overlay).save(out/('baseline-fit-'+Path(row['file']).stem+'.png'))
        dest.write_text(json.dumps(fit, indent=2)+'\n')
        print('EVALUATED', row['file'], fit['iou'], fit['largestGapMm'], flush=True)


if __name__ == '__main__':
    main()
