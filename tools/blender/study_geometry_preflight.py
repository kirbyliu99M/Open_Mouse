"""Read committed D1 meshes; write only ignored baseline evidence (Blender)."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import dimensions_mm, support_margin_mm, validate_mesh
from check_catalogues import slug as catalogue_slug

SLUGS = ('logitech-m705-marathon', 'logitech-m325s',
         'logitech-signature-comfort-plus-m850l')


def main():
    assert bpy.app.version == (5, 2, 2) and sys.version_info[:2] == (3, 13)
    public = HERE.parents[1] / 'public/models'
    out = HERE / 'out/study-fidelity/d1'
    out.mkdir(parents=True, exist_ok=True)
    hashes = {p.relative_to(public).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in public.rglob('*') if p.is_file()}
    (out / 'baseline-public-hashes.json').write_text(json.dumps(hashes, indent=2)+'\n')
    entries = json.loads((public / 'manifest.json').read_text())['studies']
    catalogue = {catalogue_slug(r): [r['widthMm'], r['lengthMm'], r['heightMm']]
                 for r in json.loads((HERE / 'params/reference-catalogue.json').read_text())}
    for slug in SLUGS:
        entry = next(e for e in entries if e['slug'] == slug)
        path = public / entry['path']
        dest = out / slug
        dest.mkdir(exist_ok=True)
        (dest / 'baseline.glb').write_bytes(path.read_bytes())
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path))
        objects = [o for o in bpy.context.selected_objects if o.type == 'MESH']
        assert len(objects) == 1
        obj = objects[0]
        obj.data.calc_loop_triangles()
        vertices = np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices])*1000
        faces = np.array([tuple(t.vertices) for t in obj.data.loop_triangles])
        np.savez_compressed(dest / 'baseline-mesh.npz', vertices=vertices, faces=faces)
        evidence = dict(slug=slug, sha256=hashes[entry['path']],
                        dimensionsXYZmm=dimensions_mm(obj),
                        catalogueDimensionsXYZmm=catalogue[slug],
                        minZmm=float(vertices[:, 2].min()),
                        baseVertices=int(np.count_nonzero(abs(vertices[:, 2]) < .01)),
                        supportMarginMm=support_margin_mm(obj), mesh=validate_mesh(obj, weld=True))
        evidence['maxBboxErrorMm'] = max(abs(a-b) for a, b in zip(
            evidence['dimensionsXYZmm'], evidence['catalogueDimensionsXYZmm']))
        (dest / 'baseline-geometry.json').write_text(json.dumps(evidence, indent=2)+'\n')
        assert evidence['maxBboxErrorMm'] <= .5
        assert evidence['mesh']['triangles'] <= 15000
        assert evidence['supportMarginMm'] >= 5 and abs(evidence['minZmm']) < .01
        print(json.dumps(evidence), flush=True)


if __name__ == '__main__':
    main()
