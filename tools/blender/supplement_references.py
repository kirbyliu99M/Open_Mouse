"""Archive first-hand review photographs for remaining gallery-only models.

Supplemental photos are for visual checking; historical revisions and perspective
are explicitly not calibrated and never silently replace manufacturer geometry.
"""
import hashlib
import html
import json
from pathlib import Path
import re
from urllib.parse import urlparse
from PIL import Image
from scrape_references import ROOT,fetch
SOURCES=[
 ('logitech-m100','iFixit / Ashley','https://www.ifixit.com/Teardown/Logitech+M100+Mouse+Teardown/106991','ifixit'),
 ('logitech-m705-marathon','TechWalls / Tuan Do','https://www.techwalls.com/logitech-wireless-marathon-mouse-m705-review/','techwalls'),
 ('logitech-m550','Reiwa ni Ikiru','https://reiwa-ni-ikiru.com/m550-review/','reiwa'),
]


for slug,author,url,kind in SOURCES:
    page_path=ROOT/'pages'/(slug+'-'+kind+'.html')
    try:
        page=html.unescape(fetch(url,page_path).decode('utf-8'))
        if kind=='ifixit':
            urls=list(dict.fromkeys(re.findall(r'https://guide-images\.cdn\.ifixit\.com/igi/[^\s"<>\\]+?\.(?:huge|large)',page)))[:6]
        elif kind=='techwalls':
            urls=list(dict.fromkeys(re.findall(r'https://[^\s"<>\\]+?Logitech-Marathon-Mouse-M705[^\s"<>\\]*?\.(?:jpg|png)',page,re.I)))
        else:
            start=page.find('<article');end=page.find('</article>',start)
            article=page[start:end] if start>=0 and end>start else page
            urls=list(dict.fromkeys(re.findall(r'https://reiwa-ni-ikiru\.com/wp-content/uploads/[^\s"<>\\]+?\.(?:jpg|png|webp)',article)))[:20]
        entries=[]
        seen=set()
        for index,image_url in enumerate(urls):
            destination=ROOT/slug/'supplemental'/(kind+'-'+str(index)+'.jpg')
            try:
                data=fetch(image_url,destination)
                digest=hashlib.sha256(data).hexdigest()
                if digest in seen:continue
                seen.add(digest)
                with Image.open(destination) as image:
                    width,height=image.size
                if width<400 or height<250:continue
                entries.append({'url':image_url,'sourcePage':url,'credit':author,'file':destination.relative_to(ROOT).as_posix(),'width':width,'height':height,'sha256':digest,
                    'status':'Supplemental first-hand photograph; perspective and hardware revision not calibrated'})
            except Exception as error:
                print('PHOTO_FAILED',image_url,str(error),flush=True)
        record_path=ROOT/slug/'sources.json';record=json.loads(record_path.read_text())
        record['supplementalPhotos']=entries
        record_path.write_text(json.dumps(record,indent=2)+'\n')
        print('SUPPLEMENTED',slug,len(entries),flush=True)
    except Exception as error:
        print('SOURCE_FAILED',slug,str(error),flush=True)
