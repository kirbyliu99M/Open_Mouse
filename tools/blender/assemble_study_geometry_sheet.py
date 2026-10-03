"""Photo | committed | candidate top/side/front/hero comparison; no new textures."""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw

HERE=Path(__file__).resolve().parent
PHOTOS={
    'logitech-m705-marathon': ('m705-gallery-1.png','m705-gallery-4.png','m705-gallery-3.png','m705-gallery-2.png'),
    'logitech-m325s': ('top.png','extra-4.png','left.png','right.png'),
    'logitech-signature-comfort-plus-m850l': ('top.png','extra-6.png','extra-1.png','extra-5.png'),
}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True)
    args=parser.parse_args()
    out=args.directory
    sheet=Image.new('RGB',(1500,2180),'#e4e7eb')
    draw=ImageDraw.Draw(sheet)
    for x,label in [(10,'Product photo (oblique if no matching axis)'),(510,'Committed baseline'),(1010,'Geometry candidate — NOT a delivery decision')]:
        draw.text((x,12),label,fill='black')
    for i,(view,file) in enumerate(zip(('top','side','front','hero'),PHOTOS[out.name])):
        paths=[HERE/'out/reference-library'/out.name/file,
               out/f'baseline-{view}.png',out/f'candidate-{view}.png']
        for j,path in enumerate(paths):
            pic=Image.open(path).convert('RGBA')
            bbox=pic.getbbox()
            if bbox:
                pic=pic.crop(bbox)
            pic.thumbnail((480,480))
            sheet.paste(pic,(j*500+(500-pic.width)//2,40+i*535+(490-pic.height)//2),pic)
        draw.text((10,40+i*535+495),f'{view} | reference: {file}',fill='black')
    sheet.save(out/'geometry-contact-sheet.png')
    print(out/'geometry-contact-sheet.png')


if __name__=='__main__':
    main()
