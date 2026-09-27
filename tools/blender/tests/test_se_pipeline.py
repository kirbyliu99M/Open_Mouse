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

class SEPipelineTests(unittest.TestCase):
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
