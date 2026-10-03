"""Check the Blender toolchain with a synthetic block, not a mouse shell.

Run in a separate background Blender process; never executes in the live MCP
scene. Outputs stay in tools/blender/out/ (gitignored). No catalogue inputs.
"""

import argparse
import json
from pathlib import Path
import struct
import sys

import bmesh
import bpy
from mathutils import Vector
import io_scene_gltf2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if not bpy.app.background:
        raise RuntimeError("Preflight must run in a separate background process.")
    if bpy.app.version != (5, 2, 2) or sys.version_info[:2] != (3, 13):
        raise RuntimeError("Project requires Blender 5.2.2 and Python 3.13.")
    # Blender resolves relative render paths against the blend file, not cwd.
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "report.json").write_text(
        json.dumps({"passed": False, "status": "incomplete"}) + "\n", encoding="utf-8"
    )

    # Dynamic enum values come from the installed exporter, not RNA's empty list.
    formats = {item[0] for item in io_scene_gltf2.get_format_items(None, bpy.context)}
    if "GLB" not in formats or not io_scene_gltf2.is_draco_available():
        raise RuntimeError("Binary glTF export with Draco is unavailable.")

    scene = bpy.data.scenes.new("OpenMouse_Preflight")
    bpy.context.window.scene = scene
    # Geometry is in metres, as required by glTF. X=width, Y=length, Z=height.
    expected_mm = [60.0, 100.0, 40.0]
    mesh = bpy.data.meshes.new("Preflight_Block")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vert in bm.verts:
        vert.co.x *= expected_mm[0] / 1000
        vert.co.y *= expected_mm[1] / 1000
        vert.co.z *= expected_mm[2] / 1000
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new("Synthetic_60x100x40mm_Block", mesh)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.context.view_layer.update()

    material = bpy.data.materials.new("Preflight_Teal")
    shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (0.035, 0.40, 0.48, 1)
    shader.inputs["Roughness"].default_value = 0.55
    mesh.materials.append(material)

    exports = []
    for compressed in (False, True):
        filename = "block-draco.glb" if compressed else "block.glb"
        path = args.output / filename
        result = bpy.ops.export_scene.gltf(
            filepath=str(path),
            export_format="GLB",
            use_active_scene=True,
            use_selection=True,
            export_animations=False,
            export_cameras=False,
            export_lights=False,
            export_yup=True,
            export_draco_mesh_compression_enable=compressed,
        )
        if "FINISHED" not in result:
            raise RuntimeError(f"Export failed: {filename}")
        raw = path.read_bytes()
        magic, version, total_length = struct.unpack_from("<4sII", raw)
        if magic != b"glTF" or version != 2 or total_length != len(raw):
            raise RuntimeError(f"Invalid GLB header: {filename}")
        json_length, chunk_type = struct.unpack_from("<II", raw, 12)
        if chunk_type != 0x4E4F534A:
            raise RuntimeError("First GLB chunk is not JSON.")
        metadata = json.loads(raw[20:20 + json_length])
        used_draco = "KHR_draco_mesh_compression" in metadata.get("extensionsUsed", [])
        if used_draco != compressed:
            raise RuntimeError("Draco extension does not match requested export.")

        imported_scene = bpy.data.scenes.new(f"Preflight_Import_{compressed}")
        bpy.context.window.scene = imported_scene
        result = bpy.ops.import_scene.gltf(filepath=str(path))
        if "FINISHED" not in result:
            raise RuntimeError(f"Import failed: {filename}")
        imported = [item for item in imported_scene.objects if item.type == "MESH"]
        if len(imported) != 1:
            raise RuntimeError("Export must contain exactly the synthetic block.")
        restored = imported[0]
        bpy.context.view_layer.update()
        corners = [restored.matrix_world @ Vector(point) for point in restored.bound_box]
        actual_mm = [
            (max(point[axis] for point in corners) - min(point[axis] for point in corners)) * 1000
            for axis in range(3)
        ]
        error_mm = max(abs(a - b) for a, b in zip(actual_mm, expected_mm))
        topology = bmesh.new()
        topology.from_mesh(restored.data)
        raw_seam_edges = sum(not edge.is_manifold for edge in topology.edges)
        # glTF splits vertices for hard normals/UVs. Check geometric closure
        # after welding coincident positions, without editing the imported mesh.
        bmesh.ops.remove_doubles(topology, verts=list(topology.verts), dist=0.0000001)
        non_manifold_edges = sum(not edge.is_manifold for edge in topology.edges)
        volume_mm3 = abs(topology.calc_volume(signed=True)) * 1_000_000_000
        topology.free()
        # This only checks a cuboid round trip, not the M4 shell gate.
        if error_mm > 0.01 or non_manifold_edges or abs(volume_mm3 - 240_000) > 10:
            raise RuntimeError(
                f"Round-trip failed: {filename}, dimensions={actual_mm}, "
                f"non_manifold_edges={non_manifold_edges}, volume={volume_mm3}"
            )
        exports.append({
            "file": filename,
            "bytes": len(raw),
            "draco": used_draco,
            "dimensions_mm": actual_mm,
            "max_dimension_error_mm": error_mm,
            "non_manifold_edges": non_manifold_edges,
            "raw_seam_edges_before_welding": raw_seam_edges,
            "volume_mm3": volume_mm3,
        })
        bpy.context.window.scene = scene

    camera_data = bpy.data.cameras.new("Preflight_Camera")
    camera = bpy.data.objects.new("Preflight_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0.18, -0.24, 0.18)
    camera.rotation_euler = (-camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 55
    scene.camera = camera
    light_types = {item.identifier for item in bpy.types.Light.bl_rna.properties["type"].enum_items}
    if "AREA" not in light_types:
        raise RuntimeError("Area light unavailable.")
    light_data = bpy.data.lights.new("Preflight_Key", type="AREA")
    light = bpy.data.objects.new("Preflight_Key", light_data)
    scene.collection.objects.link(light)
    light.location = (0.08, -0.12, 0.25)
    light.rotation_euler = (-light.location).to_track_quat("-Z", "Y").to_euler()
    light_data.energy = 12
    light_data.size = 0.15
    scene.world = bpy.data.worlds.new("Preflight_World")
    scene.world.color = (0.07, 0.07, 0.07)
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    valid_formats = {
        item.identifier
        for item in scene.render.image_settings.bl_rna.properties["file_format"].enum_items
    }
    if "PNG" not in valid_formats:
        raise RuntimeError("PNG output unavailable.")
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(args.output / "preflight.png")
    bpy.ops.render.render(write_still=True)
    if not Path(scene.render.filepath).is_file():
        raise RuntimeError("Render output missing.")

    report = {
        "purpose": "Synthetic toolchain preflight only; no M4 gate claim",
        "blender": bpy.app.version_string,
        "python": sys.version.split()[0],
        "render_engine": scene.render.engine,
        "expected_dimensions_mm": expected_mm,
        "exports": exports,
        "render": "preflight.png",
        "passed": True,
    }
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("OPEN_MOUSE_PREFLIGHT " + json.dumps(report))


if __name__ == "__main__":
    main()
