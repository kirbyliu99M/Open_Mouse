"""Four-view photo / old / new / M650 comparison; identical model framing."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
HERE=Path(__file__).resolve().parent;OUT=HERE/'out/study-fidelity/b3'


def main():
    photos={r['view']:r for r in json.loads((OUT/'camera-evidence.json').read_text())['views']}
    sheet=Image.new('RGB',(2040,1900),'#eef0f3');draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',22);small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
    for col,title in enumerate(['M550 reference photos','Old M550 study','New M550 photo bake','M650 AR shell']):
        draw.text((col*510+22,18),title,font=font,fill='#172332')
    for row,view in enumerate(['top','side','front','hero']):
        y=60+row*440;draw.text((20,y),view.upper(),font=small,fill='#304050')
        for col,name in enumerate(['reference','old','new','sibling']):
            if col==0:
                if view=='front':
                    draw.text((35,y+200),'No straight-on front photo available',font=small,fill='#586372');continue
                key={'top':'top','side':'left','hero':'rear'}[view]
                im=Image.open(HERE/'out/reference-library/logitech-m550'/photos[key]['file']).convert('RGBA')
                im=im.crop(im.getchannel('A').getbbox());im.thumbnail((460,380))
            else:
                im=Image.open(OUT/f'{name}-{view}.png').convert('RGBA');im=im.resize((400,400),Image.Resampling.LANCZOS)
            x=col*510+25+(460-im.width)//2;yy=y+35+(400-im.height)//2;sheet.paste(im,(x,yy),im)
    draw.text((22,1840),'Model cameras and lighting identical. Photos retain studio lighting. Rear hero photo held out from all texturing.',font=small,fill='#304050')
    draw.text((22,1867),'M550 geometry unchanged; inferred right flank uses mirrored left. Wheel and seams remain texture relief on a limited-view loft.',font=small,fill='#304050')
    sheet.save(OUT/'logitech-m550.png')


if __name__=='__main__':main()
