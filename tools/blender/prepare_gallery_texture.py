"""Crop each limited-view study's own top photograph for labelled appearance projection."""
import json
import argparse
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage
from reconstruct_gallery import CHOICES
HERE=Path(__file__).resolve().parent
PALETTES={'logitech-g-pro-x-superlight-2-se':(.515,.014,.024),'logitech-m100':(.033,.036,.041),'logitech-m550':(.06,.063,.067),'logitech-m705-marathon':(.065,.068,.074),
          'logitech-m750':(.07,.075,.08),'logitech-m325s':(.045,.05,.055),'logitech-mobi-fold':(.52,.48,.41),
          'logitech-signature-comfort-plus-m850l':(.06,.065,.07),'logitech-signature-comfort-m840l':(.07,.075,.08),
          'logitech-mx-ergo-s':(.055,.06,.065),'logitech-ergo-m575s':(.045,.05,.055),'logitech-g903-hero':(.025,.027,.03)}
parser=argparse.ArgumentParser();parser.add_argument('--model');args=parser.parse_args()
for slug,files in CHOICES.items():
    if args.model and slug not in args.model.split(','):continue
    path=HERE/'out/reference-library'/slug/files[0]
    image=np.array(Image.open(path).convert('RGBA'));mask=image[:,:,3]>180
    mask=ndimage.binary_opening(mask,iterations=max(mask.shape)//200)
    labels,n=ndimage.label(mask);sizes=np.bincount(labels.ravel());sizes[0]=0;mask=labels==sizes.argmax()
    yy,xx=np.where(mask)
    if slug=='logitech-m100':
        spans=np.array([np.ptp(np.flatnonzero(row))+1 if row.any() else 0 for row in mask])
        broad=np.flatnonzero(spans>.3*spans.max());mask[:broad[0]]=False;mask[broad[-1]+1:]=False
        yy,xx=np.where(mask)
    crop=image[yy.min():yy.max()+1,xx.min():xx.max()+1,:3]
    alpha=mask[yy.min():yy.max()+1,xx.min():xx.max()+1]
    # Extend boundary pixels; transparent source borders must not turn into white seams.
    indices=ndimage.distance_transform_edt(~alpha,return_distances=False,return_indices=True)
    crop[~alpha]=crop[tuple(indices[:,~alpha])]
    distance=ndimage.distance_transform_edt(np.pad(alpha,1))[1:-1,1:-1]
    weight=np.clip(distance/(crop.shape[1]*.28),0,1)
    weight=weight*weight*(3-2*weight)
    rgb=crop.astype(float)/255
    linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    linear=linear*weight[:,:,None]+np.array(PALETTES[slug])*(1-weight[:,:,None])
    rgb=np.where(linear<=.0031308,linear*12.92,1.055*linear**(1/2.4)-.055)
    crop=np.uint8(np.clip(rgb*255,0,255))
    folder=HERE/'out/polished'/slug/'textures';folder.mkdir(parents=True,exist_ok=True)
    Image.fromarray(crop).save(folder/'GalleryTop.png')
    (folder/'gallery-projection.json').write_text(json.dumps({'source':str(path.relative_to(HERE)),'cropPixels':[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)],'warning':'Photographic top projection; lighting remains in image, unseen sides inferred'},indent=2))
    if slug in {'logitech-mx-ergo-s','logitech-ergo-m575s','logitech-g903-hero'}:
        side=np.array(Image.open(HERE/'out/reference-library'/slug/files[1]).convert('RGBA'))
        alpha=side[:,:,3]>180
        labels,n=ndimage.label(alpha);sizes=np.bincount(labels.ravel());sizes[0]=0;alpha=labels==sizes.argmax()
        sy,sx=np.where(alpha)
        cropped=side[sy.min():sy.max()+1,sx.min():sx.max()+1,:3].copy()
        mask=alpha[sy.min():sy.max()+1,sx.min():sx.max()+1]
        indices=ndimage.distance_transform_edt(~mask,return_distances=False,return_indices=True)
        cropped[~mask]=cropped[tuple(indices[:,~mask])]
        Image.fromarray(cropped).save(folder/'GalleryLeft.png')
        if slug=='logitech-g903-hero':
            side=np.array(Image.open(HERE/'out/reference-library'/slug/'right.png').convert('RGBA'))
            alpha=side[:,:,3]>180
            labels,n=ndimage.label(alpha);sizes=np.bincount(labels.ravel());sizes[0]=0;alpha=labels==sizes.argmax()
            sy,sx=np.where(alpha);cropped=side[sy.min():sy.max()+1,sx.min():sx.max()+1,:3].copy()
            mask=alpha[sy.min():sy.max()+1,sx.min():sx.max()+1]
            indices=ndimage.distance_transform_edt(~mask,return_distances=False,return_indices=True)
            cropped[~mask]=cropped[tuple(indices[:,~mask])]
            Image.fromarray(cropped).save(folder/'GalleryRight.png')
