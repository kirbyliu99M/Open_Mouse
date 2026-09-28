"""Fixed-patch render evidence for the Phase C MX Master 4 colour gate.

External image-analysis Python only; never imported into Blender. Rectangles
are selected on the reference, excluding seams, logos, and silhouette edges.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'out/python-deps'))
import numpy as np
from PIL import Image, ImageDraw
from skimage.color import rgb2lab, deltaE_ciede2000

OUT = HERE / 'out/study-fidelity/c/colour/logitech-mx-master-4'
PATCHES = {
    'left button': ('top', (345, 175, 405, 280)),
    'right button': ('top', (475, 190, 545, 280)),
    'palm': ('top', (380, 430, 515, 550)),
    'side': ('top', (245, 430, 295, 480)),
    'wheel': ('top', (430, 215, 453, 275)),
}


def main():
    names = ['reference', 'old', 'new']
    rows = []
    sheet = Image.new('RGB', (900, 220 * len(PATCHES)), '#eeeeee')
    draw = ImageDraw.Draw(sheet)
    annotation = Image.open(OUT / 'reference-top.png').convert('RGB')
    mark = ImageDraw.Draw(annotation)
    for row, (region, (view, box)) in enumerate(PATCHES.items()):
        means = {}
        for col, name in enumerate(names):
            crop = Image.open(OUT / f'{name}-{view}.png').crop(box).convert('RGB')
            means[name] = np.asarray(crop, dtype=float).mean(axis=(0, 1)) / 255
            crop.thumbnail((270, 175))
            sheet.paste(crop, (col * 300 + 15, row * 220 + 35))
            draw.text((col * 300 + 15, row * 220 + 10), f'{region} / {name}', fill='black')
        lab = {name: rgb2lab(value[None, :]) for name, value in means.items()}
        before = float(deltaE_ciede2000(lab['reference'], lab['old'])[0])
        after = float(deltaE_ciede2000(lab['reference'], lab['new'])[0])
        rows.append(dict(region=region, view=view, box=box,
                         meanSRGB255={k: (v * 255).tolist() for k, v in means.items()},
                         beforeDeltaE2000=before, afterDeltaE2000=after))
        mark.rectangle(box, outline='red', width=2)
        mark.text((box[0], box[1] - 12), region, fill='red')
    report = dict(method='CIEDE2000 of mean encoded sRGB patch, D65; identical Cycles studio',
                  target=3, regions=rows,
                  passed=all(r['afterDeltaE2000'] <= 3 for r in rows[:3]))
    (OUT / 'colour-evidence.json').write_text(json.dumps(report, indent=2) + '\n')
    sheet.save(OUT / 'colour-crops.png')
    annotation.save(OUT / 'patches.png')
    comparison = Image.new('RGB', (1200, 1250), '#eeeeee')
    titles = ImageDraw.Draw(comparison)
    for col, name in enumerate(names):
        titles.text((col * 400 + 15, 10), name, fill='black')
        for row, view in enumerate(('top', 'side', 'hero')):
            frame = Image.open(OUT / f'{name}-{view}.png').convert('RGB')
            comparison.paste(frame.resize((400, 400)), (col * 400, row * 400 + 35))
    comparison.save(OUT / 'comparison.png')
    print(json.dumps(report, indent=2))
    if not report['passed']:
        raise SystemExit('PART_2B_COLOUR_GATE_FAILED: buttons and palm must be <= 3')


if __name__ == '__main__':
    main()
