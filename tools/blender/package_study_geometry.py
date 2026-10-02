"""Install only a D1 study with passing, hash-bound round-trip evidence."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil

from pretty_json import write_pretty_json
from study_deformation_math import delivery_gate

HERE = Path(__file__).resolve().parent
SLUGS = ('logitech-m325s', 'logitech-m705-marathon', 'logitech-signature-comfort-plus-m850l')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    out = args.directory
    slug = out.name
    assert slug in SLUGS
    geometry = json.loads((out/'roundtrip-geometry.json').read_text())
    evidence = json.loads((out/'roundtrip-silhouette-evaluation.json').read_text())
    deformation = json.loads((out/'deformation.json').read_text())
    fitting = [r for r in evidence['views'] if r['role'] == 'fit']
    held = [r for r in evidence['views'] if r['role'] == 'held-out']
    assert delivery_gate([r['beforeIoU'] for r in fitting], [r['afterIoU'] for r in fitting],
                         [r['beforeIoU'] for r in held], [r['afterIoU'] for r in held])['passed']
    assert not deformation['heldOutUsed'] and not deformation['cameraRefitted']
    candidate = out/'candidate.glb'
    assert hashlib.sha256(candidate.read_bytes()).hexdigest() == geometry['candidateSHA256'] == evidence['candidateSHA256']
    assert geometry['mesh']['triangles'] <= 15000 and geometry['maxBboxErrorMm'] <= .5
    assert geometry['supportMarginMm'] >= 5 and abs(geometry['minZmm']) < 1e-8
    assert all(geometry['mesh'][key] == 0 for key in ('nonManifoldEdges', 'degenerateFaces', 'nonAdjacentIntersectionPairs'))
    assert all(geometry[key] for key in ('uvUnchanged', 'materialsUnchanged', 'textureBytesUnchanged'))
    public = HERE.parents[1]/'public/models'
    manifest = json.loads((public/'manifest.json').read_text(encoding='utf-8'))
    validation = json.loads((public/'validation.json').read_text(encoding='utf-8'))
    entry = next(e for e in manifest['studies'] if e['slug'] == slug)
    assert (public/entry['path']).read_bytes() == (out/'baseline.glb').read_bytes(), 'Published baseline drift'
    entry.update(bytes=geometry['bytes'], mesh=geometry['mesh'], dimensionsXYZmm=geometry['dimensionsXYZmm'],
        supportMarginMm=geometry['supportMarginMm'], groundErrorMm=abs(geometry['minZmm']),
        calibratedBboxRoundTripDifferenceMm=geometry['maxBboxErrorMm'],
        geometryRefinement=dict(deformation=deformation, roundTrip=geometry, silhouettes=evidence,
            baselineSHA256=hashlib.sha256((out/'baseline.glb').read_bytes()).hexdigest(),
            limitation='Smooth photo-silhouette refinement; existing projected details can stretch; local shape remains approximate'))
    validation['roundTrips'] = [deepcopy(entry) if e['slug'] == slug else e for e in validation['roundTrips']]
    shutil.copyfile(candidate, public/entry['path'])
    write_pretty_json(public/'manifest.json', manifest)
    write_pretty_json(public/'validation.json', validation)
    print('STUDY_PACKAGED', slug, geometry['bytes'])


if __name__ == '__main__':
    main()
