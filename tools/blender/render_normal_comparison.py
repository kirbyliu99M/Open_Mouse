"""Render the lossless source and delivered Superlight 2 under one lighting setup."""

from pathlib import Path
import sys
import bpy
from mathutils import Vector


HERE = Path(__file__).resolve().parent
SLUG = "logitech-g-pro-x-superlight-2"
SOURCE = HERE / "out/polished" / SLUG / f"{SLUG}.glb"
DELIVERED = HERE.parents[1] / "public/models/shells" / f"{SLUG}.glb"


def import_model(path: Path, offset: float) -> None:
    bpy.ops.import_scene.gltf(filepath=str(path))
    for obj in bpy.context.selected_objects:
        if obj.type == "MESH":
            obj.location.x += offset


def main() -> None:
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1:]) != 1:
        raise ValueError("Pass output PNG path after --")
    output = Path(sys.argv[-1])
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    import_model(SOURCE, -0.085)
    import_model(DELIVERED, 0.085)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.12, 0.12, 0.12)
    for location, energy, size in [((-0.12, -0.10, 0.30), 5, 0.16), ((0.22, 0.13, 0.27), 3, 0.12)]:
        light = bpy.data.lights.new("Softbox", "AREA")
        light.energy = energy
        light.shape = "DISK"
        light.size = size
        obj = bpy.data.objects.new("Softbox", light)
        scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0, 0, 0)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    camera_data = bpy.data.cameras.new("Comparison camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 0.42
    camera = bpy.data.objects.new("Comparison camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = (0, -0.35, 0.18)
    camera.rotation_euler = (Vector((0, 0, 0.025)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
