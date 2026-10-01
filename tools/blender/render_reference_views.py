"""Capture calibrated multiview PNGs from official public AR reference assets.

Uses only a separate background Blender process. Source meshes are not exported
as project geometry; the reconstruction stage consumes these images and cameras.
"""
from check_catalogues import NO_SHELL
import argparse
import itertools
import json
import math
from pathlib import Path
import sys
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE / "out/reference-library"


def capture(record, resolution=512):
    destination = ROOT / record["slug"] / "views"
    destination.mkdir(exist_ok=True)
    if (destination / "cameras.json").exists() and json.loads((destination / "cameras.json").read_text()).get("captureVersion") == 3:
        print("CACHED", record["slug"], flush=True)
        return
    scene = bpy.data.scenes.new("Reference_" + record["slug"])
    bpy.context.window.scene = scene
    bpy.ops.import_scene.gltf(filepath=str(ROOT / record["arModels"][0]["file"]))
    objects = [o for o in scene.objects if o.type == "MESH"]
    # Bake import transforms, then choose the axis permutation with the closest
    # aspect ratios to published dimensions; preserve source handedness.
    world_points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    low = Vector([min(p[a] for p in world_points) for a in range(3)])
    high = Vector([max(p[a] for p in world_points) for a in range(3)])
    size = high-low
    target = Vector([record["widthMm"],record["lengthMm"],record["heightMm"]]) / 1000
    permutations = list(itertools.permutations(range(3)))
    permutation = min(permutations, key=lambda order: sum((math.log(size[order[a]]/target[a]) - sum(math.log(size[order[b]]/target[b]) for b in range(3))/3)**2 for a in range(3)))
    mapping = Matrix([[1 if c == permutation[r] else 0 for c in range(3)] for r in range(3)])
    if mapping.determinant() < 0:
        mapping[0] = -mapping[0]
    cable_trim = None
    if record['slug'] in {'logitech-g203-lightsync','logitech-g403-hero','logitech-g502-hero','logitech-g502-x'}:
        # Published mouse dimensions exclude the cable. Find the narrow tail
        # before scaling, then clip only a clear, long cable-like extension.
        axis=permutation[1];cross=permutation[0]
        xyz=np.array([list(p) for p in world_points])
        edges=np.linspace(low[axis],high[axis],241)
        widths=[]
        for begin,end in zip(edges[:-1],edges[1:]):
            sample=xyz[(xyz[:,axis]>=begin)&(xyz[:,axis]<=end),cross]
            widths.append(float(np.ptp(sample)) if len(sample)>1 else 0.)
        body=np.flatnonzero(np.array(widths)>.3*max(widths))
        new_low,new_high=float(low[axis]),float(high[axis])
        if body[0]>10 and np.percentile(widths[:max(1,body[0]-2)],65) < .25*max(widths):
            new_low=edges[max(0,body[0]-1)]
        if 239-body[-1]>10 and np.percentile(widths[min(239,body[-1]+2):],65) < .25*max(widths):
            new_high=edges[min(240,body[-1]+2)]
        if new_low!=low[axis] or new_high!=high[axis]:
            cable_trim={'axis':axis,'before':[float(low[axis]),float(high[axis])],'after':[new_low,new_high]}
            for obj in objects:
                matrix=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=Matrix.Identity(4)
                for vertex in obj.data.vertices:vertex.co=matrix@vertex.co
                bm=bmesh.new();bm.from_mesh(obj.data)
                normal=[0,0,0];normal[axis]=1
                for plane,inner,outer in [(new_low,True,False),(new_high,False,True)]:
                    co=[0,0,0];co[axis]=plane
                    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),plane_co=co,plane_no=normal,clear_inner=inner,clear_outer=outer)
                bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary])
                bm.to_mesh(obj.data);bm.free()
            low[axis],high[axis]=new_low,new_high
            size=high-low
    for obj in objects:
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        for vertex in obj.data.vertices:
            p = matrix @ vertex.co - (low+high)/2
            p = mapping @ p
            vertex.co = Vector([p[a]*target[a]/size[permutation[a]] for a in range(3)])
            vertex.co.z += target.z/2
        obj.data.update()
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 8
    scene.world = bpy.data.worlds.new("ReferenceWorld")
    scene.world.color = (.35,.35,.35)
    center = Vector((0,0,target.z/2))
    distance = max(target)*4
    camera_data = bpy.data.cameras.new("ReferenceCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(target)*1.22
    camera_data.clip_start = .0001
    camera = bpy.data.objects.new("ReferenceCamera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    depth_material = bpy.data.materials.new("ReferenceDepth")
    depth_material.node_tree.nodes.clear()
    output = depth_material.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emission = depth_material.node_tree.nodes.new("ShaderNodeEmission")
    camera_node = depth_material.node_tree.nodes.new("ShaderNodeCameraData")
    shift = depth_material.node_tree.nodes.new("ShaderNodeMath")
    assert "SUBTRACT" in {i.identifier for i in shift.bl_rna.properties["operation"].enum_items}
    shift.operation = "SUBTRACT"
    shift.inputs[1].default_value = distance - .1
    depth_material.node_tree.links.new(camera_node.outputs["View Z Depth"], shift.inputs[0])
    depth_material.node_tree.links.new(shift.outputs[0], emission.inputs["Color"])
    depth_material.node_tree.links.new(emission.outputs[0], output.inputs["Surface"])
    for index, pos in enumerate([(-1,-1,2),(1,.5,1.5)]):
        data = bpy.data.lights.new("ReferenceLight", "AREA")
        data.energy = 8 if index == 0 else 4
        data.size = .35
        light = bpy.data.objects.new("ReferenceLight",data)
        scene.collection.objects.link(light)
        light.location = center + Vector(pos)*.3
        light.rotation_euler = (center-light.location).to_track_quat("-Z","Y").to_euler()
    views = [(f"azimuth-{i*22.5:05.1f}",i*22.5,0) for i in range(16)]
    views += [(f"elevated-{i*45:03}",i*45,40) for i in range(8)]
    views += [("top",0,90),("bottom",0,-90)]
    cameras = []
    for name, azimuth, elevation in views:
        az,el = math.radians(azimuth), math.radians(elevation)
        camera.location = center + Vector((math.cos(az)*math.cos(el),math.sin(az)*math.cos(el),math.sin(el)))*distance
        camera.rotation_euler = (center-camera.location).to_track_quat("-Z","Y").to_euler()
        bpy.context.view_layer.update()
        scene.render.filepath = str(destination / (name+".png"))
        scene.render.image_settings.file_format = "PNG"
        scene.view_layers[0].material_override = None
        bpy.ops.render.render(write_still=True)
        scene.view_layers[0].material_override = depth_material
        assert "OPEN_EXR" in {i.identifier for i in scene.render.image_settings.bl_rna.properties["file_format"].enum_items}
        scene.render.image_settings.file_format = "OPEN_EXR"
        assert "32" in {i.identifier for i in scene.render.image_settings.bl_rna.properties["color_depth"].enum_items}
        scene.render.image_settings.color_depth = "32"
        scene.render.filepath = str(destination / (name+"-depth.exr"))
        bpy.ops.render.render(write_still=True)
        cameras.append({"name": name,"azimuth":azimuth,"elevation":elevation,"image":name+".png", "depthImage":name+"-depth.exr", "depthOffset":distance-.1, "worldToCamera":[list(row) for row in camera.matrix_world.inverted()],"orthoScale":camera_data.ortho_scale,"resolution":resolution})
    report = {"captureVersion":3,"slug":record["slug"],"source":record["arModels"][0],"dimensionsXYZ":list(target),"cableTrim":cable_trim,
        "referenceOriginalDimensions":list(size),"sourceAxisPermutation":permutation,"views":cameras,
        "note":"Manufacturer AR renders, not independently photographed turntable frames. Scaled to published dimensions."}
    (destination / "cameras.json").write_text(json.dumps(report,indent=2)+"\n")
    print("CAPTURED",record["slug"],len(cameras),flush=True)
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj,do_unlink=True)
    bpy.context.window.scene = bpy.data.scenes[0]
    bpy.data.scenes.remove(scene)
    bpy.data.orphans_purge(do_recursive=True)


def main():
    if not bpy.app.background:
        raise RuntimeError("Background process only")
    parser = argparse.ArgumentParser()
    parser.add_argument("--model")
    parser.add_argument("--resolution",type=int,default=512)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    for path in sorted(ROOT.glob("*/sources.json")):
        if path.parent.name in NO_SHELL:continue
        record = json.loads(path.read_text(encoding="utf-8"))
        if record["arModels"] and (not args.model or record["slug"]==args.model):
            capture(record,args.resolution)


if __name__ == "__main__":
    main()
