"""Render four orthographic study views and measure base clearance by length tenth.

Run with Blender --background --python ... -- <output-dir> [--render].
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SLUGS = (
    "logitech-signature-comfort-plus-m850l", "logitech-m325s",
    "logitech-m550", "logitech-m705-marathon",
)


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    root = Path(args[args.index("--root")+1]) if "--root" in args else ROOT
    output = Path(args[0])
    if not output.is_absolute(): output = ROOT / output
    output.mkdir(parents=True, exist_ok=True)
    render = "--render" in args
    manifest = json.loads((root / "public/models/manifest.json").read_text(encoding="utf-8"))
    entries = {entry["slug"]: entry for entry in manifest["studies"]}
    measurements = {}
    for slug in SLUGS:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(root / "public/models" / entries[slug]["path"]))
        mesh = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
        points = [mesh.matrix_world @ vertex.co for vertex in mesh.data.vertices]
        y0 = min(point.y for point in points)
        length = max(point.y for point in points) - y0
        bins = [[] for _ in range(10)]
        for point in points:
            bins[min(9, int((point.y-y0)/length*10))].append(point.z*1000)
        measurements[slug] = [round(min(group), 3) for group in bins]
        print("BASE_TENTHS", slug, measurements[slug], flush=True)
        if not render or slug not in SLUGS[:5]:
            continue
        scene = bpy.context.scene
        scene.render.engine = "BLENDER_EEVEE"
        scene.render.resolution_x = scene.render.resolution_y = 512
        scene.render.film_transparent = False
        world = bpy.data.worlds.new("Review white")
        scene.world = world
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
        scene.view_settings.view_transform = "Standard"
        lamp = bpy.data.lights.new("Sun", "SUN"); lamp.energy = 2.5
        light = bpy.data.objects.new("Sun", lamp); scene.collection.objects.link(light)
        light.rotation_euler = (.6, -.4, .3)
        center = Vector(tuple((min(p[i] for p in points)+max(p[i] for p in points))/2 for i in range(3)))
        size = max(max(p[i] for p in points)-min(p[i] for p in points) for i in range(3))*1.25
        for name, loc, rotation in (
            ("top", (0, 0, 1), (0, 0, 0)),
            ("left", (-1, 0, 0), (math.pi/2, 0, -math.pi/2)),
            ("right", (1, 0, 0), (math.pi/2, 0, math.pi/2)),
            ("back", (0, -1, 0), (math.pi/2, 0, 0)),
        ):
            camera_data = bpy.data.cameras.new(name); camera_data.type = "ORTHO"; camera_data.ortho_scale = size
            camera = bpy.data.objects.new(name, camera_data); scene.collection.objects.link(camera)
            camera.location = center + Vector(loc)*.5; camera.rotation_euler = rotation
            scene.camera = camera
            scene.render.filepath = str(output / f"{slug}__{name}.png")
            bpy.ops.render.render(write_still=True)
    (output / "base-tenths.json").write_text(json.dumps(measurements, indent=2)+"\n")


if __name__ == "__main__":
    main()
