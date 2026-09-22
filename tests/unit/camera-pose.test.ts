import { describe, expect, it } from "vitest";
import { recoverCameraPose } from "../../src/client/geometry/camera-pose";
import {
  buildExactHomography,
  buildSyntheticCamera,
} from "./helpers/synthetic-camera";

const F_PX = 3800;

describe("recoverCameraPose", () => {
  it("recovers R, t and camera height exactly from a noiseless 20°-tilt camera", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: 20,
      distanceMm: 450,
      fPx: F_PX,
    });
    const h = buildExactHomography(camera);
    const pose = recoverCameraPose(h, camera.intrinsics);

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(pose.R[i][j]).toBeCloseTo(camera.R[i][j], 6);
      }
    }
    for (let i = 0; i < 3; i++) {
      expect(pose.t[i]).toBeCloseTo(camera.t[i], 3);
    }
    expect(pose.cameraHeightMm).toBeCloseTo(camera.distanceMm, 3);
  });

  it("recovers a proper rotation (RᵀR = I, det = +1) across a range of tilts", () => {
    for (const tiltDeg of [0.01, 5, 10, 15, 20, 30, 45]) {
      const camera = buildSyntheticCamera({
        tiltDeg,
        distanceMm: 450,
        fPx: F_PX,
      });
      const h = buildExactHomography(camera);
      const pose = recoverCameraPose(h, camera.intrinsics);
      const r = pose.R;

      // RᵀR ≈ I.
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const dot = r[0][i] * r[0][j] + r[1][i] * r[1][j] + r[2][i] * r[2][j];
          expect(dot).toBeCloseTo(i === j ? 1 : 0, 6);
        }
      }

      const det =
        r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) -
        r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) +
        r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
      expect(det).toBeCloseTo(1, 6);
    }
  });

  it("recovers camera height close to the true distance across tilts and distances", () => {
    for (const distanceMm of [300, 450, 600]) {
      for (const tiltDeg of [5, 10, 20, 30]) {
        const camera = buildSyntheticCamera({ tiltDeg, distanceMm, fPx: F_PX });
        const h = buildExactHomography(camera);
        const pose = recoverCameraPose(h, camera.intrinsics);
        expect(pose.cameraHeightMm).toBeCloseTo(distanceMm, 1);
      }
    }
  });

  it("throws when the camera is above the sheet but intrinsics are wildly wrong (degenerate)", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: 20,
      distanceMm: 450,
      fPx: F_PX,
    });
    const h = buildExactHomography(camera);
    expect(() =>
      recoverCameraPose(h, {
        fPx: -1,
        cx: camera.intrinsics.cx,
        cy: camera.intrinsics.cy,
      }),
    ).toThrow(/fPx must be positive/);
  });
});
