"""Tiny GLB envelopes; bounds tests deliberately need no Draco decoder."""
import json
import struct


def write_glb(path, document):
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary = b"\0" * 4
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 28 + len(encoded) + len(binary))
                     + struct.pack("<I4s", len(encoded), b"JSON") + encoded
                     + struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def shell_document():
    return {
        "asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0},
                    "extensions": {"KHR_draco_mesh_compression": {"bufferView": 0, "attributes": {"POSITION": 0}}}}]}],
        "accessors": [{"componentType": 5126, "count": 3, "type": "VEC3",
                       "min": [0, 0, 0], "max": [.06, .04, .1]}],
        "extensionsUsed": ["KHR_draco_mesh_compression"],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 4}],
        "buffers": [{"byteLength": 4}],
    }
