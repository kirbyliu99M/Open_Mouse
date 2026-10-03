"""External-Python analysis of the cheap cover/body hypothesis; no bake or install."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'out/python-deps'))
import numpy as np
from PIL import Image, ImageDraw
from skimage.color import rgb2lab, deltaE_ciede2000
from measure_phase_c_colour import PATCHES

OUT = HERE / 'out/study-fidelity/c/button-layers'


def main():
    layers = json.loads((OUT / 'layers.json').read_text())
    rows = []
    sheet = Image.new('RGB', (900, 660), '#eeeeee')
    draw = ImageDraw.Draw(sheet)
    for row, rec in enumerate(layers['regions']):
        view, box = PATCHES[rec['region']]
        images = {}
        for col, name in enumerate(('reference', 'opaque', 'body')):
            crop = Image.open(OUT / f'{name}-{view}.png').convert('RGB').crop(box)
            images[name] = np.asarray(crop, dtype=float) / 255
            crop.thumbnail((270, 175))
            sheet.paste(crop, (col * 300 + 15, row * 220 + 35))
            draw.text((col * 300 + 15, row * 220 + 10), f'{rec["region"]} / {name}', fill='black')
        means = {k: image.mean(axis=(0, 1)) for k, image in images.items()}
        # Mixing radiance requires linear light. Decode each studio image before
        # taking its region mean, then apply the measured constant patch alpha.
        linear = {k: np.where(v <= .04045, v / 12.92, ((v + .055) / 1.055) ** 2.4)
                  .mean(axis=(0, 1)) for k, v in images.items()}
        alpha = rec['meanAlpha']
        prediction = alpha * linear['opaque'] + (1 - alpha) * linear['body']
        prediction = np.where(prediction <= .0031308, prediction * 12.92,
                              1.055 * prediction ** (1 / 2.4) - .055)
        delta = float(deltaE_ciede2000(rgb2lab(means['reference'][None, :]),
                                      rgb2lab(prediction[None, :]))[0])
        rows.append(dict(region=rec['region'], alpha=alpha,
                         meanSRGB255={k: (v * 255).tolist() for k, v in means.items()},
                         meanLinearRGB={k: v.tolist() for k, v in linear.items()},
                         predictionSRGB255=(prediction * 255).tolist(), deltaE2000=delta))
    report = dict(method='Linear-light alpha * mean opaque source radiance + '
                        '(1-alpha) * mean body radiance; encoded prediction compared with '
                        'mean encoded AR patch using the existing D65 CIEDE2000 convention',
                  target=3, regions=rows, passed=all(r['deltaE2000'] <= 3 for r in rows))
    (OUT / 'prediction.json').write_text(json.dumps(report, indent=2) + '\n')
    sheet.save(OUT / 'layer-crops.png')
    print(json.dumps(report, indent=2))
    if not report['passed']:
        raise SystemExit('PART_2B_LAYER_HYPOTHESIS_FAILED: prediction must be <= 3')


if __name__ == '__main__':
    main()
