"""Phase C Part 3: non-delivered M550 candidate on the M650 AR-derived shell.

Blender only. Starts from the Phase C M650 colour candidate
(`out/study-fidelity/c/colour/logitech-m650/`), removes the two thumb buttons
(M550 is the M650 body without them, Phase A2), fairs that region to the
surrounding side surface, and fills its texture from the neighbouring side
plastic. Writes only under `out/study-fidelity/c/m550-sibling-candidate/`;
never touches public/models, the manifest or validation.

    blender -b --factory-startup --python-exit-code 1 \
        --python tools/blender/build_m550_sibling_candidate.py
"""
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import dimensions_mm, export_glb, support_margin_mm, validate_mesh
from bake_ray_math import fill_from_neighbours
from color_reconstruction import LIB, REBUILT, source_surface

SLUG = 'logitech-m650'
SOURCE_BLEND = HERE / 'out/study-fidelity/c/colour' / SLUG / (SLUG + '.blend')
OUT = HERE / 'out/study-fidelity/c/m550-sibling-candidate'
# Thumb-button pieces in the M650 AR source, import frame, metres. Found by
# listing connected components (Node10: button skins, Node13: button caps).
BUTTON_OBJECTS = ('Node10', 'Node13')
BUTTON_BOX = ((.017, .029), (-.017, .016), (.0175, .031))
BLEND_RINGS = 2
RIM = 8  # texels grown into the seam rims
BAND = 40  # clean-plastic band width used for the fill value
FEATHER = 4
PLATE_MARGIN = .06  # encoded-sRGB luminance above the surrounding graphite
TEXTURE_RINGS = 2  # extra rings so the texture fill starts from clean side plastic
PLATE_OBJECT = 'Node1'  # M650's light grey wheel-to-LED plate (and the dark wheel housing)


