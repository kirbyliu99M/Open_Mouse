"""Integration gate: all authored descriptor fixtures plus real GLB reimports."""
import json
import sys
from pathlib import Path
import bpy

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from gen_shell import generate_shell
from asset_utils import dimensions_mm, validate_mesh, glb_json, validate_assembly


def main():
    report = {"fixtures": [], "roundTrips": []}
    for params in json.loads((HERE / "out/coverage.json").read_text()):
        scene = bpy.data.scenes.new(params["id"])
        bpy.context.window.scene = scene
        objects = generate_shell(params)
        bpy.context.view_layer.update()
        stats = [validate_mesh(obj) for obj in objects]
        validate_assembly(objects)
        dims = dimensions_mm(objects[0])
        error = max(abs(a-b*1000) for a,b in zip(dims, [params["width"],params["length"],params["height"]]))
        triangles = sum(s["triangles"] for s in stats)
        assert error <= .5 and triangles <= 15000, (params["id"], error, triangles)
        report["fixtures"].append({"id": params["id"], "maxBboxErrorMm": error, "triangles": triangles, "meshes": stats})
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        print("FIXTURE_OK", params["id"], flush=True)
    target = HERE.parent.parent / "public/models"
    manifest = json.loads((target / "manifest.json").read_text())
    for entry in [*manifest["shells"], *manifest.get("studies", []), {"slug": "hand", "path": "hand.glb"}]:
        slug = entry["slug"]
        path = target / entry["path"]
        scene = bpy.data.scenes.new("Import_" + slug)
        bpy.context.window.scene = scene
        bpy.ops.import_scene.gltf(filepath=str(path))
        meshes = [obj for obj in scene.objects if obj.type == "MESH"]
        stats = [validate_mesh(obj, weld=True) for obj in meshes]
        validate_assembly(meshes)
        result = {"slug": slug, "meshes": stats}
        if slug != "hand":
            assert len(meshes) == 1, (slug, len(meshes))
            dims = dimensions_mm(meshes[0])
            error = max(abs(a-b) for a,b in zip(dims, entry["dimensionsXYZmm"]))
            assert error <= .5, (slug, error)
            result["maxRoundTripErrorMm"] = error
        else:
            armature = next(obj for obj in scene.objects if obj.type == "ARMATURE")
            assert set(armature.data.bones.keys()) == {f"mp_{i}" for i in range(21)}
            assert len(glb_json(path)["skins"][0]["joints"]) == 21
            assert all(v.groups for v in meshes[0].data.vertices)
            result["bones"] = 21
        report["roundTrips"].append(result)
    (HERE / "out/validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print("ALL_ASSET_CHECKS_PASSED", flush=True)


if __name__ == "__main__":
    main()
