import { describe, expect, it } from "vitest";
import {
  DETECTOR_PRELOAD_PATHS,
  shouldSkipPreload,
} from "@/client/photo/preloadDetector";

describe("warming the hand detector's files", () => {
  it("warms the 7.8 MB model on the landing page and the SIMD runtime on the scan button (Kirby 2026-10-26)", () => {
    expect(DETECTOR_PRELOAD_PATHS).toEqual({
      landing: ["/mediapipe/models/hand_landmarker.task"],
      scan: [
        "/mediapipe/wasm/vision_wasm_internal.js",
        "/mediapipe/wasm/vision_wasm_internal.wasm",
      ],
    });
  });

  it("is skipped with Save-Data or on a 2G-class connection, not otherwise", () => {
    expect(shouldSkipPreload({ saveData: true })).toBe(true);
    expect(shouldSkipPreload({ effectiveType: "2g" })).toBe(true);
    expect(shouldSkipPreload({ effectiveType: "slow-2g" })).toBe(true);
    expect(shouldSkipPreload({ effectiveType: "3g" })).toBe(false);
    expect(shouldSkipPreload({ effectiveType: "4g" })).toBe(false);
    expect(shouldSkipPreload(undefined)).toBe(false);
  });
});
