"""D1 fixed photo roles, view inventory and mask preparation; no geometry input.

All usable resolutions are retained. Duplicate photographs are labelled and
never cross the held-out split. References are read only; outputs are ignored.
"""
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from photo_camera_fit import clean_mask

HERE = Path(__file__).resolve().parent
OUT = HERE / 'out/study-fidelity/d1'


def specifications():
    result = {}
    def row(file, view, angles, role='fit', **kw):
        return dict(file=file, view=view, initialAngles=angles, role=role, **kw)
    m705 = [row('m705-gallery-1.png', 'top', [180, 90, 0]),
            row('m705-gallery-2.png', 'rear-left oblique', [-150, 50, 0], 'held-out'),
            row('m705-gallery-3.png', 'front-left oblique', [-65, 35, -10]),
            row('m705-gallery-4.png', 'left profile', [-90, 0, 0])]
    for i in range(15):
        group = i//3
        if group == 1:
            m705.append(row(f'supplemental/techwalls-{i}.jpg', 'hand-occluded left', None,
                            'excluded', reason='Hand occludes shell outline'))
            continue
        groups = {0: ('left oblique', [-100, 20, 0], [.09,.10,.92,.96]),
                  2: ('front-left oblique', [-65, 35, -10], [.12,.06,.94,.97]),
                  3: ('bottom oblique', [0,-70, -10], [.20,.04,.72,.97]),
                  4: ('rear-right oblique', [145,45,0], [.44,.41,.91,.97])}
        view, angles, rect = groups[group]
        m705.append(row(f'supplemental/techwalls-{i}.jpg', view, angles,
                        duplicateGroup=f'techwalls-{group*3}', photoROI=rect))
    result['logitech-m705-marathon'] = m705
    result['logitech-m325s'] = [
        row('top.png', 'graphite top', [180,90,0]),
        row('left.png', 'red front-left oblique', [-45,45,0]),
        row('right.png', 'patterned rear-left oblique', [-150,55,0], 'held-out'),
        row('extra-1.png', 'pale-grey front-left oblique', [-45,45,0]),
        row('extra-2.png', 'lilac front-left oblique', [-45,45,0]),
        row('extra-3.png', 'blue front-right oblique', [45,45,0]),
        row('extra-4.png', 'patterned elevated left', [-90,10,0]),
        row('extra-5.png', 'patterned front-right oblique', [45,45,0])]
    result['logitech-signature-comfort-plus-m850l'] = [
        row('top.png', 'graphite top', [180,90,0]),
        row('left.png', 'black elevated left', [-90,10,0]),
        row('extra-1.png', 'graphite rear-left elevated oblique', [-150,35,0]),
        row('extra-2.jpg', 'top with hand', None, 'excluded', reason='Hand occludes shell outline'),
        row('extra-3.png', 'graphite bottom', [0,-90,0]),
        row('extra-4.jpg', 'left with hand', None, 'excluded', reason='Hand occludes shell outline'),
        row('extra-5.png', 'graphite rear-left oblique', [-150,40,0], 'held-out'),
        row('extra-6.png', 'graphite elevated left', [-90,10,0])]
    return result


def photo_mask(path, spec):
    rgba = np.array(Image.open(path).convert('RGBA'))
    if 'photoROI' not in spec:
        return clean_mask(rgba[:,:,3] > 180), 'alpha >180; largest component; enclosed holes filled'
    rgb = rgba[:,:,:3].copy()
    h, w = rgb.shape[:2]
    x0,y0,x1,y1 = np.rint(np.array(spec['photoROI'])*[w,h,w,h]).astype(int)
    mask = np.zeros((h,w), bool)
    mask[y0:y1,x0:x1] = rgb[y0:y1,x0:x1].max(axis=2) < 160
    return clean_mask(mask), 'fixed photo ROI; max RGB <160 excludes pale desk and red watermark; largest component; enclosed holes filled'


def main():
    for slug, specs in specifications().items():
        reference = HERE / 'out/reference-library' / slug
        out = OUT / slug
        out.mkdir(parents=True, exist_ok=True)
        sources = json.loads((reference/'sources.json').read_text())
        source_rows = [r for rows in sources.values() if isinstance(rows, list) for r in rows if isinstance(r, dict)]
        actual = {p.relative_to(reference).as_posix() for p in reference.rglob('*')
                  if p.suffix.lower() in ('.png','.jpg','.jpeg')}
        assert actual == {r['file'] for r in specs}, (slug, actual)
        sheet = Image.new('RGB', (1200, 250*((len(specs)+3)//4)), '#e4e7eb')
        draw = ImageDraw.Draw(sheet)
        for i, spec in enumerate(specs):
            path = reference / spec['file']
            spec['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            spec['sourceURL'] = next((r['url'] for r in source_rows if Path(r.get('file','')).name == path.name), None)
            if spec['sourceURL'] is None:
                spec['provenanceNote'] = 'Local file present; exact URL absent from existing sources.json; no URL inferred'
            pic = Image.open(path).convert('RGBA')
            spec['imageSize'] = list(pic.size)
            if spec['role'] != 'excluded':
                mask, convention = photo_mask(path, spec)
                spec['mask'] = convention
                spec['maskFile'] = 'mask-'+path.stem+'.png'
                Image.fromarray(mask.astype('uint8')*255).save(out/spec['maskFile'])
                background = Image.new('RGBA', pic.size, '#e4e7eb')
                rgb = np.array(Image.alpha_composite(background, pic).convert('RGB'))
                edge = mask ^ cv2.erode(mask.astype('uint8'), np.ones((3,3),np.uint8)).astype(bool)
                rgb[edge] = [255,30,30]
                pic = Image.fromarray(rgb).convert('RGBA')
            pic.thumbnail((290, 195))
            x,y = (i%4)*300,(i//4)*250
            sheet.paste(pic, (x+(300-pic.width)//2,y), pic)
            draw.text((x+4,y+197), spec['file'], fill='black')
            draw.text((x+4,y+213), spec['view'], fill='black')
            draw.text((x+4,y+230), spec['role'], fill='black')
        (out/'photo-inventory.json').write_text(json.dumps(specs, indent=2)+'\n')
        sheet.save(out/'photo-mask-inventory.png')
        print(slug, len(specs), 'inventoried', sum(r['role']=='fit' for r in specs), 'fit', flush=True)


if __name__ == '__main__':
    main()
