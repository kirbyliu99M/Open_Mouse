"""Assemble the four-view B2 review sheet, preserving reference photo lighting."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent;OUT=HERE/'out/study-fidelity/b2';SE='logitech-g-pro-x-superlight-2-se'

def main():
    width=500;height=390;sheet=Image.new('RGB',(2040,1680),'#eef0f3');draw=ImageDraw.Draw(sheet)
    try:font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',22);small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
    except OSError:font=small=ImageFont.load_default()
    columns=['SE reference photos','Old SE study','New SE / sibling geometry','Superlight 2']
    for col,title in enumerate(columns):draw.text((col*width+22,18),title,font=font,fill='#172332')
    photos={'top':'top-angle-gallery-1','side':'profile-left-angle-gallery-4','hero':'3qtr-high-back-angle-gallery-3'}
    for row,view in enumerate(['top','side','front','hero']):
        y=60+row*height
        draw.text((20,y),view.upper(),font=small,fill='#304050')
        for col,name in enumerate(['reference','old','new','sibling']):
            if col==0 and view=='front':
                draw.text((35,y+150),'No straight-on front photo available',font=small,fill='#586372');continue
            path=HERE/'out/reference-library'/SE/f'pro-x-superlight-2-se-red-{photos[view]}.png' if col==0 else OUT/f'{name}-{view}.png'
            im=Image.open(path).convert('RGBA');box=im.getchannel('A').getbbox();im=im.crop(box)
            # Identical physical framing for all rendered variants, crop only unused canvas.
            im.thumbnail((450,330));x=col*width+25+(450-im.width)//2;yy=y+35+(330-im.height)//2
            sheet.paste(im,(x,yy),im)
    draw.text((22,1636),'All model renders share lighting and cameras. Photos retain their studio lighting. Front reference unavailable.',font=small,fill='#304050')
    sheet.save(OUT/(SE+'.png'))

if __name__=='__main__':main()
