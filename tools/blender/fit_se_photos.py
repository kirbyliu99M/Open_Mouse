"""Canonical orthographic bbox registration and held-out oblique silhouette fit.

The orthogonal registration repeats A2: alpha >180, largest component, filled
holes, independent X/Y bbox normalisation. It is explicitly an affine framing
fit, not a recovered physical lens or an independent shape-identity proof.
"""
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image,ImageDraw
from scipy import ndimage
from scipy.optimize import minimize
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from recolour_se import OUT,SE,photo


def orthographic_axes(azimuth,elevation,roll=0):
    az,el,angle=np.deg2rad([azimuth,elevation,roll])
    direction=np.array([np.sin(az)*np.cos(el),np.cos(az)*np.cos(el),np.sin(el)])
    right=np.array([-np.cos(az),np.sin(az),0]);up=np.cross(direction,right)
    return np.array([right*np.cos(angle)+up*np.sin(angle),-right*np.sin(angle)+up*np.cos(angle),direction])


def raster_silhouette(vertices,faces,axes,size):
    points=vertices@np.asarray(axes)[:2].T;points[:,1]*=-1
    low=points.min(0);span=np.ptp(points,axis=0)
    points=(points-low)/span*(np.array(size)-1)
    mask=np.zeros((size[1],size[0]),np.uint8)
    polygons=np.rint(points[faces]).astype(np.int32)
    try:
        import cv2
    except ImportError:
        # CI needs only NumPy/SciPy/Pillow; OpenCV speeds the local camera search.
        image=Image.new('L',size);draw=ImageDraw.Draw(image)
        for polygon in polygons:draw.polygon(polygon.ravel().tolist(),fill=1)
        mask=np.array(image)
    else:
        cv2.fillPoly(mask,list(polygons),1)
    return ndimage.binary_fill_holes(mask)


def main():
    import cv2
    data=np.load(OUT/'sibling-mesh.npz');vertices=data['vertices'];faces=data['faces']
    views={'top':np.eye(3),'left':[[0,-1,0],[0,0,1],[-1,0,0]],
           'right':[[0,1,0],[0,0,1],[1,0,0]],'bottom':[[-1,0,0],[0,1,0],[0,0,-1]]}
    results=[]
    for view,axes in views.items():
        array,provenance=photo(view);target=ndimage.binary_fill_holes(array[:,:,3]>180)
        h,w=target.shape;size=(round(w*1000/max(w,h)),round(h*1000/max(w,h)))
        target=cv2.resize(target.astype(np.uint8),size,interpolation=cv2.INTER_NEAREST)>0
        rendered=raster_silhouette(vertices,faces,axes,size)
        iou=float((rendered&target).sum()/(rendered|target).sum())
        overlay=np.zeros((*target.shape,3),np.uint8);overlay[target]=[220,70,70];overlay[rendered]=[40,180,240];overlay[target&rendered]=[170,190,190]
        Image.fromarray(overlay).save(OUT/f'fit-{view}.png')
        results.append(dict(view=view,iou=iou,axes=axes.tolist() if isinstance(axes,np.ndarray) else axes,size=list(size),**provenance))
    path=HERE/'out/reference-library'/SE/'pro-x-superlight-2-se-red-3qtr-high-back-angle-gallery-3.png'
    array=np.array(Image.open(path));mask=array[:,:,3]>180;labels,_=ndimage.label(mask);sizes=np.bincount(labels.ravel());sizes[0]=0;mask=ndimage.binary_fill_holes(labels==sizes.argmax())
    y,x=np.where(mask);target=mask[y.min():y.max()+1,x.min():x.max()+1];h,w=target.shape
    size=(round(w*450/max(w,h)),round(h*450/max(w,h)));target=cv2.resize(target.astype(np.uint8),size,interpolation=cv2.INTER_NEAREST)>0
    def objective(angles):
        rendered=raster_silhouette(vertices,faces,orthographic_axes(*angles),size)
        return 1-(rendered&target).sum()/(rendered|target).sum()
    fitted=minimize(objective,[-48,40,0],method='Nelder-Mead',options={'maxiter':220,'xatol':.03,'fatol':1e-5})
    axes=orthographic_axes(*fitted.x)
    results.append(dict(view='hero-held-out',file=str(path.relative_to(HERE/'out/reference-library')).replace('\\','/'),iou=1-float(fitted.fun),angles=fitted.x.tolist(),axes=axes.tolist(),usedForColour=False))
    (OUT/'camera-evidence.json').write_text(json.dumps(dict(method=__doc__,views=results),indent=2)+'\n')
    print(json.dumps(results,indent=2))


if __name__=='__main__':main()