def button_vertex_set():
    """Global source-vertex indices (source_surface order) of the thumb-button pieces."""
    record = json.loads((LIB / SLUG / 'sources.json').read_text())
    report = json.loads((REBUILT / SLUG / 'reconstruction.json').read_text())
    calibration = json.loads((HERE / report['cameraFile']).read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with bpy.data.libraries.load(str(REBUILT / SLUG / (SLUG + '.blend'))) as (_, target):
        target.objects = [SLUG]
    shell = target.objects[0]
    bpy.context.scene.collection.objects.link(shell)
    # Capture import-frame coordinates before source_surface transforms them.
    bpy.ops.import_scene.gltf(filepath=str(LIB / record['arModels'][0]['file']))
    world = {o.name: np.array([tuple(o.matrix_world @ v.co) for v in o.data.vertices])
             for o in bpy.context.selected_objects if o.type == 'MESH'}
    for o in list(bpy.context.selected_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    tree, verts, tris, _, objects = source_surface(record, calibration)
    selected, plate, offset, pieces = set(), set(), 0, []
    for obj in objects:
        base = obj.name.split('.')[0]
        coords = world[base]
        if base == PLATE_OBJECT:
            plate.update(range(offset, offset + len(obj.data.vertices)))
        if base in BUTTON_OBJECTS:
            bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
            seen = set()
            for v in bm.verts:
                if v.index in seen:
                    continue
                stack, component = [v], []
                seen.add(v.index)
                while stack:
                    x = stack.pop(); component.append(x.index)
                    for e in x.link_edges:
                        w = e.other_vert(x)
                        if w.index not in seen:
                            seen.add(w.index); stack.append(w)
                points = coords[component]
                inside = all(((points[:, a] >= lo) & (points[:, a] <= hi)).all()
                             for a, (lo, hi) in enumerate(BUTTON_BOX))
                if inside:
                    selected.update(offset + i for i in component)
                    pieces.append(dict(object=base, vertices=len(component)))
            bm.free()
        offset += len(obj.data.vertices)
    # Shell vertices (reconstruction frame) whose nearest source triangle is a button piece.
    region, plate_shell = set(), set()
    for v in shell.data.vertices:
        location, normal, index, distance = tree.find_nearest(shell.matrix_world @ v.co)
        if index is None:
            continue
        if any(i in selected for i in tris[index]):
            region.add(v.index)
        if all(i in plate for i in tris[index]):
            plate_shell.add(v.index)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    return region, plate_shell, pieces, len(shell.data.vertices)


def rings(mesh, seed, count):
    adjacency = [[] for _ in mesh.vertices]
    for e in mesh.edges:
        a, b = e.vertices
        adjacency[a].append(b); adjacency[b].append(a)
    grown, frontier = set(seed), set(seed)
    layers = []
    for _ in range(count):
        frontier = {n for v in frontier for n in adjacency[v]} - grown
        grown |= frontier; layers.append(frontier)
    return grown, layers, adjacency


def fair_region(mesh, region):
    """Biharmonic hole fairing: region vertices minimise the discrete bi-Laplacian.

    Unknowns are the region plus BLEND_RINGS rings; every other vertex is fixed,
    so the new surface meets the untouched shell with matching slope.
    """
    blended, _, adjacency = rings(mesh, region, BLEND_RINGS)
    moved = sorted(blended)
    co = np.array([tuple(v.co) for v in mesh.vertices])
    column = {v: i for i, v in enumerate(moved)}
    # Uniform Laplacian rows for every vertex that touches the moved set.
    rows = sorted(blended | {n for v in blended for n in adjacency[v]})
    lap = {}
    for r in rows:
        weights = {r: 1.0}
        for n in adjacency[r]:
            weights[n] = weights.get(n, 0) - 1.0 / len(adjacency[r])
        lap[r] = weights
    # Bi-Laplacian energy: sum over rows of |L (L x)|^2 is approximated by |L x|^2
    # on the ring-extended set, stacked twice (L and L applied to L's support).
    energy_rows = sorted({n for r in rows for n in adjacency[r]} | set(rows))
    def lap_row(r):
        if r not in lap:
            weights = {r: 1.0}
            for n in adjacency[r]:
                weights[n] = weights.get(n, 0) - 1.0 / len(adjacency[r])
            lap[r] = weights
        return lap[r]
    a = np.zeros((len(energy_rows), len(moved)))
    b = np.zeros((len(energy_rows), 3))
    for i, r in enumerate(energy_rows):
        # (L L x)_r = sum_k L[r,k] * sum_j L[k,j] x_j
        combined = {}
        for k, wk in lap_row(r).items():
            for j, wj in lap_row(k).items():
                combined[j] = combined.get(j, 0) + wk * wj
        for j, w in combined.items():
            if j in column:
                a[i, column[j]] += w
            else:
                b[i] -= w * co[j]
    # Move vertices only along one direction: uniform weights would otherwise
    # also slide vertices tangentially to even out their spacing.
    # One shared direction (the region's mean normal): per-vertex normals diverge on
    # the button edges and let neighbouring triangles cross.
    direction = np.array([tuple(mesh.vertices[v].normal) for v in moved]).mean(0)
    direction /= np.linalg.norm(direction)
    normals = np.tile(direction, (len(moved), 1))
    base = co[moved]
    stacked = np.vstack([a * normals[:, c] for c in range(3)])
    target = np.concatenate([b[:, c] - a @ base[:, c] for c in range(3)])
    offset, _, rank, singular = np.linalg.lstsq(stacked, target, rcond=None)
    solution = base + offset[:, None] * normals
    displacement = np.linalg.norm(solution - co[moved], axis=1) * 1000
    for index, position in zip(moved, solution):
        mesh.vertices[index].co = position
    mesh.update()
    return dict(regionVertices=len(region), movedVertices=len(moved),
                method='biharmonic (bi-Laplacian least squares, uniform weights), vertices move only along the region mean normal, rings outside fixed',
                systemRank=int(rank), systemUnknowns=len(moved),
                maxDisplacementMm=float(displacement.max()), meanDisplacementMm=float(displacement.mean()),
                moved=moved)


def grow(mask, steps, within):
    """4-neighbour binary dilation, `steps` texels, never leaving `within`."""
    mask = mask.copy()
    for _ in range(steps):
        grown = mask.copy()
        grown[1:] |= mask[:-1]; grown[:-1] |= mask[1:]
        grown[:, 1:] |= mask[:, :-1]; grown[:, :-1] |= mask[:, 1:]
        mask = grown & within
    return mask


def plain_fill(pixels, region, band, feather):
    """Fill `region` with the median of `band`, feathering `feather` texels outward.

    Plain plastic has near-uniform albedo, so a constant fill avoids carrying dark
    seam rims across a large region the way neighbour growth does.
    """
    value = np.median(pixels[band], axis=0)
    out = pixels.copy()
    out[region] = value
    inner = region
    for step in range(1, feather + 1):
        ring = grow(inner, 1, band | region) & ~inner
        weight = 1 - step / (feather + 1)
        out[ring] = weight * value + (1 - weight) * pixels[ring]
        inner = inner | ring
    return out, value


def uv_mask(mesh, faces, size):
    """Numpy rasterisation of the given faces' UV triangles into a (size, size) mask."""
    mask = np.zeros((size, size), bool)
    uv = mesh.uv_layers.active.data
    mesh.calc_loop_triangles()
    for tri in mesh.loop_triangles:
        if faces is not None and tri.polygon_index not in faces:
            continue
        p = np.array([tuple(uv[i].uv) for i in tri.loops]) * size - .5
        x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        a, b, c = p
        det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(det) < 1e-12:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / det
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / det
        inside = (l1 >= -1e-6) & (l2 >= -1e-6) & (1 - l1 - l2 >= -1e-6)
        mask[ys[inside], xs[inside]] = True
    return mask


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    region, plate_shell, pieces, count = button_vertex_set()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
    mesh_obj = bpy.data.objects[SLUG]
    mesh = mesh_obj.data
    if len(mesh.vertices) != count:
        raise RuntimeError(f'Vertex count differs: {len(mesh.vertices)} vs {count}')
    before_dims = dimensions_mm(mesh_obj)
    area_before = sum(p.area for p in mesh.polygons)
    # Keep the largest connected patch: stray shell vertices elsewhere can have a
    # button piece's inner geometry as their nearest source triangle.
    _, _, adjacency = rings(mesh, set(), 0)
    left, patches = set(region), []
    while left:
        seed = left.pop(); stack, patch = [seed], [seed]
        while stack:
            x = stack.pop()
            for n in adjacency[x]:
                if n in left:
                    left.remove(n); stack.append(n); patch.append(n)
        patches.append(patch)
    patches.sort(key=len, reverse=True)
    dropped = [len(p) for p in patches[1:]]
    region = set(patches[0])
    fairing = fair_region(mesh, region)
    fairing['droppedStrayPatches'] = dropped
    print('FAIRING', {k: v for k, v in fairing.items() if k != 'moved'}, 'pieces', pieces, flush=True)
    moved = set(fairing.pop('moved'))
    region_faces = {p.index for p in mesh.polygons if any(v in moved for v in p.vertices)}
    removed_area = sum(mesh.polygons[i].area for i in region_faces) * 1e6
    texture_vertices, _, _ = rings(mesh, moved, TEXTURE_RINGS)
    texture_faces = {p.index for p in mesh.polygons if any(v in texture_vertices for v in p.vertices)}
    plate_faces = {p.index for p in mesh.polygons if all(v in plate_shell for v in p.vertices)}
    stats = validate_mesh(mesh_obj)
    after_dims = dimensions_mm(mesh_obj)
    # Texture: fill the faired region from the surrounding side plastic.
    material = mesh.materials[0]
    images = {}
    for node in material.node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            for link in node.outputs['Color'].links:
                images[link.to_socket.name] = node.image
    size = images['Base Color'].size[0]
    valid = uv_mask(mesh, None, size)
    thumb = uv_mask(mesh, texture_faces, size) & valid
    colour = np.empty(len(images['Base Color'].pixels), np.float32)
    images['Base Color'].pixels.foreach_get(colour)
    colour = colour.reshape(size, size, 4)
    luminance = colour[..., :3] @ np.array([.2126, .7152, .0722])
    plate_area = uv_mask(mesh, plate_faces, size) & valid
    # The plate is light grey; the wheel housing on the same source object is dark.
    plate_levels = np.percentile(luminance[plate_area], [10, 50, 90]) if plate_area.any() else []
    around = uv_mask(mesh, {p.index for p in mesh.polygons} - plate_faces, size) & valid
    graphite = float(np.median(luminance[around]))
    # Neutral texels only: the green LED sits on the same plate and stays.
    neutral = np.ptp(colour[..., :3], axis=-1) < .08
    plate_mask = plate_area & neutral & (luminance > graphite + PLATE_MARGIN)
    # Swallow the dark seam rims around both regions, then fill each from a clean band.
    plate_fill = grow(plate_mask, RIM, valid) & ~(plate_area & ~neutral)
    thumb_fill = grow(thumb, RIM, valid)
    texture = {}
    for socket, image in images.items():
        pixels = np.empty(len(image.pixels), np.float32); image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(size, size, 4)
        for name, region in (('thumb', thumb_fill), ('plate', plate_fill)):
            band = grow(region, BAND, valid) & ~grow(region, BAND // 2, valid) & ~plate_area & ~thumb_fill
            if socket == 'Color':  # the normal map feeds a Normal Map node's Color input
                pixels[region, :3] = (.5, .5, 1.0)
                value = (.5, .5, 1.0)
            else:
                pixels, value = plain_fill(pixels, region, band, FEATHER)
            texture.setdefault(name, {})[socket] = [float(v) for v in np.asarray(value)[:3]]
        image.pixels.foreach_set(pixels.ravel()); image.update(); image.pack()
    texture['texels'] = dict(thumb=int(thumb_fill.sum()), plate=int(plate_fill.sum()))
    report = dict(
        method='M650 Phase C colour candidate; thumb-button region (shell vertices whose nearest AR '
               'triangle is a button piece, plus 2 rings) refaired by biharmonic hole filling with the '
               'surrounding shell fixed, vertices moving only along the region mean normal; thumb region (plus 2 rings) and '
               'M650 plate, each grown 8 texels over its seam rim, filled with the median of a clean '
               'surrounding band (feathered 4 texels); normal map flat in both',
        buttonPieces=pieces, fairing=fairing,
        removedRegionAreaMm2=removed_area, shellAreaMm2=area_before * 1e6,
        thumbTexels=int(thumb_fill.sum()), plateTexels=int(plate_fill.sum()),
        plateSourceLuminance=[float(v) for v in plate_levels], surroundingGraphiteLuminance=graphite,
        texture=texture, mesh=stats,
        dimensionsBeforeMm=before_dims, dimensionsAfterMm=after_dims,
        supportMarginMm=support_margin_mm(mesh_obj),
        recolour='Palm, buttons and rear shell need none: M550 and M650 graphite-medium top gallery '
                 'photos differ there by DeltaE2000 0.00, 0.36, 0.69 and 0.00. The one difference is M650s '
                 'light grey wheel-to-LED plate, absent on M550: its texels (light texels on the plate source '
                 'object) are filled with the median of the surrounding button graphite. M550s thin centre seam is not drawn',
        delivered=False)
    export_glb([mesh_obj], OUT / 'm550-on-m650-candidate.glb')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'm550-on-m650-candidate.blend'))
    mesh.calc_loop_triangles()
    world = mesh_obj.matrix_world
    np.savez(OUT / 'lossless-mesh.npz',
             vertices=np.array([tuple(world @ v.co) for v in mesh.vertices]),
             faces=np.array([tuple(t.vertices) for t in mesh.loop_triangles]))
    (OUT / 'candidate.json').write_text(json.dumps(report, indent=2) + '\n')
    print('M550_SIBLING_CANDIDATE', json.dumps({k: report[k] for k in
          ('fairing', 'removedRegionAreaMm2', 'thumbTexels', 'plateTexels', 'plateSourceLuminance', 'surroundingGraphiteLuminance', 'dimensionsBeforeMm', 'dimensionsAfterMm',
           'supportMarginMm', 'mesh')}), flush=True)


if __name__ == '__main__':
    main()
