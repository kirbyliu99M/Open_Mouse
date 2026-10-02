"""Create top, side and underside review sheets with a consistent frame."""
import html,json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent
ROOT=HERE/'out/polished'
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
records=[json.loads(p.read_text()) for p in sorted(ROOT.glob('*/reconstruction.json'))]
parts=['<!doctype html><meta charset="utf-8"><title>Polished mouse catalogue</title><style>body{font:16px system-ui;background:#18212b;color:#e8eef5;max-width:1300px;margin:40px auto;padding:0 20px}a{color:#91d5ff}.grid{display:grid;grid-template-columns:repeat(3,1fr)}img{width:100%}article{border-top:1px solid #52606d;padding:24px 0}small{color:#bbc8d4}</style><h1>Polished mouse catalogue</h1><p>Base on the ground. Buttons up. Every nose points +Y in Blender (−Z in glTF). The Lift and MX Vertical retain their natural ergonomic button tilt.</p><p>26 models use 2048 px baked colour, roughness, metallic and normal maps on the reconstructed meshes. Four limited-view studies use approximate top-photo projections.</p><p><a href="catalogue-review.blend">Blender catalogue</a> · <a href="top-overview.jpg">All top views</a> · <a href="side-overview.jpg">All side views</a> · <a href="bottom-overview.jpg">All undersides</a></p>']
for r in records:
    slug=r['slug'];source=json.loads((HERE/'out/reference-library'/slug/'sources.json').read_text())
    parts.append(f'<article><h2>{html.escape(source["model"])}</h2><p>{html.escape(r["textureRefinement"]["method"])}</p><p><a href="{slug}/{slug}.blend">Blender model</a> · <a href="{slug}/{slug}.glb">GLB</a> · <a href="{slug}/reconstruction.json">Evidence</a> · <a href="{html.escape(source["sourceUrl"])}">Manufacturer</a></p><div class="grid">')
    for view in ['top','hero','side']:parts.append(f'<div><img loading="lazy" src="{slug}/renders/{view}.png"><small>{view}</small></div>')
    parts.append('</div></article>')
(ROOT/'index.html').write_text(''.join(parts),encoding='utf-8')
for view in ['top','side','bottom','hero']:
    sheet=Image.new('RGB',(1800,1600),'#26313b');draw=ImageDraw.Draw(sheet)
    for i,r in enumerate(records):
        x=(i%6)*300;y=(i//6)*320
        im=Image.open(ROOT/r['slug']/'renders'/(view+'.png')).convert('RGBA');im.thumbnail((290,280))
        sheet.paste(im,(x,y),im);draw.text((x+6,y+282),r['slug'].replace('logitech-',''),font=font,fill='white')
    sheet.save(ROOT/(view+'-overview.jpg'))
print('Polished review:',len(records))
