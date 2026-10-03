"""Repeatable SE photo measurements and base-colour-only sibling GLB rewrite.

Run after bake_se_regions.py. Outputs remain under out/ until packaging.
Photo annotations use normalised tight alpha-bbox coordinates. Physical regions
come from source components; print boxes use continuous ink compositing, not
colour-based semantic segmentation. No reference-library file is written.
"""
import copy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import struct
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'out/python-deps'))
from se_colour_math import srgb_to_linear,linear_to_srgb,recolour_region,remove_smooth_shading,recolour_print,remove_neutral_specular
SIBLING='logitech-g-pro-x-superlight-2';SE=SIBLING+'-se'
OUT=HERE/'out/study-fidelity/b2'
# Semantic interior patches chosen from photographed geometry, before sampling.
PATCHES={
 'shell':('top',[(.20,.54,.37,.68),(.63,.54,.80,.86),(.25,.85,.40,.9)]),
 'main_buttons':('top',[(.18,.15,.36,.39),(.65,.15,.82,.39)]),
 'side_buttons':('left',[(.35,.447,.415,.465),(.49,.397,.565,.42)]),
 'wheel_rubber':('top',[(.47,.14,.51,.23)]),
 'wheel_rim':('top',[(.547,.135,.555,.23)]),
 'underside':('bottom',[(.27,.335,.42,.38),(.62,.34,.74,.38),(.62,.485,.70,.515)]),
 'feet':('bottom',[(.25,.14,.75,.27)]),
 'logo':('top',[(.411,.742,.427,.764),(.525,.752,.55,.763)]),
 'side_wordmark':('right',[(.741,.83,.745,.875)]),
 'indicator':('top',[(.494,.505,.506,.518)]),
 'ports_and_recesses':('bottom',[(.478,.44,.51,.458)]),
 'underside_logo':('bottom',[(.384,.745,.41,.77)])}
FILES={'top':'top-angle-gallery-1','left':'profile-left-angle-gallery-4',
       'right':'profile-right-angle-gallery-5','bottom':'bottom-angle-gallery-6'}
REGIONS={1:'shell',2:'main_buttons',3:'side_buttons',4:'wheel_rubber',5:'wheel_rim',
         6:'underside',7:'feet',8:'logo',9:'side_wordmark',10:'indicator',11:'ports_and_recesses',12:'underside_logo'}


def read_glb(path):
    blob=path.read_bytes();n=struct.unpack_from('<I',blob,12)[0]
    return json.loads(blob[20:20+n]),blob[28+n:]


def image_chunk(document,binary,index):
    image=document['images'][index];view=document['bufferViews'][image['bufferView']]
    start=view.get('byteOffset',0);return binary[start:start+view['byteLength']]


def replace_image(source,destination,index,png):
    document,binary=read_glb(source)
    selected=document['images'][index]['bufferView'];rewritten=bytearray()
    for i,view in enumerate(document['bufferViews']):
        start=view.get('byteOffset',0);chunk=png if i==selected else binary[start:start+view['byteLength']]
        view['byteOffset']=len(rewritten);view['byteLength']=len(chunk)
        rewritten.extend(chunk);rewritten.extend(b'\0'*(-len(rewritten)%4))
    document['buffers'][0]['byteLength']=len(rewritten)
    encoded=json.dumps(document,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4)
    destination.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(rewritten))+
        struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(rewritten),b'BIN\0')+rewritten)


def photo(view):
    path=HERE/'out/reference-library'/SE/f'pro-x-superlight-2-se-red-{FILES[view]}.png'
    array=np.array(Image.open(path).convert('RGBA'))
    labels,_=ndimage.label(array[:,:,3]>180);sizes=np.bincount(labels.ravel());sizes[0]=0
    mask=labels==sizes.argmax();y,x=np.where(mask);bounds=[int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)]
    x0,y0,x1,y1=bounds
    return array[y0:y1,x0:x1],dict(file=str(path.relative_to(HERE/'out/reference-library')).replace('\\','/'),
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),bbox=bounds)


