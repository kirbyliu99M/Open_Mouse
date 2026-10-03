"""Pure linear-light colour transforms used by the SE sibling-shell recolour."""
import numpy as np


def srgb_to_linear(rgb):
    rgb=np.asarray(rgb,dtype=float)
    return np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)


def linear_to_srgb(rgb):
    rgb=np.clip(np.asarray(rgb,dtype=float),0,1)
    return np.where(rgb<=.0031308,12.92*rgb,1.055*rgb**(1/2.4)-.055)


def recolour_region(rgb, source_median, target_median):
    """Preserve multiplicative detail; true zero samples remain zero."""
    source=np.asarray(source_median,dtype=float)
    if np.any(source<=0):raise ValueError('Region median must be positive in every channel')
    return np.clip(np.asarray(rgb)*np.asarray(target_median)/source,0,1)


def remove_smooth_shading(rgb, xy):
    """Robust quadratic log-luminance field, median illumination anchor.

    A relative studio-shading estimate, not colour-chart calibration. Discard
    luminance tails before fitting; share the scalar field across RGB channels.
    """
    rgb=np.asarray(rgb,dtype=float);xy=np.asarray(xy,dtype=float)
    x,y=xy.T;design=np.column_stack([np.ones(len(x)),x,y,x*x,x*y,y*y])
    luminance=rgb@np.array([.2126,.7152,.0722]);log=np.log(np.maximum(luminance,1e-8))
    low,high=np.percentile(log,[10,90]);keep=(log>=low)&(log<=high)
    for _ in range(4):
        coefficients=np.linalg.lstsq(design[keep],log[keep],rcond=None)[0]
        residual=log-design@coefficients
        center=np.median(residual[keep]);mad=np.median(abs(residual[keep]-center))
        keep=(log>=low)&(log<=high)&(abs(residual-center)<=max(3*1.4826*mad,.025))
    field=design@coefficients;anchor=np.median(field[keep])
    shading=np.exp(field-anchor)
    return np.clip(rgb/shading[:,None],0,1),keep,dict(coefficients=coefficients.tolist(),
        logAnchor=float(anchor),shadingMin=float(shading.min()),shadingMax=float(shading.max()))


def recolour_print(rgb, background, ink, target_background, target_ink):
    """Continuous two-colour ink compositing inside an annotated UV print box.

    The spatial box defines the region, not a colour classifier. The scalar ink
    coverage preserves the original antialiased printed edges.
    """
    rgb=np.asarray(rgb);background=np.asarray(background);ink=np.asarray(ink)
    delta=ink-background;denominator=float(delta@delta)
    if denominator<=1e-12:raise ValueError('Print ink and substrate must differ')
    coverage=np.clip(((rgb-background)@delta)/denominator,0,1)
    return np.clip(np.asarray(target_background)+(np.asarray(target_ink)-target_background)*coverage[...,None],0,1),coverage


def connected_components(vertex_count, edges):
    parent=list(range(vertex_count))
    def find(a):
        while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
        return a
    for a,b in edges:parent[find(b)]=find(a)
    groups={}
    for i in range(vertex_count):groups.setdefault(find(i),[]).append(i)
    return sorted(groups.values(),key=len,reverse=True)


def component_region(upper, part):
    if not upper:
        if part in (9,27,59):return 12
        return 7 if part in (3,13,16,15) else 6
    if part in (1,2):return 1
    if part in (3,4,6,7,11,12,13,14):return 2
    if part in (15,21,22,23,24,38,41):return 3
    if part==0:return 4
    if part in (5,8):return 5
    if part in (34,35,42,43):return 10
    return 11


def remove_neutral_specular(rgb):
    """Neutral-illuminant dichromatic subtraction for the saturated red plastic.

    Red SE patches include diffuse pixels with zero green. The minimum channel
    estimates the neutral specular term; do not use on grey or metallic regions.
    """
    rgb=np.asarray(rgb,dtype=float)
    return np.maximum(rgb-rgb.min(axis=-1,keepdims=True),0)
