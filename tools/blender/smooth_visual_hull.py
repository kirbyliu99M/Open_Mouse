"""D5a step 2: Taubin-smooth the raw marching-cubes hull, keeping the flat
Z=0 base pinned, then recalibrate to the catalogue bounding box (smoothing
very slightly erodes the silhouette-tight extent). Writes `smoothed-mesh.npz`.
"""
import argparse
import json
from pathlib import Path

import numpy as np

from mesh_smoothing_math import taubin_smooth
from study_deformation_math import calibrate_bbox


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='out/d5/<slug>')
    parser.add_argument('--geometry', type=Path, required=True, help='baseline-geometry.json (for catalogue dims)')
    parser.add_argument('--iterations', type=int, default=15)
    parser.add_argument('--lam', type=float, default=0.5)
    parser.add_argument('--mu', type=float, default=-0.53)
    args = parser.parse_args()

    hull = np.load(args.output/'hull-mesh.npz')
    vertices, faces = hull['vertices'], hull['faces']
    dims = json.loads(args.geometry.read_text())['catalogueDimensionsXYZmm']
    pinned = vertices[:, 2] <= 1e-6

    smoothed = taubin_smooth(vertices, faces, iterations=args.iterations, lam=args.lam, mu=args.mu, pinned=pinned)
    calibrated = calibrate_bbox(smoothed, dims)
    np.savez_compressed(args.output/'smoothed-mesh.npz', vertices=calibrated, faces=faces)
    report = dict(iterations=args.iterations, lam=args.lam, mu=args.mu, pinnedBaseVertices=int(pinned.sum()),
                  vertices=int(len(calibrated)), triangles=int(len(faces)),
                  maxDisplacementMm=float(np.abs(calibrated-calibrate_bbox(vertices, dims)).max()))
    (args.output/'smoothing.json').write_text(json.dumps(report, indent=2)+'\n')
    print('SMOOTHED', json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
