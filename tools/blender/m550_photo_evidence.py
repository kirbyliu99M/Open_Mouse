"""Apply Claude's photo-role decision and measure symmetry/held-out contour gap."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from photo_camera_math import silhouette_iou
from photo_bake_math import boundary_gap

HERE = Path(__file__).resolve().parent
OUT = HERE/'out/study-fidelity/b3'


def main():
    rows = []
    for key in ['top', 'left', 'bottom', 'rear', 'front-held-out']:
        row = json.loads((OUT/f'camera-{key}.json').read_text())
        row['view'] = 'front' if key == 'front-held-out' else key
        row['appearanceRole'] = 'held-out' if key == 'rear' else 'texture'
        row['usedForTexturing'] = key != 'rear'
        rows.append(row)
    assert all(r['iou'] >= .95 for r in rows if r['usedForTexturing'])
    top = rows[0]
    array = np.array(Image.open(HERE/'out/reference-library/logitech-m550'/top['file']))
    mask = array[:, :, 3] > 180
    y, x = np.where(mask);mask = mask[y.min():y.max()+1, x.min():x.max()+1]
    symmetry = silhouette_iou(mask, mask[:, ::-1])
    rear = rows[3];overlay = np.array(Image.open(OUT/'fit-rear.png'))
    photo = (overlay[:, :, 0] == 225) | (overlay[:, :, 0] == 180)
    mesh = (overlay[:, :, 0] == 40) | (overlay[:, :, 0] == 180)
    scale = 1440/max(rear['crop'][2]-rear['crop'][0], rear['crop'][3]-rear['crop'][1])
    mm_per_pixel = rear['distanceMm']/(rear['focalPixels']*scale)
    gap = boundary_gap(photo, mesh, mm_per_pixel)
    result = dict(views=rows, topMirrorIoU=symmetry, mirrorAllowed=symmetry >= .98,
        symmetryMethod='Top alpha >180 tight-bbox horizontal reflection, no alignment or contour changes',
        heldOutGapMm=gap, heldOutMmPerPixel=mm_per_pixel,
        heldOutGapMethod='Symmetric boundary Hausdorff distance at fitted camera target plane; projected mm, not a measured 3D surface distance',
        heldOutFinding='Interpolated cross-section mismatch: photo-only red at rear hump; mesh-only blue at right flank and front lower edge',
        decision='Claude 2026-09-28: criterion 3 threshold applies to texturing photos; rear held out; left may be mirrored only if top symmetry >=0.98')
    (OUT/'camera-evidence.json').write_text(json.dumps(result, indent=2)+'\n')
    # Replace the historical stop sheet with the current adjudicated roles.
    sheet=Image.new('RGB',(1800,740),'#eeeeee');draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',16)
    draw.text((15,10),'B3 registration: four texture views; rear held out. Red = photo only; blue = mesh only; grey = intersection.',font=font,fill='black')
    for index,row in enumerate(rows):
        name=row['view'];role='TEXTURE' if row['usedForTexturing'] else 'HELD OUT'
        draw.text((index*360+12,40),f"{name}: {row['iou']:.6f} | {role}",font=font,fill='black')
        im=Image.open(HERE/'out/reference-library/logitech-m550'/row['file']).crop(row['crop'])
        im.thumbnail((345,290));sheet.paste(im,(index*360+(360-im.width)//2,70+(290-im.height)//2),im)
        key='front-held-out' if name=='front' else name
        im=Image.open(OUT/f'fit-{key}.png');im.thumbnail((345,290))
        sheet.paste(im,(index*360+(360-im.width)//2,390+(290-im.height)//2))
    draw.text((15,710),f'Top mirror IoU {symmetry:.6f}; rear maximum projected gap {gap:.6f} mm. Rear photograph is never used for appearance.',font=font,fill='black')
    sheet.save(OUT/'camera-fit-diagnostics.png')
    print(json.dumps({k:v for k,v in result.items() if k!='views'}, indent=2))


if __name__ == '__main__':main()
