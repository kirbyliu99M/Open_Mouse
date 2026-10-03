"""Create source-linked colour comparisons, leaving the neutral evidence intact."""
import html
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
HERE=Path(__file__).resolve().parent
ROOT=HERE/'out/colored'
LIB=HERE/'out/reference-library'
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',22)
small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',16)
records=[]
parts=['<!doctype html><meta charset="utf-8"><title>Mouse colour verification</title><style>body{font:16px system-ui;background:#192129;color:#eee;max-width:1150px;margin:40px auto;padding:0 20px}a{color:#80cfff}img{max-width:100%}article{border-top:1px solid #65717b;padding:20px 0}.grid{display:grid;grid-template-columns:1fr 1fr}</style><h1>Mouse colour verification</h1><p>Official reference colours applied to unchanged reconstructed geometry. Small markings are vertex-sampled and may blur. Four studies have approximate shell palettes only. These are visual approximations, not spectrophotometer measurements.</p><p><a href="catalogue-review.blend">Blender colour catalogue</a> · <a href="../reconstructed/index.html">Original shape evidence</a></p>']
for path in sorted(ROOT.glob('*/reconstruction.json')):
    r=json.loads(path.read_text());slug=r['slug'];s=json.loads((LIB/slug/'sources.json').read_text());records.append(r)
    reference=LIB/slug/'views/elevated-225.png'
    if not reference.exists():reference=LIB/s['images'][0]['file']
    sheet=Image.new('RGB',(1200,660),'#26313a');draw=ImageDraw.Draw(sheet)
    draw.text((22,15),s['model'],font=font,fill='white')
    for i,(file,title) in enumerate([(reference,'Official reference'),(path.parent/'renders/elevated-225.png','Coloured rebuild')]):
        im=Image.open(file).convert('RGBA')
        box=im.getbbox()
        if box:im=im.crop(box)
        im.thumbnail((560,530));sheet.paste(im,(i*600+(600-im.width)//2,80+(530-im.height)//2),im)
        draw.text((i*600+22,48),title,font=small,fill='#c9d5dc')
    sheet.save(path.parent/'colour-comparison.jpg')
    p=r['colourVerification']
    parts.append(f'<article><h2>{html.escape(s["model"])}</h2><p>{html.escape(p["method"])}</p><p><a href="{html.escape(s["sourceUrl"])}">Manufacturer page</a> · <a href="{slug}/{slug}.blend">Blender</a> · <a href="{slug}/{slug}.glb">GLB</a> · <a href="{slug}/reconstruction.json">Verification</a></p><img src="{slug}/colour-comparison.jpg" loading="lazy"></article>')
(ROOT/'index.html').write_text(''.join(parts),encoding='utf-8')
for start in range(0,len(records),10):
    page=records[start:start+10];sheet=Image.new('RGB',(1500,100+len(page)*170),'#26313a');draw=ImageDraw.Draw(sheet)
    draw.text((20,20),'OFFICIAL REFERENCE / COLOUR REBUILD',font=font,fill='white')
    for row,r in enumerate(page):
        y=80+row*170;slug=r['slug'];draw.text((20,y+20),slug.replace('logitech-',''),font=font,fill='white')
        im=Image.open(ROOT/slug/'colour-comparison.jpg');im.thumbnail((900,165));sheet.paste(im,(650,y))
    sheet.save(ROOT/f'colour-contact-{start//10+1}.jpg')
(ROOT/'colour-summary.json').write_text(json.dumps([{'slug':r['slug'],**r['colourVerification']} for r in records],indent=2)+'\n')
print('Colour review:',len(records),'models')
