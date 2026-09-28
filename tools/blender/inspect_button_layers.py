"""Cheap source-layer preflight in Phase C's unchanged studio (Blender only)."""
import json
import sys
from collections import Counter
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from phase_c_colour import shared_studio, reference
from bake_refinement import source_channel
from color_reconstruction import socket_value

OUT = HERE / 'out/study-fidelity/c/button-layers'
PATCHES = {'left button': (345, 175, 405, 280),
           'right button': (475, 190, 545, 280), 'palm': (380, 430, 515, 550)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene, cam, centre = shared_studio()
    cam.location = centre + Vector((0, 0, .6))
    cam.rotation_euler = (0, 0, 0)
    objects = reference('logitech-mx-master-4')
    cache, geometry, materials = {}, [], []
    covers = []
    for obj in objects:
        obj.data.calc_loop_triangles()
        vertices = [v.co.copy() for v in obj.data.vertices]
        triangles = list(obj.data.loop_triangles)
        tree = BVHTree.FromPolygons(vertices, [t.vertices for t in triangles], all_triangles=True)
        geometry.append((obj, vertices, triangles, tree))
        transparent = False
        for mat in obj.data.materials:
            shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            alpha = shader.inputs['Alpha']
            info = dict(object=obj.name, material=mat.name, alphaDefault=alpha.default_value,
                        alphaLinks=[dict(node=l.from_node.name, socket=l.from_socket.name) for l in alpha.links])
            if alpha.is_linked:
                node = alpha.links[0].from_node
                if node.type != 'TEX_IMAGE':
                    raise ValueError('Inspect unsupported alpha graph before continuing: ' + node.type)
                pixels = np.array(node.image.pixels[:]).reshape(-1, 4)
                info.update(alphaImage=node.image.name, alphaMin=float(pixels[:, 3].min()),
                            alphaMax=float(pixels[:, 3].max()))
                transparent |= info['alphaMin'] < 1
            else:
                transparent |= alpha.default_value < 1
            materials.append(info)
        if transparent:
            covers.append(obj)
    records = []
    for region, (x0, y0, x1, y1) in PATCHES.items():
        alpha_values, colours, body_colours, depths = [], [], [], []
        front, beneath = Counter(), Counter()
        for y in range(y0 + 2, y1, 5):
            for x in range(x0 + 2, x1, 5):
                origin = Vector(((x + .5 - 400) * .18 / 800, (400 - y - .5) * .18 / 800, .625))
                hits = []
                for obj, vertices, triangles, tree in geometry:
                    pos, normal, index, distance = tree.ray_cast(origin, Vector((0, 0, -1)))
                    if index is None:
                        continue
                    tri = triangles[index]
                    uv = [Vector((*obj.data.uv_layers.active.data[i].uv, 0)) for i in tri.loops]
                    coord = barycentric_transform(pos, *(vertices[i] for i in tri.vertices), *uv)
                    shader = next(n for n in obj.data.materials[tri.material_index].node_tree.nodes
                                  if n.type == 'BSDF_PRINCIPLED')
                    colour = np.asarray(socket_value(shader.inputs['Base Color'], coord, cache))[:3]
                    alpha = socket_value(shader.inputs['Alpha'], coord, cache)
                    # Image Alpha output is a scalar; socket_value returns the sampled RGBA.
                    alpha = float(np.asarray(alpha)[3]) if np.ndim(alpha) else float(alpha)
                    hits.append((distance, obj, colour, alpha, normal))
                hits.sort(key=lambda h: h[0])
                if not hits:
                    raise ValueError('Patch is outside source geometry')
                first = hits[0]
                body = next((h for h in hits if h[1] not in covers), None)
                front[first[1].name] += 1
                alpha_values.append(first[3]); colours.append(first[2])
                if body:
                    beneath[body[1].name] += 1
                    body_colours.append(body[2]); depths.append((body[0] - first[0]) * 1000)
        records.append(dict(region=region, samples=len(alpha_values), firstObjects=dict(front),
                            bodyObjects=dict(beneath), meanAlpha=float(np.mean(alpha_values)),
                            alphaRange=[min(alpha_values), max(alpha_values)],
                            coverBaseLinearRGB=np.mean(colours, axis=0).tolist(),
                            bodyBaseLinearRGB=np.mean(body_colours, axis=0).tolist(),
                            bodyDepthMm=[min(depths), float(np.mean(depths)), max(depths)]))
    report = dict(materials=materials, coverObjects=[o.name for o in covers], regions=records)
    (OUT / 'layers.json').write_text(json.dumps(report, indent=2) + '\n')
    for name in ('reference', 'opaque', 'body'):
        scene.render.filepath = str(OUT / (name + '-top.png'))
        if name == 'opaque':
            with source_channel(covers, 'BaseColour'):
                bpy.ops.render.render(write_still=True)
        else:
            for obj in covers:
                obj.hide_render = name == 'body'
            bpy.ops.render.render(write_still=True)
    print('BUTTON_LAYER_PREFLIGHT', json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
