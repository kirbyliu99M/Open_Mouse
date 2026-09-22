"""Measure and show same-camera reference/reconstruction silhouette agreement."""
import json
from pathlib import Path
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw, ImageFont
HERE=Path(__file__).resolve().parent
ROOT=HERE/'out/reference-library'
OUT=HERE/'out/reconstructed'


def mask(path,max_size=None):
    image=Image.open(path).convert('RGBA')
    if max_size:image.thumbnail((max_size,max_size))
    pixels=np.array(image)
    return ndimage.binary_fill_holes(pixels[:,:,3]>127)


def silhouette_metrics(a,b,pixel_mm):
    union=np.count_nonzero(a|b)
    iou=np.count_nonzero(a&b)/union if union else 1.
    ea=a ^ ndimage.binary_erosion(a)
    eb=b ^ ndimage.binary_erosion(b)
    distances=np.concatenate([ndimage.distance_transform_edt(~ea)[eb],ndimage.distance_transform_edt(~eb)[ea]])*pixel_mm
    return {'silhouetteIoU':float(iou),'boundaryP95mm':float(np.percentile(distances,95)), 'boundaryMaxMm':float(distances.max())}


def crop_mask(a):
    y,x=np.where(a)
    return a[y.min():y.max()+1,x.min():x.max()+1]


def remove_thin_lead(a):
    """Remove a clearly narrow cable extending beyond a top-view body."""
    a=crop_mask(a).copy()
    spans=np.array([np.ptp(np.flatnonzero(row))+1 if row.any() else 0 for row in a])
    broad=np.flatnonzero(spans>.3*spans.max())
    if broad[0]>.04*len(a) and np.percentile(spans[:max(1,broad[0]-2)],65)<.25*spans.max():
        a[:max(0,broad[0]-1)]=False
    if len(a)-1-broad[-1]>.04*len(a) and np.percentile(spans[min(len(a)-1,broad[-1]+2):],65)<.25*spans.max():
        a[min(len(a),broad[-1]+2):]=False
    return crop_mask(a)


def gallery_check(record,folder):
    candidates=[i for i in record['images'] if 'top-angle' in i['file'] and 'lifestyle' not in i['file']]
    if record['slug'] in ['logitech-m650','logitech-m550']:
        candidates=[i for i in candidates if 'medium' in i['file']]
    if not candidates:
        return {'status':'No unambiguous top-angle gallery image selected'}
    image=candidates[0]
    a=mask(ROOT/image['file'],1200)
    labels,count=ndimage.label(a);sizes=np.bincount(labels.ravel());sizes[0]=0
    a=remove_thin_lead(labels==sizes.argmax())
    b=remove_thin_lead(mask(folder/'renders/top.png'))
    comparisons=[]
    for turns in range(4):
        rotated=np.rot90(b,turns)
        ratio_error=abs((a.shape[1]/a.shape[0])/(rotated.shape[1]/rotated.shape[0])-1)
        resized=np.array(Image.fromarray(rotated).resize((a.shape[1],a.shape[0]),Image.Resampling.NEAREST))
        iou=np.count_nonzero(a&resized)/np.count_nonzero(a|resized)
        comparisons.append((iou,turns,ratio_error))
    iou,turns,ratio_error=max(comparisons)
    return {'status':'Independent gallery top outline, narrow cable removed and bbox-normalized; perspective not calibrated',
        'image':image['file'],'sourceUrl':image['url'],'silhouetteIoU':iou,'rotationDegrees':turns*90,'aspectRatioError':ratio_error}


