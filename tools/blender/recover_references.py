"""Try other published colour AR entries and regional manufacturer pages."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
from scrape_references import ROOT, fetch


def recover(path):
    record=json.loads(path.read_text())
    if record['arModels']:
        return
    pages=[(record['sourceUrl'],ROOT/'pages'/(record['slug']+'.html'))]
    for locale in ['en-gb','en-eu']:
        url=record['sourceUrl'].replace('/en-us/','/'+locale+'/')
        page=ROOT/'pages'/(record['slug']+'-'+locale+'.html')
        try:
            fetch(url,page)
            pages.append((url,page))
        except Exception:
            pass
    if record['slug']=='logitech-mx-master-3s':
        url='https://www.logitech.com/en-us/products/mice/mx-master-3s-business-wireless-mouse.html'
        page=ROOT/'pages'/(record['slug']+'-business.html')
        try:
            fetch(url,page)
            pages.append((url,page))
        except Exception:
            pass
    attempted=[]
    for source,page in pages:
        paths=list(dict.fromkeys(re.findall(r'/content/dam/[^\s"<>\\,;()]+?\.glb',page.read_text(encoding='utf-8'))))
        for asset in paths:
            for host in ['resource.logitech.com','resource.logitechg.com']:
                url='https://'+host+asset
                if url in attempted:
                    continue
                attempted.append(url)
                destination=ROOT/record['slug']/Path(asset).name
                try:
                    data=fetch(url,destination)
                    if data[:4]!=b'glTF':
                        continue
                    record['arModels'].append({'url':url,'file':destination.relative_to(ROOT).as_posix(),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'discoveredOn':source})
                    path.write_text(json.dumps(record,indent=2)+'\n')
                    print('RECOVERED',record['slug'],url,flush=True)
                    return
                except Exception:
                    pass
    record['arRecovery']={'pagesChecked':[p[0] for p in pages],'assetUrlsAttempted':attempted,'result':'No working official AR asset found'}
    path.write_text(json.dumps(record,indent=2)+'\n')
    print('GALLERY_ONLY',record['slug'],flush=True)


if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(recover,ROOT.glob('*/sources.json')))
