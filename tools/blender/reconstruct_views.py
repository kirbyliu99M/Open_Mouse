"""Reconstruct a closed fit mesh from calibrated RGB/depth reference images.

This stage reads no manufacturer mesh: it carves a voxel grid against the
captured silhouettes and visible surface depths, then extracts a new isosurface.
Outputs are review assets, with provenance; they are not independent scans.
"""
import argparse
import json
import os
from pathlib import Path
import sys
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "out/python-deps"))
import cv2
import numpy as np
from scipy import ndimage
from skimage.measure import marching_cubes


def reconstruct(path, spacing=.00045, closing=1):
    calibration = json.loads(path.read_text())
    target = np.asarray(calibration["dimensionsXYZ"],dtype=np.float32)
    origin = np.array([-target[0]/2,-target[1]/2,0],dtype=np.float32) - spacing*3
    shape = np.ceil((target+spacing*6)/spacing).astype(int)+1
    indices = np.indices(shape,dtype=np.float32).reshape(3,-1).T
    points = indices*spacing+origin
    signed_field = np.full(len(points), spacing*4,dtype=np.float32)
    active = np.arange(len(points))
    for camera in calibration["views"]:
        matrix = np.asarray(camera["worldToCamera"],dtype=np.float32)
        local = points[active] @ matrix[:3,:3].T + matrix[:3,3]
        res = camera["resolution"]
        fx = (local[:,0]/camera["orthoScale"]+.5)*res-.5
        fy = (.5-local[:,1]/camera["orthoScale"])*res-.5
        x = np.rint(fx).astype(int)
        y = np.rint(fy).astype(int)
        x,y = np.clip(x,0,res-1),np.clip(y,0,res-1)
        depth = cv2.imread(str(path.parent/camera["depthImage"]),cv2.IMREAD_UNCHANGED)
        raw_mask = depth[:,:,3] > .8
        mask = ndimage.binary_dilation(ndimage.binary_fill_holes(raw_mask),iterations=1)
        front_depth = ndimage.map_coordinates(depth[:,:,0],[fy,fx],order=1,mode='nearest') + camera.get("depthOffset",0)
        distance = -local[:,2]-front_depth
        reliable = ndimage.binary_erosion(raw_mask,iterations=1)[y,x]
        signed_field[active] = np.minimum(signed_field[active],np.where(reliable,distance,spacing*4))
        keep = mask[y,x] & ((distance >= -spacing*2) | ~reliable)
        signed_field[active[~keep]] = -spacing*2
        active = active[keep]
    volume = np.zeros(np.prod(shape),dtype=np.uint8)
    volume[active] = (signed_field[active]>=0)
    volume = volume.reshape(shape)
    labels,count = ndimage.label(volume)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    volume = labels == sizes.argmax()
    volume = ndimage.binary_closing(volume,iterations=closing)
    volume = ndimage.binary_fill_holes(volume)
    field = signed_field.reshape(shape)
    field = np.where(volume,np.maximum(field,spacing*.15),np.minimum(field,-spacing*.15))
    field = ndimage.gaussian_filter(np.clip(field,-spacing*2,spacing*2),.85)
    vertices,faces,_,_ = marching_cubes(field,0,spacing=(spacing,)*3,allow_degenerate=False)
    vertices += origin
    destination = HERE / "out/reconstructed" / calibration["slug"]
    destination.mkdir(parents=True,exist_ok=True)
    np.savez_compressed(destination/"mesh.npz",vertices=vertices,faces=faces)
    report = {"slug":calibration["slug"],"method":"26-view silhouette and depth image carving",
        "source":calibration["source"],"cameraFile":str(path.relative_to(HERE)),"voxelSizeMm":spacing*1000,
        "dimensionsXYZ":target.tolist(),"gridShape":shape.tolist(),"occupiedVoxels":int(volume.sum()),
        "rawVertices":len(vertices),"rawTriangles":len(faces),"componentsBeforeCleanup":int(count),"closingIterations":closing,
        "status":"reference-derived review mesh; silhouette and detail review pending"}
    (destination/"reconstruction.json").write_text(json.dumps(report,indent=2)+"\n")
    print("RECONSTRUCTED",calibration["slug"],len(vertices),len(faces),flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model")
    parser.add_argument("--closing",type=int,default=1)
    args = parser.parse_args()
    for path in sorted((HERE/"out/reference-library").glob("*/views/cameras.json")):
        if not args.model or path.parent.parent.name in args.model.split(','):
            reconstruct(path,closing=args.closing)
