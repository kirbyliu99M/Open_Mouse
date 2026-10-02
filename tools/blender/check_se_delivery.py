"""Audit the SE candidate's preserved GLB chunks and delivered JPEG colour."""
import hashlib,json
from io import BytesIO
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage
from recolour_se import HERE,OUT,SIBLING,SE,REGIONS,read_glb,image_chunk
from se_colour_math import srgb_to_linear,linear_to_srgb
from skimage.color import rgb2lab,deltaE_ciede2000


def main():
    source=HERE.parents[1]/'public/models/shells'/(SIBLING+'.glb')
    candidate=OUT/(SE+'-delivered.glb')
    a,ab=read_glb(source);b,bb=read_glb(candidate)
    base_index=a['textures'][a['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    base_view=a['images'][base_index]['bufferView']
    preserved=[]
    for index,(av,bv) in enumerate(zip(a['bufferViews'],b['bufferViews'])):
        if index==base_view:continue
        before=ab[av.get('byteOffset',0):av.get('byteOffset',0)+av['byteLength']]
        after=bb[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']]
        assert before==after,f'Non-base bufferView {index} changed'
        preserved.append(dict(bufferView=index,bytes=len(before),sha256=hashlib.sha256(after).hexdigest()))
    for key in ['meshes','accessors','nodes','materials','textures','samplers']:
        assert a.get(key)==b.get(key),f'{key} changed'
    image=np.array(Image.open(BytesIO(image_chunk(b,bb,base_index))).convert('RGB'))
    assert image.shape==(512,512,3),image.shape
    rgb=srgb_to_linear(image/255);ids=np.load(OUT/'region-ids.npy')
    evidence=json.loads((OUT/'colour-evidence.json').read_text());rows=[]
    for number,name in REGIONS.items():
        if number in (8,9):mask=np.load(OUT/f'print-{number}-evaluation.npy')
        else:mask=ndimage.binary_erosion(ids==number,iterations=4)
        coverage=np.array(Image.fromarray(mask.astype(np.float32),mode='F').resize((512,512),Image.Resampling.BOX))
        core=coverage>.99;fallback=not core.any()
        if fallback:core=coverage==coverage.max()
        median=np.median(rgb[core],axis=0);row=next(r for r in evidence['regions'] if r['region']==name)
        target=np.array(row['photoLinearRGB'])
        delta=float(deltaE_ciede2000(rgb2lab(linear_to_srgb(target)[None,:]),rgb2lab(linear_to_srgb(median)[None,:]))[0])
        rows.append(dict(**row,deliveredLinearRGB=median.tolist(),deliveredDeltaE2000=delta,
            deliveredCorePixels=int(core.sum()),subpixelFallback=fallback))
    report=dict(preservedBufferViews=preserved,regions=rows,bytes=candidate.stat().st_size,
        sourceSHA256=hashlib.sha256(source.read_bytes()).hexdigest(),candidateSHA256=hashlib.sha256(candidate.read_bytes()).hexdigest())
    (OUT/'delivery-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
    for row in rows:print(row['region'],row['deliveredLinearRGB'],'DeltaE2000',row['deliveredDeltaE2000'],'pixels',row['deliveredCorePixels'])
    for row in rows:
        if row['region'] in ('shell','main_buttons','side_buttons'):
            assert row['deliveredDeltaE2000']<=5,row
    print('SE_DELIVERY_PASSED',report['bytes'],flush=True)

if __name__=='__main__':main()
