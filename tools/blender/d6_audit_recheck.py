"""D6b: re-check the D0 audit's "inside > 2 mm" samples for gap bridging.

Reads D0-format audit arrays (`<slug>.npz` from geometry_audit.py: shell_v, shell_f, points,
signed_mm, source_v, source_f, all in metres except signed_mm) and writes
out/d6/audit-recheck.json plus a split map per shell. Does not change the D0 audit or any shell.

    python d6_audit_recheck.py --audit-dir <folder of D0 npz files> [--slugs a b ...]
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from gap_bridge_math import classify_inside_samples, triangle_normals

HERE = Path(__file__).resolve().parent
OUT = HERE/'out/d6'
INSIDE_MM = -2.


def owning_triangles(triangles, points, per_triangle=16, seed=0):
    """Index of the shell triangle each sample lies on (nearest of dense per-triangle samples)."""
    rng = np.random.default_rng(seed)
    u = rng.random((len(triangles), per_triangle, 2))
    flip = u.sum(2) > 1
    u[flip] = 1-u[flip]
    t = triangles
    dense = t[:, None, 0]+u[..., :1]*(t[:, None, 1]-t[:, None, 0])+u[..., 1:]*(t[:, None, 2]-t[:, None, 0])
    _, index = cKDTree(dense.reshape(-1, 3)).query(points)
    return index//per_triangle


def recheck(path):
    d = np.load(path)
    points = d['points']*1000
    signed = d['signed_mm']
    shell = d['shell_v'][d['shell_f']]*1000
    source = d['source_v'][d['source_f']]*1000
    inside = np.flatnonzero(signed < INSIDE_MM)
    normals = triangle_normals(shell)[owning_triangles(shell, points[inside])]
    labels = classify_inside_samples(points[inside], normals, signed[inside], source)
    real = inside[[label == 'missing-material' for label in labels]]
    n = len(points)
    return dict(samples=n, auditInside=int(len(inside)), auditInsideShare=len(inside)/n,
                missingMaterial=int(len(real)), missingMaterialShare=len(real)/n,
                bridgesGap=int(len(inside)-len(real)),
                bridgesGapFraction=(len(inside)-len(real))/max(len(inside), 1)), points, inside, real


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-dir', type=Path, required=True)
    parser.add_argument('--slugs', nargs='*')
    args = parser.parse_args()
    files = sorted(args.audit_dir.glob('*.npz'))
    if args.slugs:
        files = [f for f in files if f.stem in args.slugs]
    OUT.mkdir(parents=True, exist_ok=True)
    results = {}
    for f in files:
        summary, points, inside, real = recheck(f)
        results[f.stem] = summary
        print(f.stem, json.dumps(summary), flush=True)
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
        except ImportError:
            continue
        fig, axes = plt.subplots(1, 3, figsize=(15, 5))
        gap = np.setdiff1d(inside, real)
        for ax, (i, j, name) in zip(axes, ((0, 1, 'top'), (1, 2, 'side'), (0, 2, 'front'))):
            ax.scatter(points[:, i], points[:, j], s=.2, c='#cccccc')
            ax.scatter(points[gap, i], points[gap, j], s=4, c='#f39c12', label='shell bridges a gap')
            ax.scatter(points[real, i], points[real, j], s=8, c='#c0392b', label='missing material')
            ax.set_aspect('equal')
            ax.set_title(f'{f.stem} {name}', fontsize=9)
        axes[0].legend(fontsize=8, loc='lower left')
        fig.savefig(OUT/f'{f.stem}-inside-recheck.png', dpi=70, bbox_inches='tight')
        plt.close(fig)
    (OUT/'audit-recheck.json').write_text(json.dumps(results, indent=2)+'\n')


if __name__ == '__main__':
    main()
