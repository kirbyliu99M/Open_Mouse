"""Local, source-linked reference inventory and review contact sheets."""
import html
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
HERE=Path(__file__).resolve().parent
ROOT=HERE/'out/reference-library'


def make_report():
    records=[json.loads(p.read_text()) for p in sorted(ROOT.glob('*/sources.json'))]
    parts=['<!doctype html><meta charset="utf-8"><title>Mouse reference library</title><style>body{font:16px system-ui;background:#13191d;color:#e6ecee;margin:32px}a{color:#82d7ec}img{width:200px;height:170px;object-fit:contain;background:#e7ebed}section{margin:40px 0;border-top:1px solid #43515a}figure{display:inline-block;width:210px;margin:8px;vertical-align:top}figcaption{font-size:12px;overflow-wrap:anywhere}h1{font-size:32px}</style><h1>Open_Mouse — source reference library</h1><p>Original manufacturer gallery media. Rotation captures are labelled AR renders, not photographs. Colour variants are not additional viewing angles.</p>']
    for record in records:
        parts.append(f'<section id="{record["slug"]}"><h2>{html.escape(record["model"])}</h2><p><a href="{record["sourceUrl"]}">Manufacturer page</a> · {len(record["images"])} gallery images · '+('working AR reference' if record['arModels'] else 'gallery only; incomplete angular coverage')+'</p>')
        views=ROOT/record['slug']/'views/cameras.json'
        if views.exists():
            parts.append('<h3>Calibrated AR rotation captures</h3>')
            for view in json.loads(views.read_text())['views']:
                parts.append(f'<figure><a href="{record["slug"]}/views/{view["image"]}"><img loading="lazy" src="{record["slug"]}/views/{view["image"]}"></a><figcaption>{view["name"]} — AR render</figcaption></figure>')
        parts.append('<h3>Downloaded gallery</h3>')
        for image in record['images']:
            parts.append(f'<figure><a href="{image["file"]}"><img loading="lazy" src="{image["file"]}"></a><figcaption>{html.escape(Path(image["file"]).name)}<br>{image["width"]} × {image["height"]} · <a href="{image["url"]}">source</a></figcaption></figure>')
        if record.get('supplementalPhotos'):
            parts.append('<h3>Supplemental first-hand photographs — perspective/revision not calibrated</h3>')
            for photo in record['supplementalPhotos']:
                parts.append(f'<figure><a href="{photo["file"]}"><img loading="lazy" src="{photo["file"]}"></a><figcaption>{html.escape(photo["credit"])} · <a href="{photo["sourcePage"]}">original review</a></figcaption></figure>')
        parts.append('</section>')
        if not record['arModels']:
            # Keep at most the first 12, distinct file hashes for visual triage.
            selected=[]
            seen=set()
            for entry in record['images']:
                if entry['sha256'] not in seen:
                    selected.append(entry)
                    seen.add(entry['sha256'])
                if len(selected)==12:
                    break
            canvas=Image.new('RGB',(1200,70+((len(selected)+3)//4)*265),'#e6eaec')
            draw=ImageDraw.Draw(canvas)
            draw.text((20,20),record['model'],fill='black')
            for i,entry in enumerate(selected):
                image=Image.open(ROOT/entry['file']).convert('RGBA')
                image.thumbnail((280,225))
                x,y=(i%4)*300+10,(i//4)*265+70
                canvas.paste(image,(x+(280-image.width)//2,y),image)
                draw.text((x,y+228),str(i)+' '+Path(entry['file']).name[-40:],fill='black')
            canvas.save(ROOT/(record['slug']+'-gallery.jpg'))
    (ROOT/'index.html').write_text(''.join(parts),encoding='utf-8')
    (ROOT/'index.json').write_text(json.dumps(records,indent=2)+'\n')
    inventory=[{'model':r['model'],'slug':r['slug'],'sourceUrl':r['sourceUrl'],'galleryImages':len(r['images']),
        'uniqueFiles':len(set(i['sha256'] for i in r['images'])),'arSource':r['arModels'][0]['url'] if r['arModels'] else None,
        'viewHints':r['viewHints'],'rotationViews':26 if (ROOT/r['slug']/'views/cameras.json').exists() else 0,
        'status':'AR rotation available' if r['arModels'] else 'gallery only; angular gaps remain'} for r in records]
    (HERE/'reference-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
    print('Inventory:',len(records),'models',sum(len(r['images']) for r in records),'gallery images',sum(bool(r['arModels']) for r in records),'AR references')


if __name__=='__main__':
    make_report()
