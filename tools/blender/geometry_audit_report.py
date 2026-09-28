"""Phase D0 report: silhouette IoU of each shell against its AR source, plus distances.

External Python (OpenCV via out/python-deps or the PIL fallback). Reads
out/geometry-audit/*.npz and distances.json from geometry_audit.py, then writes
out/geometry-audit/audit.json, silhouette overlays and tools/blender/GEOMETRY-AUDIT.md.
"""
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'out/python-deps'))
from PIL import Image
from geometry_audit_math import VIEWS, inside_box, to_pixels
from photo_camera_math import raster_silhouette, silhouette_iou

OUT = HERE / 'out/geometry-audit'
SIZE = 1024
BOX_MARGIN_MM = 1.0


def views(data):
    shell_v, shell_f = data['shell_v'], data['shell_f']
    source_f = inside_box(data['source_v'], data['source_f'], data['dims'], BOX_MARGIN_MM / 1000)
    source_v = data['source_v']
    both = np.vstack([shell_v, source_v[np.unique(source_f)]])
    lo = both.min(0); span = float((both.max(0) - lo).max()) * 1.02
    lo = lo - span * .01
    result, overlays = {}, []
    for name, h, v in VIEWS:
        a = raster_silhouette(to_pixels(shell_v, lo, span, SIZE, h, v), shell_f, (SIZE, SIZE))
        b = raster_silhouette(to_pixels(source_v, lo, span, SIZE, h, v), source_f, (SIZE, SIZE))
        mm_per_px = span * 1000 / (SIZE - 1)
        result[name] = dict(iou=silhouette_iou(a, b), shellOnlyMm2=float((a & ~b).sum() * mm_per_px ** 2),
                            sourceOnlyMm2=float((b & ~a).sum() * mm_per_px ** 2))
        overlay = np.zeros((SIZE, SIZE, 3), np.uint8)
        overlay[b] = (225, 70, 70); overlay[a] = (40, 170, 240); overlay[a & b] = (190, 195, 195)
        overlays.append(Image.fromarray(overlay).resize((360, 360)))
    return result, overlays


def deviation_map(data, size=360):
    """Top / side / front scatter of shell samples: blue = shell > 2 mm outside the source
    (sealed recess or opening), red = > 2 mm inside (missing bump), grey = within 2 mm."""
    points, signed = data['points'], data['signed_mm']
    lo = points.min(0); span = float((points.max(0) - lo).max()) * 1.05; lo = lo - span * .025
    sheet = Image.new('RGB', (size * 3, size), 'white')
    from PIL import ImageDraw
    draw = ImageDraw.Draw(sheet)
    order = np.argsort(np.abs(signed))
    for i, (name, h, v) in enumerate(VIEWS):
        xy = to_pixels(points[order], lo, span, size, h, v)
        for (x, y), d in zip(xy, signed[order]):
            colour = (40, 110, 230) if d > 2 else (220, 50, 50) if d < -2 else (200, 200, 200)
            draw.point((x + i * size, y), fill=colour)
        draw.text((i * size + 6, 4), name, fill='black')
    return sheet


def main():
    rows = json.loads((OUT / 'distances.json').read_text())
    for row in rows:
        data = np.load(OUT / (row['slug'] + '.npz'))
        row['silhouette'], overlays = views(data)
        sheet = Image.new('RGB', (360 * 3, 360), 'black')
        for i, image in enumerate(overlays):
            sheet.paste(image, (i * 360, 0))
        sheet.save(OUT / (row['slug'] + '-silhouettes.png'))
        deviation_map(data).save(OUT / (row['slug'] + '-deviation.png'))
        row['minIoU'] = min(v['iou'] for v in row['silhouette'].values())
        print(row['slug'], {k: round(v['iou'], 4) for k, v in row['silhouette'].items()},
              {k: round(row['distanceMm'][k], 2) for k in ('mean', 'p95', 'max')}, flush=True)
    rows.sort(key=lambda r: (r['minIoU'], -r['distanceMm']['p95']))
    (OUT / 'audit.json').write_text(json.dumps(rows, indent=2) + '\n')
    lines = ['| Rank | Shell | IoU top | IoU side | IoU front | Distance mean / p95 / max (mm) | > 2 mm | of which shell outside / inside | Cable trimmed |',
             '| ---: | --- | ---: | ---: | ---: | --- | ---: | --- | --- |']
    for i, r in enumerate(rows, 1):
        s, d = r['silhouette'], r['distanceMm']
        lines.append(f"| {i} | {r['slug'].removeprefix('logitech-')} | {s['top']['iou']:.4f} | {s['side']['iou']:.4f} | "
                     f"{s['front']['iou']:.4f} | {d['mean']:.2f} / {d['p95']:.2f} / {d['max']:.2f} | "
                     f"{d['shareOver2mm'] * 100:.1f}% | {r['over2mmOutsideShare'] * 100:.1f}% / {r['over2mmInsideShare'] * 100:.1f}% | {'yes' if r['cableTrim'] else ''} |")
    (OUT / 'table.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
