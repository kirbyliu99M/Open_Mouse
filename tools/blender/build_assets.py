"""Build authoring assets in a separate background Blender process."""
import json
import sys
from pathlib import Path
import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from asset_utils import dimensions_mm, export_glb, validate_mesh, validate_assembly
from gen_shell import generate_shell
from gen_hand import generate_hand


def main():
    if not bpy.app.background:
        raise RuntimeError("Run in background Blender; never reset a user's scene")
    if bpy.app.version[:3] != (5, 2, 2) or sys.version_info[:2] != (3, 13):
        raise RuntimeError("This generator targets Blender 5.2.2 / Python 3.13")
    out = HERE / "out"
    target = HERE.parent.parent / "public/models"
    definitions = json.loads((out / "parameters.json").read_text())["models"]
    scene = bpy.data.scenes.new("Open_Mouse_Assets")
    bpy.context.window.scene = scene
    report = {"status": "provisional-authoring", "blender": bpy.app.version_string,
              "shells": [], "note": "Authored proxies; M1 classification and Kirby silhouette review pending."}
    for params in definitions:
        objects = generate_shell(params)
        bpy.context.view_layer.update()
        stats = {obj.name: validate_mesh(obj) for obj in objects}
        validate_assembly(objects)
        dims = dimensions_mm(objects[0])
        error = max(abs(a - b * 1000) for a, b in zip(dims, [params["width"], params["length"], params["height"]]))
        triangles = sum(s["triangles"] for s in stats.values())
        if error > .5 or triangles > 15000:
            raise RuntimeError(f"Shell gate failed: {error=} {triangles=}")
        path = target / "shells" / (params["id"] + ".glb")
        export_glb(objects, path)
        report["shells"].append({"id": params["id"], "dimensionsXYZmm": dims,
            "maxBboxErrorMm": error, "triangles": triangles, "meshes": stats,
            "bytes": path.stat().st_size, "sourceUrl": params["sourceUrl"]})
        print("SHELL_OK", params["id"], error, triangles, flush=True)
    hand, rig, landmarks = generate_hand()
    hand_stats = validate_mesh(hand)
    weight_error = max(abs(sum(g.weight for g in v.groups) - 1) for v in hand.data.vertices)
    if weight_error > 1e-6 or len(rig.data.bones) != 21:
        raise RuntimeError("Invalid rig")
    path = target / "hand.glb"
    metadata = export_glb([hand, rig], path)
    if len(metadata.get("skins", [])) != 1 or len(metadata["skins"][0]["joints"]) != 21:
        raise RuntimeError("Hand skin did not export")
    report["hand"] = {"mesh": hand_stats, "bones": 21, "weightSumMaxError": weight_error,
        "landmarksMetres": landmarks, "bytes": path.stat().st_size,
        "restPose": "flat palm down; authored template, not a population measurement"}
    (target / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "assets.blend"))
    print("ASSETS_OK", flush=True)


if __name__ == "__main__":
    main()
