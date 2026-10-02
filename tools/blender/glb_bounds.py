"""Exact static shell bounds from glTF accessor metadata, without bpy or Draco."""
import json
import math
from pathlib import Path
import struct


def read_glb_json(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise ValueError(f"Invalid GLB header: {path}")
    if struct.unpack_from("<I", data, 8)[0] != len(data):
        raise ValueError(f"GLB length mismatch: {path}")
    size, kind = struct.unpack_from("<I4s", data, 12)
    if kind != b"JSON" or 20 + size > len(data):
        raise ValueError(f"Invalid GLB JSON chunk: {path}")
    return json.loads(data[20:20 + size])


def vector3(values):
    if len(values) != 3 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError("Bounds and transforms require three finite components")
    return values


def glb_dimensions_mm(path: Path) -> list[float]:
    """Combine every scene primitive in world space, then map glTF XYZ to X,-Z,Y.

    asset_utils.export_glb uses export_yup=True; dimensionsXYZmm is Blender
    width/length/height. Accessor boxes give exact extrema under translation and
    axis scale (including reflection), but arbitrary rotations/shears can only
    give conservative boxes. Report unsupported transforms instead of guessing.
    The delivered shells have identity transforms and no deformation.
    """
    document = read_glb_json(path)
    if document.get("animations"):
        raise ValueError(f"Ambiguous animated bounds: {path}")
    nodes = document["nodes"]
    minimum = [math.inf] * 3
    maximum = [-math.inf] * 3
    seen = set()

    def visit(index, parent_translation, parent_scale):
        if index in seen:
            raise ValueError(f"Ambiguous node hierarchy: {path}")
        seen.add(index)
        node = nodes[index]
        if "matrix" in node or node.get("rotation", [0, 0, 0, 1]) != [0, 0, 0, 1] or "skin" in node:
            raise ValueError(f"Unsupported matrix/rotation/skin for exact accessor bounds: {path}, node {index}")
        local_translation = vector3(node.get("translation", [0, 0, 0]))
        local_scale = vector3(node.get("scale", [1, 1, 1]))
        translation = [parent_translation[a] + parent_scale[a] * local_translation[a] for a in range(3)]
        scale = [parent_scale[a] * local_scale[a] for a in range(3)]
        if "mesh" in node:
            for primitive in document["meshes"][node["mesh"]]["primitives"]:
                if primitive.get("targets"):
                    raise ValueError(f"Ambiguous morph bounds: {path}")
                accessor = document["accessors"][primitive["attributes"]["POSITION"]]
                if accessor.get("type") != "VEC3" or "min" not in accessor or "max" not in accessor:
                    raise ValueError(f"Missing POSITION VEC3 min/max: {path}")
                low, high = vector3(accessor["min"]), vector3(accessor["max"])
                if any(a > b for a, b in zip(low, high)):
                    raise ValueError(f"Inverted POSITION bounds: {path}")
                for axis in range(3):
                    ends = [translation[axis] + scale[axis] * v for v in (low[axis], high[axis])]
                    minimum[axis] = min(minimum[axis], *ends)
                    maximum[axis] = max(maximum[axis], *ends)
        for child in node.get("children", []):
            visit(child, translation, scale)

    # An absent default scene is ambiguous when more than one scene exists.
    if "scene" not in document and len(document["scenes"]) != 1:
        raise ValueError(f"Ambiguous default scene: {path}")
    for root in document["scenes"][document.get("scene", 0)].get("nodes", []):
        visit(root, [0, 0, 0], [1, 1, 1])
    if not all(math.isfinite(v) for v in minimum + maximum):
        raise ValueError(f"Missing or nonfinite scene bounds: {path}")
    return [(maximum[a] - minimum[a]) * 1000 for a in (0, 2, 1)]
