import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fit_se_photos import orthographic_axes,raster_silhouette
from recolour_se import read_glb,image_chunk,replace_image
from package_se import validate_camera_views

class SEPipelineTests(unittest.TestCase):
    def test_camera_gate_applies_only_to_colour_views_and_requires_holdout(self):
        colour = [{'iou': .95}, {'iou': .96, 'usedForColour': True}]
        held_out = {'iou': .90, 'usedForColour': False}
        validate_camera_views(colour + [held_out])
        with self.assertRaises(AssertionError):
            validate_camera_views(colour)
        with self.assertRaises(AssertionError):
            validate_camera_views([{'iou': .949}, held_out])
        with self.assertRaises(AssertionError):
            validate_camera_views([{'iou': .949, 'usedForColour': True}, held_out])

    def test_shared_axes_are_bit_identical_to_se_formula(self):
        for angles in [(0, 0, 0), (-49.5254, 36.2130, .0002), (10, 89, 20)]:
            az, el, angle = np.deg2rad(angles)
            direction = np.array([np.sin(az)*np.cos(el), np.cos(az)*np.cos(el), np.sin(el)])
            right = np.array([-np.cos(az), np.sin(az), 0])
            up = np.cross(direction, right)
            previous = np.array([right*np.cos(angle)+up*np.sin(angle),
                                 -right*np.sin(angle)+up*np.cos(angle), direction])
            np.testing.assert_array_equal(orthographic_axes(*angles), previous)

    def test_camera_axes_are_right_handed_and_orthonormal(self):
        for angles in [(0,0,0),(-49.5,36.2,0),(10,89,20)]:
            axes=orthographic_axes(*angles)
            np.testing.assert_allclose(axes@axes.T,np.eye(3),atol=1e-12)
            self.assertAlmostEqual(np.linalg.det(axes),1)

    def test_silhouette_keeps_shape_and_normalizes_framing(self):
        vertices=np.array([[0.,0,0],[1,0,0],[0,1,0]])
        a=raster_silhouette(vertices,np.array([[0,1,2]]),np.eye(3),(101,101))
        b=raster_silhouette(vertices*2+4,np.array([[0,1,2]]),np.eye(3),(101,101))
        np.testing.assert_array_equal(a,b)
        self.assertTrue(a[100,0]);self.assertFalse(a[0,100])
        self.assertTrue(4900<a.sum()<5300)

    def test_base_image_rewrite_preserves_geometry_and_other_maps(self):
        document={'buffers':[{'byteLength':12}],
            'bufferViews':[{'byteOffset':0,'byteLength':4},{'byteOffset':4,'byteLength':4},{'byteOffset':8,'byteLength':4}],
            'images':[{'bufferView':1,'mimeType':'image/png'},{'bufferView':2,'mimeType':'image/png'}],
            'accessors':[{'bufferView':0,'componentType':5126,'count':1,'type':'SCALAR'}]}
        encoded=json.dumps(document).encode();encoded+=b' '*(-len(encoded)%4)
        blob=struct.pack('<4sII',b'glTF',2,28+len(encoded)+12)+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',12,b'BIN\0')+b'GEOMBASENORM'
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'source.glb';target=Path(folder)/'target.glb';source.write_bytes(blob)
            replace_image(source,target,0,b'NEWBASE')
            actual,binary=read_glb(target)
            self.assertEqual(binary[:4],b'GEOM')
            self.assertEqual(image_chunk(actual,binary,0),b'NEWBASE')
            self.assertEqual(image_chunk(actual,binary,1),b'NORM')
            self.assertEqual(actual['accessors'],document['accessors'])
            self.assertEqual(source.read_bytes(),blob)
            self.assertEqual(struct.unpack_from('<I',target.read_bytes(),8)[0],len(target.read_bytes()))
