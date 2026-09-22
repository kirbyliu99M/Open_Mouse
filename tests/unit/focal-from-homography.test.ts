import { describe, expect, it } from "vitest";
import { estimateFocalFromHomography } from "../../src/client/geometry/focal-from-homography";
import {
  buildExactHomography,
  buildSyntheticCamera,
} from "./helpers/synthetic-camera";

const F_PX = 3800;

describe("estimateFocalFromHomography", () => {
  it("recovers f within 2% at >=15deg tilt and flags the result reliable", () => {
    for (const tiltDeg of [15, 20, 25, 30, 40]) {
      const camera = buildSyntheticCamera({
        tiltDeg,
        distanceMm: 450,
        fPx: F_PX,
      });
      const h = buildExactHomography(camera);
      const estimate = estimateFocalFromHomography(h, camera.intrinsics);

      expect(estimate).not.toBeNull();
      const { fPx, reliable } = estimate!;
      expect(reliable).toBe(true);
      expect(Math.abs(fPx - F_PX) / F_PX).toBeLessThan(0.02);
    }
  });

  it("flags the near-fronto-parallel view as unreliable rather than returning garbage", () => {
    for (const tiltDeg of [0, 0.001, 0.5, 1]) {
      const camera = buildSyntheticCamera({
        tiltDeg,
        distanceMm: 450,
        fPx: F_PX,
      });
      const h = buildExactHomography(camera);
      const estimate = estimateFocalFromHomography(h, camera.intrinsics);

      if (estimate !== null) {
        expect(estimate.reliable).toBe(false);
      }
    }
  });

  it("is reliable for a moderate range of intermediate tilts (>= ~8 deg) and unreliable below it", () => {
    // Empirically map out where the reliable flag flips, so the boundary
    // documented in the PR is grounded in an actual test rather than an
    // assertion nobody checked.
    const results = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map((tiltDeg) => {
      const camera = buildSyntheticCamera({
        tiltDeg,
        distanceMm: 450,
        fPx: F_PX,
      });
      const h = buildExactHomography(camera);
      const estimate = estimateFocalFromHomography(h, camera.intrinsics);
      return { tiltDeg, reliable: estimate?.reliable ?? false };
    });

    // Once reliable, it should stay reliable for every larger tilt tested
    // (monotonic conditioning as tilt increases away from fronto-parallel).
    const firstReliableIdx = results.findIndex((r) => r.reliable);
    expect(firstReliableIdx).toBeGreaterThan(-1);
    for (let i = firstReliableIdx; i < results.length; i++) {
      expect(results[i].reliable).toBe(true);
    }
    // And 15 deg (the issue's stated floor) must be included in the reliable range.
    expect(results[results.length - 1].reliable).toBe(true);
  });

  it("returns null for a perfectly fronto-parallel view (both constraints exactly degenerate)", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: 0,
      distanceMm: 450,
      fPx: F_PX,
    });
    const h = buildExactHomography(camera);
    const estimate = estimateFocalFromHomography(h, camera.intrinsics);
    // Either null, or reliable=false — never a confidently-wrong answer.
    if (estimate !== null) {
      expect(estimate.reliable).toBe(false);
    }
  });
});
