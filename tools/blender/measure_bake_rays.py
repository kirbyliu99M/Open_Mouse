"""Area-weighted triangle-centroid bake-ray diagnostic (Blender 5.2.2).

Uses pre-orientation reconstruction coordinates, as the production bake does.
The centroid estimate measures shell area, not UV texel share.
"""
import json
from pathlib import Path
import sys
import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from color_reconstruction import source_surface, LIB, REBUILT


def measure(slug):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    record = json.loads((LIB/slug/'sources.json').read_text())
    report = json.loads((REBUILT/slug/'reconstruction.json').read_text())
    calibration = json.loads((HERE/report['cameraFile']).read_text())
    with bpy.data.libraries.load(str(REBUILT/slug/(slug+'.blend')), link=False) as (_, target):
        target.objects = [slug]
    mesh = target.objects[0]
    bpy.context.scene.collection.objects.link(mesh)
    tree, _, _, _, _ = source_surface(record, calibration)
    total = missed = far_missed = rejected = 0.
    for polygon in mesh.data.polygons:
        centre = mesh.matrix_world @ polygon.center
        normal = (mesh.matrix_world.to_3x3().inverted().transposed() @ polygon.normal).normalized()
        area = polygon.area
        total += area
        start = centre + normal*.004
        if tree.ray_cast(start, -normal, .016)[0] is None:
            missed += area
            hit, source_normal, _, _ = tree.ray_cast(start, -normal, .054)
            if hit is None:
                far_missed += area
            elif source_normal.dot(normal) < 0:
                rejected += area
    return dict(slug=slug, areaMm2=total*1e6, missed12Percent=missed/total*100,
                missed50Percent=far_missed/total*100,
                rejectedBackfacePercent=rejected/total*100,
                guardedRemainingPercent=(far_missed+rejected)/total*100)


def main():
    manifest = json.loads((HERE.parents[1]/'public/models/manifest.json').read_text())
    results = []
    for entry in manifest['shells']:
        if entry.get('aliasOf') or entry.get('inheritedShell'):
            continue
        row = measure(entry['slug'])
        results.append(row)
        print('RAY_AREA', json.dumps(row), flush=True)
    # SE has exactly the sibling's geometry and UVs; no independent source.
    sibling = next(r for r in results if r['slug']=='logitech-g-pro-x-superlight-2')
    results.append({**sibling, 'slug':'logitech-g-pro-x-superlight-2-se',
                    'inheritedFrom':sibling['slug']})
    folder = HERE/'out/study-fidelity/c'
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'ray-area.json').write_text(json.dumps(dict(
        method=__doc__, cageMm=4, firstDistanceMm=12, fallbackDistanceMm=50,
        shells=results), indent=2)+'\n')


if __name__ == '__main__':
    main()
