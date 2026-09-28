"""Isolated Phase C opaque-bake candidates and identical-light AR comparisons.

Run in Blender; no optional scientific Python dependencies or public writes.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import export_glb, validate_mesh, dimensions_mm, support_margin_mm
from bake_refinement import bake_materials
from color_reconstruction import LIB, REBUILT, source_surface
from polish_reconstruction import orient

OUT = HERE / 'out/study-fidelity/c/colour'


def candidate(slug):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = OUT / slug
    folder.mkdir(parents=True, exist_ok=True)
    record = json.loads((LIB / slug / 'sources.json').read_text())
    report = json.loads((REBUILT / slug / 'reconstruction.json').read_text())
    calibration = json.loads((HERE / report['cameraFile']).read_text())
    with bpy.data.libraries.load(str(REBUILT / slug / (slug + '.blend'))) as (_, target):
        target.objects = [slug]
    mesh = target.objects[0]
    bpy.context.scene.collection.objects.link(mesh)
    report['textureRefinement'] = bake_materials(mesh, record, calibration, folder / 'textures')
    dims = np.array([record['widthMm'], record['lengthMm'], record['heightMm']]) / 1000
    report['orientation'] = orient(mesh, slug, dims)
    report['mesh'] = validate_mesh(mesh)
    report['dimensionsXYZmm'] = dimensions_mm(mesh)
    report['supportMarginMm'] = support_margin_mm(mesh)
    export_glb([mesh], folder / (slug + '.glb'))
    bpy.ops.wm.save_as_mainfile(filepath=str(folder / (slug + '.blend')))
    (folder / 'reconstruction.json').write_text(json.dumps(report, indent=2) + '\n')
    print('COLOUR_CANDIDATE', slug, flush=True)


def reference(slug):
    record = json.loads((LIB / slug / 'sources.json').read_text())
    report = json.loads((REBUILT / slug / 'reconstruction.json').read_text())
    calibration = json.loads((HERE / report['cameraFile']).read_text())
    _, verts, _, _, objects = source_surface(record, calibration)
    # Apply the shell's shared canonical transform to the assembled source,
    # preserving the original shader graphs and transparent layers for rendering.
    orientation = json.loads((OUT / slug / 'reconstruction.json').read_text())['orientation']
    rotation = Matrix(orientation['rotationMatrix'])
    coords = np.array([rotation @ v for v in verts])
    low, high = coords.min(axis=0), coords.max(axis=0)
    dims = np.array([record['widthMm'], record['lengthMm'], record['heightMm']]) / 1000
    coords = (coords - low) / (high - low) * dims
    coords[:, :2] -= dims[:2] / 2
    offset = 0
    for obj in objects:
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        for vertex in obj.data.vertices:
            vertex.co = coords[offset + vertex.index]
        offset += len(obj.data.vertices)
        obj.data.update()
    return objects


def shared_studio():
    """Identical studio for delivered comparisons and layer hypothesis tests."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.seed = 0
    scene.render.resolution_x = scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    world = bpy.data.worlds.new('Shared neutral studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.12, .12, .12, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .6
    scene.world = world
    for pos, power, size in [((-.20, .15, .4), 4, .35), ((.25, -.1, .3), 2, .3)]:
        data = bpy.data.lights.new('Shared softbox', 'AREA')
        data.energy, data.size = power, size
        light = bpy.data.objects.new('Shared softbox', data)
        scene.collection.objects.link(light)
        light.location = pos
        light.rotation_euler = (-light.location).to_track_quat('-Z', 'Y').to_euler()
    data = bpy.data.cameras.new('Shared camera')
    data.type, data.ortho_scale, data.clip_start = 'ORTHO', .18, .001
    cam = bpy.data.objects.new('Shared camera', data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    centre = Vector((0, 0, .025))
    return scene, cam, centre


def comparisons(slug):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = OUT / slug
    scene, cam, centre = shared_studio()
    for name in ('old', 'new', 'reference'):
        if name == 'reference':
            objects = reference(slug)
        else:
            path = (HERE.parents[1] / 'public/models/shells' / (slug + '.glb')
                    if name == 'old' else folder / (slug + '-delivered.glb'))
            bpy.ops.import_scene.gltf(filepath=str(path))
            objects = list(bpy.context.selected_objects)
        for view, pos in [('top', (0, 0, .6)), ('side', (-.6, 0, .04)),
                          ('hero', (-.25, .35, .32))]:
            cam.location = centre + Vector(pos)
            cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
            if view == 'top':
                cam.rotation_euler = (0, 0, 0)
            scene.render.filepath = str(folder / f'{name}-{view}.png')
            bpy.ops.render.render(write_still=True)
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    print('COLOUR_COMPARISON', slug, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    for slug in args.model.split(','):
        (comparisons if args.render else candidate)(slug)
