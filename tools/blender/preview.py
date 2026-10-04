"""Render top, side and oblique views from the generated asset scene."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Euler, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import studio, label


def copy_view(objects, scene, location, rotation):
    matrix = Euler(rotation).to_matrix().to_4x4()
    matrix.translation = Vector(location)
    for original in objects:
        obj = original.copy()
        obj.parent = None
        scene.collection.objects.link(obj)
        obj.matrix_world = matrix @ original.matrix_world
        # Review hand uses the rest mesh; rig is exported in the source scene.
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    source = bpy.data.scenes.get("Open_Mouse_Assets")
    if source is None:
        raise RuntimeError("Open out/assets.blend before running preview.py")
    models = json.loads((HERE / "out/parameters.json").read_text())["models"]
    if args.model:
        models = [p for p in models if args.model in (p["id"], p["model"])]
        if not models:
            raise ValueError("Unknown model")
    scene = bpy.data.scenes.new("Open_Mouse_Review")
    bpy.context.window.scene = scene
    width = max(.21, len(models) * .16 + .035)
    studio(scene, width, .49)
    label("OPEN_MOUSE  /  SHELL STUDIES", -width / 2 + .02, .218, .008)
    label("Authored fit proxies  |  silhouette approval pending", -width / 2 + .02, .203, .004)
    for index, params in enumerate(models):
        x = (index - (len(models) - 1) / 2) * .16
        objects = [source.objects[params["id"] + suffix] for suffix in ("_shell", "_wheel")]
        label(params["model"].replace("Logitech ", ""), x - .065, .182, .005)
        label(f'{params["length"]*1000:g} x {params["width"]*1000:g} x {params["height"]*1000:g} mm', x - .065, .172, .0035)
        copy_view(objects, scene, (x, .09, 0), (0, 0, math.pi))
        copy_view(objects, scene, (x, -.053, 0), (math.radians(53), 0, math.radians(28)))
        copy_view(objects, scene, (x, -.192, 0), (0, math.pi / 2, math.pi / 2))
        label("TOP", x - .065, .027, .0035)
        label("THREE QUARTER", x - .065, -.114, .0035)
        label("SIDE", x - .065, -.213, .0035)
    scene.render.filepath = str((HERE / "out" / (args.model or "contact-sheet")).with_suffix(".png"))
    bpy.ops.render.render(write_still=True)
    hand_scene = bpy.data.scenes.new("Open_Mouse_Hand_Review")
    bpy.context.window.scene = hand_scene
    studio(hand_scene, .34, .27)
    label("OPEN_MOUSE  /  21-JOINT HAND", -.15, .112, .007)
    label("Flat rest pose  |  authored template requiring measurement scaling", -.15, .100, .0037)
    copy_view([source.objects["Hand"]], hand_scene, (-.055, -.095, 0), (0, 0, 0))
    copy_view([source.objects["Hand"]], hand_scene, (.090, -.095, 0), (0, math.radians(60), 0))
    hand_scene.render.filepath = str(HERE / "out/hand-review.png")
    bpy.ops.render.render(write_still=True)
    bpy.context.window.scene = scene
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "out/review.blend"))


if __name__ == "__main__":
    main()
