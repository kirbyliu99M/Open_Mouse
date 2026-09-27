"""Limited-view studies: trace each model's actual top/side image boundaries.

Transverse curvature is interpolated, explicitly unverified where views lack it.
These studies are not labelled complete 360 reconstructions.
"""
import json
import argparse
import math
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage
HERE=Path(__file__).resolve().parent
ROOT=HERE/'out/reference-library'
CHOICES={
 'logitech-g-pro-x-superlight-2-se':('pro-x-superlight-2-se-red-top-angle-gallery-1.png','pro-x-superlight-2-se-red-profile-left-angle-gallery-4.png'),
 'logitech-m100':('m100-charcoal-gallery-1.png','m100-charcoal-gallery-4.png'),
 'logitech-m550':('m550-medium-graphite-top-angle-gallery-1.png','m550-medium-graphite-profile-angle-gallery-4.png'),
 'logitech-m705-marathon':('m705-gallery-1.png','m705-gallery-4.png'),
 'logitech-m750':('top.png','right.png'),
 'logitech-m325s':('top.png','left.png'),
 'logitech-mobi-fold':('top.png','right.png'),
 'logitech-signature-comfort-plus-m850l':('top.png','left.png'),
 'logitech-signature-comfort-m840l':('extra-5.png','left.png'),
 'logitech-mx-ergo-s':('top.png','left.png'),
 'logitech-ergo-m575s':('top.png','left.png'),
 'logitech-g903-hero':('top.png','left.png'),
}


def body_mask(path):
    image=np.array(Image.open(path).convert('RGBA'))
    mask=image[:,:,3]>180
    mask=ndimage.binary_opening(mask,iterations=max(mask.shape)//200)
    labels,count=ndimage.label(mask)
    sizes=np.bincount(labels.ravel());sizes[0]=0
    mask=ndimage.binary_fill_holes(labels==sizes.argmax())
    yy,xx=np.where(mask)
    result=mask[yy.min():yy.max()+1,xx.min():xx.max()+1]
    if 'm100' in path.name:
        from compare_reconstruction import remove_thin_lead
        result=remove_thin_lead(result.T).T if 'gallery-4' in path.name else remove_thin_lead(result)
    return result


def contour(mask,axis):
    if axis==1:
        mask=mask.T
    low=[];high=[]
    for row in mask:
        indices=np.flatnonzero(row)
        low.append(indices[0] if len(indices) else mask.shape[1]/2)
        high.append(indices[-1] if len(indices) else mask.shape[1]/2)
    return np.array(low,dtype=float),np.array(high,dtype=float)


def cameras(target):
    center=np.array([0,0,target[2]/2]);distance=max(target)*4
    result=[]
    for name,az,el in [('top',0,90),('azimuth-000.0',0,0),('azimuth-180.0',180,0),('elevated-225',225,40)]:
        a,e=np.radians([az,el])
        outward=np.array([np.cos(a)*np.cos(e),np.sin(a)*np.cos(e),np.sin(e)])
        forward=-outward
        up=np.array([0,0,1]) if el<89 else np.array([0,1,0])
        right=np.cross(forward,up);right/=np.linalg.norm(right)
        vertical=np.cross(right,forward)
        matrix=np.eye(4);matrix[:3,:3]=[right,vertical,-forward]
        matrix[:3,3]=-matrix[:3,:3]@(center+outward*distance)
        result.append({'name':name,'image':name+'.png','azimuth':az,'elevation':el,'worldToCamera':matrix.tolist(),'orthoScale':max(target)*1.22,'resolution':512})
    return result


def reconstruct(slug,files):
    record=json.loads((ROOT/slug/'sources.json').read_text())
    top,side=[body_mask(ROOT/slug/name) for name in files]
    l,r=contour(top,0)
    upper,lower=contour(side,1)
    # The documented side files show the nose on the left. Exclude the wheel
    # from the shell roof by interpolating its forward-deck interval.
    u=np.linspace(0,1,len(upper))
    interval=(u>.13)&(u<.29)
    upper[interval]=np.interp(u[interval],u[~interval],upper[~interval])
    upper=ndimage.gaussian_filter1d(upper,len(upper)*.008)
    lower=ndimage.gaussian_filter1d(lower,len(lower)*.008)
    target=np.array([record['widthMm'],record['lengthMm'],record['heightMm']])/1000
    samples=np.linspace(0,1,129)
    left=np.interp(samples,np.linspace(0,1,len(l)),l/top.shape[1]-.5)*target[0]
    right=np.interp(samples,np.linspace(0,1,len(r)),r/top.shape[1]-.5)*target[0]
    high=np.interp(samples,u,1-upper/side.shape[0])*target[2]
    low=np.interp(samples,u,1-lower/side.shape[0])*target[2]
    vertices=[];faces=[];segments=80
    vertices.append(((left[0]+right[0])/2,-target[1]/2,(high[0]+low[0])/2))
    for i in range(1,128):
        center=(left[i]+right[i])/2;radius=(right[i]-left[i])/2
        base=low[i]+(high[i]-low[i])*.18
        for j in range(segments):
            angle=math.tau*j/segments;c,s=math.cos(angle),math.sin(angle)
            x=center+math.copysign(abs(c)**.58,c)*radius
            z=base+(high[i]-base)*s**.7 if s>=0 else base-(base-low[i])*(-s)**.22
            vertices.append((x,(samples[i]-.5)*target[1],z))
    back=len(vertices)
    vertices.append(((left[-1]+right[-1])/2,target[1]/2,(high[-1]+low[-1])/2))
    for j in range(segments):
        n=(j+1)%segments
        faces.append((0,1+n,1+j))
        for ring in range(126):
            a=1+ring*segments;b=a+segments
            faces.append((a+j,a+n,b+n));faces.append((a+j,b+n,b+j))
        a=1+126*segments
        faces.append((a+j,a+n,back))
    folder=HERE/'out/reconstructed'/slug;folder.mkdir(parents=True,exist_ok=True)
    np.savez_compressed(folder/'mesh.npz',vertices=np.array(vertices),faces=np.array(faces))
    calibration={'dimensionsXYZ':target.tolist(),'views':cameras(target),'referenceMode':'gallery-only'}
    (folder/'cameras.json').write_text(json.dumps(calibration,indent=2)+'\n')
    Image.fromarray(top.astype('uint8')*255).save(folder/'traced-top-mask.png')
    Image.fromarray(side.astype('uint8')*255).save(folder/'traced-side-mask.png')
    report={'slug':slug,'method':'Model-specific top and side photo contour loft','referenceMode':'gallery-only',
        'source':[next(image for image in record['images'] if Path(image['file']).name==name) for name in files],
        'cameraFile':str((folder/'cameras.json').relative_to(HERE)),'dimensionsXYZ':target.tolist(),
        'rawVertices':len(vertices),'rawTriangles':len(faces),'status':'Limited-view silhouette study; transverse shape and details unverified',
        'limitations':['No working official 360 asset found','Cross-sections interpolated between traced outlines','Side image perspective has not been camera-calibrated','Wheel and button details are not reconstructed']}
    (folder/'reconstruction.json').write_text(json.dumps(report,indent=2)+'\n')
    print('TRACED',slug,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--model');args=parser.parse_args()
    for slug,files in CHOICES.items():
        if not args.model or slug in args.model.split(','):reconstruct(slug,files)
