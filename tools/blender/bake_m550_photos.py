"""Bake only the approved graphite-medium photographs onto the fixed UV atlas.

Local Python NumPy/SciPy/Pillow; Blender prepares the atlas separately. All
products are ignored until the delivered candidate passes geometry checks.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage
from photo_camera_math import project_points
from photo_bake_math import blend_weights, fit_shading, shading_scale, normal_from_height, region_ids
from photo_raster import uv_buffer, camera_buffer
from se_colour_math import srgb_to_linear, linear_to_srgb, remove_smooth_shading

HERE = Path(__file__).resolve().parent
OUT = HERE/'out/study-fidelity/b3'
REGIONS = {1:'shell', 2:'buttons', 3:'wheel', 4:'logo', 5:'rubber', 6:'underside'}
LUMA = np.array([.2126, .7152, .0722])


def main():
    evidence = json.loads((OUT/'camera-evidence.json').read_text())
    mesh = np.load(OUT/'atlas.npz')
    vertices, faces, uvs, corners = [mesh[k] for k in ['vertices', 'faces', 'uv', 'normals']]
    xyz, normals, triangles = uv_buffer(vertices, faces, uvs, corners, 2048)
    valid = triangles >= 0;iy, ix = np.where(valid)
    points, ns = xyz[valid], normals[valid]
    np.savez_compressed(OUT/'atlas-surface.npz', xyz=xyz, normals=normals, triangles=triangles)
    del xyz, normals
    contributions = [];photo_reports = [];prepared = {}
    for row in evidence['views']:
        if not row['usedForTexturing']:continue
        assert row['iou'] >= .95
        name = row['view'];print('PHOTO', name, flush=True)
        array = np.array(Image.open(HERE/'out/reference-library/logitech-m550'/row['file']).convert('RGBA'))
        axes = np.array(row['axes']);centre = np.array(row['centreMm'])
        args = (axes, centre, row['distanceMm'], row['focalPixels'], row['translationMm'], row['principalPointPixels'])
        pixels, distances = project_points(vertices, *args)
        depth, surface, normal = camera_buffer(vertices, faces, corners, pixels, distances, row['imageSize'])
        finite = np.isfinite(depth)
        # Background depth is nearest foreground only for interpolation/gradient;
        # alpha feather and finite mask independently prevent background use.
        _, nearest = ndimage.distance_transform_edt(~finite, return_indices=True)
        filled_depth = depth[tuple(nearest)]
        dy, dx = np.gradient(filled_depth);gradient = np.hypot(dx, dy)
        alpha_distance = ndimage.distance_transform_edt(array[:, :, 3] > 180)
        rgb = srgb_to_linear(array[:, :, :3]/255).astype(np.float32)
        lum = rgb@LUMA
        ids = region_ids(surface.reshape(-1, 3), normal.reshape(-1, 3), lum.ravel()).reshape(depth.shape)
        safe = finite & (alpha_distance > 20) & (gradient < .5)
        fields = {};shading = np.ones(depth.shape, np.float32);stats = []
        # Uniform shell/buttons share albedo; rubber and underside fit separately.
        for group, members in [('plastic', [1, 2]), ('rubber', [5]), ('underside', [6])]:
            mask = safe & np.isin(ids, members) & (lum > .006) & (lum < .35)
            # Exclude strong detail edges, seams, printing and highlights.
            contrast = abs(lum-ndimage.gaussian_filter(lum, 5))
            mask &= contrast < .012
            y, x = np.where(mask)
            if len(x) < 100:
                continue
            stride = max(1, len(x)//25000);y, x = y[::stride], x[::stride]
            coeff, anchor, keep = fit_shading(normal[y, x], lum[y, x])
            apply = finite & np.isin(ids, [1, 2, 3, 4] if group=='plastic' else members)
            shading[apply] = shading_scale(normal[apply], coeff, anchor)
            # The fixed loft's normals cannot describe the real cross-section
            # exactly. Remove a smooth residual image-space field fitted only
            # on the same uniform-albedo samples, never on logos or seams.
            sample_rgb = rgb[y, x]/shading[y, x, None]
            _, residual_keep, residual_field = remove_smooth_shading(sample_rgb,
                np.column_stack((x/depth.shape[1], y/depth.shape[0])))
            yy, xx = np.where(apply);xx=xx/depth.shape[1];yy=yy/depth.shape[0]
            design=np.column_stack((np.ones(len(xx)),xx,yy,xx*xx,xx*yy,yy*yy))
            residual_scale=np.exp(np.clip(design@residual_field['coefficients']-residual_field['logAnchor'],-.7,.7))
            shading[apply]=np.clip(shading[apply]*residual_scale,np.exp(-1.5),np.exp(1.5))
            before = lum[y[keep], x[keep]];after = before/shading[y[keep], x[keep]]
            stats.append(dict(region=group, samples=int(keep.sum()), coefficients=coeff.tolist(), anchor=anchor,
                residualImageField=residual_field,
                luminanceCvBefore=float(before.std()/before.mean()), luminanceCvAfter=float(after.std()/after.mean())))
            fields[group] = dict(coeff=coeff, anchor=anchor)
        corrected = np.clip(rgb/shading[:, :, None], 0, 1)
        medians = {}
        for region in [1, 2, 5, 6]:
            mask = safe & (ids==region) & (lum > .008) & (lum < .3)
            if mask.sum() >= 100:medians[region] = np.median(corrected[mask], axis=0)
        # A fixed shell patch on top, large enough to show residual low-frequency shading.
        if name == 'top':
            x0, y0, x1, y1 = row['crop'];w, h = x1-x0, y1-y0
            box = (int(x0+.23*w), int(y0+.55*h), int(x0+.39*w), int(y0+.85*h))
            raw = Image.fromarray(array[:, :, :3]).crop(box)
            after_image = Image.fromarray(np.uint8(np.rint(linear_to_srgb(corrected)*255))).crop(box)
            sheet = Image.new('RGB', (raw.width*2, raw.height));sheet.paste(raw);sheet.paste(after_image, (raw.width, 0))
            sheet.save(OUT/'delighting-before-after.png')
            x0,y0,x1,y1 = box
            a=lum[y0:y1,x0:x1];b=(corrected@LUMA)[y0:y1,x0:x1]
            (OUT/'delighting-patch.json').write_text(json.dumps(dict(box=box,
                cvBefore=float(a.std()/a.mean()), cvAfter=float(b.std()/b.mean()),
                meanBefore=float(a.mean()), meanAfter=float(b.mean())), indent=2)+'\n')
        prepared[name] = dict(row=row, corrected=corrected, filled_depth=filled_depth,
            gradient=gradient, alpha_distance=alpha_distance, medians=medians)
        photo_reports.append(dict(view=name, shadingFits=stats, correctedRegionMedians={str(k):v.tolist() for k,v in medians.items()}))
        del depth,surface,normal,rgb,corrected,ids,lum,nearest
    # Exposure anchors: top plastic, left rubber, bottom underside. These are
    # relative studio albedos, not calibrated reflectance from a colour chart.
    targets = {1:prepared['top']['medians'][1], 2:prepared['top']['medians'][1],
               5:prepared['left']['medians'][5], 6:prepared['bottom']['medians'][6]}
    candidates = ['top', 'left', 'bottom', 'front']
    if evidence['mirrorAllowed']:candidates.append('mirrored-left')
    total = np.zeros(len(points), np.float32);acc = np.zeros((len(points), 3), np.float32)
    bits = np.zeros(len(points), np.uint8);weights_saved = []
    provisional_regions = region_ids(points, ns, np.zeros(len(points)))
    for number, name in enumerate(candidates):
        source = prepared['left' if name=='mirrored-left' else name];row=source['row']
        p=points.copy();n=ns.copy()
        if name=='mirrored-left':p[:, 0]*=-1;n[:, 0]*=-1
        axes=np.array(row['axes']);centre=np.array(row['centreMm'])
        pixel, d = project_points(p, axes, centre, row['distanceMm'], row['focalPixels'], row['translationMm'], row['principalPointPixels'])
        coordinates=np.array([pixel[:, 1], pixel[:, 0]])
        sample=lambda a:ndimage.map_coordinates(a, coordinates, order=1, mode='constant', cval=0, prefilter=False)
        camera=centre+axes[2]*row['distanceMm']-axes[0]*row['translationMm'][0]-axes[1]*row['translationMm'][1]
        direction=camera-p;direction/=np.linalg.norm(direction,axis=1)[:,None]
        cosine=np.sum(n*direction,axis=1)
        w=blend_weights(cosine, sample(source['alpha_distance']), sample(source['filled_depth'])-d, sample(source['gradient']))
        # Top anchors fine roof artwork; oblique front contributes chiefly the
        # nose/steep front surface, preventing duplicate wheel/logo registration.
        if name=='front':w*=np.clip((.8-n[:,2])/.35,0,1)
        if name in ('left','mirrored-left'):w*=np.clip((.85-n[:,2])/.3,0,1)
        colours=np.column_stack([sample(source['corrected'][:,:,i]) for i in range(3)])
        gains={}
        for region,target in targets.items():
            if region in source['medians']:
                gain=np.clip(target/np.maximum(source['medians'][region],.001),.5,2)
                colours[provisional_regions==region]*=gain
                if region==1:colours[np.isin(provisional_regions,[3,4])]*=gain
                gains[str(region)]=gain.tolist()
        active=w>1e-5;bits[active]|=np.uint8(1<<number)
        acc+=colours*w[:,None];total+=w;weights_saved.append(w.astype(np.float16))
        contributions.append(dict(name=name, bit=1<<number, pixels=int(active.sum()), exposureGains=gains,
            source=row['file'], mirrored=name=='mirrored-left'))
    hit=total>1e-5;colour=np.zeros_like(acc);colour[hit]=acc[hit]/total[hit,None]
    ids=region_ids(points, ns, colour@LUMA)
    for number in REGIONS:
        mask=ids==number;observed=mask&hit
        # Region medians fill unobserved surfaces; no black or UV-space smearing.
        fallback=np.median(colour[observed],axis=0) if observed.any() else targets.get(number,targets[1])
        colour[mask&~hit]=fallback
    # Area weights: every triangle's actual surface area distributed over its
    # covered atlas pixels, so atlas stretching does not inflate coverage.
    tri=vertices[faces];areas=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)/2
    counts=np.bincount(triangles[valid],minlength=len(faces));area=areas[triangles[valid]]/counts[triangles[valid]]
    coverage={}
    for name,mask in [('upper',ns[:,2]>.5),('side',(ns[:,2]>=-.35)&(ns[:,2]<=.5)),('underside',ns[:,2]<-.35)]:
        denominator=area[mask].sum()
        coverage[name]=dict(photoPercent=float(100*area[mask&hit].sum()/denominator),
            directPercent=float(100*area[mask&((bits&15)>0)].sum()/denominator),
            mirroredOnlyPercent=float(100*area[mask&((bits&15)==0)&((bits&16)>0)].sum()/denominator),
            fillPercent=float(100*area[mask&~hit].sum()/denominator), areaMm2=float(denominator))
    # M650 region medians from actual lossless baked MR, not guessed constants.
    sibling=np.load(OUT/'m650-pbr-samples.npz')
    sids=region_ids(sibling['points'],sibling['normals'],sibling['BaseColour']@LUMA)
    mr=sibling['logitech-m650_Metallic-logitech-m650_Roughness'];pbr=[]
    rough=np.zeros(len(points));metal=np.zeros(len(points))
    for number,name in REGIONS.items():
        core=sids==number
        if not core.any():raise ValueError('No M650 PBR samples for '+name)
        r=float(np.median(mr[core,1]));m=float(np.median(mr[core,2]))
        rough[ids==number]=r;metal[ids==number]=m
        pbr.append(dict(region=name,samples=int(core.sum()),roughness=r,metallic=m))
    base=np.zeros((2048,2048,3),np.float32);base[valid]=colour
    region_map=np.zeros((2048,2048),np.uint8);region_map[valid]=ids
    coverage_map=np.zeros((2048,2048),np.uint8);coverage_map[valid]=bits
    # Padding extends only outside the UV surface; hidden surface fill above
    # remains semantic region colour. 12 px bake margin matches the AR pipeline.
    distance, nearest=ndimage.distance_transform_edt(~valid,return_indices=True)
    padding=distance<=12
    base[padding]=base[tuple(nearest[:,padding])]
    luminance=base@LUMA
    # Pixel-scale high pass, limited to surface interiors, suppresses broad
    # lighting while preserving seams and grip/wheel grooves as shallow relief.
    log=np.log(np.maximum(luminance,.003))
    high=np.clip(log-ndimage.gaussian_filter(log,2),-.35,.35)
    interior=ndimage.binary_erosion(valid,iterations=4)
    height=ndimage.gaussian_filter(high*interior,.65)*.8
    normal=normal_from_height(height,interior,strength=.7)
    normal[padding]=normal[tuple(nearest[:,padding])]
    for name,values in [('BaseColour',linear_to_srgb(base)),('Normal',normal)]:
        Image.fromarray(np.uint8(np.rint(np.clip(values,0,1)*255))).save(OUT/(name+'.png'))
    for name,values in [('Roughness',rough),('Metallic',metal)]:
        canvas=np.zeros((2048,2048),np.float32);canvas[valid]=values
        canvas[padding]=canvas[tuple(nearest[:,padding])]
        Image.fromarray(np.uint8(np.rint(canvas*255))).convert('RGB').save(OUT/(name+'.png'))
    Image.fromarray(region_map).save(OUT/'regions.png');Image.fromarray(coverage_map).save(OUT/'coverage-bits.png')
    np.savez_compressed(OUT/'contribution-weights.npz',names=np.array(candidates),weights=np.array(weights_saved),iy=iy,ix=ix)
    diagnostic=np.zeros((2048,2048,3),np.uint8);diagnostic[valid]=[220,150,40]
    diagnostic[coverage_map&15>0]=[70,170,230];diagnostic[(coverage_map&15==0)&(coverage_map&16>0)]=[175,85,210]
    Image.fromarray(diagnostic).save(OUT/'coverage.png')
    report=dict(method='Smart UV atlas; perspective depth-tested cosine^4 photo blend; robust per-material second-order log-SH plus quadratic image-residual delighting; overlap-region exposure matching',
        coverage=coverage,contributions=contributions,photoShading=photo_reports,pbrRegions=pbr,
        fill='Unseen valid texels use their observed region median; underside photographed from bottom; 12px nearest padding only outside atlas islands',
        limitations='Relative studio de-shading, no colour chart; unchanged loft lacks real wheel/button geometry; reflected left is inferred right appearance; high-pass normal detail is shallow inferred relief',
        atlasResolution=2048,normalStrength=.65,heldOut='rear',
        atlasTriangleCoverage=int(np.count_nonzero(counts)),triangleCount=len(faces))
    (OUT/'bake-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(coverage=coverage,pbr=pbr),indent=2),flush=True)


if __name__=='__main__':main()