def sample_photo(view,boxes,red_plastic=False,field_boxes=None):
    array,provenance=photo(view);h,w=array.shape[:2];mask=np.zeros((h,w),bool)
    for x0,y0,x1,y1 in boxes:mask[int(y0*h):int(y1*h),int(x0*w):int(x1*w)]=True
    mask &= array[:,:,3]>250
    # Trim 2 pixels from patch/alpha boundaries before robust highlight rejection.
    mask=ndimage.binary_erosion(mask,iterations=2)
    y,x=np.where(mask);rgb=srgb_to_linear(array[y,x,:3]/255)
    if len(rgb)<12:raise ValueError(f'Insufficient interior pixels for {view}: {boxes}: {len(rgb)}')
    photo_rgb=rgb.copy()
    if red_plastic:rgb=remove_neutral_specular(rgb)
    xy=np.column_stack([x/w,y/h])
    corrected,keep,shading=remove_smooth_shading(rgb,xy)
    if field_boxes is not None:
        # Shell and primary buttons share a red coating in the same top photo.
        # Fit one illumination field across both, avoiding per-region exposure gauges.
        field_mask=np.zeros((h,w),bool)
        for x0,y0,x1,y1 in field_boxes:field_mask[int(y0*h):int(y1*h),int(x0*w):int(x1*w)]=True
        field_mask=ndimage.binary_erosion(field_mask & (array[:,:,3]>250),iterations=2)
        fy,fx=np.where(field_mask)
        field_rgb=remove_neutral_specular(srgb_to_linear(array[fy,fx,:3]/255))
        _,_,shading=remove_smooth_shading(field_rgb,np.column_stack([fx/w,fy/h]))
        xx,yy=xy.T;design=np.column_stack([np.ones(len(xx)),xx,yy,xx*xx,xx*yy,yy*yy])
        scale=np.exp(design@np.array(shading['coefficients'])-shading['logAnchor'])
        corrected=np.clip(rgb/scale[:,None],0,1)
    if view=='top' and boxes==PATCHES['shell'][1]:
        corrected_image=array[:,:,:3].copy()
        corrected_image[y,x]=np.rint(linear_to_srgb(corrected)*255).astype(np.uint8)
        x0,y0,x1,y1=boxes[0];box=(int(x0*w),int(y0*h),int(x1*w),int(y1*h))
        before=Image.fromarray(array[:,:,:3]).crop(box);after=Image.fromarray(corrected_image).crop(box)
        sheet=Image.new('RGB',(before.width*2,before.height));sheet.paste(before,(0,0));sheet.paste(after,(before.width,0));sheet.save(OUT/'deshading-shell-before-after.png')
    return np.median(corrected[keep],axis=0),dict(**provenance,patches=boxes,
        photoRawLinearMedian=np.median(photo_rgb[keep],axis=0).tolist(),
        luminanceCvBefore=float(np.std(photo_rgb[keep]@np.array([.2126,.7152,.0722]))/np.mean(photo_rgb[keep]@np.array([.2126,.7152,.0722]))),
        luminanceCvAfter=float(np.std(corrected[keep]@np.array([.2126,.7152,.0722]))/np.mean(corrected[keep]@np.array([.2126,.7152,.0722]))),
        pixels=int(keep.sum()),rawLinearMedian=np.median(rgb[keep],axis=0).tolist(),
        correctedLinearMedian=np.median(corrected[keep],axis=0).tolist(),shading=shading)


def main():
    from skimage.color import rgb2lab,deltaE_ciede2000
    original_ids=np.load(OUT/'region-ids.npy');ids=original_ids.copy()
    # Extend spatial labels into bake padding for seam-safe downsampling.
    _,nearest=ndimage.distance_transform_edt(ids==0,return_indices=True)
    ids=ids[tuple(nearest)]
    np.save(OUT/'region-ids-padded.npy',ids)
    source=HERE/'out/polished'/SIBLING/(SIBLING+'.glb')
    document,binary=read_glb(source)
    base_index=document['textures'][document['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    rgb=srgb_to_linear(np.array(Image.open(BytesIO(image_chunk(document,binary,base_index))).convert('RGB'))/255)
    result=rgb.copy();rows=[];targets={};source_medians={};measurements={}
    for number,name in REGIONS.items():
        target,evidence=sample_photo(*PATCHES[name],red_plastic=number in (1,2,3),field_boxes=PATCHES['shell'][1]+PATCHES['main_buttons'][1] if number in (1,2) else None);targets[number]=target;measurements[name]=evidence
        core=ndimage.binary_erosion(original_ids==number,iterations=4)
        source_medians[number]=np.median(rgb[core],axis=0)
        if number not in (8,9):result[ids==number]=recolour_region(rgb[ids==number],source_medians[number],target)
    for number in (8,9):
        core=ndimage.binary_erosion(original_ids==number,iterations=4)
        values=rgb[core]
        # Annotated boxes contain ink and substrate; solve continuous ink coverage.
        # Source is grey ink on off-white plastic. No threshold changes region IDs.
        ink=np.percentile(values,8,axis=0);background=source_medians[1]
        updated,coverage=recolour_print(rgb[ids==number],background,ink,targets[1],targets[number])
        result[ids==number]=updated
        # Evaluate full-coverage ink, excluding antialiased printed boundaries.
        eval_mask=np.zeros(ids.shape,bool);eval_mask[ids==number]=coverage>.95
        measurements[REGIONS[number]]['textureEvaluation']='Full-coverage ink inside spatially annotated print ROI; antialiased edges excluded'
        np.save(OUT/f'print-{number}-evaluation.npy',eval_mask)
    out=HERE/'out/polished'/SE;out.mkdir(parents=True,exist_ok=True)
    pixels=np.rint(linear_to_srgb(result)*255).astype(np.uint8);image=Image.fromarray(pixels)
    image.save(OUT/'BaseColour.png');buffer=BytesIO();image.save(buffer,format='PNG')
    replace_image(source,out/(SE+'.glb'),base_index,buffer.getvalue())
    quantized=srgb_to_linear(pixels/255)
    for number,name in REGIONS.items():
        core=np.load(OUT/f'print-{number}-evaluation.npy') if number in (8,9) else ndimage.binary_erosion(original_ids==number,iterations=4)
        median=np.median(quantized[core],axis=0)
        target_lab=rgb2lab(linear_to_srgb(targets[number])[None,:]);actual_lab=rgb2lab(linear_to_srgb(median)[None,:])
        rows.append(dict(region=name,photoLinearRGB=targets[number].tolist(),textureLinearRGB=median.tolist(),
            deltaE2000=float(deltaE_ciede2000(target_lab,actual_lab)[0]),textureCorePixels=int(core.sum())))
    evidence=dict(method='Source component ID bake; explicit spatial UV print annotations; robust quadratic log-luminance removal with median illumination anchor and neutral specular subtraction on saturated red plastic; median linear RGB; multiplicative detail recolour and continuous ink compositing',
        limitation='Relative studio de-shading only: no colour chart or known exposure; unknown global illumination scale remains.',
        regions=rows,photos=measurements,unlabelledAtlasPixels=int((original_ids==0).sum()))
    (OUT/'colour-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    for row in rows:print(row)


if __name__=='__main__':main()