def run():
    reports=[]
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20)
    small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
    for folder in sorted(OUT.glob('*')):
        metadata=folder/'reconstruction.json'
        if not metadata.exists():continue
        report=json.loads(metadata.read_text())
        if 'mesh' not in report or not (folder/'renders/top.png').exists():continue
        record=json.loads((ROOT/folder.name/'sources.json').read_text())
        if report.get('referenceMode')=='gallery-only':
            reports.append({'slug':folder.name,'mode':'gallery-only','status':report['status'],'mesh':report['mesh']})
            continue
        cameras=json.loads((HERE/report['cameraFile']).read_text())
        metrics=[]
        for camera in cameras['views']:
            a=mask(ROOT/folder.name/'views'/camera['image'])
            b=mask(folder/'renders'/camera['image'])
            metrics.append({'view':camera['name'],**silhouette_metrics(a,b,camera['orthoScale']*1000/camera['resolution'])})
        summary={'slug':folder.name,'mode':'AR-image-reconstruction','meanSilhouetteIoU':float(np.mean([m['silhouetteIoU'] for m in metrics])),
            'worstSilhouetteIoU':min(m['silhouetteIoU'] for m in metrics),'worstBoundaryP95mm':max(m['boundaryP95mm'] for m in metrics),'views':metrics,
            'galleryTopCheck':gallery_check(record,folder),'mesh':report['mesh']}
        reports.append(summary)
        sheet=Image.new('RGB',(1200,1280),'#172027');draw=ImageDraw.Draw(sheet)
        draw.text((24,18),record['model']+' — reference / reconstruction / outline overlay',fill='#edf4f5',font=font)
        draw.text((24,50),f'Mean silhouette IoU {summary["meanSilhouetteIoU"]:.3%} across 26 calibrated views.  Green: reference. Cyan: reconstructed.',fill='#bfd0d7',font=small)
        for row,name in enumerate(['top','azimuth-000.0','elevated-225']):
            y=100+row*385
            a=mask(ROOT/folder.name/'views'/(name+'.png'));b=mask(folder/'renders'/(name+'.png'))
            for col,path in enumerate([ROOT/folder.name/'views'/(name+'.png'),folder/'renders'/(name+'.png')]):
                im=Image.open(path).convert('RGBA');im.thumbnail((375,355))
                sheet.paste(im,(col*400+(400-im.width)//2,y),im)
            overlay=np.zeros((*a.shape,4),dtype='uint8');overlay[a|b]=[90,110,120,65]
            overlay[a^ndimage.binary_erosion(a)]=[125,245,105,255]
            overlay[b^ndimage.binary_erosion(b)]=[60,215,255,255]
            im=Image.fromarray(overlay);im.thumbnail((375,355));sheet.paste(im,(800+(400-im.width)//2,y),im)
            draw.text((25,y+355),name,fill='#bfd0d7',font=small)
        sheet.save(folder/'comparison.png')
        (folder/'silhouette-validation.json').write_text(json.dumps(summary,indent=2)+'\n')
        print(folder.name,round(summary['meanSilhouetteIoU'],4),'worst',round(summary['worstSilhouetteIoU'],4),'gallery',summary['galleryTopCheck'].get('silhouetteIoU'),flush=True)
    (OUT/'comparison-summary.json').write_text(json.dumps(reports,indent=2)+'\n')
    for start in range(0,len(reports),10):
        page=reports[start:start+10]
        sheet=Image.new('RGB',(1500,70+len(page)*210),'#172027');draw=ImageDraw.Draw(sheet)
        draw.text((20,15),'OPEN_MOUSE  |  source-based reconstruction review',fill='white',font=font)
        for row,report in enumerate(page):
            slug=report['slug'];y=70+row*210
            draw.text((20,y+12),slug.replace('logitech-',''),fill='white',font=font)
            draw.text((20,y+44),'26-view depth reconstruction' if report['mode']!='gallery-only' else 'TWO-VIEW STUDY — incomplete',fill='#a5bbc7',font=small)
            images=[ROOT/slug/'views/elevated-225.png',OUT/slug/'renders/elevated-225.png',OUT/slug/'renders/top.png']
            for col,path in enumerate(images):
                if not path.exists():continue
                im=Image.open(path).convert('RGBA');im.thumbnail((290,200));sheet.paste(im,(520+col*310+(290-im.width)//2,y),im)
        sheet.save(OUT/f'catalogue-review-{start//10+1}.jpg')


if __name__=='__main__':run()
