"""Phase D5b: locate and fit each shell's scroll wheel from its AR source.

Method, per Kirby's direction ("use the dimensions as a reference, then build up the
models by analysing the depth and edges") and a coordinator audit of the first attempt
(free-axis fits on whatever local surface sat nearest the deficiency, not the wheel, for
three of the four shells):

1. Localise a wheel-sized candidate point cloud in the AR source, one of:
   - a source-mesh topological island (M190: the wheel is its own connected component,
     not a separate glTF node), or
   - a dedicated glTF mesh node (M750, M650: B1's inspection already found M750's "Node5 /
     Wheel"; both have a near-circular node matching the physical envelope), or
   - a cylindrical band gathered around the D0/D4 "inside > 2mm" deficiency cluster's
     centreline sub-clusters, widened along the AR source's own geometry, when no isolated
     component or node exists (G903).
2. **Constrain the axis to the mouse's lateral (X) axis** (a scroll wheel turns about it) —
   exact, so within the required 10 degrees by construction.
3. Take a rough free-axis fit on the candidate to get an expected radius, then keep only
   points within +-2.5mm of that radius (the outer tread ring, not the interior hub, spokes
   or axle mount also present in a component/node/band), and refit at the fixed axis.
4. Reject the fit if width is outside 4-12mm or radius is outside 6-15mm (a scroll wheel's
   physical envelope); that shell is then left unchanged and the reason recorded.

Read-only. Writes tools/blender/out/d5/wheel-fits.json.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/d5_wheel_fit.py -- \
        --data <tools/blender folder> --baseline <out/d5/baseline folder>
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import color_reconstruction
from cylinder_fit_math import axis_extent, fit_cylinder_fixed_axis, robust_fit_cylinder

OUT = HERE / 'out/d5/wheel-fits.json'
LATERAL_AXIS = np.array([1.0, 0.0, 0.0])
WIDTH_BOUNDS_MM = (4.0, 12.0)
RADIUS_BOUNDS_MM = (6.0, 15.0)
MAX_AXIS_ANGLE_DEG = 10.0
RADIUS_WINDOW_MM = 2.5

STRATEGY = {
    'logitech-m190': 'component',
    'logitech-m750': 'object',
    'logitech-m650': 'object',
    'logitech-g903-hero': 'cluster-band',
}


def connected_components(n_verts, triangles):
    parent = list(range(n_verts))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b, c in triangles:
        ra, rb, rc = find(a), find(b), find(c)
        if ra != rb:
            parent[ra] = rb
        rc = find(c)
        rb = find(b)
        if rb != rc:
            parent[rb] = rc
    return np.array([find(i) for i in range(n_verts)])


def cluster_points(points, link_mm):
    n = len(points)
    if n == 0:
        return np.array([], int)
    diffs = points[:, None, :] - points[None, :, :]
    dist = np.linalg.norm(diffs, axis=-1)
    adjacency = dist < (link_mm / 1000)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(n):
        for j in np.nonzero(adjacency[i])[0]:
            ri, rj = find(i), find(int(j))
            if ri != rj:
                parent[ri] = rj
    return np.array([find(i) for i in range(n)])


def circularity(bbox):
    s = sorted(bbox)
    return abs(s[2] - s[1]) / max(s[2], 1e-9), s


def candidate_from_component(v, t, inside):
    labels = connected_components(len(v), t)
    unique, counts = np.unique(labels, return_counts=True)
    best = None
    for label, count in zip(unique, counts):
        if not (80 <= count <= 3000):
            continue
        pts = v[labels == label]
        bbox = pts.max(0) - pts.min(0)
        circ, sbbox = circularity(bbox)
        diffs = pts[:, None, :] - inside[None, :, :]
        dist = float(np.linalg.norm(diffs, axis=-1).min())
        if dist > 0.012 or sbbox[1] < 0.008:
            continue
        if best is None or circ < best[0]:
            best = (circ, pts, dist, int(label))
    if best is None:
        return None, None
    circ, pts, dist, label = best
    return pts, dict(method='source-mesh connected component', componentLabel=label,
                      componentVertices=len(pts), distToDeficiencyMm=round(dist * 1000, 3))


def candidate_from_object(objects_verts, inside):
    best = None
    for name, pts in objects_verts.items():
        bbox = pts.max(0) - pts.min(0)
        circ, sbbox = circularity(bbox)
        diffs = pts[:, None, :] - inside[None, :, :]
        dist = float(np.linalg.norm(diffs, axis=-1).min())
        if sbbox[1] < 0.008 or sbbox[1] > 0.04 or dist > 0.015:
            continue
        if best is None or circ < best[0]:
            best = (circ, pts, dist, name)
    if best is None:
        return None, None
    circ, pts, dist, name = best
    return pts, dict(method='AR source glTF node', node=name, nodeVertices=len(pts),
                      distToDeficiencyMm=round(dist * 1000, 3))


def wheel_deficiency_zone(inside, link_mm=3.0, centreline_mm=13.0, min_points=8):
    labels = cluster_points(inside, link_mm)
    unique, counts = np.unique(labels, return_counts=True)
    zone = []
    for label, count in zip(unique, counts):
        if count < min_points:
            continue
        cluster = inside[labels == label]
        if abs(cluster[:, 0].mean()) * 1000 > centreline_mm:
            continue
        zone.append(cluster)
    return np.vstack(zone) if zone else None


def candidate_from_cluster_band(v, inside, band_half_width_mm=6.0):
    zone = wheel_deficiency_zone(inside)
    if zone is None or len(zone) < 8:
        return None, dict(method='deficiency-cluster band', reason='no near-centreline cluster')
    zone_centroid = zone.mean(0)
    diffs = v[:, None, :] - zone[None, :, :]
    near = v[np.linalg.norm(diffs, axis=-1).min(axis=1) < 0.012]
    if len(near) < 20:
        return None, dict(method='deficiency-cluster band', reason=f'only {len(near)} nearby source vertices')
    rough, _ = robust_fit_cylinder(near, iterations=3, keep_fraction=0.6)
    rough_perp = rough['center'] - np.dot(rough['center'], LATERAL_AXIS) * LATERAL_AXIS
    axis_point = rough_perp + zone_centroid[0] * LATERAL_AXIS
    lateral = v[np.abs(v[:, 0] - axis_point[0]) < band_half_width_mm / 1000]
    rel = lateral - axis_point
    radial = np.linalg.norm(rel - np.outer(rel @ LATERAL_AXIS, LATERAL_AXIS), axis=1)
    # A generous radial cap keeps the candidate close to a plausible wheel envelope so the
    # refinement's own rough fit (on this candidate) is not swamped by unrelated chassis.
    band = lateral[radial < 0.018]
    if len(band) < 20:
        return None, dict(method='deficiency-cluster band', reason=f'only {len(band)} band vertices')
    return band, dict(method='deficiency-cluster PCA axis + cylindrical band',
                       deficiencyZonePoints=int(len(zone)), roughNeighbourhoodPoints=len(near), bandPoints=len(band))


def refine_to_outer_tread(candidate):
    """Given a wheel-ish candidate point cloud (component, node or band — may include
    hub/spokes/mount as well as tread), get a rough expected radius, keep only the outer
    tread ring (within +-2.5mm of that radius) and refit at the fixed lateral axis."""
    rough, _ = robust_fit_cylinder(candidate, iterations=2, keep_fraction=0.8)
    rough_perp = rough['center'] - np.dot(rough['center'], LATERAL_AXIS) * LATERAL_AXIS
    rel = candidate - rough_perp
    radial = np.linalg.norm(rel - np.outer(rel @ LATERAL_AXIS, LATERAL_AXIS), axis=1)
    outer = candidate[np.abs(radial - rough['radius']) < RADIUS_WINDOW_MM / 1000]
    if len(outer) < 10:
        return None, len(outer)
    fit, inliers = robust_fit_cylinder(
        outer, iterations=4, keep_fraction=0.75,
        fit_fn=lambda pts: fit_cylinder_fixed_axis(pts, axis=LATERAL_AXIS))
    return (fit, inliers, len(outer)), len(outer)


def measure(slug, data, baseline):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    record = json.loads((data / 'out/reference-library' / slug / 'sources.json').read_text())
    report = json.loads((data / 'out/reconstructed' / slug / 'reconstruction.json').read_text())
    calibration = json.loads((data / report['cameraFile']).read_text())
    color_reconstruction.LIB = data / 'out/reference-library'

    bpy.ops.import_scene.gltf(filepath=str(color_reconstruction.LIB / record['arModels'][0]['file']))
    objects = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    points = [obj.matrix_world @ vx.co for obj in objects for vx in obj.data.vertices]
    low = Vector([min(p[a] for p in points) for a in range(3)])
    high = Vector([max(p[a] for p in points) for a in range(3)])
    trim = calibration.get('cableTrim')
    if trim:
        low[trim['axis']], high[trim['axis']] = trim['after']
    order = calibration['sourceAxisPermutation']
    mapping = Matrix([[int(c == order[r]) for c in range(3)] for r in range(3)])
    if mapping.determinant() < 0:
        mapping[0] = -mapping[0]
    target = calibration['dimensionsXYZ']
    size = high - low
    vertices, triangles, objects_verts = [], [], {}
    for obj in objects:
        offset = len(vertices)
        obj_verts = []
        for vx in obj.data.vertices:
            p = mapping @ (obj.matrix_world @ vx.co - (low + high) / 2)
            pos = [p[a] * target[a] / size[order[a]] + (target[2] / 2 if a == 2 else 0) for a in range(3)]
            vertices.append(pos)
            obj_verts.append(pos)
        objects_verts[obj.name] = np.array(obj_verts)
        obj.data.calc_loop_triangles()
        for tri in obj.data.loop_triangles:
            triangles.append(tuple(offset + i for i in tri.vertices))
    v = np.array(vertices)

    npz = np.load(baseline / (slug + '.npz'))
    points_def, signed = npz['points'], npz['signed_mm']
    inside = points_def[signed < -2]

    strategy = STRATEGY[slug]
    result = dict(slug=slug, strategy=strategy)
    if strategy == 'component':
        candidate, provenance = candidate_from_component(v, triangles, inside)
    elif strategy == 'object':
        candidate, provenance = candidate_from_object(objects_verts, inside)
    else:
        candidate, provenance = candidate_from_cluster_band(v, inside)

    if candidate is None:
        result.update(fit=False, reason=f'No candidate found ({provenance})')
        print('WHEEL_FIT', json.dumps(result), flush=True)
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        return result

    refined, outer_count = refine_to_outer_tread(candidate)
    if refined is None:
        result.update(fit=False, provenance=provenance,
                       reason=f'Only {outer_count} points in the outer-tread radius window')
        print('WHEEL_FIT', json.dumps(result), flush=True)
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        return result
    fit, inliers, outer_count = refined
    midpoint, width = axis_extent(inliers, fit['axis'], fit['center'])
    angle_deg = math.degrees(math.acos(min(1.0, abs(float(np.dot(fit['axis'], LATERAL_AXIS))))))
    radius_mm, width_mm = fit['radius'] * 1000, width * 1000
    ok = (WIDTH_BOUNDS_MM[0] <= width_mm <= WIDTH_BOUNDS_MM[1]
          and RADIUS_BOUNDS_MM[0] <= radius_mm <= RADIUS_BOUNDS_MM[1]
          and angle_deg <= MAX_AXIS_ANGLE_DEG)
    result.update(
        fit=bool(ok), axisAngleDeg=angle_deg, provenance=provenance,
        candidatePoints=len(candidate), outerTreadPoints=outer_count, inlierPoints=len(inliers),
        axis=list(fit['axis']), center=list(midpoint), radiusM=fit['radius'], widthM=width,
        radiusMm=radius_mm, widthMm=width_mm, rmsMm=fit['rms'] * 1000, maxAbsMm=fit['max_abs'] * 1000)
    if not ok:
        reasons = []
        if not (WIDTH_BOUNDS_MM[0] <= width_mm <= WIDTH_BOUNDS_MM[1]):
            reasons.append(f'width {width_mm:.2f} mm outside {WIDTH_BOUNDS_MM} mm')
        if not (RADIUS_BOUNDS_MM[0] <= radius_mm <= RADIUS_BOUNDS_MM[1]):
            reasons.append(f'radius {radius_mm:.2f} mm outside {RADIUS_BOUNDS_MM} mm')
        if angle_deg > MAX_AXIS_ANGLE_DEG:
            reasons.append(f'axis angle {angle_deg:.1f} deg exceeds {MAX_AXIS_ANGLE_DEG} deg')
        result['reason'] = '; '.join(reasons)
    print('WHEEL_FIT', json.dumps({k: v for k, v in result.items() if k not in ('axis', 'center')}), flush=True)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    return result


SLUGS = list(STRATEGY)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--slug', nargs='+', default=SLUGS)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = Path(args.data)
    baseline = Path(args.baseline)
    results = {}
    for slug in args.slug:
        results[slug] = measure(slug, data, baseline)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(results, indent=2) + '\n')
    print('WHEEL_FITS_WRITTEN', str(OUT), flush=True)


if __name__ == '__main__':
    main()
